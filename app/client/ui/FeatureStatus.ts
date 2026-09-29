import { getGristConfig } from "app/common/urlUtils";

import type { AppModel } from "app/client/models/AppModel";

type Feature = "automations" | "importFromGrist";
type FeatureStatus = "hidden" | "upsell" | "available";

/**
 * Automations are available on Enterprise and on SaaS for suitable plans. On other plans and in
 * core deployments, they require an upgrade. They are not applicable
 * at all on electron or grist-static.
 */
export function getAutomationsStatus(appModel?: AppModel | null): FeatureStatus {
  return getFeatureStatus("automations", appModel);
}

/**
 * Importing tables from other Grist documents is available on Enterprise and on SaaS for
 * suitable plans. On other plans and in core deployments, it requires an upgrade. It is not
 * applicable at all on electron or grist-static.
 */
export function getGristImportStatus(appModel?: AppModel | null): FeatureStatus {
  return getFeatureStatus("importFromGrist", appModel);
}

export function isGristImportAvailable(appModel?: AppModel | null): boolean {
  return getGristImportStatus(appModel) === "available";
}

function getFeatureStatus(feature: Feature, appModel?: AppModel | null): FeatureStatus {
  const { deploymentType } = getGristConfig();
  switch (deploymentType) {
    case "enterprise": return "available";
    case "electron":
    case "static": return "hidden";
    case "core": return "upsell";
    default: return appModel?.currentFeatures?.[feature] ? "available" : "upsell";
  }
}
