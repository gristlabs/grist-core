import {DocumentUsage} from 'app/common/DocUsage';
import {Role} from 'app/common/roles';
import {Document} from 'app/gen-server/entity/Document';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {AuthSession} from 'app/server/lib/AuthSession';
import {OptDocSession} from 'app/server/lib/DocSession';
import {ILogMeta} from 'app/server/lib/log';
import {IncomingMessage} from 'http';

export type RequestOrSession = RequestWithLogin | OptDocSession | null;

export function isRequest(
  requestOrSession: RequestOrSession,
): requestOrSession is RequestWithLogin {
  return Boolean(requestOrSession && 'get' in requestOrSession);
}

export function getAuthSession(requestOrSession: RequestOrSession|null): AuthSession {
  if (!requestOrSession) { return AuthSession.unauthenticated(); }
  if (isRequest(requestOrSession)) { return AuthSession.fromReq(requestOrSession); }
  return requestOrSession;
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
  }
 else if (requestOrSession.req) {
    // A REST API call to a document endpoint.
    return requestOrSession.req;
  }
 else if (requestOrSession.client) {
    // A WebSocket session.
    return requestOrSession.client.getConnectionRequest();
  }
 else {
    return null;
  }
}

/**
 * Extract access, userId, email, and client (if applicable) from
 * `requestOrSession`, for logging purposes.
 */
export function getLogMeta(requestOrSession: RequestOrSession | undefined): ILogMeta {
  if (!requestOrSession) { return {}; }
  if (isRequest(requestOrSession)) {
    return getAuthSession(requestOrSession).getLogMeta();
  }
 else {
    return {
      ...requestOrSession.getLogMeta(),
      access: getDocSessionAccessOrNull(requestOrSession),
    };
  }
}

/**
 * Extract user's role from OptDocSession.  Method depends on whether using web
 * sockets or rest api.  Assumes that access has already been checked by wrappers
 * for api methods and that cached access information is therefore available.
 *
 * TODO: it could be nicer to move this to be a method of OptDocSession now that OptDocSession is
 * a class. It would also allow us to put 'access' property into OptDocSession.getLogMeta(), and
 * that, in turn, would let us remove a special case from getLogMeta() above.
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

function _getCachedDoc(docSession: OptDocSession): Document|null {
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
  }
 catch (err) {
    return null;
  }
}

/**
 * Get cached information about the document, if available.  May be stale.
 */
export function getDocSessionCachedDoc(docSession: OptDocSession): Document | undefined {
  return (docSession.req as RequestWithLogin)?.docAuth?.cachedDoc;
}
