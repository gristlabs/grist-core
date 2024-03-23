import {makeT} from 'app/client/lib/localization';
import {loadUserManager} from 'app/client/lib/imports';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {reportError} from 'app/client/models/AppModel';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {HomeModel} from 'app/client/models/HomeModel';
import {getWorkspaceInfo, workspaceName} from 'app/client/models/WorkspaceInfo';
import {getAdminPanelName} from 'app/client/ui/AdminPanel';
import {addNewButton, cssAddNewButton} from 'app/client/ui/AddNewButton';
import {docImport, importFromPlugin} from 'app/client/ui/HomeImports';
import {
  cssLinkText, cssMenuTrigger, cssPageEntry, cssPageIcon, cssPageLink, cssSpacer
} from 'app/client/ui/LeftPanelCommon';
import {createVideoTourToolsButton} from 'app/client/ui/OpenVideoTour';
import {transientInput} from 'app/client/ui/transientInput';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuIcon, menuItem, upgradableMenuItem, upgradeText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import * as roles from 'app/common/roles';
import {getGristConfig} from 'app/common/urlUtils';
import {Workspace} from 'app/common/UserAPI';
import {computed, dom, domComputed, DomElementArg, observable, Observable, styled} from 'grainjs';
import {createHelpTools, cssLeftPanel, cssScrollPane,
        cssSectionHeader, cssTools} from 'app/client/ui/LeftPanelCommon';

const t = makeT('HomeLeftPane');

