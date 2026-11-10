import { ReferenceTableAPI } from "app/common/ReferenceTableAPI";
import { addAllScenarios, makeUserApi, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";
// Real HomeDB, HTTP permits, document workers and Python engine. No open browser is required.
describe("DocApiReferenceTables", function() {
  this.timeout(60_000);
  testUtils.setTmpLogLevel("error");
  addAllScenarios(addTests, "docapi-reference-tables", { extraEnv: { GRIST_REFERENCE_TABLES: "true" } });
});
function addTests(getCtx: () => TestContext) {
  it("reviews manual and scheduled snapshots, migrates incompatible columns and exposes owner-only audit",
    async function() {
      this.timeout(150_000);
      const ctx = getCtx();
      const api = ctx.userApi;
      const ws = (await api.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const srcId = await api.newDoc({ name: "Review source" }, ws);
      const dstId = await api.newDoc({ name: "Review destination" }, ws);
      try {
        const source = api.getDocAPI(srcId);
        const dest = api.getDocAPI(dstId);
        const publisher = new ReferenceTableAPI(source);
        const subscriber = new ReferenceTableAPI(dest);
        await source.applyUserActions([["AddTable", "Prices", [
          { id: "Price", type: "Numeric", isFormula: false }, { id: "Label", type: "Text", isFormula: false }]],
        ["BulkAddRecord", "Prices", Array.from({ length: 1500 }, (_, i) => i + 1),
          { Price: Array(1500).fill(5), Label: Array(1500).fill("secret-row-value".repeat(12)) }]]);
        const tables = await source.getRows("_grist_Tables");
        const columns = await source.getRows("_grist_Tables_column");
        const tableRef = tables.id[tables.tableId.indexOf("Prices")];
        const colRefs = ["Price", "Label"].map(name => columns.id[columns.colId.indexOf(name)]);
        const pub = await publisher.publish({ name: "Review", tables: [{ tableRef, colRefs, filters: [] }] });
        const link = await publisher.createConnectionLink(pub.id, { name: "Review" });
        const sub = await subscriber.connect(link.url, { [tableRef]: "Catalog" });
        await subscriber.syncSettings(sub.id, { syncMode: "manual", syncIntervalMinutes: 1 });
        await assert.isRejected(subscriber.syncSettings(sub.id, { syncMode: "scheduled", syncIntervalMinutes: 0 }),
          /400/);
        await dest.applyUserActions([["AddTable", "Totals", [
          { id: "Sum", type: "Numeric", isFormula: true, formula: "sum(Catalog.all.Price)" }]],
        ["AddRecord", "Totals", 1, {}]]);
        await source.applyUserActions([["UpdateRecord", "Prices", 1, { Price: 8 }]]);
        const preview = await subscriber.updatePreview(sub.id);
        assert.include(preview.tables[0], { added: 0, updated: 1, removed: 0 });
        assert.equal(preview.formulas.changed, 1);
        assert.include(preview.formulas.samples[0], { before: 7500, after: 7503 });
        assert.equal((await dest.getRows("Totals")).Sum[0], 7500);
        await dest.applyUserActions([["AddRecord", "Table1", null, {}]]);
        await assert.isRejected(subscriber.applyPreview(sub.id, preview.token), /PREVIEW_STALE/);
        const fresh = await subscriber.updatePreview(sub.id);
        // The reviewed snapshot stays fixed even if the source advances afterwards.
        await source.applyUserActions([["UpdateRecord", "Prices", 1, { Price: 10 }]]);
        await subscriber.applyPreview(sub.id, fresh.token);
        assert.equal((await dest.getRows("Totals")).Sum[0], 7503);
        await assert.isRejected(subscriber.applyPreview(sub.id, fresh.token), /PREVIEW_STALE/);
        await subscriber.reconcile(sub.id);
        assert.equal((await dest.getRows("Totals")).Sum[0], 7505);
        const scheduled = await subscriber.syncSettings(sub.id, { syncMode: "scheduled", syncIntervalMinutes: 1 });
        assert.isAbove(Date.parse(scheduled.nextSyncAt!), Date.now());
        await source.applyUserActions([["UpdateRecord", "Prices", 1, { Price: 12 }]]);
        assert.equal((await dest.getRows("Totals")).Sum[0], 7505);
        // Exercise the real persisted schedule and internal dispatch, not only a clock helper.
        const deadline = Date.now() + 85000;
        while (Date.now() < deadline && (await dest.getRows("Totals")).Sum[0] !== 7507) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert.equal((await dest.getRows("Totals")).Sum[0], 7507);
        await subscriber.syncSettings(sub.id, { syncMode: "manual", syncIntervalMinutes: 1 });
        await source.applyUserActions([["ModifyColumn", "Prices", "Price", { type: "Text" }],
          ["UpdateRecord", "Prices", 1, { Price: "twelve" }]]);
        await assert.isRejected(subscriber.reconcile(sub.id), /SCHEMA_BLOCKED/);
        const schemaPreview = await subscriber.updatePreview(sub.id);
        assert.equal(schemaPreview.schema[0].after, "Text");
        assert.equal(schemaPreview.formulas.newErrors, 1);
        await assert.isRejected(subscriber.applyPreview(sub.id, schemaPreview.token), /SCHEMA_ACCEPTANCE_REQUIRED/);
        await subscriber.applyPreview(sub.id, schemaPreview.token, true);
        assert.equal((await dest.getRows("Catalog")).Price[0], "twelve");
        await publisher.update(pub.id, { ...pub.spec, tables: [{ tableRef, colRefs: [colRefs[1]], filters: [] }] },
          pub.contractVersion);
        const contract = await subscriber.preview(sub.id);
        await subscriber.acceptContract(sub.id, contract.contractVersion);
        const removal = await subscriber.updatePreview(sub.id);
        assert.equal(removal.schema[0].after, "");
        await subscriber.applyPreview(sub.id, removal.token, true);
        assert.notProperty(await dest.getRows("Catalog"), "Price");
        await api.updateDocPermissions(dstId, { users: { "charon@getgrist.com": "editors" } });
        const editor = new ReferenceTableAPI(makeUserApi(ctx.homeUrl, "docs-1", ctx.charon).getDocAPI(dstId));
        await assert.isRejected(editor.audit(), /403/);
        await assert.isRejected(editor.updatePreview(sub.id), /403/);
        await assert.isRejected(editor.syncSettings(sub.id, { syncMode: "live", syncIntervalMinutes: 1 }), /403/);
        for (let i = 0; i < 51; i++) {
          await subscriber.syncSettings(sub.id, { syncMode: "manual", syncIntervalMinutes: 1 + i });
        }
        const audit = await subscriber.audit();
        assert.lengthOf(audit.events, 50);
        assert.isString(audit.nextCursor);
        const older = await subscriber.audit(audit.nextCursor!);
        assert.isAbove(older.events.length, 0);
        assert.isFalse(older.events.some(e => audit.events.some(a => a.id === e.id)));
        const serialized = JSON.stringify([audit, older, await publisher.audit()]);
        assert.notInclude(serialized, "secret-row-value");
        assert.notInclude(serialized, link.url);
        assert.notInclude(serialized, "secretHash");
      } finally {
        await api.deleteDoc(srcId);
        await api.deleteDoc(dstId);
      }
    });

  it("edits link restrictions, repairs initialization and revokes reviewed groups atomically", async () => {
    const ctx = getCtx();
    const sourceApi = ctx.userApi;
    const kiwi = makeUserApi(ctx.homeUrl, "docs", ctx.kiwi);
    const org = await kiwi.newOrg({ name: "Reference management", domain: "reference-management" });
    const destApi = makeUserApi(ctx.homeUrl, "reference-management", ctx.kiwi);
    const workspace = await destApi.newWorkspace({ name: "Management" }, "current");
    const sourceWs = (await sourceApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const sourceId = await sourceApi.newDoc({ name: "Management source" }, sourceWs);
    const destIds: string[] = [];
    try {
      for (let i = 0; i < 4; i++) { destIds.push(await destApi.newDoc({ name: `Managed ${i}` }, workspace)); }
      const source = sourceApi.getDocAPI(sourceId);
      await source.applyUserActions([["AddTable", "Prices", [{ id: "Price", type: "Numeric", isFormula: false }]],
        ["AddRecord", "Prices", 1, { Price: 5 }]]);
      const tables = await source.getRows("_grist_Tables");
      const columns = await source.getRows("_grist_Tables_column");
      const tableRef = tables.id[tables.tableId.indexOf("Prices")];
      const colRef = columns.id[columns.colId.indexOf("Price")];
      const publisher = new ReferenceTableAPI(source);
      const spec = { name: "Prices", tables: [{ tableRef, colRefs: [colRef], filters: [] }] };
      const pub = await publisher.publish(spec);
      const other = await publisher.publish({ ...spec, name: "Independent" });
      const a = await publisher.createConnectionLink(pub.id, { name: "Team A", maxAdmissions: 4 });
      const b = await publisher.createConnectionLink(pub.id, { name: "Team B" });
      const c = await publisher.createConnectionLink(other.id, { name: "Other publication" });
      const subscribers = destIds.map(id => new ReferenceTableAPI(destApi.getDocAPI(id)));
      await destApi.getDocAPI(destIds[0]).applyUserActions([["AddTable", "Catalog", []]]);
      await assert.isRejected(subscribers[0].connect(a.url, { [tableRef]: "Catalog" }), /ALIAS_CONFLICT/);
      const failed = (await subscribers[0].subscriptions())[0];
      assert.equal(failed.error, "ALIAS_CONFLICT");
      await subscribers[0].repairAliases(failed.id, { [tableRef]: "FixedCatalog" });
      assert.deepEqual((await destApi.getDocAPI(destIds[0]).getRows("FixedCatalog")).Price, [5]);
      await assert.isRejected(subscribers[0].repairAliases(failed.id, {}), /409/);
      await subscribers[1].connect(a.url, { [tableRef]: "Catalog" });
      const bSub = await subscribers[2].connect(b.url, { [tableRef]: "Catalog" });
      const independent = await subscribers[0].connect(c.url, { [tableRef]: "Independent" });
      await sourceApi.updateDocPermissions(sourceId, { users: { "charon@getgrist.com": "editors" } });
      const editor = new ReferenceTableAPI(makeUserApi(ctx.homeUrl, "docs-1", ctx.charon).getDocAPI(sourceId));
      await assert.isRejected(editor.updateConnectionLink(pub.id, a.id, { name: "No" }, a.settingsVersion), /403/);
      await assert.isRejected(editor.previewRevocation(pub.id), /403/);
      const restricted = await publisher.updateConnectionLink(pub.id, a.id,
        { name: "Restricted", allowedOrgIds: [999999], maxAdmissions: 2 }, a.settingsVersion);
      assert.notProperty(restricted, "secretHash");
      assert.notProperty(restricted, "url");
      await assert.isRejected(subscribers[3].previewConnection(a.url), /403/);
      await subscribers[0].reconcile(failed.id); // Restrictions affect admissions, not existing subscriptions.
      await assert.isRejected(publisher.updateConnectionLink(pub.id, a.id, { name: "Stale" }, a.settingsVersion),
        /409/);
      await assert.isRejected(publisher.updateConnectionLink(pub.id, a.id,
        { name: "Invalid", maxAdmissions: -1 }, restricted.settingsVersion), /400/);
      const restored = await publisher.updateConnectionLink(pub.id, a.id,
        { name: "Renamed", maxAdmissions: 2 }, restricted.settingsVersion);
      await assert.isRejected(subscribers[3].connect(a.url, {}), /admission limit/);
      await publisher.updateConnectionLink(pub.id, a.id,
        { name: "Renamed", maxAdmissions: 3 }, restored.settingsVersion);
      const stale = await publisher.previewRevocation(pub.id, a.id);
      assert.equal(stale.count, 2);
      await subscribers[3].connect(a.url, {});
      await assert.isRejected(publisher.revokeConsumers(pub.id, stale.token, a.id), /409/);
      assert.isFalse((await subscribers[0].subscriptions()).find(s => s.id === failed.id)!.revoked);
      const preview = await publisher.previewRevocation(pub.id, a.id);
      assert.equal(preview.count, 3);
      assert.equal(preview.linksToDisable, 1);
      await assert.isRejected(editor.revokeConsumers(pub.id, preview.token, a.id), /403/);
      await assert.isRejected(publisher.revokeConsumers(other.id, preview.token, a.id), /404/);
      assert.equal((await publisher.revokeConsumers(pub.id, preview.token, a.id)).revoked, 3);
      await assert.isRejected(subscribers[0].reconcile(failed.id), /ACCESS_REVOKED/);
      await subscribers[2].reconcile(bSub.id);
      await subscribers[0].reconcile(independent.id);
      await assert.isRejected(subscribers[0].connect(b.url, {}), /ACCESS_REVOKED/);
      const all = await publisher.previewRevocation(pub.id);
      assert.equal(all.count, 1);
      assert.equal((await publisher.revokeConsumers(pub.id, all.token)).revoked, 1);
      assert.isTrue((await publisher.connectionLinks(pub.id)).every(l => l.disabled));
      await subscribers[0].reconcile(independent.id);
      const disabled = (await publisher.connectionLinks(pub.id)).find(l => l.id === a.id)!;
      await assert.isRejected(publisher.updateConnectionLink(pub.id, a.id, { name: "Revive" },
        disabled.settingsVersion), /409/);
    } finally {
      await sourceApi.deleteDoc(sourceId);
      for (const id of destIds) { await destApi.deleteDoc(id); }
      await destApi.deleteOrg(org);
    }
  });

  it("connects by link across sites, isolates publications, and retains control over consumers", async () => {
    const ctx = getCtx();
    const sourceApi = ctx.userApi;
    const kiwi = makeUserApi(ctx.homeUrl, "docs", ctx.kiwi);
    const org = await kiwi.newOrg({ name: "Link consumers", domain: "link-consumers" });
    const destApi = makeUserApi(ctx.homeUrl, "link-consumers", ctx.kiwi);
    const ws = await destApi.newWorkspace({ name: "Consumers" }, "current");
    const sourceWs = (await sourceApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const sourceId = await sourceApi.newDoc({ name: "Link source" }, sourceWs);
    const destIds: string[] = [];
    try {
      for (let i = 0; i < 3; i++) { destIds.push(await destApi.newDoc({ name: `Consumer ${i}` }, ws)); }
      const source = sourceApi.getDocAPI(sourceId);
      const destination = destApi.getDocAPI(destIds[0]);
      const publisher = new ReferenceTableAPI(source);
      const subscriber = new ReferenceTableAPI(destination);
      await source.applyUserActions([
        ["AddTable", "Products", [{ id: "Price", type: "Numeric", isFormula: false },
          { id: "Private", type: "Text", isFormula: false }]],
        ["BulkAddRecord", "Products", [1, 2], { Price: [4, 8], Private: ["secret-one", "secret-two"] }],
      ]);
      const tables = await source.getRows("_grist_Tables");
      const columns = await source.getRows("_grist_Tables_column");
      const tableRef = tables.id[tables.tableId.indexOf("Products")];
      const colRef = columns.id[columns.colId.indexOf("Price")];
      const selection = { tableRef, colRefs: [colRef], filters: [] };
      const pub = await publisher.publish({ name: "Prices", description: "Public prices only", tables: [selection] });
      const other = await publisher.publish({ name: "Higher prices", tables: [{ ...selection,
        filters: [{ colRef, op: "gt", values: [5] }] }] });
      const link = await publisher.createConnectionLink(pub.id, { name: "Team link" });
      const otherLink = await publisher.createConnectionLink(other.id, { name: "Other projection" });
      assert.match(new URL(link.url).hash, /^#grist-reference=[a-f0-9-]{36}\.[a-f0-9]{64}$/);
      assert.equal(new URL(link.url).pathname, "/reference-connect");
      const landing = await axios.get(link.url.split("#")[0], { maxRedirects: 0 });
      assert.equal(landing.status, 200);
      assert.equal(landing.headers["cache-control"], "no-store");
      assert.equal(landing.headers["referrer-policy"], "no-referrer");
      assert.include(landing.data, "referenceConnect.bundle.js");
      assert.notInclude(landing.data, new URL(link.url).hash.slice(1));
      assert.notProperty(link, "secretHash");
      const listed = await publisher.connectionLinks(pub.id);
      assert.notProperty(listed[0], "secretHash");
      assert.notProperty(listed[0], "url");
      await assert.isRejected(kiwi.getDocAPI(sourceId).getRows("Products"), /403|404/);
      const preview = await subscriber.previewConnection(link.url);
      assert.equal(preview.description, "Public prices only");
      assert.deepEqual(preview.tables[0].columns, ["Price"]);
      assert.equal(preview.tables[0].rowCount, 2);
      assert.equal((await publisher.consumers(pub.id)).total, 0);
      assert.equal((await publisher.connectionLinks(pub.id))[0].admissions, 0);
      await assert.isRejected(subscriber.previewConnection(link.url.replace(/.$/, "z")), /403/);
      await assert.isRejected(subscriber.previewConnection(link.url.replace("localhost", "example.invalid")), /400/);
      await assert.isRejected(subscriber.connect(link.url, { [tableRef]: "Catalog" }, 0), /CONTRACT_CHANGED/);
      assert.equal((await publisher.consumers(pub.id)).total, 0);
      assert.equal((await publisher.connectionLinks(pub.id))[0].admissions, 0);
      const [sub, repeated] = await Promise.all([
        subscriber.connect(link.url, { [tableRef]: "Catalog" }),
        subscriber.connect(link.url, { [tableRef]: "Catalog" }),
      ]);
      assert.equal(sub.id, repeated.id);
      assert.equal((await publisher.connectionLinks(pub.id))[0].admissions, 1);
      assert.deepEqual((await destination.getRows("Catalog")).Price, [4, 8]);
      assert.notInclude(JSON.stringify(await destination.getRows("Catalog")), "secret-");
      const consumers = await publisher.consumers(pub.id);
      assert.equal(consumers.total, 1);
      assert.equal(consumers.consumers[0].destinationName, "Consumer 0");
      assert.equal(consumers.consumers[0].destinationOrgName, "Link consumers");
      assert.equal(consumers.consumers[0].connectionLinkId, link.id);
      await subscriber.connect(otherLink.url, { [tableRef]: "HigherPrices" });
      assert.deepEqual((await destination.getRows("HigherPrices")).Price, [8]);
      await destination.applyUserActions([
        ["AddTable", "Calculation", [{ id: "Total", type: "Numeric", isFormula: true,
          formula: "sum(Catalog.all.Price)" }]], ["AddRecord", "Calculation", 1, {}],
      ]);
      await assert.isRejected(destination.applyUserActions([["UpdateRecord", "Catalog", 1, { Price: 99 }]]),
        /read-only/);
      await destApi.updateDocPermissions(destIds[0], { users: { "charon@getgrist.com": "editors" } });
      const editor = new ReferenceTableAPI(
        makeUserApi(ctx.homeUrl, "link-consumers", ctx.charon).getDocAPI(destIds[0]));
      await assert.isRejected(editor.previewConnection(link.url), /403/);
      await assert.isRejected(editor.connect(link.url, {}), /403/);
      await sourceApi.updateDocPermissions(sourceId, { users: { "charon@getgrist.com": "viewers" } });
      const sourceReader = new ReferenceTableAPI(makeUserApi(ctx.homeUrl, "docs-1", ctx.charon).getDocAPI(sourceId));
      await assert.isRejected(sourceReader.connectionLinks(pub.id), /403/);
      await assert.isRejected(sourceReader.consumers(pub.id), /403/);
      // An unmodified snapshot advances the check time, not the last actual application time.
      const previous = (await subscriber.subscriptions()).find(s => s.id === sub.id)!;
      await subscriber.reconcile(sub.id);
      assert.equal((await subscriber.subscriptions()).find(s => s.id === sub.id)!.appliedAt, previous.appliedAt);
      // Neither side can lift the other side's pause. Local formulas retain the last copy.
      await assert.isRejected(sourceReader.pauseConsumer(pub.id, sub.id, true), /403/);
      await assert.isRejected(editor.pauseSubscription(sub.id, true), /403/);
      await assert.isRejected(publisher.pauseConsumer(other.id, sub.id, true), /409/);
      await publisher.pauseConsumer(pub.id, sub.id, true);
      await subscriber.pauseSubscription(sub.id, true);
      await source.applyUserActions([["UpdateRecord", "Products", 1, { Price: 40 }]]);
      await assert.isRejected(subscriber.reconcile(sub.id), /PAUSED/);
      await subscriber.pauseSubscription(sub.id, false);
      await assert.isRejected(subscriber.reconcile(sub.id), /PAUSED/);
      assert.deepEqual((await destination.getRows("Calculation")).Total, [12]);
      await subscriber.pauseSubscription(sub.id, true);
      await publisher.pauseConsumer(pub.id, sub.id, false);
      await assert.isRejected(subscriber.reconcile(sub.id), /PAUSED/);
      await subscriber.pauseSubscription(sub.id, false);
      await subscriber.reconcile(sub.id);
      assert.deepEqual((await destination.getRows("Calculation")).Total, [48]);
      await publisher.disableConnectionLink(pub.id, link.id);
      await assert.isRejected(subscriber.previewConnection(link.url), /403/);
      await source.applyUserActions([["UpdateRecord", "Products", 1, { Price: 5 }]]);
      await subscriber.reconcile(sub.id);
      assert.deepEqual((await destination.getRows("Calculation")).Total, [13]);
      // Another valid link cannot evade the document-level revocation.
      const replacement = await publisher.createConnectionLink(pub.id, { name: "Replacement" });
      await publisher.revoke(pub.id, sub.id);
      await assert.isRejected(subscriber.connect(replacement.url, {}), /ACCESS_REVOKED/);
      await assert.isRejected(subscriber.previewConnection(replacement.url), /ACCESS_REVOKED/);
      assert.deepEqual((await destination.getRows("Catalog")).Price, [5, 8]);
      // Reauthorization is a two-party handshake, preserving mirror identity and admissions.
      await assert.isRejected(sourceReader.reauthorizeConsumer(pub.id, sub.id), /403/);
      await publisher.reauthorizeConsumer(pub.id, sub.id);
      assert.equal((await subscriber.subscriptions()).find(s => s.id === sub.id)!.status, "AUTHORIZED");
      await source.applyUserActions([["UpdateRecord", "Products", 1, { Price: 6 }]]);
      await assert.isRejected(subscriber.reconcile(sub.id), /404/);
      assert.deepEqual((await destination.getRows("Catalog")).Price, [5, 8]);
      await assert.isRejected(editor.activate(sub.id, 1), /403/);
      await subscriber.activate(sub.id, 1);
      await subscriber.reconcile(sub.id);
      assert.deepEqual((await destination.getRows("Catalog")).id, [1, 2]);
      assert.deepEqual((await destination.getRows("Calculation")).Total, [14]);
      assert.equal((await publisher.connectionLinks(pub.id)).find(l => l.id === link.id)!.admissions, 1);
      assert.equal((await publisher.connectionLinks(pub.id)).find(l => l.id === replacement.id)!.admissions, 0);
      assert.equal((await publisher.consumers(pub.id)).consumers[0].connectionLinkId, link.id);
      // Reacceptance through another link is also idempotent and preserves aliases/lineage.
      await publisher.revoke(pub.id, sub.id);
      await publisher.reauthorizeConsumer(pub.id, sub.id);
      await subscriber.connect(replacement.url, { [tableRef]: "MustNotRename" });
      assert.deepEqual((await destination.getRows("Catalog")).Price, [6, 8]);
      assert.equal((await publisher.connectionLinks(pub.id)).find(l => l.id === replacement.id)!.admissions, 0);
      // The other publication is still live.
      const otherSub = (await subscriber.subscriptions()).find(s => s.publicationId === other.id)!;
      await subscriber.reconcile(otherSub.id);
      const limited = await publisher.createConnectionLink(other.id, { name: "One admission", maxAdmissions: 1 });
      const entrants = destIds.slice(1).map(id => new ReferenceTableAPI(destApi.getDocAPI(id)));
      const results = await Promise.allSettled(entrants.map(api => api.connect(limited.url, {})));
      assert.lengthOf(results.filter(r => r.status === "fulfilled"), 1);
      assert.lengthOf(results.filter(r => r.status === "rejected"), 1);
      assert.equal((await publisher.connectionLinks(other.id)).find(l => l.id === limited.id)!.admissions, 1);
      await assert.isRejected(publisher.createConnectionLink(pub.id, {
        name: "Already expired", expiresAt: "2020-01-01T00:00:00Z",
      }), /400/);
      const expiring = await publisher.createConnectionLink(other.id, {
        name: "Expires soon", expiresAt: new Date(Date.now() + 1500).toISOString(),
      });
      await subscriber.previewConnection(expiring.url);
      await new Promise(resolve => setTimeout(resolve, 1600));
      await assert.isRejected(subscriber.connect(expiring.url, {}), /403/);
      const restricted = await publisher.createConnectionLink(other.id,
        { name: "Restricted", allowedOrgIds: [999999] });
      await assert.isRejected(subscriber.previewConnection(restricted.url), /403/);
      await assert.isRejected(publisher.connect(otherLink.url, {}), /cycle/);
      // Even the source owner cannot impersonate the internal metadata transport.
      const internal = await axios.post(`${source.getBaseUrl()}/reference-internal/describe-publication/${pub.id}`,
        {}, ctx.chimpy);
      assert.equal(internal.status, 403);
      await subscriber.detach(sub.id);
      await publisher.revoke(pub.id, sub.id);
      await assert.isRejected(publisher.reauthorizeConsumer(pub.id, sub.id), /409/);
      await assert.isRejected(subscriber.activate(sub.id, 1), /409/);
      await destination.applyUserActions([["UpdateRecord", "Catalog", 1, { Price: 99 }]]);
    } finally {
      await sourceApi.deleteDoc(sourceId);
      for (const id of destIds) { await destApi.deleteDoc(id); }
      await destApi.deleteOrg(org);
    }
  });

  it("publishes across sites, applies in the background, enforces grants and freezes revoked data", async () => {
    const ctx = getCtx();
    const sourceApi = ctx.userApi;
    // Kiwi owns the destination, without any access to Chimpy's private source.
    const kiwiApi = makeUserApi(ctx.homeUrl, "docs", ctx.kiwi);
    const org = await kiwiApi.newOrg({ name: "Reference destination", domain: "reference-dest" });
    const destApi = makeUserApi(ctx.homeUrl, "reference-dest", ctx.kiwi);
    const sourceWs = (await sourceApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const destWs = await destApi.newWorkspace({ name: "References" }, "current");
    const sourceId = await sourceApi.newDoc({ name: "Reference source" }, sourceWs);
    const destId = await destApi.newDoc({ name: "Reference consumer" }, destWs);
    const source = sourceApi.getDocAPI(sourceId);
    const dest = destApi.getDocAPI(destId);
    const publisher = new ReferenceTableAPI(source);
    const subscriber = new ReferenceTableAPI(dest);
    try {
      await source.applyUserActions([
        ["AddTable", "Products", [{ id: "Price", type: "Numeric", isFormula: false },
          { id: "Secret", type: "Text", isFormula: false }]],
        ["AddRecord", "Products", 1, { Price: 4, Secret: "private-value" }],
      ]);
      const tables = await source.getRows("_grist_Tables");
      const columns = await source.getRows("_grist_Tables_column");
      const tableRef = tables.id[tables.tableId.indexOf("Products")];
      const colRef = columns.id[columns.colId.indexOf("Price")];
      const pub = await publisher.publish({ name: "Product prices", tables: [{ tableRef, colRefs: [colRef],
        filters: [] }] });
      await assert.isRejected(kiwiApi.getDocAPI(sourceId).getRows("Products"), /403|404/);
      assert.isEmpty(await subscriber.available());
      await assert.isRejected(subscriber.subscribe(pub.id, {}), /404/);
      await publisher.grant(pub.id, destId);
      const ref = (await subscriber.available())[0];
      assert.equal(ref.name, "Product prices");
      const preview = await subscriber.preview(ref.authorizationId);
      assert.deepEqual(preview.tables[0].columns, ["Price"]);
      const sub = await subscriber.subscribe(ref.authorizationId, { [tableRef]: "Catalog" });
      assert.equal(sub.status, "UP_TO_DATE");
      assert.deepEqual((await dest.getRows("Catalog")).Price, [4]);
      await dest.applyUserActions([
        ["AddTable", "Orders", [{ id: "Total", type: "Numeric", isFormula: true,
          formula: "Catalog.lookupOne(id=1).Price * 3" }]], ["AddRecord", "Orders", 1, {}],
      ]);
      await assert.isRejected(dest.applyUserActions([["UpdateRecord", "Catalog", 1, { Price: 123 }]]), /read-only/);
      await assert.isRejected(dest.applyUserActions([["CreateReferenceTables", "fake", []]]), /read-only/);
      // Even document owners cannot invoke the internal transport without a bound permit.
      const internal = await axios.post(`${source.getBaseUrl()}/reference-internal/snapshot/${sub.id}`, {}, ctx.chimpy);
      assert.equal(internal.status, 403);
      await dest.forceReload(); // Consumer worker is cold when the source update arrives.
      await source.applyUserActions([["UpdateRecord", "Products", 1, { Price: 7 }]]);
      const deadline = Date.now() + 25_000;
      while (true) {
        if ((await dest.getRows("Orders")).Total[0] === 21) { break; }
        if (Date.now() > deadline) { assert.fail("Background reference update did not arrive"); }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      assert.notInclude(JSON.stringify(await dest.getRows("Catalog")), "private-value");
      await destApi.updateDocPermissions(destId, { users: { "charon@getgrist.com": "viewers" } });
      const reader = new ReferenceTableAPI(makeUserApi(ctx.homeUrl, "reference-dest", ctx.charon).getDocAPI(destId));
      assert.deepEqual((await reader.status()).map(s => [s.id, s.status]), [[sub.id, "UP_TO_DATE"]]);
      await assert.isRejected(reader.publications(), /403/);

      // Contract edits require explicit acceptance; ordinary data changes do not.
      assert.equal(pub.contractVersion, 1);
      const unchanged = await publisher.update(pub.id, { ...pub.spec, description: "A new description" }, 1);
      assert.equal(unchanged.contractVersion, 1);
      await source.applyUserActions([["AddColumn", "Products", "Discount", { type: "Numeric", isFormula: false }],
        ["UpdateRecord", "Products", 1, { Discount: 2 }]]);
      const newCols = await source.getRows("_grist_Tables_column");
      const discountRef = newCols.id[newCols.colId.indexOf("Discount")];
      const spec = { name: "Product prices", tables: [{ tableRef, colRefs: [colRef, discountRef], filters: [] }] };
      const version2 = await publisher.update(pub.id, spec, 1);
      assert.equal(version2.contractVersion, 2);
      await assert.isRejected(publisher.update(pub.id, pub.spec, 1), /CONTRACT_CHANGED/);
      await assert.isRejected(subscriber.reconcile(sub.id), /CONTRACT_CHANGED/);
      assert.equal((await subscriber.subscriptions())[0].status, "CONTRACT_CHANGED");
      assert.deepEqual((await dest.getRows("Catalog")).Price, [7]);
      assert.notProperty(await dest.getRows("Catalog"), "Discount");
      await assert.isRejected(reader.acceptContract(sub.id, 2), /403/);
      await assert.isRejected(subscriber.acceptContract(sub.id, 1), /CONTRACT_CHANGED/);
      const contractPreview = await subscriber.preview(sub.id);
      assert.equal(contractPreview.contractVersion, 2);
      assert.isTrue(contractPreview.previousContractKnown);
      assert.deepEqual(contractPreview.changes, [{ tableRef, addedColumns: [discountRef], removedColumns: [],
        previousFilters: [], filters: [], filtersChanged: false }]);
      const link = await publisher.createConnectionLink(pub.id, { name: "Updated contract" });
      // A connection link cannot silently accept a new contract for an existing mirror.
      await assert.isRejected(subscriber.connect(link.url, {}, 2), /CONTRACT_CHANGED/);
      await subscriber.acceptContract(sub.id, 2);
      await subscriber.reconcile(sub.id);
      assert.equal((await subscriber.subscriptions())[0].appliedContractVersion, 2);
      assert.deepEqual((await dest.getRows("Catalog")).Discount, [2]);
      await publisher.update(pub.id, { ...spec, tables: [{ ...spec.tables[0],
        filters: [{ colRef, op: "gt", values: [10] }] }] }, 2);
      await assert.isRejected(subscriber.reconcile(sub.id), /CONTRACT_CHANGED/);
      assert.deepEqual((await dest.getRows("Catalog")).id, [1]);
      const filtered = await subscriber.preview(sub.id);
      assert.deepEqual(filtered.changes?.[0].previousFilters, []);
      assert.deepEqual(filtered.changes?.[0].filters, [{ colRef, op: "gt", values: [10] }]);
      await subscriber.acceptContract(sub.id, 3);
      await subscriber.reconcile(sub.id);
      assert.isEmpty((await dest.getRows("Catalog")).id);
      await publisher.update(pub.id, spec, 3);
      await assert.isRejected(subscriber.acceptContract(sub.id, 3), /CONTRACT_CHANGED/);
      await subscriber.acceptContract(sub.id, 4);
      await subscriber.reconcile(sub.id);
      assert.deepEqual((await dest.getRows("Catalog")).id, [1]);
      assert.deepEqual((await dest.getRows("Orders")).Total, [21]);
      assert.equal((await publisher.consumers(pub.id)).consumers[0].acceptedContractVersion, 4);
      assert.equal((await publisher.consumers(pub.id)).consumers[0].contractVersion, 4);

      // Acceptance cannot force a destructive schema update through the existing schema guard.
      await publisher.update(pub.id, pub.spec, 4);
      await subscriber.acceptContract(sub.id, 5);
      await assert.isRejected(subscriber.reconcile(sub.id), /SCHEMA_BLOCKED/);
      assert.equal((await subscriber.subscriptions())[0].appliedContractVersion, 4);
      assert.deepEqual((await dest.getRows("Catalog")).Discount, [2]);
      await publisher.update(pub.id, spec, 5);
      await subscriber.acceptContract(sub.id, 6);
      await subscriber.reconcile(sub.id);

      await publisher.pause(pub.id, true);
      await assert.isRejected(subscriber.reconcile(sub.id), /PAUSED/);
      await publisher.pause(pub.id, false);
      await subscriber.reconcile(sub.id);
      await publisher.grant(pub.id, sourceId);
      const selfGrant = (await publisher.available())[0];
      await assert.isRejected(publisher.subscribe(selfGrant.authorizationId, {}), /cycle/);
      await publisher.revoke(pub.id, sub.id);
      await assert.isRejected(subscriber.acceptContract(sub.id, 4), /409/);
      await source.applyUserActions([["UpdateRecord", "Products", 1, { Price: 9 }]]);
      await assert.isRejected(subscriber.reconcile(sub.id), /ACCESS_REVOKED/);
      assert.deepEqual((await dest.getRows("Catalog")).Price, [7]);
      assert.equal((await subscriber.subscriptions())[0].status, "ACCESS_REVOKED");
      await subscriber.detach(sub.id);
      await dest.applyUserActions([["UpdateRecord", "Catalog", 1, { Price: 10 }]]);
      assert.deepEqual((await dest.getRows("Orders")).Total, [30]);
    } finally {
      await sourceApi.deleteDoc(sourceId);
      await destApi.deleteDoc(destId);
      await destApi.deleteOrg(org);
    }
  });
}
