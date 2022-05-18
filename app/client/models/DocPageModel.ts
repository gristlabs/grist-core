import {GristDoc} from 'app/client/components/GristDoc';
import {IUndoState} from 'app/client/components/UndoStack';
import {loadGristDoc} from 'app/client/lib/imports';
import {AppModel, getOrgNameOrGuest, reportError} from 'app/client/models/AppModel';
import {getDoc} from 'app/client/models/gristConfigCache';
import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {addNewButton, cssAddNewButton} from 'app/client/ui/AddNewButton';
import {App} from 'app/client/ui/App';
import {cssLeftPanel, cssScrollPane} from 'app/client/ui/LeftPanelCommon';
import {buildPagesDom} from 'app/client/ui/Pages';
import {openPageWidgetPicker} from 'app/client/ui/PageWidgetPicker';
import {tools} from 'app/client/ui/Tools';
import {bigBasicButton} from 'app/client/ui2018/buttons';
import {testId} from 'app/client/ui2018/cssVars';
import {menu, menuDivider, menuIcon, menuItem, menuText} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {AsyncFlow, CancelledError, FlowRunner} from 'app/common/AsyncFlow';
import {delay} from 'app/common/delay';
import {OpenDocMode, UserOverride} from 'app/common/DocListAPI';
import {FilteredDocUsageSummary} from 'app/common/DocUsage';
import {IGristUrlState, parseUrlId, UrlIdParts} from 'app/common/gristUrls';
import {getReconnectTimeout} from 'app/common/gutil';
import {canEdit} from 'app/common/roles';
import {Document, NEW_DOCUMENT_CODE, Organization, UserAPI, Workspace} from 'app/common/UserAPI';
import {Holder, Observable, subscribe} from 'grainjs';
import {Computed, Disposable, dom, DomArg, DomElementArg} from 'grainjs';

// tslint:disable:no-console

export interface DocInfo extends Document {
  isReadonly: boolean;
  isPreFork: boolean;
  isFork: boolean;
  isRecoveryMode: boolean;
  userOverride: UserOverride|null;
  isBareFork: boolean;  // a document created without logging in, which is treated as a
                        // fork without an original.
  idParts: UrlIdParts;
  openMode: OpenDocMode;
}

export interface DocPageModel {
  pageType: "doc";

  appModel: AppModel;
  currentDoc: Observable<DocInfo|null>;
  currentDocUsage: Observable<FilteredDocUsageSummary|null>;

  // This block is to satisfy previous interface, but usable as this.currentDoc.get().id, etc.
  currentDocId: Observable<string|undefined>;
  currentWorkspace: Observable<Workspace|null>;
  // We may be given information about the org, because of our access to the doc, that
  // we can't get otherwise.
  currentOrg: Observable<Organization|null>;
  currentOrgName: Observable<string>;
  currentDocTitle: Observable<string>;
  isReadonly: Observable<boolean>;
  isPrefork: Observable<boolean>;
  isFork: Observable<boolean>;
  isRecoveryMode: Observable<boolean>;
  userOverride: Observable<UserOverride|null>;
  isBareFork: Observable<boolean>;

  importSources: ImportSource[];

  undoState: Observable<IUndoState|null>;          // See UndoStack for details.

  gristDoc: Observable<GristDoc|null>;             // Instance of GristDoc once it exists.

  createLeftPane(leftPanelOpen: Observable<boolean>): DomArg;
  renameDoc(value: string): Promise<void>;
  updateCurrentDoc(urlId: string, openMode: OpenDocMode): Promise<Document>;
  refreshCurrentDoc(doc: DocInfo): Promise<Document>;
  updateCurrentDocUsage(docUsage: FilteredDocUsageSummary): void;
  // Offer to open document in recovery mode, if user is owner, and report
  // the error that prompted the offer. If user is not owner, just flag that
  // document needs attention of an owner.
  offerRecovery(err: Error): void;
}

export interface ImportSource {
  label: string;
  action: () => void;
}


export class DocPageModelImpl extends Disposable implements DocPageModel {
  public readonly pageType = "doc";

  public readonly currentDoc = Observable.create<DocInfo|null>(this, null);
  public readonly currentDocUsage = Observable.create<FilteredDocUsageSummary|null>(this, null);

