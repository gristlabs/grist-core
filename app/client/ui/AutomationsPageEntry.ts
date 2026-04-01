import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { getAutomationsStatus } from "app/client/ui/AutomationStatus";
import {
  cssLinkText,
  cssPageEntry,
  cssPageIcon,
  cssPageLink,
  cssTools,
} from "app/client/ui/LeftPanelCommon";
import { theme, vars } from "app/client/ui2018/cssVars";
import { isFeatureEnabled } from "app/common/gristUrls";

import { DomContents, makeTestId, styled } from "grainjs";

const testId = makeTestId("test-tools-");
const t = makeT("Tools");

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
      cssBetaTag(t("New")),
      isDocOwner ? urlState().setLinkUrl({ docPage: "automations" }) : null,
    ),
    testId("automations"),
  );
}

const cssBetaTag = styled("span", `
  text-transform: uppercase;
  vertical-align: super;
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  line-height: 1;
  color: ${theme.accentText};
  margin-left: 4px;
  margin-top: -4px;
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);
