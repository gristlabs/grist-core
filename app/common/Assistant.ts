export interface AssistantConfig {
  type: AssistantType;
  provider: AssistantProvider;
}

export type AssistantType = "formula" | "full";

export type AssistantProvider = "OpenAI" | "Unknown" | null;
