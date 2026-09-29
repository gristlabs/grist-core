import { Organization } from "app/common/UserAPI";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser, setPlan } from "test/gen-server/testUtils";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";

describe("suspension", function() {
  this.timeout(10000);
  let home: TestServer;
  let nasa: Organization;
  let originalPlan: string;
  testUtils.setTmpLogLevel("error");

  // Flush the cache, or the change is not seen for a few seconds.
  async function suspend() {
    await setPlan(home.dbManager, nasa, "suspended");
    home.dbManager.flushDocAuthCache();
  }

  before(async function() {
    const tmpDir = await createTmpDir();
    home = new TestServer(this);
    await home.start(["home", "docs"], { dataDir: tmpDir });
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    nasa = await nasaApi.getOrg("current");
    originalPlan = nasa.billingAccount!.product.name;
  });

  after(async function() {
    await home.stop();
  });

  // Each test suspends the site, so put back the plan it came with.
  afterEach(async function() {
    await setPlan(home.dbManager, nasa, originalPlan);
    home.dbManager.flushDocAuthCache();
  });

  it("refuses edits without changing the user's role", async function() {
    // Open nasa as chimpy (an owner)
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    // Set up Jupiter document to have some content
    const docId = await home.dbManager.testGetId("Jupiter") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
    assert.equal((await nasaApi.getDoc(docId)).access, "owners");

    // Confirm that user can edit docs
    const docApi = nasaApi.getDocAPI(docId);
    await assert.isFulfilled(docApi.getRows("Table1"));
    await assert.isFulfilled(docApi.updateRows("Table1", { id: [1], A: ["v1"] }));
    await assert.isFulfilled(docApi.addRows("Table1", { A: ["v1"] }));

    await suspend();

    // The user stays an owner, and is told why edits are refused.
    const doc = await nasaApi.getDoc(docId);
    assert.equal(doc.access, "owners");
    assert.equal(doc.readOnlyReason, "suspended");

    await assert.isFulfilled(docApi.getRows("Table1"));
    await assert.isRejected(docApi.updateRows("Table1", { id: [1], A: ["v1"] }), /No write access/);
    await assert.isRejected(docApi.addRows("Table1", { A: ["v1"] }), /No write access/);
    await assert.isFulfilled(docApi.download());
  });

  it("leaves owner-gated access rules working", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docId = await home.dbManager.testGetId("Pluto") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
    const docApi = nasaApi.getDocAPI(docId);

    // The shape that used to lock owners out.
    await docApi.applyUserActions([
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "none",
      }],
    ]);

    await suspend();

    assert.equal((await nasaApi.getDoc(docId)).access, "owners");

    // Still an owner, so their own rules still match.
    assert.isNotEmpty((await docApi.getRows("Table1")).id);
    assert.isNotEmpty((await docApi.sql("select * from Table1")).records);
    await assert.isFulfilled(docApi.download());

    // Edits are refused, to the data and to the rules alike.
    await assert.isRejected(docApi.updateRows("Table1", { id: [1], A: ["v1"] }), /No write access/);
    await assert.isRejected(docApi.applyUserActions([
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
    ]), /No write access/);

    // Whole-document operations are refused too. Reading around the document is not.
    await assert.isRejected(docApi.removeSnapshots("unlisted"), /read-only/);
    await assert.isFulfilled(docApi.getSnapshots());
    await assert.isFulfilled(docApi.getStates());

    await assert.isRejected(docApi.recover(true), /No write access/);
  });

  it("refuses edits to a document already in recovery mode", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docId = await home.dbManager.testGetId("Curiosity") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
    const docApi = nasaApi.getDocAPI(docId);

    // canApplyBundle skips rule checks in recovery mode, so the refusal must not rely on it.
    // Recovery mode cannot be entered once the site is read-only, so enter it first.
    await docApi.recover(true);
    await suspend();

    assert.isNotEmpty((await docApi.getRows("Table1")).id);
    await assert.isRejected(docApi.updateRows("Table1", { id: [1], A: ["v1"] }), /No write access/);
  });

  it("refuses to fork a read-only document", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docId = await home.dbManager.testGetId("Apathy") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
    const docApi = nasaApi.getDocAPI(docId);

    await assert.isFulfilled(docApi.fork());

    await suspend();

    // Forking copies the document, which is a write like any other.
    await assert.isRejected(docApi.fork());
  });

  it("leaves an editor reading as an editor", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docId = await home.dbManager.testGetId("Beyond") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
    await nasaApi.updateDocPermissions(docId, {
      users: { "charon@getgrist.com": "editors" },
    });

    await nasaApi.getDocAPI(docId).applyUserActions([
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access in [OWNER, EDITOR]", permissionsText: "all",
      }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "", permissionsText: "none",
      }],
    ]);

    const charonApi = await home.createHomeApi("Charon", "nasa");
    const charonDocApi = charonApi.getDocAPI(docId);
    assert.isNotEmpty((await charonDocApi.getRows("Table1")).id);

    await suspend();

    // Still an editor, so the rules still show them their data. Only edits are refused.
    assert.equal((await charonApi.getDoc(docId)).access, "editors");
    assert.isNotEmpty((await charonDocApi.getRows("Table1")).id);
    await assert.isRejected(
      charonDocApi.updateRows("Table1", { id: [1], A: ["v1"] }), /No write access/);
  });

  it("refuses owner-only writes that skip checkUserActions", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const wsId = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    const docId = await nasaApi.newDoc({ name: "Attachy" }, wsId);
    const docApi = nasaApi.getDocAPI(docId);
    const removeUnusedAttachments = () => axios.post(
      `${home.serverUrl}/api/docs/${docId}/attachments/removeUnused`, {}, configForUser("Chimpy"));
    const clearWebhookQueue = () => axios.delete(
      `${home.serverUrl}/api/docs/${docId}/webhooks/queue`, configForUser("Chimpy"));

    await assert.isFulfilled(docApi.transferAllAttachments());
    assert.equal((await removeUnusedAttachments()).status, 200);
    assert.equal((await clearWebhookQueue()).status, 200);

    await suspend();

    // These are owner-only, so they pass the role check, and are refused only because the
    // document is held read-only.
    await assert.isRejected(docApi.transferAllAttachments(), /read-only/);
    const removal = await removeUnusedAttachments();
    assert.equal(removal.status, 403);
    assert.match(removal.data.error, /read-only/);
    const queue = await clearWebhookQueue();
    assert.equal(queue.status, 403);
    assert.match(queue.data.error, /read-only/);
  });

  it("leaves operations that change nothing working", async function() {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const wsId = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    const docId = await nasaApi.newDoc({ name: "Flushy" }, wsId);
    const post = (endpoint: string) => axios.post(
      `${home.serverUrl}/api/docs/${docId}/${endpoint}`, {}, configForUser("Chimpy"));

    await suspend();

    // These need edit access, but leave the document as it was.
    assert.equal((await post("flush")).status, 200);
    assert.equal((await post("force-reload")).status, 200);
  });

  it("deletes a read-only site", async function() {
    // A site is deleted by deleting its documents with a permit, which must not be refused.
    const docsApi = await home.createHomeApi("chimpy", "docs", true);
    await docsApi.newOrg({ name: "Doomed", domain: "doomed" });
    const doomedApi = await home.createHomeApi("chimpy", "doomed", true);
    const doomed = await doomedApi.getOrg("current");
    const wsId = await doomedApi.newWorkspace({ name: "ws" }, "current");
    const docId = await doomedApi.newDoc({ name: "doc" }, wsId);

    await setPlan(home.dbManager, doomed, "suspended");
    home.dbManager.flushDocAuthCache();

    // The site is read-only: the owner can neither edit the document nor delete it themselves.
    assert.equal((await doomedApi.getDoc(docId)).readOnlyReason, "suspended");
    await assert.isRejected(
      doomedApi.getDocAPI(docId).addRows("Table1", { A: ["v1"] }), /No write access/);
    await assert.isRejected(doomedApi.deleteDoc(docId), /read-only/);

    // Deleting the site still works, documents and all.
    await assert.isFulfilled(doomedApi.deleteOrg(doomed.id));
    await assert.isRejected(doomedApi.getOrg(doomed.id));
  });
});
