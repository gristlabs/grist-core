import {ApiError} from 'app/common/ApiError';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {delay} from 'app/common/delay';
import {CommClientConnect, CommMessage, CommResponse, CommResponseError} from 'app/common/CommTypes';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {FullUser, UserProfile} from 'app/common/LoginSessionAPI';
import {TelemetryMetadata} from 'app/common/Telemetry';
import {ANONYMOUS_USER_EMAIL} from 'app/common/UserAPI';
import {normalizeEmail} from 'app/common/emails';
import {User} from 'app/gen-server/entity/User';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer} from 'app/server/lib/Authorizer';
import {ScopedSession} from 'app/server/lib/BrowserSession';
import type {Comm} from 'app/server/lib/Comm';
import {DocSession} from 'app/server/lib/DocSession';
import log from 'app/server/lib/log';
import {LogMethods} from "app/server/lib/LogMethods";
import {MemoryPool} from 'app/server/lib/MemoryPool';
import {shortDesc} from 'app/server/lib/shortDesc';
import {fromCallback} from 'app/server/lib/serverUtils';
import {i18n} from 'i18next';
import * as crypto from 'crypto';
import moment from 'moment';
import {GristServerSocket} from 'app/server/lib/GristServerSocket';

// How many messages and bytes to accumulate for a disconnected client before booting it.
// The benefit is that a client who temporarily disconnects and reconnects without missing much,
// would not need to reload the document.
const clientMaxMissedMessages = 100;
const clientMaxMissedBytes = 1_000_000;

export type ClientMethod = (client: Client, ...args: any[]) => Promise<unknown>;

// How long the client state persists after a disconnect.
const clientRemovalTimeoutMs = 300 * 1000;   // 300s = 5 minutes.

// How much memory to allow using for large JSON responses before waiting for some to clear.
// Max total across all clients and all JSON responses.
const jsonResponseTotalReservation = 500 * 1024 * 1024;
// Estimate of a single JSON response, used before we know how large it is. Together with the
// above, it works to limit parallelism (to 25 responses that can be started in parallel).
const jsonResponseReservation = 20 * 1024 * 1024;
export const jsonMemoryPool = new MemoryPool(jsonResponseTotalReservation);

// A hook for dependency injection.
export const Deps = {clientRemovalTimeoutMs, jsonResponseReservation};

/**
 * Generates and returns a random string to use as a clientId. This is better
 * than numbering clients with consecutive integers; otherwise a reconnecting
 * client presenting the previous clientId to a restarted (new) server may
 * accidentally associate itself with a wrong session that happens to share the
 * same clientId. In other words, we need clientIds to be unique across server
 * restarts.
 * @returns {String} - random string to use as a new clientId.
 */
function generateClientId(): string {
  // Non-blocking version of randomBytes may fail if insufficient entropy is available without
  // blocking. If we encounter that, we could either block, or maybe use less random values.
  return crypto.randomBytes(8).toString('hex');
}

/**
 * These are the types of messages that are allowed to be sent to the client even if the client is
 * not authorized to use this instance (e.g. not a member of the team for this subdomain).
 */
const MESSAGE_TYPES_NO_AUTH = new Set([
  'clientConnect',
]);

// tslint:disable-next-line:no-unused-expression Silence "unused variable" warning.
void(MESSAGE_TYPES_NO_AUTH);

/**
 * Class that encapsulates the information for a client. A Client may survive
 * across multiple websocket reconnects.
 * TODO: this could provide a cleaner interface.
 *
 * @param comm: parent Comm object
 * @param websocket: websocket connection
 * @param methods: a mapping from method names to server methods (must return promises)
 */
export class Client {
  public readonly clientId: string;

  public browserSettings: BrowserSettings = {};

  private _session: ScopedSession|null = null;

  private _log = new LogMethods('Client ', (extra?: object|null) => this.getLogMeta(extra || {}));

  // Maps docFDs to DocSession objects.
  private _docFDs: Array<DocSession|null> = [];

  private _missedMessages = new Map<number, string>();
  private _missedMessagesTotalLength: number = 0;
  private _destroyTimer: NodeJS.Timer|null = null;
  private _destroyed: boolean = false;
  private _websocket: GristServerSocket|null;
  private _org: string|null = null;
  private _profile: UserProfile|null = null;
  private _user: FullUser|undefined = undefined;
  private _firstLoginAt: Date|null = null;
  private _nextSeqId: number = 0;     // Next sequence-ID for messages sent to the client

  // Identifier for the current GristWSConnection object connected to this client.
  private _counter: string|null = null;
  private _i18Instance?: i18n;

