/**
 * Module with functions used for AI formula assistance.
 */

import {
  AssistanceContext,
  AssistanceMessage,
  AssistanceRequest,
  AssistanceResponse
} from 'app/common/AssistancePrompts';
import {delay} from 'app/common/delay';
import {DocAction} from 'app/common/DocActions';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {getDocSessionUser, OptDocSession} from 'app/server/lib/DocSession';
import log from 'app/server/lib/log';
import fetch from 'node-fetch';
import {createHash} from "crypto";
import {getLogMetaFromDocSession} from "./serverUtils";

// These are mocked/replaced in tests.
// fetch is also replacing in the runCompletion script to add caching.
export const DEPS = { fetch, delayTime: 1000 };

/**
 * An assistant can help a user do things with their document,
 * by interfacing with an external LLM endpoint.
 */
interface Assistant {
  apply(session: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse>;
}

/**
 * Document-related methods for use in the implementation of assistants.
 * Somewhat ad-hoc currently.
 */
interface AssistanceDoc extends ActiveDoc {
  /**
   * Generate a particular prompt coded in the data engine for some reason.
   * It makes python code for some tables, and starts a function body with
   * the given docstring.
   * Marked "V1" to suggest that it is a particular prompt and it would
   * be great to try variants.
   */
  assistanceSchemaPromptV1(session: OptDocSession, options: AssistanceSchemaPromptV1Context): Promise<string>;

  /**
   * Some tweaks to a formula after it has been generated.
   */
  assistanceFormulaTweak(txt: string): Promise<string>;

  /**
   * Compute the existing formula and return the result along with recorded values
   * of (possibly nested) attributes of `rec`.
   * Used by AI assistance to fix an incorrect formula.
   */
  assistanceEvaluateFormula(options: AssistanceContext): Promise<AssistanceFormulaEvaluationResult>;
}

export interface AssistanceFormulaEvaluationResult {
  error: boolean;  // true if an exception was raised
  result: string;  // repr of the return value OR exception message

  // Recorded attributes of `rec` at the time of evaluation.
  // Keys may be e.g. "rec.foo.bar" for nested attributes.
  attributes: Record<string, string>;

  formula: string;  // the code that was evaluated, without special grist syntax
}

export interface AssistanceSchemaPromptV1Options {
  includeAllTables?: boolean;
  includeLookups?: boolean;
}

export interface AssistanceSchemaPromptV1Context extends AssistanceSchemaPromptV1Options {
  tableId: string;
  colId: string;
  docString: string;
}

type AssistanceSchemaPromptGenerator = (options?: AssistanceSchemaPromptV1Options) => Promise<AssistanceMessage>;

class NonRetryableError extends Error {
}

class TokensExceededError extends NonRetryableError {
}

class TokensExceededFirstMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
      "You'll need to either shorten your message or delete some columns."
    );
  }
}

class TokensExceededLaterMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
      "You'll need to either shorten your message, restart the conversation, or delete some columns."
    );
  }
}

class QuotaExceededError extends NonRetryableError {
  constructor() {
    super(
      "Sorry, the assistant is facing some long term capacity issues. " +
      "Maybe try again tomorrow."
    );
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(
      "Sorry, the assistant is unavailable right now. " +
      "Try again in a few minutes. \n" +
      `(${message})`
    );
  }
}

/**
 * A flavor of assistant for use with the OpenAI chat completion endpoint
 * and tools with a compatible endpoint (e.g. llama-cpp-python).
 * Tested primarily with gpt-3.5-turbo.
 *
 * Uses the ASSISTANT_CHAT_COMPLETION_ENDPOINT endpoint if set, else
 * an OpenAI endpoint. Passes ASSISTANT_API_KEY or OPENAI_API_KEY in
 * a header if set. An api key is required for the default OpenAI
 * endpoint.
 *
 * If a model string is set in ASSISTANT_MODEL, this will be passed
 * along. For the default OpenAI endpoint, a gpt-3.5-turbo variant
 * will be set by default.
 *
 * If a request fails because of context length limitation, and the
 * default OpenAI endpoint is in use, the request will be retried
 * with ASSISTANT_LONGER_CONTEXT_MODEL (another gpt-3.5
 * variant by default). Set this variable to "" if this behavior is
 * not desired for the default OpenAI endpoint. If a custom endpoint was
 * provided, this behavior will only happen if
 * ASSISTANT_LONGER_CONTEXT_MODEL is explicitly set.
 *
 * An optional ASSISTANT_MAX_TOKENS can be specified.
 */