  public readonly currentUrlId = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.urlId : undefined);
  public readonly currentDocId = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.id : undefined);
  public readonly currentWorkspace = Computed.create(this, this.currentDoc, (use, doc) => doc && doc.workspace);
  public readonly currentOrg = Computed.create(this, this.currentWorkspace, (use, ws) => ws && ws.org);
  public readonly currentOrgName = Computed.create(this, this.currentOrg,
                                                   (use, org) => getOrgNameOrGuest(org, this.appModel.currentUser));
  public readonly currentDocTitle = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.name : '');
  public readonly isReadonly = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.isReadonly : false);
  public readonly isPrefork = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.isPreFork : false);
  public readonly isFork = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.isFork : false);
  public readonly isRecoveryMode = Computed.create(this, this.currentDoc,
                                                   (use, doc) => doc ? doc.isRecoveryMode : false);
  public readonly userOverride = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.userOverride : null);
  public readonly isBareFork = Computed.create(this, this.currentDoc, (use, doc) => doc ? doc.isBareFork : false);

  public readonly importSources: ImportSource[] = [];

  // Contains observables indicating whether undo/redo are disabled. See UndoStack for details.
  public readonly undoState: Observable<IUndoState|null> = Observable.create(this, null);

  // Observable set to the instance of GristDoc once it's created.
  public readonly gristDoc = Observable.create<GristDoc|null>(this, null);

  // Combination of arguments needed to open a doc (docOrUrlId + openMod). It's obtained from the
  // URL, and when it changes, we need to re-open.
  // If making a comparison, the id of the document we are comparing with is also included
  // in the openerDocKey.
  private _openerDocKey: string = "";

  // Holds a FlowRunner for _openDoc, which is essentially a cancellable promise. It gets replaced
  // (with the previous promise cancelled) when _openerDocKey changes.
  private _openerHolder = Holder.create<FlowRunner>(this);

  constructor(private _appObj: App, public readonly appModel: AppModel, private _api: UserAPI = appModel.api) {
    super();

    this.autoDispose(subscribe(urlState().state, (use, state) => {
      const urlId = state.doc;
      const urlOpenMode = state.mode;
      const linkParameters = state.params?.linkParameters;
      const docKey = this._getDocKey(state);
      if (docKey !== this._openerDocKey) {
        this._openerDocKey = docKey;
        this.gristDoc.set(null);
        this.currentDoc.set(null);
        this.undoState.set(null);
        if (!urlId) {
          this._openerHolder.clear();
        } else {
          FlowRunner.create(this._openerHolder,
            (flow: AsyncFlow) => this._openDoc(flow, urlId, urlOpenMode, state.params?.compare, linkParameters)
          )
          .resultPromise.catch(err => this._onOpenError(err));
        }
      }
    }));
  }

  public createLeftPane(leftPanelOpen: Observable<boolean>) {
    return cssLeftPanel(
      dom.maybe(this.gristDoc, (activeDoc) => [
        addNewButton(leftPanelOpen,
          menu(() => addMenu(this.importSources, activeDoc, this.isReadonly.get()), {
            placement: 'bottom-start',
            // "Add New" menu should have the same width as the "Add New" button that opens it.
            stretchToSelector: `.${cssAddNewButton.className}`
          }),
          testId('dp-add-new'),
          dom.cls('tour-add-new'),
        ),
        cssScrollPane(
          dom.create(buildPagesDom, activeDoc, leftPanelOpen),
          dom.create(tools, activeDoc, leftPanelOpen),
        )
      ]),
    );
  }

  public async renameDoc(value: string): Promise<void> {
    // The docId should never be unset when this option is available.
    const doc = this.currentDoc.get();
    if (doc) {
      if (value.length > 0) {
        await this._api.renameDoc(doc.id, value).catch(reportError);
        const newDoc = await this.refreshCurrentDoc(doc);
        // a "slug" component of the URL may change when the document name is changed.
        await urlState().pushUrl({...urlState().state.get(), ...docUrl(newDoc)}, {replace: true, avoidReload: true});
      } else {
        // This error won't be shown to user (caught by editableLabel).
        throw new Error(`doc name should not be empty`);
      }
    }
  }

  public async updateCurrentDoc(urlId: string, openMode: OpenDocMode) {
    // TODO It would be bad if a new doc gets opened while this getDoc() is pending...
    const newDoc = await getDoc(this._api, urlId);
    this.currentDoc.set(buildDocInfo(newDoc, openMode));
    return newDoc;
  }

  public async refreshCurrentDoc(doc: DocInfo) {
    return this.updateCurrentDoc(doc.urlId || doc.id, doc.openMode);
  }

  public updateCurrentDocUsage(docUsage: FilteredDocUsageSummary) {
    this.currentDocUsage.set(docUsage);
  }

  // Replace the URL without reloading the doc.
  public updateUrlNoReload(urlId: string, urlOpenMode: OpenDocMode, options: {replace: boolean}) {
    const state = urlState().state.get();
    const nextState = {...state, doc: urlId, mode: urlOpenMode === 'default' ? undefined : urlOpenMode};
    // We preemptively update _openerDocKey so that the URL update doesn't trigger a reload.
    this._openerDocKey = this._getDocKey(nextState);
    return urlState().pushUrl(nextState, {avoidReload: true, ...options});
  }

  public offerRecovery(err: Error) {
    const isDenied = (err as any).code === 'ACL_DENY';
    const isOwner = this.currentDoc.get()?.access === 'owners';
    confirmModal(
      "Error accessing document",
      "Reload",
      async () => window.location.reload(true),
      isOwner ? `You can try reloading the document, or using recovery mode. ` +
        `Recovery mode opens the document to be fully accessible to owners, and ` +
        `inaccessible to others. It also disables formulas. ` +
        `[${err.message}]` :
        isDenied ? `Sorry, access to this document has been denied. [${err.message}]` :
        `Document owners can attempt to recover the document. [${err.message}]`,
      {  hideCancel: true,
         extraButtons: (isOwner && !isDenied) ? bigBasicButton('Enter recovery mode', dom.on('click', async () => {
           await this._api.getDocAPI(this.currentDocId.get()!).recover(true);
           window.location.reload(true);
         }), testId('modal-recovery-mode')) : null,
      },
    );
  }

  private _onOpenError(err: Error) {
    if (err instanceof CancelledError) {
      // This means that we started loading a new doc before the previous one finished loading.
      console.log("DocPageModel _openDoc cancelled");
      return;
    }
    // Expected errors (e.g. Access Denied) produce a separate error page. For unexpected errors,
    // show a modal, and include a toast for the sake of the "Report error" link.
    reportError(err);
    this.offerRecovery(err);
  }

  private async _openDoc(flow: AsyncFlow, urlId: string, urlOpenMode: OpenDocMode | undefined,
                         comparisonUrlId: string | undefined,
                         linkParameters: Record<string, string> | undefined): Promise<void> {
    console.log(`DocPageModel _openDoc starting for ${urlId} (mode ${urlOpenMode})` +
                (comparisonUrlId ? ` (compare ${comparisonUrlId})` : ''));
    const gristDocModulePromise = loadGristDoc();

    const docResponse = await retryOnNetworkError(flow, getDoc.bind(null, this._api, urlId));
    const doc = buildDocInfo(docResponse, urlOpenMode);
    flow.checkIfCancelled();

    if (doc.urlId && doc.urlId !== urlId) {
      // Replace the URL to reflect the canonical urlId.
      await this.updateUrlNoReload(doc.urlId, doc.openMode, {replace: true});
    }

    this.currentDoc.set(doc);

    // Maintain a connection to doc-worker while opening a document. After it's opened, the DocComm
    // object created by GristDoc will maintain the connection.
    const comm = this._appObj.comm;
    comm.useDocConnection(doc.id);
    flow.onDispose(() => comm.releaseDocConnection(doc.id));

    const openDocResponse = await comm.openDoc(doc.id, doc.openMode, linkParameters);
    if (openDocResponse.recoveryMode || openDocResponse.userOverride) {
      doc.isRecoveryMode = Boolean(openDocResponse.recoveryMode);
      doc.userOverride = openDocResponse.userOverride || null;
      this.currentDoc.set({...doc});
    }
    if (openDocResponse.docUsage) {
      this.updateCurrentDocUsage(openDocResponse.docUsage);
    }
    const gdModule = await gristDocModulePromise;
    const docComm = gdModule.DocComm.create(flow, comm, openDocResponse, doc.id, this.appModel.notifier);
    flow.checkIfCancelled();

    docComm.changeUrlIdEmitter.addListener(async (newUrlId: string) => {
      // The current document has been forked, and should now be referred to using a new docId.
      const currentDoc = this.currentDoc.get();
      if (currentDoc) {
        await this.updateUrlNoReload(newUrlId, 'default', {replace: false});
        await this.updateCurrentDoc(newUrlId, 'default');
      }
    });

    // If a document for comparison is given, load the comparison, and provide it to the Gristdoc.
    const comparison = comparisonUrlId ?
      await this._api.getDocAPI(urlId).compareDoc(comparisonUrlId, { detail: true }) : undefined;

    const gristDoc = gdModule.GristDoc.create(flow, this._appObj, docComm, this, openDocResponse,
                                              this.appModel.topAppModel.plugins, {comparison});

    // Move ownership of docComm to GristDoc.
    gristDoc.autoDispose(flow.release(docComm));

    // Move ownership of GristDoc to its final owner.
    this.gristDoc.autoDispose(flow.release(gristDoc));
  }

  private _getDocKey(state: IGristUrlState) {
    const urlId = state.doc;
    const urlOpenMode = state.mode || 'default';
    const compareUrlId = state.params?.compare;
    const docKey = `${urlOpenMode}:${urlId}:${compareUrlId}`;
    return docKey;
  }
}


