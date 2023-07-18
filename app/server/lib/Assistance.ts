/**
 * Module with functions used for AI formula assistance.
 */

import {AssistanceMessage, AssistanceRequest, AssistanceResponse} from 'app/common/AssistancePrompts';
import {delay} from 'app/common/delay';
import {DocAction} from 'app/common/DocActions';
import {OptDocSession} from 'app/server/lib/DocSession';
import log from 'app/server/lib/log';
import fetch from 'node-fetch';

// These are mocked/replaced in tests.
// fetch is also replacing in the runCompletion script to add caching.
export const DEPS = { fetch, delayTime: 1000 };

/**
 * An assistant can help a user do things with their document,
 * by interfacing with an external LLM endpoint.
 */
export interface Assistant {
  apply(session: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse>;
}

/**
 * Document-related methods for use in the implementation of assistants.
 * Somewhat ad-hoc currently.
 */
export interface AssistanceDoc {
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
}

export interface AssistanceSchemaPromptV1Context {
  tableId: string,
  colId: string,
  docString: string,
}

class SwitchToLongerContext extends Error {
}

class NonRetryableError extends Error {
}

class TokensExceededFirstMessage extends NonRetryableError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
      "You'll need to either shorten your message or delete some columns."
    );
  }
}

class TokensExceededLaterMessage extends NonRetryableError {
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
 * A flavor of assistant for use with the OpenAI API.
 * Tested primarily with gpt-3.5-turbo.
 */
export class OpenAIAssistant implements Assistant {
  public static DEFAULT_MODEL = "gpt-3.5-turbo-0613";
  public static LONGER_CONTEXT_MODEL = "gpt-3.5-turbo-16k-0613";

  private _apiKey: string;
  private _chatMode: boolean;
  private _endpoint: string;

