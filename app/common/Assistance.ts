import { ApplyUAResult } from "app/common/ActiveDocAPI";
import { DocAction } from "app/common/DocActions";
import { StringUnion } from "app/common/StringUnion";

import findLastIndex from "lodash/findLastIndex";
import truncate from "lodash/truncate";

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
  requestId?: string;
  /**
   * If set, the response stops short of any tool call that needs the user's approval, and
   * returns it as `pendingApproval` instead of running it. The turn continues once the answer
   * is sent back in `approvals`, along with the response's `state`.
   */
  promptForApproval?: boolean;
}

/** A message from the user to the document assistant. */
export interface AssistanceUserRequestV2 extends BaseAssistanceRequestV2 {
  text: string;
  state?: AssistanceState;
}

/**
 * Brings back the answers of the tools that ran in the browser, or the user's answers to the tool
 * calls that needed their approval, so the model can finish the same reply. It has no text.
 */
export interface AssistanceToolRequestV2 extends BaseAssistanceRequestV2 {
  state: AssistanceState;
  approvals?: AssistanceToolApproval[];
}

/**
 * A request for document assistance.
 */
export type AssistanceRequestV2 = AssistanceUserRequestV2 | AssistanceToolRequestV2;

/**
 * The user's answer to a tool call that needed their approval.
 */
export interface AssistanceToolApproval {
  toolCallId: string;
  approved: boolean;
}

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

/**
 * Returns true if `req` carries the user's answers to tool calls awaiting their approval.
 */
export function hasApprovals(req: AssistanceRequest): req is AssistanceToolRequestV2 {
  return isToolRequest(req) && Boolean(req.approvals?.length);
}

/** The tool calls of the last model message that have no answer yet. */
export function getUnansweredToolCalls(state: AssistanceState | undefined): AssistanceToolCall[] {
  const messages = state?.messages ?? [];
  const lastIndex = findLastIndex(messages, message => message.role === "assistant");
  const answered = new Set(messages.slice(lastIndex + 1).map(message => message.tool_call_id));
  return (messages[lastIndex]?.tool_calls ?? []).filter(call => !answered.has(call.id));
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
  /** Id of the run that produced this response. Matches the `runId` of its trace events. */
  runId?: string;
  /**
   * A tool call that needs the user's approval before it runs. Set when the turn stopped short,
   * in which case there is no reply.
   */
  pendingApproval?: AssistancePendingApproval;
}

/**
 * A tool call awaiting the user's approval, with its arguments as JSON.
 */
export interface AssistancePendingApproval {
  toolCallId: string;
  toolName: string;
  argsText: string;
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

/**
 * A step of a request for document assistance (e.g. a tool call), sent to the client that made
 * the request while it's in progress.
 *
 * Events include the `requestId` of their request. Clients ignore events for requests other than
 * the current request (e.g. cancelled requests).
 *
 * Events of the same run also share a `runId`. A request that's retried (e.g. after the document
 * is forked) is a new run, so the client can tell when to discard events of the earlier one.
 */
export type AssistanceTraceEvent = {
  conversationId: string;
  requestId?: string;
  runId: string;
} & AssistanceTraceEventPayload;

/**
 * An {@link AssistanceTraceEvent} without the ids of its conversation, request, and run.
 */
export type AssistanceTraceEventPayload =
  AssistanceTraceText |
  AssistanceTraceToolCall |
  AssistanceTraceToolResult;

/**
 * Text the model replied with alongside its tool calls (e.g. "Let me look at the tables.").
 */
export interface AssistanceTraceText {
  type: "text";
  text: string;
}

/**
 * A tool call, sent before the tool is run. `argsText` is the call's arguments as JSON, cut short
 * if `argsTruncated` is set.
 */
export interface AssistanceTraceToolCall {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  argsText: string;
  argsTruncated?: boolean;
}

/**
 * The result of a tool call, sent once the tool has run. `resultText` is the result as JSON, cut
 * short if `resultTruncated` is set.
 */
export interface AssistanceTraceToolResult {
  type: "tool-result";
  toolCallId: string;
  ok: boolean;
  resultText: string;
  resultTruncated?: boolean;
}

/** Maximum length of a tool call's `argsText`. Longer arguments are truncated. */
export const MAX_TRACE_ARGS_CHARS = 1024;

/** Maximum length of a tool call's `resultText`. Longer results are truncated. */
export const MAX_TRACE_RESULT_CHARS = 4096;

/**
 * Returns `text` truncated to at most `limit` characters, along with `true` if it was truncated.
 */
export function truncateTraceText(text: string, limit: number): [string, boolean | undefined] {
  const truncated = truncate(text, { length: limit, omission: "" });
  return [truncated, truncated !== text || undefined];
}
