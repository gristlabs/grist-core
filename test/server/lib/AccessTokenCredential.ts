import { FullUser } from "app/common/LoginSessionAPI";
import { Role } from "app/common/roles";
import { Document } from "app/gen-server/entity/Document";
import { HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";
import {
  AccessTokenCredential, assertAccessTokenMatchesReqRoute,
} from "app/server/lib/AccessTokenCredential";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import { RequestWithLogin } from "app/server/lib/Authorizer";

import { assert } from "chai";

const DOC_ID = "doc1";
const PINNED_PATH = "/api/docs/doc1/download/csv";

const chimpy: FullUser = {
  id: 10, name: "Chimpy", email: "chimpy@getgrist.com", loginEmail: "chimpy@getgrist.com",
};

interface ReqOptions {
  url?: string;
  baseUrl?: string;
  path?: string;
  method?: string;
}

/**
 * A minimal stand-in for an Express request. Only the fields the route check reads
 * matter: url (for query params), baseUrl + path (for the path), and method.
 */
function makeReq(opts: ReqOptions = {}): RequestWithLogin {
  const url = opts.url ?? `${PINNED_PATH}?tableId=Table1`;
  return {
    url,
    baseUrl: opts.baseUrl ?? "",
    path: opts.path ?? url.split("?")[0],
    method: opts.method ?? "GET",
    org: "docs",
  } as unknown as RequestWithLogin;
}

function makeDbManager(access: Role = "owners"): HomeDBDocAuth {
  return {
    getDocAuthCached: async () => ({
      docId: DOC_ID,
      access,
      removed: false,
      disabled: false,
      cachedDoc: { id: DOC_ID } as Document,
      readOnlyReason: null,
    }),
    getAnonymousUserId: () => 1,
  };
}

function makeToken(route?: AccessTokenInfo["route"], readOnly: boolean = true): AccessTokenInfo {
  return { userId: chimpy.id, docId: DOC_ID, readOnly, route };
}

function makeCredential(route?: AccessTokenInfo["route"], readOnly: boolean = true) {
  const token = makeToken(route, readOnly);
  return { token, credential: new AccessTokenCredential(chimpy, token) };
}

function docAuth(credential: AccessTokenCredential, req: RequestWithLogin, access?: Role) {
  return credential.docAuth(req, makeDbManager(access), DOC_ID);
}

/**
 * Asserts that a call refuses the request with the given status and message.
 * The status varies: a missing route context is a 401, a route mismatch is a 403.
 */
function assertRefused(fn: () => void | Promise<unknown>, status: number, pattern: RegExp) {
  return (async () => {
    try {
      await fn();
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.status, status, `expected ${status}, got ${err.status}: ${err.message}`);
      assert.match(err.message, pattern);
    }
  })();
}

function assertRouteRefused(token: AccessTokenInfo, req: RequestWithLogin, pattern: RegExp, status = 403) {
  return assertRefused(() => assertAccessTokenMatchesReqRoute(token, req), status, pattern);
}

