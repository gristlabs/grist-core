export interface WebhookFields {
  url: string;
  eventTypes: Array<"add"|"update">;
  tableId: string;
  enabled?: boolean;
  isReadyColumn?: string|null;
}

// WebhookSubscribe should be `Omit<WebhookFields, 'tableId'>` (because subscribe endpoint read
// tableId from the url) but generics are not yet supported by ts-interface-builder
export interface WebhookSubscribe {
  url: string;
  eventTypes: Array<"add"|"update">;
  enabled?: boolean;
  isReadyColumn?: string|null;
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
}
