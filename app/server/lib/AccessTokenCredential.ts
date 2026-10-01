import { ApiError } from "app/common/ApiError";
import { removeTrailingSlash } from "app/common/gutil";
import { FullUser } from "app/common/LoginSessionAPI";
import * as roles from "app/common/roles";
import { getWeakestRole } from "app/common/roles";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import { AuthCredential } from "app/server/lib/AuthCredential";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { isExpressRequest } from "app/server/lib/requestUtils";

import { IncomingMessage } from "http";

import { Request } from "express";
import { isEqual } from "lodash";

import type { DocAuthResult, HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";

export class AccessTokenCredential implements AuthCredential {
  constructor(
    public readonly identifiedUser: FullUser,
    private readonly _accessToken: AccessTokenInfo,
  ) {
    // Defensive - tokens with .oauth properties shouldn't be used here at all.
    if (_accessToken.oauth) {
      throw new Error("Cannot use a token with OAuth restrictions as a general document access token");
    }
  }

  public scope(req: Request) {
    // Avoid modifying userId, as it can allow access tokens to be used on endpoints they're not intended for.
    return undefined;
  }

  public async docAuth(
    mreq: RequestWithLogin, dbManager: HomeDBDocAuth, urlId: string,
  ): Promise<DocAuthResult> {
    // Defensive - token should already have been validated when it was parsed.
    assertAccessTokenMatchesReqRoute(this._accessToken, mreq);

    const docAuth = await dbManager.getDocAuthCached({
      urlId, userId: this.identifiedUser.id, org: mreq.org,
    });
    const doc = docAuth.cachedDoc;
    if (!doc || doc.id !== this._accessToken.docId) {
      throw new ApiError("Document access denied", 403);
    }

    const maxRole = this._accessToken.readOnly ? roles.VIEWER : roles.OWNER;
    return { ...docAuth, access: getWeakestRole(maxRole, docAuth.access) };
  }

  public permissionMask() { return undefined; }
}

/**
 * Checks that a token allows access to the URL of the current request.
 * For a token to be valid, the following must be true:
 * - The token is not bound to a specific route
 * or
 * - The request's path (after middleware (e.g. /dw/ and /v/ tags stripped)) must match the token's route.
 *   This prevents the request going to an entirely different endpoint.
 * - The request's method must match the token's method (e.g. GET).
 * - The request's query parameters match the token's query parameters exactly.
 *   The "auth" param isn't considered, as it contains the token itself.
 *   Ordering must be preserved - code often only cares about the first value of a query parameter.
 *   Allowing reordering would potentially change the behavior of a request.
 *
 * A request without express routing context (e.g. the raw IncomingMessage seen by the WebSocket
 * upgrade handler) can never satisfy a route-pinned token, as its route can't be determined.
 */
export function assertAccessTokenMatchesReqRoute(token: AccessTokenInfo, req: IncomingMessage | Request) {
  if (token.route === undefined) {
    return;
  }

  if (!isExpressRequest(req)) {
    throw new ApiError("Token not valid for this request", 401);
  }

  // On home servers, this is mounted in a router and so req.baseUrl contains the majority of the path.
  // On doc workers, this is mounted directly on _app and req.path contains the actual path.
  // Concatenating these gives us the real endpoint path in both situations.
  // /dw/ and /v/ tags remain stripped
  const reqPath = req.baseUrl + req.path;
  // Match against req.path - ideally we want to match the exact route as registered in express.
  if (removeTrailingSlash(token.route.path) !== removeTrailingSlash(reqPath)) {
    throw new ApiError("Token not valid for this request: path does not match", 403);
  }
  if (token.route.method.toUpperCase() !== req.method.toUpperCase()) {
    throw new ApiError("Token not valid for this request: method does not match", 403);
  }
  const expectedParams = token.route.queryParams;
  const urlSearchParams = (new URL(req.url, "https://example.com")).searchParams;

  // Remove the auth token param - it's the only one we don't want to verify.
  urlSearchParams.delete("auth");
  const actualParams = [...urlSearchParams.entries()];

  // Deep comparison of query parameter arrays.
  if (!isEqual(expectedParams, actualParams)) {
    throw new ApiError("Token not valid for this request: query parameters do not match", 403);
  }
}
