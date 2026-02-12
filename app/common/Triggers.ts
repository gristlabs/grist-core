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

// Union type for trigger actions. Currently only WebhookAction is supported, but this is
// designed as a discriminated union to support additional action types in the future (e.g., emails).
export type TriggerAction = WebhookAction;

export interface WebhookAction {
  // The type field is used to discriminate between different action types.
  // For now we have only webhook, but next types in the pipeline are emails.
  type: "webhook";
  id: string; // Unique id of the action, used as a key in homeDB secrets for webhooks
}
