import { GristDoc } from "app/client/components/GristDoc";
import { AssistantState } from "app/common/ActiveDocAPI";
import { Disposable, DomElementArg } from "grainjs";

export class AssistantPopup extends Disposable {
  constructor(_gristDoc: GristDoc, _options: { state?: AssistantState } = {}) {
    super();
  }

  public buildDom() {
    return null;
  }
}

export function buildOpenAssistantButton(
  _gristDoc: GristDoc,
  ..._args: DomElementArg[]
) {
  return null;
}