  constructor(
    private _comm: Comm,
    private _methods: Map<string, ClientMethod>,
    private _locale: string,
    i18Instance?: i18n,
  ) {
    this.clientId = generateClientId();
    this._i18Instance = i18Instance?.cloneInstance({
      lng: this._locale,
    });
  }

  public toString() { return `Client ${this.clientId} #${this._counter}`; }

  public t(key: string, args?: any): string {
    return this._i18Instance?.t(key, args) ?? key;
  }

  public get locale(): string|undefined {
    return this._locale;
  }

  public setConnection(websocket: GristServerSocket, counter: string|null, browserSettings: BrowserSettings) {
    this._websocket = websocket;
    this._counter = counter;
    this.browserSettings = browserSettings;

    websocket.onerror = (err: Error) => this._onError(err);
    websocket.onclose = () => this._onClose();
    websocket.onmessage = (msg: string) => this._onMessage(msg);
  }

  /**
   * Returns DocSession for the given docFD, or throws an exception if this doc is not open.
   */
  public getDocSession(fd: number): DocSession {
    const docSession = this._docFDs[fd];
    if (!docSession) {
      throw new Error(`Invalid docFD ${fd}`);
    }
    return docSession;
  }

  // Adds a new DocSession to this Client, and returns the new FD for it.
  public addDocSession(activeDoc: ActiveDoc, authorizer: Authorizer): DocSession {
    const fd = this._getNextDocFD();
    const docSession = new DocSession(activeDoc, this, fd, authorizer);
    this._docFDs[fd] = docSession;
    return docSession;
  }

  // Removes a DocSession from this Client, called when a doc is closed.
  public removeDocSession(fd: number): void {
    this._docFDs[fd] = null;
  }

  /**
   * Closes all docs. Returns the number of documents closed.
   */
  public closeAllDocs(): number {
    let count = 0;
    for (let fd = 0; fd < this._docFDs.length; fd++) {
      const docSession = this._docFDs[fd];
      if (docSession && docSession.activeDoc) {
        // Note that this indirectly calls to removeDocSession(docSession.fd)
        docSession.activeDoc.closeDoc(docSession)
          .catch((e) => { this._log.warn(null, "error closing docFD %d", fd); });
        count++;
      }
      this._docFDs[fd] = null;
    }
    return count;
  }

  public interruptConnection() {
    if (this._websocket) {
      this._websocket.removeAllListeners();
      this._websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
      this._websocket = null;
    }
  }

  /**
   * Sends a message to the client. If the send fails in a way that the message can't get queued
   * (e.g. due to an unexpected exception in code), logs an error and interrupts the connection.
   */
  public async sendMessageOrInterrupt(messageObj: CommMessage|CommResponse|CommResponseError): Promise<void> {
    try {
      await this.sendMessage(messageObj);
    } catch (e) {
      this._log.error(null, 'sendMessage error', e);
      this.interruptConnection();
    }
  }

