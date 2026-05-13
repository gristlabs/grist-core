import { ApiError } from "app/common/ApiError";
import { OpenDocMode } from "app/common/DocListAPI";
import { ErrorWithCode } from "app/common/ErrorWithCode";
import { ActivationState } from "app/common/gristUrls";
import { FullUser, UserProfile } from "app/common/LoginSessionAPI";
import { canEdit, canView, getWeakestRole } from "app/common/roles";
import { UserOptions } from "app/common/UserAPI";
import { User } from "app/gen-server/entity/User";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { DocAuthResult, HomeDBAuth } from "app/gen-server/lib/homedb/Interfaces";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import {
  forceSessionChange, generateAltSessionID, getSessionProfiles,
  getSessionUser, getSignInStatus, linkOrgWithEmail, SessionObj, SessionUserObj, SignInStatus,
} from "app/server/lib/BrowserSession";
import { expressWrap } from "app/server/lib/expressWrap";
import { RequestWithOrg } from "app/server/lib/extractOrg";
import { GristServer } from "app/server/lib/GristServer";
import { COOKIE_MAX_AGE, COOKIE_MAX_AGE_ANONYMOUS,
  cookieName as sessionCookieName, getAllowedOrgForSessionID, getCookieDomain } from "app/server/lib/gristSessions";
import { getBootKey } from "app/server/lib/gristSettings";
import log from "app/server/lib/log";
import { IPermitStore, Permit } from "app/server/lib/Permit";
import { allowHost, buildXForwardedForHeader, getOriginUrl, optStringParam } from "app/server/lib/requestUtils";

import { IncomingMessage } from "http";

import * as cookie from "cookie";
import { NextFunction, Request, RequestHandler, Response } from "express";
import onHeaders from "on-headers";

export interface RequestWithLogin extends Request {
  sessionID: string;
  session: SessionObj;
  org?: string;
  isCustomHost?: boolean;  // when set, the request's domain is a recognized custom host linked
  // with the specified org.
  fullUser?: FullUser;
  users?: UserProfile[];
  userId?: number;
  user?: User;
  userIsAuthorized?: boolean;   // If userId is for "anonymous", this will be false.
  docAuth?: DocAuthResult;      // For doc requests, the docId and the user's access level.
  specialPermit?: Permit;
  accessToken?: AccessTokenInfo;
  altSessionId?: string;   // a session id for use in trigger formulas and granular access rules
  isApiKeyAuth?: boolean;  // Whether the request was authenticated via API key.
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
  return process.env.GRIST_SINGLE_USER === "1";
}

/**
 * Returns a profile if it can be deduced from the request. This requires a
 * header to specify the users' email address.
 * A result of null means that the user should be considered known to be anonymous.
 * A result of undefined means we should go on to consider other authentication
 * methods (such as cookies).
 */
