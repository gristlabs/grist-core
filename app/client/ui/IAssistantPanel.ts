import { IInnerLeftPanel } from "app/client/ui/PagePanels";
import { AssistantState } from "app/common/ActiveDocAPI";
import { DeveloperPromptVersion } from "app/common/Assistance";

import { Disposable, Observable } from "grainjs";

export interface IAssistantPanel extends Disposable, IInnerLeftPanel {
  readonly isOpen: Observable<boolean>;
  open(): void;
  close(): void;
  toggle(): void;
  ask(prompt: string, developerPromptVersion?: DeveloperPromptVersion): void;
  setState(state: AssistantState): void;
}
