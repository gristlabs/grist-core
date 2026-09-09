import { ApplyUAResult } from "app/common/ActiveDocAPI";
import { DocAction } from "app/common/DocActions";
import { StringUnion } from "app/common/StringUnion";

/**
 * State related to a request for assistance.
 *
 * If an AssistanceResponse contains state, that state can be
 * echoed back in an AssistanceRequest to continue a "conversation."
 *
 * The messages are in the OpenAI chat format. When the last model message has tool calls
 * without an answer, they are for the browser: it answers them and sends the state back,
 * without text, so the server goes on with the same turn.
 *
 * TODO: Keep the conversation in Redis, under the conversation id, instead of sending it to the
 * client. The client gets every message, also the results of the tools that ran on the server.
 * Today the tools return only what the user can see, but a new tool could easily return more.
 */
export interface AssistanceState {
  messages?: AssistanceMessage[];
}

/** One message of the conversation, in the OpenAI chat format. */
export interface AssistanceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: AssistanceToolCall[];
}

/** A tool the model calls, with its arguments as a JSON string. */
export interface AssistanceToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/** What every request has. */
interface BaseAssistanceRequest {
  conversationId: string;
}

/**
 * A request for formula assistance.
 */
export interface AssistanceRequestV1 extends BaseAssistanceRequest {
  context: AssistanceContextV1;
  text?: string;
  state?: AssistanceState;
}

/** What every request to the document assistant has. */
interface BaseAssistanceRequestV2 extends BaseAssistanceRequest {
  context: AssistanceContextV2;
  developerPromptVersion?: DeveloperPromptVersion;
}

/** A message from the user to the document assistant. */
export interface AssistanceUserRequestV2 extends BaseAssistanceRequestV2 {
  text: string;
  state?: AssistanceState;
}

/**
 * Brings back the answers of the tools that ran in the browser, so the model can finish the same
 * reply. It has no text.
 */
export interface AssistanceToolRequestV2 extends BaseAssistanceRequestV2 {
  state: AssistanceState;
}

/**
 * A request for document assistance.
 */
export type AssistanceRequestV2 = AssistanceUserRequestV2 | AssistanceToolRequestV2;

/** A request for document assistance without its context, which the client adds: what the user has open. */
export type AssistantDraftRequest =
  Omit<AssistanceUserRequestV2, "context"> | Omit<AssistanceToolRequestV2, "context">;

/**
 * A request for assistance. Both assistants get requests the same way; the server answers only
 * the requests of the assistant it runs: the formula assistant (V1) or the document assistant (V2).
 */
export type AssistanceRequest = AssistanceRequestV1 | AssistanceRequestV2;

/** Tells the two assistants apart: only a request for formula assistance has a table in its context. */
export function isAssistanceRequestV2(req: AssistanceRequest): req is AssistanceRequestV2 {
  return !("tableId" in req.context);
}

/** Whether the request brings back the answers of the browser tools, and not a message from the user. */
export function isToolRequest(req: AssistanceRequest): req is AssistanceToolRequestV2 {
  return isAssistanceRequestV2(req) && !("text" in req);
}

/** Which system prompt the document assistant starts with, for example for a new document. */
export const DeveloperPromptVersion = StringUnion(
  "default",
  "new-document",
  "new-document-no-intro",
);
export type DeveloperPromptVersion = typeof DeveloperPromptVersion.type;

/**
 * Currently, requests for formula assistance always happen in the context
 * of the column of a particular table.
 */
export interface AssistanceContextV1 {
  tableId: string;
  colId: string;
  evaluateCurrentFormula?: boolean;
  rowId?: number;
  specificInstructions?: string;
}

/** What the user has open when they write to the document assistant. */
export interface AssistanceContextV2 {
  viewId?: number;
  activeSectionId?: number;
}

/** A response from either assistant. */
export type AssistanceResponse = AssistanceResponseV1 | AssistanceResponseV2;

/** A formula the formula assistant suggests, and the actions that apply it. */
export interface AssistanceResponseV1 extends BaseAssistanceResponse {
  suggestedActions: DocAction[];
  suggestedFormula?: string;
}

/** The reply of the document assistant, and the changes it made to the document. */
export interface AssistanceResponseV2 extends BaseAssistanceResponse {
  appliedActions?: ApplyUAResult[];
  confirmationRequired?: boolean;
}

/** Widget Creator tools the browser runs, on its open editor, when called with `draft: true`. */
export const CreatorBrowserToolName = StringUnion("get_creator_html", "set_creator_html");
export type CreatorBrowserToolName = typeof CreatorBrowserToolName.type;

/**
 * A response to a request for assistance.
 * The client should preserve the state and include it in
 * any follow-up requests.
 */
interface BaseAssistanceResponse {
  /**
   * If the model can be trusted to issue a self-contained
   * markdown-friendly string, it can be included here.
   */
  reply?: string;
  state?: AssistanceState;
  limit?: AssistanceLimit;
}

interface AssistanceLimit {
  usage: number;
  limit: number;
}