export function createHomeLeftPane(leftPanelOpen: Observable<boolean>, home: HomeModel) {
  const creating = observable<boolean>(false);
  const renaming = observable<Workspace|null>(null);
  const isAnonymous = !home.app.currentValidUser;
  const canCreate = !isAnonymous || getGristConfig().enableAnonPlayground;

  return cssContent(
    dom.autoDispose(creating),
    dom.autoDispose(renaming),
    addNewButton({ isOpen: leftPanelOpen, isDisabled: !canCreate },
      canCreate ? menu(() => addMenu(home, creating), {
        placement: 'bottom-start',
        // "Add New" menu should have the same width as the "Add New" button that opens it.
        stretchToSelector: `.${cssAddNewButton.className}`
      }) : null,
      dom.cls('behavioral-prompt-add-new'),
      testId('dm-add-new'),
    ),
    cssScrollPane(
      cssPageEntry(
        cssPageEntry.cls('-selected', (use) => use(home.currentPage) === "all"),
        cssPageLink(cssPageIcon('Home'),
          cssLinkText(t("All Documents")),
          urlState().setLinkUrl({ws: undefined, homePage: undefined}),
          testId('dm-all-docs'),
        ),
      ),
      dom.maybe(use => !use(home.singleWorkspace), () =>
        cssSectionHeader(
          t("Workspaces"),
          // Give it a testId, because it's a good element to simulate "click-away" in tests.
          testId('dm-ws-label')
        ),
      ),
      dom.forEach(home.workspaces, (ws) => {
        if (ws.isSupportWorkspace) { return null; }
        const info = getWorkspaceInfo(home.app, ws);
        const isTrivial = computed((use) => Boolean(getWorkspaceInfo(home.app, ws).isDefault &&
                                                    use(home.singleWorkspace)));
        // TODO: Introduce a "SwitchSelector" pattern to avoid the need for N computeds (and N
        // recalculations) to select one of N items.
        const isRenaming = computed((use) => use(renaming) === ws);
        return cssPageEntry(
          dom.autoDispose(isRenaming),
          dom.autoDispose(isTrivial),
          dom.hide(isTrivial),
          cssPageEntry.cls('-selected', (use) => use(home.currentWSId) === ws.id),
          cssPageLink(cssPageIcon('Folder'), cssLinkText(workspaceName(home.app, ws)),
            dom.hide(isRenaming),
            urlState().setLinkUrl({ws: ws.id}),
            // Don't show menu if workspace is personal and shared by another user; we could
            // be a bit more nuanced here, but as of today the menu isn't particularly useful
            // as all the menu options are disabled.
            !info.self && info.owner ? null : cssMenuTrigger(icon('Dots'),
              menu(() => workspaceMenu(home, ws, renaming),
                {placement: 'bottom-start', parentSelectorToMark: '.' + cssPageEntry.className}),

              // Clicks on the menu trigger shouldn't follow the link that it's contained in.
              dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
              testId('dm-workspace-options'),
            ),
            testId('dm-workspace'),
            dom.cls('test-dm-workspace-selected', (use) => use(home.currentWSId) === ws.id),
          ),
          cssPageEntry.cls('-renaming', isRenaming),
          dom.maybe(isRenaming, () =>
            cssPageLink(cssPageIcon('Folder'),
              cssEditorInput({
                initialValue: ws.name || '',
                save: async (val) => (val !== ws.name) ? home.renameWorkspace(ws.id, val) : undefined,
                close: () => renaming.set(null),
              }, testId('dm-ws-name-editor'))
            )
          ),
        );
      }),
      dom.maybe(creating, () => cssPageEntry(
        cssPageLink(cssPageIcon('Folder'),
          cssEditorInput({
            initialValue: '',
            save: async (val) => (val !== '') ? home.createWorkspace(val) : undefined,
            close: () => creating.set(false),
          }, testId('dm-ws-name-editor'))
        )
      )),
      cssTools(
        cssPageEntry(
          dom.show(isFeatureEnabled("templates") && Boolean(getGristConfig().templateOrg)),
          cssPageEntry.cls('-selected', (use) => use(home.currentPage) === "templates"),
          cssPageLink(cssPageIcon('Board'), cssLinkText(t("Examples & Templates")),
            urlState().setLinkUrl({homePage: "templates"}),
            testId('dm-templates-page'),
          ),
        ),
        isAnonymous ? null : cssPageEntry(
          cssPageEntry.cls('-selected', (use) => use(home.currentPage) === "trash"),
          cssPageLink(cssPageIcon('RemoveBig'), cssLinkText(t("Trash")),
            urlState().setLinkUrl({homePage: "trash"}),
            testId('dm-trash'),
          ),
        ),
        cssSpacer(),
        cssPageEntry(
          dom.show(isFeatureEnabled('tutorials')),
          cssPageLink(cssPageIcon('Bookmark'), cssLinkText(t("Tutorial")),
            { href: commonUrls.basicTutorial, target: '_blank' },
            testId('dm-basic-tutorial'),
          ),
        ),
        createVideoTourToolsButton(),
        (home.app.isInstallAdmin() ?
          cssPageEntry(
            cssPageLink(cssPageIcon('Settings'), cssLinkText(getAdminPanelName()),
              urlState().setLinkUrl({adminPanel: "admin"}),
              testId('dm-admin-panel'),
            ),
          ) : null
        ),
        createHelpTools(home.app),
      )
    )
  );
}

export async function createDocAndOpen(home: HomeModel) {
  const destWS = home.newDocWorkspace.get();
  if (!destWS) { return; }
  try {
    const docId = await home.createDoc("Untitled document", destWS === "unsaved" ? "unsaved" : destWS.id);
    // Fetch doc information including urlId.
    // TODO: consider changing API to return same response as a GET when creating an
    // object, which is a semi-standard.
    const doc = await home.app.api.getDoc(docId);
    await urlState().pushUrl(docUrl(doc));
  } catch (err) {
    reportError(err);
  }
}

export async function importDocAndOpen(home: HomeModel) {
  const destWS = home.newDocWorkspace.get();
  if (!destWS) { return; }
  const docId = await docImport(home.app, destWS === "unsaved" ? "unsaved" : destWS.id);
  if (docId) {
    const doc = await home.app.api.getDoc(docId);
    await urlState().pushUrl(docUrl(doc));
  }
}

export async function importFromPluginAndOpen(home: HomeModel, source: ImportSourceElement) {
  try {
    const destWS = home.newDocWorkspace.get();
    if (!destWS) { return; }
    const docId = await importFromPlugin(
      home.app,
      destWS === "unsaved" ? "unsaved" : destWS.id,
      source);
    if (docId) {
      const doc = await home.app.api.getDoc(docId);
      await urlState().pushUrl(docUrl(doc));
    }
  } catch (err) {
    reportError(err);
  }
}

