import {DocumentUsage} from 'app/common/DocUsage';
import {FullUser} from 'app/common/LoginSessionAPI';
import {Role} from 'app/common/roles';
import {Document} from 'app/gen-server/entity/Document';
import {getUserId as getRequestUserId, getUser, RequestWithLogin} from 'app/server/lib/Authorizer';
import {OptDocSession} from 'app/server/lib/DocSession';
import {ILogMeta} from 'app/server/lib/log';
import {IncomingMessage} from 'http';

export type RequestOrSession = RequestWithLogin | OptDocSession | null;

export function isRequest(
  requestOrSession: RequestOrSession
): requestOrSession is RequestWithLogin {
  return Boolean(requestOrSession && 'get' in requestOrSession);
}

/**
 * Extract the raw `IncomingMessage` from `requestOrSession`, if available.
 */
export function getRequest(requestOrSession: RequestOrSession): IncomingMessage | null {
  if (!requestOrSession) { return null; }

  // The location of the request depends on the context, which include REST
  // API calls to document endpoints and WebSocket sessions.
  if (isRequest(requestOrSession)) {
    return requestOrSession;
  } else if (requestOrSession.req) {
    // A REST API call to a document endpoint.
    return requestOrSession.req;
  } else if (requestOrSession.client) {
    // A WebSocket session.
    return requestOrSession.client.getConnectionRequest();
  } else {
    return null;
  }
}

export function getAltSessionId(requestOrSession: RequestOrSession): string | null {
  if (!requestOrSession) { return null; }

  if (isRequest(requestOrSession)) {
    return requestOrSession.altSessionId || null;
  } else {
    return getDocSessionAltSessionId(requestOrSession);
  }
}

function getDocSessionAltSessionId(docSession: OptDocSession): string|null {
  if (docSession.req) {
    return docSession.req.altSessionId || null;
  }
  if (docSession.client) {
    return docSession.client.getAltSessionId() || null;
  }
  return null;
}

export function getUserId(requestOrSession: RequestOrSession): number|null {
  if (!requestOrSession) { return null; }

  if (isRequest(requestOrSession)) {
    return getRequestUserId(requestOrSession);
  } else {
    return getDocSessionUserId(requestOrSession);
  }
}

/**
 * Extract userId from OptDocSession.  Use Authorizer if available (for web socket
 * sessions), or get it from the Request if that is available (for rest api calls),
 * or from the Client if that is available.  Returns null if userId information is
 * not available or not cached.
 */
function getDocSessionUserId(docSession: OptDocSession): number|null {
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

/**
 * Get as much of user profile as we can (id, name, email).
 */
export function getFullUser(requestOrSession: RequestOrSession): FullUser | null {
  if (!requestOrSession) { return null; }

  if (isRequest(requestOrSession)) {
    return getRequestFullUser(requestOrSession);
  } else {
    return getDocSessionFullUser(requestOrSession);
  }
}

function getRequestFullUser(request: RequestWithLogin): FullUser|null {
  const user = getUser(request);
  if (!user.loginEmail) { return null; }

  const {id, name, loginEmail: email, ref, options} = user;
  return {
    id,
    name,
    email,
    ref,
    locale: options?.locale,
  };
}

function getDocSessionFullUser(docSession: OptDocSession): FullUser|null {
  if (docSession.authorizer) {
    return docSession.authorizer.getUser();
  }
  if (docSession.req) {
    return getRequestFullUser(docSession.req);
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

export function getOrg(requestOrSession: RequestOrSession): string | null {
  if (!requestOrSession) { return null; }

  if (isRequest(requestOrSession)) {
    return requestOrSession.org || null;
  } else {
    return getDocSessionOrg(requestOrSession);
  }
}

function getDocSessionOrg(docSession: OptDocSession): string | null {
  if (docSession.req) {
    return docSession.req.org || null;
  }
  if (docSession.client) {
    return docSession.client.getOrg() || null;
  }
  return null;
}

/**
 * Extract access, userId, email, and client (if applicable) from
 * `requestOrSession`, for logging purposes.
 */
export function getLogMeta(requestOrSession: RequestOrSession | undefined): ILogMeta {
  if (!requestOrSession) { return {}; }

  if (isRequest(requestOrSession)) {
    return getRequestLogMeta(requestOrSession);
  } else {
    return getDocSessionLogMeta(requestOrSession);
  }
}

function getRequestLogMeta(request: RequestWithLogin): ILogMeta {
  const {org, user, userId, altSessionId} = request;
  return {
    org,
    email: user?.loginEmail,
    userId,
    altSessionId,
  };
}

function getDocSessionLogMeta(docSession: OptDocSession): ILogMeta {
  const client = docSession.client;
  const access = getDocSessionAccessOrNull(docSession);
  const user = getDocSessionFullUser(docSession);
  const email = user?.loginEmail || user?.email;
  return {
    access,
    ...(user ? {userId: user.id, email} : {}),
    ...(client ? client.getLogMeta() : {}),   // Client if present will repeat and add to user info.
  };
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
export function getDocSessionCachedDoc(docSession: OptDocSession): Document | undefined {
  return (docSession.req as RequestWithLogin)?.docAuth?.cachedDoc;
}