function addMenu(importSources: ImportSource[], gristDoc: GristDoc, isReadonly: boolean): DomElementArg[] {
  const selectBy = gristDoc.selectBy.bind(gristDoc);
  return [
    menuItem(
      (elem) => openPageWidgetPicker(elem, gristDoc.docModel, (val) => gristDoc.addNewPage(val).catch(reportError),
                                     {isNewPage: true, buttonLabel: 'Add Page'}),
      menuIcon("Page"), "Add Page", testId('dp-add-new-page'),
      dom.cls('disabled', isReadonly)
    ),
    menuItem(
      (elem) => openPageWidgetPicker(elem, gristDoc.docModel, (val) => gristDoc.addWidgetToPage(val).catch(reportError),
                                     {isNewPage: false, selectBy}),
      menuIcon("Widget"), "Add Widget to Page", testId('dp-add-widget-to-page'),
      // disable for readonly doc and all special views
      dom.cls('disabled', (use) => typeof use(gristDoc.activeViewId) !== 'number' || isReadonly),
    ),
    menuItem(() => gristDoc.addEmptyTable().catch(reportError),
      menuIcon("TypeTable"), "Add Empty Table", testId('dp-empty-table'),
      dom.cls('disabled', isReadonly)
    ),
    menuDivider(),
    ...importSources.map((importSource, i) =>
      menuItem(importSource.action,
        menuIcon('Import'),
        importSource.label,
        testId(`dp-import-option`),
        dom.cls('disabled', isReadonly)
      )
    ),
    isReadonly ? menuText('You do not have edit access to this document') : null,
    testId('dp-add-new-menu')
  ];
}

