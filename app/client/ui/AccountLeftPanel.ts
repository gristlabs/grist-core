import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import * as css from "app/client/ui/LeftPanelCommon";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, dom, DomContents, MultiHolder, Observable } from "grainjs";

import type { AppModel } from "app/client/models/AppModel";
import type { PageSidePanel } from "app/client/ui/PagePanels";
import type { IconName } from "app/client/ui2018/IconList";
import type { AccountPage } from "app/common/gristUrls";

const t = makeT("AccountLeftPanel");

// Whether OAuth Apps feature is available (EE/SaaS only, not core).
export function areOAuthAppsAvailable(): boolean {
  // TODO: This is temporarily here to switch between core/ext UI without restarting.
  if (new URLSearchParams(window.location.search).get("simulate-core")) { return false; }
  return getGristConfig().deploymentType !== "core";
}

// Collects and exposes translations, used for sidebar and breadcrumbs.
export const getAccountSettingsName = () => t("Account settings");
export function getPageName(page: AccountPage): DomContents {
  switch (page) {
    case "account": return t("Profile");
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
