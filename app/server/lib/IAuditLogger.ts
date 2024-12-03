import {
  AuditEventAction,
  AuditEventActor,
  AuditEventContext,
  AuditEventDetails,
} from "app/server/lib/AuditEvent";
import { RequestOrSession } from "app/server/lib/sessionUtils";

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

export function createNullAuditLogger(): IAuditLogger {
  return {
    logEvent() { /* do nothing */ },
    logEventOrThrow() { return Promise.resolve(); },
    close() { return Promise.resolve(); },
  };
}
