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
import { assert, driver, Key } from "mocha-webdriver";

describe("AirtableImport", function() {
  this.timeout("20s");
  const cleanup = setupTestSuite();
  let oldEnv: testUtils.EnvironmentSnapshot;
  let mainSession: gu.Session;
  let otherSession: gu.Session;
  let docId: string;
  let otherDocId: string;
  let testHelperServer: http.Server;
  let testHelperServerUrl: string;
  let cancelNextOAuthRequest: boolean = false;

  before(async function() {
    testHelperServer = await startTestHelperServer();
    const port = (testHelperServer.address() as AddressInfo).port;
    testHelperServerUrl = `http://localhost:${port}`;
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_LOGIN = "1";
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
      res.header("Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Requested-With, X-Airtable-User-Agent");
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

    /**
     * Simulates an Airtable "get base schema" endpoint.
     */
    app.get("/v0/meta/bases/:baseId/tables", (req, res) => {
      allowCors(res);
      if (req.headers.authorization !== "Bearer opaque-test-access-token") {
        const msg = { error: { type: "AUTHENTICATION_REQUIRED", message: "Authentication required" } };
        return res.status(403).json(msg);
      }
      const { baseId } = req.params;
      const baseSchema = airtableBaseSchemaFixture[baseId as keyof typeof airtableBaseSchemaFixture];
      if (!baseSchema) {
        return res.status(404).json({ error: { type: "NOT_FOUND", message: "Base not found" } });
      }
      return res.status(200).json(baseSchema);
    });

    /**
     * Simulates an Airtable "list records" endpoint.
     */
    app.get("/v0/:baseId/:tableId", (req, res) => {
      allowCors(res);
      if (req.headers.authorization !== "Bearer opaque-test-access-token") {
        const msg = { error: { type: "AUTHENTICATION_REQUIRED", message: "Authentication required" } };
        return res.status(403).json(msg);
      }
      const { tableId } = req.params;
      const records = airtableListRecordsFixture[tableId as keyof typeof airtableListRecordsFixture];
      if (!records) {
        return res.status(404).json({ error: { type: "NOT_FOUND", message: "Table not found" } });
      }
      return res.status(200).json(records);
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

  async function openAirtableDocImporter(context: "home" | "doc" = "doc") {
    // Make Airtable API calls go to our helper server.
    await driver.executeScript((baseUrl: string) => {
      (window as any).testAirtableImportBaseUrlOverride = baseUrl;
    }, testHelperServerUrl);

    const prefix = context === "home" ? "dm" : "dp";
    await driver.findWait(`.test-${prefix}-add-new`, 2000).click();
    if (context === "home") {
      await driver.findWait(".test-dm-import-from-airtable", 500).click();
    } else {
      await driver.findContentWait(".test-dp-import-option", /Import from Airtable/i, 500).click();
    }
    await driver.findWait(".test-modal-dialog", 2000);
  }

  async function waitForModalToClose() {
    await driver.wait(async () => !(await driver.find(".test-modal-dialog").isPresent()), 3000);
  }

  describe("when anonymous", function() {
    before(async function() {
      mainSession = await gu.session().anon.login();
      await mainSession.loadDocMenu("/");
      await driver.find(".test-intro-create-doc").click();
      await gu.waitForDocToLoad();
      await gu.dismissWelcomeTourIfNeeded();
    });

    it("should redirect to sign-in page", async function() {
      await gu.refreshDismiss({ ignore: true });
      await driver.findWait(".test-dp-add-new", 2000).click();
      await driver.findContentWait(".test-dp-import-option", /Import from Airtable/i, 500).click();

      await gu.checkLoginPage();

      await mainSession.loadDocMenu("/");
      await driver.findWait(".test-dm-add-new", 2000).click();
      await driver.findWait(".test-dm-import-from-airtable", 500).click();

      await gu.checkLoginPage();
    });
  });

  describe("when signed in", function() {
    before(async function() {
      mainSession = await gu.session().teamSite.user("user1").login();
      docId = await mainSession.tempNewDoc(cleanup, "AirtableImport", { load: false });
    });

    it("should go through oauth2 flow and fetch bases", async function() {
      await mainSession.loadDoc(`/doc/${docId}`);

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

    it("should associate access_token with a user", async function() {
      otherSession = await gu.session().personalSite.user("user2").addLogin();
      otherDocId = await otherSession.tempNewDoc(cleanup, "AirtableImport2");

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

    it("should allow disconnecting", async function() {
      await mainSession.loadDoc(`/doc/${docId}`);
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

      // Check that the other session is still connected.
      await otherSession.loadDoc(`/doc/${otherDocId}`);
      await openAirtableDocImporter();
      const bases = await driver.findWait(".test-import-airtable-bases", 2000);
      assert.deepEqual(await bases.findAll(".test-import-airtable-name", el => el.getText()),
        ["Product planning", "Sales CRM"]);
      assert.deepEqual(await bases.findAll(".test-import-airtable-id", el => el.getText()),
        ["appYovle0EAuu0OZE", "app04i02p1V0I1QvU"]);

      await driver.findContent(".test-modal-dialog button", /Cancel/).click();
      await waitForModalToClose();
    });

    it("should show error if oauth2 is canceled", async function() {
      await mainSession.loadDoc(`/doc/${docId}`);
      await openAirtableDocImporter();
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

  it("should list all tables from the selected base", async function() {
    await gu.loadDocMenu("/");
    await openAirtableDocImporter("home");

    const bases = await driver.findWait(".test-import-airtable-bases", 2000);
    await bases.findContent(".test-import-airtable-name", "Product planning").click();
    await driver.find(".test-import-airtable-continue").click();

    await driver.findWait(".test-import-airtable-mappings", 2000).isDisplayed();
    assert.deepEqual(await driver.findAll(".test-import-airtable-table-name", el => el.getText()), [
      "Products",
      "Suppliers",
      "Orders",
    ]);
  });

  it("should allow mapping Airtable tables to Grist tables", async function() {
    // Tables are imported as new tables by default.
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "New table",
      "New table",
      "New table",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 3 tables");

    // Import Products (tbl79ux7qppckp8hr) as a new table.
    await driver.find(".test-import-airtable-table-tbl79ux7qppckp8hr-destination").click();
    assert.deepEqual(await gu.findOpenMenuAllItems("li", el => el.getText()), [
      "New table",
      "New table: structure only",
      "Skip",
    ]);
    await gu.findOpenMenuItem("li", "New table").click();
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "New table",
      "New table",
      "New table",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 3 tables");

    // Import Suppliers (tblbyte2tg72cbhhf) as a new table without data.
    await driver.find(".test-import-airtable-table-tblbyte2tg72cbhhf-destination").click();
    assert.deepEqual(await gu.findOpenMenuAllItems("li", el => el.getText()), [
      "New table",
      "New table: structure only",
      "Skip",
    ]);
    await gu.findOpenMenuItem("li", "New table: structure only").click();
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "New table",
      "Structure only",
      "New table",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 3 tables");

    // Skip importing Orders (tblfyhS37Hst5Hvsf).
    await driver.find(".test-import-airtable-table-tblfyhS37Hst5Hvsf-destination").click();
    assert.deepEqual(await gu.findOpenMenuAllItems("li", el => el.getText()), [
      "New table",
      "New table: structure only",
      "Skip",
    ]);
    await gu.findOpenMenuItem("li", "Skip").click();
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "New table",
      "Structure only",
      "Skip",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 2 tables");
  });

  it("should import Airtable base to a new Grist document", async function() {
    await driver.find(".test-import-airtable-import").click();
    await waitForModalToClose();
    await gu.waitForDocToLoad();

    assert.equal(await driver.find(".test-bc-doc").value(), "Product planning");
    assert.deepEqual(await gu.getPageNames(), ["Products", "Suppliers"]);
    assert.deepEqual(await gu.getColumnNames(), [
      "Airtable Id",
      "Name",
      "Price",
      "Category",
      "Suppliers",
    ]);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0, 1, 2, 3, 4] }), [
      "reccaegwskzka7wi1", "Widget X", "99.99", "Electronics", "",
      "recigwb4bc7vq2fhd", "Gadget Y", "149.99", "Electronics", "",
      "", "", "", "", "",
    ]);

    await gu.getPageItem("Suppliers").click();
    assert.deepEqual(await gu.getColumnNames(), [
      "Airtable Id",
      "Name",
      "Email",
      "Phone",
    ]);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1], cols: [0, 1, 2, 3] }), [
      "", "", "", "",
    ]);
  });

  it("should import Airtable base to an existing Grist document", async function() {
    await gu.getPageItem("Products").click();
    await gu.sendKeys(await gu.selectAllKey(), Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm(true);
    await gu.waitForServer();

    await openAirtableDocImporter("doc");

    const bases = await driver.findWait(".test-import-airtable-bases", 2000);
    await bases.findContent(".test-import-airtable-name", "Product planning").click();
    await driver.find(".test-import-airtable-continue").click();
    await driver.findWait(".test-import-airtable-mappings", 2000).isDisplayed();

    // Import Products (tbl79ux7qppckp8hr) to the existing Products table.
    await driver.find(".test-import-airtable-table-tbl79ux7qppckp8hr-destination").click();
    assert.deepEqual(await gu.findOpenMenuAllItems("li", el => el.getText()), [
      "New table",
      "New table: structure only",
      "Skip",
      "Products",
      "Suppliers",
    ]);
    await gu.findOpenMenuItem("li", "Products").click();
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "Products",
      "New table",
      "New table",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 3 tables");

    // Import Suppliers (tblbyte2tg72cbhhf) as a new table without data.
    await driver.find(".test-import-airtable-table-tblbyte2tg72cbhhf-destination").click();
    assert.deepEqual(await gu.findOpenMenuAllItems("li", el => el.getText()), [
      "New table",
      "New table: structure only",
      "Skip",
      "Products",
      "Suppliers",
    ]);
    await gu.findOpenMenuItem("li", "Suppliers").click();
    assert.deepEqual(await driver.findAll(".test-import-airtable-destination-label", el => el.getText()), [
      "Products",
      "Suppliers",
      "New table",
    ]);
    assert.equal(await driver.find(".test-import-airtable-import").getText(), "Import 3 tables");

    await driver.find(".test-import-airtable-import").click();
    await waitForModalToClose();

    assert.deepEqual(await gu.getPageNames(), ["Products", "Suppliers", "Orders"]);
    assert.deepEqual(await gu.getColumnNames(), [
      "Airtable Id",
      "Name",
      "Price",
      "Category",
      "Suppliers",
    ]);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0, 1, 2, 3, 4] }), [
      "reccaegwskzka7wi1", "Widget X", "99.99", "Electronics", "Suppliers[1]",
      "recigwb4bc7vq2fhd", "Gadget Y", "149.99", "Electronics", "Suppliers[2]",
      "", "", "", "", "",
    ]);

    await gu.getPageItem("Suppliers").click();
    assert.deepEqual(await gu.getColumnNames(), [
      "Airtable Id",
      "Name",
      "Email",
      "Phone",
    ]);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0, 1, 2, 3] }), [
      "recoa4mwyeytxu3fb", "Wow Widgets", "wowwidgets@example.com", "(123) 456-7890",
      "recw7cwwskv1q5jck", "Grand Gadgets", "grandgadgets@example.com", "(111) 222-3333",
      "", "", "", "",
    ]);

    await gu.getPageItem("Orders").click();
    assert.deepEqual(await gu.getColumnNames(), [
      "Airtable Id",
      "Order Number",
      "Order Date",
      "Products",
      "Total Amount",
    ]);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0, 1, 2, 3, 4] }), [
      "recjngmiw6qy39v53", "ord5q3rxaa95gyvrw", "01/05/2023", "Products[1]", "99.99",
      "recua5n4ir46dn5t6", "ordx37praxl2m95wj", "01/06/2023", "Products[1]\nProducts[2]", "249.98",
      "", "", "", "", "",
    ]);
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

