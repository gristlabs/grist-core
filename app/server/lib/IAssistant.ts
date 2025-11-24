import { ApplyUAResult } from "app/common/ActiveDocAPI";
import {
  AssistanceContextV1,
  AssistanceMessage,
  AssistanceRequestV1,
  AssistanceRequestV2,
  AssistanceResponseV1,
  AssistanceResponseV2,
  AssistanceState,
} from "app/common/Assistance";
import { AssistantProvider } from "app/common/Assistant";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { OptDocSession } from "app/server/lib/DocSession";
import * as express from "express";

/**
 * An assistant can help a user do things with their document by interfacing
 * with an external LLM endpoint.
 */
export type IAssistant = AssistantV1 | AssistantV2;

export interface AssistantV1 {
  readonly provider: AssistantProvider;
  readonly version: 1;
  /**
   * Service a request for assistance.
   */
  getAssistance(
    session: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequestV1
  ): Promise<AssistanceResponseV1>;
}

export interface AssistantV2 {
  readonly provider: AssistantProvider;
  readonly version: 2;
  /**
   * Service a request for assistance.
   */
  getAssistance(
    session: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequestV2
  ): Promise<AssistanceResponseV2>;
  addEndpoints?(app: express.Express): void;
  onFirstVisit?(req: express.Request, res: Express.Response): Promise<void>;
}

export interface AssistantV1Options {
  apiKey?: string;
  completionEndpoint?: string;
  model?: string;
  longerContextModel?: string;
  maxTokens?: number;
}

export interface AssistantV2Options extends AssistantV1Options {
  maxToolCalls?: number;
  structuredOutput?: boolean;
}

export function isAssistantV2(assistant: IAssistant): assistant is AssistantV2 {
  return assistant.version === 2;
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
   *
   * Only used by version 1 of the AI assistant.
   */
  assistanceFormulaTweak(txt: string): Promise<string>;
  /**
   * Compute the existing formula and return the result along with recorded values
   * of (possibly nested) attributes of `rec`.
   * Used by AI assistance to fix an incorrect formula.
   *
   * Only used by version 1 of the AI assistant.
   */
  assistanceEvaluateFormula(
    options: AssistanceContextV1
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
}

export interface AssistanceFormulaEvaluationResult {
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

export interface OpenAIChatCompletion {
  choice: {
    message: {
      content: string | null;
      refusal?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  };
  state: AssistanceState;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type OpenAITool = OpenAIFunction;

interface OpenAIFunction {
  type: "function";
  function: {
    /**
     * The function's name (e.g. `get_weather`).
     */
    name: string;
    /**
     * Details on when and how to use the function.
     */
    description?: string;
    /**
     * JSON schema defining the function's input arguments.
     */
    parameters?: JSONSchema;
    /**
     * Whether to enforce strict mode for the function call.
     *
     * https://platform.openai.com/docs/guides/function-calling?api-mode=responses#strict-mode.
     */
    strict?: boolean;
  };
}

/**
 * Subset of JSON Schema supported by OpenAI for Structured Outputs.
 *
 * https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#supported-schemas
 */
interface JSONSchema {
  /**
   * The property types(s) (e.g. `"string"`, `"null"`, `"array"`).
   */
  type?: string | string[];
  /**
   * Description of the property.
   */
  description?: string;
  /**
   * Minimum value for numeric properties.
   */
  minimum?: number;
  /**
   * Maximum value for numeric properties.
   */
  maximum?: number;
  /**
   * Allowed values (e.g. `["error", "warning"]`).
   */
  enum?: any[];
  /**
   * Schema for array items.
   *
   * Required if `type` is `"array"`.
   */
  items?: JSONSchema;
  /**
   * Schema for sub-properties.
   */
  properties?: Record<string, JSONSchema>;
  /**
   * Names of required sub-properties.
   *
   * Required if `type` is `"object"`.
   */
  required?: string[];
  /**
   * Whether to allow properties not listed in `properties`.
   */
  additionalProperties?: boolean;
}

interface BaseFunctionCallResult {
  appliedActions: ApplyUAResult[];
}

export interface FunctionCallSuccess extends BaseFunctionCallResult {
  ok: true;
  result: any;
}

interface FunctionCallFailure extends BaseFunctionCallResult {
  ok: false;
  error: string;
}

export type FunctionCallResult = FunctionCallSuccess | FunctionCallFailure;
