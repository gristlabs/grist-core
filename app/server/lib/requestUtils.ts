import {ApiError} from 'app/common/ApiError';
import {DEFAULT_HOME_SUBDOMAIN, isOrgInPathOnly, parseSubdomain, sanitizePathTail} from 'app/common/gristUrls';
import * as gutil from 'app/common/gutil';
import {DocScope, QueryResult, Scope} from 'app/gen-server/lib/HomeDBManager';
import {getUserId, RequestWithLogin} from 'app/server/lib/Authorizer';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {RequestWithGrist} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import {Permit} from 'app/server/lib/Permit';
import {Request, Response} from 'express';
import { IncomingMessage } from 'http';
import {Writable} from 'stream';
import { TLSSocket } from 'tls';

// log api details outside of dev environment (when GRIST_HOSTED_VERSION is set)
const shouldLogApiDetails = Boolean(process.env.GRIST_HOSTED_VERSION);

// Offset to https ports in dev/testing environment.
export const TEST_HTTPS_OFFSET = process.env.GRIST_TEST_HTTPS_OFFSET ?
  parseInt(process.env.GRIST_TEST_HTTPS_OFFSET, 10) : undefined;

// Database fields that we permit in entities but don't want to cross the api.
const INTERNAL_FIELDS = new Set([
  'apiKey', 'billingAccountId', 'firstLoginAt', 'filteredOut', 'ownerId', 'gracePeriodStart', 'stripeCustomerId',
  'stripeSubscriptionId', 'stripePlanId', 'stripeProductId', 'userId', 'isFirstTimeUser', 'allowGoogleLogin',
  'authSubject', 'usage', 'createdBy'
]);

/**
 * Adapt a home-server or doc-worker URL to match the hostname in the request URL. For custom
 * domains and when GRIST_SERVE_SAME_ORIGIN is set, we replace the full hostname; otherwise just
 * the base of the hostname. The changes to url are made in-place.
 *
 * For dev purposes, port is kept but possibly adjusted for TEST_HTTPS_OFFSET. Note that if port
 * is different from req's port, it is not considered same-origin for CORS purposes, but would
 * still receive cookies.
 */
export function adaptServerUrl(url: URL, req: RequestWithOrg): void {
  const reqBaseDomain = parseSubdomain(req.hostname).base;

  if (process.env.GRIST_SERVE_SAME_ORIGIN === 'true' || req.isCustomHost) {
    url.hostname = req.hostname;
  } else if (reqBaseDomain) {
    const subdomain: string|undefined = parseSubdomain(url.hostname).org || DEFAULT_HOME_SUBDOMAIN;
    url.hostname = `${subdomain}${reqBaseDomain}`;
  }

  // In dev/test environment we can turn on a flag to adjust URLs to use https.
  if (TEST_HTTPS_OFFSET && url.port && url.protocol === 'http:') {
    url.port = String(parseInt(url.port, 10) + TEST_HTTPS_OFFSET);
    url.protocol = 'https:';
  }
}

/**
 * If org is not encoded in domain, prefix it to path - otherwise leave path unchanged.
 * The domain is extracted from the request, so this method is only useful for constructing
 * urls that stay within that domain.
 */
export function addOrgToPathIfNeeded(req: RequestWithOrg, path: string): string {
  return (isOrgInPathOnly(req.hostname) && req.org) ? `/o/${req.org}${path}` : path;
}

/**
 * If org is known, prefix it to path unconditionally.
 */
export function addOrgToPath(req: RequestWithOrg, path: string): string {
  return req.org ? `/o/${req.org}${path}` : path;
}

/**
 * Get url to the org associated with the request.
 */
export function getOrgUrl(req: Request, path: string = '/') {
  // Be careful to include a leading slash in path, to ensure we don't modify the origin or org.
  return getOriginUrl(req) + addOrgToPathIfNeeded(req, sanitizePathTail(path));
}

/**
 * Returns true for requests from permitted origins.  For such requests, if
 * a Response object is provided, an "Access-Control-Allow-Origin" header is added
 * to the response.  Vary: Origin is also set to reflect the fact that the headers
 * are a function of the origin, to prevent inappropriate caching on the browser's side.
 */
export function trustOrigin(req: IncomingMessage, resp?: Response): boolean {
  // TODO: We may want to consider changing allowed origin values in the future.
  // Note that the request origin is undefined for non-CORS requests.
  const origin = req.headers.origin;
  if (!origin) { return true; } // Not a CORS request.
  if (!allowHost(req, new URL(origin))) { return false; }

  if (resp) {
    // For a request to a custom domain, the full hostname must match.
    resp.header("Access-Control-Allow-Origin", origin);
    resp.header("Vary", "Origin");
  }
  return true;
}

