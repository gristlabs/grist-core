import {ClientScope} from 'app/client/components/ClientScope';
import {guessTimezone} from 'app/client/lib/guessTimezone';
import {HomePluginManager} from 'app/client/lib/HomePluginManager';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {localStorageObs} from 'app/client/lib/localStorageObs';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {reportMessage, UserError} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {ownerName} from 'app/client/models/WorkspaceInfo';
import {IHomePage} from 'app/common/gristUrls';
import {isLongerThan} from 'app/common/gutil';
import {SortPref, UserOrgPrefs, ViewPref} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {getGristConfig} from 'app/common/urlUtils';
import {Document, Organization, Workspace} from 'app/common/UserAPI';
import {bundleChanges, Computed, Disposable, Observable, subscribe} from 'grainjs';
import moment from 'moment';
import flatten = require('lodash/flatten');
import sortBy = require('lodash/sortBy');

const DELAY_BEFORE_SPINNER_MS = 500;

// Given a UTC Date ISO 8601 string (the doc updatedAt string), gives a reader-friendly
// relative time to now - e.g. 'yesterday', '2 days ago'.
export function getTimeFromNow(utcDateISO: string): string {
  const time = moment.utc(utcDateISO);
  const now = moment();
  const diff = now.diff(time, 's');
  if (diff < 0 && diff > -60) {
    // If the time appears to be in the future, but less than a minute
    // in the future, chalk it up to a difference in time
    // synchronization and don't claim the resource will be changed in
    // the future.  For larger differences, just report them
    // literally, there's a more serious problem or lack of
    // synchronization.
    return now.fromNow();
  }
  return time.fromNow();
}

export interface HomeModel {
  // PageType value, one of the discriminated union values used by AppModel.
  pageType: "home";

  app: AppModel;
  currentPage: Observable<IHomePage>;
  currentWSId: Observable<number|undefined>;    // should be set when currentPage is 'workspace'

  // Note that Workspace contains its documents in .docs.
  workspaces: Observable<Workspace[]>;
  loading: Observable<boolean|"slow">;          // Set to "slow" when loading for a while.
  available: Observable<boolean>;               // set if workspaces loaded correctly.
  showIntro: Observable<boolean>;               // set if no docs and we should show intro.
  singleWorkspace: Observable<boolean>;         // set if workspace name should be hidden.
  trashWorkspaces: Observable<Workspace[]>;     // only set when viewing trash
  templateWorkspaces: Observable<Workspace[]>;  // Only set when viewing templates or all documents.

  // currentWS is undefined when currentPage is not "workspace" or if currentWSId doesn't exist.
  currentWS: Observable<Workspace|undefined>;

  // List of pinned docs to show for currentWS.
  currentWSPinnedDocs: Observable<Document[]>;

  // List of featured templates from templateWorkspaces.
  featuredTemplates: Observable<Document[]>;

  // List of other sites (orgs) user can access. Only populated on All Documents, and only when
  // the current org is a personal org, or the current org is view access only.
  otherSites: Observable<Organization[]>;

  currentSort: Observable<SortPref>;
  currentView: Observable<ViewPref>;
  importSources: Observable<ImportSourceElement[]>;

  // The workspace for new docs, or "unsaved" to only allow unsaved-doc creation, or null if the
  // user isn't allowed to create a doc.
  newDocWorkspace: Observable<Workspace|null|"unsaved">;

  shouldShowAddNewTip: Observable<boolean>;

  createWorkspace(name: string): Promise<void>;
  renameWorkspace(id: number, name: string): Promise<void>;
  deleteWorkspace(id: number, forever: boolean): Promise<void>;
  restoreWorkspace(ws: Workspace): Promise<void>;

  createDoc(name: string, workspaceId: number|"unsaved"): Promise<string>;
  renameDoc(docId: string, name: string): Promise<void>;
  deleteDoc(docId: string, forever: boolean): Promise<void>;
  restoreDoc(doc: Document): Promise<void>;
  pinUnpinDoc(docId: string, pin: boolean): Promise<void>;
  moveDoc(docId: string, workspaceId: number): Promise<void>;
}

export interface ViewSettings {
  currentSort: Observable<SortPref>;
  currentView: Observable<ViewPref>;
}

export class HomeModelImpl extends Disposable implements HomeModel, ViewSettings {
  public readonly pageType = "home";
  public readonly currentPage = Computed.create(this, urlState().state, (use, s) =>
    s.homePage || (s.ws !== undefined ? "workspace" : "all"));
  public readonly currentWSId = Computed.create(this, urlState().state, (use, s) => s.ws);
  public readonly workspaces = Observable.create<Workspace[]>(this, []);
  public readonly loading = Observable.create<boolean|"slow">(this, true);
  public readonly available = Observable.create(this, false);
  public readonly singleWorkspace = Observable.create(this, true);
  public readonly trashWorkspaces = Observable.create<Workspace[]>(this, []);
  public readonly templateWorkspaces = Observable.create<Workspace[]>(this, []);
  public readonly importSources = Observable.create<ImportSourceElement[]>(this, []);

