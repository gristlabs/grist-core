import { GristDoc } from "app/client/components/GristDoc";
import { buildAutomationsUpsell } from "app/client/ui/Automations/TriggersPageUpsell";

import { Disposable, DomContents } from "grainjs";

export class TriggersPage extends Disposable {
  constructor(_gristDoc: GristDoc) { super(); }
  public buildDom(): DomContents { return buildAutomationsUpsell(); }
}
