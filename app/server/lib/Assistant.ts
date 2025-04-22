import {
  FormulaAssistanceRequest,
  FormulaAssistanceResponse,
} from "app/common/Assistance";
import { AssistantProvider } from "app/common/Assistant";
import { DocAction } from "app/common/DocActions";
import { appSettings } from "app/server/lib/AppSettings";
import { AssistanceDoc, AssistantOptions } from "app/server/lib/IAssistant";

export function getAssistantOptions(): AssistantOptions {
  const apiKey = appSettings
    .section("assistant")
    .flag("apiKey")
    .readString({
      envVar: ["ASSISTANT_API_KEY", "OPENAI_API_KEY"],
      preferredEnvVar: "ASSISTANT_API_KEY",
      censor: true,
    });
  const completionEndpoint = appSettings
    .section("assistant")
    .flag("chatCompletionEndpoint")
    .readString({
      envVar: "ASSISTANT_CHAT_COMPLETION_ENDPOINT",
    });
  const model = appSettings.section("assistant").flag("model").readString({
    envVar: "ASSISTANT_MODEL",
  });
  const longerContextModel = appSettings
    .section("assistant")
    .flag("longerContextModel")
    .readString({
      envVar: "ASSISTANT_LONGER_CONTEXT_MODEL",
    });
  const maxTokens = appSettings.section("assistant").flag("maxTokens").readInt({
    envVar: "ASSISTANT_MAX_TOOL_CALLS",
  });
  const maxToolCalls = appSettings
    .section("assistant")
    .flag("maxToolCalls")
    .readInt({
      envVar: "ASSISTANT_MAX_TOOL_CALLS",
    });
  return {
    apiKey,
    completionEndpoint,
    model,
    longerContextModel,
    maxTokens,
    maxToolCalls,
  };
}

export async function formulaCompletionToResponse(
  doc: AssistanceDoc,
  request: FormulaAssistanceRequest,
  completion: string,
  reply?: string
): Promise<FormulaAssistanceResponse> {
  const suggestedFormula =
    (await doc.assistanceFormulaTweak(completion)) || undefined;
  // Suggest an action only if the completion is non-empty (that is,
  // it actually looked like code).
  const suggestedActions: DocAction[] = suggestedFormula
    ? [
        [
          "ModifyColumn",
          request.context.tableId,
          request.context.colId,
          {
            formula: suggestedFormula,
          },
        ],
      ]
    : [];
  return {
    suggestedActions,
    suggestedFormula,
    reply,
  };
}

export function getProviderFromHostname(url: string): AssistantProvider {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }

  switch (hostname) {
    case "api.openai.com": {
      return "OpenAI";
    }
    default: {
      return "Unknown";
    }
  }
}

export class NonRetryableError extends Error {}

export class TokensExceededError extends NonRetryableError {}

export class TokensExceededFirstMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
        "You'll need to either shorten your message or delete some columns."
    );
  }
}

export class TokensExceededLaterMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
        "You'll need to either shorten your message, restart the conversation, or delete some columns."
    );
  }
}

export class QuotaExceededError extends NonRetryableError {
  constructor() {
    super(
      "Sorry, the assistant is facing some long term capacity issues. " +
        "Maybe try again tomorrow."
    );
  }
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(
      "Sorry, the assistant is unavailable right now. " +
        "Try again in a few minutes. \n" +
        `(${message})`
    );
  }
}
