import { delay } from "app/common/delay";
import { UserAPI } from "app/common/UserAPI";
import { AccessTokenResult } from "app/plugin/GristAPI";
import { Deps as AccessTokensDeps } from "app/server/lib/AccessTokens";
import { TestServer } from "test/gen-server/apiUtils";
import { GristClient, openClient } from "test/server/gristClient";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import fetch from "node-fetch";
import { RequestInit } from "node-fetch";
import * as sinon from "sinon";

describe("AccessTokens", function() {
  this.timeout(10000);
  testUtils.withoutSandboxing();
  let home: TestServer;
  testUtils.setTmpLogLevel("error");
  let owner: UserAPI;
  let docId: string;
  let wsId: number;
  let cliOwner: GristClient;
  const sandbox = sinon.createSandbox();

  async function closeClient(cli: GristClient) {
    try {
      await cli.send("closeDoc", 0);
    } catch (e) {
      // Do not worry if socket is already closed by the other side.
      if (!String(e).match(/WebSocket is not open/)) { throw e; }
    }
    await cli.close();
  }

  before(async function() {
    home = new TestServer(this);
    await home.start(["home", "docs"]);
    const api = await home.createHomeApi("chimpy", "docs", true);
    await api.newOrg({ name: "testy", domain: "testy" });
    owner = await home.createHomeApi("chimpy", "testy", true);
    wsId = await owner.newWorkspace({ name: "ws" }, "current");
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        "kiwi@getgrist.com": "owners",
        "charon@getgrist.com": "editors",
      },
    });
  });

  after(async function() {
    const api = await home.createHomeApi("chimpy", "docs");
    await api.deleteOrg("testy");
    await home.stop();
  });

  afterEach(async function() {
    if (docId) {
      await closeClient(cliOwner);
      docId = "";
    }
    sandbox.restore();
  });

  async function freshDoc() {
    docId = await owner.newDoc({ name: "doc" }, wsId);
    const who = await owner.getSessionActive();
    cliOwner = await openClient(home.server, who.user.email, who.org?.domain || "docs");
    await cliOwner.openDocOnConnect(docId);
  }

  it("honors access tokens", async function() {
    await freshDoc();

    // Make tokens more short-lived for testing purposes.
    sandbox.stub(AccessTokensDeps, "TOKEN_TTL_MSECS").value(2000);

    // Check we can make a read only token for a document, and use it to read
    // but not write, and that it expires.
    let tokenResult: AccessTokenResult = (await cliOwner.send("getAccessToken", 0, { readOnly: true })).data;
    assert.equal(tokenResult.ttlMsecs, 2000);
    let token = tokenResult.token;
    const baseUrl: string = tokenResult.baseUrl;
    let result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ["records"]);
    const postOptions: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{}] }),
    };
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`, postOptions);
    // POST not allowed since read-only.
    assert.equal(result.status, 403);
    assert.match((await result.json()).error, /No write access/);
    await delay(3000);
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 401);
    assert.match((await result.json()).error, /Token has expired/);

    // Check we can make a token to write to a document.
    tokenResult = (await cliOwner.send("getAccessToken", 0, {})).data;
    token = tokenResult.token;
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ["records"]);
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`, postOptions);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ["records"]);

    // Check that tokens for one document do not work on another.
    const docId2 = await owner.newDoc({ name: "doc2" }, wsId);
    tokenResult = (await cliOwner.send("getAccessToken", 0, {})).data;
    token = tokenResult.token;
    result = await fetch(home.serverUrl + `/api/docs/${docId2}/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 403);
    result = await fetch(home.serverUrl + `/api/docs/${docId}/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
  });

  // These tests exercise how token-authenticated requests are treated and reported. Since
  // mreq.userId/fullUser is anonymous, it doesn't carry the right identity.
  describe("attribution and identity", function() {
    let editorApi: UserAPI;
    const trackedClients: GristClient[] = [];

    before(async function() {
      editorApi = await home.createHomeApi("charon", "testy", true);
    });

    afterEach(async function() {
      while (trackedClients.length) {
        await closeClient(trackedClients.pop()!);
      }
    });

    async function mintEditorToken(): Promise<AccessTokenResult> {
      const cli = await openClient(home.server, "charon@getgrist.com", "testy");
      trackedClients.push(cli);
      await cli.openDocOnConnect(docId);
      return (await cli.send("getAccessToken", 0, {})).data;
    }

    it("applies identity-based deny rules to access-token requests", async function() {
      await freshDoc();

      // Plant a secret value and a rule that denies *only* charon read on column A. Direct API
      // calls by charon respect the rule; token-authenticated calls should too.
      await owner.applyUserActions(docId, [
        ["AddRecord", "Table1", null, { A: "secret-1" }],
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "A" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1,
          aclFormula: "user.Email == 'charon@getgrist.com'",
          permissionsText: "-R",
        }],
      ]);

      const directJson = JSON.stringify(await editorApi.getDocAPI(docId).getRecords("Table1"));
      assert.notInclude(directJson, "secret-1",
        "direct API call by charon should not return column A");

      const tok = await mintEditorToken();
      const resp = await fetch(`${tok.baseUrl}/tables/Table1/records?auth=${tok.token}`);
      assert.equal(resp.status, 200);
      const tokenJson = JSON.stringify(await resp.json());
      assert.notInclude(tokenJson, "secret-1", "charon's token should not return column A");
    });

    it("attributes token-authenticated requests to the issuing user in auth logs", async function() {
      await freshDoc();
      const tok = await mintEditorToken();

      const authLogFor = (msgs: string[]) =>
        msgs.find(m => /Auth\[GET\].*\/tables\/Table1\/records/.test(m)) || "";

      // Sanity: direct authenticated call is attributed to charon.
      const directLogs = await testUtils.captureLog("debug", async () => {
        await editorApi.getDocAPI(docId).getRecords("Table1");
      });
      assert.include(authLogFor(directLogs), "email=charon@getgrist.com");

      // Token call: should also be attributed to charon (the issuer).
      const tokenLogs = await testUtils.captureLog("debug", async () => {
        const r = await fetch(`${tok.baseUrl}/tables/Table1/records?auth=${tok.token}`);
        assert.equal(r.status, 200);
      });
      assert.include(authLogFor(tokenLogs), "email=charon@getgrist.com");
    });

    it("attributes records added via token to the issuing user", async function() {
      await freshDoc();

      // Create a CreatedBy authorship column using `user.Name` formula.
      // (recalcWhen=DEFAULT, no recalcDeps).
      await owner.applyUserActions(docId, [
        ["AddColumn", "Table1", "CreatedBy", { type: "Text", isFormula: false, formula: "user.Name" }],
      ]);

      // Reference case: Charon adds a row over using a regular API call.
      await editorApi.getDocAPI(docId).addRows("Table1", { A: ["direct"] });

      // Charon adds a row using an access token.
      const tok = await mintEditorToken();
      const postResp = await fetch(`${tok.baseUrl}/tables/Table1/records?auth=${tok.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ fields: { A: "via-token" } }] }),
      });
      assert.equal(postResp.status, 200);

      const rows = await owner.getDocAPI(docId).getRecords("Table1");
      assert.deepEqual(rows.map(r => r.fields.A), ["direct", "via-token"]);
      assert.deepEqual(rows.map(r => r.fields.CreatedBy), ["Charon", "Charon"]);
    });
  });
});
