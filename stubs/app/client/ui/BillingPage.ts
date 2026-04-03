import { AppModel } from "app/client/models/AppModel";
import { TeamSettingsPage } from "app/client/ui/TeamSettingsPage";

import { dom } from "grainjs";

export function buildMainBillingPage(appModel: AppModel) {
  return dom.create(TeamSettingsPage, appModel);
}
