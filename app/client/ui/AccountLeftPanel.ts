import { get as getBrowserGlobals } from "app/client/lib/browserGlobals";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import * as css from "app/client/ui/LeftPanelCommon";
import { AccountPage, isFeatureEnabled } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, dom, DomContents, MultiHolder, Observable } from "grainjs";

import type { AppModel } from "app/client/models/AppModel";
import type { PageSidePanel } from "app/client/ui/PagePanels";
import type { IconName } from "app/client/ui2018/IconList";

// Strings from AccountPage migrated to this file; we could rename these and their translations to
// match the filename, but leaving it for a separate diff.
// eslint-disable-next-line local/makeT-filename
const t = makeT("AccountPage");

const G = getBrowserGlobals("window");

// Whether OAuth Apps feature is available (EE/SaaS only, not core). Returns "hidden" to
// hide its UI entirely, for editions where it's inapplicable or when explicitly turned off.
export function areOAuthAppsAvailable(): boolean | "hidden" {
  const { deploymentType } = getGristConfig();
  if ((deploymentType === "electron" || deploymentType === "static") ||
    !G.window.gristExperiments?.isEnabled("oauthApps") ||
    !isFeatureEnabled("oauthApps")
  ) {
    return "hidden";
  }
  // Otherwise this is available in full Grist and shows a stub in core (or simulated core).
  return deploymentType !== "core";
}

// Collects and exposes translations, used for sidebar and breadcrumbs.
export const getAccountSettingsName = () => t("Account settings");
export function getPageName(page: AccountPage): DomContents {
  switch (page) {
    case "account": return t("Profile");
    case "authorized-apps": return t("Authorized apps");
    case "developer": return t("Developer");
  }
}

export function buildAccountLeftPanel(owner: MultiHolder, appModel: AppModel): PageSidePanel {
  const panelOpen = Observable.create(owner, true);
  const pageObs = Computed.create(owner, use => use(urlState().state).account || "account");

  function buildPageEntry(page: AccountPage, icon: IconName) {
    return css.cssPageEntry(
      css.cssPageEntry.cls("-selected", use => use(pageObs) === page),
      css.cssPageLink(
        css.cssPageIcon(icon),
        css.cssLinkText(getPageName(page)),
        urlState().setLinkUrl({ account: page }),
      ),
    );
  }

  const content = css.leftPanelBasic(appModel, panelOpen,
    dom("div",
      css.cssTools.cls("-collapsed", use => !use(panelOpen)),
      css.cssSectionHeader(css.cssSectionHeaderText(getAccountSettingsName())),
      buildPageEntry("account", "Settings"),
      areOAuthAppsAvailable() === true ? buildPageEntry("authorized-apps", "Widget") : null,
      buildPageEntry("developer", "Code"),
    ),
  );

  return {
    panelWidth: Observable.create(owner, 240),
    panelOpen,
    content,
    header: dom.create(AppHeader, appModel),
  };
}
