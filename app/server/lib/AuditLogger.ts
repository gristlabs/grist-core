import { mapGetOrSet, MapWithTTL } from "app/common/AsyncCreate";
import {
  AuditLogStreamingDestination,
  AuditLogStreamingDestinationName,
} from "app/common/Config";
import { Organization } from "app/gen-server/entity/Organization";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import {
  AuditEvent,
  AuditEventAction,
  AuditEventActor,
  AuditEventContext,
  AuditEventDetails,
} from "app/server/lib/AuditEvent";
import { AuditEventFormatter } from "app/server/lib/AuditEventFormatter";
import { LogMethods } from "app/server/lib/LogMethods";
import { proxyAgent } from "app/server/lib/ProxyAgent";
import { getOriginIpAddress } from "app/server/lib/requestUtils";
import { getPubSubPrefix } from "app/server/lib/serverUtils";
import {
  getAltSessionId,
  getFullUser,
  getLogMeta,
  getRequest,
  RequestOrSession,
} from "app/server/lib/sessionUtils";
import moment from "moment-timezone";
import fetch from "node-fetch";
import { AbortSignal } from "node-fetch/externals";
import { createClient, RedisClient } from "redis";
import { inspect } from "util";
import { v4 as uuidv4 } from "uuid";

export interface IAuditLogger {
  /**
   * Logs an audit event.
   */
  logEvent<Action extends AuditEventAction>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Action>
  ): void;
  /**
   * Logs an audit event or throws an error on failure.
   */
  logEventOrThrow<Action extends AuditEventAction>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Action>
  ): Promise<void>;
  /**
   * Close any resources used by the logger.
   */
  close(): Promise<void>;
}

export interface AuditEventProperties<
  Action extends AuditEventAction = AuditEventAction
> {
  /**
   * The action that was performed.
   */
  action: Action;
  /**
   * Who performed the `action` in the event.
   */
  actor?: AuditEventActor;
  /**
   * Where the event originated from.
   */
  context?: Pick<AuditEventContext, "site">;
  /**
   * Additional details about the event.
   */
  details?: AuditEventDetails[Action];
}

export const Deps = {
  CACHE_TTL_MS: 60_000,
  MAX_CONCURRENT_REQUESTS: 100,
};

interface AuditLoggerOptions {
  formatters: AuditEventFormatter[];
  allowDestination(
    destination: AuditLogStreamingDestination,
    org: Organization | null
  ): boolean;
}

export class AuditLogger implements IAuditLogger {
  private _numPendingRequests = 0;
  private readonly _abortController = new AbortController();
  private readonly _formatters: Map<
    AuditLogStreamingDestinationName,
    AuditEventFormatter
  > = new Map();
  private readonly _installStreamingDestinations = new MapWithTTL<
    true,
    Promise<AuditLogStreamingDestination[]>
  >(Deps.CACHE_TTL_MS);
  private readonly _orgStreamingDestinations = new MapWithTTL<
    number,
    Promise<AuditLogStreamingDestination[]>
  >(Deps.CACHE_TTL_MS);
  private readonly _logger = new LogMethods<RequestOrSession | undefined>(
    "AuditLogger ",
    (requestOrSession) => getLogMeta(requestOrSession)
  );
  private _redisClient: RedisClient | null = null;
  private readonly _redisChannel = `${getPubSubPrefix()}-audit-logger-streaming-destinations:change`;
  private _createdPromises: Set<Promise<any>>|null = new Set();
  private _closed = false;
  private _allowDestination = this._options.allowDestination;

  constructor(private _db: HomeDBManager, private _options: AuditLoggerOptions) {
    this._initializeFormatters();
    this._subscribeToStreamingDestinations();
  }