function buildDocInfo(doc: Document, mode: OpenDocMode | undefined): DocInfo {
  const idParts = parseUrlId(doc.urlId || doc.id);
  const isFork = Boolean(idParts.forkId || idParts.snapshotId);

  let openMode = mode;
  if (!openMode) {
    if (isFork) {
      // Ignore the document 'openMode' setting if the doc is an unsaved fork.
      openMode = 'default';
    } else {
      // Try to use the document's 'openMode' if it's set.
      openMode = doc.options?.openMode ?? 'default';
    }
  }

  const isPreFork = (openMode === 'fork');
  const isBareFork = isFork && idParts.trunkId === NEW_DOCUMENT_CODE;
  const isEditable = canEdit(doc.access) || isPreFork;
  return {
    ...doc,
    isFork,
    isRecoveryMode: false,  // we don't know yet, will learn when doc is opened.
    userOverride: null,     // ditto.
    isPreFork,
    isBareFork,
    isReadonly: !isEditable,
    idParts,
    openMode,
  };
}

const reconnectIntervals = [1000, 1000, 2000, 5000, 10000];

async function retryOnNetworkError<R>(flow: AsyncFlow, func: () => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await func();
    } catch (err) {
      // fetch() promises that network errors are reported as TypeError. We'll accept NetworkError too.
      if (err.name !== "TypeError" && err.name !== "NetworkError") {
        throw err;
      }
      const reconnectTimeout = getReconnectTimeout(attempt, reconnectIntervals);
      console.warn(`Call to ${func.name} failed, will retry in ${reconnectTimeout} ms`, err);
      await delay(reconnectTimeout);
      flow.checkIfCancelled();
    }
  }
}
