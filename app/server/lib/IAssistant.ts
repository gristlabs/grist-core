import {
  AssistanceMessage,
  AssistanceRequest,
  AssistanceResponse,
  FormulaAssistanceContext,
} from "app/common/Assistance";
import { AssistantProvider, AssistantType } from "app/common/Assistant";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";

/**
 * An assistant can help a user do things with their document by interfacing
 * with an external LLM endpoint.
 */
export interface IAssistant {
  readonly type: AssistantType;
  readonly provider: AssistantProvider;
  /**
   * Service a request for assistance.
   */
  getAssistance(
    session: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequest
  ): Promise<AssistanceResponse>;
}

export interface AssistantOptions {
  apiKey?: string;
  completionEndpoint?: string;
  model?: string;
  longerContextModel?: string;
  maxTokens?: number;
  maxToolCalls?: number;
}

/**
 * Document-related methods for use in the implementation of assistants.
 * Somewhat ad-hoc currently.
 */
export interface AssistanceDoc extends ActiveDoc {
  /**
   * Generate a particular prompt coded in the data engine for some reason.
   * It makes python code for some tables, and starts a function body with
   * the given docstring.
   * Marked "V1" to suggest that it is a particular prompt and it would
   * be great to try variants.
   */
  assistanceSchemaPromptV1(
    session: OptDocSession,
    options: AssistanceSchemaPromptV1Context
  ): Promise<string>;
  /**
   * Some tweaks to a formula after it has been generated.
   */
  assistanceFormulaTweak(txt: string): Promise<string>;
  /**
   * Compute the existing formula and return the result along with recorded values
   * of (possibly nested) attributes of `rec`.
   * Used by AI assistance to fix an incorrect formula.
   */
  assistanceEvaluateFormula(
    options: FormulaAssistanceContext
  ): Promise<AssistanceFormulaEvaluationResult>;
}

export type AssistanceSchemaPromptGenerator = (
  options?: AssistanceSchemaPromptV1Options
) => Promise<AssistanceMessage>;

export interface AssistanceSchemaPromptV1Options {
  includeAllTables?: boolean;
  includeLookups?: boolean;
}

export interface AssistanceSchemaPromptV1Context
  extends AssistanceSchemaPromptV1Options {
  tableId: string;
  colId: string;
  docString: string;
}

interface AssistanceFormulaEvaluationResult {
  /**
   * True if an exception was raised.
   */
  error: boolean;
  /**
   * Representation of the return value or exception message.
   */
  result: string;
  /**
   * Recorded attributes of `rec` at the time of evaluation.
   * Keys may be e.g. "rec.foo.bar" for nested attributes.
   */
  attributes: Record<string, string>;
  /**
   * The code that was evaluated, without special Grist syntax.
   */
  formula: string;
}