// Sample response to GET https://api.airtable.com/v0/meta/bases/{baseId}/tables
const airtableBaseSchemaFixture = {
  appYovle0EAuu0OZE: {
    tables: [{
      id: "tbl79ux7qppckp8hr",
      name: "Products",
      primaryFieldId: "fldc2scnky16ae07t",
      fields: [
        {
          id: "fldc2scnky16ae07t",
          name: "Name",
          type: "singleLineText",
        },
        {
          id: "fldov4y3i2tojpq9e",
          name: "Price",
          type: "number",
        },
        {
          id: "fldh00nlbe0pbmh60",
          name: "Category",
          type: "singleLineText",
        },
        {
          id: "fldgdanj899r6y0ua",
          name: "Suppliers",
          type: "multipleRecordLinks",
          options: {
            linkedTableId: "tblbyte2tg72cbhhf",
          },
        },
      ],
    }, {
      id: "tblbyte2tg72cbhhf",
      name: "Suppliers",
      primaryFieldId: "fldh8fha8zrd88t3u",
      fields: [
        {
          id: "fldh8fha8zrd88t3u",
          name: "Name",
          type: "singleLineText",
        },
        {
          id: "fld43552lj107y510",
          name: "Email",
          type: "email",
        },
        {
          id: "fldo0m0ozf0k5aatm",
          name: "Phone",
          type: "phoneNumber",
        },
      ],
    }, {
      id: "tblfyhS37Hst5Hvsf",
      name: "Orders",
      primaryFieldId: "fldrk0qj3lm70na2f",
      fields: [
        {
          id: "fldrk0qj3lm70na2f",
          name: "Order Number",
          type: "singleLineText",
        },
        {
          id: "fldctmhnpzgf98ly5",
          name: "Order Date",
          type: "date",
        },
        {
          id: "fldjpzq93zncwwx2z",
          name: "Products",
          type: "multipleRecordLinks",
          options: {
            linkedTableId: "tbl79ux7qppckp8hr",
          },
        },
        {
          id: "fld5bepfz6vjdjnvq",
          name: "Total Amount",
          type: "number",
        },
      ],
    }],
  },
};

