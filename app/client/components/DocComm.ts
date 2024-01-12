import {Comm} from 'app/client/components/Comm';
import {reportError, reportMessage} from 'app/client/models/errors';
import {Notifier} from 'app/client/models/NotifyModel';
import {ActiveDocAPI, ApplyUAOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {CommMessage} from 'app/common/CommTypes';
import {UserAction} from 'app/common/DocActions';
import {OpenLocalDocResult} from 'app/common/DocListAPI';
import {docUrl} from 'app/common/urlUtils';
import {Events as BackboneEvents} from 'backbone';
import {Disposable, Emitter} from 'grainjs';

const SLOW_NOTIFICATION_TIMEOUT_MS = 1000; // applies to user actions only

/**
 * The type of data.methods object created by openDoc() in app/client/components/Comm.js.
 * This is used in much of client-side code, and exposed firstly as GristDoc.docComm.
 */
export class DocComm extends Disposable implements ActiveDocAPI {
  // These are all the methods of ActiveDocAPI. Listing them explicitly lets typescript verify
  // that we haven't missed any.
  // closeDoc has a special implementation below.
  public fetchTable = this._wrapMethod("fetchTable");
  public fetchTableSchema = this._wrapMethod("fetchTableSchema");
  public useQuerySet = this._wrapMethod("useQuerySet");
  public disposeQuerySet = this._wrapMethod("disposeQuerySet");
  // applyUserActions has a special implementation below.
  public applyUserActionsById = this._wrapMethod("applyUserActionsById");
  public importFiles = this._wrapMethod("importFiles");
  public finishImportFiles = this._wrapMethod("finishImportFiles");
  public cancelImportFiles = this._wrapMethod("cancelImportFiles");
  public generateImportDiff = this._wrapMethod("generateImportDiff");
  public addAttachments = this._wrapMethod("addAttachments");
  public findColFromValues = this._wrapMethod("findColFromValues");
  public getFormulaError = this._wrapMethod("getFormulaError");
  public fetchURL = this._wrapMethod("fetchURL");
  public autocomplete = this._wrapMethod("autocomplete");
  public removeInstanceFromDoc = this._wrapMethod("removeInstanceFromDoc");
  public getActionSummaries = this._wrapMethod("getActionSummaries");
  public startBundleUserActions = this._wrapMethod("startBundleUserActions");
  public stopBundleUserActions = this._wrapMethod("stopBundleUserActions");
  public forwardPluginRpc = this._wrapMethod("forwardPluginRpc");
  public reloadPlugins = this._wrapMethod("reloadPlugins");
  public reloadDoc = this._wrapMethod("reloadDoc");
  public fork = this._wrapMethod("fork");
  public checkAclFormula = this._wrapMethod("checkAclFormula");
  public getAclResources = this._wrapMethod("getAclResources");
  public waitForInitialization = this._wrapMethod("waitForInitialization");
  public getUsersForViewAs = this._wrapMethod("getUsersForViewAs");
  public getAccessToken = this._wrapMethod("getAccessToken");
  public getShare = this._wrapMethod("getShare");

  public changeUrlIdEmitter = this.autoDispose(new Emitter());

  // We save the clientId that was used when opening the doc. If it changes (e.g. reconnecting to
  // another server), it would be incorrect to use the new clientId without re-opening the doc
  // (which is handled by App.ts). This way, Comm can protect against mismatched clientIds.
  private _clientId: string;
  private _docFD: number;
  private _forkPromise: Promise<void>|null = null;
  private _isClosed: boolean = false;
  private listenTo: BackboneEvents['listenTo'];  // set by Backbone

  constructor(private _comm: Comm, openResponse: OpenLocalDocResult, private _docId: string,
              private _notifier: Notifier) {
    super();
    this._setOpenResponse(openResponse);
    // If *this* doc is shutdown forcibly (e.g. via reloadDoc call), mark it as closed, so we
    // don't attempt to close it again.
    this.listenTo(_comm, 'docShutdown', (m: CommMessage) => {
      if (this.isActionFromThisDoc(m)) { this._isClosed = true; }
    });
    this.onDispose(async () => {
      try {
        await this._shutdown();
      } catch (e) {
        if (!String(e).match(/GristWSConnection disposed/)) {
          reportError(e);
        }
      }
    });
  }

  // Returns the URL params that identifying this open document to the DocWorker
  // (used e.g. in attachment and download URLs).
  public getUrlParams(): {clientId: string, docFD: number} {
    return { clientId: this._clientId, docFD: this._docFD };
  }

  // Completes a path by adding the correct worker host and prefix for this document.
  // E.g. "/uploads" becomes "https://host.name/v/ver/o/org/uploads"
  public docUrl(path: string) {
    return docUrl(this.docWorkerUrl, path);
  }

  // Returns a base url to the worker serving the current document, e.g.
  // "https://host.name/v/ver/"
  public get docWorkerUrl() {
    return this._comm.getDocWorkerUrl(this._docId);
  }

  // Returns whether a message received by this Comm object is for the current doc.
  public isActionFromThisDoc(message: CommMessage): boolean {
    return message.docFD === this._docFD;
  }

  /**
   * Overrides applyUserActions() method to also add the UserActions to a list, for use in tests.
   */
  public applyUserActions(actions: UserAction[], options?: ApplyUAOptions): Promise<ApplyUAResult> {
    this._comm.addUserActions(actions);
    return this._callMethod('applyUserActions', actions, options);
  }

  /**
   * Overrides closeDoc() method to call to Comm directly, without triggering forking logic.
   * This is important in particular since it may be called while forking.
   */
  public closeDoc(): Promise<void> {
    return this._callDocMethod('closeDoc');
  }

  /**
   * Forks the document, making sure the url gets updated, and holding any actions
   * until the fork is complete.  If a fork has already been started/completed, this
   * does nothing.
   */
  public async forkAndUpdateUrl(): Promise<void> {
    await (this._forkPromise || (this._forkPromise = this._doForkDoc()));
  }

  // Clean up connection after closing doc.
  private async _shutdown() {
    console.log(`DocComm: shutdown clientId ${this._clientId} docFD ${this._docFD}`);
    try {
      // Close the document to unsubscribe from further updates on it.
      if (!this._isClosed) {
        await this.closeDoc();
      }
    } catch (err) {
      console.warn(`DocComm: closeDoc failed: ${err}`);
    } finally {
      if (!this._comm.isDisposed()) {
        this._comm.releaseDocConnection(this._docId);
      }
    }
  }

  /**
   * Store important information from the response to openDoc, and
   * ensure we have a connection to a docWorker for the document
   * identified by the current docId.  the caller of _setOpenResponse
   * should call _releaseDocConnection for any previous docId.
   */
  private _setOpenResponse(openResponse: OpenLocalDocResult) {
    this._docFD = openResponse.docFD;
    this._clientId = openResponse.clientId;
    this._comm.useDocConnection(this._docId);
  }

  private _wrapMethod<Name extends keyof ActiveDocAPI>(name: Name): ActiveDocAPI[Name] {
    return this._callMethod.bind(this, name);
  }

  private async _callMethod(name: keyof ActiveDocAPI, ...args: any[]): Promise<any> {
    return this._notifier.slowNotification(this._doCallMethod(name, ...args), SLOW_NOTIFICATION_TIMEOUT_MS);
  }

  private async _doCallMethod(name: keyof ActiveDocAPI, ...args: any[]): Promise<any> {
    if (this._forkPromise) {
      // If a fork is pending or has finished, call the method after waiting for it.
      // (If we've gone through a fork, we will not consider forking again.)
      await this._forkPromise;
      return this._callDocMethod(name, ...args);
    }
    try {
      return await this._callDocMethod(name, ...args);
    } catch (err) {
      // TODO should be the suggested fork id and fork user.
      if (err.shouldFork) {
        // If the server suggests to fork, do it now, or wait for the fork already pending.
        await this.forkAndUpdateUrl();
        return this._callDocMethod(name, ...args);
      }
      throw err;
    }
  }

  private _callDocMethod(name: keyof ActiveDocAPI, ...args: any[]): Promise<any> {
    return this._comm._makeRequest(this._clientId, this._docId, name, this._docFD, ...args);
  }

  private async _doForkDoc(): Promise<void> {
    reportMessage('Preparing your copy...', {key: 'forking'});
    const {urlId, docId} = await this.fork();
    // TODO: may want to preserve linkParameters in call to openDoc.
    const openResponse = await this._comm.openDoc(docId);
    // Close the old doc and release the old connection. Note that the closeDoc call is expected
    // to fail, since we close the websocket immediately after it. So let it fail silently.
    this.closeDoc().catch(() => null);
    this._comm.releaseDocConnection(this._docId);
    this._docId = docId;
    this._setOpenResponse(openResponse);
    this.changeUrlIdEmitter.emit(urlId);
    reportMessage('You are now editing your own copy', {key: 'forking'});
  }
}

Object.assign(DocComm.prototype, BackboneEvents);
