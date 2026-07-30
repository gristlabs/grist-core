import { makeTestId } from "app/client/lib/domUtils";
import { makeT } from "app/client/lib/localization";
import { urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import * as css from "app/client/ui/LeftPanelCommon";
import { PageSidePanel } from "app/client/ui/PagePanels";
import { infoTooltip } from "app/client/ui/tooltips";
import { theme } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { cssLink } from "app/client/ui2018/links";
import { AdminPanelPage } from "app/common/gristUrls";
import { commonUrls } from "app/common/gristUrls";
import { getAdminConfig } from "app/common/urlUtils";

import { Computed, dom, DomContents, MultiHolder, Observable, styled } from "grainjs";

import type { AppModel } from "app/client/models/AppModel";
import type { RestartBannerController } from "app/client/ui/AdminPanel";

const t = makeT("AdminLeftPanel");
const testId = makeTestId("test-admin-controls-");

// Check if the AdminControls feature is available, so that we can show it as such in the UI.
export function areAdminControlsAvailable(): boolean {
  return Boolean(getAdminConfig().adminControls);
}

// Collects and exposes translations, used for buildAdminLeftPanel() below, and for breadcrumbs in
// AdminPanel.ts.
export function getPageNames() {
  const settings: DomContents = t("Settings");
  const adminControls: DomContents = t("Admin Controls");
  return {
    settings,
    adminControls,
    pages: {
      admin: { section: settings, name: t("Installation") },
      setup: { section: settings, name: t("Quick setup") },
      users: { section: adminControls, name: t("Users") },
      orgs: { section: adminControls, name: t("Orgs") },
      workspaces: { section: adminControls, name: t("Workspaces") },
      docs: { section: adminControls, name: t("Docs") },
    } as { [key in AdminPanelPage]: { section: DomContents, name: DomContents } },
  };
}

export function buildAdminLeftPanel(
  owner: MultiHolder,
  appModel: AppModel,
  restartBanner?: RestartBannerController,
): PageSidePanel {
  const pageObs = Computed.create(owner, use => use(urlState().state).adminPanel);

  const isSetup = pageObs.get() === "setup";
  const panelOpen = Observable.create(owner, !isSetup);

  // On the setup page, fully hide the collapsed left panel and revert back to default collapsed
  // width after panel has been opened.
  const collapsedWidth = Observable.create(owner, isSetup ? 0 : undefined);
  owner.autoDispose(panelOpen.addListener(() => collapsedWidth.set(undefined)));

  const pageNames = getPageNames();

  function buildPageEntry(page: AdminPanelPage, icon: IconName, available: boolean = true) {
    return css.cssPageEntry(
      css.cssPageEntry.cls("-selected", use => use(pageObs) === page),
      css.cssPageEntry.cls("-disabled", !available),
      css.cssPageLink(
        css.cssPageIcon(icon),
        css.cssLinkText(pageNames.pages[page].name),
        available ? urlState().setLinkUrl({ adminPanel: page }) : null,    // Disable link if page isn't available.
      ),
      testId("page-" + page),
      testId("page"),
    );
  }

  const adminControlsAvailable = areAdminControlsAvailable();
  const content = css.leftPanelBasic(appModel, panelOpen,
    dom("div",
      css.cssTools.cls("-collapsed", use => !use(panelOpen)),
      css.cssSectionHeader(css.cssSectionHeaderText(pageNames.settings)),
      buildPageEntry("admin", "Home"),
      buildPageEntry("setup", "Settings"),
      restartBanner ? dom.maybe(restartBanner.isVisible, () =>
        cssApplyChangesEntry(
          css.cssPageButton(
            css.cssPageIcon("Warning"),
            css.cssLinkText(t("Apply changes")),
            dom.on("click", () => restartBanner.focus()),
          ),
          testId("page-apply-changes"),
        ),
      ) : null,
      css.cssSectionHeader(css.cssSectionHeaderText(pageNames.adminControls),
        (adminControlsAvailable ?
          infoTooltip("adminControls", { popupOptions: { placement: "bottom-start" } }) :
          css.cssPill(t("Enterprise"), testId("enterprise-tag"))
        ),
      ),
      buildPageEntry("users", "AddUser", adminControlsAvailable),
      buildPageEntry("orgs", "Public", adminControlsAvailable),
      buildPageEntry("workspaces", "Board", adminControlsAvailable),
      buildPageEntry("docs", "Page", adminControlsAvailable),
      (adminControlsAvailable ? null :
        cssPanelLink(cssLearnMoreLink(
          { href: commonUrls.helpAdminControls, target: "_blank" },
          t("Learn more"), css.cssPageIcon("FieldLink"),
          testId("learn-more"),
        ))
      ),
    ),
  );

  return {
    panelWidth: Observable.create(owner, 240),
    panelOpen: panelOpen,
    collapsedWidth,
    content,
    header: dom.create(AppHeader, appModel),
  };
}

const cssPanelLink = styled("div", `
  margin: 8px 24px;
  .${css.cssTools.className}-collapsed > & {
    visibility: hidden;
  }
`);

const cssLearnMoreLink = styled(cssLink, `
  display: inline-flex;
  gap: 8px;
  align-items: center;
`);

const cssApplyChangesEntry = styled(css.cssPageEntry, `
  color: ${theme.dangerText};
  --icon-color: ${theme.dangerText};
  cursor: pointer;
  & .${css.cssPageLink.className} {
    color: inherit;
  }
`);
