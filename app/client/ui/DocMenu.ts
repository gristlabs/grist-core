/**
 * This module exports a DocMenu component, consisting of an organization dropdown, a sidepane
 * of workspaces, and a doc list. The organization and workspace selectors filter the doc list.
 * Orgs, workspaces and docs are fetched asynchronously on build via the passed in API.
 */
import {makeT} from 'app/client/lib/localization';
import {getTimeFromNow} from 'app/client/lib/timeUtils';
import {reportError} from 'app/client/models/AppModel';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel, makeLocalViewSettings, ViewSettings} from 'app/client/models/HomeModel';
import {getWorkspaceInfo, workspaceName} from 'app/client/models/WorkspaceInfo';
import {attachAddNewTip} from 'app/client/ui/AddNewTip';
import {DocList, getUpdatedAt, makeDocOptionsMenu} from 'app/client/ui/DocList';
import * as css from 'app/client/ui/DocMenuCss';
import {buildHomeIntro} from 'app/client/ui/HomeIntro';
import {buildPinnedDoc, createPinnedDocs} from 'app/client/ui/PinnedDocs';
import {buildTemplateDocs} from 'app/client/ui/TemplateDocs';
import {shouldShowWelcomeCoachingCall, showWelcomeCoachingCall} from 'app/client/ui/WelcomeCoachingCall';
import {buttonSelect, cssButtonSelect} from 'app/client/ui2018/buttonSelect';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {menu, menuItem, menuText, select} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {IHomePage} from 'app/common/gristUrls';
import {SortPref, ViewPref} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {Document, Workspace} from 'app/common/UserAPI';
import {
  dom,
  DomArg,
  DomContents,
  DomElementArg,
  makeTestId,
  Observable,
} from 'grainjs';
import sortBy = require('lodash/sortBy');

const t = makeT(`DocMenu`);

const testId = makeTestId('test-dm-');

/**
 * The DocMenu is the main area of the home page, listing all docs.
 *
 * Usage:
 *    dom('div', createDocMenu(homeModel))
 */
export function createDocMenu(home: HomeModel): DomElementArg[] {
  return [
    attachWelcomePopups(home),
    dom.domComputed(home.loading, (loading) => {
      if (loading) {
        return loading === "slow" ? css.spinner(loadingSpinner()) : null;
      }

      return css.docList(
        attachAddNewTip(home),
        css.docListContent(
          css.docMenu(
            dom.domComputed<[IHomePage, Workspace | undefined]>(
              (use) => [use(home.currentPage), use(home.currentWS)],
              ([page, workspace]): Exclude<DomContents, void> => {
                switch (page) {
                  case "all": {
                    return buildAllDocumentsPage(home);
                  }
                  case "workspace": {
                    return buildWorkspacePage(home, workspace);
                  }
                  case "templates": {
                    return buildTemplatesPage(home);
                  }
                  case "trash": {
                    return buildTrashPage(home);
                  }
                }
              }
            ),
            testId("doclist")
          )
        )
      );
    }),
  ];
}

function attachWelcomePopups(home: HomeModel): (el: Element) => void {
  return (element: Element) => {
    const {app} = home;
    if (shouldShowWelcomeCoachingCall(app)) {
      showWelcomeCoachingCall(element, app);
    }
  };
}

function buildAllDocumentsPage(home: HomeModel) {
  return [
    buildHomeIntro(home),
    home.app.isPersonal && !home.app.currentValidUser
      ? null
      : dom.maybe(home.available, () => dom.create(DocList, { home })),
  ];
}

function buildWorkspacePage(home: HomeModel, workspace: Workspace | undefined) {
  if (!workspace) {
    return css.docBlock(t("Workspace not found"));
  }

  const viewSettings = makeLocalViewSettings(home, workspace.id);
  return [
    dom.maybe(home.available, () => [
      css.stickyHeader(
        css.workspaceHeaderWrap(
          css.workspaceHeaderIcon("Folder2"),
          css.workspaceHeader(
            workspaceName(home.app, workspace),
          ),
          testId("doc-header")
        ),
      ),
      dom.create(DocList, {
        home,
        viewSettings,
      }),
    ]),
  ];
}

