import { getCanAnyoneCreateOrgs, getPersonalOrgsEnabled } from "app/server/lib/gristSettings";
import { TestServer } from "test/gen-server/apiUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import fetch from "node-fetch";

/**
 * Exercises the root-path ("/") redirect performed by FlexServer._redirectToOrg, and the
 * follow-on routing done by _redirectToHomeOrWelcomePage at /welcome/start.
 *
 * The key scenario: when personal orgs are disabled (GRIST_PERSONAL_ORGS=false), visitors must NOT
 * be sent to the personal/merged org (/o/docs), which would render a "Personal orgs are
 * disabled" error. Instead they go through /welcome/start, which forces login when unauthenticated
 * and routes signed-in users to a team site or /welcome/teams.
 */
describe("RedirectToOrg", function() {
  testUtils.setTmpLogLevel("error");

  // node-fetch with redirect: "manual" exposes the 3xx status and Location header without following.
  async function getRedirect(url: string, cookie?: string) {
    const resp = await fetch(url, {
      redirect: "manual",
      headers: cookie ? { Cookie: cookie } : {},
    });
    return { status: resp.status, location: resp.headers.get("location") || "" };
  }

  // Establish a logged-in session for the given user, and return its Cookie header.
  async function cookieFor(server: TestServer, email: string, name: string, org: string = "docs") {
    const login = await server.getCookieLogin(org, { email, name });
    return login.headers.Cookie;
  }

  const setupTestServer = (env: Record<string, string>) => {
    let serverUrl: string;
    let oldEnv: testUtils.EnvironmentSnapshot;
    let server: TestServer;

    beforeEach(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      Object.assign(process.env, env);
      // These settings are memoized; clear the caches so the new env values take effect.
      getPersonalOrgsEnabled.cache.clear();
      getCanAnyoneCreateOrgs.cache.clear();
      server = new TestServer(this);
      serverUrl = await server.start();
    });

    afterEach(async function() {
      oldEnv.restore();
      getPersonalOrgsEnabled.cache.clear();
      getCanAnyoneCreateOrgs.cache.clear();
      await server.stop();
    });

    return {
      url: () => serverUrl,
      server: () => server,
    };
  };

  describe("with personal orgs disabled (org-in-path)", function() {
    const ctx = setupTestServer({ GRIST_PERSONAL_ORGS: "false", GRIST_ORG_IN_PATH: "true" });

    it("redirects anonymous / to /welcome/start (not the disabled personal org)", async function() {
      const { status, location } = await getRedirect(`${ctx.url()}/`);
      assert.equal(status, 302);
      assert.match(location, /\/welcome\/start$/);
      assert.notInclude(location, "/o/docs");
    });

    it("redirects signed-in / to /welcome/start", async function() {
      const cookie = await cookieFor(ctx.server(), "chimpy@getgrist.com", "Chimpy");
      const { status, location } = await getRedirect(`${ctx.url()}/`, cookie);
      assert.equal(status, 302);
      assert.match(location, /\/welcome\/start$/);
      assert.notInclude(location, "/o/docs");
    });

    it("routes a signed-in user with no team site from /welcome/start to /welcome/teams " +
      "(no loop back to /)", async function() {
      // Ham only owns a personal org. Without the fix, the fallback would send Ham to the disabled
      // personal org, which redirects back to "/" and loops.
      const cookie = await cookieFor(ctx.server(), "ham@getgrist.com", "Ham");
      const { status, location } = await getRedirect(`${ctx.url()}/welcome/start`, cookie);
      assert.equal(status, 302);
      assert.match(location, /\/welcome\/teams$/);
      assert.notInclude(location, "/o/docs");
    });
  });

  describe("with personal orgs enabled (org-in-path)", function() {
    const ctx = setupTestServer({ GRIST_PERSONAL_ORGS: "true", GRIST_ORG_IN_PATH: "true" });

    it("still redirects anonymous / to the merged org", async function() {
      const { status, location } = await getRedirect(`${ctx.url()}/`);
      assert.equal(status, 302);
      assert.match(location, /\/o\/docs\//);
      assert.notInclude(location, "/welcome/start");
    });
  });

  describe("single-org mode with personal orgs disabled", function() {
    const ctx = setupTestServer({ GRIST_SINGLE_ORG: "nasa", GRIST_PERSONAL_ORGS: "false" });

    it("does not reroute / to /welcome/start (single org is pinned)", async function() {
      const cookie = await cookieFor(ctx.server(), "chimpy@getgrist.com", "Chimpy", "nasa");
      const { status, location } = await getRedirect(`${ctx.url()}/`, cookie);
      assert.equal(status, 200);
      assert.notInclude(location, "/welcome/start");
    });
  });
});
