export interface AssistantConfig {
  provider: AssistantProvider;
  version: AssistantVersion;
}

export type AssistantProvider = "OpenAI" | "Unknown" | null;

export type AssistantVersion = 1 | 2;
