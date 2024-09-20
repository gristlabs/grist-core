import {AuditEventDetails, AuditEventName} from 'app/common/AuditEvent';
import {RequestOrSession} from 'app/server/lib/requestUtils';

export interface IAuditLogger {
  /**
   * Logs an audit event.
   */
  logEvent<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    props: AuditEventProperties<Name>
  ): void;
  /**
   * Asynchronous variant of `logEvent`.
   *
   * Throws on failure to log an event.
   */
  logEventAsync<Name extends AuditEventName>(
    requestOrSession: RequestOrSession,
    props: AuditEventProperties<Name>
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
  };
  /**
   * ISO 8601 timestamp (e.g. `2024-09-04T14:54:50Z`) of when the event occured.
   *
   * Defaults to now.
   */
  timestamp?: string;
}
