/**
 * The Comm object in this module implements communication with the server. We
 * communicate via request-response calls, and also receive async messages from
 * the server.
 *
 * In this implementation, a single WebSocket is used for both purposes.
 *
 * Calls to the server:
 *    Call a method of the Comm object. The return value is a promise which will
 *    be fulfilled with the data object of the response, or rejected with
 *    an error object.
 *
 * Async messages from the server:
 *    Listen to Comm for events documented below.
 *
 *
 * Implementation
 * --------------
 * Messages are serialized as JSON using types CommRequest, CommResponse, CommResponseError for
 * method calls, and CommMessage for async messages from the server. These are all defined in
 * app/common/CommTypes. Note that this is a matter between the client's and the server's
 * communication libraries, and code outside of them should not rely on these details.
 */

import {GristWSConnection} from 'app/client/components/GristWSConnection';
import * as dispose from 'app/client/lib/dispose';
import * as log from 'app/client/lib/log';
import {CommRequest, CommResponse, CommResponseBase, CommResponseError, ValidEvent} from 'app/common/CommTypes';
import {UserAction} from 'app/common/DocActions';
import {DocListAPI, OpenDocOptions, OpenLocalDocResult} from 'app/common/DocListAPI';
import {GristServerAPI} from 'app/common/GristServerAPI';
import {getInitialDocAssignment} from 'app/common/urlUtils';
import {Events as BackboneEvents} from 'backbone';

/**
 * A request that is currently being processed.
 */
export interface CommRequestInFlight {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  // clientId is non-null for those requests which should not be re-sent on reconnect if
  // the clientId has changed; it is null when it's safe to re-send.
  clientId: string|null;
  docId: string|null;
  methodName: string;
  requestMsg: string;
  sent: boolean;
}

function isCommResponseError(msg: CommResponse | CommResponseError): msg is CommResponseError {
  return Boolean(msg.error);
}

/**
 * Comm object provides the interfaces to communicate with the server.
 * Each method that calls to the server returns a promise for the response.
 */
export class Comm extends dispose.Disposable implements GristServerAPI, DocListAPI {
  // methods defined by GristServerAPI
  public logout = this._wrapMethod('logout');
  public updateProfile = this._wrapMethod('updateProfile');
  public getDocList = this._wrapMethod('getDocList');
  public createNewDoc = this._wrapMethod('createNewDoc');
  public importSampleDoc = this._wrapMethod('importSampleDoc');
  public importDoc = this._wrapMethod('importDoc');
  public deleteDoc = this._wrapMethod('deleteDoc');
  // openDoc has special definition below
  public renameDoc = this._wrapMethod('renameDoc');
  public getConfig = this._wrapMethod('getConfig');
  public updateConfig = this._wrapMethod('updateConfig');
  public lookupEmail = this._wrapMethod('lookupEmail');
  public getNewInvites = this._wrapMethod('getNewInvites');
  public getLocalInvites = this._wrapMethod('getLocalInvites');
  public ignoreLocalInvite = this._wrapMethod('ignoreLocalInvite');
  public showItemInFolder = this._wrapMethod('showItemInFolder');
  public getBasketTables = this._wrapMethod('getBasketTables');
  public embedTable = this._wrapMethod('embedTable');
  public reloadPlugins = this._wrapMethod('reloadPlugins');

  public pendingRequests: Map<number, CommRequestInFlight>;
  public nextRequestNumber: number = 0;

  protected listenTo: BackboneEvents["listenTo"];            // set by Backbone
  protected trigger: BackboneEvents["trigger"];              // set by Backbone
  protected stopListening: BackboneEvents["stopListening"];  // set by Backbone

  // This is a map from docId to the connection for the server that manages
  // that docId.  In classic Grist, which doesn't have fixed docIds or multiple
  // servers, the key is always "null".
  private _connections: Map<string|null, GristWSConnection> = new Map();
  private _collectedUserActions: UserAction[] | null;
  private _singleWorkerMode: boolean = getInitialDocAssignment() === null;  // is this classic Grist?
  private _reportError?: (err: Error) => void;  // optional callback for errors

  public create(reportError?: (err: Error) => void) {
    this._reportError = reportError;
    this.autoDisposeCallback(() => {
      for (const connection of this._connections.values()) { connection.dispose(); }
      this._connections.clear();
    });
    this.pendingRequests = new Map();
    this.nextRequestNumber = 0;

    // If collecting is turned on (by tests), this will be a list of UserActions sent to the server.
    this._collectedUserActions = null;
  }

