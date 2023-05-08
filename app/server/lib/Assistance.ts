/**
 * Module with functions used for AI formula assistance.
 */

import {AssistanceRequest, AssistanceResponse} from 'app/common/AssistancePrompts';
import {delay} from 'app/common/delay';
import {DocAction} from 'app/common/DocActions';
import log from 'app/server/lib/log';
import fetch from 'node-fetch';

export const DEPS = { fetch };

/**
 * An assistant can help a user do things with their document,
 * by interfacing with an external LLM endpoint.
 */
export interface Assistant {
  apply(doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse>;
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
  assistanceSchemaPromptV1(options: {
    tableId: string,
    colId: string,
    docString: string,
  }): Promise<string>;

  /**
   * Some tweaks to a formula after it has been generated.
   */
  assistanceFormulaTweak(txt: string): Promise<string>;
}

/**
 * A flavor of assistant for use with the OpenAI API.
 * Tested primarily with text-davinci-002 and gpt-3.5-turbo.
 */
export class OpenAIAssistant implements Assistant {
  private _apiKey: string;
  private _model: string;
  private _chatMode: boolean;
  private _endpoint: string;

  public constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }
    this._apiKey = apiKey;
    this._model = process.env.COMPLETION_MODEL || "text-davinci-002";
    this._chatMode = this._model.includes('turbo');
    this._endpoint = `https://api.openai.com/v1/${this._chatMode ? 'chat/' : ''}completions`;
  }

  public async apply(doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse> {
    const messages = request.state?.messages || [];
    const chatMode = this._chatMode;
    if (chatMode) {
      if (messages.length === 0) {
        messages.push({
          role: 'system',
          content: 'The user gives you one or more Python classes, ' +
            'with one last method that needs completing. Write the ' +
            'method body as a single code block, ' +
            'including the docstring the user gave. ' +
            'Just give the Python code as a markdown block, ' +
            'do not give any introduction, that will just be ' +
            'awkward for the user when copying and pasting. ' +
            'You are working with Grist, an environment very like ' +
            'regular Python except `rec` (like record) is used ' +
            'instead of `self`. ' +
            'Include at least one `return` statement or the method ' +
            'will fail, disappointing the user. ' +
            'Your answer should be the body of a single method, ' +
            'not a class, and should not include `dataclass` or ' +
            '`class` since the user is counting on you to provide ' +
            'a single method. Thanks!'
        });
        messages.push({
          role: 'user', content: await makeSchemaPromptV1(doc, request),
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
        role: 'user', content: await makeSchemaPromptV1(doc, request),
      });
    }

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
          } : { messages }),
          max_tokens: 1500,
          temperature: 0,
          model: this._model,
          stop: this._chatMode ? undefined : ["\n\n"],
        }),
      },
    );
    if (apiResponse.status !== 200) {
      log.error(`OpenAI API returned ${apiResponse.status}: ${await apiResponse.text()}`);
      throw new Error(`OpenAI API returned status ${apiResponse.status}`);
    }
    const result = await apiResponse.json();
    let completion: string = String(chatMode ? result.choices[0].message.content : result.choices[0].text);
    const reply = completion;
    const history = { messages };
    if (chatMode) {
      history.messages.push(result.choices[0].message);
      // This model likes returning markdown. Code will typically
      // be in a code block with ``` delimiters.
      let lines = completion.split('\n');
      if (lines[0].startsWith('```')) {
        lines.shift();
        completion = lines.join('\n');
        const parts = completion.split('```');
        if (parts.length > 1) {
          completion = parts[0];
        }
        lines = completion.split('\n');
      }

      // This model likes repeating the function signature and
      // docstring, so we try to strip that out.
      completion = lines.join('\n');
      while (completion.includes('"""')) {
        const parts = completion.split('"""');
        completion = parts[parts.length - 1];
      }

      // If there's no code block, don't treat the answer as a formula.
      if (!reply.includes('```')) {
        completion = '';
      }
    }

    const response = await completionToResponse(doc, request, completion, reply);
    if (chatMode) {
      response.state = history;
    }
    return response;
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

  public async apply(doc: AssistanceDoc, request: AssistanceRequest): Promise<AssistanceResponse> {
    if (request.state) {
      throw new Error("HuggingFaceAssistant does not support state");
    }
    const prompt = await makeSchemaPromptV1(doc, request);
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
 * Instantiate an assistant, based on environment variables.
 */
function getAssistant() {
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIAssistant();
  }
  if (process.env.HUGGINGFACE_API_KEY) {
    return new HuggingFaceAssistant();
  }
  throw new Error('Please set OPENAI_API_KEY or HUGGINGFACE_API_KEY');
}

/**
 * Service a request for assistance, with a little retry logic
 * since these endpoints can be a bit flakey.
 */
export async function sendForCompletion(doc: AssistanceDoc,
                                        request: AssistanceRequest): Promise<AssistanceResponse> {
  const assistant = getAssistant();

  let retries: number = 0;

  let response: AssistanceResponse|null = null;
  while(retries++ < 3) {
    try {
      response = await assistant.apply(doc, request);
      break;
    } catch(e) {
      log.error(`Completion error: ${e}`);
      await delay(1000);
    }
  }
  if (!response) {
    throw new Error('Failed to get response from assistant');
  }
  return response;
}

async function makeSchemaPromptV1(doc: AssistanceDoc, request: AssistanceRequest) {
  if (request.context.type !== 'formula') {
    throw new Error('makeSchemaPromptV1 only works for formulas');
  }
  return doc.assistanceSchemaPromptV1({
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
  // A leading newline is common.
  if (completion.charAt(0) === '\n') {
    completion = completion.slice(1);
  }
  // If all non-empty lines have four spaces, remove those spaces.
  // They are common for GPT-3.5, which matches the prompt carefully.
  const lines = completion.split('\n');
  const ok = lines.every(line => line === '\n' || line.startsWith('    '));
  if (ok) {
    completion = lines.map(line => line === '\n' ? line : line.slice(4)).join('\n');
  }

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
