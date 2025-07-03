import {
  AssistanceMessage,
  AssistanceRequestV1,
  AssistanceResponseV1,
} from "app/common/Assistance";
import { AssistantProvider } from "app/common/Assistant";
import { delay } from "app/common/delay";
import { DocAction } from "app/common/DocActions";
import {
  getProviderFromHostname,
  getUserHash,
  NonRetryableError,
  QuotaExceededError,
  RetryableError,
  TokensExceededError,
  TokensExceededFirstMessageError,
  TokensExceededLaterMessageError,
} from "app/server/lib/Assistant";
import {
  AssistanceDoc,
  AssistanceSchemaPromptGenerator,
  AssistanceSchemaPromptV1Options,
  AssistantV1,
  AssistantV1Options,
} from "app/server/lib/IAssistant";
import { OptDocSession } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { agents } from 'app/server/lib/ProxyAgent';

import fetch from "node-fetch";

// These are mocked/replaced in tests.
// fetch is also replacing in the runCompletion script to add caching.
export const DEPS = { fetch, delayTime: 1000 };

/**
 * A flavor of assistant for use with the OpenAI chat completion endpoint
 * and tools with a compatible endpoint (e.g. llama-cpp-python).
 * Tested primarily with gpt-4o.
 *
 * Uses the ASSISTANT_CHAT_COMPLETION_ENDPOINT endpoint if set, else an
 * OpenAI endpoint. Passes ASSISTANT_API_KEY or OPENAI_API_KEY in a
 * header if set. An api key is required for the default OpenAI endpoint.
 *
 * If a model string is set in ASSISTANT_MODEL, this will be passed
 * along. For the default OpenAI endpoint, a gpt-4o variant will be
 * set by default.
 *
 * If a request fails because of context length limitation, and
 * ASSISTANT_LONGER_CONTEXT_MODEL is set, the request will be retried
 * with that model.
 *
 * An optional ASSISTANT_MAX_TOKENS can be specified.
 */
export class OpenAIAssistantV1 implements AssistantV1 {
  public static readonly VERSION = 1;
  public static readonly DEFAULT_MODEL = "gpt-4o-2024-08-06";
  public static readonly DEFAULT_LONGER_CONTEXT_MODEL = "";

  private _apiKey = this._options.apiKey;
  private _endpoint =
    this._options.completionEndpoint ??
    "https://api.openai.com/v1/chat/completions";
  private _model = this._options.model;
  private _longerContextModel = this._options.longerContextModel;
  private _maxTokens = this._options.maxTokens;

  public constructor(private _options: AssistantV1Options) {
    if (!this._apiKey && !_options.completionEndpoint) {
      throw new Error(
        "Please set ASSISTANT_API_KEY or ASSISTANT_CHAT_COMPLETION_ENDPOINT"
      );
    }

    if (!_options.completionEndpoint) {
      this._model ||= OpenAIAssistantV1.DEFAULT_MODEL;
      this._longerContextModel ||=
        OpenAIAssistantV1.DEFAULT_LONGER_CONTEXT_MODEL;
    }
  }

