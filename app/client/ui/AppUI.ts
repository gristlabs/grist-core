import { buildDocumentBanners, buildHomeBanners } from "app/client/components/Banners";
import { allCommands } from "app/client/components/commands";
import { ViewAsBanner } from "app/client/components/ViewAsBanner";
import { domAsync } from "app/client/lib/domAsync";
import {
  loadAccountPage,
  loadActivationPage,
  loadAdminPanel,
  loadAuditLogsPage,
  loadBillingPage,
  loadBootPage,
} from "app/client/lib/imports";
import { createSessionObs, isBoolean, isNumber, SessionObs } from "app/client/lib/sessionObs";
import { AppModel, TopAppModel } from "app/client/models/AppModel";
import { DocPageModelImpl } from "app/client/models/DocPageModel";
import { urlState } from "app/client/models/gristUrlState";
import { HomeModelImpl } from "app/client/models/HomeModel";
import { App } from "app/client/ui/App";
import { AppHeader } from "app/client/ui/AppHeader";
import { createBottomBarDoc } from "app/client/ui/BottomBar";
import { createDocMenu } from "app/client/ui/DocMenu";
import { createForbiddenPage, createNotFoundPage, createOtherErrorPage } from "app/client/ui/errorPages";
import { createHomeLeftPane } from "app/client/ui/HomeLeftPane";
import { buildSnackbarDom } from "app/client/ui/NotifyUI";
import { OAuthFlowUI } from "app/client/ui/OAuthFlow";
import { OnboardingPage, shouldShowOnboardingPage } from "app/client/ui/OnboardingPage";
import { IInnerLeftPanel, pagePanels } from "app/client/ui/PagePanels";
import { RightPanel } from "app/client/ui/RightPanel";
import { createTopBarDoc, createTopBarHome } from "app/client/ui/TopBar";
import { WelcomePage } from "app/client/ui/WelcomePage";
import { isNarrowScreenObs, testId } from "app/client/ui2018/cssVars";
import { getPageTitleSuffix } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, dom, IDisposable, IDisposableOwner, Observable, replaceContent, subscribe } from "grainjs";

// When integrating into the old app, we might in theory switch between new-style and old-style
// content. This function allows disposing the created content by old-style code.
// TODO once #newui is gone, we don't need to worry about this being disposable.
// appObj is the App object from app/client/ui/App.ts
export function createAppUI(topAppModel: TopAppModel, appObj: App): IDisposable {
  const content = dom.maybe(topAppModel.appObs, (appModel) => {
    return [
      createMainPage(appModel, appObj),
      buildSnackbarDom(appModel.notifier, appModel),
    ];
  });
  dom.update(document.body, content, {
    // Cancel out bootstrap's overrides.
    style: "font-family: inherit; font-size: inherit; line-height: inherit;",
  });

  function dispose() {
    // Return value of dom.maybe() / dom.domComputed() is a pair of markers with a function that
    // replaces content between them when an observable changes. It's uncommon to dispose the set
    // with the markers, and grainjs doesn't provide a helper, but we can accomplish it by
    // disposing the markers. They will automatically trigger the disposal of the included
    // content. This avoids the need to wrap the contents in another layer of a dom element.
    const [beginMarker, endMarker] = content;
    replaceContent(beginMarker, endMarker, null);
    dom.domDispose(beginMarker);
    dom.domDispose(endMarker);
    document.body.removeChild(beginMarker);
    document.body.removeChild(endMarker);
  }
  return { dispose };
}