  /**
   * Initialize a connection.  For classic Grist, with a single server
   * and mutable document identifiers, we will only ever have one
   * connection, shared for all uses.  For hosted Grist, with
   * permanent docIds which map to potentially distinct servers, we
   * have one connection per document.
   *
   * For classic grist, the docId passed here has no effect, and can
   * be null.  For hosted Grist, if the docId is null, the id will be
   * read from the configuration object sent by the server.  This
   * allows the Comm object to be initialized at the same stage as
   * it has been classically, eliminating a source of changes in timing
   * that could effect old tests.
   */
  public initialize(docId: string|null): GristWSConnection {
    docId = docId || getInitialDocAssignment();
    let connection = this._connections.get(docId);
    if (connection) { return connection; }
    connection = GristWSConnection.create(null);
    this._connections.set(docId, connection);
    this.listenTo(connection, 'serverMessage', this._onServerMessage.bind(this, docId));
    this.listenTo(connection, 'connectionStatus', (message: any, status: any) => {
      this.trigger('connectionStatus', message, status);
    });
    this.listenTo(connection, 'connectState', () => {
      const isConnected = [...this._connections.values()].some(c => c.established);
      this.trigger('connectState', isConnected);
    });

    connection.initialize(docId);
    return connection;
  }

  // Returns a map of docId -> docWorkerUrl for existing connections, for testing.
  public listConnections(): Map<string|null, string|null> {
    return new Map(Array.from(this._connections, ([docId, conn]) => [docId, conn.getDocWorkerUrlOrNull()]));
  }

  /**
   * The openDoc method is special, in that it is the first point at which
   * we commit to a particular document.  It is also the only method not
   * committed to a document that is called in hosted Grist - all other methods
   * are called via DocComm.
   */
  public async openDoc(docName: string, options?: OpenDocOptions): Promise<OpenLocalDocResult> {
    return this._makeRequest(null, docName, 'openDoc', docName, options);
  }

  /**
   * Ensure we have a connection to a docWorker serving docId, and mark it as in use by
   * incrementing its useCount. This connection will not be disposed until a corresponding
   * releaseDocConnection() is called.
   */
  public useDocConnection(docId: string): GristWSConnection {
    const connection = this._connection(docId);
    connection.useCount += 1;
    log.debug(`Comm.useDocConnection(${docId}): useCount now ${connection.useCount}`);
    return connection;
  }

  /**
   * Remove a connection associated with a particular document. In classic grist, we skip removal,
   * since all docs use the same server.
   * This should be called in pair with a preceding useDocConnection() call. It decrements the
   * connection's useCount, and disposes it when it's no longer in use.
   */
  public releaseDocConnection(docId: string): void {
    const connection = this._connections.get(docId);
    if (connection) {
      connection.useCount -= 1;
      log.debug(`Comm.releaseDocConnection(${docId}): useCount now ${connection.useCount}`);
      // Dispose the connection if it is no longer in use (except in "classic grist").
      if (!this._singleWorkerMode && connection.useCount <= 0) {
        this.stopListening(connection);
        connection.dispose();
        this._connections.delete(docId);
        this._rejectRequests(docId);
      }
    }
  }

  /**
   * Starts or stops the collection of UserActions.
   */
  public userActionsCollect(optYesNo?: boolean): void {
    this._collectedUserActions = optYesNo === false ? null : [];
  }

  /**
   * Returns all UserActions collected since collection started or since previous call.
   */
  public userActionsFetchAndReset(): UserAction[] {
    return this._collectedUserActions ? this._collectedUserActions.splice(0) : [];
  }

  /**
   * Add UserActions to a list, for use in tests. Called by DocComm.
   */
  public addUserActions(actions: UserAction[]) {
    // Note: collecting user-actions for testing is in Comm mainly for historical reasons.
    if (this._collectedUserActions) {
      this._collectedUserActions.push(...actions);
    }
  }

  /**
   * Returns a url to the worker serving the specified document.
   */
  public getDocWorkerUrl(docId: string|null): string {
    return this._connection(docId).docWorkerUrl;
  }

  /**
   * Returns true if there is one or more request that has not been fully processed.
   */
  public hasActiveRequests(): boolean {
    return this.pendingRequests.size !== 0;
  }

  /**
   * Wait for all active requests to complete.
   */
  public async waitForActiveRequests(): Promise<void> {
    await Promise.all(this.pendingRequests.values());
  }

  /**
   * Internal implementation of all the server methods. They differ only in the name of the server
   * method to call, and the arguments that it expects.
   *
   * This is made public for DocComm's use. Regular code should not call _makeRequest directly.
   *
   * @param {String} clientId - If non-null, we ensure that it matches the current clientId,
   *    rejecting the call otherwise. It should be bound to the session's clientId for
   *    session-specific calls, so that we can't send requests to the wrong session. See openDoc().
   * @param {String} methodName - The name of the server method to call.
   * @param {...} varArgs - Other method-specific arguments to send to the server.
   * @returns {Promise} Promise for the response. The server may fulfill or reject it, or it may be
   *    rejected in case of a disconnect.
   */
  public async _makeRequest(clientId: string|null, docId: string|null,
                            methodName: string, ...args: any[]): Promise<any> {
    const connection = this._connection(docId);
    if (clientId !== null && clientId !== connection.clientId) {
      log.warn("Comm: Rejecting " + methodName + " for outdated clientId %s (current %s)",
                  clientId, connection.clientId);
      return Promise.reject(new Error('Comm: outdated session'));
    }
    const request: CommRequest = {
      reqId: this.nextRequestNumber++,
      method: methodName,
      args
    };
    log.debug("Comm request #" + request.reqId + " " + methodName, request.args);
    return new Promise((resolve, reject) => {
      const requestMsg = JSON.stringify(request);
      const sent = connection.send(requestMsg);
      this.pendingRequests.set(request.reqId, {
        resolve,
        reject,
        clientId,
        docId,
        methodName,
        requestMsg,
        sent
      });
    });
  }

