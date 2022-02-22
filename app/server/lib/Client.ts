import {ApiError} from 'app/common/ApiError';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {getLoginState, LoginState} from 'app/common/LoginState';
import {ANONYMOUS_USER_EMAIL} from 'app/common/UserAPI';
import {User} from 'app/gen-server/entity/User';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer} from 'app/server/lib/Authorizer';
import {ScopedSession} from 'app/server/lib/BrowserSession';
import {DocSession} from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import {LogMethods} from "app/server/lib/LogMethods";
import {shortDesc} from 'app/server/lib/shortDesc';
import * as crypto from 'crypto';
import * as moment from 'moment';

/// How many messages to accumulate for a disconnected client before booting it.
const clientMaxMissedMessages = 100;

export type ClientMethod = (client: Client, ...args: any[]) => Promise<any>;

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
  'profileFetch',
  'userSettings',
  'clientLogout',
]);

// tslint:disable-next-line:no-unused-expression Silence "unused variable" warning.
void(MESSAGE_TYPES_NO_AUTH);

/**
 * Class that encapsulates the information for a client. A Client may survive
 * across multiple websocket reconnects.
 * TODO: this could provide a cleaner interface.
 *
 * @param comm: parent Comm object
 * @param websocket: websocket connection, promisified to have a sendAsync method
 * @param methods: a mapping from method names to server methods (must return promises)
 */
export class Client {
  public readonly clientId: string;

  public browserSettings: BrowserSettings = {};

  private _session: ScopedSession|null = null;

  private _log = new LogMethods('Client ', (s: null) => this.getLogMeta());

  // Maps docFDs to DocSession objects.
  private _docFDs: Array<DocSession|null> = [];

  private _missedMessages: any = [];
  private _destroyTimer: NodeJS.Timer|null = null;
  private _destroyed: boolean = false;
  private _websocket: any;
  private _loginState: LoginState|null = null;
  private _org: string|null = null;
  private _profile: UserProfile|null = null;
  private _userId: number|null = null;
  private _firstLoginAt: Date|null = null;
  private _isAnonymous: boolean = false;
  // Identifier for the current GristWSConnection object connected to this client.
  private _counter: string|null = null;

  constructor(
    private _comm: any,
    private _methods: any,
    private _host: string,
    private _locale?: string,
  ) {
    this.clientId = generateClientId();
  }

  public toString() { return `Client ${this.clientId} #${this._counter}`; }

  // Returns the LoginState object that's encoded and passed via login pages to login-connect.
  public getLoginState(): LoginState|null { return this._loginState; }

  public setCounter(counter: string) {
    this._counter = counter;
  }

  public get host(): string {
    return this._host;
  }

  public get locale(): string|undefined {
    return this._locale;
  }

