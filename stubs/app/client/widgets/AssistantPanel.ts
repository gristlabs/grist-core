import { GristDoc } from "app/client/components/GristDoc";
import { IAssistantPanel } from "app/client/ui/IAssistantPanel";

import { DomElementArg } from "grainjs";

export function buildAssistantPanel(_gristDoc: GristDoc): IAssistantPanel | null {
  return null;
}

export function buildOpenAssistantButton(
  _gristDoc: GristDoc,
  ..._args: DomElementArg[]
) {
  return null;
}
