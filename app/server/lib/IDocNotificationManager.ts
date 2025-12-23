import type { OptDocSession } from "app/server/lib/DocSession";
import type { GranularAccessForBundle } from "app/server/lib/GranularAccess";
import type { Express } from "express";

export interface IDocNotificationManager {
  /**
   * Initialize the home-server side of of notifications handling: endpoints for configuration,
   * and handling of queued jobs to deliver emails.
   */
  initHomeServer(app: Express): void;

  /**
   * Prepare a notification for a particular change (included into the accessControl argument).
   */
  notifySubscribers(docSession: OptDocSession, docId: string, accessControl: GranularAccessForBundle): Promise<void>;
}
