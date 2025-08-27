import { ApiError } from "app/common/ApiError";
import { AssistanceState, DeveloperPromptVersion } from "app/common/Assistance";

/**
 * The state of assistance.
 * ChatMessages are what are shown in the UI, whereas state is
 * how the back-end represents the conversation. The two are
 * similar but not the same because of post-processing.
 * It may be possible to reconcile them when things settle down
 * a bit?
 */
export interface ChatHistory {
  messages: ChatMessage[];
  conversationId?: string;
  state?: AssistanceState;
  developerPromptVersion?: DeveloperPromptVersion;
}

/**
 * A chat message. Either sent by the user or by the AI.
 */
export interface ChatMessage {
  /**
   * The message to display. It is a prompt typed by the user or a completion returned from the AI.
   */
  message: string;
  /**
   * The sender of the message. Either the user or the AI.
   */
  sender: "user" | "ai";
  /**
   * Error response from the AI, if any.
   */
  error?: ApiError;
  /**
   * The formula returned from the AI. It is only set when the sender is the AI.
   *
   * Only used by version 1 of the AI assistant.
   */
  formula?: string | null;
  /**
   * Suggested actions returned from the AI.
   *
   * Only used by version 1 of the AI assistant.
   */
  action?: any;
}