  /**
   * Sends a message to the client, queuing it up on failure or if the client is disconnected.
   */
  public async sendMessage(messageObj: CommMessage|CommResponse|CommResponseError): Promise<void> {
    if (this._destroyed) {
      return;
    }

    // Large responses require memory; with many connected clients this can crash the server. We
    // manage it using a MemoryPool, waiting for free space to appear. This only controls the
    // memory used to hold the JSON.stringify result. Once sent, the reservation is released.
    //
    // Actual process memory will go up also as the outgoing data is sitting in socket buffers,
    // but this isn't part of Node's heap. If an outgoing buffer is full, websocket.send may
    // block, and MemoryPool will delay other responses. There is a risk here of unresponsive
    // clients exhausing the MemoryPool, perhaps intentionally. To mitigate, we could destroy
    // clients that are too slow in reading. This isn't currently done.
    //
    // Also, we do not manage memory of responses moved to a client's _missedMessages queue. But
    // we do limit those in size.
    //
    // Overall, a better solution would be to stream large responses, or to have the client
    // request data piecemeal (as we'd have to for handling large data).

    await jsonMemoryPool.withReserved(Deps.jsonResponseReservation, async (updateReservation) => {
      if (this._destroyed) {
        // If this Client got destroyed while waiting, stop here and release the reservation.
        return;
      }
      const seqId = this._nextSeqId++;
      const message: string = JSON.stringify({...messageObj, seqId});
      const size = Buffer.byteLength(message, 'utf8');
      updateReservation(size);

      // Log something useful about the message being sent.
      if ('error' in messageObj && messageObj.error) {
        this._log.warn(null, "responding to #%d ERROR %s", messageObj.reqId, messageObj.error);
      }

      if (this._websocket) {
        // If we have a websocket, send the message.
        try {
          await this._sendToWebsocket(message);
          // NOTE: A successful send does NOT mean the message was received. For a better system, see
          // https://docs.microsoft.com/en-us/azure/azure-web-pubsub/howto-develop-reliable-clients
          // (keeping a copy of messages until acked). With our system, we are more likely to be
          // lacking the needed messages on reconnect, and having to reset the client.
          return;
        } catch (err) {
          // Sending failed. Add the message to missedMessages.
          this._log.warn(null, "sendMessage: queuing after send error:", err.toString());
        }
      }
      if (this._missedMessages.size < clientMaxMissedMessages &&
          this._missedMessagesTotalLength + message.length <= clientMaxMissedBytes) {
        // Queue up the message.
        // TODO: this keeps the memory but releases jsonMemoryPool reservation, which is wrong --
        // it may allow too much memory to be used. This situation is rare, however, so maybe OK
        // as is. Ideally, the queued messages could reserve memory in a "nice to have" mode, and
        // if memory is needed for something more important, the queue would get dropped.
        // (Holding on to the memory reservation here would creates a risk of freezing future
        // responses, which seems *more* dangerous than a crash because a crash would at least
        // lead to an eventual recovery.)
        this._missedMessages.set(seqId, message);
        this._missedMessagesTotalLength += message.length;
      } else {
        // Too many messages queued. Boot the client now, to make it reset when/if it reconnects.
        this._log.warn(null, "sendMessage: too many messages queued; booting client");
        this.destroy();
      }
    });
  }

  /**
   * Called from Comm.ts to decide whether this Client is available to accept a new connection
   * that requests the same clientId.
   */
  public canAcceptConnection(): boolean {
    // Refuse reconnect if another websocket is currently active. It may be a new browser tab
    // (which may reuse clientId from a copy of sessinStorage). It will need its own Client object.
    return !this._websocket;
  }

  /**
   * Complete initialization of a new connection, and send the initial 'clientConnect' message.
   * See comments at the top of app/server/lib/Comm.ts for some relevant notes.
   */
  public async sendConnectMessage(
    newClient: boolean, reuseClient: boolean, lastSeqId: number|null, parts: Partial<CommClientConnect>
  ): Promise<void> {
    if (this._destroyTimer) {
      clearTimeout(this._destroyTimer);
      this._destroyTimer = null;
    }

    let missedMessages: string[]|undefined = undefined;
    let seamlessReconnect = false;
    if (!newClient && reuseClient && await this._isAuthorized()) {
      // Websocket-level reconnect: existing browser tab reconnected to an existing Client object.
      // We also check that the Client is still authorized to access all open docs. If not, we'll
      // close the docs and tell the Client to reload the app.
      missedMessages = this.getMissedMessages(lastSeqId);
      if (missedMessages) {
        // We have all the needed messages (possibly an empty array); can do a seamless reconnect.
        seamlessReconnect = true;
      }
    }

    // We collected any missed messages we need; clear the stored map of them.
    this._missedMessages.clear();
    this._missedMessagesTotalLength = 0;

    let docsClosed: number|null = null;
    if (!seamlessReconnect) {
      // The browser client can't recover from missed messages and will need to reopen docs. Close
      // all docs we kept open. If it's a new Client object, this is a no-op.
      docsClosed = this.closeAllDocs();
    }

    // An existing browser client that can't recover, or that connected to a new Client object,
    // will need to reopen docs. Tell it to reload.
    const needReload = !newClient && !seamlessReconnect;

    this._log.debug({newClient, needReload, docsClosed, missedMessages: missedMessages?.length},
      'sending clientConnect');

    // Don't use sendMessage here, since we don't want to queue up this message on failure.
    const clientConnectMsg: CommClientConnect = {
      ...parts,
      type: 'clientConnect',
      clientId: this.clientId,
      profile: this._profile,
      missedMessages,
      needReload,
    };

    try {
      await this._sendToWebsocket(JSON.stringify(clientConnectMsg));

      if (needReload) {
        // If the client should reload, close the socket without waiting. This connection should
        // not be used anyway, and we want it released by the time the new connection comes in.
        this._websocket?.close();
        return;
      }

      // A heavy-handed fix to T396, since 'clientConnect' is sometimes not seen in the browser,
      // (seemingly when the 'message' event is triggered before 'open' on the native WebSocket.)
      // See also my report at https://stackoverflow.com/a/48411315/328565
      await delay(250);

      if (!this._destroyed && this._websocket?.isOpen) {
        await this._sendToWebsocket(JSON.stringify({...clientConnectMsg, dup: true}));
      }
    } catch (err) {
      // It's possible that the connection was closed while we were preparing this response.
      // We just warn, and let _onClose() take care of cleanup.
      this._log.warn(null, "failed to prepare or send clientConnect:", err.toString());
    }
  }

