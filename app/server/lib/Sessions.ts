import {ScopedSession} from 'app/server/lib/BrowserSession';
import {cookieName, SessionStore} from 'app/server/lib/gristSessions';
import * as cookie from 'cookie';
import * as cookieParser from 'cookie-parser';
import {Request} from 'express';
import {IncomingMessage} from 'http';

/**
 *
 * A collection of all the sessions relevant to this instance of Grist.
 *
 * This collection was previously maintained by the Comm object.  This
 * class is added as a stepping stone to disentangling session management
 * from code related to websockets.
 *
 * The collection caches all existing interfaces to sessions.
 * ScopedSessions play an important role in
 * hosted Grist and address per-organization scoping of identity.
 *
 * TODO: now this is separated out, we could refactor to share sessions
 * across organizations.  Currently, when a user moves between organizations,
 * the session interfaces are not shared.  This was for simplicity in working
 * with existing code.
 *
 */
export class Sessions {
  private _sessions = new Map<string, ScopedSession>();

  constructor(private _sessionSecret: string, private _sessionStore: SessionStore) {
  }

  /**
   * Get the session id and organization from the request (or just pass it in if known), and
   * return the identified session.
   */
  public getOrCreateSessionFromRequest(req: Request, options?: {
    sessionId?: string,
    org?: string
  }): ScopedSession {
    const sid = options?.sessionId ?? this.getSessionIdFromRequest(req);
    const org = options?.org ?? (req as any).org;
    if (!sid) { throw new Error("session not found"); }
    return this.getOrCreateSession(sid, org, '');  // TODO: allow for tying to a preferred user.
  }

  /**
   * Get or create a session given the session id and organization name.
   */
  public getOrCreateSession(sid: string, domain: string, userSelector: string): ScopedSession {
    const key = this._getSessionOrgKey(sid, domain, userSelector);
    if (!this._sessions.has(key)) {
      const scopedSession = new ScopedSession(sid, this._sessionStore, domain, userSelector);
      this._sessions.set(key, scopedSession);
    }
    return this._sessions.get(key)!;
  }

  /**
   * Called when a session is modified, and any caching should be invalidated.
   * Currently just removes all caching, if there is any. This caching is a bit
   * of a weird corner of Grist, it is used in development for historic reasons
   * but not in production.
   * TODO: make more fine grained, or rethink.
   */
  public clearCacheIfNeeded(options?: {
    email?: string,
    org?: string|null,
    sessionID?: string,
  }) {
    if (!(process.env.GRIST_HOST || process.env.GRIST_HOSTED)) {
      this._sessions.clear();
    }
  }

  /**
   * Returns the sessionId from the signed grist cookie.
   */
  public getSessionIdFromCookie(gristCookie: string): string|false {
    return cookieParser.signedCookie(gristCookie, this._sessionSecret);
  }

  /**
   * Get the session id from the grist cookie.  Returns null if no cookie found.
   */
  public getSessionIdFromRequest(req: Request|IncomingMessage): string|null {
    if (req.headers.cookie) {
      const cookies = cookie.parse(req.headers.cookie);
      const sessionId = this.getSessionIdFromCookie(cookies[cookieName]);
      if (sessionId) { return sessionId; }
    }
    return (req as any).sessionID || null;  // sessionID set by express-session
  }

  /**
   * Get a per-organization, per-session key.
   * Grist has historically cached sessions in memory by their session id.
   * With the introduction of per-organization identity, that cache is now
   * needs to be keyed by the session id and organization name.
   * Also, clients may now want to be tied to a particular user available within
   * a session, so we add that into key too.
   */
  private _getSessionOrgKey(sid: string, domain: string, userSelector: string): string {
    return `${sid}__${domain}__${userSelector}`;
  }
}