  /**
   * Create a connection to the specified document, or return an already open connection
   * that that document.  For a docId of null, any open connection will be returned, and
   * an error is thrown if no connection is already open.
   */
  private _connection(docId: string|null): GristWSConnection {
    // for classic Grist, "docIds" are untrustworthy doc names, but on the plus side
    // we only need one connections - so just replace docId with a constant.
    if (this._singleWorkerMode) { docId = null; }
    if (docId === null) {
      if (this._connections.size > 0) {
        return this._connections.values().next().value;
      }
      throw new Error('no connection available');
    }
    const connection = this._connections.get(docId);
    if (!connection) {
      return this.initialize(docId);
    }
    return connection;
  }

  /**
   * If GristWSConnection for a docId is disposed, requests that were sent to that doc will never
   * resolve. Reject them instead here.
   */
  private _rejectRequests(docId: string|null) {
    const error = "GristWSConnection disposed";
    for (const [reqId, req] of this.pendingRequests) {
      if (reqMatchesConnection(req.docId, docId)) {
        log.warn(`Comm: Rejecting req #${reqId} ${req.methodName}: ${error}`);
        this.pendingRequests.delete(reqId);
        req.reject(new Error('Comm: ' + error));
      }
    }
  }

  /**
   *
   * This module automatically logs any errors to the console, so callers an provide an empty
   * error-handling function if logging is all they need on error.
   *
   * We should watch timeouts, and log something when there is no response for a while.
   *    There is probably no need for callers to deal with timeouts.
   */
  private _onServerMessage(docId: string|null, message: CommResponseBase) {
    if ('reqId' in message) {
      const reqId = message.reqId;
      const r = this.pendingRequests.get(reqId);
      if (r) {
        try {
          if ('errorCode' in message && message.errorCode === 'AUTH_NO_VIEW') {
            // We should only arrive here if the user had view access, and then lost it.
            // We should not let the user see the document any more.  Let's reload the
            // page, reducing this to the problem of arriving at a document the user
            // doesn't have access to, which is already handled.
            log.warn(`Comm response #${reqId} ${r.methodName} issued AUTH_NO_VIEW - closing`);
            window.location.reload();
          }
          if (isCommResponseError(message)) {
            const err: any = new Error(message.error);
            let code = '';
            if (message.errorCode) {
              code = ` [${message.errorCode}]`;
              err.code = message.errorCode;
            }
            if (message.details) {
              err.details = message.details;
            }
            err.shouldFork = message.shouldFork;
            log.warn(`Comm response #${reqId} ${r.methodName} ERROR:${code} ${message.error}`
                        + (message.shouldFork ? ` (should fork)` : ''));
            this._reportError?.(err);
            r.reject(err);
          } else {
            log.debug(`Comm response #${reqId} ${r.methodName} OK`);
            r.resolve(message.data);
          }
        } finally {
          this.pendingRequests.delete(reqId);
        }
      } else {
        log.warn("Comm: Response to unknown reqId " + reqId);
      }
    } else {
      if (message.type === 'clientConnect') {
        // Reject or re-send any pending requests as appropriate in the order in which they were
        // added to the pendingRequests map.
        for (const [id, req] of this.pendingRequests) {
          if (reqMatchesConnection(req.docId, docId)) {
            this._resendPendingRequest(id, req);
          }
        }
      }

      // Another asynchronous message that's not a response. Broadcast it as an event.
      if (ValidEvent.guard(message.type)) {
        log.debug("Comm: Triggering event " + message.type);
        this.trigger(message.type, message);
      } else {
        log.warn("Comm: Server message of unknown type " + message.type);
      }
    }
  }

  private _resendPendingRequest(reqId: number, r: CommRequestInFlight) {
    let error = null;
    const connection = this._connection(r.docId);
    if (r.sent) {
      // If we sent a request, and reconnected before getting a response, we don't know what
      // happened. The safer choice is to reject the request.
      error = "interrupted by reconnect";
    } else if (r.clientId !== null && r.clientId !== connection.clientId) {
      // If we are waiting to send this request for a particular clientId, but clientId changed.
      error = "pending with outdated clientId";
    } else {
      // Waiting to send the request, and clientId is fine: go ahead and send it.
      r.sent = connection.send(r.requestMsg);
    }
    if (error) {
      log.warn("Comm: Rejecting req #" + reqId + " " + r.methodName + ": " + error);
      r.reject(new Error('Comm: ' + error));
      this.pendingRequests.delete(reqId);
    }
  }

  private _wrapMethod<Name extends keyof GristServerAPI>(name: Name): GristServerAPI[Name] {
    return this._makeRequest.bind(this, null, null, name);
  }
}

Object.assign(Comm.prototype, BackboneEvents);

function reqMatchesConnection(reqDocId: string|null, connDocId: string|null) {
  return reqDocId === connDocId || !reqDocId || !connDocId;
}
