/**
 * This module exports a DocMenu component, consisting of an organization dropdown, a sidepane
 * of workspaces, and a doc list. The organization and workspace selectors filter the doc list.
 * Orgs, workspaces and docs are fetched asynchronously on build via the passed in API.
 */
import {loadUserManager} from 'app/client/lib/imports';
import {reportError} from 'app/client/models/AppModel';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {getTimeFromNow, HomeModel, makeLocalViewSettings, ViewSettings} from 'app/client/models/HomeModel';
import {getWorkspaceInfo, workspaceName} from 'app/client/models/WorkspaceInfo';
import {attachAddNewTip} from 'app/client/ui/AddNewTip';
import * as css from 'app/client/ui/DocMenuCss';
import {buildHomeIntro, buildWorkspaceIntro} from 'app/client/ui/HomeIntro';
import {buildUpgradeButton} from 'app/client/ui/ProductUpgrades';
import {buildTutorialCard} from 'app/client/ui/TutorialCard';
import {buildPinnedDoc, createPinnedDocs} from 'app/client/ui/PinnedDocs';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {makeShareDocUrl} from 'app/client/ui/ShareMenu';
import {transition} from 'app/client/ui/transitions';
import {shouldShowWelcomeCoachingCall, showWelcomeCoachingCall} from 'app/client/ui/WelcomeCoachingCall';
import {shouldShowWelcomeQuestions, showWelcomeQuestions} from 'app/client/ui/WelcomeQuestions';
import {createVideoTourTextButton} from 'app/client/ui/OpenVideoTour';
import {buttonSelect, cssButtonSelect} from 'app/client/ui2018/buttonSelect';
import {isNarrowScreenObs, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {menu, menuItem, menuText, select} from 'app/client/ui2018/menus';
import {confirmModal, saveModal} from 'app/client/ui2018/modals';
import {IHomePage} from 'app/common/gristUrls';
import {SortPref, ViewPref} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {Document, Workspace} from 'app/common/UserAPI';
import {computed, Computed, dom, DomArg, DomContents, DomElementArg, IDisposableOwner,
        makeTestId, observable, Observable} from 'grainjs';
import {buildTemplateDocs} from 'app/client/ui/TemplateDocs';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {bigBasicButton} from 'app/client/ui2018/buttons';
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
    dom.domComputed(home.loading, loading => (
      loading === 'slow' ? css.spinner(loadingSpinner()) :
      loading ? null :
      dom.create(createLoadedDocMenu, home)
    ))
  ];
}

function attachWelcomePopups(home: HomeModel): (el: Element) => void {
  return (element: Element) => {
    const {app, app: {userPrefsObs}} = home;
    if (shouldShowWelcomeQuestions(userPrefsObs)) {
      showWelcomeQuestions(userPrefsObs);
    } else if (shouldShowWelcomeCoachingCall(app)) {
      showWelcomeCoachingCall(element, app);
    }
  };
}

