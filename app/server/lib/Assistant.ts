import { ApiError } from "app/common/ApiError";
import { AssistantProvider } from "app/common/Assistant";
import { appSettings } from "app/server/lib/AppSettings";
import { OptDocSession } from "app/server/lib/DocSession";
import {
  AssistantV1Options,
  AssistantV2Options,
} from "app/server/lib/IAssistant";
import log from "app/server/lib/log";
import { getLogMeta } from "app/server/lib/sessionUtils";

import { createHash } from "crypto";

export function getAssistantV1Options(): AssistantV1Options {
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
    envVar: "ASSISTANT_MAX_TOKENS",
    minValue: 1,
  });
  return {
    apiKey,
    completionEndpoint,
    model,
    longerContextModel,
    maxTokens,
  };
}

export function getAssistantV2Options(): AssistantV2Options {
  const maxToolCalls = appSettings
    .section("assistant")
    .flag("maxToolCalls")
    .readInt({
      envVar: "ASSISTANT_MAX_TOOL_CALLS",
      minValue: 0,
    });
  const structuredOutput = appSettings
    .section("assistant")
    .flag("structuredOutput")
    .readBool({
      envVar: "ASSISTANT_STRUCTURED_OUTPUT",
      defaultValue: false,
    });
  return {
    ...getAssistantV1Options(),
    maxToolCalls,
    structuredOutput,
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

export function getUserHash(session: OptDocSession): string {
  const user = session.fullUser;
  // Make it a bit harder to guess the user ID.
  const salt = "7a8sb6987asdb678asd687sad6boas7f8b6aso7fd";
  const hashSource = `${user?.id} ${user?.ref} ${salt}`;
  const hash = createHash("sha256").update(hashSource).digest("base64");
  // So that if we get feedback about a user ID hash, we can
  // search for the hash in the logs to find the original user ID.
  log.rawInfo("getUserHash", {
    ...getLogMeta(session),
    userRef: user?.ref,
    hash,
  });
  return hash;
}

export class NonRetryableError extends ApiError {}

export class TokensExceededError extends NonRetryableError {}

export class TokensExceededFirstMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
      "You'll need to either shorten your message or delete some columns.",
      400,
      {
        code: "ContextLimitExceeded",
      },
    );
  }
}

export class TokensExceededLaterMessageError extends TokensExceededError {
  constructor() {
    super(
      "Sorry, there's too much information for the AI to process. " +
      "You'll need to either shorten your message, restart the conversation, or delete some columns.",
      400,
      {
        code: "ContextLimitExceeded",
      },
    );
  }
}

export class QuotaExceededError extends NonRetryableError {
  constructor() {
    super(
      "Sorry, the assistant is facing some long term capacity issues. " +
      "Maybe try again tomorrow.",
      503,
    );
  }
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(
      "Sorry, the assistant is unavailable right now. " +
      "Try again in a few minutes.\n\n" +
      "```\n(" + message + ")\n```",
    );
  }
}
