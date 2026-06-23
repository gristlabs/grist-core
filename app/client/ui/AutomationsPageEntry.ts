import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { getAutomationsStatus } from "app/client/ui/AutomationStatus";
import {
  cssLinkText,
  cssPageEntry,
  cssPageIcon,
  cssPageLink,
} from "app/client/ui/LeftPanelCommon";
import { isFeatureEnabled } from "app/common/gristUrls";

import { DomContents, makeTestId } from "grainjs";

const testId = makeTestId("test-tools-");
const t = makeT("AutomationsPageEntry");

/**
 * Return the page entry for automations, except when inappliable or explicitly disabled.
 */
export function createAutomationsPageEntry(gristDoc: GristDoc, isDocOwner: boolean): DomContents {
  if (!isFeatureEnabled("automations")) { return null; }
  const status = getAutomationsStatus(gristDoc.appModel);
  if (status === "hidden") { return null; }
  return cssPageEntry(
    cssPageEntry.cls("-selected", use => use(gristDoc.activeViewId) === "automations"),
    cssPageEntry.cls("-disabled", !isDocOwner),
    cssPageLink(cssPageIcon("Repl"),
      cssLinkText(t("Automations")),
      isDocOwner ? urlState().setLinkUrl({ docPage: "automations" }) : null,
    ),
    testId("automations"),
  );
}