export class OpenAIAssistant implements Assistant {
  public static DEFAULT_MODEL = "gpt-3.5-turbo-0613";
  public static DEFAULT_LONGER_CONTEXT_MODEL = "gpt-3.5-turbo-16k-0613";

  private _apiKey?: string;
  private _model?: string;
  private _longerContextModel?: string;
  private _endpoint: string;
  private _maxTokens = process.env.ASSISTANT_MAX_TOKENS ?
      parseInt(process.env.ASSISTANT_MAX_TOKENS, 10) : undefined;

  public constructor() {
    const apiKey = process.env.ASSISTANT_API_KEY || process.env.OPENAI_API_KEY;
    const endpoint = process.env.ASSISTANT_CHAT_COMPLETION_ENDPOINT;
    if (!apiKey && !endpoint) {
      throw new Error('Please set either OPENAI_API_KEY or ASSISTANT_CHAT_COMPLETION_ENDPOINT');
    }
    this._apiKey = apiKey;
    this._model = process.env.ASSISTANT_MODEL;
    this._longerContextModel = process.env.ASSISTANT_LONGER_CONTEXT_MODEL;
    if (!endpoint) {
      this._model = this._model ?? OpenAIAssistant.DEFAULT_MODEL;
      this._longerContextModel = this._longerContextModel ?? OpenAIAssistant.DEFAULT_LONGER_CONTEXT_MODEL;
    }
    this._endpoint = endpoint || `https://api.openai.com/v1/chat/completions`;
  }

  public async apply(
    optSession: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest
  ): Promise<AssistanceResponse> {
    const generatePrompt = this._buildSchemaPromptGenerator(optSession, doc, request);
    const messages = request.state?.messages || [];
    const newMessages: AssistanceMessage[] = [];
    if (messages.length === 0) {
      newMessages.push(await generatePrompt());
    }
    if (request.context.evaluateCurrentFormula) {
      const result = await doc.assistanceEvaluateFormula(request.context);
      let message = "Evaluating this code:\n\n```python\n" + result.formula + "\n```\n\n";
      if (Object.keys(result.attributes).length > 0) {
        const attributes = Object.entries(result.attributes).map(([k, v]) => `${k} = ${v}`).join('\n');
        message += `where:\n\n${attributes}\n\n`;
      }
      message += `${result.error ? 'raises an exception' : 'returns'}: ${result.result}`;
      newMessages.push({
        role: 'system',
        content: message,
      });
    }
    newMessages.push({
      role: 'user', content: request.text,
    });
    messages.push(...newMessages);

    const newMessagesStartIndex = messages.length - newMessages.length;
    for (const [index, {role, content}] of newMessages.entries()) {
      doc.logTelemetryEvent(optSession, 'assistantSend', {
        full: {
          conversationId: request.conversationId,
          context: request.context,
          prompt: {
            index: newMessagesStartIndex + index,
            role,
            content,
          },
        },
      });
    }

    const completion = await this._getCompletion(messages, {
      generatePrompt,
      user: getUserHash(optSession),
    });
    messages.push({role: 'assistant', content: completion});

    // It's nice to have this ready to uncomment for debugging.
    // console.log(completion);

    const response = await completionToResponse(doc, request, completion);
    if (response.suggestedFormula) {
      // Show the tweaked version of the suggested formula to the user (i.e. the one that's
      // copied when the Apply button is clicked).
      response.reply = replaceMarkdownCode(completion, response.suggestedFormula);
    } else {
      response.reply = completion;
    }
    response.state = {messages};
    doc.logTelemetryEvent(optSession, 'assistantReceive', {
      full: {
        conversationId: request.conversationId,
        context: request.context,
        message: {
          index: messages.length - 1,
          content: completion,
        },
        suggestedFormula: response.suggestedFormula,
      },
    });
    return response;
  }