  // Get the workspace details for the workspace with id of currentWSId.
  public readonly currentWS = Computed.create(this, (use) =>
    use(this.workspaces).find(ws => (ws.id === use(this.currentWSId))));

  public readonly currentWSPinnedDocs = Computed.create(this, this.currentPage, this.currentWS, (use, page, ws) => {
    const docs = (page === 'all') ?
      flatten((use(this.workspaces).map(w => w.docs))) :
      (ws ? ws.docs : []);
    return sortBy(docs.filter(doc => doc.isPinned), (doc) => doc.name.toLowerCase());
  });

  public readonly featuredTemplates = Computed.create(this, this.templateWorkspaces, (_use, templates) => {
    const featuredTemplates = flatten((templates).map(t => t.docs)).filter(t => t.isPinned);
    return sortBy(featuredTemplates, (t) => t.name.toLowerCase());
  });

  public readonly otherSites = Computed.create(this, this.currentPage, this.app.topAppModel.orgs,
    (_use, page, orgs) => {
      if (page !== 'all') { return []; }

      const currentOrg = this._app.currentOrg;
      if (!currentOrg) { return []; }

      const isPersonalOrg = currentOrg.owner;
      if (!isPersonalOrg && (currentOrg.access !== 'viewers' || !currentOrg.public)) {
        return [];
      }

      return orgs.filter(org => org.id !== currentOrg.id);
    });

  public readonly currentSort: Observable<SortPref>;
  public readonly currentView: Observable<ViewPref>;

  // The workspace for new docs, or "unsaved" to only allow unsaved-doc creation, or null if the
  // user isn't allowed to create a doc.
  public readonly newDocWorkspace = Computed.create(this, this.currentPage, this.currentWS, (use, page, ws) => {
    // Anonymous user can create docs, but in unsaved mode.
    if (!this.app.currentValidUser) { return "unsaved"; }
    if (page === 'trash') { return null; }
    const destWS = (['all', 'templates'].includes(page)) ? (use(this.workspaces)[0] || null) : ws;
    return destWS && roles.canEdit(destWS.access) ? destWS : null;
  });

  // Whether to show intro: no docs (other than examples).
  public readonly showIntro = Computed.create(this, this.workspaces, (use, wss) => (
    wss.every((ws) => ws.isSupportWorkspace || ws.docs.length === 0)));

  public readonly shouldShowAddNewTip = Observable.create(this,
    !this._app.behavioralPromptsManager.hasSeenPopup('addNew'));

  private _userOrgPrefs = Observable.create<UserOrgPrefs|undefined>(this, this._app.currentOrg?.userOrgPrefs);

  constructor(private _app: AppModel, clientScope: ClientScope) {
    super();

    if (!this.app.currentValidUser) {
      // For the anonymous user, use local settings, don't attempt to save anything to the server.
      const viewSettings = makeLocalViewSettings(null, 'all');
      this.currentSort = viewSettings.currentSort;
      this.currentView = viewSettings.currentView;
    } else {
      // Preference for sorting. Defaults to 'name'. Saved to server on write.
      this.currentSort = Computed.create(this, this._userOrgPrefs,
        (use, prefs) => SortPref.parse(prefs?.docMenuSort) || 'name')
        .onWrite(s => this._saveUserOrgPref("docMenuSort", s));

      // Preference for view mode. The default is somewhat complicated. Saved to server on write.
      this.currentView = Computed.create(this, this._userOrgPrefs,
        (use, prefs) => ViewPref.parse(prefs?.docMenuView) || getViewPrefDefault(use(this.workspaces)))
        .onWrite(s => this._saveUserOrgPref("docMenuView", s));
    }

    this.autoDispose(subscribe(this.currentPage, this.currentWSId, (use) =>
      this._updateWorkspaces().catch(reportError)));

    // Defer home plugin initialization
    const pluginManager = new HomePluginManager({
      localPlugins: _app.topAppModel.plugins,
      untrustedContentOrigin: _app.topAppModel.getUntrustedContentOrigin()!,
      clientScope,
      theme: _app.currentTheme,
    });
    const importSources = ImportSourceElement.fromArray(pluginManager.pluginsList);
    this.importSources.set(importSources);

    this._app.refreshOrgUsage().catch(reportError);
  }

  // Accessor for the AppModel containing this HomeModel.
  public get app(): AppModel { return this._app; }

