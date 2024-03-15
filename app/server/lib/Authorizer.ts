import {ApiError} from 'app/common/ApiError';
import {OpenDocMode} from 'app/common/DocListAPI';
import {ErrorWithCode} from 'app/common/ErrorWithCode';
import {ActivationState} from 'app/common/gristUrls';
import {FullUser, UserProfile} from 'app/common/LoginSessionAPI';
import {canEdit, canView, getWeakestRole, Role} from 'app/common/roles';
import {UserOptions} from 'app/common/UserAPI';
import {Document} from 'app/gen-server/entity/Document';
import {User} from 'app/gen-server/entity/User';
import {DocAuthKey, DocAuthResult, HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {forceSessionChange, getSessionProfiles, getSessionUser, getSignInStatus, linkOrgWithEmail, SessionObj,
        SessionUserObj, SignInStatus} from 'app/server/lib/BrowserSession';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristServer} from 'app/server/lib/GristServer';
import {COOKIE_MAX_AGE, getAllowedOrgForSessionID, getCookieDomain,
        cookieName as sessionCookieName} from 'app/server/lib/gristSessions';
import {makeId} from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import {IPermitStore, Permit} from 'app/server/lib/Permit';
import {AccessTokenInfo} from 'app/server/lib/AccessTokens';
import {allowHost, getOriginUrl, optStringParam} from 'app/server/lib/requestUtils';
import * as cookie from 'cookie';
import {NextFunction, Request, RequestHandler, Response} from 'express';
import {IncomingMessage} from 'http';
import onHeaders from 'on-headers';

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
  accessToken?: AccessTokenInfo;
  altSessionId?: string;   // a session id for use in trigger formulas and granular access rules
  activation?: ActivationState;
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
 * Returns a profile if it can be deduced from the request. This requires a
 * header to specify the users' email address.
 * A result of null means that the user should be considered known to be anonymous.
 * A result of undefined means we should go on to consider other authentication
 * methods (such as cookies).
 */
