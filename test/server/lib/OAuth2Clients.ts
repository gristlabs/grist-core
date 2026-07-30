import { GristServer } from "app/server/lib/GristServer";
import { OAuth2Clients } from "app/server/lib/OAuth2Clients";
import { serveSomething, Serving } from "test/server/customUtil";

import { assert } from "chai";
import fetch from "node-fetch";

/**
 * Tests the server-side support for Grist acting as an OAuth2 client of a third-party service
 * (e.g. of Airtable). Its authorize/callback endpoints finish by serving a tiny HTML page that
 * posts the result back to the window that opened the popup, then closes itself. These tests
 * exercise that end-of-flow page; the rest of the flow is covered by integration tests elsewhere.
 */
describe("OAuth2Clients", function() {
  let serving: Serving;

  // The end-of-flow page is served whenever the flow can't proceed past the opener-origin check; an
  // unauthenticated request is the simplest such case and needs no configured integration.
  async function getEndFlowPage(opts: {
    openerOrigin: string,
    integratorId?: string,
    isAuthorized?: boolean,
  }): Promise<string> {
    const integratorId = opts.integratorId ?? "airtable";
    const encOrigin = encodeURIComponent(opts.openerOrigin);
    const url = `${serving.url}/oauth2/${integratorId}/authorize?openerOrigin=${encOrigin}`;
    const headers = opts.isAuthorized ? { "test-authorized": "1" } : undefined;
    const resp = await fetch(url, { headers });
    assert.match(resp.headers.get("content-type") || "", /text\/html/);
    return resp.text();
  }

  before(async function() {
    const gristServer = { getSessions: () => ({}) } as unknown as GristServer;
    const oauth2 = new OAuth2Clients(gristServer);
    serving = await serveSomething(app => oauth2.attachEndpoints(app, [(req, _res, next) => {
      // Let a test opt into being authorized, to reach handler code past the auth check.
      if (req.headers["test-authorized"]) { Object.assign(req, { userId: 1, userIsAuthorized: true }); }
      next();
    }]));
  });

  after(async function() {
    await serving.shutdown();
  });

  it("reports the outcome to the opener and closes the popup", async function() {
    const page = await getEndFlowPage({ openerOrigin: serving.url });
    const postMessageArgs = page.match(/opener.postMessage\(.*\);/)?.[0];
    // Check that the postMessage code inserted in the page is as expected. Note that we are not
    // authenticated, so we expect a "user not known" outcome.
    const originStr = JSON.stringify(serving.url);
    assert.equal(postMessageArgs, `opener.postMessage({"error":"user not known"}, ${originStr});`);
  });

  it("reduces the opener origin to its origin, dropping anything more", async function() {
    // The opener origin only matters as a postMessage target (matched by scheme/host/port), so any
    // extra path/query/fragment is dropped rather than carried into the page.
    const page = await getEndFlowPage({ openerOrigin: `${serving.url}/extra/</script>?q=1#frag` });

    const postMessageArgs = page.match(/opener.postMessage\(.*\);/)?.[0];
    // Check that the postMessage code inserted in the page is as expected. Note that we are not
    // authenticated, so we expect a "user not known" outcome.
    // Note that extra material from the URL isn't present at all.
    const originStr = JSON.stringify(serving.url);
    assert.equal(postMessageArgs, `opener.postMessage({"error":"user not known"}, ${originStr});`);
  });

  it("escapes payloads correctly", async function() {
    // Reach the "Unknown integration <id>" error -- which echoes the id into the page -- by
    // authorizing the request. The id carries a "</script>" (to exercise script-context escaping)
    // and a "$'" (to confirm the payload can't hijack the template substitution).
    const badId = "</script><script>x</script>$'<img src=x onerror=alert(1)>";
    const integratorId = encodeURIComponent(badId);
    const page = await getEndFlowPage({ openerOrigin: serving.url, integratorId, isAuthorized: true });
    // The message reached the page, but the only literal </script> is the template's own -- the
    // injected markup is escaped, not active.
    assert.include(page, "Unknown integration");
    assert.lengthOf(page.match(/<\/script>/g) || [], 1);

    const [payloadText, originText] = page.match(/opener.postMessage\((.*), (".*")\);/)!.slice(1);
    assert.deepEqual(JSON.parse(originText), serving.url);
    assert.deepEqual(JSON.parse(payloadText), { error: `Unknown integration ${badId}` });
  });
});
