export interface AuditEvent<Name extends AuditEventName> {
  event: {
    /** The event name. */
    name: Name;
    /** The user that triggered the event. */
    user: AuditEventUser | null;
    /** Additional event details. */
    details: AuditEventDetails[Name] | null;
  };
  /** ISO 8601 timestamp of when the event was logged. */
  timestamp: string;
}

export type AuditEventName =
  | 'createDocument';

export interface AuditEventUser {
  /** The user's id. */
  id: number | null;
  /** The user's email address. */
  email: string | null;
  /** The user's name. */
  name: string | null;
}

export interface AuditEventDetails {
  createDocument: {
    /** The ID of the document. */
    id: string;
  };
}