export function getRequestProfile(req: Request|IncomingMessage,
                                  header: string): UserProfile|null|undefined {
  let profile: UserProfile|null|undefined;

  // Careful reading headers. If we have an IncomingMessage, there is no
  // get() function, and header names are lowercased.
  const headerContent = ('get' in req) ? req.get(header) : req.headers[header.toLowerCase()];
  if (headerContent) {
    const userEmail = headerContent.toString();
    const [userName] = userEmail.split("@", 1);
    if (userEmail && userName) {
      profile = {
        "email": userEmail,
        "name": userName
      };
    }
  }
  // If no profile at this point, and header was present,
  // treat as anonymous user, represented by null value.
  // Don't go on to look at session.
  if (!profile && headerContent !== undefined) {
    profile = null;
  }
  return profile;
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
export async function addRequestUser(
  dbManager: HomeDBManager, permitStore: IPermitStore,
  options: {
    gristServer: GristServer,
    skipSession?: boolean,
    overrideProfile?(req: Request|IncomingMessage): Promise<UserProfile|null|undefined>,
  },
  req: Request, res: Response, next: NextFunction
) {
  const mreq = req as RequestWithLogin;
  let profile: UserProfile|undefined;

  // We support multiple method of authentication. This flag gets set once
  // we need not try any more. Specifically, it is used to avoid processing
  // anything else after setting an access token, for simplicity in reasoning
  // about this case.
  let authDone: boolean = false;

  let hasApiKey: boolean = false;

  // Support providing an access token via an `auth` query parameter.
  // This is useful for letting the browser load assets like image
  // attachments.
  const auth = optStringParam(mreq.query.auth, 'auth');
  if (auth) {
    const tokens = options.gristServer.getAccessTokens();
    const token = await tokens.verify(auth);
    mreq.accessToken = token;
    // Once an accessToken is supplied, we don't consider anything else.
    // User is treated as anonymous apart from having an accessToken.
    authDone = true;
  }

  // Now, check for an apiKey
  if (!authDone && mreq.headers && mreq.headers.authorization) {
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
      hasApiKey = true;
    }
  }

  // Special permission header for internal housekeeping tasks
  if (!authDone && mreq.headers && mreq.headers.permit) {
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

  // If we haven't already been authenticated, and this is not a GET/HEAD/OPTIONS, then
  // require a header that would trigger a CORS pre-flight request, either:
  //   - X-Requested-With: XMLHttpRequest
  //       - https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#use-of-custom-request-headers
  //       - https://markitzeroday.com/x-requested-with/cors/2017/06/29/csrf-mitigation-for-ajax-requests.html
  //   - Content-Type: application/json
  //       - https://www.directdefense.com/csrf-in-the-age-of-json/
  // This is trivial for legitimate web clients to do, and an obstacle to
  // nefarious ones.
  if (
    !mreq.userId &&
    !(mreq.xhr || mreq.get("content-type") === "application/json") &&
    !['GET', 'HEAD', 'OPTIONS'].includes(mreq.method)
  ) {
    return res.status(401).json({
      error: "Unauthenticated requests require one of the headers" +
        "'Content-Type: application/json' or 'X-Requested-With: XMLHttpRequest'"
    });
  }

  // For some configurations, the user profile can be determined from the request.
  // If this is the case, we won't use session information.
  let skipSession: boolean = options.skipSession || authDone;
  if (!authDone && !mreq.userId) {
    const candidateProfile = await options.overrideProfile?.(mreq);
    if (candidateProfile !== undefined) {
      // Either a valid or a null profile tells us that another login system determined the user,
      // and that we should skip sessions.
      skipSession = true;
      if (candidateProfile) {
        profile = candidateProfile;
        const user = await dbManager.getUserByLoginWithRetry(profile.email, {profile});
        if (user) {
          mreq.user = user;
          mreq.users = [profile];
          mreq.userId = user.id;
          mreq.userIsAuthorized = true;
        }
      }
    }
  }

  // A bit of extra info we'll add to the "Auth" log message when this request passes the check
  // for custom-host-specific sessionID.
  let customHostSession = '';

  if (!authDone && !skipSession) {
    // If we haven't selected a user by other means, and have profiles available in the
    // session, then select a user based on those profiles.
    const session = mreq.session;
    if (session && !session.altSessionId) {
      // Create a default alternative session id for use in documents.
      session.altSessionId = makeId();
      forceSessionChange(session);
    }
    mreq.altSessionId = session?.altSessionId;
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
        if (COOKIE_MAX_AGE !== null) {
          session.cookie.maxAge = COOKIE_MAX_AGE;
          forceSessionChange(session);
        }
      }

      // See if we have a profile linked with the active organization already.
      // TODO: implement userSelector for rest API, to allow "sticky" user selection on pages.
      let sessionUser: SessionUserObj|null = getSessionUser(session, mreq.org,
        optStringParam(mreq.query.user, 'user') || '');

      if (!sessionUser) {
        // No profile linked yet, so let's elect one.
        // Choose a profile that is no worse than the others available.
        const option = await dbManager.getBestUserForOrg(mreq.users, mreq.org);
        if (option) {
          // Modify request session object to link the current org with our choice of
          // profile.  Express-session will save this change.
          sessionUser = linkOrgWithEmail(session, option.email, mreq.org);
          const userOptions: UserOptions = {};
          if (sessionUser?.profile?.loginMethod === 'Email + Password') {
            // Link the session authSubject, if present, to the user. This has no effect
            // if the user already has an authSubject set in the db.
            userOptions.authSubject = sessionUser.authSubject;
          }
          // In this special case of initially linking a profile, we need to look up the user's info.
          mreq.user = await dbManager.getUserByLogin(option.email, {userOptions});
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

      profile = sessionUser?.profile ?? undefined;

      // If we haven't computed a userId yet, check for one using an email address in the profile.
      // A user record will be created automatically for emails we've never seen before.
      if (profile && !mreq.userId) {
        const userOptions: UserOptions = {};
        if (profile?.loginMethod === 'Email + Password') {
          // Link the session authSubject, if present, to the user. This has no effect
          // if the user already has an authSubject set in the db.
          userOptions.authSubject = sessionUser.authSubject;
        }
        const user = await dbManager.getUserByLoginWithRetry(profile.email, {profile, userOptions});
        if (user) {
          mreq.user = user;
          mreq.userId = user.id;
          mreq.userIsAuthorized = true;
        }
      }
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

  if (mreq.userId) {
    if (mreq.user?.options?.locale) {
      mreq.language = mreq.user.options.locale;
      // This is a synchronous call (as it was configured with initImmediate: false).
      mreq.i18n.changeLanguage(mreq.language).catch(() => {});
    }
  }

  const meta = {
    customHostSession,
    method: mreq.method,
    host: mreq.get('host'),
    path: mreq.path,
    org: mreq.org,
    email: mreq.user?.loginEmail,
    userId: mreq.userId,
    altSessionId: mreq.altSessionId,
  };
  log.rawDebug(`Auth[${meta.method}]: ${meta.host} ${meta.path}`, meta);
  if (hasApiKey) {
    options.gristServer.getTelemetry().logEvent(mreq, 'apiUsage', {
      full: {
        method: mreq.method,
        userId: mreq.userId,
        userAgent: mreq.headers['user-agent'],
      },
    });
  }

  return next();
}

/**
 * Returns a handler that redirects the user to a login or signup page.
 */
export function redirectToLoginUnconditionally(
  getLoginRedirectUrl: (req: Request, redirectUrl: URL) => Promise<string>,
  getSignUpRedirectUrl: (req: Request, redirectUrl: URL) => Promise<string>
) {
  return async (req: Request, resp: Response, next: NextFunction) => {
    const mreq = req as RequestWithLogin;
    // Tell express-session to set our cookie: session handling post-login relies on it.
    forceSessionChange(mreq.session);

    // Redirect to sign up if it doesn't look like the user has ever logged in (on
    // this browser)  After logging in, `users` will be set in the session.  Even after
    // logging out again, `users` will still be set.
    const signUp: boolean = (mreq.session.users === undefined);
    log.debug(`Authorizer: redirecting to ${signUp ? 'sign up' : 'log in'}`);
    const redirectUrl = new URL(getOriginUrl(req) + req.originalUrl);
    if (signUp) {
      return resp.redirect(await getSignUpRedirectUrl(req, redirectUrl));
    } else {
      return resp.redirect(await getLoginRedirectUrl(req, redirectUrl));
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
  getLoginRedirectUrl: (req: Request, redirectUrl: URL) => Promise<string>,
  getSignUpRedirectUrl: (req: Request, redirectUrl: URL) => Promise<string>,
  dbManager: HomeDBManager
): RequestHandler {
  const redirectUnconditionally = redirectToLoginUnconditionally(getLoginRedirectUrl,
                                                                 getSignUpRedirectUrl);
  return async (req: Request, resp: Response, next: NextFunction) => {
    const mreq = req as RequestWithLogin;
    // This will ensure that express-session will set our cookie if it hasn't already -
    // we'll need it if we redirect.
    forceSessionChange(mreq.session);
    if (mreq.userIsAuthorized) { return next(); }

    try {
      // Otherwise it's an anonymous user. Proceed normally only if the org allows anon access,
      // or if the org is not set (FlexServer._redirectToOrg will deal with that case).
      if (mreq.userId && allowExceptions) {
        // Anonymous user has qualified access to merged org.
        // If no org is set, leave it to other middleware.  One common case where the
        // org is not set is when it is embedded in the url, and the user visits '/'.
        // If we immediately require a login, it could fail if no cookie exists yet.
        // Also, '/o/docs' allows anonymous access.
        if (!mreq.org || dbManager.isMergedOrg(mreq.org)) { return next(); }
        const result = await dbManager.getOrg({userId: mreq.userId}, mreq.org);
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
  mreq: RequestWithLogin, dbManager: HomeDBManager,
  gristServer: GristServer,
  urlId: string
): Promise<DocAuthResult> {
  if (!mreq.docAuth) {
    let effectiveUserId = getUserId(mreq);
    if (mreq.specialPermit && mreq.userId === dbManager.getAnonymousUserId()) {
      effectiveUserId = dbManager.getPreviewerUserId();
    }

    // A permit with a token gives us the userId associated with that token.
    const tokenObj = mreq.accessToken;
    if (tokenObj) {
      effectiveUserId = tokenObj.userId;
    }

    mreq.docAuth = await dbManager.getDocAuthCached({urlId, userId: effectiveUserId, org: mreq.org});

    if (tokenObj) {
      // Sanity check: does the current document match the document the token is
      // for? If not, fail.
      if (!mreq.docAuth.docId || mreq.docAuth.docId !== tokenObj.docId) {
        throw new ApiError('token misuse', 401);
      }
      // Limit access to read-only if specified.
      if (tokenObj.readOnly) {
        mreq.docAuth = {...mreq.docAuth, access: getWeakestRole('viewers', mreq.docAuth.access)};
      }
    }

    // A permit with a user set to the anonymous user and linked to this document
    // gets updated to full access.
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
 * Handle authorization for a single document accessed by a given user.
 *
 */
export interface Authorizer {
  // get the id of user, or null if no authorization in place.
  getUserId(): number|null;

  // get user profile if available.
  getUser(): FullUser|null;

  // get the id of the document.
  getDocId(): string;

  // get any link parameters in place when accessing the resource.
  getLinkParameters(): Record<string, string>;

  // Fetch the doc metadata from HomeDBManager.
  getDoc(): Promise<Document>;

  // Check access, throw error if the requested level of access isn't available.
  assertAccess(role: 'viewers'|'editors'|'owners'): Promise<void>;

  // Get the lasted access information calculated for the doc.  This is useful
  // for logging - but access control itself should use assertAccess() to
  // ensure the data is fresh.
  getCachedAuth(): DocAuthResult;
}

export interface DocAuthorizerOptions {
  dbManager: HomeDBManager;
  key: DocAuthKey;
  openMode: OpenDocMode;
  linkParameters: Record<string, string>;
  userRef?: string|null;
  docAuth?: DocAuthResult;
  profile?: UserProfile;
}

/**
 *
 * Handle authorization for a single document and user.
 *
 */
export class DocAuthorizer implements Authorizer {
  public readonly openMode: OpenDocMode;
  public readonly linkParameters: Record<string, string>;
  constructor(
    private _options: DocAuthorizerOptions
  ) {
    this.openMode = _options.openMode;
    this.linkParameters = _options.linkParameters;
  }

  public getUserId(): number {
    return this._options.key.userId;
  }

  public getUser(): FullUser|null {
    return this._options.profile ? {
      id: this.getUserId(),
      ref: this._options.userRef,
      ...this._options.profile
    } : null;
  }

  public getDocId(): string {
    // We've been careful to require urlId === docId, see DocManager.
    return this._options.key.urlId;
  }

  public getLinkParameters(): Record<string, string> {
    return this.linkParameters;
  }

  public async getDoc(): Promise<Document> {
    return this._options.dbManager.getDoc(this._options.key);
  }

  public async assertAccess(role: 'viewers'|'editors'|'owners'): Promise<void> {
    const docAuth = await this._options.dbManager.getDocAuthCached(this._options.key);
    this._options.docAuth = docAuth;
    assertAccess(role, docAuth, {openMode: this.openMode});
  }

  public getCachedAuth(): DocAuthResult {
    if (!this._options.docAuth) { throw Error('no cached authentication'); }
    return this._options.docAuth;
  }
}

export class DummyAuthorizer implements Authorizer {
  constructor(public role: Role|null, public docId: string) {}
  public getUserId() { return null; }
  public getUser() { return null; }
  public getDocId() { return this.docId; }
  public getLinkParameters() { return {}; }
  public async getDoc(): Promise<Document> { throw new Error("Not supported in standalone"); }
  public async assertAccess() { /* noop */ }
  public getCachedAuth(): DocAuthResult {
    return {
      access: this.role,
      docId: this.docId,
      removed: false,
    };
  }
}


export function assertAccess(
  role: 'viewers'|'editors'|'owners', docAuth: DocAuthResult, options: {
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

  if (role === 'owners' && docAuth.access !== 'owners') {
    throw new ErrorWithCode("AUTH_NO_OWNER", "No owner access", details);
  }
}

/**
 * Pull out headers to pass along to a proxied service.  Focused primarily on
 * authentication.
 */
export function getTransitiveHeaders(req: Request): {[key: string]: string} {
  const Authorization = req.get('Authorization');
  const Cookie = req.get('Cookie');
  const PermitHeader = req.get('Permit');
  const Organization = (req as RequestWithOrg).org;
  const XRequestedWith = req.get('X-Requested-With');
  const Origin = req.get('Origin');  // Pass along the original Origin since it may
                                     // play a role in granular access control.
  const result: Record<string, string> = {
    ...(Authorization ? { Authorization } : undefined),
    ...(Cookie ? { Cookie } : undefined),
    ...(Organization ? { Organization } : undefined),
    ...(PermitHeader ? { Permit: PermitHeader } : undefined),
    ...(XRequestedWith ? { 'X-Requested-With': XRequestedWith } : undefined),
    ...(Origin ? { Origin } : undefined),
  };
  const extraHeader = process.env.GRIST_FORWARD_AUTH_HEADER;
  const extraHeaderValue = extraHeader && req.get(extraHeader);
  if (extraHeader && extraHeaderValue) {
    result[extraHeader] = extraHeaderValue;
  }
  return result;
}

export const signInStatusCookieName = sessionCookieName + '_status';

// We expose a sign-in status in a cookie accessible to all subdomains, to assist in auto-signin.
// Its value is SignInStatus ("S", "M" or unset). This middleware keeps this cookie in sync with
// the session state.
//
// Note that this extra cookie isn't strictly necessary today: since it has similar settings to
// the session cookie, subdomains can infer status from that one. It is here in anticipation that
// we make sessions a host-only cookie, to avoid exposing it to externally-hosted subdomains of
// getgrist.com. In that case, the sign-in status cookie would remain a 2nd-level domain cookie.
export function signInStatusMiddleware(req: Request, resp: Response, next: NextFunction) {
  const mreq = req as RequestWithLogin;

  let origSignInStatus: SignInStatus = '';
  if (req.headers.cookie) {
    const cookies = cookie.parse(req.headers.cookie);
    origSignInStatus = cookies[signInStatusCookieName] || '';
  }

  onHeaders(resp, () => {
    const newSignInStatus = getSignInStatus(mreq.session);
    if (newSignInStatus !== origSignInStatus) {
      // If not signed-in any more, set a past date to delete this cookie.
      const expires = (newSignInStatus && mreq.session.cookie.expires) || new Date(0);
      resp.append('Set-Cookie', cookie.serialize(signInStatusCookieName, newSignInStatus, {
        httpOnly: false,    // make available to client-side scripts
        expires,
        domain: getCookieDomain(req),
        path: '/',
        sameSite: 'lax',    // same setting as for grist-sid is fine here.
      }));
    }
  });
  next();
}