// Returns whether req satisfies the given allowedHost. Unless req is to a custom domain, it is
// enough if only the base domains match. Differing ports are allowed, which helps in dev/testing.
export function allowHost(req: IncomingMessage, allowedHost: string|URL) {
  const proto = getEndUserProtocol(req);
  const actualUrl = new URL(getOriginUrl(req));
  const allowedUrl = (typeof allowedHost === 'string') ? new URL(`${proto}://${allowedHost}`) : allowedHost;
  if ((req as RequestWithOrg).isCustomHost) {
    // For a request to a custom domain, the full hostname must match.
    return actualUrl.hostname === allowedUrl.hostname;
  } else {
    // For requests to a native subdomains, only the base domain needs to match.
    const allowedDomain = parseSubdomain(allowedUrl.hostname);
    const actualDomain = parseSubdomain(actualUrl.hostname);
    return actualDomain.base ?
      actualDomain.base === allowedDomain.base :
      actualUrl.hostname === allowedUrl.hostname;
  }
}

export function matchesBaseDomain(domain: string, baseDomain: string) {
  return domain === baseDomain || domain.endsWith("." + baseDomain);
}

export function isParameterOn(parameter: any): boolean {
  return gutil.isAffirmative(parameter);
}

/**
 * Get Scope from request, and make sure it has everything needed for a document.
 */
export function getDocScope(req: Request): DocScope {
  const scope = getScope(req);
  if (!scope.urlId) { throw new Error('document required'); }
  return scope as DocScope;
}

/**
 * Extract information included in the request that may restrict the scope of
 * that request.  Not all requests will support all restrictions.
 *
 * - userId - Mandatory.  Produced by authentication middleware.
 *     Information returned and actions taken will be limited by what
 *     that user has access to.
 *
 * - org - Optional.  Extracted by middleware.  Limits
 *     information/action to the given org.  Not every endpoint
 *     respects this limit.  Possible exceptions include endpoints for
 *     listing orgs a user has access to, and endpoints with an org id
 *     encoded in them.
 *
 * - urlId - Optional.  Embedded as "did" (or "docId") path parameter in endpoints related
 *     to documents.  Specifies which document the request pertains to.  Can
 *     be a urlId or a docId.
 *
 * - includeSupport - Optional.  Embedded as "includeSupport" query parameter.
 *     Just a few endpoints support this, it is a very specific "hack" for including
 *     an example workspace in org listings.
 *
 * - showRemoved - Optional.  Embedded as "showRemoved" query parameter.
 *     Supported by many endpoints.  When absent, request is limited
 *     to docs/workspaces that have not been removed.  When present, request
 *     is limited to docs/workspaces that have been removed.
 */
export function getScope(req: Request): Scope {
  const {specialPermit, docAuth} = (req as RequestWithLogin);
  const urlId = req.params.did || req.params.docId || docAuth?.docId || undefined;
  const userId = getUserId(req);
  const org = (req as RequestWithOrg).org;
  const includeSupport = isParameterOn(req.query.includeSupport);
  const showRemoved = isParameterOn(req.query.showRemoved);
  return {urlId, userId, org, includeSupport, showRemoved, specialPermit};
}

/**
 * If scope is for the given userId, return a new Scope with the special permit added.
 */
export function addPermit(scope: Scope, userId: number, specialPermit: Permit): Scope {
  return {...scope, ...(scope.userId === userId ? {specialPermit} : {})};
}

export interface SendReplyOptions {
  allowedFields?: Set<string>;
}

// Return a JSON response reflecting the output of a query.
// Filter out keys we don't want crossing the api.
// Set req to null to not log any information about request.
export async function sendReply<T>(
  req: Request|null,
  res: Response,
  result: QueryResult<T>,
  options: SendReplyOptions = {},
) {
  const data = pruneAPIResult(result.data, options.allowedFields);
  if (shouldLogApiDetails && req) {
    const mreq = req as RequestWithLogin;
    log.rawDebug('api call', {
      url: req.url,
      userId: mreq.userId,
      altSessionId: mreq.altSessionId,
      email: mreq.user && mreq.user.loginEmail,
      org: mreq.org,
      params: req.params,
      body: req.body,
      result: data,
    });
  }
  if (result.status === 200) {
    return res.json(data ?? null); // can't handle undefined
  } else {
    return res.status(result.status).json({error: result.errMessage});
  }
}

export async function sendOkReply<T>(
  req: Request|null,
  res: Response,
  result?: T,
  options: SendReplyOptions = {}
) {
  return sendReply(req, res, {status: 200, data: result}, options);
}

export function pruneAPIResult<T>(data: T, allowedFields?: Set<string>): T {
  // TODO: This can be optimized by pruning data recursively without serializing in between. But
  // it's fairly fast even with serializing (on the order of 15usec/kb).
  const output = JSON.stringify(data,
    (key: string, value: any) => {
      // Do not include removedAt field if it is not set.  It is not relevant to regular
      // situations where the user is working with non-deleted resources.
      if (key === 'removedAt' && value === null) { return undefined; }
      // Don't bother sending option fields if there are no options set.
      if (key === 'options' && value === null) { return undefined; }
      // Don't prune anything that is explicitly allowed.
      if (allowedFields?.has(key)) { return value; }
      // User connect id is not used in regular configuration, so we remove it from the response, when
      // it's not filled.
      if (key === 'connectId' && value === null) { return undefined; }
      return INTERNAL_FIELDS.has(key) ? undefined : value;
    });
  return output !== undefined ? JSON.parse(output) : undefined;
}

