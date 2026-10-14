import { IOptions } from "app/common/BaseAPI";
import { Features } from "app/common/Features";
import { TelemetryEvent, TelemetryMetadataByLevel } from "app/common/Telemetry";
import { UserAPI, UserAPIImpl } from "app/common/UserAPI";
import { BillingAccount } from "app/gen-server/entity/BillingAccount";
import { Product } from "app/gen-server/entity/Product";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { Telemetry } from "app/server/lib/Telemetry";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser, createUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import range from "lodash/range";
import fetch from "node-fetch";
import * as sinon from "sinon";

/**
 * Tests the telemetry a document emits about its data limits: a limitStatusChanged event each
 * time the limit status changes while the doc is open, and the limit-related fields of the
 * documentUsage event. The events are captured at the Telemetry entry point of a real server.
 */
describe("limitTelemetry", function() {
  let home: TestServer;
  let dbManager: HomeDBManager;
  let product: Product;
  let api: UserAPI;
  const sandbox = sinon.createSandbox();
  let logged: { event: TelemetryEvent, metadata?: TelemetryMetadataByLevel }[] = [];

  testUtils.setTmpLogLevel("error");
  this.timeout("20s");

  before(async function() {
    home = new TestServer(this);
    await home.start(["home", "docs"]);
    dbManager = home.dbManager;
    product = new Product();
    product.name = "test_product";
    product.features = { workspaces: true };
    await product.save();
    const samHome = await createUser(dbManager, "sam");
    await dbManager.connection.createQueryBuilder()
      .update(BillingAccount)
      .set({ product })
      .where("id = :billingId", { billingId: samHome.billingAccount.id })
      .execute();
    api = new UserAPIImpl(`${home.serverUrl}/o/docs`, { fetch: fetch as any, ...configForUser("sam") as IOptions });
  });

  after(async function() {
    await home.stop();
  });

  beforeEach(function() {
    logged = [];
    sandbox.stub(Telemetry.prototype, "logEvent").callsFake((_req, event, metadata) => {
      logged.push({ event, metadata });
    });
  });

  afterEach(function() {
    sandbox.restore();
  });

  async function setFeatures(features: Features) {
    product.features = features;
    await product.save();
  }

  async function newDoc(name: string) {
    const ws = (await api.getOrgWorkspaces("current"))[0].id;
    const docId = await api.newDoc({ name }, ws);
    return { docId, doc: api.getDocAPI(docId) };
  }

  const rows = (n: number) => ({ A: range(n) });

  const limitEvents = () => logged.filter(e => e.event === "limitStatusChanged").map(e => e.metadata!.full!);
  const statuses = () => limitEvents().map(e => [e.feature, e.status]);
  const usageEvent = (triggeredBy: string) =>
    logged.find(e => e.event === "documentUsage" && e.metadata?.limited?.triggeredBy === triggeredBy)?.metadata?.full;

  it("logs one event each time the row limit status changes", async function() {
    await setFeatures({ workspaces: true, baseMaxRowsPerDocument: 10 });
    const { doc } = await newDoc("rows");

    await doc.addRows("Table1", rows(8));
    assert.deepEqual(statuses(), []);

    // 10 rows: ratio 1.0 is above the 0.9 approaching threshold, not above the limit.
    await doc.addRows("Table1", rows(2));
    assert.deepEqual(statuses(), [["rows", "approaching"]]);
    assert.isDefined(limitEvents()[0].userId);

    await doc.addRows("Table1", rows(1));
    assert.deepEqual(statuses(), [["rows", "approaching"], ["rows", "exceeded"]]);
    assert.equal(limitEvents()[1].planName, "test_product");

    // A further update at the same status logs nothing.
    await doc.addRows("Table1", rows(1));
    assert.deepEqual(statuses(), [["rows", "approaching"], ["rows", "exceeded"]]);

    const ids = (await doc.getRows("Table1")).id;
    await doc.removeRows("Table1", ids.slice(0, 6));
    assert.deepEqual(statuses(), [["rows", "approaching"], ["rows", "exceeded"], ["rows", "cleared"]]);
  });

  it("does not re-report a limit a reopened doc is already over, but reports it clearing", async function() {
    await setFeatures({ workspaces: true });
    const { doc } = await newDoc("reopen");

    await doc.addRows("Table1", rows(11));
    assert.deepEqual(statuses(), []);

    // Lower the limit while the doc is closed, so the reopened doc starts out already over it.
    // Flush the doc-auth cache, or the product change isn't seen for a few seconds (see suspension.ts).
    await setFeatures({ workspaces: true, baseMaxRowsPerDocument: 10 });
    dbManager.flushDocAuthCache();
    await home.server.getDocManager().shutdownDocs();

    // The open's first check only records the status; nothing is reported for it.
    await doc.addRows("Table1", rows(1));
    assert.deepEqual(statuses(), []);

    // The status was recorded, though: dropping below the limit is a transition from it.
    const ids = (await doc.getRows("Table1")).id;
    await doc.removeRows("Table1", ids.slice(0, 8));
    assert.deepEqual(statuses(), [["rows", "cleared"]]);
  });

  it("reports data-limit status and share count on documentUsage", async function() {
    await setFeatures({ workspaces: true, baseMaxRowsPerDocument: 10 });
    const { docId, doc } = await newDoc("shares");
    await api.updateDocPermissions(docId, { users: {
      "chimpy@getgrist.com": "editors",
      "kiwi@getgrist.com": "viewers",
    } });
    // Close every open doc so the next access is a fresh open.
    await home.server.getDocManager().shutdownDocs();

    logged = [];
    await doc.addRows("Table1", rows(11));
    const opened = usageEvent("docOpen");
    assert.isDefined(opened);
    // sam (owner) plus the two shares.
    assert.strictEqual(opened!.numDocShares, 3);
    assert.isNull(opened!.dataLimitStatus);

    // The rows just added put the doc over its limit, which the close reports.
    await home.server.getDocManager().shutdownDocs();
    assert.strictEqual(usageEvent("docClose")?.dataLimitStatus, "gracePeriod");
  });
});
