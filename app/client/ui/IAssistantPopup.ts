import { AssistantState } from "app/common/ActiveDocAPI";

import { Disposable } from "grainjs";

export interface IAssistantPopup extends Disposable {
  open: () => void;
  setState(state: AssistantState): void;
}
