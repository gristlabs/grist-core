/**
 * Tests for form operations.
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { addAllScenarios, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";
import { getDatabase } from "test/testUtils";

import axios, { AxiosRequestConfig } from "axios";
import { assert } from "chai";

describe("DocApiForms", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addFormsTests, "docapi-forms");
});

function addFormsTests(getCtx: () => TestContext) {
  async function getPrimarySectionId(docUrl: string, cfg: AxiosRequestConfig, tableId: string) {
    const tablesResp = await axios.get(`${docUrl}/tables/_grist_Tables/records`, cfg);
    assert.equal(tablesResp.status, 200);
    const tableRec = tablesResp.data.records.find((r: any) => r.fields.tableId === tableId);
    assert.ok(tableRec, `table ${tableId} not found`);
    const tableRef = tableRec.id;
    const { rawViewSectionRef, recordCardViewSectionRef } = tableRec.fields;

    const sectionsResp = await axios.get(`${docUrl}/tables/_grist_Views_section/records`, cfg);
    assert.equal(sectionsResp.status, 200);
    const section = sectionsResp.data.records.find((r: any) =>
      r.fields.tableRef === tableRef &&
      r.id !== rawViewSectionRef &&
      r.id !== recordCardViewSectionRef);
    assert.ok(section, `primary section for ${tableId} not found`);
    return section.id as number;
  }

  async function makeForm(docUrl: string, cfg: AxiosRequestConfig, sectionId: number) {
    const resp = await axios.post(`${docUrl}/apply`, [
      ["UpdateRecord", "_grist_Views_section", sectionId, { parentKey: "form" }],
    ], cfg);
    assert.equal(resp.status, 200);
  }

  function refValuesFor(data: any, colId: string): any[] {
    const field = Object.values(data.formFieldsById).find((f: any) => f.colId === colId) as any;
    assert.ok(field, `field ${colId} not found`);
    return (field.refValues as [number, any][]).map(([, value]) => value);
  }

  async function getShareKey(docId: string, linkId: string): Promise<string> {
    const db = await getDatabase();
    const shares = await db.connection.query(
      "select * from shares where doc_id = ? and link_id = ?", [docId, linkId]);
    assert.isAbove(shares.length, 0, `expected a share with linkId ${linkId}`);
    return shares[0].key;
  }

  async function getPageRef(docUrl: string, cfg: AxiosRequestConfig, sectionId: number) {
    const sectionsResp = await axios.get(`${docUrl}/tables/_grist_Views_section/records`, cfg);
    const section = sectionsResp.data.records.find((r: any) => r.id === sectionId);
    assert.ok(section, `section ${sectionId} not found`);
    const pagesResp = await axios.get(`${docUrl}/tables/_grist_Pages/records`, cfg);
    const page = pagesResp.data.records.find((r: any) => r.fields.viewRef === section.fields.parentId);
    assert.ok(page, `page for section ${sectionId} not found`);
    return page.id as number;
  }

  async function setupRefForm(opts: {
    name: string,
    refType: string,
    restrict: "betaRow" | "displayColumn",
  }) {
    const { serverUrl, userApi, chimpy } = getCtx();
    const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
    const docId = await userApi.newDoc({ name: opts.name }, wid);
    const docUrl = `${serverUrl}/api/docs/${docId}`;

    const restriction = opts.restrict === "betaRow" ?
      { colIds: "*", aclFormula: 'user.Access != OWNER and rec.A == "Beta"' } :
      { colIds: "A", aclFormula: "user.Access != OWNER" };
    const resp = await axios.post(`${docUrl}/apply`, [
      ["BulkAddRecord", "Table1", [1, 2, 3], { A: ["Alpha", "Beta", "Gamma"] }],
      ["AddTable", "FormT", [{ id: "Pick", type: opts.refType }]],
      // visibleCol 2 is Table1.A in a fresh doc (manualSort=1, A=2, B=3, C=4).
      ["ModifyColumn", "FormT", "Pick", { visibleCol: 2 }],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: restriction.colIds }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: restriction.aclFormula, permissionsText: "-R",
      }],
    ], chimpy);
    assert.equal(resp.status, 200);

    const sectionId = await getPrimarySectionId(docUrl, chimpy, "FormT");
    await makeForm(docUrl, chimpy, sectionId);
    await userApi.updateDocPermissions(docId, { users: { "kiwi@getgrist.com": "viewers" } });
    return { serverUrl, docUrl, docId, sectionId };
  }

  async function publishForm(docUrl: string, docId: string, cfg: AxiosRequestConfig, sectionId: number) {
    const pageRef = await getPageRef(docUrl, cfg, sectionId);
    const resp = await axios.post(`${docUrl}/apply`, [
      ["AddRecord", "_grist_Shares", null, { linkId: "x", options: '{"publish": true}' }],
      ["UpdateRecord", "_grist_Views_section", sectionId,
        { parentKey: "form", shareOptions: '{"publish": true, "form": true}' }],
      ["UpdateRecord", "_grist_Pages", pageRef, { shareRef: 1 }],
    ], cfg);
    assert.equal(resp.status, 200);
    return getShareKey(docId, "x");
  }

  describe("GET /docs/{did}/forms/{vsid}", function() {
    it("returns 200 when the form exists", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsServe" }, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");
      await makeForm(docUrl, chimpy, sectionId);

      const resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.formTableId, "Table1");
      const colIds = Object.values(resp.data.formFieldsById).map((f: any) => f.colId);
      assert.includeMembers(colIds, ["A", "B", "C"]);
      assert.isString(resp.data.formLayoutSpec);
      assert.isString(resp.data.formTitle);
    });

    it("returns 404 for non-form sections", async function() {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsNonForm" }, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");

      const resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
    });

    it("returns 404 for forms whose tables viewers cannot read", async function() {
      const { serverUrl, userApi, chimpy, kiwi } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsHiddenTable" }, wid);
      await userApi.updateDocPermissions(docId, { users: { "kiwi@getgrist.com": "viewers" } });
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");
      await makeForm(docUrl, chimpy, sectionId);

      // Hide Table1 entirely from non-owners.
      let resp = await axios.post(`${docUrl}/apply`, [
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "*" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-R",
        }],
      ], chimpy);
      assert.equal(resp.status, 200);

      // The owner can read the form.
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.formTableId, "Table1");

      // The viewer (who can't read the table) gets a 404 with no leaked metadata.
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, kiwi);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
      assert.isUndefined(resp.data.formFieldsById);
      assert.isUndefined(resp.data.formTableId);
    });

    it("omits fields whose columns viewers cannot read", async function() {
      const { serverUrl, userApi, chimpy, kiwi } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsHiddenColumn" }, wid);
      await userApi.updateDocPermissions(docId, { users: { "kiwi@getgrist.com": "viewers" } });
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");
      await makeForm(docUrl, chimpy, sectionId);

      // Hide column B of Table1 from non-owners.
      await axios.post(`${docUrl}/apply`, [
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-R",
        }],
      ], chimpy);

      // The owner sees all columns, including B.
      let resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      const ownerColIds = Object.values(resp.data.formFieldsById).map((f: any) => f.colId);
      assert.includeMembers(ownerColIds, ["A", "B", "C"]);

      // The viewer's form omits the hidden column B, but keeps A and C.
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, kiwi);
      assert.equal(resp.status, 200);
      const viewerColIds = Object.values(resp.data.formFieldsById).map((f: any) => f.colId);
      assert.includeMembers(viewerColIds, ["A", "C"]);
      assert.notInclude(viewerColIds, "B");
    });

    it("filters Reference choices by the viewer's row access", async function() {
      const { chimpy, kiwi } = getCtx();
      const { docUrl, sectionId } = await setupRefForm({
        name: "FormsRefValues", refType: "Ref:Table1", restrict: "betaRow",
      });

      // The owner sees every reference choice.
      let resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);

      // The viewer cannot see the hidden Beta row, so it's absent from the choices.
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, kiwi);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Gamma"]);
    });

    it("filters ReferenceList choices by the viewer's row access", async function() {
      const { chimpy, kiwi } = getCtx();
      const { docUrl, sectionId } = await setupRefForm({
        name: "FormsRefListValues", refType: "RefList:Table1", restrict: "betaRow",
      });

      // The owner sees every reference choice.
      let resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);

      // The viewer cannot see the hidden Beta row, so it's absent from the choices.
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, kiwi);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Gamma"]);
    });

    it("filters Reference choices when the display column is hidden", async function() {
      const { chimpy, kiwi } = getCtx();
      const { docUrl, sectionId } = await setupRefForm({
        name: "FormsRefHiddenDisplay", refType: "Ref:Table1", restrict: "displayColumn",
      });

      // The owner sees every reference choice.
      let resp = await axios.get(`${docUrl}/forms/${sectionId}`, chimpy);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);

      // The viewer cannot read the displayed column, so the choices censor to empty (the
      // visibleCol metadata is blanked, so no display value can be resolved).
      resp = await axios.get(`${docUrl}/forms/${sectionId}`, kiwi);
      assert.equal(resp.status, 200);
      assert.isEmpty(refValuesFor(resp.data, "Pick"));
    });
  });

  describe("GET /s/{key}/forms/{vsid}", function() {
    async function setupFormShare(opts: {
      name: string,
      sectionShareOptions: string,
      shareOptions: string,
      linkPage?: boolean,
    }) {
      const { serverUrl, userApi, chimpy } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: opts.name }, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;

      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");
      const actions: any[] = [
        ["AddRecord", "_grist_Shares", null, {
          linkId: "x", options: opts.shareOptions,
        }],
        ["UpdateRecord", "_grist_Views_section", sectionId, {
          parentKey: "form",
          shareOptions: opts.sectionShareOptions,
        }],
      ];
      if (opts.linkPage !== false) {
        actions.push(["UpdateRecord", "_grist_Pages", 1, { shareRef: 1 }]);
      }
      const resp = await axios.post(`${docUrl}/apply`, actions, chimpy);
      assert.equal(resp.status, 200);

      const key = await getShareKey(docId, "x");
      return { serverUrl, docUrl, sectionId, key };
    }

    it("returns 200 when the form is published", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsShareServe",
        sectionShareOptions: '{"publish": true, "form": true}',
        shareOptions: '{"publish": true}',
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 200);
      assert.equal(resp.data.formTableId, "Table1");
      const colIds = Object.values(resp.data.formFieldsById).map((f: any) => f.colId);
      assert.includeMembers(colIds, ["A", "B", "C"]);
    });

    it("returns 404 when the form is not published", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsShareSectionUnpublished",
        sectionShareOptions: '{"publish": false, "form": true}',
        shareOptions: '{"publish": true}',
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotPublished");
    });

    it("returns 404 when the share is not published", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsShareShareUnpublished",
        sectionShareOptions: '{"publish": true, "form": true}',
        shareOptions: '{"publish": false}',
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotPublished");
    });

    it("returns 404 when the section is not a form", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsShareNotForm",
        sectionShareOptions: '{"publish": true, "form": false}',
        shareOptions: '{"publish": true}',
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
    });

    it("returns 404 when the section does not exist", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsShareUnknownSection",
        sectionShareOptions: '{"publish": true, "form": true}',
        shareOptions: '{"publish": true}',
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId + 99999}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
    });

    it("returns 404 when the form is not linked to a share", async function() {
      const { nobody } = getCtx();
      const { serverUrl, sectionId, key } = await setupFormShare({
        name: "FormsSharePageUnlinked",
        sectionShareOptions: '{"publish": true, "form": true}',
        shareOptions: '{"publish": true}',
        linkPage: false,
      });

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
    });

    it("returns 404 when the share key belongs to a different form", async function() {
      const { serverUrl, userApi, chimpy, nobody } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsShareLinkMismatch" }, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");

      // "x" is unlinked (its key is used for the request), "y" is linked to the form.
      await axios.post(`${docUrl}/apply`, [
        ["AddRecord", "_grist_Shares", null, { linkId: "x", options: '{"publish": true}' }],
        ["AddRecord", "_grist_Shares", null, { linkId: "y", options: '{"publish": true}' }],
        ["UpdateRecord", "_grist_Views_section", sectionId,
          { parentKey: "form", shareOptions: '{"publish": true, "form": true}' }],
        ["UpdateRecord", "_grist_Pages", 1, { shareRef: 2 }],
      ], chimpy);
      const key = await getShareKey(docId, "x");

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 404);
      assert.equal(resp.data.details?.code, "FormNotFound");
    });

    it("reads Reference choices a row rule hides from viewers", async function() {
      const { chimpy, nobody } = getCtx();
      const { serverUrl, docUrl, docId, sectionId } = await setupRefForm({
        name: "FormsShareRefRow", refType: "Ref:Table1", restrict: "betaRow",
      });
      const key = await publishForm(docUrl, docId, chimpy, sectionId);

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);
    });

    it("reads ReferenceList choices a row rule hides from viewers", async function() {
      const { chimpy, nobody } = getCtx();
      const { serverUrl, docUrl, docId, sectionId } = await setupRefForm({
        name: "FormsShareRefListRow", refType: "RefList:Table1", restrict: "betaRow",
      });
      const key = await publishForm(docUrl, docId, chimpy, sectionId);

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);
    });

    it("reads a form field a column rule hides from viewers", async function() {
      const { serverUrl, userApi, chimpy, nobody } = getCtx();
      const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
      const docId = await userApi.newDoc({ name: "FormsShareHiddenColumn" }, wid);
      const docUrl = `${serverUrl}/api/docs/${docId}`;
      const sectionId = await getPrimarySectionId(docUrl, chimpy, "Table1");
      const key = await publishForm(docUrl, docId, chimpy, sectionId);

      // Hide column B from non-owners.
      await axios.post(`${docUrl}/apply`, [
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "Table1", colIds: "B" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-R",
        }],
      ], chimpy);

      const formResp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(formResp.status, 200);
      const colIds = Object.values(formResp.data.formFieldsById).map((f: any) => f.colId);
      assert.includeMembers(colIds, ["A", "B", "C"]);
    });

    it("reads Reference choices whose display column a column rule hides", async function() {
      const { chimpy, nobody } = getCtx();
      const { serverUrl, docUrl, docId, sectionId } = await setupRefForm({
        name: "FormsShareRefColumn", refType: "Ref:Table1", restrict: "displayColumn",
      });
      const key = await publishForm(docUrl, docId, chimpy, sectionId);

      const resp = await axios.get(`${serverUrl}/api/s/${key}/forms/${sectionId}`, nobody);
      assert.equal(resp.status, 200);
      assert.sameMembers(refValuesFor(resp.data, "Pick"), ["Alpha", "Beta", "Gamma"]);
    });
  });
}
