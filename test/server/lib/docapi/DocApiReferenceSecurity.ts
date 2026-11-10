import { ReferenceTableAPI } from "app/common/ReferenceTableAPI";
import { addAllScenarios, makeUserApi } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import * as path from "path";

import axios from "axios";
import { assert } from "chai";
import * as fse from "fs-extra";

describe("DocApiReferenceSecurity", function() {
  this.timeout(90_000);
  testUtils.setTmpLogLevel("error");
  addAllScenarios((getCtx) => {
    it("hides unaccepted consumer metadata and keeps owner preview data inaccessible to editors", async () => {
      const ctx = getCtx();
      const sourceApi = ctx.userApi;
      const kiwi = makeUserApi(ctx.homeUrl, "docs", ctx.kiwi);
      const org = await kiwi.newOrg({ name: "Private audit site", domain: "reference-security" });
      const destApi = makeUserApi(ctx.homeUrl, "reference-security", ctx.kiwi);
      const destWs = await destApi.newWorkspace({ name: "Private" }, "current");
      const sourceWs = (await sourceApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const sourceId = await sourceApi.newDoc({ name: "Audit source" }, sourceWs);
      const destId = await destApi.newDoc({ name: "Private audit document" }, destWs);
      try {
        await assert.isRejected(sourceApi.getDoc(destId), /403|404/);
        const source = sourceApi.getDocAPI(sourceId);
        const dest = destApi.getDocAPI(destId);
        const publisher = new ReferenceTableAPI(source);
        const subscriber = new ReferenceTableAPI(dest);
        await source.applyUserActions([["AddTable", "Prices", [{ id: "Price", type: "Numeric", isFormula: false }]],
          ["AddRecord", "Prices", 1, { Price: 5 }]]);
        const tables = await source.getRows("_grist_Tables");
        const columns = await source.getRows("_grist_Tables_column");
        const tableRef = tables.id[tables.tableId.indexOf("Prices")];
        const colRefs = [columns.id[columns.colId.indexOf("Price")]];
        const pub = await publisher.publish({ name: "Audit", tables: [{ tableRef, colRefs, filters: [] }] });
        await publisher.grant(pub.id, destId);
        const pending = (await publisher.consumers(pub.id)).consumers[0];
        assert.equal(pending.destinationName, destId);
        assert.equal(pending.destinationOrgName, "");
        assert.isEmpty((await subscriber.audit()).events);
        const sub = await subscriber.subscribe(pending.id, { [tableRef]: "Catalog" });
        await subscriber.syncSettings(sub.id, { syncMode: "manual", syncIntervalMinutes: 1 });
        assert.equal((await publisher.consumers(pub.id)).consumers[0].destinationName, "Private audit document");
        await source.applyUserActions([["UpdateRecord", "Prices", 1, { Price: 99 }]]);
        await subscriber.updatePreview(sub.id);
        await destApi.updateDocPermissions(destId, { users: { "charon@getgrist.com": "editors" } });
        const editor = makeUserApi(ctx.homeUrl, "reference-security", ctx.charon).getDocAPI(destId);
        await editor.applyUserActions([["AddColumn", "Table1", "PreviewRead", { type: "Numeric", isFormula: true,
          formula: "import docmodel\nreturn docmodel.global_docmodel.get_table('Catalog').lookupOne().Price" }],
        ["AddRecord", "Table1", 1, {}]]);
        assert.deepEqual((await editor.getRows("Table1")).PreviewRead, [5]);
        const marker = "AUDIT_SECRET_MARKER_DO_NOT_LOG";
        for (const endpoint of ["REFERENCE-CONNECTIONS", "ReFeReNcE-CoNnEcTiOnS"]) {
          const url = `${ctx.serverUrl}/api/docs/${sourceId}/${endpoint}/preview`;
          const response = await axios.post(url, { url: marker }, { ...ctx.chimpy, validateStatus: () => true });
          assert.equal(response.status, 403);
          const malformed = await axios.post(url, `{"url":"${marker}" broken`,
            { ...ctx.chimpy, headers: { ...ctx.chimpy.headers, "Content-Type": "application/json" },
              validateStatus: () => true });
          assert.equal(malformed.status, 400);
          assert.notInclude(JSON.stringify(malformed.data), marker);
        }
        const logs = (await fse.readdir(ctx.home.rootDir)).filter(name => name.endsWith("node.log"));
        for (const name of logs) {
          assert.notInclude(await fse.readFile(path.join(ctx.home.rootDir, name), "utf8"), marker);
        }
        await publisher.revoke(pub.id, sub.id);
        const revoked = (await publisher.consumers(pub.id)).consumers[0];
        assert.equal(revoked.destinationName, destId);
        assert.equal(revoked.destinationOrgName, "");
      } finally {
        await sourceApi.deleteDoc(sourceId);
        await destApi.deleteDoc(destId);
        await destApi.deleteOrg(org);
      }
    });
  }, "docapi-reference-security", { extraEnv: { GRIST_REFERENCE_TABLES: "true" } });
});
