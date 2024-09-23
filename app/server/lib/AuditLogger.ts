import {AuditEvent, AuditEventContext, AuditEventDetails, AuditEventName} from 'app/common/AuditEvent';
import {RequestOrSession} from 'app/server/lib/sessionUtils';

export interface IAuditLogger {
  /**
   * Logs an audit event.
   */
  logEvent<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ): void;
  /**
   * Logs an audit event.
   *
   * Throws a `LogAuditEventError` on failure.
   */
  logEventAsync<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    properties: AuditEventProperties<Name>
  ): Promise<void>;
}

export interface AuditEventProperties<Name extends AuditEventName> {
  event: {
    /**
     * The event name.
     */
    name: Name;
    /**
     * Additional event details.
     */
    details?: AuditEventDetails[Name];
    /**
     * The context of the event.
     */
    context?: AuditEventContext;
  };
  /**
   * ISO 8601 timestamp (e.g. `2024-09-04T14:54:50Z`) of when the event occured.
   *
   * Defaults to now.
   */
  timestamp?: string;
}

export class LogAuditEventError<Name extends AuditEventName> extends Error {
  public name = 'LogAuditEventError';

  constructor(public auditEvent: AuditEvent<Name>, ...params: any[]) {
    super(...params);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LogAuditEventError);
    }
  }
}