function createMainPage(appModel: AppModel, appObj: App) {
  // The OAuth flow has its own page, in ext/, signalled via gristConfig.oauth.
  if (getGristConfig().oauth) {
    return OAuthFlowUI.buildOAuthFlow(appModel, appObj);
  }
  if (!appModel.currentOrg && appModel.needsOrg.get()) {
    const err = appModel.orgError;
    if (err?.status === 404) {
      return createNotFoundPage(appModel, err.error);
    } else if (err && (err.status === 401 || err.status === 403)) {
      // Generally give access denied error.
      // The exception is for document pages, where we want to allow access to documents
      // shared publicly without being shared specifically with the current user.
      if (appModel.pageType.get() !== "doc") {
        return createForbiddenPage(appModel);
      }
    } else {
      return createOtherErrorPage(appModel, err?.error);
    }
  }
  return dom.domComputed(appModel.pageType, (pageType) => {
    if (pageType === "home") {
      return dom.create(pagePanelsHome, appModel, appObj);
    } else if (["billing", "site-settings"].includes(pageType)) {
      return domAsync(loadBillingPage().then(bp => bp.buildMainBillingPage(appModel)));
    } else if (pageType === "welcome") {
      return dom.create(WelcomePage, appModel, appObj);
    } else if (pageType === "account") {
      return domAsync(loadAccountPage().then(ap => dom.create(ap.AccountPage, appModel, appObj)));
    } else if (pageType === "admin") {
      return domAsync(loadAdminPanel().then(m => dom.create(m.AdminPanel, appModel, appObj)));
    } else if (pageType === "activation") {
      return domAsync(loadActivationPage().then(ap => dom.create(ap.getActivationPage(), appModel)));
    } else if (pageType === "audit-logs") {
      return domAsync(loadAuditLogsPage().then(m => dom.create(m.AuditLogsPage, appModel, appObj)));
    } else if (pageType === "boot") {
      return domAsync(loadBootPage().then(m => dom.create(m.BootPage, appModel, appObj)));
    } else {
      return dom.create(pagePanelsDoc, appModel, appObj);
    }
  });
}

function pagePanelsHome(owner: IDisposableOwner, appModel: AppModel, app: App) {
  if (shouldShowOnboardingPage(appModel.userPrefsObs)) {
    return dom.create(OnboardingPage, appModel);
  }

  const pageModel = HomeModelImpl.create(owner, appModel, app.clientScope);
  const leftPanelOpen = Observable.create(owner, true);

  // Set document title to strings like "Home - Grist" or "Org Name - Grist".
  owner.autoDispose(subscribe(pageModel.currentPage, pageModel.currentWS, (use, page, ws) => {
    const name = (
      page === "trash" ? "Trash" :
        page === "templates" ? "Examples & Templates" :
          ws ? ws.name : appModel.currentOrgName
    );
    document.title = `${name}${getPageTitleSuffix(getGristConfig())}`;
  }));

  return pagePanels({
    leftPanel: {
      panelWidth: Observable.create(owner, 240),
      panelOpen: leftPanelOpen,
      hideOpener: true,
      header: dom.create(AppHeader, appModel),
      content: createHomeLeftPane(leftPanelOpen, pageModel),
    },
    headerMain: createTopBarHome(appModel),
    contentMain: createDocMenu(pageModel),
    contentTop: buildHomeBanners(appModel),
    testId,
    app,
  });
}