  private async _fetchCompletion(messages: AssistanceMessage[], params: {user: string, model?: string}) {
    const {user, model} = params;
    const apiResponse = await DEPS.fetch(
      this._endpoint,
      {
        method: "POST",
        headers: {
          ...(this._apiKey ? {
            "Authorization": `Bearer ${this._apiKey}`,
          } : undefined),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          temperature: 0,
          ...(model ? { model } : undefined),
          user,
          ...(this._maxTokens ? {
            max_tokens: this._maxTokens,
          } : undefined),
        }),
      },
    );
    const resultText = await apiResponse.text();
    const result = JSON.parse(resultText);
    const errorCode = result.error?.code;
    const errorMessage = result.error?.message;
    if (errorCode === "context_length_exceeded" || result.choices?.[0].finish_reason === "length") {
      log.warn("OpenAI context length exceeded: ", errorMessage);
      if (messages.length <= 2) {
        throw new TokensExceededFirstMessageError();
      } else {
        throw new TokensExceededLaterMessageError();
      }
    }
    if (errorCode === "insufficient_quota") {
      log.error("OpenAI billing quota exceeded!!!");
      throw new QuotaExceededError();
    }
    if (apiResponse.status !== 200) {
      throw new Error(`OpenAI API returned status ${apiResponse.status}: ${resultText}`);
    }
    return result.choices[0].message.content;
  }

  private async _fetchCompletionWithRetries(messages: AssistanceMessage[], params: {
    user: string,
    model?: string,
  }): Promise<any> {
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        return await this._fetchCompletion(messages, params);
      } catch (e) {
        if (e instanceof NonRetryableError) {
          throw e;
        }

        attempts += 1;
        if (attempts === maxAttempts) {
          throw new RetryableError(e.toString());
        }

        log.warn(`Waiting and then retrying after error: ${e}`);
        await delay(DEPS.delayTime);
      }
    }
  }

  private async _getCompletion(
    messages: AssistanceMessage[],
    params: {
      generatePrompt: AssistanceSchemaPromptGenerator,
      user: string,
    }
  ): Promise<string> {
    const {generatePrompt, user} = params;

    // First try fetching the completion with the default model.
    try {
      return await this._fetchCompletionWithRetries(messages, {user, model: this._model});
    } catch (e) {
      if (!(e instanceof TokensExceededError)) {
        throw e;
      }
    }

    // If we hit the token limit and a model with a longer context length is
    // available, try it.
    if (this._longerContextModel) {
      try {
        return await this._fetchCompletionWithRetries(messages, {
          user,
          model: this._longerContextModel,
        });
      } catch (e) {
        if (!(e instanceof TokensExceededError)) {
          throw e;
        }
      }
    }

    // If we (still) hit the token limit, try a shorter schema prompt as a last resort.
    const prompt = await generatePrompt({includeAllTables: false, includeLookups: false});
    return await this._fetchCompletionWithRetries([prompt, ...messages.slice(1)], {
      user,
      model: this._longerContextModel || this._model,
    });
  }

  private _buildSchemaPromptGenerator(
    optSession: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequest
  ): AssistanceSchemaPromptGenerator {
    return async (options) => ({
      role: 'system',
      content: 'You are a helpful assistant for a user of software called Grist. ' +
        "Below are one or more fake Python classes representing the structure of the user's data. " +
        'The function at the end needs completing. ' +
        "The user will probably give a description of what they want the function (a 'formula') to return. " +
        'If so, your response should include the function BODY as Python code in a markdown block. ' +
        "Your response will be automatically concatenated to the code below, so you mustn't repeat any of it. " +
        'You cannot change the function signature or define additional functions or classes. ' +
        'It should be a pure function that performs some computation and returns a result. ' +
        'It CANNOT perform any side effects such as adding/removing/modifying rows/columns/cells/tables/etc. ' +
        'It CANNOT interact with files/databases/networks/etc. ' +
        'It CANNOT display images/charts/graphs/maps/etc. ' +
        'If the user asks for these things, tell them that you cannot help. ' +
        "\n\n" +
        '```python\n' +
        await makeSchemaPromptV1(optSession, doc, request, options) +
        '\n```',
    });
  }
}

export class HuggingFaceAssistant implements Assistant {
  private _apiKey: string;
  private _completionUrl: string;

