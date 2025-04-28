import { GristDoc } from "app/client/components/GristDoc";
import { Disposable, DomElementArg } from "grainjs";

export class AssistantPopup extends Disposable {
  constructor(_gristDoc: GristDoc) {
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
