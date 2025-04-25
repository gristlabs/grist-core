import { getAssistantV1Options } from "app/server/lib/Assistant";
import { AssistantV1 } from "app/server/lib/IAssistant";
import { EchoAssistantV1, OpenAIAssistantV1 } from "app/server/lib/OpenAIAssistantV1";

export function configureOpenAIAssistantV1(): AssistantV1 | undefined {
  const options = getAssistantV1Options();
  if (!options.apiKey && !options.completionEndpoint) {
    return undefined;
  } else if (options.apiKey === "test") {
    return new EchoAssistantV1();
  } else {
    return new OpenAIAssistantV1(options);
  }
}