describe("AccessTokenCredential", function() {
  describe("constructor", function() {
    it("refuses a token carrying OAuth restrictions", function() {
      const token: AccessTokenInfo = { ...makeToken(), oauth: { orgId: 1, scopes: ["doc:read"] } };
      assert.throws(() => new AccessTokenCredential(chimpy, token), /OAuth restrictions/);
    });
  });

  describe("route pinning", function() {
    it("skips all route checks when the token has no route", async function() {
      // Any path, any method, any query params are accepted.
      assertAccessTokenMatchesReqRoute(makeToken(undefined), makeReq());

      // The role cap still applies: readOnly is capped at viewers, otherwise the database's role wins.
      const tok = makeCredential(undefined);
      const result = await docAuth(tok.credential, makeReq());
      assert.equal(result.docId, DOC_ID);
      assert.equal(result.access, "viewers", "readOnly token is capped at viewers");

      const rw = makeCredential(undefined, false);
      assert.equal((await docAuth(rw.credential, makeReq())).access, "owners");
    });

    it("requires the path to match, tolerating a trailing slash on either side", async function() {
      const token = makeToken({ path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET" });
      assertAccessTokenMatchesReqRoute(token, makeReq());

      await assertRouteRefused(token, makeReq({
        url: "/api/docs/doc1/download/xlsx?tableId=Table1",
      }), /path does not match/);

      // Pinned without a trailing slash, requested with one.
      assertAccessTokenMatchesReqRoute(token, makeReq({
        url: `${PINNED_PATH}/?tableId=Table1`, path: `${PINNED_PATH}/`,
      }));

      // Pinned with a trailing slash, requested without one.
      const slashed = makeToken({ path: `${PINNED_PATH}/`, queryParams: [["tableId", "Table1"]], method: "GET" });
      assertAccessTokenMatchesReqRoute(slashed, makeReq());
    });

    it("reconstructs the path from baseUrl + path for router-mounted requests", async function() {
      const token = makeToken({ path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET" });

      // Doc-worker shape: the whole path is in req.path.
      assertAccessTokenMatchesReqRoute(token, makeReq({ baseUrl: "", path: PINNED_PATH }));

      // Home-server shape: split across baseUrl and path.
      assertAccessTokenMatchesReqRoute(token, makeReq({
        baseUrl: "/api/docs/doc1", path: "/download/csv",
      }));

      // A mismatch in the baseUrl half is still caught.
      await assertRouteRefused(token, makeReq({
        baseUrl: "/api/docs/other", path: "/download/csv",
      }), /path does not match/);
    });

    it("refuses a pinned token on a request with no express routing context", async function() {
      // A raw IncomingMessage (e.g. from the WebSocket upgrade handler) has no baseUrl/path,
      // so the request's route can't be determined and a pinned token must be refused.
      const bareReq = {
        url: `${PINNED_PATH}?tableId=Table1`,
        method: "GET",
        org: "docs",
      } as unknown as RequestWithLogin;

      const token = makeToken({ path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET" });
      await assertRefused(() => assertAccessTokenMatchesReqRoute(token, bareReq),
        401, /Token not valid for this request/);

      // The express check is a duck-type: "baseUrl" in req && "path" in req. Anything carrying both
      // is treated as an express request, and stands or falls on its route matching.
      const ducked = { ...bareReq, baseUrl: "", path: PINNED_PATH } as unknown as RequestWithLogin;
      assertAccessTokenMatchesReqRoute(token, ducked);
      await assertRouteRefused(token, {
        ...ducked, baseUrl: "/api/docs/other", path: "/download/csv",
      } as unknown as RequestWithLogin, /path does not match/);

      // An unpinned token is unaffected - it never consults the request's route.
      assertAccessTokenMatchesReqRoute(makeToken(undefined), bareReq);
    });

    it("enforces the pinned method, ignoring case", async function() {
      const pinned = makeToken({
        path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET",
      });
      assertAccessTokenMatchesReqRoute(pinned, makeReq({ method: "GET" }));
      // Request method in any case matches.
      assertAccessTokenMatchesReqRoute(pinned, makeReq({ method: "get" }));
      await assertRouteRefused(pinned, makeReq({ method: "POST" }), /method does not match/);
    });

    it("compares query params exactly, in order, ignoring auth", async function() {
      const token = makeToken({ path: PINNED_PATH, queryParams: [["a", "1"], ["b", "2"]], method: "GET" });
      assertAccessTokenMatchesReqRoute(token, makeReq({ url: `${PINNED_PATH}?a=1&b=2` }));
      // Reordered in the URL: refused, the pinned order is part of the match.
      await assertRouteRefused(token, makeReq({
        url: `${PINNED_PATH}?b=2&a=1`,
      }), /query parameters do not match/);
      // The auth param itself is never part of the comparison.
      assertAccessTokenMatchesReqRoute(token, makeReq({ url: `${PINNED_PATH}?a=1&auth=tok&b=2` }));

      // Empty pin matches a request with no params (beyond auth).
      const empty = makeToken({ path: PINNED_PATH, queryParams: [], method: "GET" });
      assertAccessTokenMatchesReqRoute(empty, makeReq({ url: PINNED_PATH }));
      assertAccessTokenMatchesReqRoute(empty, makeReq({ url: `${PINNED_PATH}?auth=tok` }));
      await assertRouteRefused(empty, makeReq({ url: `${PINNED_PATH}?a=1` }),
        /query parameters do not match/);
    });

    it("refuses altered, extra, missing, and mismatched duplicate query params", async function() {
      const token = makeToken({ path: PINNED_PATH, queryParams: [["a", "1"], ["b", "2"]], method: "GET" });
      const cases = [
        `${PINNED_PATH}?a=1&b=9`,        // value changed
        `${PINNED_PATH}?a=1&c=2`,        // key changed
        `${PINNED_PATH}?a=1&b=2&c=3`,    // extra param
        `${PINNED_PATH}?a=1`,            // missing param
        PINNED_PATH,                     // all params dropped
      ];
      for (const url of cases) {
        await assertRouteRefused(token, makeReq({ url }), /query parameters do not match/);
      }

      // Repeated keys are matched pair by pair, in the pinned order.
      const dup = makeToken({ path: PINNED_PATH, queryParams: [["a", "1"], ["a", "2"]], method: "GET" });
      assertAccessTokenMatchesReqRoute(dup, makeReq({ url: `${PINNED_PATH}?a=1&a=2` }));
      // Same values, swapped order: refused, order is significant.
      await assertRouteRefused(dup, makeReq({
        url: `${PINNED_PATH}?a=2&a=1`,
      }), /query parameters do not match/);
    });

    it("docAuth re-checks the route defensively", async function() {
      // docAuth calls the same check again, so a mismatched request is refused there too.
      const tok = makeCredential({ path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET" });
      assert.equal((await docAuth(tok.credential, makeReq())).docId, DOC_ID);
      await assertRefused(() => docAuth(tok.credential, makeReq({
        url: "/api/docs/doc1/download/xlsx?tableId=Table1",
      })), 403, /path does not match/);
    });

    it("still refuses a token minted for another document", async function() {
      const tok = makeCredential({ path: PINNED_PATH, queryParams: [["tableId", "Table1"]], method: "GET" });
      const otherDoc: HomeDBDocAuth = {
        getDocAuthCached: async () => ({
          docId: "other", access: "owners", removed: false, disabled: false,
          cachedDoc: { id: "other" } as Document, readOnlyReason: null,
        }),
        getAnonymousUserId: () => 1,
      };
      await assertRefused(() => tok.credential.docAuth(makeReq(), otherDoc, "other"),
        403, /Document access denied/);
    });
  });
});
