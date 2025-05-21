import {BrowserSettings} from 'app/common/BrowserSettings';
import {decodeLinkParameters} from 'app/common/gristUrls';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {AuthSession} from 'app/server/lib/AuthSession';
import {Client} from 'app/server/lib/Client';
import type {DocAuthorizer} from 'app/server/lib/DocAuthorizer';

/**
 * OptDocSession allows for certain ActiveDoc operations to work with or without an open document.
 * It is useful in particular for actions when importing a file to create a new document.
 */
export class OptDocSession extends AuthSession {
  public readonly client: Client|null;
  public readonly req?: RequestWithLogin;
  public readonly browserSettings?: BrowserSettings;

  /**
   * Flag to indicate that user actions 'bundle' process is started and in progress (`true`),
   * otherwise it's `false`
   */
  public shouldBundleActions?: boolean;

  /**
   * Indicates the actionNum of the previously applied action
   * to which the first action in actions should be linked.
   * Linked actions appear as one action and can be undone/redone in a single step.
   */
  public linkId?: number;

  // special permissions for creating, plugins, system, and share access
  public mode?: 'nascent'|'plugin'|'system'|'share';
  public authorizer?: DocAuthorizer;
  public forkingAsOwner?: boolean;  // Set if it is appropriate in a pre-fork state to become an owner.
  public linkParameters?: Record<string, string>;

  private get _authSession(): AuthSession {
    return this.client?.authSession ?? (this.req ? AuthSession.fromReq(this.req) : AuthSession.unauthenticated());
  }

  constructor(options: {
    client?: Client|null,
    browserSettings?: BrowserSettings,
    req?: RequestWithLogin,
    linkParameters?: Record<string, string>,
  }) {
    super();
    this.client = options.client ?? null;
    this.browserSettings = options.browserSettings ?? (this.client?.browserSettings);
    this.req = options.req;
    this.linkParameters = options.linkParameters ??
      (this.req?.url ? decodeLinkParameters(new URLSearchParams(this.req.url.split('?')[1])) : undefined);
  }

  // Expose AuthSession interface directly. Note that other AuthSession helper methods are also
  // available, e.g. .normalizedEmail or .getLogMeta().
  public get org() { return this._authSession.org; }
  public get altSessionId() { return this._authSession.altSessionId; }
  public get userId() { return this._authSession.userId; }
  public get userIsAuthorized() { return this._authSession.userIsAuthorized; }
  public get fullUser() { return this._authSession.fullUser; }

  // Like AuthSession.getLogMeta(), but includes a bit more info when we have a Client.
  public getLogMeta() { return this.client?.getLogMeta() || super.getLogMeta(); }
}

export function makeOptDocSession(client: Client|null): OptDocSession {
  return new OptDocSession({client});
}

/**
 * Create an OptDocSession with special access rights.
 *  - nascent: user is treated as owner (because doc is being created)
 *  - plugin: user is treated as editor (because plugin access control is crude)
 *  - system: user is treated as owner (because of some operation bypassing access control)
 */
export function makeExceptionalDocSession(mode: 'nascent'|'plugin'|'system'|'share',
                                          options: {client?: Client,
                                                    req?: RequestWithLogin,
                                                    browserSettings?: BrowserSettings} = {}): OptDocSession {
  const docSession = new OptDocSession(options);
  docSession.mode = mode;
  return docSession;
}

/**
 * Create an OptDocSession from a request.  Request should have user and doc access
 * middleware.
 */
export function docSessionFromRequest(req: RequestWithLogin): OptDocSession {
  return new OptDocSession({req});
}

/**
 * DocSessionPrecursor is used in DocManager while opening a document. It's close to a full
 * DocSession, and is used to create a full DocSession once we have an activeDoc and fd.
 */
export class DocSessionPrecursor extends OptDocSession {
  public readonly client: Client;
  public readonly authorizer: DocAuthorizer;

  constructor(client: Client, authorizer: DocAuthorizer, options: {
    linkParameters?: Record<string, string>,
  }) {
    super({...options, client});
    this.client = client;
    this.authorizer = authorizer;
  }
}

/**
 * DocSession objects maintain information for a single session<->doc instance.
 * Unlike OptDocSession, it has a definite activeDoc, client, authorizer, and fd.
 */
export class DocSession extends DocSessionPrecursor {
  public readonly activeDoc: ActiveDoc;
  public readonly fd: number;

  constructor(ds: DocSessionPrecursor, activeDoc: ActiveDoc, fd: number) {
    super(ds.client, ds.authorizer, {linkParameters: ds.linkParameters});
    this.activeDoc = activeDoc;
    this.fd = fd;
  }
}
