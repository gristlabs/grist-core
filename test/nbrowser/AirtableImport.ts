/**
 * Test Airtable imports, mocking the networking of Airtable's own APIs.
 *
 * This test starts a helper server used for a couple of purposes:
 * 1. It replaces Airtable's OAuth API endpoints, and we tell the node server to use those.
 * 2. It simulates Airtable's endpoint to fetch bases, and we tell the browser to use those.
 */
import { listenPromise } from "app/server/lib/serverUtils";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import http from "node:http";
import { AddressInfo } from "node:net";

import express from "express";
import { assert, driver } from "mocha-webdriver";

describe("AirtableImport", function() {
  this.timeout("20s");
  const cleanup = setupTestSuite();
  let oldEnv: testUtils.EnvironmentSnapshot;
  let mainSession: gu.Session;
  let docId: string;
  let testHelperServer: http.Server;
  let testHelperServerUrl: string;
  let cancelNextOAuthRequest: boolean = false;

  before(async function() {
    testHelperServer = await startTestHelperServer();
    const port = (testHelperServer.address() as AddressInfo).port;
    testHelperServerUrl = `http://localhost:${port}`;
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.OAUTH2_GRIST_HOST = server.getHost();
    process.env.OAUTH2_AIRTABLE_CLIENT_ID = "test-client";
    process.env.OAUTH2_AIRTABLE_CLIENT_SECRET = "test-secret";
    process.env.TEST_GRIST_OAUTH2_CLIENTS_OVERRIDES = JSON.stringify({
      airtable: {
        issuerMetadata: {
          authorization_endpoint: new URL("/authorize", testHelperServerUrl).href,
          token_endpoint: new URL("/token", testHelperServerUrl).href,
        },
      },
    });
    await server.restart(false);

    mainSession = await gu.session().teamSite.user("user1").login();
    docId = await mainSession.tempNewDoc(cleanup, "AirtableImport", { load: false });
  });

  after(async function() {
    if (!process.env.NO_CLEANUP) {
      oldEnv.restore();
      await server.restart(false);
      testHelperServer?.close();
      testHelperServer?.closeAllConnections();
    }
  });

  async function startTestHelperServer() {
    const app = express();
    app.use(express.urlencoded({ extended: false }));

    /**
     * Simulates an Airtable "authorize" endpoint, with a few checks that it's called as expected,
     * and returning a similar format to what Airtable OAuth returns.
     */
    app.get("/authorize", (req, res) => {
      try {
        assert.equal(req.query.response_type, "code", "invalid response_type");
        assert.isOk(req.query.client_id, "missing client_id");
        assert.isOk(req.query.redirect_uri, "missing redirect_uri");
        assert.isOk(req.query.state, "missing state");
        assert.isOk(req.query.code_challenge, "missing code_challenge");
        assert.equal(req.query.code_challenge_method, "S256", "invalid code_challenge_method");

        const location = new URL(req.query.redirect_uri as string);
        if (cancelNextOAuthRequest) {
          // If requested, simulate what Airtable returns when the user clicks "Cancel" on
          // the authorization screen.
          location.searchParams.set("error_description", "The user denied the request");
          location.searchParams.set("error", "access_denied");
          cancelNextOAuthRequest = false;
        } else {
          // Issue a deterministic authorization code.
          location.searchParams.set("code", "TEST_AUTH_CODE");
        }
        location.searchParams.set("state", req.query.state as string);
        res.setHeader("Location", location.href);
        return res.status(302).end();
      } catch (e) {
        return res.status(400).send(e.message);
      }
    });

    /**
     * Simulates an Airtable "token" endpoint, with a few checks that it's called as expected,
     * and returning a similar format to what Airtable OAuth returns.
     */
    app.post("/token", (req, res) => {
      const expectedBasic = "Basic " + Buffer.from("test-client:test-secret").toString("base64");
      try {
        assert.equal(req.header("authorization"), expectedBasic, "invalid_client");
        assert.equal(req.body.grant_type, "authorization_code", "unsupported_grant_type");
        assert.isOk(req.body.code && req.body.code_verifier, "invalid_request");

        // Opaque token (constant to keep tests deterministic)
        return res.status(200).json({
          access_token: "opaque-test-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    });

    function allowCors(res: express.Response) {
      res.header("Access-Control-Allow-Methods", "GET, PATCH, PUT, POST, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
      res.header("Access-Control-Allow-Origin", "*");
    }

    /**
     * Simulates an Airtable "fetch bases" endpoint. It's called from the browser, so we relax
     * CORS. That's something that I've manually checked is the case for Airtable's endpoints.
     */
    app.get("/meta/bases", (req, res) => {
      allowCors(res);
      if (req.headers.authorization !== "Bearer opaque-test-access-token") {
        // This is the shape of a realistic Airtable response.
        const msg = { error: { type: "AUTHENTICATION_REQUIRED", message: "Authentication required" } };
        return res.status(403).json(msg);
      }
      return res.status(200).json(airtableBasesFixture);
    });

    app.use("/", (req, res) => {
      allowCors(res);
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        console.warn(`NOT FOUND: ${req.originalUrl}`);
        res.status(404).send({ error: `not found: ${req.originalUrl}` });
      }
    });

    const helperServer = http.createServer(app);
    await listenPromise(helperServer.listen(0, "localhost"));
    return helperServer;
  }

  async function openAirtableDocImporter() {
    // Make Airtable API calls go to our helper server.
    await driver.executeScript((baseUrl: string) => {
      (window as any).testAirtableImportBaseUrlOverride = baseUrl;
    }, testHelperServerUrl);

    await driver.findWait(".test-dp-add-new", 2000).click();
    await driver.findContentWait(".test-dp-import-option", /Import from Airtable/i, 500).click();
    await driver.findWait(".test-modal-dialog", 2000);
  }

  async function waitForModalToClose() {
    await driver.wait(async () => !(await driver.find(".test-modal-dialog").isPresent()), 3000);
  }

  it("should go through oauth2 flow and fetch bases", async function() {
    await mainSession.loadDoc(`/doc/${docId}`);
    await driver.executeScript(() => { (window as any).setExperimentState("airtableImport", true); });
    await gu.reloadDoc();

    await openAirtableDocImporter();

    await driver.findWait(".test-import-airtable-connect:not(:disabled)", 2000).click();

    const bases = await driver.findWait(".test-import-airtable-bases", 2000);
    assert.deepEqual(await bases.findAll(".test-import-airtable-name", el => el.getText()),
      ["Product planning", "Sales CRM"]);
    assert.deepEqual(await bases.findAll(".test-import-airtable-id", el => el.getText()),
      ["appYovle0EAuu0OZE", "app04i02p1V0I1QvU"]);

    await driver.findContent(".test-modal-dialog button", /Cancel/).click();
    await waitForModalToClose();
  });

  it("should reuse access_token on repeat invocation", async function() {
    await gu.reloadDoc();
    await openAirtableDocImporter();
    const bases = await driver.findWait(".test-import-airtable-bases", 2000);
    assert.deepEqual(await bases.findAll(".test-import-airtable-name", el => el.getText()),
      ["Product planning", "Sales CRM"]);
    assert.deepEqual(await bases.findAll(".test-import-airtable-id", el => el.getText()),
      ["appYovle0EAuu0OZE", "app04i02p1V0I1QvU"]);

    await driver.findContent(".test-modal-dialog button", /Cancel/).click();
    await waitForModalToClose();
  });

  it("should allow disconnecting", async function() {
    await openAirtableDocImporter();
    await driver.findWait(".test-import-airtable-settings", 2000).click();
    await gu.findOpenMenuItem("li", /Disconnect/).click();
    await gu.waitForServer();

    // The "Connect" button should show up again.
    assert.equal(await driver.findWait(".test-import-airtable-connect", 2000).isPresent(), true);

    // Reload the page. We should see the connect button again.
    await gu.reloadDoc();
    await openAirtableDocImporter();
    assert.equal(await driver.findWait(".test-import-airtable-connect", 2000).isPresent(), true);
  });

  it("should show error if oauth2 is canceled", async function() {
    // Continue the previous test case: we already have the dialog open.
    cancelNextOAuthRequest = true;
    await driver.findWait(".test-import-airtable-connect:not(:disabled)", 2000).click();
    assert.equal(await driver.findWait(".test-import-airtable-error", 2000).getText(),
      "access_denied (The user denied the request)");   // This is not a very friendly error.

    // Try again; this time, the request should succeed, and error should disappear.
    cancelNextOAuthRequest = false;
    await driver.findWait(".test-import-airtable-connect:not(:disabled)", 2000).click();
    await gu.waitToPass(async () => {
      assert.equal(await driver.find(".test-import-airtable-error").isPresent(), false);
    });

    await driver.findContentWait(".test-modal-dialog button", /Cancel/, 500).click();
    await waitForModalToClose();
  });
});

// Sample response to GET https://api.airtable.com/v0/meta/bases
const airtableBasesFixture = {
  bases: [{
    id: "appYovle0EAuu0OZE",
    name: "Product planning",
    permissionLevel: "create",
  }, {
    id: "app04i02p1V0I1QvU",
    name: "Sales CRM",
    permissionLevel: "create",
  }],
};
