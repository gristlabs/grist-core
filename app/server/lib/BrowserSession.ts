import {normalizeEmail} from 'app/common/emails';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {SessionStore} from 'app/server/lib/gristSessions';
import * as log from 'app/server/lib/log';

// Part of a session related to a single user.
export interface SessionUserObj {
  // a grist-internal identify for the user, if known.
  userId?: number;

  // The user profile object.
  profile?: UserProfile;

  // [UNUSED] Authentication provider string indicating the login method used.
  authProvider?: string;

  // [UNUSED] Login ID token used to access AWS services.
  idToken?: string;

  // [UNUSED] Login access token used to access other AWS services.
  accessToken?: string;

  // [UNUSED] Login refresh token used to retrieve new ID and access tokens.
  refreshToken?: string;

  // State for SAML-mediated logins.
  samlNameId?: string;
  samlSessionIndex?: string;
}

// Session state maintained for a particular browser. It is identified by a cookie. There may be
// several browser windows/tabs that share this cookie and this state.
export interface SessionObj {
  // Session cookie.
  // This is marked optional to reflect the reality of pre-existing code.
  cookie?: any;

  // A list of users we have logged in as.
  // This is optional since the session may already exist.
  users?: SessionUserObj[];

  // map from org to an index into users[]
  // This is optional since the session may already exist.
  orgToUser?: {[org: string]: number};

  // This gets set to encourage express-session to set a cookie.
  alive?: boolean;
}

/**
 * Extract the available user profiles from the session.
 *
 */
export function getSessionProfiles(session: SessionObj): UserProfile[] {
  if (!session.users) { return []; }
  return session.users.filter(user => user && user.profile).map(user => user.profile!);
}

/**
 *
 * Gets user profile from the session for a given org, returning null if no profile is
 * found specific to that org.
 *
 */
export function getSessionUser(session: SessionObj, org: string,
                               userSelector: string): SessionUserObj|null {
  if (!session.users) { return null; }
  if (!session.users.length) { return null; }

  if (userSelector) {
    for (const user of session.users) {
      if (user.profile?.email.toLowerCase() === userSelector.toLowerCase()) { return user; }
    }
  }

  if (session.orgToUser && session.orgToUser[org] !== undefined &&
      session.users.length > session.orgToUser[org]) {
    return session.users[session.orgToUser[org]] || null;
  }
  return null;
}

/**
 *
 * Record which user to use by default for a given org in future.
 * This method mutates the session object passed to it.  It does not save it,
 * that is up to the caller.
 *
 */
export function linkOrgWithEmail(session: SessionObj, email: string, org: string): SessionUserObj {
  if (!session.users || !session.orgToUser) { throw new Error("Session not set up"); }
  email = normalizeEmail(email);
  for (let i = 0; i < session.users.length; i++) {
    const iUser = session.users[i];
    if (iUser && iUser.profile && normalizeEmail(iUser.profile.email) === email) {
      session.orgToUser[org] = i;
      return iUser;
    }
  }
  throw new Error("Failed to link org with email");
}

/**
 *
 * This is a view of the session object, for a single organization (the "scope").
 *
 * Local caching is disabled in an enviroment where there is a home server (or we are
 * the home server).  In hosted Grist, per-instance caching would be a problem.
 *
 * We retain local caching for situations with a single server - especially electron.
 *
 */
export class ScopedSession {
  private _sessionCache?: SessionObj;
  private _live: boolean;  // if set, never cache session in memory.

  /**
   * Create an interface to the session identified by _sessionId, in the store identified
   * by _sessionStore, for the organization identified by _scope.
   */
  constructor(private _sessionId: string,
              private _sessionStore: SessionStore,
              private _org: string,
              private _userSelector: string) {
    // Assume we need to skip cache in a hosted environment. GRIST_HOST is always set there.
    // TODO: find a cleaner way to configure this flag.
    this._live = Boolean(process.env.GRIST_HOST || process.env.GRIST_HOSTED);
  }

  /**
   * Get the user entry from the current session.
   * @param prev: if supplied, this session object is used rather than querying the session again.
   * @return the user entry
   */
  public async getScopedSession(prev?: SessionObj): Promise<SessionUserObj> {
    const session = prev || await this._getSession();
    return getSessionUser(session, this._org, this._userSelector) || {};
  }

