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

/** A Widget Creator widget on the page, as the assistant panel uses it to run its browser tools. */
export interface IWidgetCreator {
  /** The HTML the user sees: in the open editor, the typed HTML even if not refreshed. */
  currentHtml(): string;
  /** Puts the assistant's HTML in the editor as a draft, and runs it in the preview. */
  applyHtml(html: string): void;
}