function createLoadedDocMenu(owner: IDisposableOwner, home: HomeModel) {
  const flashDocId = observable<string|null>(null);
  const upgradeButton = buildUpgradeButton(owner, home.app);
  return css.docList( /* vbox */
  /* first line */
  dom.create(buildTutorialCard, { app: home.app }),
  /* hbox */
  css.docListContent(
    /* left column - grow 1 */
    css.docMenu(
      attachAddNewTip(home),

      dom.maybe(!home.app.currentFeatures.workspaces, () => [
        css.docListHeader(t("This service is not available right now")),
        dom('span', t("(The organization needs a paid plan)")),
      ]),

      // currentWS and showIntro observables change together. We capture both in one domComputed call.
      dom.domComputed<[IHomePage, Workspace|undefined, boolean]>(
        (use) => [use(home.currentPage), use(home.currentWS), use(home.showIntro)],
        ([page, workspace, showIntro]) => {
          const viewSettings: ViewSettings =
            page === 'trash' ? makeLocalViewSettings(home, 'trash') :
            page === 'templates' ? makeLocalViewSettings(home, 'templates') :
            workspace ? makeLocalViewSettings(home, workspace.id) :
            home;
          return [
            buildPrefs(
              viewSettings,
              // Hide the sort and view options when showing the intro.
              {hideSort: showIntro, hideView: showIntro && page === 'all'},
              ['all', 'workspace'].includes(page)
                ? upgradeButton.showUpgradeButton(css.upgradeButton.cls(''))
                : null,
            ),

            // Build the pinned docs dom. Builds nothing if the selectedOrg is unloaded.
            // TODO: this is shown on all pages, but there is a hack in currentWSPinnedDocs that
            // removes all pinned docs when on trash page.
            dom.maybe((use) => use(home.currentWSPinnedDocs).length > 0, () => [
              css.docListHeader(css.pinnedDocsIcon('PinBig'), t("Pinned Documents")),
              createPinnedDocs(home, home.currentWSPinnedDocs),
            ]),

            // Build the featured templates dom if on the Examples & Templates page.
            dom.maybe((use) => page === 'templates' && use(home.featuredTemplates).length > 0, () => [
              css.featuredTemplatesHeader(
                css.featuredTemplatesIcon('Idea'),
                t("Featured"),
                testId('featured-templates-header')
              ),
              createPinnedDocs(home, home.featuredTemplates, true),
            ]),

            dom.maybe(home.available, () => [
              buildOtherSites(home),
              (showIntro && page === 'all' ?
                null :
                css.docListHeader(
                  (
                    page === 'all' ? t("All Documents") :
                    page === 'templates' ?
                      dom.domComputed(use => use(home.featuredTemplates).length > 0, (hasFeaturedTemplates) =>
                        hasFeaturedTemplates ? t("More Examples and Templates") : t("Examples and Templates")
                    ) :
                    page === 'trash' ? t("Trash") :
                    workspace && [css.docHeaderIcon('Folder'), workspaceName(home.app, workspace)]
                  ),
                  testId('doc-header'),
                )
              ),
              (
                (page === 'all') ?
                  dom('div',
                    showIntro ? buildHomeIntro(home) : null,
                    buildAllDocsBlock(home, home.workspaces, showIntro, flashDocId, viewSettings),
                    shouldShowTemplates(home, showIntro) ? buildAllDocsTemplates(home, viewSettings) : null,
                  ) :
                (page === 'trash') ?
                  dom('div',
                    css.docBlock(t("Documents stay in Trash for 30 days, after which they get deleted permanently.")),
                    dom.maybe((use) => use(home.trashWorkspaces).length === 0, () =>
                      css.docBlock(t("Trash is empty."))
                    ),
                    buildAllDocsBlock(home, home.trashWorkspaces, false, flashDocId, viewSettings),
                  ) :
                (page === 'templates') ?
                  dom('div',
                    buildAllTemplates(home, home.templateWorkspaces, viewSettings)
                  ) :
                  workspace && !workspace.isSupportWorkspace && workspace.docs?.length ?
                    css.docBlock(
                      buildWorkspaceDocBlock(home, workspace, flashDocId, viewSettings),
                      testId('doc-block')
                    ) :
                  workspace && !workspace.isSupportWorkspace && workspace.docs?.length === 0 ?
                  buildWorkspaceIntro(home) :
                  css.docBlock(t("Workspace not found"))
              )
            ]),
          ];
        }),
      testId('doclist')
    ),
    dom.maybe(use => !use(isNarrowScreenObs()) && ['all', 'workspace'].includes(use(home.currentPage)),
      () => {
        // TODO: These don't currently clash (grist-core stubs the upgradeButton), but a way to
        // manage card popups will be needed if more are added later.
        return [
          upgradeButton.showUpgradeCard(css.upgradeCard.cls('')),
          home.app.supportGristNudge.buildNudgeCard(),
        ];
      }),
  ));
}

function buildAllDocsBlock(
  home: HomeModel, workspaces: Observable<Workspace[]>,
  showIntro: boolean, flashDocId: Observable<string|null>, viewSettings: ViewSettings,
) {
  return dom.forEach(workspaces, (ws) => {
    // Don't show the support workspace -- examples/templates are now retrieved from a special org.
    // TODO: Remove once support workspaces are removed from the backend.
    if (ws.isSupportWorkspace) { return null; }
    // Show docs in regular workspaces. For empty orgs, we show the intro and skip
    // the empty workspace headers. Workspaces are still listed in the left panel.
    if (showIntro) { return null; }
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
      buildWorkspaceDocBlock(home, ws, flashDocId, viewSettings),
      testId('doc-block')
    );
  });
}

