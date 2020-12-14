import {GristDoc} from 'app/client/components/GristDoc';
import {loadSearch} from 'app/client/lib/imports';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {workspaceName} from 'app/client/models/WorkspaceInfo';
import {AccountWidget} from 'app/client/ui/AccountWidget';
import {buildNotifyMenuButton} from 'app/client/ui/NotifyUI';
import {buildShareMenuButton} from 'app/client/ui/ShareMenu';
import {cssHoverCircle, cssTopBarBtn} from 'app/client/ui/TopBarCss';
import {docBreadcrumbs} from 'app/client/ui2018/breadcrumbs';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {waitGrainObs} from 'app/common/gutil';
import {Computed, dom, DomElementArg, makeTestId, MultiHolder, Observable, styled} from 'grainjs';

export function createTopBarHome(appModel: AppModel) {
  return [
    cssFlexSpace(),
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
          isRecoveryMode: pageModel.isRecoveryMode,
          isFiddle: Computed.create(owner, (use) => use(pageModel.isPrefork) && !use(pageModel.isSample)),
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
        cssHoverCircle.cls('-disabled', state.isUndoDisabled),
        testId('undo')
      ),
      topBarUndoBtn('Redo',
        dom.on('click', () => state.isRedoDisabled.get() || allCommands.redo.run()),
        cssHoverCircle.cls('-disabled', state.isRedoDisabled),
        testId('redo')
      ),
      cssSpacer(),
    ]),
    dom.domComputed(searchBarContent),

    buildShareMenuButton(pageModel),

    buildNotifyMenuButton(appModel.notifier, appModel),

    dom('div', dom.create(AccountWidget, appModel, pageModel))
  ];
}

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
  background-color: ${colors.slate};

  .${cssHoverCircle.className}:hover & {
    background-color: ${colors.lightGreen};
  }

  .${cssHoverCircle.className}-disabled:hover & {
    background-color: ${colors.darkGrey};
    cursor: default;
  }
`);

const cssBreadcrumbContainer = styled('div', `
  padding: 7px;
  flex: 1 1 auto;
  min-width: 0px;
  overflow: hidden;
`);

const cssFlexSpace = styled('div', `
  flex: 1 1 0px;
`);

const cssSpacer = styled('div', `
  width: 10px;
`);