function pagePanelsDoc(owner: IDisposableOwner, appModel: AppModel, appObj: App) {
  const pageModel = DocPageModelImpl.create(owner, appObj, appModel);
  // To simplify manual inspection in the common case, keep the most recently created
  // DocPageModel available as a global variable.
  window.gristDocPageModel = pageModel;
  appObj.pageModel = pageModel;

  const leftPanelOpen = createSessionObs<boolean>(owner, "leftPanelOpen", true, isBoolean);
  const rightPanelOpen = createSessionObs<boolean>(owner, "rightPanelOpen", false, isBoolean);
  const leftPanelWidth = createSessionObs<number>(owner, "leftPanelWidth", 240, isNumber);
  const rightPanelWidth = createSessionObs<number>(owner, "rightPanelWidth", 240, isNumber);
  const innerLeftPanelWidth = createSessionObs<number>(owner, "innerLeftPanelWidth", 440, isNumber);

  collapseNavWithInnerLeftPanel(owner, pageModel.innerLeftPanelOpen, leftPanelOpen, rightPanelOpen);

  const sidebarParam = urlState().state.get().params?.sidebar;
  if (sidebarParam === "collapsed") {
    leftPanelOpen.pauseSaving(true);
    leftPanelOpen.set(false);
    leftPanelOpen.pauseSaving(false);
  }
  else if (sidebarParam === "expanded") {
    leftPanelOpen.pauseSaving(true);
    leftPanelOpen.set(true);
    leftPanelOpen.pauseSaving(false);
  }

  // The RightPanel component gets created only when an instance of GristDoc is set in pageModel.
  // use.owner is a feature of grainjs to make the new RightPanel owned by the computed itself:
  // each time the gristDoc observable changes (and triggers the callback), the previously-created
  // instance of RightPanel will get disposed.
  const rightPanel = Computed.create(owner, pageModel.gristDoc, (use, gristDoc) =>
    gristDoc ? RightPanel.create(use.owner, gristDoc, rightPanelOpen) : null);

  const innerLeftPanel = Computed.create(owner, use => use(pageModel.gristDoc)?.innerLeftPanel ?? null);
  const innerLeftPanelOpen = Computed.create(owner, (use) => {
    const gristDoc = use(pageModel.gristDoc);
    // Document is still loading: use last-saved panel state to skip animation.
    if (!gristDoc) { return use(pageModel.innerLeftPanelOpen); }

    return Boolean(gristDoc.innerLeftPanel) && use(pageModel.innerLeftPanelOpen);
  }).onWrite(val => pageModel.innerLeftPanelOpen.set(val));

  owner.autoDispose(subscribe(pageModel.gristDoc, (_use, gristDoc) => {
    if (gristDoc && !gristDoc.innerLeftPanel) { pageModel.innerLeftPanelOpen.set(false); }
  }));

  const innerLeftPanelMounted = Observable.create<IInnerLeftPanel | null>(owner, null);
  owner.autoDispose(subscribe(innerLeftPanel, innerLeftPanelOpen, (use, panel, open) => {
    if (panel !== innerLeftPanelMounted.get()) {
      innerLeftPanelMounted.set(open ? panel : null);
    }
  }));

  // Set document title to strings like "DocName - Grist"
  owner.autoDispose(subscribe(pageModel.currentDocTitle, (use, docName) => {
    // If the document hasn't loaded yet, don't update the title; since the HTML document already has
    // a title element with the document's name, there's no need for further action.
    if (!pageModel.currentDoc.get()) { return; }

    document.title = `${docName}${getPageTitleSuffix(getGristConfig())}`;
  }));

  // Called after either panel is closed, opened, or resized.
  function onResize() {
    const gristDoc = pageModel.gristDoc.get();
    if (gristDoc) { gristDoc.resizeEmitter.emit(); }
  }

  return pagePanels({
    leftPanel: {
      panelWidth: leftPanelWidth,
      panelOpen: leftPanelOpen,
      header: dom.create(AppHeader, appModel, pageModel),
      content: pageModel.createLeftPane(leftPanelOpen),
    },
    innerLeftPanel: {
      panelWidth: innerLeftPanelWidth,
      panelOpen: innerLeftPanelOpen,
      content: dom.maybe(innerLeftPanelMounted, panel => panel.buildDom()),
    },
    rightPanel: {
      panelWidth: rightPanelWidth,
      panelOpen: rightPanelOpen,
      header: dom.maybe(rightPanel, panel => panel.header),
      content: dom.maybe(rightPanel, panel => panel.content),
    },
    headerMain: dom.create(createTopBarDoc, appModel, pageModel),
    contentMain: dom.maybe(pageModel.gristDoc, gristDoc => gristDoc.buildDom()),
    onResize,
    testId,
    contentTop: buildDocumentBanners(pageModel),
    contentBottom: dom.create(createBottomBarDoc, pageModel, leftPanelOpen, rightPanelOpen),
    banner: dom.create(ViewAsBanner, pageModel),
    app: appObj,
  });
}

/**
 * Collapses the left nav panel while the inner left panel is open and reopens
 * it when the inner left panel closes.
 */
function collapseNavWithInnerLeftPanel(
  owner: IDisposableOwner,
  innerLeftOpen: Observable<boolean>,
  leftOpen: SessionObs<boolean>,
  rightOpen: Observable<boolean>,
) {
  const restoreNav = createSessionObs<boolean>(owner, "innerLeftPanelRestoreNav", false, isBoolean);

  owner.autoDispose(innerLeftOpen.addListener((open) => {
    const narrow = isNarrowScreenObs().get();
    if (open) {
      const restore = !narrow && leftOpen.get() && !leftOpen.isSavingPaused();
      leftOpen.set(false);
      if (narrow) { rightOpen.set(false); }
      if (restore) { restoreNav.set(true); }
    } else if (!narrow) {
      if (restoreNav.get()) {
        // Also pins the nav if it's currently expanded via hover.
        allCommands.leftPanelOpen.run();
      } else if (leftOpen.isSavingPaused()) {
        // Collapse a nav that's expanded via hover.
        leftOpen.set(false);
      }
      restoreNav.set(false);
    }
  }));

  owner.autoDispose(leftOpen.addListener(() => {
    // Ignore hover expansion and collapse, which pause saving while they run.
    if (innerLeftOpen.get() && !leftOpen.isSavingPaused()) { restoreNav.set(false); }
  }));
}