// Sample response to GET https://api.airtable.com/v0/{baseId}/{tableIdOrName}
const airtableListRecordsFixture = {
  tbl79ux7qppckp8hr: {
    records: [{
      id: "reccaegwskzka7wi1",
      fields: {
        Name: "Widget X",
        Price: 99.99,
        Category: "Electronics",
        Suppliers: ["recoa4mwyeytxu3fb"],
      },
      createdTime: "2023-01-01T00:00:00.000Z",
    }, {
      id: "recigwb4bc7vq2fhd",
      fields: {
        Name: "Gadget Y",
        Price: 149.99,
        Category: "Electronics",
        Suppliers: ["recw7cwwskv1q5jck"],
      },
      createdTime: "2023-01-02T00:00:00.000Z",
    }],
  },

  tblbyte2tg72cbhhf: {
    records: [{
      id: "recoa4mwyeytxu3fb",
      fields: {
        Name: "Wow Widgets",
        Email: "wowwidgets@example.com",
        Phone: "(123) 456-7890",
      },
      createdTime: "2023-01-01T00:00:00.000Z",
    }, {
      id: "recw7cwwskv1q5jck",
      fields: {
        Name: "Grand Gadgets",
        Email: "grandgadgets@example.com",
        Phone: "(111) 222-3333",
      },
      createdTime: "2023-01-02T00:00:00.000Z",
    }],
  },

  tblfyhS37Hst5Hvsf: {
    records: [{
      id: "recjngmiw6qy39v53",
      fields: {
        "Order Number": "ord5q3rxaa95gyvrw",
        "Order Date": "2023-01-05",
        "Products": ["reccaegwskzka7wi1"],
        "Total Amount": 99.99,
      },
      createdTime: "2023-01-05T10:00:00.000Z",
    }, {
      id: "recua5n4ir46dn5t6",
      fields: {
        "Order Number": "ordx37praxl2m95wj",
        "Order Date": "2023-01-06",
        "Products": ["reccaegwskzka7wi1", "recigwb4bc7vq2fhd"],
        "Total Amount": 249.98,
      },
      createdTime: "2023-01-06T11:00:00.000Z",
    }],
  },
};
