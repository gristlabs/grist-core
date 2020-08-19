import {ApiError} from 'app/common/ApiError';
import {OpenDocMode} from 'app/common/DocListAPI';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {canEdit, canView, getWeakestRole, Role} from 'app/common/roles';
import {Document} from 'app/gen-server/entity/Document';
import {User} from 'app/gen-server/entity/User';
import {DocAuthKey, DocAuthResult, HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {getSessionProfiles, getSessionUser, linkOrgWithEmail, SessionObj,
        SessionUserObj} from 'app/server/lib/BrowserSession';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {COOKIE_MAX_AGE, getAllowedOrgForSessionID} from 'app/server/lib/gristSessions';
import * as log from 'app/server/lib/log';
import {IPermitStore, Permit} from 'app/server/lib/Permit';
import {allowHost} from 'app/server/lib/requestUtils';
import {NextFunction, Request, RequestHandler, Response} from 'express';

export interface RequestWithLogin extends Request {
  sessionID: string;
  session: SessionObj;
  org?: string;
  isCustomHost?: boolean;  // when set, the request's domain is a recognized custom host linked
                           // with the specified org.
  users?: UserProfile[];
  userId?: number;
  user?: User;
  userIsAuthorized?: boolean;   // If userId is for "anonymous", this will be false.
  docAuth?: DocAuthResult;      // For doc requests, the docId and the user's access level.
  specialPermit?: Permit;
}

/**
 * Extract the user id from a request, assuming we've added it via appropriate middleware.
 * Throws ApiError with code 401 (unauthorized) if the user id is missing.
 */
export function getUserId(req: Request): number {
  const userId = (req as RequestWithLogin).userId;
  if (!userId) {
    throw new ApiError("user not known", 401);
  }
  return userId;
}

/**
 * Extract the user object from a request, assuming we've added it via appropriate middleware.
 * Throws ApiError with code 401 (unauthorized) if the user is missing.
 */
export function getUser(req: Request): User {
  const user = (req as RequestWithLogin).user;
  if (!user) {
    throw new ApiError("user not known", 401);
  }
  return user;
}

/**
 * Extract the user profiles from a request, assuming we've added them via appropriate middleware.
 * Throws ApiError with code 401 (unauthorized) if the profiles are missing.
 */
export function getUserProfiles(req: Request): UserProfile[] {
  const users = (req as RequestWithLogin).users;
  if (!users) {
    throw new ApiError("user profile not found", 401);
  }
  return users;
}

// Extract the user id from a request, requiring it to be authorized (not an anonymous session).
export function getAuthorizedUserId(req: Request) {
  const userId = getUserId(req);
  if (isAnonymousUser(req)) {
    throw new ApiError("user not authorized", 401);
  }
  return userId;
}

export function isAnonymousUser(req: Request) {
  return !(req as RequestWithLogin).userIsAuthorized;
}

// True if Grist is configured for a single user without specific authorization
// (classic standalone/electron mode).
export function isSingleUserMode(): boolean {
  return process.env.GRIST_SINGLE_USER === '1';
}

/**
 * Returns the express request object with user information added, if it can be
 * found based on passed in headers or the session.  Specifically, sets:
 *   - req.userId: the id of the user in the database users table
 *   - req.userIsAuthorized: set if user has presented credentials that were accepted
 *     (the anonymous user has a userId but does not have userIsAuthorized set if,
 *     as would typically be the case, credentials were not presented)
 *   - req.users: set for org-and-session-based logins, with list of profiles in session
 */
export async function addRequestUser(dbManager: HomeDBManager, permitStore: IPermitStore,
                                     fallbackEmail: string|null,
                                     req: Request, res: Response, next: NextFunction) {
  const mreq = req as RequestWithLogin;
  let profile: UserProfile|undefined;

  // First, check for an apiKey
  if (mreq.headers && mreq.headers.authorization) {
    // header needs to be of form "Bearer XXXXXXXXX" to apply
    const parts = String(mreq.headers.authorization).split(' ');
    if (parts[0] === "Bearer") {
      const user = parts[1] ? await dbManager.getUserByKey(parts[1]) : undefined;
      if (!user) {
        return res.status(401).send('Bad request: invalid API key');
      }
      if (user.id === dbManager.getAnonymousUserId()) {
        // We forbid the anonymous user to present an api key.  That saves us
        // having to think through the consequences of authorized access to the
        // anonymous user's profile via the api (e.g. how should the api key be managed).
        return res.status(401).send('Credentials cannot be presented for the anonymous user account via API key');
      }
      mreq.user = user;
      mreq.userId = user.id;
      mreq.userIsAuthorized = true;
    }
  }

  // Special permission header for internal housekeeping tasks
  if (mreq.headers && mreq.headers.permit) {
    const permitKey = String(mreq.headers.permit);
    try {
      const permit = await permitStore.getPermit(permitKey);
      if (!permit) { return res.status(401).send('Bad request: unknown permit'); }
      mreq.user = dbManager.getAnonymousUser();
      mreq.userId = mreq.user.id;
      mreq.specialPermit = permit;
    } catch (err) {
      log.error(`problem reading permit: ${err}`);
      return res.status(401).send('Bad request: permit could not be read');
    }
  }

  // A bit of extra info we'll add to the "Auth" log message when this request passes the check
  // for custom-host-specific sessionID.
  let customHostSession = '';

  // If we haven't selected a user by other means, and have profiles available in the
  // session, then select a user based on those profiles.
  const session = mreq.session;
  if (!mreq.userId && session && session.users && session.users.length > 0 &&
     mreq.org !== undefined) {

    // Prevent using custom-domain sessionID to authorize to a different domain, since
    // custom-domain owner could hijack such sessions.
    const allowedOrg = getAllowedOrgForSessionID(mreq.sessionID);
    if (allowedOrg) {
      if (allowHost(req, allowedOrg.host)) {
        customHostSession = ` custom-host-match ${allowedOrg.host}`;
      } else {
        // We need an exception for internal forwarding from home server to doc-workers. These use
        // internal hostnames, so we can't expect a custom domain. These requests do include an
        // Organization header, which we'll use to grant the exception, but security issues remain.
        // TODO Issue 1: an attacker can use a custom-domain request to get an API key, which is an
        // open door to all orgs accessible by this user.
        // TODO Issue 2: Organization header is easy for an attacker (who has stolen a session
        // cookie) to include too; it does nothing to prove that the request is internal.
        const org = req.header('organization');
        if (org && org === allowedOrg.org) {
          customHostSession = ` custom-host-fwd ${org}`;
        } else {
          // Log error and fail.
          log.warn("Auth[%s]: sessionID for host %s org %s; wrong for host %s org %s", mreq.method,
              allowedOrg.host, allowedOrg.org, mreq.get('host'), mreq.org);
          return res.status(403).send('Bad request: invalid session ID');
        }
      }
    }

    mreq.users = getSessionProfiles(session);

    // If we haven't set a maxAge yet, set it now.
    if (session && session.cookie && !session.cookie.maxAge) {
      session.cookie.maxAge = COOKIE_MAX_AGE;
    }

    // See if we have a profile linked with the active organization already.
    let sessionUser: SessionUserObj|null = getSessionUser(session, mreq.org);

    if (!sessionUser) {
      // No profile linked yet, so let's elect one.
      // Choose a profile that is no worse than the others available.
      const option = await dbManager.getBestUserForOrg(mreq.users, mreq.org);
      if (option) {
        // Modify request session object to link the current org with our choice of
        // profile.  Express-session will save this change.
        sessionUser = linkOrgWithEmail(session, option.email, mreq.org);
        // In this special case of initially linking a profile, we need to look up the user's info.
        mreq.user = await dbManager.getUserByLogin(option.email);
        mreq.userId = option.id;
        mreq.userIsAuthorized = true;
      } else {
        // No profile has access to this org.  We could choose to
        // link no profile, in which case user will end up
        // immediately presented with a sign-in page, or choose to
        // link an arbitrary profile (say, the first one the user
        // logged in as), in which case user will end up with a
        // friendlier page explaining the situation and offering to
        // add an account to resolve it.  We go ahead and pick an
        // arbitrary profile.
        sessionUser = session.users[0];
        if (!session.orgToUser) { throw new Error("Session misconfigured"); }
        // Express-session will save this change.
        session.orgToUser[mreq.org] = 0;
      }
    }

    profile = sessionUser && sessionUser.profile || undefined;

    // If we haven't computed a userId yet, check for one using an email address in the profile.
    // A user record will be created automatically for emails we've never seen before.
    if (profile && !mreq.userId) {
      const user = await dbManager.getUserByLoginWithRetry(profile.email, profile);
      if (user) {
        mreq.user = user;
        mreq.userId = user.id;
        mreq.userIsAuthorized = true;
      }
    }
  }

  if (!mreq.userId && fallbackEmail) {
    const user = await dbManager.getUserByLogin(fallbackEmail);
    if (user) {
      mreq.user = user;
      mreq.userId = user.id;
      mreq.userIsAuthorized = true;
      const fullUser = dbManager.makeFullUser(user);
      mreq.users = [fullUser];
      profile = fullUser;
    }
  }

  // If no userId has been found yet, fall back on anonymous.
  if (!mreq.userId) {
    const anon = dbManager.getAnonymousUser();
    mreq.user = anon;
    mreq.userId = anon.id;
    mreq.userIsAuthorized = false;
    mreq.users = [dbManager.makeFullUser(anon)];
  }

  log.debug("Auth[%s]: id %s email %s host %s path %s org %s%s", mreq.method,
            mreq.userId, profile && profile.email, mreq.get('host'), mreq.path, mreq.org,
            customHostSession);

  return next();
}

/**
 * Returns a handler that redirects the user to a login or signup page.
 */
export function redirectToLoginUnconditionally(
  getLoginRedirectUrl: (redirectUrl: URL) => Promise<string>,
  getSignUpRedirectUrl: (redirectUrl: URL) => Promise<string>
) {
  return async (req: Request, resp: Response, next: NextFunction) => {
    const mreq = req as RequestWithLogin;
    // Redirect to sign up if it doesn't look like the user has ever logged in (on
    // this browser)  After logging in, `users` will be set in the session.  Even after
    // logging out again, `users` will still be set.
    const signUp: boolean = (mreq.session.users === undefined);
    log.debug(`Authorizer: redirecting to ${signUp ? 'sign up' : 'log in'}`);
    const redirectUrl = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
    if (signUp) {
      return resp.redirect(await getSignUpRedirectUrl(redirectUrl));
    } else {
      return resp.redirect(await getLoginRedirectUrl(redirectUrl));
    }
  };
}

/**
 * Middleware to redirects user to a login page when the user is not
 * logged in.  If allowExceptions is set, then we make an exception
 * for a team site allowing anonymous access, or a personal doc
 * allowing anonymous access, or the merged org.
 */
export function redirectToLogin(
  allowExceptions: boolean,
  getLoginRedirectUrl: (redirectUrl: URL) => Promise<string>,
  getSignUpRedirectUrl: (redirectUrl: URL) => Promise<string>,
  dbManager: HomeDBManager
): RequestHandler {
  const redirectUnconditionally = redirectToLoginUnconditionally(getLoginRedirectUrl,
                                                                 getSignUpRedirectUrl);
  return async (req: Request, resp: Response, next: NextFunction) => {
    const mreq = req as RequestWithLogin;
    mreq.session.alive = true;  // This will ensure that express-session will set our cookie
                                // if it hasn't already - we'll need it if we redirect.
    if (mreq.userIsAuthorized) { return next(); }

    try {
      // Otherwise it's an anonymous user. Proceed normally only if the org allows anon access.
      if (mreq.userId && mreq.org && allowExceptions) {
        // Anonymous user has qualified access to merged org.
        if (dbManager.isMergedOrg(mreq.org)) { return next(); }
        const result = await dbManager.getOrg({userId: mreq.userId}, mreq.org || null);
        if (result.status === 200) { return next(); }
      }

      // In all other cases (including unknown org), redirect user to login or sign up.
      return redirectUnconditionally(req, resp, next);
    } catch (err) {
      log.info("Authorizer failed to redirect", err.message);
      return resp.status(401).send(err.message);
    }
  };
}

/**
 * Sets mreq.docAuth if not yet set, and returns it.
 */
export async function getOrSetDocAuth(
  mreq: RequestWithLogin, dbManager: HomeDBManager, urlId: string
): Promise<DocAuthResult> {
  if (!mreq.docAuth) {
    let effectiveUserId = getUserId(mreq);
    if (mreq.specialPermit && mreq.userId === dbManager.getAnonymousUserId()) {
      effectiveUserId = dbManager.getPreviewerUserId();
    }
    mreq.docAuth = await dbManager.getDocAuthCached({urlId, userId: effectiveUserId, org: mreq.org});
    if (mreq.specialPermit && mreq.userId === dbManager.getAnonymousUserId() &&
        mreq.specialPermit.docId === mreq.docAuth.docId) {
      mreq.docAuth = {...mreq.docAuth, access: 'owners'};
    }
  }
  return mreq.docAuth;
}


export interface ResourceSummary {
  kind: 'doc';
  id: string|number;
}

/**
 *
 * Handle authorization for a single resource accessed by a given user.
 *
 */
export interface Authorizer {
  // get the id of user, or null if no authorization in place.
  getUserId(): number|null;

  // Fetch the doc metadata from HomeDBManager.
  getDoc(): Promise<Document>;

  // Check access, throw error if the requested level of access isn't available.
  assertAccess(role: 'viewers'|'editors'): Promise<void>;
}

/**
 *
 * Handle authorization for a single document and user.
 *
 */
export class DocAuthorizer implements Authorizer {
  constructor(
    private _dbManager: HomeDBManager,
    private _key: DocAuthKey,
    public readonly openMode: OpenDocMode,
  ) {
  }

  public getUserId(): number {
    return this._key.userId;
  }

  public async getDoc(): Promise<Document> {
    return this._dbManager.getDoc(this._key);
  }

  public async assertAccess(role: 'viewers'|'editors'): Promise<void> {
    const docAuth = await this._dbManager.getDocAuthCached(this._key);
    assertAccess(role, docAuth, {openMode: this.openMode});
  }
}

export class DummyAuthorizer implements Authorizer {
  constructor(public role: Role|null) {}
  public getUserId() { return null; }
  public async getDoc(): Promise<Document> { throw new Error("Not supported in standalone"); }
  public async assertAccess() { /* noop */ }
}


export function assertAccess(
  role: 'viewers'|'editors', docAuth: DocAuthResult, options: {
    openMode?: OpenDocMode,
    allowRemoved?: boolean,
  } = {}) {
  const openMode = options.openMode || 'default';
  const details = {status: 403, accessMode: openMode};
  if (docAuth.error) {
    if ([400, 401, 403].includes(docAuth.error.status)) {
      // For these error codes, we know our access level - forbidden. Make errors more uniform.
      throw new ErrorWithCode("AUTH_NO_VIEW", "No view access", details);
    }
    throw docAuth.error;
  }

  if (docAuth.removed && !options.allowRemoved) {
    throw new ErrorWithCode("AUTH_NO_VIEW", "Document is deleted", {status: 404});
  }

  // If docAuth has no error, the doc is accessible, but we should still check the level (in case
  // it's possible to access the doc with a level less than "viewer").
  if (!canView(docAuth.access)) {
    throw new ErrorWithCode("AUTH_NO_VIEW", "No view access", details);
  }

  if (role === 'editors') {
    // If opening in a fork or view mode, treat user as viewer and deny write access.
    const access = (openMode === 'fork' || openMode === 'view') ?
      getWeakestRole('viewers', docAuth.access) : docAuth.access;
    if (!canEdit(access)) {
      throw new ErrorWithCode("AUTH_NO_EDIT", "No write access", details);
    }
  }
}

/**
 * Pull out headers to pass along to a proxied service.  Focussed primarily on
 * authentication.
 */
export function getTransitiveHeaders(req: Request): {[key: string]: string} {
  const Authorization = req.get('Authorization');
  const Cookie = req.get('Cookie');
  const PermitHeader = req.get('Permit');
  const Organization = (req as RequestWithOrg).org;
  return {
    ...(Authorization ? { Authorization } : undefined),
    ...(Cookie ? { Cookie } : undefined),
    ...(Organization ? { Organization } : undefined),
    ...(PermitHeader ? { Permit: PermitHeader } : undefined),
  };
}
