import {ApplyUAResult} from 'app/common/ActiveDocAPI';
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
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
}

export type AssistanceRequest = AssistanceRequestV1 | AssistanceRequestV2;

/**
 * A request for formula assistance.
 */
export interface AssistanceRequestV1 extends BaseAssistanceRequest {
  context: AssistanceContextV1;
}

/**
 * A request for document assistance.
 */
export interface AssistanceRequestV2 extends BaseAssistanceRequest {
  context: AssistanceContextV2;
  developerPromptVersion?: DeveloperPromptVersion;
}

export function isAssistanceRequestV2(req: AssistanceRequest): req is AssistanceRequestV2 {
  return !('tableId' in req.context);
}

export type DeveloperPromptVersion = "default" | "new-document";

interface BaseAssistanceRequest {
  conversationId: string;
  text?: string;
  state?: AssistanceState;
}

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

export interface AssistanceContextV2 {
  viewId?: number;
}

export type AssistanceResponse = AssistanceResponseV1 | AssistanceResponseV2;

export interface AssistanceResponseV1 extends BaseAssistanceResponse {
  suggestedActions: DocAction[];
  suggestedFormula?: string;
}

export interface AssistanceResponseV2 extends BaseAssistanceResponse {
  appliedActions?: ApplyUAResult[];
  confirmationRequired?: boolean;
}

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
