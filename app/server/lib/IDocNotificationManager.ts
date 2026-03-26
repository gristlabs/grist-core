import { EmailActionPayload } from "app/server/lib/WebhookQueue";

import type { Proposal } from "app/common/UserAPI";
import type { OptDocSession } from "app/server/lib/DocSession";
import type { GranularAccessForBundle } from "app/server/lib/GranularAccess";
import type { Express } from "express";

/** The data for a delivery event — provided by the caller. */
export interface DeliveryData {
  /** Opaque id tying this entry back to the enqueued trigger action. */
  actionId: string;
  /** "webhook" or "email" — matches the trigger action type. */
  actionType: string;
  /** Where it was sent: webhook URL host or email address. */
  destination: string;
  /** Row ids included in this delivery (webhooks batch, emails are per-row). */
  rowIds: number[];
  status: "success" | "failed" | "rejected";
  /** HTTP status code for webhooks; null for emails. */
  httpStatus: number | null;
  errorMessage: string;
}

/** A tuple of [docId, deliveryData] for batch logging. */
export type DeliveryLog = [string, DeliveryData];

/** A stored delivery log entry — DeliveryData plus system-assigned fields. */
export interface DeliveryLogEntry extends DeliveryData {
  id: number;
  timestamp: number;
}

/** A pending item waiting in a queue (webhook or email). */
export interface PendingItem {
  actionId: string;      // ties back to trigger action in doc metadata
  actionType: string;    // "webhook" or "email"
  rowId: number;
  destination: string;   // webhook host or email address
  status: string;        // "queued", "retrying", etc.
  lastResult: string;    // last error message if any
}

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

  /**
   * Prepare a notification for a particular suggestion.
   */
  notifySubscribersOfSuggestion(docId: string, proposal: Proposal): Promise<void>;
  /**
   * Process row-level notifications (emails) for a document.
   */
  rowNotification(docId: string, actions: EmailActionPayload[]): Promise<void>;

  /** Log delivery events (success, failure, or rejection). */
  logDelivery(entries: DeliveryLog[]): Promise<void>;

  /** Read delivery log entries for a document. */
  getDeliveryLog(docId: string): Promise<DeliveryLogEntry[]>;

  /** Return pending email delivery items for a document. */
  getPendingItems(docId: string): Promise<PendingItem[]>;

  /** Clean up resources (e.g. Redis connections). */
  shutdown(): void;
}
