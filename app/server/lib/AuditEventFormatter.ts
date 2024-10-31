import { AuditLogStreamingDestinationName } from "app/common/Config";
import { AuditEvent } from "app/server/lib/AuditEvent";

export interface AuditEventFormatter {
  streamingDestinations: AuditLogStreamingDestinationName[];
  formatEvent(event: AuditEvent): any;
}

export class GenericEventFormatter implements AuditEventFormatter {
  public streamingDestinations: AuditLogStreamingDestinationName[] = ["other"];

  public formatEvent(event: AuditEvent) {
    return event;
  }
}