function buildTemplatesPage(home: HomeModel) {
  const viewSettings = makeLocalViewSettings(home, "templates");
  return [
    dom.maybe(
      (use) => use(home.featuredTemplates).length > 0,
      () => [
        css.featuredTemplatesHeader(
          css.featuredTemplatesIcon("Idea"),
          t("Featured"),
          testId("featured-templates-header")
        ),
        createPinnedDocs(home, home.featuredTemplates, true),
      ]
    ),
    dom.maybe(home.available, () => [
      css.docListHeaderWrap(
        css.listHeader(
          dom.domComputed(
            (use) => use(home.featuredTemplates).length > 0,
            (hasFeaturedTemplates) =>
              hasFeaturedTemplates
                ? t("More Examples and Templates")
                : t("Examples and Templates")
          ),
          testId("doc-header")
        ),
        buildPrefs(viewSettings)
      ),
      dom(
        "div",
        buildAllTemplates(home, home.templateWorkspaces, viewSettings)
      ),
    ]),
  ];
}

function buildTrashPage(home: HomeModel) {
  const viewSettings = makeLocalViewSettings(home, "trash");
  return dom.maybe(home.available, () => [
    css.docListHeaderWrap(
      css.listHeader(t("Trash"), testId("doc-header")),
      buildPrefs(viewSettings)
    ),
    dom(
      "div",
      css.docBlock(
        t(
          "Documents stay in Trash for 30 days, after which they get deleted permanently."
        )
      ),
      dom.maybe(
        (use) => use(home.trashWorkspaces).length === 0,
        () => css.docBlock(t("Trash is empty."))
      ),
      buildAllDocsBlock(home, home.trashWorkspaces, viewSettings)
    ),
  ]);
}

function buildAllDocsBlock(
  home: HomeModel,
  workspaces: Observable<Workspace[]>,
  viewSettings: ViewSettings
) {
  return dom.forEach(workspaces, (ws) => {
    // Don't show the support workspace -- examples/templates are now retrieved from a special org.
    // TODO: Remove once support workspaces are removed from the backend.
    if (ws.isSupportWorkspace) { return null; }

    return css.docBlock(
      css.docBlockHeaderLink(
        css.wsLeft(
          css.docHeaderIcon('Folder'),
          workspaceName(home.app, ws),
        ),

        (ws.removedAt ?
          [
            css.docRowUpdatedAt(t("Deleted {{at}}", {at:getTimeFromNow(ws.removedAt)})),
            css.docMenuTrigger(icon('Dots')),
            menu(() => makeRemovedWsOptionsMenu(home, ws),
              {placement: 'bottom-end', parentSelectorToMark: '.' + css.docRowWrapper.className}),
          ] :
          urlState().setLinkUrl({ws: ws.id})
        ),

        dom.hide((use) => Boolean(getWorkspaceInfo(home.app, ws).isDefault &&
          use(home.singleWorkspace))),

        testId('ws-header'),
      ),
      buildWorkspaceDocBlock(home, ws, viewSettings),
      testId('doc-block')
    );
  });
}

/**
 * Builds all templates.
 *
 * Templates are grouped by workspace, with each workspace representing a category of
 * templates. Categories are rendered as collapsible menus, and the contained templates
 * can be viewed in both icon and list view.
 *
 * Used on the Examples & Templates below the featured templates.
 */
function buildAllTemplates(home: HomeModel, templateWorkspaces: Observable<Workspace[]>, viewSettings: ViewSettings) {
  return dom.forEach(templateWorkspaces, workspace => {
    return css.templatesDocBlock(
      css.templateBlockHeader(
        css.wsLeft(
          css.docHeaderIcon('Folder'),
          workspace.name,
        ),
        testId('templates-header'),
      ),
      buildTemplateDocs(home, workspace.docs, viewSettings),
      css.docBlock.cls((use) => '-' + use(viewSettings.currentView)),
      testId('templates'),
    );
  });
}

/**
 * Build the widget for selecting sort and view mode options.
 */
function buildPrefs(viewSettings: ViewSettings, ...args: DomArg<HTMLElement>[]) {
  return css.prefSelectors(
    // The Sort selector.
    dom.update(
      select<SortPref>(viewSettings.currentSort, [
          {value: 'name', label: t("By Name")},
          {value: 'date', label: t("By Date Modified")},
        ],
        { buttonCssClass: css.sortSelector.className },
      ),
      testId('sort-mode'),
    ),

    // The View selector.
    buttonSelect<ViewPref>(viewSettings.currentView, [
        {value: 'icons', icon: 'TypeTable', tooltip: t("Grid view")},
        {value: 'list', icon: 'TypeCardList', tooltip: t("List view")},
      ],
      cssButtonSelect.cls("-light"),
      testId('view-mode')
    ),
    ...args
  );
}

