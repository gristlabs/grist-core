import { logTelemetryEvent } from "app/client/lib/telemetry";
import { AppModel } from "app/client/models/AppModel";
import { UpgradePlacement } from "app/common/Telemetry";

/**
 * Upsells already reported in this page load, keyed by placement and doc, so that an upsell
 * inside a document is reported once per document.
 */
const shown = new Set<string>();

/**
 * The metadata that both upsell events carry.
 */
function upgradeMetadata(appModel: AppModel, placement: UpgradePlacement) {
  // A personal site is served as the merged pseudo-org, whose id is 0; there is no site to name.
  return { placement, planName: appModel.planName, siteId: appModel.currentOrg?.id || undefined };
}

export function logUpgradeClicked(appModel: AppModel, placement: UpgradePlacement) {
  logTelemetryEvent("upgradeClicked", { full: upgradeMetadata(appModel, placement) });
}

/**
 * Report that an upgrade prompt was shown, once per page load per placement and doc.
 */
export function logUpsellShown(appModel: AppModel, placement: UpgradePlacement, docId?: string) {
  const key = `${placement}:${docId ?? ""}`;
  if (shown.has(key)) { return; }
  shown.add(key);
  logTelemetryEvent("upsellShown", {
    full: { ...upgradeMetadata(appModel, placement), docIdDigest: docId },
  });
}
