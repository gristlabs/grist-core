import { getAssistantOptions } from "app/server/lib/Assistant";
import { EchoFormulaAssistant, OpenAIFormulaAssistant } from "app/server/lib/FormulaAssistant";
import { IAssistant } from "app/server/lib/IAssistant";

export function configureOpenAIFormulaAssistant(): IAssistant | undefined {
  const options = getAssistantOptions();
  if (!options.apiKey && !options.completionEndpoint) {
    return undefined;
  } else if (options.apiKey === "test") {
    return new EchoFormulaAssistant();
  } else {
    return new OpenAIFormulaAssistant(options);
  }
}
