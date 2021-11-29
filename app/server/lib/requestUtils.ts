import {ApiError} from 'app/common/ApiError';
import {DEFAULT_HOME_SUBDOMAIN, isOrgInPathOnly, parseSubdomain} from 'app/common/gristUrls';
import * as gutil from 'app/common/gutil';
import {DocScope, QueryResult, Scope} from 'app/gen-server/lib/HomeDBManager';
import {getUserId, RequestWithLogin} from 'app/server/lib/Authorizer';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import * as log from 'app/server/lib/log';
import {Permit} from 'app/server/lib/Permit';
import {Request, Response} from 'express';
import {URL} from 'url';

// log api details outside of dev environment (when GRIST_HOSTED_VERSION is set)
const shouldLogApiDetails = Boolean(process.env.GRIST_HOSTED_VERSION);

// Offset to https ports in dev/testing environment.
export const TEST_HTTPS_OFFSET = process.env.GRIST_TEST_HTTPS_OFFSET ?
  parseInt(process.env.GRIST_TEST_HTTPS_OFFSET, 10) : undefined;

// Database fields that we permit in entities but don't want to cross the api.
const INTERNAL_FIELDS = new Set(['apiKey', 'billingAccountId', 'firstLoginAt', 'filteredOut', 'ownerId',
                                 'stripeCustomerId', 'stripeSubscriptionId', 'stripePlanId',
                                 'stripeProductId', 'userId', 'isFirstTimeUser']);

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
 * Returns true for requests from permitted origins.  For such requests, an
 * "Access-Control-Allow-Origin" header is added to the response.  Vary: Origin
 * is also set to reflect the fact that the headers are a function of the origin,
 * to prevent inappropriate caching on the browser's side.
 */
export function trustOrigin(req: Request, resp: Response): boolean {
  // TODO: We may want to consider changing allowed origin values in the future.
  // Note that the request origin is undefined for non-CORS requests.
  const origin = req.get('origin');
  if (!origin) { return true; } // Not a CORS request.
  if (!allowHost(req, new URL(origin))) { return false; }

  // For a request to a custom domain, the full hostname must match.
  resp.header("Access-Control-Allow-Origin", origin);
  resp.header("Vary", "Origin");
  return true;
}

// Returns whether req satisfies the given allowedHost. Unless req is to a custom domain, it is
// enough if only the base domains match. Differing ports are allowed, which helps in dev/testing.
export function allowHost(req: Request, allowedHost: string|URL) {
  const mreq = req as RequestWithOrg;
  const proto = req.protocol;
  const actualUrl = new URL(`${proto}://${req.get('host')}`);
  const allowedUrl = (typeof allowedHost === 'string') ? new URL(`${proto}://${allowedHost}`) : allowedHost;
  if (mreq.isCustomHost) {
    // For a request to a custom domain, the full hostname must match.
    return actualUrl.hostname === allowedUrl.hostname;
  } else {
    // For requests to a native subdomains, only the base domain needs to match.
    const allowedDomain = parseSubdomain(allowedUrl.hostname);
    const actualDomain = parseSubdomain(actualUrl.hostname);
    return (actualDomain.base === allowedDomain.base);
  }
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
  const urlId = req.params.did || req.params.docId;
  const userId = getUserId(req);
  const org = (req as RequestWithOrg).org;
  const {specialPermit} = (req as RequestWithLogin);
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

// Return a JSON response reflecting the output of a query.
// Filter out keys we don't want crossing the api.
// Set req to null to not log any information about request.
export async function sendReply<T>(req: Request|null, res: Response, result: QueryResult<T>) {
  const data = pruneAPIResult(result.data || null);
  if (shouldLogApiDetails && req) {
    const mreq = req as RequestWithLogin;
    log.rawDebug('api call', {
      url: req.url,
      userId: mreq.userId,
      email: mreq.user && mreq.user.loginEmail,
      org: mreq.org,
      params: req.params,
      body: req.body,
      result: data,
    });
  }
  if (result.status === 200) {
    return res.json(data);
  } else {
    return res.status(result.status).json({error: result.errMessage});
  }
}

export async function sendOkReply<T>(req: Request|null, res: Response, result?: T) {
  return sendReply(req, res, {status: 200, data: result});
}

export function pruneAPIResult<T>(data: T): T {
  // TODO: This can be optimized by pruning data recursively without serializing in between. But
  // it's fairly fast even with serializing (on the order of 15usec/kb).
  const output = JSON.stringify(data,
    (key: string, value: any) => {
      // Do not include removedAt field if it is not set.  It is not relevant to regular
      // situations where the user is working with non-deleted resources.
      if (key === 'removedAt' && value === null) { return undefined; }
      // Don't bother sending option fields if there are no options set.
      if (key === 'options' && value === null) { return undefined; }
      return INTERNAL_FIELDS.has(key) ? undefined : value;
    });
  return JSON.parse(output);
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

export function optStringParam(p: any): string|undefined {
  if (typeof p === 'string') { return p; }
  return undefined;
}

export function stringParam(p: any, name: string, allowed?: string[]): string {
  if (typeof p !== 'string') { throw new Error(`${name} parameter should be a string: ${p}`); }
  if (allowed && !allowed.includes(p)) { throw new Error(`${name} parameter ${p} should be one of ${allowed}`); }
  return p;
}

export function integerParam(p: any, name: string): number {
  if (typeof p === 'number') { return Math.floor(p); }
  if (typeof p === 'string') { return parseInt(p, 10); }
  throw new Error(`${name} parameter should be an integer: ${p}`);
}

export function optIntegerParam(p: any): number|undefined {
  if (typeof p === 'number') { return Math.floor(p); }
  if (typeof p === 'string') { return parseInt(p, 10); }
  return undefined;
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
export function getOriginUrl(req: Request) {
  const host = req.headers.host!;
  const protocol = req.get("X-Forwarded-Proto") || req.protocol;
  return `${protocol}://${host}`;
}
