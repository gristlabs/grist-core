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
  role: string;
  content: string;
}

/**
 * Currently, requests for assistance always happen in the context
 * of the column of a particular table.
 */
export interface FormulaAssistanceContext {
  type: 'formula';
  tableId: string;
  colId: string;
  evaluateCurrentFormula?: boolean;
  rowId?: number;
}

export type AssistanceContext = FormulaAssistanceContext;

/**
 * A request for assistance.
 */
export interface AssistanceRequest {
  conversationId: string;
  context: AssistanceContext;
  state?: AssistanceState;
  text: string;
}

/**
 * A response to a request for assistance.
 * The client should preserve the state and include it in
 * any follow-up requests.
 */
export interface AssistanceResponse {
  suggestedActions: DocAction[];
  suggestedFormula?: string;
  state?: AssistanceState;
  // If the model can be trusted to issue a self-contained
  // markdown-friendly string, it can be included here.
  reply?: string;
  limit?: AssistanceLimit;
}

export interface AssistanceLimit {
  usage: number;
  limit: number;
}
