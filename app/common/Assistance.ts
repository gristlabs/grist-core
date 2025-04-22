import {DocAction} from 'app/common/DocActions';

/**
 * State related to a request for assistance.
 *
 * If an AssistanceResponse contains state, that state can be
 * echoed back in an AssistanceRequest to continue a "conversation."
 *
 * Ideally, the state should not be modified or relied upon
 * by the client, so as not to commit too hard to a particular
 * model at this time (it is a bit early for that).
 */
export interface AssistanceState {
  messages?: AssistanceMessage[];
}

export interface AssistanceMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | null;
  tool_call_id?: string;
}

export type AssistanceRequest = DocAssistanceRequest | FormulaAssistanceRequest;

/**
 * A request for document assistance.
 */
interface DocAssistanceRequest extends BaseAssistanceRequest {
  type: "doc";
  context: DocAssistanceContext;
}

/**
 * A request for formula assistance.
 */
export interface FormulaAssistanceRequest extends BaseAssistanceRequest {
  type: "formula";
  context: FormulaAssistanceContext;
}

interface BaseAssistanceRequest {
  conversationId: string;
  text: string;
  state?: AssistanceState;
}

interface DocAssistanceContext {
  viewId?: number;
}

/**
 * Currently, requests for formula assistance always happen in the context
 * of the column of a particular table.
 */
export interface FormulaAssistanceContext {
  tableId: string;
  colId: string;
  evaluateCurrentFormula?: boolean;
  rowId?: number;
}

export type AssistanceResponse =
  | FormulaAssistanceResponse
  | DocAssistanceResponse;

type DocAssistanceResponse = BaseAssistanceResponse;

export interface FormulaAssistanceResponse extends BaseAssistanceResponse {
  suggestedActions: DocAction[];
  suggestedFormula?: string;
}

/**
 * A response to a request for assistance.
 * The client should preserve the state and include it in
 * any follow-up requests.
 */
interface BaseAssistanceResponse {
  reply?: string;
  state?: AssistanceState;
  // If the model can be trusted to issue a self-contained
  // markdown-friendly string, it can be included here.
  limit?: AssistanceLimit;
}

interface AssistanceLimit {
  usage: number;
  limit: number;
}
