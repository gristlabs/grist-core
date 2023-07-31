export interface WebhookSubscribeCollection{
  webhooks: Array<Webhook>
}

export interface Webhook {
  fields: WebhookFields;
}

export interface WebhookFields {
  url: string;
  eventTypes: Array<"add"|"update">;
  tableId: string;
  enabled?: boolean;
  isReadyColumn?: string|null;
  name?: string;
  memo?: string;
}

// Union discriminated by type
export type WebhookBatchStatus = 'success'|'failure'|'rejected';
export type WebhookStatus = 'idle'|'sending'|'retrying'|'postponed'|'error'|'invalid';


// WebhookSubscribe should be `Omit<WebhookFields, 'tableId'>` (because subscribe endpoint read
// tableId from the url) but generics are not yet supported by ts-interface-builder
export interface WebhookSubscribe {
  url: string;
  eventTypes: Array<"add"|"update">;
  enabled?: boolean;
  isReadyColumn?: string|null;
  name?: string;
  memo?: string;
}


export interface  WebhookSummaryCollection {
  webhooks: Array<WebhookSummary>;
}
export interface WebhookSummary {
  id: string;
  fields: {
    url: string;
    unsubscribeKey: string;
    eventTypes: string[];
    isReadyColumn: string|null;
    tableId: string;
    enabled: boolean;
    name: string;
    memo: string;
  },
  usage: WebhookUsage|null,
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
  eventTypes?: Array<"add"|"update">;
  tableId?: string;
  enabled?: boolean;
  isReadyColumn?: string|null;
  name?: string;
  memo?: string;
}


export interface WebhookUsage {
  // As minimum we need number of waiting events and status (by default pending).
  numWaiting: number,
  status: WebhookStatus;
  updatedTime?: number|null;
  lastSuccessTime?: number|null;
  lastFailureTime?: number|null;
  lastErrorMessage?: string|null;
  lastHttpStatus?: number|null;
  lastEventBatch?: null | {
    size: number;
    errorMessage: string|null;
    httpStatus: number|null;
    status: WebhookBatchStatus;
    attempts: number;
  },
  numSuccess?: {
    pastHour: number;
    past24Hours: number;
  },
}
