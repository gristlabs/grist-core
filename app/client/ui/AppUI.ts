import {buildDocumentBanners, buildHomeBanners} from 'app/client/components/Banners';
import {ViewAsBanner} from 'app/client/components/ViewAsBanner';
import {domAsync} from 'app/client/lib/domAsync';
import {loadAccountPage, loadActivationPage, loadAdminPanel, loadBillingPage} from 'app/client/lib/imports';
import {createSessionObs, isBoolean, isNumber} from 'app/client/lib/sessionObs';
import {AppModel, TopAppModel} from 'app/client/models/AppModel';
import {DocPageModelImpl} from 'app/client/models/DocPageModel';
import {HomeModelImpl} from 'app/client/models/HomeModel';
import {App} from 'app/client/ui/App';
import {AppHeader} from 'app/client/ui/AppHeader';
import {createBottomBarDoc} from 'app/client/ui/BottomBar';
import {createDocMenu} from 'app/client/ui/DocMenu';
import {createForbiddenPage, createNotFoundPage, createOtherErrorPage} from 'app/client/ui/errorPages';
import {createHomeLeftPane} from 'app/client/ui/HomeLeftPane';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {pagePanels} from 'app/client/ui/PagePanels';
import {RightPanel} from 'app/client/ui/RightPanel';
import {createTopBarDoc, createTopBarHome} from 'app/client/ui/TopBar';
import {WelcomePage} from 'app/client/ui/WelcomePage';
import {attachTheme, testId} from 'app/client/ui2018/cssVars';
import {getPageTitleSuffix} from 'app/common/gristUrls';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, IDisposable, IDisposableOwner, Observable, replaceContent, subscribe} from 'grainjs';

// When integrating into the old app, we might in theory switch between new-style and old-style
// content. This function allows disposing the created content by old-style code.
// TODO once #newui is gone, we don't need to worry about this being disposable.
// appObj is the App object from app/client/ui/App.ts
export function createAppUI(topAppModel: TopAppModel, appObj: App): IDisposable {
  const content = dom.maybeOwned(topAppModel.appObs, (owner, appModel) => {
    owner.autoDispose(attachTheme(appModel.currentTheme));

    return [
      createMainPage(appModel, appObj),
      buildSnackbarDom(appModel.notifier, appModel),
    ];
  });
  dom.update(document.body, content, {
    // Cancel out bootstrap's overrides.
    style: 'font-family: inherit; font-size: inherit; line-height: inherit;'
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
  return {dispose};
}

function createMainPage(appModel: AppModel, appObj: App) {
  if (!appModel.currentOrg && appModel.needsOrg.get()) {
    const err = appModel.orgError;
    if (err && err.status === 404) {
      return createNotFoundPage(appModel);
    } else if (err && (err.status === 401 || err.status === 403)) {
      // Generally give access denied error.
      // The exception is for document pages, where we want to allow access to documents
      // shared publicly without being shared specifically with the current user.
      if (appModel.pageType.get() !== 'doc') {
        return createForbiddenPage(appModel);
      }
    } else {
      return createOtherErrorPage(appModel, err && err.error);
    }
  }
  return dom.domComputed(appModel.pageType, (pageType) => {
    if (pageType === 'home') {
      return dom.create(pagePanelsHome, appModel, appObj);
    } else if (pageType === 'billing') {
      return domAsync(loadBillingPage().then(bp => dom.create(bp.BillingPage, appModel)));
    } else if (pageType === 'welcome') {
      return dom.create(WelcomePage, appModel);
    } else if (pageType === 'account') {
      return domAsync(loadAccountPage().then(ap => dom.create(ap.AccountPage, appModel)));
    } else if (pageType === 'admin') {
      return domAsync(loadAdminPanel().then(m => dom.create(m.AdminPanel, appModel)));
    } else if (pageType === 'activation') {
      return domAsync(loadActivationPage().then(ap => dom.create(ap.ActivationPage, appModel)));
    } else {
      return dom.create(pagePanelsDoc, appModel, appObj);
    }
  });
}

function pagePanelsHome(owner: IDisposableOwner, appModel: AppModel, app: App) {
  const pageModel = HomeModelImpl.create(owner, appModel, app.clientScope);
  const leftPanelOpen = Observable.create(owner, true);

  // Set document title to strings like "Home - Grist" or "Org Name - Grist".
  owner.autoDispose(subscribe(pageModel.currentPage, pageModel.currentWS, (use, page, ws) => {
    const name = (
      page === 'trash' ? 'Trash' :
      page === 'templates' ? 'Examples & Templates' :
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
  });
}

function pagePanelsDoc(owner: IDisposableOwner, appModel: AppModel, appObj: App) {
  const pageModel = DocPageModelImpl.create(owner, appObj, appModel);
  // To simplify manual inspection in the common case, keep the most recently created
  // DocPageModel available as a global variable.
  (window as any).gristDocPageModel = pageModel;
  appObj.setDocPageModel(pageModel);
  const leftPanelOpen = createSessionObs<boolean>(owner, "leftPanelOpen", true, isBoolean);
  const rightPanelOpen = createSessionObs<boolean>(owner, "rightPanelOpen", false, isBoolean);
  const leftPanelWidth = createSessionObs<number>(owner, "leftPanelWidth", 240, isNumber);
  const rightPanelWidth = createSessionObs<number>(owner, "rightPanelWidth", 240, isNumber);

  // The RightPanel component gets created only when an instance of GristDoc is set in pageModel.
  // use.owner is a feature of grainjs to make the new RightPanel owned by the computed itself:
  // each time the gristDoc observable changes (and triggers the callback), the previously-created
  // instance of RightPanel will get disposed.
  const rightPanel = Computed.create(owner, pageModel.gristDoc, (use, gristDoc) =>
    gristDoc ? RightPanel.create(use.owner, gristDoc, rightPanelOpen) : null);

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
    rightPanel: {
      panelWidth: rightPanelWidth,
      panelOpen: rightPanelOpen,
      header: dom.maybe(rightPanel, (panel) => panel.header),
      content: dom.maybe(rightPanel, (panel) => panel.content),
    },
    headerMain: dom.create(createTopBarDoc, appModel, pageModel, appObj.allCommands),
    contentMain: dom.maybe(pageModel.gristDoc, (gristDoc) => gristDoc.buildDom()),
    onResize,
    testId,
    contentTop: buildDocumentBanners(pageModel),
    contentBottom: dom.create(createBottomBarDoc, pageModel, leftPanelOpen, rightPanelOpen),
    banner: dom.create(ViewAsBanner, pageModel),
  });
}
