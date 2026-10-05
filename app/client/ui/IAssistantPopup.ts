import { AssistantState } from "app/common/ActiveDocAPI";
import { DeveloperPromptVersion } from "app/common/Assistance";

import { Disposable, Observable } from "grainjs";

export interface IAssistantPopup extends Disposable {
  readonly hidden: Observable<boolean>;
  open(): void;
  ask(prompt: string, developerPromptVersion?: DeveloperPromptVersion): void;
  setState(state: AssistantState): void;
}