  public async getAssistance(
    optSession: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequestV1
  ): Promise<AssistanceResponseV1> {
    const generatePrompt = this._buildSchemaPromptGenerator(
      optSession,
      doc,
      request
    );
    const messages = request.state?.messages || [];
    const newMessages: AssistanceMessage[] = [];
    if (messages.length === 0) {
      newMessages.push(await generatePrompt());
    }
    if (request.context.evaluateCurrentFormula) {
      const result = await doc.assistanceEvaluateFormula(request.context);
      let message =
        "Evaluating this code:\n\n```python\n" + result.formula + "\n```\n\n";
      if (Object.keys(result.attributes).length > 0) {
        const attributes = Object.entries(result.attributes)
          .map(([k, v]) => `${k} = ${v}`)
          .join("\n");
        message += `where:\n\n${attributes}\n\n`;
      }
      message += `${result.error ? "raises an exception" : "returns"}: ${
        result.result
      }`;
      newMessages.push({
        role: "system",
        content: message,
      });
    }
    newMessages.push({
      role: "user",
      content: request.text,
    });
    messages.push(...newMessages);

    const newMessagesStartIndex = messages.length - newMessages.length;
    for (const [index, { role, content }] of newMessages.entries()) {
      doc.logTelemetryEvent(optSession, "assistantSend", {
        full: {
          version: 1,
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
    messages.push({ role: "assistant", content: completion });

    // It's nice to have this ready to uncomment for debugging.
    // console.log(completion);

    const response = await completionToResponse(
      doc,
      request,
      completion
    );
    if (response.suggestedFormula) {
      // Show the tweaked version of the suggested formula to the user (i.e. the one that's
      // copied when the Apply button is clicked).
      response.reply = replaceMarkdownCode(
        completion,
        response.suggestedFormula
      );
    } else {
      response.reply = completion;
    }
    response.state = { messages };
    doc.logTelemetryEvent(optSession, "assistantReceive", {
      full: {
        version: 1,
        conversationId: request.conversationId,
        context: request.context,
        response: {
          index: messages.length - 1,
          content: completion,
        },
        suggestedFormula: response.suggestedFormula,
      },
    });
    return response;
  }

  public get version(): AssistantV1["version"] {
    return OpenAIAssistantV1.VERSION;
  }

  public get provider(): AssistantProvider {
    return getProviderFromHostname(this._endpoint);
  }

  private async _fetchCompletion(
    messages: AssistanceMessage[],
    params: { user: string; model?: string }
  ) {
    const { user, model } = params;
    const apiResponse = await DEPS.fetch(this._endpoint, {
      method: "POST",
      headers: {
        ...(this._apiKey
          ? {
              Authorization: `Bearer ${this._apiKey}`,
              "api-key": this._apiKey,
            }
          : undefined),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        temperature: 0,
        ...(model ? { model } : undefined),
        user,
        ...(this._maxTokens
          ? {
              max_tokens: this._maxTokens,
            }
          : undefined),
      }),
      ...(agents.trusted ? { agent: agents.trusted } : {})
    });
    const resultText = await apiResponse.text();
    const result = JSON.parse(resultText);
    const errorCode = result.error?.code;
    const errorMessage = result.error?.message;
    if (
      errorCode === "context_length_exceeded" ||
      result.choices?.[0].finish_reason === "length"
    ) {
      log.warn("AI context length exceeded: ", errorMessage);
      if (messages.length <= 2) {
        throw new TokensExceededFirstMessageError();
      } else {
        throw new TokensExceededLaterMessageError();
      }
    }
    if (errorCode === "insufficient_quota") {
      log.error("AI service provider billing quota exceeded!!!");
      throw new QuotaExceededError();
    }
    if (apiResponse.status !== 200) {
      throw new Error(
        `AI service provider API returned status ${apiResponse.status}: ${resultText}`
      );
    }
    return result.choices[0].message.content;
  }

  private async _fetchCompletionWithRetries(
    messages: AssistanceMessage[],
    params: {
      user: string;
      model?: string;
    }
  ): Promise<any> {
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
      generatePrompt: AssistanceSchemaPromptGenerator;
      user: string;
    }
  ): Promise<string> {
    const { generatePrompt, user } = params;

    // First try fetching the completion with the default model.
    try {
      return await this._fetchCompletionWithRetries(messages, {
        user,
        model: this._model,
      });
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
    const prompt = await generatePrompt({
      includeAllTables: false,
      includeLookups: false,
    });
    return await this._fetchCompletionWithRetries(
      [prompt, ...messages.slice(1)],
      {
        user,
        model: this._longerContextModel || this._model,
      }
    );
  }

  private _buildSchemaPromptGenerator(
    optSession: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequestV1
  ): AssistanceSchemaPromptGenerator {
    return async (options) => ({
      role: "system",
      content:
        "You are a helpful assistant for a user of software called Grist. " +
        "Below are one or more fake Python classes representing the structure of the user's data. " +
        "The function at the end needs completing. " +
        "The user will probably give a description of what they want the function (a 'formula') to return. " +
        "If so, your response should include the function BODY as Python code in a markdown block. " +
        "Your response will be automatically concatenated to the code below, so you mustn't repeat any of it. " +
        "You cannot change the function signature or define additional functions or classes. " +
        "It should be a pure function that performs some computation and returns a result. " +
        "It CANNOT perform any side effects such as adding/removing/modifying rows/columns/cells/tables/etc. " +
        "It CANNOT interact with files/databases/networks/etc. " +
        "It CANNOT display images/charts/graphs/maps/etc. " +
        "If the user asks for these things, tell them that you cannot help. " +
        "\n\n" +
        "```python\n" +
        (await makeSchemaPromptV1(optSession, doc, request, options)) +
        "\n```",
    });
  }
}

/**
 * Test assistant that mimics ChatGPT and just returns the input.
 */
export class EchoAssistantV1 implements AssistantV1 {
  public static readonly VERSION = 1;

  public async getAssistance(
    _docSession: OptDocSession,
    doc: AssistanceDoc,
    request: AssistanceRequestV1
  ): Promise<AssistanceResponseV1> {
    if (request.text === "ERROR") {
      throw new Error("ERROR");
    }
    if (request.text === "SLOW") {
      await new Promise(r => setTimeout(r, 1000));
    }

    const messages = request.state?.messages || [];
    if (messages.length === 0) {
      messages.push({
        role: "system",
        content: "",
      });
    }
    messages.push({
      role: "user",
      content: request.text,
    });
    const completion = request.text!;
    const history = { messages };
    history.messages.push({
      role: "assistant",
      content: completion,
    });
    const response = await completionToResponse(
      doc,
      request,
      completion,
      completion
    );
    response.state = history;
    return response;
  }

  public get version(): AssistantV1["version"] {
    return EchoAssistantV1.VERSION;
  }

  public get provider(): AssistantProvider {
    return null;
  }
}

/**
 * Returns a new Markdown string with the contents of its first multi-line code block
 * replaced with `replaceValue`.
 */
function replaceMarkdownCode(markdown: string, replaceValue: string) {
  return markdown.replace(
    /```\w*\n(.*)```/s,
    "```python\n" + replaceValue + "\n```"
  );
}

async function makeSchemaPromptV1(
  session: OptDocSession,
  doc: AssistanceDoc,
  request: AssistanceRequestV1,
  options: AssistanceSchemaPromptV1Options = {}
) {
  return doc.assistanceSchemaPromptV1(session, {
    tableId: request.context.tableId,
    colId: request.context.colId,
    ...options,
  });
}

async function completionToResponse(
  doc: AssistanceDoc,
  request: AssistanceRequestV1,
  completion: string,
  reply?: string
): Promise<AssistanceResponseV1> {
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