  public async createWorkspace(name: string) {
    const org = this._app.currentOrg;
    if (!org) { return; }
    this._checkForDuplicates(name);
    await this._app.api.newWorkspace({name}, org.id);
    await this._updateWorkspaces();
  }

  public async renameWorkspace(id: number, name: string) {
    this._checkForDuplicates(name);
    await this._app.api.renameWorkspace(id, name);
    await this._updateWorkspaces();
  }

  public async deleteWorkspace(id: number, forever: boolean) {
    // TODO: Prevent the last workspace from being removed.
    await (forever ? this._app.api.deleteWorkspace(id) : this._app.api.softDeleteWorkspace(id));
    await this._updateWorkspaces();
  }

  public async restoreWorkspace(ws: Workspace) {
    await  this._app.api.undeleteWorkspace(ws.id);
    await this._updateWorkspaces();
    reportMessage(`Workspace "${ws.name}" restored`);
  }

  // Creates a new doc by calling the API, and returns its docId.
  public async createDoc(name: string, workspaceId: number|"unsaved"): Promise<string> {
    if (workspaceId === "unsaved") {
      const timezone = await guessTimezone();
      return await this._app.api.newUnsavedDoc({timezone});
    }
    const id = await this._app.api.newDoc({name}, workspaceId);
    await this._updateWorkspaces();
    return id;
  }

  public async renameDoc(docId: string, name: string): Promise<void> {
    await this._app.api.renameDoc(docId, name);
    await this._updateWorkspaces();
  }

  public async deleteDoc(docId: string, forever: boolean): Promise<void> {
    await (forever ? this._app.api.deleteDoc(docId) : this._app.api.softDeleteDoc(docId));
    await this._updateWorkspaces();
  }

  public async restoreDoc(doc: Document): Promise<void> {
    await this._app.api.undeleteDoc(doc.id);
    await this._updateWorkspaces();
    reportMessage(`Document "${doc.name}" restored`);
  }

  public async pinUnpinDoc(docId: string, pin: boolean): Promise<void> {
    await (pin ? this._app.api.pinDoc(docId) : this._app.api.unpinDoc(docId));
    await this._updateWorkspaces();
  }

  public async moveDoc(docId: string, workspaceId: number): Promise<void> {
    await this._app.api.moveDoc(docId, workspaceId);
    await this._updateWorkspaces();
  }

  private _checkForDuplicates(name: string): void {
    if (this.workspaces.get().find(ws => ws.name === name)) {
      throw new UserError('Name already exists. Please choose a different name.');
    }
  }

  // Fetches and updates workspaces, which include contained docs as well.
  private async _updateWorkspaces() {
    if (this.isDisposed()) {
      return;
    }
    const org = this._app.currentOrg;
    if (!org) {
      this.workspaces.set([]);
      this.trashWorkspaces.set([]);
      this.templateWorkspaces.set([]);
      return;
    }

    this.loading.set(true);
    const currentPage = this.currentPage.get();
    const promises = [
      this._fetchWorkspaces(org.id, false).catch(reportError),
      currentPage === 'trash' ? this._fetchWorkspaces(org.id, true).catch(reportError) : null,
      this._maybeFetchTemplates(),
    ] as const;

    const promise = Promise.all(promises);
    if (await isLongerThan(promise, DELAY_BEFORE_SPINNER_MS)) {
      this.loading.set("slow");
    }
    const [wss, trashWss, templateWss] = await promise;
    if (this.isDisposed()) {
      return;
    }
    // bundleChanges defers computeds' evaluations until all changes have been applied.
    bundleChanges(() => {
      this.workspaces.set(wss || []);
      this.trashWorkspaces.set(trashWss || []);
      this.templateWorkspaces.set(templateWss || []);
      this.loading.set(false);
      this.available.set(!!wss);
      // Hide workspace name if we are showing a single (non-support) workspace, and active
      // product doesn't allow adding workspaces.  It is important to check both conditions because:
      //   * A personal org, where workspaces can't be added, can still have multiple
      //     workspaces via documents shared by other users.
      //   * An org with workspace support might happen to just have one workspace right
      //     now, but it is good to show names to highlight the possibility of adding more.
      const nonSupportWss = Array.isArray(wss) ? wss.filter(ws => !ws.isSupportWorkspace) : null;
      this.singleWorkspace.set(
        // The anon personal site always has 0 non-support workspaces.
        nonSupportWss?.length === 0 ||
        nonSupportWss?.length === 1 && _isSingleWorkspaceMode(this._app)
      );
    });
  }

