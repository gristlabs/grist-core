import { getGristConfig } from "app/common/urlUtils";

import type { AppModel } from "app/client/models/AppModel";

export type AutomationFeatureStatus = "hidden" | "upsell" | "available";

/**
 * Automations are available on Enterprise and on SaaS for suitable plans. On other plans and in
 * core deployments, they require an upgrade. They are not applicable
 * at all on electron or grist-static.
 */
export function getAutomationsStatus(appModel?: AppModel | null): AutomationFeatureStatus {
  const { deploymentType } = getGristConfig();
  switch (deploymentType) {
    case "enterprise": return "available";
    case "electron":
    case "static": return "hidden";
    case "core": return "upsell";
    default: return appModel?.currentFeatures?.automations ? "available" : "upsell";
  }
}