  public constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }
    this._apiKey = apiKey;
    this._chatMode = true;
    if (!this._chatMode) {
      throw new Error('Only turbo models are currently supported');
    }
    this._endpoint = `https://api.openai.com/v1/${this._chatMode ? 'chat/' : ''}completions`;
  }

  public async apply(
    optSession: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse> {
    const messages = request.state?.messages || [];
    const chatMode = this._chatMode;
    if (chatMode) {
      if (messages.length === 0) {
        messages.push({
          role: 'system',
          content: 'You are a helpful assistant for a user of software called Grist. ' +
            'Below are one or more Python classes. ' +
            'The last method needs completing. ' +
            "The user will probably give a description of what they want the method (a 'formula') to return. " +
            'If so, your response should include the method body as Python code in a markdown block. ' +
            'Do not include the class or method signature, just the method body. ' +
            'If your code starts with `class`, `@dataclass`, or `def` it will fail. Only give the method body. ' +
            'You can import modules inside the method body if needed. ' +
            'You cannot define additional functions or methods. ' +
            'The method should be a pure function that performs some computation and returns a result. ' +
            'It CANNOT perform any side effects such as adding/removing/modifying rows/columns/cells/tables/etc. ' +
            'It CANNOT interact with files/databases/networks/etc. ' +
            'It CANNOT display images/charts/graphs/maps/etc. ' +
            'If the user asks for these things, tell them that you cannot help. ' +
            'The method uses `rec` instead of `self` as the first parameter.\n\n' +
            '```python\n' +
            await makeSchemaPromptV1(optSession, doc, request) +
            '\n```',
        });
        messages.push({
          role: 'user', content: request.text,
        });
      } else {
        if (request.regenerate) {
          if (messages[messages.length - 1].role !== 'user') {
            messages.pop();
          }
        }
        messages.push({
          role: 'user', content: request.text,
        });
      }
    } else {
      messages.length = 0;
      messages.push({
        role: 'user', content: await makeSchemaPromptV1(optSession, doc, request),
      });
    }
    const completion: string = await this._getCompletion(messages);
    const response = await completionToResponse(doc, request, completion, completion);
    if (chatMode) {
      response.state = {messages};
    }
    return response;
  }

  private async _fetchCompletion(messages: AssistanceMessage[], longerContext: boolean) {
    const apiResponse = await DEPS.fetch(
      this._endpoint,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this._apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(!this._chatMode ? {
            prompt: messages[messages.length - 1].content,
          } : {messages}),
          temperature: 0,
          model: longerContext ? OpenAIAssistant.LONGER_CONTEXT_MODEL : OpenAIAssistant.DEFAULT_MODEL,
          stop: this._chatMode ? undefined : ["\n\n"],
        }),
      },
    );
    const resultText = await apiResponse.text();
    const result = JSON.parse(resultText);
    const errorCode = result.error?.code;
    if (errorCode === "context_length_exceeded" || result.choices?.[0].finish_reason === "length") {
      if (!longerContext) {
        log.info("Switching to longer context model...");
        throw new SwitchToLongerContext();
      } else if (messages.length <= 2) {
        throw new TokensExceededFirstMessage();
      } else {
        throw new TokensExceededLaterMessage();
      }
    }
    if (errorCode === "insufficient_quota") {
      log.error("OpenAI billing quota exceeded!!!");
      throw new QuotaExceededError();
    }
    if (apiResponse.status !== 200) {
      throw new Error(`OpenAI API returned status ${apiResponse.status}: ${resultText}`);
    }
    return result;
  }

  private async _fetchCompletionWithRetries(messages: AssistanceMessage[], longerContext: boolean): Promise<any> {
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this._fetchCompletion(messages, longerContext);
      } catch (e) {
        if (e instanceof SwitchToLongerContext) {
          return await this._fetchCompletionWithRetries(messages, true);
        } else if (e instanceof NonRetryableError) {
          throw e;
        } else if (attempt === maxAttempts) {
          throw new RetryableError(e.toString());
        }
        log.warn(`Waiting and then retrying after error: ${e}`);
        await delay(DEPS.delayTime);
      }
    }
  }

  private async _getCompletion(messages: AssistanceMessage[]) {
    const result = await this._fetchCompletionWithRetries(messages, false);
    const completion: string = String(this._chatMode ? result.choices[0].message.content : result.choices[0].text);
    if (this._chatMode) {
      messages.push(result.choices[0].message);
    }
    return completion;
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
export class EchoAssistant implements Assistant {
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
      messages.push({
        role: 'user', content: request.text,
      });
    } else {
      if (request.regenerate) {
        if (messages[messages.length - 1].role !== 'user') {
          messages.pop();
        }
      }
      messages.push({
        role: 'user', content: request.text,
      });
    }
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
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIAssistant();
  }
  // Maintaining this is too much of a burden for now.
  // if (process.env.HUGGINGFACE_API_KEY) {
  //   return new HuggingFaceAssistant();
  // }
  throw new Error('Please set OPENAI_API_KEY');
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

async function makeSchemaPromptV1(session: OptDocSession, doc: AssistanceDoc, request: AssistanceRequest) {
  if (request.context.type !== 'formula') {
    throw new Error('makeSchemaPromptV1 only works for formulas');
  }
  return doc.assistanceSchemaPromptV1(session, {
    tableId: request.context.tableId,
    colId: request.context.colId,
    docString: request.text,
  });
}

async function completionToResponse(doc: AssistanceDoc, request: AssistanceRequest,
                                    completion: string, reply?: string): Promise<AssistanceResponse> {
  if (request.context.type !== 'formula') {
    throw new Error('completionToResponse only works for formulas');
  }
  completion = await doc.assistanceFormulaTweak(completion);
  // Suggest an action only if the completion is non-empty (that is,
  // it actually looked like code).
  const suggestedActions: DocAction[] = completion ? [[
    "ModifyColumn",
    request.context.tableId,
    request.context.colId, {
      formula: completion,
    }
  ]] : [];
  return {
    suggestedActions,
    reply,
  };
}