  // Get messages in order of their key in the _missedMessages map.
  public getMissedMessages(lastSeqId: number|null): string[]|undefined {
    const result: string[] = [];
    if (lastSeqId !== null) {
      for (let i = lastSeqId + 1; i < this._nextSeqId; i++) {
        const m = this._missedMessages.get(i);
        if (m === undefined) { return; }
        result.push(m);
      }
    }
    return result;
  }

  // Assigns the given ScopedSession to the client.
  public setSession(session: ScopedSession): void {
    this._session = session;
  }

  public getSession(): ScopedSession|null {
    return this._session;
  }

  public getAltSessionId(): string|undefined {
    return this._session?.getAltSessionId();
  }

  /**
   * Destroys a client. If the same browser window reconnects later, it will get a new Client
   * object and clientId.
   */
  public destroy() {
    const docsClosed = this.closeAllDocs();
    this._log.info({docsClosed}, "client gone");
    if (this._destroyTimer) {
      clearTimeout(this._destroyTimer);
      this._destroyTimer = null;
    }
    this._missedMessages.clear();
    this._missedMessagesTotalLength = 0;
    this._comm.removeClient(this);
    this._destroyed = true;
  }

  public setOrg(org: string): void {
    this._org = org;
  }

  public getOrg(): string {
    return this._org!;
  }

  public setProfile(profile: UserProfile|null): void {
    this._profile = profile;
    // Unset user, so that we look it up again on demand.
    this._user = undefined;
    this._firstLoginAt = null;
  }

  public getProfile(): UserProfile|null {
    if (!this._profile) {
      return {
        name: 'Anonymous',
        email: ANONYMOUS_USER_EMAIL,
        anonymous: true,
      };
    }
    // If we have a database, the user id and name will have been
    // fetched before we start using the Client, so we take this
    // opportunity to update the user name to use the latest user name
    // in the database (important since user name is now exposed via
    // user.Name in granular access support). TODO: might want to
    // subscribe to changes in user name while the document is open.
    return {...this._profile, ...this._user};
  }

  public getCachedUserId(): number|null {
    return this._user?.id ?? null;
  }

  public getCachedUserRef(): string|null {
    return this._user?.ref ?? null;
  }

  // Returns the userId for profile.email, or null when profile is not set; with caching.
  public async getUserId(dbManager: HomeDBManager): Promise<number|null> {
    if (!this._user) {
      await this._refreshUser(dbManager);
    }
    return this._user?.id ?? null;
  }

  // Returns the userRef for profile.email, or null when profile is not set; with caching.
  public async getUserRef(dbManager: HomeDBManager): Promise<string|null> {
    if (!this._user) {
      await this._refreshUser(dbManager);
    }
    return this._user?.ref ?? null;
  }

  // Returns the userId for profile.email, or throws 403 error when profile is not set.
  public async requireUserId(dbManager: HomeDBManager): Promise<number> {
    const userId = await this.getUserId(dbManager);
    if (userId) { return userId; }
    throw new ApiError(this._profile ? `user not known: ${this._profile.email}` : 'user not set', 403);
  }

  public getLogMeta(meta: {[key: string]: any} = {}) {
    if (this._profile) { meta.email = this._user?.loginEmail || normalizeEmail(this._profile.email); }
    // We assume the _user has already been cached, which will be true always (for all practical
    // purposes) because it's set when the Authorizer checks this client.
    if (this._user) { meta.userId = this._user.id; }
    // Likewise for _firstLoginAt, which we learn along with _userId.
    if (this._firstLoginAt) {
      meta.age = Math.floor(moment.duration(moment().diff(this._firstLoginAt)).asDays());
    }
    if (this._org) { meta.org = this._org; }
    const altSessionId = this.getAltSessionId();
    if (altSessionId) { meta.altSessionId = altSessionId; }
    meta.clientId = this.clientId;    // identifies a client connection, essentially a websocket
    meta.counter = this._counter;     // identifies a GristWSConnection in the connected browser tab
    return meta;
  }