  // Retrieves the user profile from the session.
  public async getSessionProfile(prev?: SessionObj): Promise<UserProfile|null> {
    return (await this.getScopedSession(prev)).profile || null;
  }

  // Updates a user profile. The session may have multiple profiles associated with different
  // email addresses. This will update the one with a matching email address, or add a new one.
  // This is mainly used to know which emails are logged in in this session; fields like name and
  // picture URL come from the database instead.
  public async updateUserProfile(profile: UserProfile|null): Promise<void> {
    if (profile) {
      await this.operateOnScopedSession(async user => {
        user.profile = profile;
        return user;
      });
    } else {
      await this.clearScopedSession();
    }
  }

  /**
   *
   * This performs an operation on the session object, limited to a single user entry.  The state of that
   * user entry before and after the operation are returned.  LoginSession relies heavily on this method,
   * to determine whether the change made by an operation merits certain follow-up work.
   *
   * @param op: Operation to perform.  Given a single user entry, and should return a single user entry.
   * It is fine to modify the supplied user entry in place.
   *
   * @return a pair [prev, current] with the state of the single user entry before and after the operation.
   *
   */
  public async operateOnScopedSession(op: (user: SessionUserObj) =>
                                      Promise<SessionUserObj>): Promise<[SessionUserObj, SessionUserObj]> {
    const session = await this._getSession();
    const user = await this.getScopedSession(session);
    const oldUser = JSON.parse(JSON.stringify(user));            // Old version to compare against.
    const newUser = await op(JSON.parse(JSON.stringify(user)));  // Modify a scratch version.
    if (Object.keys(newUser).length === 0) {
      await this.clearScopedSession(session);
    } else {
      await this._updateScopedSession(newUser, session);
    }
    return [oldUser, newUser];
  }

  /**
   * This clears the current user entry from the session.
   * @param prev: if supplied, this session object is used rather than querying the session again.
   */
  public async clearScopedSession(prev?: SessionObj): Promise<void> {
    const session = prev || await this._getSession();
    this._clearUser(session);
    await this._setSession(session);
  }

  /**
   * Read the state of the session.
   */
  private async _getSession(): Promise<SessionObj> {
    if (this._sessionCache) { return this._sessionCache; }
    const session = ((await this._sessionStore.getAsync(this._sessionId)) || {}) as SessionObj;
    if (!this._live) { this._sessionCache = session; }
    return session;
  }

  /**
   * Set the session to the supplied object.
   */
  private async _setSession(session: SessionObj): Promise<void> {
    try {
      await this._sessionStore.setAsync(this._sessionId, session);
      if (!this._live) { this._sessionCache = session; }
    } catch (e) {
      // (I've copied this from old code, not sure if continuing after a session save error is
      // something existing code depends on?)
      // Report and keep going. This ensures that the session matches what's in the sessionStore.
      log.error(`ScopedSession[${this._sessionId}]: Error updating sessionStore: ${e}`);
    }
  }

  /**
   * Update the session with the supplied user entry, replacing anything for that user already there.
   * @param user: user entry to insert in session
   * @param prev: if supplied, this session object is used rather than querying the session again.
   *
   */
  private async _updateScopedSession(user: SessionUserObj, prev?: SessionObj): Promise<void> {
    const profile = user.profile;
    if (!profile) {
      throw new Error("No profile available");
    }
    // We used to also check profile.email_verified, but we no longer create UserProfile objects
    // unless the email is verified, so this check is no longer needed.
    if (!profile.email) {
      throw new Error("Profile has no email address");
    }

    const session = prev || await this._getSession();
    if (!session.users) { session.users = []; }
    if (!session.orgToUser) { session.orgToUser = {}; }
    let index = session.users.findIndex(u => Boolean(u.profile && u.profile.email === profile.email));
    if (index < 0) { index = session.users.length; }
    session.orgToUser[this._org] = index;
    session.users[index] = user;
    await this._setSession(session);
  }

  /**
   * This clears all user logins (not just the current login).
   * In future, we may want to be able to log in and out selectively, slack style,
   * but right now it seems confusing.
   */
  private _clearUser(session: SessionObj): void {
    session.users = [];
    session.orgToUser = {};
  }
}