  public async close(timeout = 10_000) {
    // Wait 10 seconds for all promises to complete
    const start = Date.now();
    this._closed = true;
    while(this._createdPromises?.size) {
      if (Date.now() - start > timeout) {
        this._logger.error(null, "timed out waiting for promises created by audit logger to complete");
        break;
      }
      const promises = Array.from(this._createdPromises);
      this._createdPromises.clear();
      await Promise.allSettled(promises).catch((error) => {
        this._logger.error(null, "failed to close audit logger", error);
      });
    }

    // Remove the set, it will prevent from adding new promises. This is just sanity check, as
    // code already tests for this._closed before adding new promises.
    this._createdPromises = null;

    // Clear up TTL Maps that have timers associated with them.
    this._installStreamingDestinations.clear();
    this._orgStreamingDestinations.clear();

    // Close the redis clients if they weren't already.
    await this._redisClient?.quitAsync();

    // Abort all pending requests.
    this._abortController.abort();
  }

  /**
   * Logs an audit event.
   */
  public logEvent(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties
  ): void {
    if (this._closed) {
      throw new Error("audit logger is closed");
    }

    this._track(this.logEventOrThrow(requestOrSession, properties)).catch((error) => {
      this._logger.error(requestOrSession, `failed to log audit event`, error);
      this._logger.warn(
        requestOrSession,
        "skipping audit event due to earlier failure",
        inspect(error.event, {
          depth: Infinity,
        })
      );
    });
  }

  /**
   * Logs an audit event or throws an error on failure.
   */
  public async logEventOrThrow(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties
  ) {
    if (this._closed) {
      throw new Error("audit logger is closed");
    }
    const event = this._buildEventFromProperties(requestOrSession, properties);
    const destinations = await this._getOrSetStreamingDestinations(event);
    const requests = await Promise.allSettled(
      destinations.map((destination: AuditLogStreamingDestination) =>
        this._streamEventToDestination(event, destination)
      )
    );
    const errors = requests
      .filter(
        (request): request is PromiseRejectedResult =>
          request.status === "rejected"
      )
      .map(({ reason }) => reason);
    if (errors.length > 0) {
      throw new LogAuditEventError(
        "encountered errors while streaming audit event",
        { event, errors }
      );
    }
  }

  public length() {
    return this._createdPromises?.size ?? 0;
  }

  private _buildEventFromProperties(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties
  ): AuditEvent {
    const { action, context = {}, details } = properties;
    return {
      id: uuidv4(),
      action,
      actor: this._getEventActor(requestOrSession),
      context: {
        ...getEventContext(requestOrSession),
        ...context,
      },
      timestamp: moment().toISOString(),
      details,
    };
  }

  private async _getOrSetStreamingDestinations(event: AuditEvent) {
    const destinations = await Promise.all([
      mapGetOrSet(this._installStreamingDestinations, true, () =>
        this._track(this._fetchStreamingDestinations()),
      ),
      // TODO: Uncomment when team audit logs are ready to use.
      // !event.context.site?.id ? null : mapGetOrSet(this._orgStreamingDestinations, event.context.site.id, () =>
      //   this._track(this._fetchStreamingDestinations(event.context.site.id))
      // ),
    ]);
    return destinations
      .filter((d): d is AuditLogStreamingDestination[] => d !== null)
      .flat();
  }

  private async _fetchStreamingDestinations(
    orgId?: number
  ): Promise<AuditLogStreamingDestination[]> {
    if (this._db.isMergedOrg(orgId ?? null)) {
      return [];
    }

    const config = await this._db.getConfigByKeyAndOrgId(
      "audit_log_streaming_destinations",
      orgId
    );
    if (!config) {
      return [];
    }

    return config.value.filter((destination) =>
      this._allowDestination(destination, config.org)
    );
  }