/**
 * Access the canonical docId associated with the request.  Must have already authorized.
 */
export function getDocId(req: Request) {
  const mreq = req as RequestWithLogin;
  // We should always have authorized by now.
  if (!mreq.docAuth || !mreq.docAuth.docId) { throw new ApiError(`unknown document`, 500); }
  return mreq.docAuth.docId;
}

export interface StringParamOptions {
  allowed?: readonly string[];
  /* Defaults to true. */
  allowEmpty?: boolean;
}

export function optStringParam(p: any, name: string, options: StringParamOptions = {}): string|undefined {
  if (p === undefined) { return p; }

  return stringParam(p, name, options);
}

export function stringParam(p: any, name: string, options: StringParamOptions = {}): string {
  const {allowed, allowEmpty = true} = options;
  if (typeof p !== 'string') {
    throw new ApiError(`${name} parameter should be a string: ${p}`, 400);
  }
  if (!allowEmpty && p === '') {
    throw new ApiError(`${name} parameter cannot be empty`, 400);
  }
  if (allowed && !allowed.includes(p)) {
    throw new ApiError(`${name} parameter ${p} should be one of ${allowed}`, 400);
  }
  return p;
}

export function stringArrayParam(p: any, name: string): string[] {
  if (!Array.isArray(p)) {
    throw new ApiError(`${name} parameter should be an array: ${p}`, 400);
  }
  if (p.some(el => typeof el !== 'string')) {
    throw new ApiError(`${name} parameter should be a string array: ${p}`, 400);
  }

  return p;
}

export function optIntegerParam(p: any, name: string): number|undefined {
  if (p === undefined) { return p; }

  return integerParam(p, name);
}

export function integerParam(p: any, name: string): number {
  if (typeof p === 'number' && !Number.isNaN(p)) { return Math.floor(p); }
  if (typeof p === 'string') {
    const result = parseInt(p, 10);
    if (isNaN(result)) {
      throw new ApiError(`${name} parameter cannot be understood as an integer: ${p}`, 400);
    }
    return result;
  }
  throw new ApiError(`${name} parameter should be an integer: ${p}`, 400);
}

export function optBooleanParam(p: any, name: string): boolean|undefined {
  if (p === undefined) { return p; }

  return booleanParam(p, name);
}

export function booleanParam(p: any, name: string): boolean {
  if (typeof p === 'boolean') { return p; }
  throw new ApiError(`${name} parameter should be a boolean: ${p}`, 400);
}

export function optJsonParam(p: any, defaultValue: any): any {
  if (typeof p !== 'string') { return defaultValue; }
  return gutil.safeJsonParse(p, defaultValue);
}

export interface RequestWithGristInfo extends Request {
  gristInfo?: string;
}

/**
 * Returns original request origin. In case, when a client was connected to proxy
 * or load balancer, it reads protocol from forwarded headers.
 * More can be read on:
 * https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Proto
 * https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/x-forwarded-headers.html
 */
export function getOriginUrl(req: IncomingMessage) {
  const host = req.headers.host;
  const protocol = getEndUserProtocol(req);
  return `${protocol}://${host}`;
}

/**
 * Get the protocol to use in Grist URLs that are intended to be reachable
 * from a user's browser. Use the protocol in APP_HOME_URL if available,
 * otherwise X-Forwarded-Proto is set on the provided request, otherwise
 * the protocol of the request itself.
 */
export function getEndUserProtocol(req: IncomingMessage) {
  if (process.env.APP_HOME_URL) {
    return new URL(process.env.APP_HOME_URL).protocol.replace(':', '');
  }
  // TODO we shouldn't blindly trust X-Forwarded-Proto. See the Express approach:
  // https://expressjs.com/en/5x/api.html#trust.proxy.options.table
  return req.headers["x-forwarded-proto"] || ((req.socket as TLSSocket).encrypted ? 'https' : 'http');
}

/**
 * In some configurations, session information may be cached by the server.
 * When session information changes, give the server a chance to clear its
 * cache if needed.
 */
export function clearSessionCacheIfNeeded(req: Request, options?: {
  email?: string,
  org?: string|null,
  sessionID?: string,
}) {
  (req as RequestWithGrist).gristServer?.getSessions().clearCacheIfNeeded(options);
}

export function addAbortHandler(req: Request, res: Writable, op: () => void) {
  // It became hard to detect aborted connections in node 16.
  // In node 14, req.on('close', ...) did the job.
  // The following is a work-around, until a better way is discovered
  // or added. Aborting a req will typically lead to 'close' being called
  // on the response, without writableFinished being set.
  //   https://github.com/nodejs/node/issues/38924
  //   https://github.com/nodejs/node/issues/40775
  res.on('close', () => {
    const aborted = !res.writableFinished;
    if (aborted) {
      op();
    }
  });
}