  public setConnection(websocket: any, reqHost: string, browserSettings: BrowserSettings) {
    this._websocket = websocket;
    // Set this._loginState, used by CognitoClient to construct login/logout URLs.
    this._loginState = getLoginState(reqHost);
    this.browserSettings = browserSettings;
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

  // Check that client still has access to all documents.  Used to determine whether
  // a Comm client can be safely reused after a reconnect.  Without this check, the client
  // would be reused even if access to a document has been lost (although an error would be
  // issued later, on first use of the document).
  public async isAuthorized(): Promise<boolean> {
    for (const docFD of this._docFDs) {
      try {
        if (docFD !== null) { await docFD.authorizer.assertAccess('viewers'); }
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  /**
   * Closes all docs.
   */
  public closeAllDocs() {
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
    this._log.debug(null, "closeAllDocs() closed %d doc(s)", count);
  }

  public interruptConnection() {
    if (this._websocket) {
      this._websocket.removeAllListeners();
      this._websocket.terminate();  // close() is inadequate when ws routed via loadbalancer
      this._websocket = null;
    }
  }

  /**
   * Sends a message to the client, queuing it up on failure or if the client is disconnected.
   */
  public async sendMessage(messageObj: any): Promise<void> {
    if (this._destroyed) {
      return;
    }

    const message: string = JSON.stringify(messageObj);

    // Log something useful about the message being sent.
    if (messageObj.error) {
      this._log.warn(null, "responding to #%d ERROR %s", messageObj.reqId, messageObj.error);
    }

    if (this._websocket) {
      // If we have a websocket, send the message.
      try {
        await this._websocket.sendAsync(message);
      } catch (err) {
        // Sending failed. Presumably we should be getting onClose around now too.
        // NOTE: if this handler is run after onClose, we could have messages end up out of order.
        // Let's check to make sure. If this can happen, we need to refactor for correct ordering.
        if (!this._websocket) {
          this._log.error(null, "sendMessage: UNEXPECTED ORDER OF CALLBACKS");
        }
        this._log.warn(null, "sendMessage: queuing after send error: %s", err.toString());
        this._missedMessages.push(message);
      }
    } else if (this._missedMessages.length < clientMaxMissedMessages) {
      // Queue up the message.
      this._missedMessages.push(message);
    } else {
      // Too many messages queued. Boot the client now, to make it reset when/if it reconnects.
      this._log.error(null, "sendMessage: too many messages queued; booting client");
      if (this._destroyTimer) {
        clearTimeout(this._destroyTimer);
        this._destroyTimer = null;
      }
      this._comm._destroyClient(this);
    }
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

  public destroy() {
    this._destroyed = true;
  }

  /**
   * Processes a request from a client. All requests from a client get a response, at least to
   * indicate success or failure.
   */
  public async onMessage(message: string): Promise<void> {
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
    const response: any = {reqId: request.reqId};
    const method = this._methods[request.method];
    if (!method) {
      response.error = `Unknown method ${request.method}`;
    } else {
      try {
        response.data = await method(this, ...request.args);
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

        this._log.warn(null, "Error %s %s", skipStack ? err : err.stack, code || '');
        response.error = err.message;
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
    await this.sendMessage(response);
  }

  public setOrg(org: string): void {
    this._org = org;
  }

  public getOrg(): string {
    return this._org!;
  }

  public setProfile(profile: UserProfile|null): void {
    this._profile = profile;
    // Unset userId, so that we look it up again on demand. (Not that userId could change in
    // practice via a change to profile, but let's not make any assumptions here.)
    this._userId = null;
    this._firstLoginAt = null;
    this._isAnonymous = !profile;
  }

  public getProfile(): UserProfile|null {
    if (this._isAnonymous) {
      return {
        name: 'Anonymous',
        email: ANONYMOUS_USER_EMAIL,
        anonymous: true,
      };
    }
    return this._profile;
  }

  public async getSessionProfile(): Promise<UserProfile|null|undefined> {
    return this._session?.getSessionProfile();
  }

  public async getSessionEmail(): Promise<string|null> {
    return (await this.getSessionProfile())?.email || null;
  }

  public getCachedUserId(): number|null {
    return this._userId;
  }

  public isAnonymous(): boolean {
    return this._isAnonymous;
  }

  // Returns the userId for profile.email, or null when profile is not set; with caching.
  public async getUserId(dbManager: HomeDBManager): Promise<number|null> {
    if (!this._userId) {
      if (this._profile) {
        const user = await this._fetchUser(dbManager);
        this._userId = (user && user.id) || null;
        this._isAnonymous = this._userId && dbManager.getAnonymousUserId() === this._userId || false;
        this._firstLoginAt = (user && user.firstLoginAt) || null;
      } else {
        this._userId = dbManager.getAnonymousUserId();
        this._isAnonymous = true;
        this._firstLoginAt = null;
      }
    }
    return this._userId;
  }

  // Returns the userId for profile.email, or throws 403 error when profile is not set.
  public async requireUserId(dbManager: HomeDBManager): Promise<number> {
    const userId = await this.getUserId(dbManager);
    if (userId) { return userId; }
    throw new ApiError(this._profile ? `user not known: ${this._profile.email}` : 'user not set', 403);
  }

  public getLogMeta() {
    const meta: {[key: string]: any} = {};
    if (this._profile) { meta.email = this._profile.email; }
    // We assume the _userId has already been cached, which will be true always (for all practical
    // purposes) because it's set when the Authorizer checks this client.
    if (this._userId) { meta.userId = this._userId; }
    // Likewise for _firstLoginAt, which we learn along with _userId.
    if (this._firstLoginAt) {
      meta.age = Math.floor(moment.duration(moment().diff(this._firstLoginAt)).asDays());
    }
    if (this._org) { meta.org = this._org; }
    meta.clientId = this.clientId;    // identifies a client connection, essentially a websocket
    meta.counter = this._counter;     // identifies a GristWSConnection in the connected browser tab
    return meta;
  }

  // Fetch the user database record from profile.email, or null when profile is not set.
  private async _fetchUser(dbManager: HomeDBManager): Promise<User|undefined> {
    return this._profile && this._profile.email ?
      await dbManager.getUserByLogin(this._profile.email) :
      undefined;
  }

  // Returns the next unused docFD number.
  private _getNextDocFD(): number {
    let fd = 0;
    while (this._docFDs[fd]) { fd++; }
    return fd;
  }
}
