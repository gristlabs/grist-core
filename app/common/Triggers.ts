/** A column filter entry stored by ref, so it's immune to column renames. */
export interface TriggerColumnFilter {
  colRef: number;
  filter: string; // JSON-serialized FilterSpec
}

export type NotifyWhen = "enters" | "leaves" | "updated";

export interface ConditionConfig {
  columnFilters?: TriggerColumnFilter[];
  requiredColumns?: number[];
  customExpression?: string;
  /** Parsed AST of customExpression, set by Python. */
  customExpressionParsed?: object;
  notifyWhen?: NotifyWhen;
}

/**
 * Two modes:
 * 1. Text mode: { text, parsed } — raw Python expression for advanced control.
 * 2. Config mode: { config } — structured filters evaluated directly by JS.
 */
export interface ConditionType {
  text?: string;
  parsed?: object;
  config?: ConditionConfig;
}

export interface WebhookSubscribeCollection {
  webhooks: Webhook[]
}

export interface Webhook {
  fields: WebhookFields;
}

export interface WebhookFields {
  url: string;
  authorization?: string;
  eventTypes: ("add" | "update")[];
  tableId: string;
  watchedColIds?: string[];
  enabled?: boolean;
  isReadyColumn?: string | null;
  condition?: string;
  name?: string;
  memo?: string;
}

// Union discriminated by type
export type WebhookBatchStatus = "success" | "failure" | "rejected";
export type WebhookStatus = "idle" | "sending" | "retrying" | "postponed" | "error" | "invalid";

/** Secrets for webhook stored outside the document in home db */
export interface WebHookSecret {
  url: string;
  unsubscribeKey: string;
  authorization?: string;
}

// WebhookSubscribe should be `Omit<WebhookFields, 'tableId'>` (because subscribe endpoint read
// tableId from the url) but generics are not yet supported by ts-interface-builder
export interface WebhookSubscribe {
  url: string;
  authorization?: string;
  eventTypes: ("add" | "update")[];
  watchedColIds?: string[];
  enabled?: boolean;
  condition?: string;
  isReadyColumn?: string | null;
  name?: string;
  memo?: string;
}

export interface  WebhookSummaryCollection {
  webhooks: WebhookSummary[];
}
export interface WebhookSummary {
  id: string;
  fields: {
    url: string;
    authorization?: string;
    unsubscribeKey: string;
    eventTypes: string[];
    isReadyColumn: string | null;
    tableId: string;
    watchedColIds?: string[];
    enabled: boolean;
    name: string;
    memo: string;
  },
  usage: WebhookUsage | null,
}

// Describes fields to update a webhook
export interface WebhookUpdate {
  id: string;
  fields: WebhookPatch;
}

// WebhookPatch should be `Partial<WebhookFields>` but generics are not yet supported by
// ts-interface-builder
export interface WebhookPatch {
  url?: string;
  authorization?: string;
  eventTypes?: ("add" | "update")[];
  tableId?: string;
  watchedColIds?: string[];
  enabled?: boolean;
  isReadyColumn?: string | null;
  name?: string;
  memo?: string;
}

export interface WebhookUsage {
  // As minimum we need number of waiting events and status (by default pending).
  numWaiting: number,
  status: WebhookStatus;
  updatedTime?: number | null;
  lastSuccessTime?: number | null;
  lastFailureTime?: number | null;
  lastErrorMessage?: string | null;
  lastHttpStatus?: number | null;
  lastEventBatch?: null | {
    size: number;
    errorMessage: string | null;
    httpStatus: number | null;
    status: WebhookBatchStatus;
    attempts: number;
  },
  numSuccess?: {
    pastHour: number;
    past24Hours: number;
  },
}

// Union type for trigger actions.
export type TriggerAction = WebhookAction | EmailAction;

/** Secret data extracted from an action (url, authorization, unsubscribeKey). */
export interface ActionSecretData {
  url?: string;
  authorization?: string;
  unsubscribeKey?: string;
}

export interface ActionBase {
  id: string;
  type: string;
}

/** Stored in the document — only type + homeDB secret key, no secrets inline. */
export interface WebhookAction extends ActionBase {
  type: "webhook";
}

export interface EmailAction extends ActionBase {
  type: "email";
  to: string; // Comma-separated list of email addresses, user refs.
  dynamicTo?: string; // Comma-separated col ids for dynamic recipients.
  subject: string;
  body: string;
}

/// //////////////// Checkers for the Trigger API.

/** Fields accepted when creating a new trigger. */
export interface TriggerFields {
  tableRef: number;
  label?: string;
  memo?: string;
  enabled?: boolean;
  actions?: string;
  condition?: string;
  options?: string;
}

/** Fields accepted when updating an existing trigger (all optional). */
export interface TriggerPatchFields {
  tableRef?: number;
  label?: string;
  memo?: string;
  enabled?: boolean;
  actions?: string;
  condition?: string;
  options?: string;
}

export interface TriggerAddRequest {
  records: { fields: TriggerFields }[];
}

export interface TriggerUpdateRequest {
  records: { id: number; fields: TriggerPatchFields }[];
}

export interface TriggerDeletionRequest {
  ids: number[];
}

export interface TriggerRecord {
  id: number;
  fields: TriggerFields;
}

export interface TriggerListResponse {
  records: TriggerRecord[];
}

export interface TriggerAddResponse {
  records: { id: number }[];
}
