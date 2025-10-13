import { GristDoc } from "app/client/components/GristDoc";
import { IAssistantPopup } from "app/client/ui/IAssistantPopup";
import { DomElementArg } from "grainjs";

export function buildAssistantPopup(_gristDoc: GristDoc): IAssistantPopup | null {
  return null;
}

export function buildOpenAssistantButton(
  _gristDoc: GristDoc,
  ..._args: DomElementArg[]
) {
  return null;
}
