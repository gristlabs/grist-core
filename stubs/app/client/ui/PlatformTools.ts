import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import {
  cssLinkText,
  cssPageEntry,
  cssPageIcon,
  cssPageLink,
  cssPill,
} from "app/client/ui/LeftPanelCommon";
import { isFeatureEnabled } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import { DomContents, makeTestId } from "grainjs";

const testId = makeTestId("test-tools-");
const t = makeT("Tools");

export function createPlatformTools(gristDoc: GristDoc, isDocOwner: boolean): DomContents {
  if (!isFeatureEnabled("automations")) { return null; }
  if (!isDocOwner) { return null; }
  const { deploymentType } = getGristConfig();
  if (deploymentType === "electron" || deploymentType === "static") { return null; }
  return cssPageEntry(
    cssPageEntry.cls("-selected", use => use(gristDoc.activeViewId) === "automations"),
    cssPageLink(cssPageIcon("Repl"),
      cssLinkText(t("Automations")),
      cssPill(t("Upgrade")),
      urlState().setLinkUrl({ docPage: "automations" }),
    ),
    testId("automations"),
  );
}