/**
 * Builds the collapsible examples and templates section at the bottom of
 * the All Documents page.
 *
 * If there are no featured templates, builds nothing.
 */
function buildAllDocsTemplates(home: HomeModel, viewSettings: ViewSettings) {
  return dom.domComputed(home.featuredTemplates, templates => {
    if (templates.length === 0) { return null; }

    const hideTemplatesObs = localStorageBoolObs('hide-examples');
    return css.allDocsTemplates(css.templatesDocBlock(
      dom.autoDispose(hideTemplatesObs),
      css.templatesHeaderWrap(
        css.templatesHeader(
          t("Examples & Templates"),
          dom.domComputed(hideTemplatesObs, (collapsed) =>
            collapsed ? css.templatesHeaderIcon('Expand') : css.templatesHeaderIcon('Collapse')
          ),
          dom.on('click', () => hideTemplatesObs.set(!hideTemplatesObs.get())),
          testId('all-docs-templates-header'),
        ),
        createVideoTourTextButton(),
      ),
      dom.maybe((use) => !use(hideTemplatesObs), () => [
        buildTemplateDocs(home, templates, viewSettings),
        bigBasicButton(
          t("Discover More Templates"),
          urlState().setLinkUrl({homePage: 'templates'}),
          testId('all-docs-templates-discover-more'),
        )
      ]),
      css.docBlock.cls((use) => '-' + use(home.currentView)),
      testId('all-docs-templates'),
    ));
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
 * Builds the Other Sites section if there are any to show. Otherwise, builds nothing.
 */
function buildOtherSites(home: HomeModel) {
  return dom.domComputed(home.otherSites, sites => {
    if (sites.length === 0) { return null; }

    const hideOtherSitesObs = Observable.create(null, false);
    return css.otherSitesBlock(
      dom.autoDispose(hideOtherSitesObs),
      css.otherSitesHeader(
        t("Other Sites"),
        dom.domComputed(hideOtherSitesObs, (collapsed) =>
          collapsed ? css.otherSitesHeaderIcon('Expand') : css.otherSitesHeaderIcon('Collapse')
        ),
        dom.on('click', () => hideOtherSitesObs.set(!hideOtherSitesObs.get())),
        testId('other-sites-header'),
      ),
      dom.maybe((use) => !use(hideOtherSitesObs), () => {
        const personal = Boolean(home.app.currentOrg?.owner);
        const siteName = home.app.currentOrgName;
        return [
          dom('div',
            personal ? t("You are on your personal site. You also have access to the following sites:") :
              t("You are on the {{siteName}} site. You also have access to the following sites:", {siteName}),
            testId('other-sites-message')
          ),
          css.otherSitesButtons(
            dom.forEach(sites, s =>
              css.siteButton(
                s.name,
                urlState().setLinkUrl({org: s.domain ?? undefined}),
                testId('other-sites-button')
              )
            ),
            testId('other-sites-buttons')
          ),
        ];
      })
    );
  });
}

/**
 * Build the widget for selecting sort and view mode options.
 *
 * Options hideSort and hideView control which options are shown; they should have no effect
 * on the list of examples, so best to hide when those are the only docs shown.
 */
function buildPrefs(
  viewSettings: ViewSettings,
  options: {
    hideSort: boolean,
    hideView: boolean,
  },
  ...args: DomArg<HTMLElement>[]): DomContents {
  return css.prefSelectors(
    // The Sort selector.
    options.hideSort ? null : dom.update(
      select<SortPref>(viewSettings.currentSort, [
          {value: 'name', label: t("By Name")},
          {value: 'date', label: t("By Date Modified")},
        ],
        { buttonCssClass: css.sortSelector.className },
      ),
      testId('sort-mode'),
    ),

    // The View selector.
    options.hideView ? null : buttonSelect<ViewPref>(viewSettings.currentView, [
        {value: 'icons', icon: 'TypeTable'},
        {value: 'list', icon: 'TypeCardList'},
      ],
      cssButtonSelect.cls("-light"),
      testId('view-mode')
    ),
    ...args
  );
}


function buildWorkspaceDocBlock(home: HomeModel, workspace: Workspace, flashDocId: Observable<string|null>,
                                viewSettings: ViewSettings) {
  const renaming = observable<Document|null>(null);

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
      const isRenaming = computed((use) => use(renaming) === doc);
      const flash = computed((use) => use(flashDocId) === doc.id);
      return css.docRowWrapper(
        dom.autoDispose(isRenaming),
        dom.autoDispose(flash),
        css.docRowLink(
          doc.removedAt ? null : urlState().setLinkUrl(docUrl(doc)),
          dom.hide(isRenaming),
          css.docRowLink.cls('-no-access', !roles.canView(doc.access)),
          css.docLeft(
            css.docName(doc.name, testId('doc-name')),
            css.docPinIcon('PinSmall', dom.show(doc.isPinned)),
            doc.public ? css.docPublicIcon('Public', testId('public')) : null,
          ),
          css.docRowUpdatedAt(
            (doc.removedAt ?
              t("Deleted {{at}}", {at: getTimeFromNow(doc.removedAt)}) :
              t("Edited {{at}}", {at: getTimeFromNow(doc.updatedAt)})),
            testId('doc-time')
          ),
          (doc.removedAt ?
            [
              // For deleted documents, attach the menu to the entire doc row, and include the
              // "Dots" icon just to clarify that there are options.
              menu(() => makeRemovedDocOptionsMenu(home, doc, workspace),
                {placement: 'bottom-end', parentSelectorToMark: '.' + css.docRowWrapper.className}),
              css.docMenuTrigger(icon('Dots'), testId('doc-options')),
            ] :
            css.docMenuTrigger(icon('Dots'),
              menu(() => makeDocOptionsMenu(home, doc, renaming),
                {placement: 'bottom-start', parentSelectorToMark: '.' + css.docRowWrapper.className}),
              // Clicks on the menu trigger shouldn't follow the link that it's contained in.
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
              testId('doc-options'),
            )
          ),
          // The flash value may change to true, and then immediately to false. We highlight it
          // using a transition, and scroll into view, when it turns back to false.
          transition(flash, {
            prepare(elem, val) { if (!val) { elem.style.backgroundColor = theme.lightText.toString(); } },
            run(elem, val) { if (!val) { elem.style.backgroundColor = ''; scrollIntoViewIfNeeded(elem); } },
          })
        ),
        css.docRowWrapper.cls('-renaming', isRenaming),
        dom.maybe(isRenaming, () =>
          css.docRowLink(
            css.docEditorInput({
              initialValue: doc.name || '',
              save: (val) => doRename(home, doc, val, flashDocId),
              close: () => renaming.set(null),
            }, testId('doc-name-editor')),
            css.docRowUpdatedAt(t("Edited {{at}}", {at: getTimeFromNow(doc.updatedAt)}), testId('doc-time')),
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

async function doRename(home: HomeModel, doc: Document, val: string, flashDocId: Observable<string|null>) {
  if (val !== doc.name) {
    try {
      await home.renameDoc(doc.id, val);
      // "Flash" the doc.id: setting and immediately resetting flashDocId will cause on of the
      // "flash" observables in buildWorkspaceDocBlock() to change to true and immediately to false
      // (resetting to normal state), triggering a highlight transition.
      flashDocId.set(doc.id);
      flashDocId.set(null);
    } catch (err) {
      reportError(err as Error);
    }
  }
}

//  TODO rebuilds of big page chunks (all workspace) cause screen position to jump, sometimes
//  losing the doc that was e.g. just renamed.

// Exported because also used by the PinnedDocs component.
export function makeDocOptionsMenu(home: HomeModel, doc: Document, renaming: Observable<Document|null>) {
  const org = home.app.currentOrg;
  const orgAccess: roles.Role|null = org ? org.access : null;

  function deleteDoc() {
    confirmModal(t("Delete {{name}}", {name: doc.name}), t("Delete"),
      () => home.deleteDoc(doc.id, false).catch(reportError),
      {explanation: t("Document will be moved to Trash.")}
    );
  }

  async function manageUsers() {
    const api = home.app.api;
    const user = home.app.currentUser;
    (await loadUserManager()).showUserManagerModal(api, {
      permissionData: api.getDocAccess(doc.id),
      activeUser: user,
      resourceType: 'document',
      resourceId: doc.id,
      resource: doc,
      linkToCopy: makeShareDocUrl(doc),
      reload: () => api.getDocAccess(doc.id),
      appModel: home.app,
    });
  }

  return [
    menuItem(() => renaming.set(doc), t("Rename"),
      dom.cls('disabled', !roles.canEdit(doc.access)),
      testId('rename-doc')
    ),
    menuItem(() => showMoveDocModal(home, doc), t("Move"),
      // Note that moving the doc requires ACL access on the doc. Moving a doc to a workspace
      // that confers descendant ACL access could otherwise increase the user's access to the doc.
      // By requiring the user to have ACL edit access on the doc to move it prevents using this
      // as a tool to gain greater access control over the doc.
      // Having ACL edit access on the doc means the user is also powerful enough to remove
      // the doc, so this is the only access check required to move the doc out of this workspace.
      // The user must also have edit access on the destination, however, for the move to work.
      dom.cls('disabled', !roles.canEditAccess(doc.access)),
      testId('move-doc')
    ),
    menuItem(deleteDoc, t("Remove"),
      dom.cls('disabled', !roles.isOwner(doc)),
      testId('delete-doc')
    ),
    menuItem(() => home.pinUnpinDoc(doc.id, !doc.isPinned).catch(reportError),
      doc.isPinned ? t("Unpin Document"): t("Pin Document"),
      dom.cls('disabled', !roles.canEdit(orgAccess)),
      testId('pin-doc')
    ),
    menuItem(manageUsers, roles.canEditAccess(doc.access) ? t("Manage Users"): t("Access Details"),
      testId('doc-access')
    )
  ];
}

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

function showMoveDocModal(home: HomeModel, doc: Document) {
  saveModal((ctl, owner) => {
    const selected: Observable<number|null> = Observable.create(owner, null);
    const body = css.moveDocModalBody(
      shadowScroll(
        dom.forEach(home.workspaces, ws => {
          if (ws.isSupportWorkspace) { return null; }
          const isCurrent = Boolean(ws.docs.find(_doc => _doc.id === doc.id));
          const isEditable = roles.canEdit(ws.access);
          const disabled = isCurrent || !isEditable;
          return css.moveDocListItem(
            css.moveDocListText(workspaceName(home.app, ws)),
            isCurrent ? css.moveDocListHintText(t("Current workspace")) : null,
            !isEditable ? css.moveDocListHintText(t("Requires edit permissions")) : null,
            css.moveDocListItem.cls('-disabled', disabled),
            css.moveDocListItem.cls('-selected', (use) => use(selected) === ws.id),
            dom.on('click', () => disabled || selected.set(ws.id)),
            testId('dest-ws')
          );
        })
      )
    );
    return {
      title: t("Move {{name}} to workspace", {name: doc.name}),
      body,
      saveDisabled: Computed.create(owner, (use) => !use(selected)),
      saveFunc: async () => !selected.get() || home.moveDoc(doc.id, selected.get()!).catch(reportError),
      saveLabel: t("Move"),
    };
  });
}

// Scrolls an element into view only if it's above or below the screen.
// TODO move to some common utility
function scrollIntoViewIfNeeded(target: Element) {
  const rect = target.getBoundingClientRect();
  if (rect.bottom > window.innerHeight) {
    target.scrollIntoView(false);
  }
  if (rect.top < 0) {
    target.scrollIntoView(true);
  }
}

/**
 * Returns true if templates should be shown in All Documents.
 */
function shouldShowTemplates(home: HomeModel, showIntro: boolean): boolean {
  const org = home.app.currentOrg;
  const isPersonalOrg = Boolean(org && org.owner);
  // Show templates for all personal orgs, and for non-personal orgs when showing intro.
  return isPersonalOrg || showIntro;
}
