import {domAsync} from 'app/client/lib/domAsync';
import {loadBillingPage} from 'app/client/lib/imports';
import {createSessionObs, isBoolean, isNumber} from 'app/client/lib/sessionObs';
import {AppModel, TopAppModel} from 'app/client/models/AppModel';
import {DocPageModelImpl} from 'app/client/models/DocPageModel';
import {HomeModelImpl} from 'app/client/models/HomeModel';
import {App} from 'app/client/ui/App';
import {appHeader} from 'app/client/ui/AppHeader';
import {createBottomBarDoc} from 'app/client/ui/BottomBar';
import {createDocMenu} from 'app/client/ui/DocMenu';
import {createForbiddenPage, createNotFoundPage, createOtherErrorPage} from 'app/client/ui/errorPages';
import {createHomeLeftPane} from 'app/client/ui/HomeLeftPane';
import {buildSnackbarDom} from 'app/client/ui/NotifyUI';
import {pagePanels} from 'app/client/ui/PagePanels';
import {RightPanel} from 'app/client/ui/RightPanel';
import {createTopBarDoc, createTopBarHome} from 'app/client/ui/TopBar';
import {WelcomePage} from 'app/client/ui/WelcomePage';
import {isNarrowScreen, testId} from 'app/client/ui2018/cssVars';
import {Computed, dom, IDisposable, IDisposableOwner, Observable, replaceContent, subscribe} from 'grainjs';

// When integrating into the old app, we might in theory switch between new-style and old-style
// content. This function allows disposing the created content by old-style code.
// TODO once #newui is gone, we don't need to worry about this being disposable.
// appObj is the App object from app/client/ui/App.ts
export function createAppUI(topAppModel: TopAppModel, appObj: App): IDisposable {
  const content = dom.maybe(topAppModel.appObs, (appModel) => [
    createMainPage(appModel, appObj),
    buildSnackbarDom(appModel.notifier, appModel),
  ]);
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
  if (!appModel.currentOrg && appModel.pageType.get() !== 'welcome') {
    const err = appModel.orgError;
    if (err && err.status === 404) {
      return createNotFoundPage(appModel);
    } else if (err && (err.status === 401 || err.status === 403)) {
      // Generally give access denied error.
      // The exception is for document pages, where we want to allow access to documents
      // shared publically without being shared specifically with the current user.
      if (appModel.pageType.get() !== 'doc') {
        return createForbiddenPage(appModel);
      }
    } else {
      return createOtherErrorPage(appModel, err && err.error);
    }
  }
  return dom.domComputed(appModel.pageType, (pageType) => {
    if (pageType === 'home') {
      return dom.create(pagePanelsHome, appModel);
    } else if (pageType === 'billing') {
      return domAsync(loadBillingPage().then(bp => dom.create(bp.BillingPage, appModel)));
    } else if (pageType === 'welcome') {
      return dom.create(WelcomePage, appModel);
    } else {
      return dom.create(pagePanelsDoc, appModel, appObj);
    }
  });
}

function pagePanelsHome(owner: IDisposableOwner, appModel: AppModel) {
  const pageModel = HomeModelImpl.create(owner, appModel);
  const leftPanelOpen = Observable.create(owner, true);

  // Set document title to strings like "Home - Grist" or "Org Name - Grist".
  owner.autoDispose(subscribe(pageModel.currentPage, pageModel.currentWS, (use, page, ws) => {
    const name = (
      page === 'trash' ? 'Trash' :
      ws ? ws.name : appModel.currentOrgName
    );
    document.title = `${name} - Grist`;
  }));

  return pagePanels({
    leftPanel: {
      panelWidth: Observable.create(owner, 240),
      panelOpen: leftPanelOpen,
      hideOpener: true,
      header: appHeader(appModel.currentOrgName, appModel.topAppModel.productFlavor),
      content: createHomeLeftPane(leftPanelOpen, pageModel),
    },
    headerMain: createTopBarHome(appModel),
    contentMain: createDocMenu(pageModel),
    optimizeNarrowScreen: true,
  });
}

// Create session observable. But if device is a narrow screen create a regular observable.
function createPanelObs<T>(owner: IDisposableOwner, key: string, _default: T, isValid: (val: any) => val is T) {
  if (isNarrowScreen()) {
    return Observable.create(owner, _default);
  }
  return createSessionObs<T>(owner, key, _default, isValid);
}

function pagePanelsDoc(owner: IDisposableOwner, appModel: AppModel, appObj: App) {
  const pageModel = DocPageModelImpl.create(owner, appObj, appModel);
  // To simplify manual inspection in the common case, keep the most recently created
  // DocPageModel available as a global variable.
  (window as any).gristDocPageModel = pageModel;
  const leftPanelOpen = createPanelObs<boolean>(owner, "leftPanelOpen", isNarrowScreen() ? false : true,
                                                       isBoolean);
  const rightPanelOpen = createPanelObs<boolean>(owner, "rightPanelOpen", false, isBoolean);
  const leftPanelWidth = createPanelObs<number>(owner, "leftPanelWidth", 240, isNumber);
  const rightPanelWidth = createPanelObs<number>(owner, "rightPanelWidth", 240, isNumber);

  // The RightPanel component gets created only when an instance of GristDoc is set in pageModel.
  // use.owner is a feature of grainjs to make the new RightPanel owned by the computed itself:
  // each time the gristDoc observable changes (and triggers the callback), the previously-created
  // instance of RightPanel will get disposed.
  const rightPanel = Computed.create(owner, pageModel.gristDoc, (use, gristDoc) =>
    gristDoc ? RightPanel.create(use.owner, gristDoc, rightPanelOpen) : null);

  // Set document title to strings like "DocName - Grist"
  owner.autoDispose(subscribe(pageModel.currentDocTitle, (use, docName) => {
    document.title = `${docName} - Grist`;
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
      header: appHeader(appModel.currentOrgName || pageModel.currentOrgName, appModel.topAppModel.productFlavor),
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
    optimizeNarrowScreen: true,
    contentBottom: dom.create(createBottomBarDoc, pageModel, leftPanelOpen, rightPanelOpen)
  });
}
