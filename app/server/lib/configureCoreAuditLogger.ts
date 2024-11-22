import { AuditLogStreamingDestinationName } from "app/common/Config";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { GenericEventFormatter } from "app/server/lib/AuditEventFormatter";
import { AuditLogger } from "app/server/lib/AuditLogger";

export function configureCoreAuditLogger(dbManager: HomeDBManager) {
  const destinations = new Set<AuditLogStreamingDestinationName>(["other"]);

  return new AuditLogger(dbManager, {
    formatters: [new GenericEventFormatter()],
    allowDestination: ({ name }) => destinations.has(name),
  });
}