  public constructor() {
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      throw new Error('HUGGINGFACE_API_KEY not set');
    }
    this._apiKey = apiKey;
    // COMPLETION_MODEL values I've tried:
    //   - codeparrot/codeparrot
    //   - NinedayWang/PolyCoder-2.7B
    //   - NovelAI/genji-python-6B
    let completionUrl = process.env.COMPLETION_URL;
    if (!completionUrl) {
      if (process.env.COMPLETION_MODEL) {
        completionUrl = `https://api-inference.huggingface.co/models/${process.env.COMPLETION_MODEL}`;
      } else {
        completionUrl = 'https://api-inference.huggingface.co/models/NovelAI/genji-python-6B';
      }
    }
    this._completionUrl = completionUrl;

  }

  public async apply(
    optSession: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse> {
    if (request.state) {
      throw new Error("HuggingFaceAssistant does not support state");
    }
    const prompt = await makeSchemaPromptV1(optSession, doc, request);
    const response = await DEPS.fetch(
      this._completionUrl,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            return_full_text: false,
            max_new_tokens: 50,
          },
        }),
      },
    );
    if (response.status === 503) {
      log.error(`Sleeping for 10s - HuggingFace API returned ${response.status}: ${await response.text()}`);
      await delay(10000);
    }
    if (response.status !== 200) {
      const text = await response.text();
      log.error(`HuggingFace API returned ${response.status}: ${text}`);
      throw new Error(`HuggingFace API returned status ${response.status}: ${text}`);
    }
    const result = await response.json();
    let completion = result[0].generated_text;
    completion = completion.split('\n\n')[0];
    return completionToResponse(doc, request, completion);
  }
}

/**
 * Test assistant that mimics ChatGPT and just returns the input.
 */
class EchoAssistant implements Assistant {
  public async apply(sess: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse> {
    if (request.text === "ERROR") {
      throw new Error(`ERROR`);
    }
    const messages = request.state?.messages || [];
    if (messages.length === 0) {
      messages.push({
        role: 'system',
        content: ''
      });
    }
    messages.push({
      role: 'user', content: request.text,
    });
    const completion = request.text;
    const history = { messages };
    history.messages.push({
      role: 'assistant',
      content: completion,
    });
    const response = await completionToResponse(doc, request, completion, completion);
    response.state = history;
    return response;
  }
}

/**
 * Instantiate an assistant, based on environment variables.
 */
export function getAssistant() {
  if (process.env.OPENAI_API_KEY === 'test') {
    return new EchoAssistant();
  }
  if (process.env.OPENAI_API_KEY || process.env.ASSISTANT_CHAT_COMPLETION_ENDPOINT) {
    return new OpenAIAssistant();
  }
  throw new Error('Please set OPENAI_API_KEY or ASSISTANT_CHAT_COMPLETION_ENDPOINT');
}

/**
 * Service a request for assistance.
 */
export async function sendForCompletion(
  optSession: OptDocSession,
  doc: AssistanceDoc,
  request: AssistanceRequest,
): Promise<AssistanceResponse> {
  const assistant = getAssistant();
  return await assistant.apply(optSession, doc, request);
}

/**
 * Returns a new Markdown string with the contents of its first multi-line code block
 * replaced with `replaceValue`.
 */
export function replaceMarkdownCode(markdown: string, replaceValue: string) {
  return markdown.replace(/```\w*\n(.*)```/s, '```python\n' + replaceValue + '\n```');
}

async function makeSchemaPromptV1(
  session: OptDocSession,
  doc: AssistanceDoc,
  request: AssistanceRequest,
  options: AssistanceSchemaPromptV1Options = {}
) {
  if (request.context.type !== 'formula') {
    throw new Error('makeSchemaPromptV1 only works for formulas');
  }

  return doc.assistanceSchemaPromptV1(session, {
    tableId: request.context.tableId,
    colId: request.context.colId,
    docString: request.text,
    ...options,
  });
}

async function completionToResponse(
  doc: AssistanceDoc,
  request: AssistanceRequest,
  completion: string,
  reply?: string
): Promise<AssistanceResponse> {
  if (request.context.type !== 'formula') {
    throw new Error('completionToResponse only works for formulas');
  }
  const suggestedFormula = await doc.assistanceFormulaTweak(completion) || undefined;
  // Suggest an action only if the completion is non-empty (that is,
  // it actually looked like code).
  const suggestedActions: DocAction[] = suggestedFormula ? [[
    "ModifyColumn",
    request.context.tableId,
    request.context.colId, {
      formula: suggestedFormula,
    }
  ]] : [];
  return {
    suggestedActions,
    suggestedFormula,
    reply,
  };
}

function getUserHash(session: OptDocSession): string {
  const user = getDocSessionUser(session);
  // Make it a bit harder to guess the user ID.
  const salt = "7a8sb6987asdb678asd687sad6boas7f8b6aso7fd";
  const hashSource = `${user?.id} ${user?.ref} ${salt}`;
  const hash = createHash('sha256').update(hashSource).digest('base64');
  // So that if we get feedback about a user ID hash, we can
  // search for the hash in the logs to find the original user ID.
  log.rawInfo("getUserHash", {...getLogMetaFromDocSession(session), userRef: user?.ref, hash});
  return hash;
}
