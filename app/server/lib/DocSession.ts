import {BrowserSettings} from 'app/common/BrowserSettings';
import {DocumentUsage} from 'app/common/DocUsage';
import {Role} from 'app/common/roles';
import {FullUser} from 'app/common/UserAPI';
import {Document} from 'app/gen-server/entity/Document';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer, getUser, getUserId, RequestWithLogin} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';

/**
 * OptDocSession allows for certain ActiveDoc operations to work with or without an open document.
 * It is useful in particular for actions when importing a file to create a new document.
 */
export interface OptDocSession {
  client: Client|null;
  shouldBundleActions?: boolean;
  linkId?: number;
  browserSettings?: BrowserSettings;
  req?: RequestWithLogin;
  // special permissions for creating, plugins, system, and share access
  mode?: 'nascent'|'plugin'|'system'|'share';
  authorizer?: Authorizer;
  forkingAsOwner?: boolean;  // Set if it is appropriate in a pre-fork state to become an owner.
}

export function makeOptDocSession(client: Client|null, browserSettings?: BrowserSettings): OptDocSession {
  if (client && !browserSettings) { browserSettings = client.browserSettings; }
  if (client && browserSettings && !browserSettings.locale) { browserSettings.locale = client.locale; }
  return {client, browserSettings};
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
  const docSession = makeOptDocSession(options.client || null, options.browserSettings);
  docSession.mode = mode;
  docSession.req = options.req;
  return docSession;
}

/**
 * Create an OptDocSession from a request.  Request should have user and doc access
 * middleware.
 */
export function docSessionFromRequest(req: RequestWithLogin): OptDocSession {
  return {client: null, req};
}

/**
 * DocSession objects maintain information for a single session<->doc instance.
 */
export class DocSession implements OptDocSession {
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

  public forkingAsOwner?: boolean;

  constructor(
    public readonly activeDoc: ActiveDoc,
    public readonly client: Client,
    public readonly fd: number,
    public readonly authorizer: Authorizer
  ) {}

  // Browser settings (like timezone) obtained from the Client.
  public get browserSettings(): BrowserSettings { return this.client.browserSettings; }
}

/**
 * Extract userId from OptDocSession.  Use Authorizer if available (for web socket
 * sessions), or get it from the Request if that is available (for rest api calls),
 * or from the Client if that is available.  Returns null if userId information is
 * not available or not cached.
 */
export function getDocSessionUserId(docSession: OptDocSession): number|null {
  if (docSession.authorizer) {
    return docSession.authorizer.getUserId();
  }
  if (docSession.req) {
    return getUserId(docSession.req);
  }
  if (docSession.client) {
    return docSession.client.getCachedUserId();
  }
  return null;
}

export function getDocSessionAltSessionId(docSession: OptDocSession): string|null {
  if (docSession.req) {
    return docSession.req.altSessionId || null;
  }
  if (docSession.client) {
    return docSession.client.getAltSessionId() || null;
  }
  return null;
}

/**
 * Get as much of user profile as we can (id, name, email).
 */
export function getDocSessionUser(docSession: OptDocSession): FullUser|null {
  if (docSession.authorizer) {
    return docSession.authorizer.getUser();
  }
  if (docSession.req) {
    const user = getUser(docSession.req);
    const email = user.loginEmail;
    if (email) {
      return {id: user.id, name: user.name, email, ref: user.ref, locale: user.options?.locale};
    }
  }
  if (docSession.client) {
    const id = docSession.client.getCachedUserId();
    const ref = docSession.client.getCachedUserRef();
    const profile = docSession.client.getProfile();
    if (id && profile) {
      return {
        id,
        ref,
        ...profile
      };
    }
  }
  return null;
}

/**
 * Extract user's role from OptDocSession.  Method depends on whether using web
 * sockets or rest api.  Assumes that access has already been checked by wrappers
 * for api methods and that cached access information is therefore available.
 */
export function getDocSessionAccess(docSession: OptDocSession): Role {
  // "nascent" DocSessions are for when a document is being created, and user is
  // its only owner as yet.
  // "system" DocSessions are for access without access control.
  if (docSession.mode === 'nascent' || docSession.mode === 'system') { return 'owners'; }
  // "plugin" DocSessions are for access from plugins, which is currently quite crude,
  // and granted only to editors.
  if (docSession.mode === 'plugin') { return 'editors'; }
  if (docSession.authorizer) {
    const access = docSession.authorizer.getCachedAuth().access;
    if (!access) { throw new Error('getDocSessionAccess expected authorizer.getCachedAuth'); }
    return access;
  }
  if (docSession.req) {
    const access =  docSession.req.docAuth?.access;
    if (!access) { throw new Error('getDocSessionAccess expected req.docAuth.access'); }
    return access;
  }
  throw new Error('getDocSessionAccess could not find access information in DocSession');
}

export function getDocSessionShare(docSession: OptDocSession): string|null {
  return _getCachedDoc(docSession)?.linkId || null;
}

/**
 * Get document usage seen in db when we were last checking document
 * access. Not necessarily a live value when using a websocket
 * (although we do recheck access periodically).
 */
export function getDocSessionUsage(docSession: OptDocSession): DocumentUsage|null {
  return _getCachedDoc(docSession)?.usage || null;
}

export function _getCachedDoc(docSession: OptDocSession): Document|null {
  if (docSession.authorizer) {
    return docSession.authorizer.getCachedAuth().cachedDoc || null;
  }
  if (docSession.req) {
    return docSession.req.docAuth?.cachedDoc || null;
  }
  return null;
}

export function getDocSessionAccessOrNull(docSession: OptDocSession): Role|null {
  try {
    return getDocSessionAccess(docSession);
  } catch (err) {
    return null;
  }
}

/**
 * Get cached information about the document, if available.  May be stale.
 */
export function getDocSessionCachedDoc(docSession: OptDocSession): Document|undefined {
  return (docSession.req as RequestWithLogin)?.docAuth?.cachedDoc;
}
