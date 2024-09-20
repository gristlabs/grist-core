import {AuditEvent, AuditEventName, AuditEventUser} from 'app/common/AuditEvent';
import {AuditEventProperties, IAuditLogger} from 'app/server/lib/AuditLogger';
import {getDocSessionUser} from 'app/server/lib/DocSession';
import {ILogMeta, LogMethods} from 'app/server/lib/LogMethods';
import {RequestOrSession} from 'app/server/lib/requestUtils';
import {getLogMetaFromDocSession} from 'app/server/lib/serverUtils';
import moment from 'moment-timezone';
import fetch from 'node-fetch';

interface HTTPAuditLoggerOptions {
  /**
   * The HTTP endpoint to send audit events to.
   */
  endpoint: string;
  /**
   * If set, the value to include in the `Authorization` header of each
   * request to `endpoint`.
   */
  authorizationHeader?: string;
}

const MAX_PENDING_REQUESTS = 25;

/**
 * Base class for an audit event logger that logs events by sending them to an JSON-based HTTP
 * endpoint.
 *
 * Subclasses are expected to provide a suitable `toJSON` implementation to handle serialization
 * of audit events to JSON.
 *
 * See `GristAuditLogger` for an example.
 */
export abstract class HTTPAuditLogger implements IAuditLogger {
  private _endpoint = this._options.endpoint;
  private _authorizationHeader = this._options.authorizationHeader;
  private _numPendingRequests = 0;
  private readonly _logger = new LogMethods('AuditLogger ', (requestOrSession: RequestOrSession | undefined) =>
    getLogMeta(requestOrSession));

  constructor(private _options: HTTPAuditLoggerOptions) {}

  /**
   * Logs an audit event.
   */
  public logEvent<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    event: AuditEventProperties<Name>
  ): void {
    this._logEventOrThrow(requestOrSession, event)
      .catch((e) => this._logger.error(requestOrSession, `failed to log audit event`, event, e));
  }

  /**
   * Asynchronous variant of `logEvent`.
   *
   * Throws on failure to log an event.
   */
  public async logEventAsync<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    event: AuditEventProperties<Name>
  ): Promise<void> {
    await this._logEventOrThrow(requestOrSession, event);
  }

  /**
   * Serializes an audit event to JSON.
   */
  protected abstract toJSON<Name extends AuditEventName>(event: AuditEvent<Name>): string;

  private async _logEventOrThrow<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    {event: {name, details}, timestamp}: AuditEventProperties<Name>
  ) {
    if (this._numPendingRequests === MAX_PENDING_REQUESTS) {
      throw new Error(`exceeded the maximum number of pending audit event calls (${MAX_PENDING_REQUESTS})`);
    }

    try {
      this._numPendingRequests += 1;
      const resp = await fetch(this._endpoint, {
        method: 'POST',
        headers: {
          ...(this._authorizationHeader ? {'Authorization': this._authorizationHeader} : undefined),
          'Content-Type': 'application/json',
        },
        body: this.toJSON({
          event: {
            name,
            user: getAuditEventUser(requestOrSession),
            details: details ?? null,
          },
          timestamp: timestamp ?? moment().toISOString(),
        }),
      });
      if (!resp.ok) {
        throw new Error(`received a non-200 response from ${resp.url}: ${resp.status} ${await resp.text()}`);
      }
    } finally {
      this._numPendingRequests -= 1;
    }
  }
}

function getAuditEventUser(requestOrSession: RequestOrSession): AuditEventUser | null {
  if (!requestOrSession) { return null; }

  if ('get' in requestOrSession) {
    return {
      id: requestOrSession.userId ?? null,
      email: requestOrSession.user?.loginEmail ?? null,
      name: requestOrSession.user?.name ?? null,
    };
  } else {
    const user = getDocSessionUser(requestOrSession);
    if (!user) { return null; }

    const {id, email, name} = user;
    return {id, email, name};
  }
}

function getLogMeta(requestOrSession?: RequestOrSession): ILogMeta {
  if (!requestOrSession) { return {}; }

  if ('get' in requestOrSession) {
    return {
      org: requestOrSession.org,
      email: requestOrSession.user?.loginEmail,
      userId: requestOrSession.userId,
      altSessionId: requestOrSession.altSessionId,
    };
  } else {
    return getLogMetaFromDocSession(requestOrSession);
  }
}
