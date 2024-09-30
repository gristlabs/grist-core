import {AuditEvent, AuditEventContext, AuditEventDetails, AuditEventName, AuditEventUser} from 'app/common/AuditEvent';
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
     * The name of the event.
     */
    name: Name;
    /**
     * Event-specific details (e.g. properties of affected resources).
     */
    details?: AuditEventDetails[Name];
    /**
     * The context that the event occurred in (e.g. workspace, document).
     */
    context?: AuditEventContext;
    /**
     * The user that triggered the event.
     */
    user?: AuditEventUser;
  };
  /**
   * ISO 8601 timestamp (e.g. `2024-09-04T14:54:50Z`) of when the event occurred.
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