function buildWorkspaceDocBlock(
  home: HomeModel,
  workspace: Workspace,
  viewSettings: ViewSettings
) {
  function renderDocs(sort: 'date'|'name', view: "list"|"icons") {
    // Docs are sorted by name in HomeModel, we only re-sort if we want a different order.
    let docs = workspace.docs;
    if (sort === 'date') {
      // Note that timestamps are ISO strings, which can be sorted without conversions.
      docs = sortBy(docs, (doc) => doc.removedAt || doc.updatedAt).reverse();
    }
    return dom.forEach(docs, doc => {
      if (view === 'icons') {
        return dom.update(
          buildPinnedDoc(home, doc, workspace),
          testId('doc'),
        );
      }
      // TODO: Introduce a "SwitchSelector" pattern to avoid the need for N computeds (and N
      // recalculations) to select one of N items.
      return css.docRowWrapper(
        css.docRowLink(
          doc.removedAt ? null : urlState().setLinkUrl(docUrl(doc)),
          css.docRowLink.cls('-no-access', !roles.canView(doc.access)),
          css.docLeft(
            css.docName(doc.name, testId('doc-name')),
            css.docPinIcon('PinSmall', dom.show(doc.isPinned)),
            doc.public ? css.docPublicIcon('Public', testId('public')) : null,
          ),
          css.docRowUpdatedAt(getUpdatedAt(doc), testId('doc-time')),
          (doc.removedAt || doc.disabledAt ?
            [
              // For deleted documents, attach the menu to the entire doc row, and include the
              // "Dots" icon just to clarify that there are options.
              menu(() => makeRemovedDocOptionsMenu(home, doc, workspace),
                {placement: 'bottom-end', parentSelectorToMark: '.' + css.docRowWrapper.className}),
              css.docMenuTrigger(icon('Dots'), testId('doc-options')),
            ] :
            css.docMenuTrigger(icon('Dots'),
              menu(() => makeDocOptionsMenu(home, doc),
                {placement: 'bottom-start', parentSelectorToMark: '.' + css.docRowWrapper.className}),
              // Clicks on the menu trigger shouldn't follow the link that it's contained in.
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
              testId('doc-options'),
            )
          ),
        ),
        testId('doc')
      );
    });
  }

  const {currentSort, currentView} = viewSettings;
  return [
    dom.domComputed(
      (use) => ({sort: use(currentSort), view: use(currentView)}),
      (opts) => renderDocs(opts.sort, opts.view)),
    css.docBlock.cls((use) => '-' + use(currentView)),
  ];
}

//  TODO rebuilds of big page chunks (all workspace) cause screen position to jump, sometimes
//  losing the doc that was e.g. just renamed.

export function makeRemovedDocOptionsMenu(home: HomeModel, doc: Document, workspace: Workspace) {
  function hardDeleteDoc() {
    confirmModal(t("Permanently Delete \"{{name}}\"?", {name: doc.name}), t("Delete Forever"),
      () => home.deleteDoc(doc.id, true).catch(reportError),
      {explanation: t("Document will be permanently deleted.")}
    );
  }

  return [
    menuItem(() => home.restoreDoc(doc), t("Restore"),
      dom.cls('disabled', !roles.isOwner(doc) || !!workspace.removedAt),
      testId('doc-restore')
    ),
    menuItem(hardDeleteDoc, t("Delete Forever"),
      dom.cls('disabled', !roles.isOwner(doc)),
      testId('doc-delete-forever')
    ),
    (workspace.removedAt ?
      menuText(t("To restore this document, restore the workspace first.")) :
      null
    )
  ];
}

function makeRemovedWsOptionsMenu(home: HomeModel, ws: Workspace) {
  return [
    menuItem(() => home.restoreWorkspace(ws), t("Restore"),
      dom.cls('disabled', !roles.canDelete(ws.access)),
      testId('ws-restore')
    ),
    menuItem(() => home.deleteWorkspace(ws.id, true), t("Delete Forever"),
      dom.cls('disabled', !roles.canDelete(ws.access) || ws.docs.length > 0),
      testId('ws-delete-forever')
    ),
    (ws.docs.length > 0 ?
      menuText(t("You may delete a workspace forever once it has no documents in it.")) :
      null
    )
  ];
}