function addMenu(home: HomeModel, creating: Observable<boolean>): DomElementArg[] {
  const org = home.app.currentOrg;
  const orgAccess: roles.Role|null = org ? org.access : null;
  const needUpgrade = home.app.currentFeatures.maxWorkspacesPerOrg === 1;

  return [
    menuItem(() => createDocAndOpen(home), menuIcon('Page'), t("Create Empty Document"),
      dom.cls('disabled', !home.newDocWorkspace.get()),
      testId("dm-new-doc")
    ),
    menuItem(() => importDocAndOpen(home), menuIcon('Import'), t("Import Document"),
      dom.cls('disabled', !home.newDocWorkspace.get()),
      testId("dm-import")
    ),
    domComputed(home.importSources, importSources => ([
      ...importSources.map((source, i) =>
      menuItem(() => importFromPluginAndOpen(home, source),
        menuIcon('Import'),
        source.importSource.label,
        dom.cls('disabled', !home.newDocWorkspace.get()),
        testId(`dm-import-plugin`)
      ))
    ])),
    // For workspaces: if ACL says we can create them, but product says we can't,
    // then offer an upgrade link.
    upgradableMenuItem(needUpgrade, () => creating.set(true), menuIcon('Folder'), t("Create Workspace"),
             dom.cls('disabled', (use) => !roles.canEdit(orgAccess) || !use(home.available)),
             testId("dm-new-workspace")
    ),
    upgradeText(needUpgrade, () => home.app.showUpgradeModal()),
  ];
}

function workspaceMenu(home: HomeModel, ws: Workspace, renaming: Observable<Workspace|null>) {
  function deleteWorkspace() {
    confirmModal(t("Delete {{workspace}} and all included documents?", {workspace: ws.name}), t("Delete"),
      async () => {
        let all = home.workspaces.get();
        const index = all.findIndex((w) => w.id === ws.id);
        const selected = home.currentWSId.get() === ws.id;
        await home.deleteWorkspace(ws.id, false);
        // If workspace was not selected, don't do navigation.
        if (!selected) { return; }
        all = home.workspaces.get();
        if (!all.length) {
          // There was only one workspace, navigate to all docs.
          await urlState().pushUrl({homePage: 'all'});
        } else {
          // Maintain the index.
          const newIndex = Math.max(0, Math.min(index, all.length - 1));
          await urlState().pushUrl({ws: all[newIndex].id});
        }
      },
      {explanation: t("Workspace will be moved to Trash.")});
  }

  async function manageWorkspaceUsers() {
    const api = home.app.api;
    const user = home.app.currentUser;
    (await loadUserManager()).showUserManagerModal(api, {
      permissionData: api.getWorkspaceAccess(ws.id),
      activeUser: user,
      resourceType: 'workspace',
      resourceId: ws.id,
      resource: ws,
    });
  }

  const needUpgrade = home.app.currentFeatures.maxWorkspacesPerOrg === 1;

  return [
    upgradableMenuItem(needUpgrade, () => renaming.set(ws), t("Rename"),
      dom.cls('disabled', !roles.canEdit(ws.access)),
      testId('dm-rename-workspace')),
    upgradableMenuItem(needUpgrade, deleteWorkspace, t("Delete"),
      dom.cls('disabled', user => !roles.canEdit(ws.access)),
      testId('dm-delete-workspace')),
    // TODO: Personal plans can't currently share workspaces, but that restriction
    // should formally be documented and defined in `Features`, with this check updated
    // to look there instead.
    home.app.isPersonal ? null : upgradableMenuItem(needUpgrade, manageWorkspaceUsers,
      roles.canEditAccess(ws.access) ? t("Manage Users") : t("Access Details"),
      testId('dm-workspace-access')),
    upgradeText(needUpgrade, () => home.app.showUpgradeModal()),
  ];
}

// Below are all the styled elements.

const cssContent = styled(cssLeftPanel, `
  --page-icon-margin: 12px;
`);

export const cssEditorInput = styled(transientInput, `
  height: 24px;
  flex: 1 1 0px;
  min-width: 0px;
  background-color: ${theme.inputBg};
  margin-right: 16px;
  font-size: inherit;
`);
