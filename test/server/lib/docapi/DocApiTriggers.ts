/**
 * Tests for trigger CRUD operations:
 * - GET /docs/{did}/triggers
 * - POST /docs/{did}/triggers
 * - PATCH /docs/{did}/triggers
 * - POST /docs/{did}/triggers/delete
 * - GET /docs/{did}/triggers/monitor
 */

import { DocAPI } from "app/common/UserAPI";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/helpers";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("DocApiTriggers", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addTriggersTests, "docapi-triggers", {
    extraEnv: {
      ALLOWED_WEBHOOK_DOMAINS: "*",
    },
  });
});

function addTriggersTests(getCtx: () => TestContext) {
  async function getTableRef(docApi: DocAPI, tableId: string): Promise<number> {
    const records = await docApi.getRecords("_grist_Tables", { filters: { tableId: [tableId] } });
    return records[0].id as number;
  }

  let docApi: DocAPI;

  beforeEach(async function() {
    const docId = await getCtx().getOrCreateTestDoc();
    docApi = getCtx().userApi.getDocAPI(docId);
  });

  afterEach(async function() {
    // Clean up all triggers after each test.
    const list = await docApi.getTriggers();
    if (list.records.length > 0) {
      await docApi.removeTriggers({ ids: list.records.map(r => r.id) });
    }
  });

  it("should return empty list for new doc", async function() {
    const res = await docApi.getTriggers();
    assert.deepEqual(res.records, []);
  });

  it("should create a trigger", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const res = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "T1", enabled: true } }],
    });
    assert.lengthOf(res.records, 1);
    assert.isNumber(res.records[0].id);

    const list = await docApi.getTriggers();
    assert.lengthOf(list.records, 1);
    assert.equal(list.records[0].fields.label, "T1");
    assert.equal(list.records[0].fields.tableRef, tableRef);
    assert.equal(list.records[0].fields.enabled, true);
  });

  it("should create multiple triggers at once", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const res = await docApi.addTriggers({
      records: [
        { fields: { tableRef, label: "A" } },
        { fields: { tableRef, label: "B" } },
      ],
    });
    assert.lengthOf(res.records, 2);

    const list = await docApi.getTriggers();
    assert.lengthOf(list.records, 2);
  });

  it("should reject create without tableRef", async function() {
    await assert.isRejected(
      docApi.addTriggers({ records: [{ fields: { tableRef: undefined as any } }] }),
    );
  });

  it("should update trigger fields", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "Before", memo: "old" } }],
    });
    const id = records[0].id;

    await docApi.updateTriggers({
      records: [{ id, fields: { label: "After", memo: "new" } }],
    });

    const list = await docApi.getTriggers();
    const trigger = list.records.find(r => r.id === id)!;
    assert.equal(trigger.fields.label, "After");
    assert.equal(trigger.fields.memo, "new");
  });

  it("should update trigger with email action", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "Email test" } }],
    });
    const id = records[0].id;

    const emailAction = JSON.stringify([{
      type: "email",
      to: "test@example.com",
      subject: "Hello",
      body: "World",
    }]);

    await docApi.updateTriggers({
      records: [{ id, fields: { actions: emailAction } }],
    });

    const list = await docApi.getTriggers();
    const trigger = list.records.find(r => r.id === id)!;
    const actions = JSON.parse(trigger.fields.actions!);
    assert.lengthOf(actions, 1);
    assert.equal(actions[0].type, "email");
    assert.equal(actions[0].to, "test@example.com");
    assert.equal(actions[0].subject, "Hello");
    assert.equal(actions[0].body, "World");
  });

  it("should update trigger with webhook action and store secrets", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "Webhook test" } }],
    });
    const id = records[0].id;

    const webhookAction = JSON.stringify([{
      type: "webhook",
      url: "https://example.com/hook",
      authorization: "Bearer secret123",
    }]);

    await docApi.updateTriggers({
      records: [{ id, fields: { actions: webhookAction } }],
    });

    const list = await docApi.getTriggers();
    const trigger = list.records.find(r => r.id === id)!;
    const actions = JSON.parse(trigger.fields.actions!);
    assert.lengthOf(actions, 1);
    assert.equal(actions[0].type, "webhook");
    assert.equal(actions[0].url, "https://example.com/hook");
    assert.equal(actions[0].authorization, "Bearer secret123");
    assert.isString(actions[0].id);
  });

  it("should enable and disable a trigger", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, enabled: true } }],
    });
    const id = records[0].id;

    await docApi.updateTriggers({
      records: [{ id, fields: { enabled: false } }],
    });

    const list = await docApi.getTriggers();
    const trigger = list.records.find(r => r.id === id)!;
    assert.equal(trigger.fields.enabled, false);
  });

  it("should delete a trigger", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "ToDelete" } }],
    });

    await docApi.removeTriggers({ ids: [records[0].id] });

    const list = await docApi.getTriggers();
    assert.lengthOf(list.records, 0);
  });

  it("should delete multiple triggers at once", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [
        { fields: { tableRef, label: "Del1" } },
        { fields: { tableRef, label: "Del2" } },
      ],
    });

    await docApi.removeTriggers({ ids: records.map(r => r.id) });

    const list = await docApi.getTriggers();
    assert.lengthOf(list.records, 0);
  });

  it("should return empty monitor log and pending", async function() {
    const monitor = await docApi.getTriggerMonitor();
    assert.isArray(monitor.delivered);
    assert.isArray(monitor.pending);
  });

  it("should work with mixed email and webhook actions", async function() {
    const tableRef = await getTableRef(docApi, "Table1");
    const { records } = await docApi.addTriggers({
      records: [{ fields: { tableRef, label: "Mixed" } }],
    });
    const id = records[0].id;

    const mixedActions = JSON.stringify([
      { type: "email", to: "a@b.com", subject: "S", body: "B" },
      { type: "webhook", url: "https://example.com/w" },
    ]);

    await docApi.updateTriggers({
      records: [{ id, fields: { actions: mixedActions } }],
    });

    const list = await docApi.getTriggers();
    const trigger = list.records.find(r => r.id === id)!;
    const actions = JSON.parse(trigger.fields.actions!);
    assert.lengthOf(actions, 2);
    assert.equal(actions[0].type, "email");
    assert.equal(actions[0].to, "a@b.com");
    assert.equal(actions[1].type, "webhook");
    assert.equal(actions[1].url, "https://example.com/w");

    // Update just the email subject
    actions[0].subject = "Updated";
    await docApi.updateTriggers({
      records: [{ id, fields: { actions: JSON.stringify(actions) } }],
    });

    const updated = await docApi.getTriggers();
    const updatedActions = JSON.parse(updated.records.find(r => r.id === id)!.fields.actions!);
    assert.equal(updatedActions[0].subject, "Updated");
    assert.equal(updatedActions[1].url, "https://example.com/w");
  });
}
