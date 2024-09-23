import {AuditEvent, AuditEventName, AuditEventSource, AuditEventUser} from 'app/common/AuditEvent';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {AuditEventProperties, IAuditLogger, LogAuditEventError} from 'app/server/lib/AuditLogger';
import {LogMethods} from 'app/server/lib/LogMethods';
import {getOriginIpAddress} from 'app/server/lib/requestUtils';
import {
  getAltSessionId,
  getFullUser,
  getLogMeta,
  getOrg,
  getRequest,
  RequestOrSession,
} from 'app/server/lib/sessionUtils';
import moment from 'moment-timezone';
import fetch from 'node-fetch';
import {inspect} from 'util';

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
  private _numPendingRequests = 0;
  private readonly _endpoint = this._options.endpoint;
  private readonly _authorizationHeader = this._options.authorizationHeader;
  private readonly _logger = new LogMethods<RequestOrSession | undefined>('AuditLogger ', (requestOrSession) =>
    getLogMeta(requestOrSession));

  constructor(private _db: HomeDBManager, private _options: HTTPAuditLoggerOptions) {}

  /**
   * Logs an audit event.
   */
  public logEvent<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ): void {
    this._logEventOrThrow(requestOrSession, properties)
      .catch((e) => {
        this._logger.error(requestOrSession, `failed to log audit event`, e);
        this._logger.warn(requestOrSession, 'skipping audit event ', inspect(e.auditEvent, {
          depth: Infinity,
        }));
      });
  }

  /**
   * Logs an audit event.
   *
   * Throws a LogAuditEventError on failure.
   */
  public async logEventAsync<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ): Promise<void> {
    await this._logEventOrThrow(requestOrSession, properties);
  }

  /**
   * Serializes an audit event to JSON.
   */
  protected abstract toJSON<Name extends AuditEventName>(event: AuditEvent<Name>): string;

  private async _logEventOrThrow<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ) {
    const event: AuditEvent<Name> = this._buildAuditEvent(requestOrSession, properties);
    if (this._numPendingRequests === MAX_PENDING_REQUESTS) {
      throw new LogAuditEventError(
        event,
        `exceeded the maximum number of pending audit event calls (${MAX_PENDING_REQUESTS})`
      );
    }

    try {
      this._numPendingRequests += 1;
      const resp = await fetch(this._endpoint, {
        method: 'POST',
        headers: {
          ...(this._authorizationHeader ? {'Authorization': this._authorizationHeader} : undefined),
          'Content-Type': 'application/json',
        },
        body: this.toJSON(event),
      });
      if (!resp.ok) {
        throw new Error(`received a non-200 response from ${resp.url}: ${resp.status} ${await resp.text()}`);
      }
    } catch (e) {
      throw new LogAuditEventError(
        event,
        e?.message ?? `failed to POST audit event to ${this._endpoint}`,
        {cause: e}
      );
    } finally {
      this._numPendingRequests -= 1;
    }
  }

  private _buildAuditEvent<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ): AuditEvent<Name> {
    const {event: {name, details = {}, context = {}}, timestamp = moment().toISOString()} = properties;
    return {
      event: {
        name,
        user: this._getAuditEventUser(requestOrSession),
        details,
        context,
        source: getAuditEventSource(requestOrSession),
      },
      timestamp,
    };
  }

  private _getAuditEventUser(requestOrSession: RequestOrSession): AuditEventUser {
    const user = getFullUser(requestOrSession);
    if (!user) {
      return {type: 'unknown'};
    } else if (user.id === this._db.getAnonymousUserId()) {
      return {type: 'anonymous'};
    } else {
      const {id, email, name} = user;
      return {type: 'user', id, email, name};
    }
  }
}

function getAuditEventSource(requestOrSession: RequestOrSession): AuditEventSource {
  const request = getRequest(requestOrSession);
  return {
    org: getOrg(requestOrSession) || undefined,
    ipAddress: request ? getOriginIpAddress(request) : undefined,
    userAgent: request?.headers['user-agent'] || undefined,
    sessionId: getAltSessionId(requestOrSession) || undefined,
  };
}