export function getRequestProfile(req: Request | IncomingMessage,
  header: string): UserProfile | null | undefined {
  let profile: UserProfile | null | undefined;

  // Careful reading headers. If we have an IncomingMessage, there is no
  // get() function, and header names are lowercased.
  const headerContent = ("get" in req) ? req.get(header) : req.headers[header.toLowerCase()];
  if (headerContent) {
    const userEmail = headerContent.toString();
    const [userName] = userEmail.split("@", 1);
    if (userEmail && userName) {
      profile = {
        email: userEmail,
        name: userName,
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

function setRequestUser(mreq: RequestWithLogin, dbManager: HomeDBAuth, user: User) {
  mreq.user = user;
  mreq.userId = user.id;
  mreq.userIsAuthorized = (user.id !== dbManager.getAnonymousUserId());

  expandUserSessionIfNewlyLoggedIn(mreq);

  const fullUser = dbManager.makeFullUser(user);
  // This is dumb, but historically, we used 'email' field inconsistently; in this Authorizer
  // flow, it was set to the normalized email, rather than the display email. The difference is
  // visible in the value of the `user.Email` attribute seen by access rules for **API requests**,
  // while requests from web UI, via websocket, have 'email' set to the display email. We preserve
  // this awful discrepancy until we find courage to risk breaking existing access rules. (The
  // worst of it is addressed by using cases-insensitive comparisons for UserAttributes.)
  if (fullUser.loginEmail) {
    fullUser.email = fullUser.loginEmail;
  }
  mreq.fullUser = fullUser;
  if (!mreq.users) {
    mreq.users = [fullUser];
  }
}

/**
 * Expand the user session lifetime if they have just logged in, since anonymous sessions have a shorter lifetime.
 * This makes the session reflect the value set in COOKIE_MAX_AGE.
 */
function expandUserSessionIfNewlyLoggedIn(mreq: RequestWithLogin) {
  const { originalMaxAge, maxAge } = mreq.session.cookie;
  if (mreq.userIsAuthorized && COOKIE_MAX_AGE !== null && originalMaxAge && originalMaxAge < COOKIE_MAX_AGE) {
    mreq.session.cookie.originalMaxAge = COOKIE_MAX_AGE;
    mreq.session.cookie.expires = new Date(Date.now() + COOKIE_MAX_AGE + maxAge - originalMaxAge);
    forceSessionChange(mreq.session);
  }
}

/**
 * Validate an API key from a request's Authorization header.
 * Returns the authenticated User if a valid "Bearer <key>" is found.
 * Returns undefined if no Authorization header or not a Bearer token (caller should try other auth).
 * Throws ApiError if credentials are present but invalid (bad key, expired service account, etc).
 *
 * Used by both the REST API middleware (addRequestUser) and the WebSocket connection handler (Comm).
 */
export async function getApiKeyUser(
  req: IncomingMessage,
  dbManager: HomeDBAuth,
): Promise<User | undefined> {
  if (!req.headers?.authorization) {
    return undefined;
  }
  // header needs to be of form "Bearer XXXXXXXXX" to apply
  const parts = String(req.headers.authorization).split(" ");
  if (parts[0] !== "Bearer") {
    throw new ApiError("Bad request: unsupported Authorization scheme, expected 'Bearer'", 401);
  }
  const user = parts[1] ? await dbManager.getUserByKey(parts[1]) : undefined;
  if (!user) {
    throw new ApiError("Bad request: invalid API key", 401);
  }
  if (user.type === "service") {
    const serviceAccount = (await dbManager.getServiceAccountByLoginWithOwner(user.loginEmail!))!;
    if (serviceAccount.owner.disabledAt) {
      throw new ApiError("Owner account is disabled", 403);
    }
    if (!serviceAccount.isActive()) {
      throw new ApiError("Service Account has expired", 401);
    }
  }
  // We forbid the anonymous user from presenting an API key. That saves us
  // having to think through the consequences of authorized access to the
  // anonymous user's profile via the API (e.g. how should the API key be managed).
  if (user.id === dbManager.getAnonymousUserId()) {
    throw new ApiError("Credentials cannot be presented for the anonymous user account via API key", 401);
  }
  return user;
}

/**
 * Resolve a User from a session profile.
 * Returns the matching User if the profile has an email, or the anonymous user otherwise.
 */
async function getUserFromProfile(
  dbManager: HomeDBAuth,
  profile: UserProfile | null,
  userOptions?: UserOptions,
): Promise<User> {
  if (!profile?.email) {
    return dbManager.getAnonymousUser();
  }
  return await dbManager.getUserByLoginWithRetry(profile.email, { profile, userOptions });
}

/**
 * Result of resolving a user's identity from a request.
 * Used by both REST (addRequestUser) and WebSocket (Comm) auth paths.
 */
export interface IdentityResult {
  user: User;                    // The resolved user (or anonymous)
  accessToken?: AccessTokenInfo; // Set if ?auth token was used
  specialPermit?: Permit;        // Set if permit header was used
  hasApiKey: boolean;            // Whether API key was used (for telemetry)
  // True when the user presented explicit credentials (API key, boot key, permit,
  // access token). False for ambient browser-based auth (session cookie, forward-auth
  // header) and anonymous. Used by REST middleware for CSRF protection: mutating
  // requests without explicit credentials must include a CORS-triggering header
  // (X-Requested-With or Content-Type: application/json) to guard against
  // cross-site form submissions that the browser would send with session cookies.
  explicitAuth: boolean;
}

/**
 * Shared auth resolution for both REST and WebSocket paths.
 * Priority: access token, API key, boot key, permit, override profile,
 * session profile, anonymous fallback.
 *
 * Each method either succeeds (returns immediately) or fails (throws).
 * Once a method claims the request, later methods are not consulted.
 *
 * Throws ApiError on auth failures (bad key, invalid permit, etc.).
 * Does NOT check user.disabledAt — callers handle that with their own policies.
 */
export async function resolveIdentity(
  req: IncomingMessage,
  dbManager: HomeDBAuth,
  options: {
    gristServer: GristServer;
    permitStore: IPermitStore;
    overrideProfile?: (req: IncomingMessage) => Promise<UserProfile | null | undefined>;
    getSessionProfile?: () => Promise<{
      profile: UserProfile | null;
      userOptions?: UserOptions;
    }>;
  },
): Promise<IdentityResult> {
  // Access token via ?auth query parameter.
  const url = new URL(req.url!, "http://localhost");
  const auth = url.searchParams.get("auth");
  if (auth) {
    const tokens = options.gristServer.getAccessTokens();
    const accessToken = await tokens.verify(auth);
    // Access tokens don't set a userId, so CSRF protection still applies
    // (explicitAuth: false). In practice these are GET requests for
    // attachments, but we keep the check for safety.
    return {
      user: dbManager.getAnonymousUser(),
      accessToken,
      hasApiKey: false,
      explicitAuth: false,
    };
  }

  // API key (Bearer header).
  const apiKeyUser = await getApiKeyUser(req, dbManager);
  if (apiKeyUser) {
    return { user: apiKeyUser, hasApiKey: true, explicitAuth: true };
  }

  // Boot key (x-boot-key header).
  if (req.headers?.["x-boot-key"]) {
    const reqBootKey = String(req.headers["x-boot-key"]);
    const bootKey = getBootKey();
    if (bootKey?.value !== reqBootKey) {
      throw new ApiError("Bad request: invalid Boot key", 401);
    }
    const admin = options.gristServer.getInstallAdmin();
    const user = await admin.getAdminUser();
    if (!user) {
      throw new ApiError("No admin user available", 500);
    }
    return { user, hasApiKey: false, explicitAuth: true };
  }

  // Special permission header for internal housekeeping tasks.
  if (req.headers?.permit) {
    const permitKey = String(req.headers.permit);
    let permit: Permit | null;
    try {
      permit = await options.permitStore.getPermit(permitKey);
    } catch (err) {
      log.error(`problem reading permit: ${err}`);
      throw new ApiError("Bad request: permit could not be read", 401);
    }
    if (!permit) {
      throw new ApiError("Bad request: unknown permit", 401);
    }
    return {
      user: dbManager.getAnonymousUser(),
      specialPermit: permit,
      hasApiKey: false,
      explicitAuth: true,
    };
  }

  // Override profile (e.g. forward-auth header).
  if (options.overrideProfile) {
    const candidateProfile = await options.overrideProfile(req);
    if (candidateProfile !== undefined) {
      if (candidateProfile) {
        const user = await getUserFromProfile(dbManager, candidateProfile);
        return { user, hasApiKey: false, explicitAuth: false };
      }
      // null means explicitly anonymous, skip session.
      return { user: dbManager.getAnonymousUser(), hasApiKey: false, explicitAuth: false };
    }
  }

  // Session profile.
  if (options.getSessionProfile) {
    const { profile, userOptions } = await options.getSessionProfile();
    if (profile) {
      const user = await getUserFromProfile(dbManager, profile, userOptions);
      return { user, hasApiKey: false, explicitAuth: false };
    }
  }

  // Anonymous fallback.
  return { user: dbManager.getAnonymousUser(), hasApiKey: false, explicitAuth: false };
}

/**
 * Extract a session profile from the Express session for the current request.
 * Handles custom-domain sessionID validation, profile-to-org linking,
 * and cookie maxAge bookkeeping.
 *
 * Side effects: sets mreq.users and may mutate session state (cookie maxAge, orgToUser).
 * Returns `{ profile, userOptions, customHostSession }`.
 * Throws ApiError on session-hijack detection.
 */
async function getExpressSessionProfile(
  mreq: RequestWithLogin,
  dbManager: HomeDBAuth,
): Promise<{
  profile: UserProfile | null;
  userOptions?: UserOptions;
  customHostSession: string;
}> {
  let customHostSession = "";
  const session = mreq.session;
  if (!(session?.users && session.users.length > 0 && mreq.org !== undefined)) {
    return { profile: null, customHostSession };
  }

  // Prevent using custom-domain sessionID to authorize to a different domain, since
  // custom-domain owner could hijack such sessions.
  const allowedOrg = getAllowedOrgForSessionID(mreq.sessionID);
  if (allowedOrg) {
    if (allowHost(mreq, allowedOrg.host)) {
      customHostSession = ` custom-host-match ${allowedOrg.host}`;
    } else {
      // We need an exception for internal forwarding from home server to doc-workers. These use
      // internal hostnames, so we can't expect a custom domain. These requests do include an
      // Organization header, which we'll use to grant the exception, but security issues remain.
      // TODO Issue 1: an attacker can use a custom-domain request to get an API key, which is an
      // open door to all orgs accessible by this user.
      // TODO Issue 2: Organization header is easy for an attacker (who has stolen a session
      // cookie) to include too; it does nothing to prove that the request is internal.
      const org = mreq.header("organization");
      if (org && org === allowedOrg.org) {
        customHostSession = ` custom-host-fwd ${org}`;
      } else {
        // Log error and fail.
        log.warn("Auth[%s]: sessionID for host %s org %s; wrong for host %s org %s", mreq.method,
          allowedOrg.host, allowedOrg.org, mreq.get("host"), mreq.org);
        throw new ApiError("Bad request: invalid session ID", 403);
      }
    }
  }

  mreq.users = getSessionProfiles(session);

  // If we haven't set a maxAge yet, set it now.
  if (session?.cookie && !session.cookie.maxAge) {
    if (COOKIE_MAX_AGE !== null) {
      session.cookie.maxAge = COOKIE_MAX_AGE;
      forceSessionChange(session);
    }
  }

  // See if we have a profile linked with the active organization already.
  // TODO: implement userSelector for rest API, to allow "sticky" user selection on pages.
  let sessionUser: SessionUserObj | null = getSessionUser(session, mreq.org,
    optStringParam(mreq.query.user, "user") || "");

  if (!sessionUser) {
    // No profile linked yet, so let's elect one.
    // Choose a profile that is no worse than the others available.
    const option = await dbManager.getBestUserForOrg(mreq.users, mreq.org);
    if (option) {
      // Modify request session object to link the current org with our choice of
      // profile.  Express-session will save this change.
      sessionUser = linkOrgWithEmail(session, option.email, mreq.org);
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

  const profile = sessionUser?.profile ?? null;
  const userOptions: UserOptions = {};
  if (profile?.loginMethod === "Email + Password") {
    // Link the session authSubject, if present, to the user. This has no effect
    // if the user already has an authSubject set in the db.
    userOptions.authSubject = sessionUser?.authSubject;
  }
  return { profile, userOptions, customHostSession };
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
  dbManager: HomeDBAuth, permitStore: IPermitStore,
  options: {
    gristServer: GristServer,
    skipSession?: boolean,
    overrideProfile?(req: Request | IncomingMessage): Promise<UserProfile | null | undefined>,
  },
  req: Request, res: Response, next: NextFunction,
) {
  const mreq = req as RequestWithLogin;

  // This function may be called multiple times for the same request (e.g. by the setup gate
  // and then again by the user ID middleware). Skip if we've already resolved the identity.
  if (mreq.userId !== undefined) {
    return next();
  }

  // A bit of extra info we'll add to the "Auth" log message when this request passes the check
  // for custom-host-specific sessionID.
  let customHostSession = "";

  const skipSession = options.skipSession;

  // Resolve the user identity. Errors (invalid API key, expired token, etc.)
  // propagate to Express's JSON error handler via expressWrap.
  const identity = await resolveIdentity(mreq, dbManager, {
    gristServer: options.gristServer,
    permitStore,
    overrideProfile: options.overrideProfile,
    getSessionProfile: skipSession ? undefined : async () => {
      const { customHostSession: chs, ...sessionResult } = await getExpressSessionProfile(mreq, dbManager);
      customHostSession = chs;
      return sessionResult;
    },
  });

  const session = mreq.session;

  const isAnon = identity.user.id === dbManager.getAnonymousUserId();
  const genShortLivingSessionID: boolean = isAnon && mreq.xhr;
  if (!skipSession && genShortLivingSessionID) {
    session.cookie ||= {};
    session.cookie.maxAge = COOKIE_MAX_AGE_ANONYMOUS;
  }

  // Initialize altSessionId from the session.
  // We just use `!skipSession`, which is slightly broader: access-token and
  // boot-key requests will also get an altSessionId. This is harmless because
  // access-token requests are GETs for attachments (no trigger formulas) and
  // boot-key requests are admin-only. The alternative — threading authDone through
  // the IdentityResult — would complicate the interface for no practical benefit.
  if (!skipSession && !identity.hasApiKey && (!isAnon || genShortLivingSessionID)) {
    if (session && !session.altSessionId) {
      generateAltSessionID(session);
    }
    mreq.altSessionId = session?.altSessionId;
  }

  // Set mreq fields from the identity result.
  setRequestUser(mreq, dbManager, identity.user);
  if (identity.accessToken) { mreq.accessToken = identity.accessToken; }
  if (identity.specialPermit) { mreq.specialPermit = identity.specialPermit; }
  if (identity.hasApiKey) { mreq.isApiKeyAuth = true; }

  // When the user was NOT authenticated by explicit credentials (API key, boot key,
  // permit, or access token), require mutating requests to include a header that would
  // trigger a CORS pre-flight request. This guards against cross-site form submissions
  // where the browser would automatically include the session cookie. Accepted headers:
  //   - X-Requested-With: XMLHttpRequest
  //       - https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#use-of-custom-request-headers
  //       - https://markitzeroday.com/x-requested-with/cors/2017/06/29/csrf-mitigation-for-ajax-requests.html
  //   - Content-Type: application/json
  //       - https://www.directdefense.com/csrf-in-the-age-of-json/
  if (
    !identity.explicitAuth &&
    !(mreq.xhr || mreq.get("content-type") === "application/json") &&
    !["GET", "HEAD", "OPTIONS"].includes(mreq.method)
  ) {
    return res.status(401).json({
      error: "Unauthenticated requests require one of the headers" +
        "'Content-Type: application/json' or 'X-Requested-With: XMLHttpRequest'",
    });
  }

  // Disabled users get no rights, not even public pages. Almost
  // everything is forbidden once you've been disabled. You'll have to
  // log out to see resources available to the anonymous user (except
  // for session GET requests, as noted below)
  if (mreq.user?.disabledAt) {
    // In order to let a disabled user know that they're logged in and
    // to let them log out, we'll grant them GET access to these two
    // endpoints. Otherwise the 403 error page on the client side can't
    // get an active user and thinks the user isn't logged in at all,
    // which can be more confusing than necessary.
    const isSessionGetRequest = (
      ["/session/access/active", "/session/access/all"].includes(mreq.url) &&
      mreq.method === "GET"
    );

    if (!isSessionGetRequest) {
      throw new ApiError("User is disabled", 403);
    }
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
    host: mreq.get("host"),
    path: mreq.path,
    org: mreq.org,
    email: mreq.user?.loginEmail,
    userId: mreq.userId,
    altSessionId: mreq.altSessionId,
  };
  log.rawDebug(`Auth[${meta.method}]: ${meta.host} ${meta.path}`, meta);
  if (identity.hasApiKey) {
    options.gristServer.getTelemetry().logEvent(mreq, "apiUsage", {
      full: {
        method: mreq.method,
        userId: mreq.userId,
        userAgent: mreq.headers["user-agent"],
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
  getSignUpRedirectUrl: (req: Request, redirectUrl: URL) => Promise<string>,
) {
  return expressWrap(async (req: Request, resp: Response, next: NextFunction) => {
    const mreq = req as RequestWithLogin;
    // Tell express-session to set our cookie: session handling post-login relies on it.
    forceSessionChange(mreq.session);

    // Redirect to sign up if it doesn't look like the user has ever logged in (on
    // this browser)  After logging in, `users` will be set in the session.  Even after
    // logging out again, `users` will still be set.
    const signUp: boolean = (mreq.session.users === undefined);
    log.debug(`Authorizer: redirecting to ${signUp ? "sign up" : "log in"}`);
    const redirectUrl = new URL(getOriginUrl(req) + req.originalUrl);
    if (signUp) {
      return resp.redirect(await getSignUpRedirectUrl(req, redirectUrl));
    } else {
      return resp.redirect(await getLoginRedirectUrl(req, redirectUrl));
    }
  });
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
  dbManager: HomeDBManager,
): RequestHandler {
  const redirectUnconditionally = redirectToLoginUnconditionally(getLoginRedirectUrl,
    getSignUpRedirectUrl);
  return expressWrap(async (req: Request, resp: Response, next: NextFunction) => {
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
        const result = await dbManager.getOrg({ userId: mreq.userId }, mreq.org);
        if (result.status === 200) { return next(); }
      }

      // In all other cases (including unknown org), redirect user to login or sign up.
      return redirectUnconditionally(req, resp, next);
    } catch (err) {
      log.info("Authorizer failed to redirect", err.message);
      return resp.status(401).send(err.message);
    }
  });
}

/**
 * Sets mreq.docAuth if not yet set, and returns it.
 */
export async function getOrSetDocAuth(
  mreq: RequestWithLogin, dbManager: HomeDBManager,
  gristServer: GristServer,
  urlId: string,
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

    mreq.docAuth = await dbManager.getDocAuthCached({ urlId, userId: effectiveUserId, org: mreq.org });

    if (tokenObj) {
      // Sanity check: does the current document match the document the token is
      // for? If not, fail.
      if (!mreq.docAuth.docId || mreq.docAuth.docId !== tokenObj.docId) {
        throw new ApiError("token misuse", 401);
      }
      // Limit access to read-only if specified.
      if (tokenObj.readOnly) {
        mreq.docAuth = { ...mreq.docAuth, access: getWeakestRole("viewers", mreq.docAuth.access) };
      }
    }

    // A permit with a user set to the anonymous user and linked to this document
    // gets updated to full access.
    if (mreq.specialPermit && mreq.userId === dbManager.getAnonymousUserId() &&
      mreq.specialPermit.docId === mreq.docAuth.docId) {
      mreq.docAuth = { ...mreq.docAuth, access: "owners" };
    }
  }
  return mreq.docAuth;
}

export interface ResourceSummary {
  kind: "doc";
  id: string | number;
}

interface AssertAccessOptions {
  openMode?: OpenDocMode,
  // Normally removed docs are disallowed all access. Setting this
  // property to `true` will allow access to removed docs, in addition
  // to whatever other access is already granted or denied.
  allowRemoved?: boolean,
  // As above, but for disabled docs, which are normally otherwise
  // disallowed in all cases.
  allowDisabled?: boolean,
}

export function assertAccess(
  role: "viewers" | "editors" | "owners", docAuth: DocAuthResult, options: AssertAccessOptions = {}) {
  const openMode = options.openMode || "default";
  const details = { status: 403, accessMode: openMode };
  if (docAuth.error) {
    if ([400, 401, 403].includes(docAuth.error.status)) {
      // For these error codes, we know our access level - forbidden. Make errors more uniform.
      throw new ErrorWithCode("AUTH_NO_VIEW", "No view access", details);
    }
    throw docAuth.error;
  }

  if (docAuth.removed && !options.allowRemoved) {
    throw new ErrorWithCode("AUTH_NO_VIEW", "Document is deleted", { status: 404 });
  }

  // Disabled docs have no permissions, except you can delete or undelete them
  if (docAuth.disabled && !options.allowDisabled) {
    throw new ErrorWithCode("AUTH_DOC_DISABLED", "Document is disabled", { status: 403 });
  }

  // If docAuth has no error, the doc is accessible, but we should still check the level (in case
  // it's possible to access the doc with a level less than "viewer").
  if (!canView(docAuth.access)) {
    throw new ErrorWithCode("AUTH_NO_VIEW", "No view access", details);
  }

  if (role === "editors") {
    // If opening in a fork or view mode, treat user as viewer and deny write access.
    const access = (openMode === "fork" || openMode === "view") ?
      getWeakestRole("viewers", docAuth.access) : docAuth.access;
    if (!canEdit(access)) {
      throw new ErrorWithCode("AUTH_NO_EDIT", "No write access", details);
    }
  }

  if (role === "owners" && docAuth.access !== "owners") {
    throw new ErrorWithCode("AUTH_NO_OWNER", "No owner access", details);
  }
}

/**
 * Pull out headers to pass along to a proxied service.  Focused primarily on
 * authentication.
 */
export function getTransitiveHeaders(
  req: Request,
  { includeOrigin }: { includeOrigin: boolean },
): { [key: string]: string } {
  const Authorization = req.get("Authorization");
  const Cookie = req.get("Cookie");
  const PermitHeader = req.get("Permit");
  const Organization = (req as RequestWithOrg).org;
  const XRequestedWith = req.get("X-Requested-With");
  const UserAgent = req.get("User-Agent");
  const Origin = req.get("Origin");  // Pass along the original Origin since it may
  // play a role in granular access control.

  const result: Record<string, string> = {
    ...(Authorization ? { Authorization } : undefined),
    ...(Cookie ? { Cookie } : undefined),
    ...(Organization ? { Organization } : undefined),
    ...(PermitHeader ? { Permit: PermitHeader } : undefined),
    ...(XRequestedWith ? { "X-Requested-With": XRequestedWith } : undefined),
    ...(UserAgent ? { "User-Agent": UserAgent } : undefined),
    ...buildXForwardedForHeader(req),
    ...((includeOrigin && Origin) ? { Origin } : undefined),
  };
  const extraHeader = process.env.GRIST_FORWARD_AUTH_HEADER;
  const extraHeaderValue = extraHeader && req.get(extraHeader);
  if (extraHeader && extraHeaderValue) {
    result[extraHeader] = extraHeaderValue;
  }
  return result;
}

export const signInStatusCookieName = sessionCookieName + "_status";

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

  let origSignInStatus: SignInStatus = "";
  if (req.headers.cookie) {
    const cookies = cookie.parse(req.headers.cookie);
    origSignInStatus = cookies[signInStatusCookieName] || "";
  }

  onHeaders(resp, () => {
    const newSignInStatus = getSignInStatus(mreq.session);
    if (newSignInStatus !== origSignInStatus) {
      // If not signed-in any more, set a past date to delete this cookie.
      const expires = (newSignInStatus && mreq.session.cookie.expires) || new Date(0);
      resp.append("Set-Cookie", cookie.serialize(signInStatusCookieName, newSignInStatus, {
        httpOnly: false,    // make available to client-side scripts
        expires,
        domain: getCookieDomain(req),
        path: "/",
        sameSite: "lax",    // same setting as for grist-sid is fine here.
      }));
    }
  });
  next();
}