  private async _fetchWorkspaces(orgId: number, forRemoved: boolean) {
    let api = this._app.api;
    if (forRemoved) {
        api = api.forRemoved();
    }
    const wss = await api.getOrgWorkspaces(orgId);
    if (this.isDisposed()) { return null; }
    for (const ws of wss) {
      ws.docs = sortBy(ws.docs, (doc) => doc.name.toLowerCase());

      // Populate doc.removedAt for soft-deleted docs even when deleted along with a workspace.
      if (forRemoved) {
        for (const doc of ws.docs) {
          doc.removedAt = doc.removedAt || ws.removedAt;
        }
      }

      // Populate doc.workspace, which is used by DocMenu/PinnedDocs and
      // is useful in cases where there are multiple workspaces containing
      // pinned documents that need to be sorted in alphabetical order.
      for (const doc of ws.docs) {
        doc.workspace = doc.workspace ?? ws;
      }
    }
    // Sort workspaces such that workspaces from the personal orgs of others
    // come after workspaces from our own personal org; workspaces from personal
    // orgs are grouped by personal org and the groups are ordered alphabetically
    // by owner name; and all else being equal workspaces are ordered alphabetically
    // by their name.  All alphabetical ordering is case-insensitive.
    // Workspaces shared from support account (e.g. samples) are put last.
    return sortBy(wss, (ws) => [ws.isSupportWorkspace,
                                ownerName(this._app, ws).toLowerCase(),
                                ws.name.toLowerCase()]);
  }

  /**
   * Fetches templates if on the Templates or All Documents page.
   *
   * Only fetches featured (pinned) templates on the All Documents page.
   */
  private async _maybeFetchTemplates(): Promise<Workspace[] | null> {
    const {templateOrg} = getGristConfig();
    if (!templateOrg) { return null; }

    const currentPage = this.currentPage.get();
    const shouldFetchTemplates = ['all', 'templates'].includes(currentPage);
    if (!shouldFetchTemplates) { return null; }

    let templateWss: Workspace[] = [];
    try {
      const onlyFeatured = currentPage === 'all';
      templateWss = await this._app.api.getTemplates(onlyFeatured);
    } catch {
      reportError('Failed to load templates');
    }
    if (this.isDisposed()) { return null; }

    for (const ws of templateWss) {
      for (const doc of ws.docs) {
        // Populate doc.workspace, which is used by DocMenu/PinnedDocs and
        // is useful in cases where there are multiple workspaces containing
        // pinned documents that need to be sorted in alphabetical order.
        doc.workspace = doc.workspace ?? ws;
      }
      ws.docs = sortBy(ws.docs, (doc) => doc.name.toLowerCase());
    }
    return templateWss;
  }

  private async _saveUserOrgPref<K extends keyof UserOrgPrefs>(key: K, value: UserOrgPrefs[K]) {
    const org = this._app.currentOrg;
    if (org) {
      org.userOrgPrefs = {...org.userOrgPrefs, [key]: value};
      this._userOrgPrefs.set(org.userOrgPrefs);
      await this._app.api.updateOrg('current', {userOrgPrefs: org.userOrgPrefs});
    }
  }
}

// Check if active product allows just a single workspace.
function _isSingleWorkspaceMode(app: AppModel): boolean {
  return app.currentFeatures.maxWorkspacesPerOrg === 1;
}

// Returns a default view mode preference. We used to show 'list' for everyone. We now default to
// 'icons' for new or light users. But if a user has more than 4 docs or any pinned docs, we'll
// switch to 'list'. This will also avoid annoying existing users who may prefer a list.
function getViewPrefDefault(workspaces: Workspace[]): ViewPref {
  const userWorkspaces = workspaces.filter(ws => !ws.isSupportWorkspace);
  const numDocs = userWorkspaces.reduce((sum, ws) => sum + ws.docs.length, 0);
  const pinnedDocs = userWorkspaces.some((ws) => ws.docs.some(doc => doc.isPinned));
  return (numDocs > 4 || pinnedDocs) ? 'list' : 'icons';
}

/**
 * Create observables for per-workspace view settings which default to org-wide settings, but can
 * be changed independently and persisted in localStorage.
 */
export function makeLocalViewSettings(home: HomeModel|null, wsId: number|'trash'|'all'|'templates'): ViewSettings {
  const userId = home?.app.currentUser?.id || 0;
  const sort = localStorageObs(`u=${userId}:ws=${wsId}:sort`);
  const view = localStorageObs(`u=${userId}:ws=${wsId}:view`);

  return {
    currentSort: Computed.create(null,
      // If no value in localStorage, use sort of All Documents.
      (use) => SortPref.parse(use(sort)) || (home ? use(home.currentSort) : 'name'))
      .onWrite((val) => sort.set(val)),
    currentView: Computed.create(null,
      // If no value in localStorage, use mode of All Documents, except Trash which defaults to 'list'.
      (use) => ViewPref.parse(use(view)) || (wsId === 'trash' ? 'list' : (home ? use(home.currentView) : 'icons')))
      .onWrite((val) => view.set(val)),
  };
}
