import {GristDoc} from 'app/client/components/GristDoc';
import {loadSearch} from 'app/client/lib/imports';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {workspaceName} from 'app/client/models/WorkspaceInfo';
import {AccountWidget} from 'app/client/ui/AccountWidget';
import {buildNotifyMenuButton} from 'app/client/ui/NotifyUI';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {buildShareMenuButton} from 'app/client/ui/ShareMenu';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {cssHoverCircle, cssTopBarBtn} from 'app/client/ui/TopBarCss';
import {docBreadcrumbs} from 'app/client/ui2018/breadcrumbs';
import {basicButton} from 'app/client/ui2018/buttons';
import {cssHideForNarrowScreen, testId, theme} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {menuAnnotate} from 'app/client/ui2018/menus';
import {COMMENTS} from 'app/client/models/features';
import {waitGrainObs} from 'app/common/gutil';
import * as roles from 'app/common/roles';
import {Computed, dom, DomElementArg, makeTestId, MultiHolder, Observable, styled} from 'grainjs';

export function createTopBarHome(appModel: AppModel) {
  return [
    cssFlexSpace(),

    (appModel.isTeamSite && roles.canEditAccess(appModel.currentOrg?.access || null) ?
      [
        basicButton(
          'Manage Team',
          dom.on('click', () => manageTeamUsersApp(appModel)),
          testId('topbar-manage-team')
        ),
        cssSpacer()
      ] :
      null
    ),

    buildNotifyMenuButton(appModel.notifier, appModel),
    dom('div', dom.create(AccountWidget, appModel)),
  ];
}

export function createTopBarDoc(owner: MultiHolder, appModel: AppModel, pageModel: DocPageModel, allCommands: any) {
  const doc = pageModel.currentDoc;
  const renameDoc = (val: string) => pageModel.renameDoc(val);
  const displayNameWs = Computed.create(owner, pageModel.currentWorkspace,
    (use, ws) => ws ? {...ws, name: workspaceName(appModel, ws)} : ws);
  const searchBarContent = Observable.create<HTMLElement|null>(owner, null);

  loadSearch()
    .then(async module => {
      const model = module.SearchModelImpl.create(owner, (await waitGrainObs(pageModel.gristDoc))!);
      searchBarContent.set(module.searchBar(model, makeTestId('test-tb-search-')));
    })
    .catch(reportError);

  return [
    // TODO Before gristDoc is loaded, we could show doc-name without the page. For now, we delay
    // showing of breadcrumbs until gristDoc is loaded.
    dom.maybe(pageModel.gristDoc, (gristDoc) =>
      cssBreadcrumbContainer(
        docBreadcrumbs(displayNameWs, pageModel.currentDocTitle, gristDoc.currentPageName, {
          docNameSave: renameDoc,
          pageNameSave: getRenamePageFn(gristDoc),
          cancelRecoveryMode: getCancelRecoveryModeFn(gristDoc),
          isPageNameReadOnly: (use) => use(gristDoc.isReadonly) || typeof use(gristDoc.activeViewId) !== 'number',
          isDocNameReadOnly: (use) => use(gristDoc.isReadonly) || use(pageModel.isFork),
          isFork: pageModel.isFork,
          isBareFork: pageModel.isBareFork,
          isRecoveryMode: pageModel.isRecoveryMode,
          userOverride: pageModel.userOverride,
          isFiddle: Computed.create(owner, (use) => use(pageModel.isPrefork)),
          isSnapshot: Computed.create(owner, doc, (use, _doc) => Boolean(_doc && _doc.idParts.snapshotId)),
          isPublic: Computed.create(owner, doc, (use, _doc) => Boolean(_doc && _doc.public)),
        })
      )
    ),
    cssFlexSpace(),

    // Don't show useless undo/redo buttons for sample docs, to leave more space for "Make copy".
    dom.maybe(pageModel.undoState, (state) => [
      topBarUndoBtn('Undo',
        dom.on('click', () => state.isUndoDisabled.get() || allCommands.undo.run()),
        hoverTooltip('Undo', {key: 'topBarBtnTooltip'}),
        cssHoverCircle.cls('-disabled', state.isUndoDisabled),
        testId('undo')
      ),
      topBarUndoBtn('Redo',
        dom.on('click', () => state.isRedoDisabled.get() || allCommands.redo.run()),
        hoverTooltip('Redo', {key: 'topBarBtnTooltip'}),
        cssHoverCircle.cls('-disabled', state.isRedoDisabled),
        testId('redo')
      ),
      cssSpacer(),
    ]),
    dom.domComputed(searchBarContent),

    buildShareMenuButton(pageModel),

    dom.maybe(use =>
      (
        use(pageModel.gristDoc)
        && !use(use(pageModel.gristDoc)!.isReadonly)
        && use(COMMENTS())
      ),
      () => buildShowDiscussionButton(pageModel)),

    dom.update(
      buildNotifyMenuButton(appModel.notifier, appModel),
      cssHideForNarrowScreen.cls(''),
    ),

    dom('div', dom.create(AccountWidget, appModel, pageModel))
  ];
}

function buildShowDiscussionButton(pageModel: DocPageModel) {
  return cssHoverCircle({ style: `margin: 5px; position: relative;` },
    cssTopBarBtn('Chat', dom.cls('tour-share-icon')),
    cssBeta('Beta'),
    hoverTooltip('Comments', {key: 'topBarBtnTooltip'}),
    testId('open-discussion'),
    dom.on('click', () => pageModel.gristDoc.get()!.showTool('discussion'))
  );
}

const cssBeta = styled(menuAnnotate, `
  position: absolute;
  top: 4px;
  right: -9px;
  font-weight: bold;
`);

// Given the GristDoc instance, returns a rename function for the current active page.
// If the current page is not able to be renamed or the new name is invalid, the function is a noop.
function getRenamePageFn(gristDoc: GristDoc): (val: string) => Promise<void> {
  return async (val: string) => {
    const views = gristDoc.docModel.views;
    const viewId = gristDoc.activeViewId.get();
    if (typeof viewId === 'number' && val.length > 0) {
      const name = views.rowModels[viewId].name;
      await name.saveOnly(val);
    }
  };
}

function getCancelRecoveryModeFn(gristDoc: GristDoc): () => Promise<void> {
  return async () => {
    await gristDoc.app.topAppModel.api.getDocAPI(gristDoc.docPageModel.currentDocId.get()!)
      .recover(false);
  };
}

function topBarUndoBtn(iconName: IconName, ...domArgs: DomElementArg[]): Element {
  return cssHoverCircle(
    cssTopBarUndoBtn(iconName),
    ...domArgs
  );
}

const cssTopBarUndoBtn = styled(cssTopBarBtn, `
  background-color: ${theme.topBarButtonSecondaryFg};

  .${cssHoverCircle.className}:hover & {
    background-color: ${theme.topBarButtonPrimaryFg};
  }

  .${cssHoverCircle.className}-disabled:hover & {
    background-color: ${theme.topBarButtonDisabledFg};
    cursor: default;
  }
`);

const cssBreadcrumbContainer = styled('div', `
  padding: 7px;
  flex: 1 1 auto;
  min-width: 24px;
  overflow: hidden;
`);

const cssFlexSpace = styled('div', `
  flex: 1 1 0px;
`);

const cssSpacer = styled('div', `
  max-width: 10px;
  flex: auto;
`);
