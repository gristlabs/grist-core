import {ScopedSession} from 'app/server/lib/BrowserSession';
import * as Comm from 'app/server/lib/Comm';
import {GristServer} from 'app/server/lib/GristServer';
import {cookieName, SessionStore} from 'app/server/lib/gristSessions';
import {IInstanceManager} from 'app/server/lib/IInstanceManager';
import {ILoginSession} from 'app/server/lib/ILoginSession';
import * as cookie from 'cookie';
import * as cookieParser from 'cookie-parser';
import {Request} from 'express';

interface Session {
  scopedSession: ScopedSession;
  loginSession?: ILoginSession;
}

/**
 *
 * A collection of all the sessions relevant to this instance of Grist.
 *
 * This collection was previously maintained by the Comm object.  This
 * class is added as a stepping stone to disentangling session management
 * from code related to websockets.
 *
 * The collection caches all existing interfaces to sessions.
 * LoginSessions play an important role in standalone Grist and address
 * end-to-end sharing concerns.  ScopedSessions play an important role in
 * hosted Grist and address per-organization scoping of identity.
 *
 * TODO: now this is separated out, we could refactor to share sessions
 * across organizations.  Currently, when a user moves between organizations,
 * the session interfaces are not shared.  This was for simplicity in working
 * with existing code.
 *
 */
export class Sessions {
  private _sessions = new Map<string, Session>();

  constructor(private _sessionSecret: string, private _sessionStore: SessionStore, private _server: GristServer) {
  }

  /**
   * Get the session id and organization from the request, and return the
   * identified session.
   */
  public getOrCreateSessionFromRequest(req: Request): Session {
    const sid = this.getSessionIdFromRequest(req);
    const org = (req as any).org;
    if (!sid) { throw new Error("session not found"); }
    return this.getOrCreateSession(sid, org, '');  // TODO: allow for tying to a preferred user.
  }

  /**
   * Get or create a session given the session id and organization name.
   */
  public getOrCreateSession(sid: string, domain: string, userSelector: string): Session {
    const key = this._getSessionOrgKey(sid, domain, userSelector);
    if (!this._sessions.has(key)) {
      const scopedSession = new ScopedSession(sid, this._sessionStore, domain, userSelector);
      this._sessions.set(key, {scopedSession});
    }
    return this._sessions.get(key)!;
  }

  /**
   * Access a LoginSession interface, creating it if necessary.  For creation,
   * purposes, Comm, and optionally InstanceManager objects are needed.
   *
   */
  public getOrCreateLoginSession(sid: string, domain: string, comm: Comm,
                                 instanceManager: IInstanceManager|null,
                                 userSelector: string): ILoginSession {
    const sess = this.getOrCreateSession(sid, domain, userSelector);
    if (!sess.loginSession) {
      sess.loginSession = this._server.create.LoginSession(comm, sid, domain, sess.scopedSession,
                                                           instanceManager);
    }
    return sess.loginSession;
  }

  /**
   * Returns the sessionId from the signed grist cookie.
   */
  public getSessionIdFromCookie(gristCookie: string) {
    return cookieParser.signedCookie(gristCookie, this._sessionSecret);
  }

  /**
   * Get the session id from the grist cookie.  Returns null if no cookie found.
   */
  public getSessionIdFromRequest(req: Request): string|null {
    if (req.headers.cookie) {
      const cookies = cookie.parse(req.headers.cookie);
      const sessionId = this.getSessionIdFromCookie(cookies[cookieName]);
      return sessionId;
    }
    return null;
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