  private async _streamEventToDestination(
    event: AuditEvent,
    destination: AuditLogStreamingDestination
  ) {
    if (this._numPendingRequests === Deps.MAX_CONCURRENT_REQUESTS) {
      throw new Error(
        `maximum number of concurrent requests exceeded (${Deps.MAX_CONCURRENT_REQUESTS})`
      );
    }

    const { url, token } = destination;
    try {
      this._numPendingRequests += 1;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: token } : undefined),
          "Content-Type": "application/json",
        },
        body: this._buildStreamingDestinationPayload(event, destination),
        agent: proxyAgent(new URL(url)),
        timeout: 10_000,
        signal: this._abortController.signal as AbortSignal,
      });
      if (!resp.ok) {
        throw new Error(
          `received a non-2XX response from ${resp.url}: ${
            resp.status
          } ${await resp.text()}`
        );
      }
    } catch (e) {
      throw new Error(e?.message ?? `failed to stream audit event to ${url}`, {
        cause: e,
      });
    } finally {
      this._numPendingRequests -= 1;
    }
  }

  private _buildStreamingDestinationPayload(
    event: AuditEvent,
    { name }: AuditLogStreamingDestination
  ): string {
    const formatter = this._formatters.get(name);
    if (!formatter) {
      throw new Error(
        `no audit event formatter found for destination (${name})`
      );
    }

    return JSON.stringify(formatter.formatEvent(event));
  }

  private _getEventActor(requestOrSession: RequestOrSession): AuditEventActor {
    const user = getFullUser(requestOrSession);
    if (!user) {
      return { type: "unknown" };
    } else if (user.id === this._db.getAnonymousUserId()) {
      return { type: "guest" };
    } else {
      const { id, email, name } = user;
      return { type: "user", user: { id, email, name } };
    }
  }

  private async _handleStreamingDestinationsChange(orgId: number | null) {
    this._invalidateStreamingDestinations(orgId);
    await this._publishStreamingDestinationsChange(orgId);
  }

  private _invalidateStreamingDestinations(orgId: number | null) {
    if (orgId === null) {
      this._installStreamingDestinations.clear();
    } else {
      this._orgStreamingDestinations.delete(orgId);
    }
  }

  private _initializeFormatters() {
    for (const formatter of this._options.formatters) {
      const { streamingDestinations } = formatter;
      for (const destination of streamingDestinations) {
        this._formatters.set(destination, formatter);
      }
    }
  }

  private _subscribeToStreamingDestinations() {
    this._db.on("streamingDestinationsChange", async (orgId?: number) => {
      await this._handleStreamingDestinationsChange(orgId ?? null);
    });

    if (!process.env.REDIS_URL) {
      return;
    }

    this._redisClient ??= createClient(process.env.REDIS_URL);
    this._redisClient.subscribe(this._redisChannel);
    this._redisClient.on("message", async (_, message) => {
      const { orgId } = JSON.parse(message);
      this._invalidateStreamingDestinations(orgId);
    });
    this._redisClient.on("error", async (error) => {
      this._logger.error(
        null,
        `encountered error while subscribed to channel ${this._redisChannel}`,
        error
      );
    });
  }

  private async _publishStreamingDestinationsChange(orgId: number | null) {
    if (!process.env.REDIS_URL) {
      return;
    }
    this._redisClient ??= createClient(process.env.REDIS_URL);
    try {
      await this._redisClient.publishAsync(this._redisChannel, JSON.stringify({ orgId }));
    } catch (error) {
      this._logger.error(
        null,
        `failed to publish message to channel ${this._redisChannel}`,
        {
          error,
          orgId,
        }
      );
    }
  }

  private _track(prom: Promise<any>) {
    if (!this._createdPromises) {
      throw new Error("audit logger is closed");
    }
    this._createdPromises.add(prom);
    return prom.finally(() => {
      this._createdPromises?.delete(prom);
    });
  }
}

export class LogAuditEventError extends Error {
  public name = "LogAuditEventError";
  public event?: AuditEvent;
  public errors?: Error[];

  constructor(
    message: string,
    { event, errors }: { event?: AuditEvent; errors?: Error[] } = {},
    ...params: any[]
  ) {
    super(message, ...params);

    this.event = event;
    this.errors = errors;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LogAuditEventError);
    }
  }
}

function getEventContext(
  requestOrSession: RequestOrSession
): AuditEventContext {
  const request = getRequest(requestOrSession);
  return {
    ip_address: request ? getOriginIpAddress(request) : undefined,
    user_agent: request?.headers["user-agent"] || undefined,
    session_id: getAltSessionId(requestOrSession) || undefined,
  };
}