  public getFullTelemetryMeta(): TelemetryMetadata {
    const meta: TelemetryMetadata = {};
    // We assume the _userId has already been cached, which will be true always (for all practical
    // purposes) because it's set when the Authorizer checks this client.
    if (this._user) { meta.userId = this._user.id; }
    const altSessionId = this.getAltSessionId();
    if (altSessionId) { meta.altSessionId = altSessionId; }
    return meta;
  }

  private async _refreshUser(dbManager: HomeDBManager) {
    const user = this._profile ? await this._fetchUser(dbManager) : dbManager.getAnonymousUser();
    this._user = user ? dbManager.makeFullUser(user) : undefined;
    this._firstLoginAt = user?.firstLoginAt || null;
  }

  private async _onMessage(message: string): Promise<void> {
    try {
      await this._onMessageImpl(message);
    } catch (err) {
      this._log.warn(null, 'onMessage error received for message "%s": %s', shortDesc(message), err.stack);
    }
  }

  /**
   * Processes a request from a client. All requests from a client get a response, at least to
   * indicate success or failure.
   */
  private async _onMessageImpl(message: string): Promise<void> {
    const request = JSON.parse(message);
    if (request.beat) {
      // this is a heart beat, to keep the websocket alive.  No need to reply.
      log.rawInfo('heartbeat', {
        ...this.getLogMeta(),
        url: request.url,
        docId: request.docId,  // caution: trusting client for docId for this purpose.
      });
      return;
    } else {
      this._log.info(null, "onMessage", shortDesc(message));
    }
    let response: CommResponse|CommResponseError;
    const method = this._methods.get(request.method);
    if (!method) {
      response = {reqId: request.reqId, error: `Unknown method ${request.method}`};
    } else {
      try {
        response = {reqId: request.reqId, data: await method(this, ...request.args)};
      } catch (error) {
        const err: ErrorWithCode = error;
        // Print the error stack, except for SandboxErrors, for which the JS stack isn't that useful.
        // Also not helpful is the stack of AUTH_NO_VIEW|EDIT errors produced by the Authorizer.
        const code: unknown = err.code;
        const skipStack = (
          !err.stack ||
          err.stack.match(/^SandboxError:/) ||
          (typeof code === 'string' && code.startsWith('AUTH_NO'))
        );

        this._log.warn(null, "Responding to method %s with error: %s %s",
          request.method, skipStack ? err : err.stack, code || '');
        response = {reqId: request.reqId, error: err.message};
        if (err.code) {
          response.errorCode = err.code;
        }
        if (err.details) {
          response.details = err.details;
        }
        if (typeof code === 'string' && code === 'AUTH_NO_EDIT' && err.accessMode === 'fork') {
          response.shouldFork = true;
        }
      }
    }
    await this.sendMessageOrInterrupt(response);
  }

  // Fetch the user database record from profile.email, or null when profile is not set.
  private async _fetchUser(dbManager: HomeDBManager): Promise<User|undefined> {
    return this._profile && this._profile.email ?
      await dbManager.getUserByLogin(this._profile.email) :
      undefined;
  }

  // Check that client still has access to all documents.  Used to determine whether
  // a Comm client can be safely reused after a reconnect.  Without this check, the client
  // would be reused even if access to a document has been lost (although an error would be
  // issued later, on first use of the document).
  private async _isAuthorized(): Promise<boolean> {
    for (const docFD of this._docFDs) {
      try {
        if (docFD !== null) { await docFD.authorizer.assertAccess('viewers'); }
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  // Returns the next unused docFD number.
  private _getNextDocFD(): number {
    let fd = 0;
    while (this._docFDs[fd]) { fd++; }
    return fd;
  }

  private _sendToWebsocket(message: string): Promise<void> {
    return fromCallback(cb => this._websocket!.send(message, cb));
  }

  /**
   * Processes an error on the websocket.
   */
  private _onError(err: Error) {
    this._log.warn(null, "onError", err);
    // TODO Make sure that this is followed by onClose when the connection is lost.
  }

  /**
   * Processes the closing of a websocket.
   */
  private _onClose() {
    this._websocket?.removeAllListeners();

    // Remove all references to the websocket.
    this._websocket = null;

    if (!this._destroyed) {
      // Schedule the client to be destroyed after a timeout. The timer gets cleared if the same
      // client reconnects in the interim.
      if (this._destroyTimer) {
        this._log.warn(null, "clearing previously scheduled destruction");
        clearTimeout(this._destroyTimer);
      }
      this._log.info(null, "websocket closed; will discard client in %s sec", Deps.clientRemovalTimeoutMs / 1000);
      this._destroyTimer = setTimeout(() => this.destroy(), Deps.clientRemovalTimeoutMs);
    }
  }
}
