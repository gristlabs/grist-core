import { createEmptyActionSummary } from "app/common/ActionSummary";
import { PatchItem } from "app/common/ActiveDocAPI";
import { CellValue, UserAction } from "app/common/DocActions";
import { DocStateComparisonDetails } from "app/common/DocState";
import { isList } from "app/common/gristTypes";
import { DocAPI, UserAPI } from "app/common/UserAPI";
import { GristObjCode } from "app/plugin/GristData";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { Patch } from "app/server/lib/Patch";
import { TestServer } from "test/gen-server/apiUtils";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

// The two success shapes of PatchItem, flattened for assertions: `count`
// is rows for "add"/"remove" and cells for "update".
interface ActionRecord {
  kind: PatchItem["kind"];
  tableId: string;
  count: number;
}

describe("Proposals", function() {
  this.timeout(40000);
  let server: TestServer;
  let owner: UserAPI;
  let wsId: number;
  let oldEnv: testUtils.EnvironmentSnapshot;
  let oldLogLevel: testUtils.NestedLogLevel;

  before(async function() {
    oldLogLevel = testUtils.nestLogLevel("error");
    oldEnv = new testUtils.EnvironmentSnapshot();
    const tmpDir = await createTmpDir();
    process.env.GRIST_DATA_DIR = tmpDir;
    server = new TestServer(this);
    await server.start(["home", "docs"]);
    const api = await server.createHomeApi("chimpy", "docs", true);
    await api.newOrg({ name: "testy", domain: "testy" });
    owner = await server.createHomeApi("chimpy", "testy", true);
    wsId = await owner.newWorkspace({ name: "ws" }, "current");
  });

  after(async function() {
    const api = await server.createHomeApi("chimpy", "docs");
    await api.deleteOrg("testy");
    await server.stop();
    oldEnv.restore();
    oldLogLevel.restore();
  });

  async function testApply(options: {
    modifyAfterProposal?: (trunkApi: DocAPI, forkApi: DocAPI) => Promise<void>,
    testAfterApply?: (trunkApi: DocAPI, forkApi: DocAPI) => Promise<void>,
  }) {
    const docId = await owner.newDoc({ name: "doc" }, wsId);
    const docApi = owner.getDocAPI(docId);
    await docApi.addRows("Table1", {
      A: ["x", "y"],
      B: [100, 200],
    });
    const forkResult = await docApi.fork();
    const forkApi = owner.getDocAPI(forkResult.urlId);
    await forkApi.updateRows("Table1", {
      id: [2],
      A: ["yy"],
    });
    const proposal = await forkApi.makeProposal();
    assert.equal(proposal.shortId, 1);
    assert.equal(proposal.comparison.comparison?.summary, "left");
    const changes = proposal.comparison.comparison?.details?.leftChanges;
    assert.deepEqual(changes, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [2],
          removeRows: [],
          addRows: [],
          columnDeltas: { A: { 2: [["y"], ["yy"]] } },
          columnRenames: [],
        },
      },
    });
    const query = "select A from Table1 where id = 2";
    assert.deepEqual((await docApi.sql(query)).records, [
      { fields: { A: "y" } },
    ]);
    assert.deepEqual((await forkApi.sql(query)).records, [
      { fields: { A: "yy" } },
    ]);
    await options.modifyAfterProposal?.(docApi, forkApi);
    await docApi.applyProposal(proposal.shortId);
    await options.testAfterApply?.(docApi, forkApi);
  }

  it("can make and apply a simple proposal", async function() {
    await testApply({
      async modifyAfterProposal() {},
      async testAfterApply(trunkApi) {
        const query = "select A from Table1 where id = 2";
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { A: "yy" } },
        ]);
      },
    });
  });

  it("can apply a proposal after a table rename", async function() {
    await testApply({
      async modifyAfterProposal(trunkApi) {
        await trunkApi.applyUserActions([
          ["RenameTable", "Table1", "Table2"],
        ]);
      },
      async testAfterApply(trunkApi) {
        const query = "select A from Table2 where id = 2";
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { A: "yy" } },
        ]);
      },
    });
  });

  it("can apply a proposal after a column rename", async function() {
    await testApply({
      async modifyAfterProposal(trunkApi) {
        await trunkApi.applyUserActions([
          ["RenameColumn", "Table1", "A", "AA"],
        ]);
      },
      async testAfterApply(trunkApi) {
        const query = "select AA from Table1 where id = 2";
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { AA: "yy" } },
        ]);
      },
    });
  });

  it("can apply a proposal that includes a formula column", async function() {
    const docId = await owner.newDoc({ name: "doc" }, wsId);
    const docApi = owner.getDocAPI(docId);
    await docApi.addRows("Table1", {
      A: ["x", "y"],
      B: [100, 200],
    });
    await docApi.applyUserActions([
      // Add a real formula column
      ["AddColumn", "Table1", "F", {
        type: "Text",
        isFormula: true,
        formula: '"quote " + str($A) + " unquote"',
      }],
      // Add an empty column
      ["AddColumn", "Table1", "E", {
        type: "Any",
        isFormula: true,
      }],
    ]);
    const forkResult = await docApi.fork();
    const forkApi = owner.getDocAPI(forkResult.urlId);
    await forkApi.updateRows("Table1", {
      id: [2],
      A: ["yy"],
      E: [20],
    });
    await forkApi.addRows("Table1", {
      A: ["zz"],
    });
    const proposal = await forkApi.makeProposal();
    await docApi.applyProposal(proposal.shortId);
    const query = "select A, E, F from Table1 where id = 2 or id = 3";
    assert.deepEqual((await docApi.sql(query)).records, [
      { fields: { A: "yy", E: 20, F: "quote yy unquote" } },
      { fields: { A: "zz", E: 0,  F: "quote zz unquote" } },
    ]);
  });

  describe("with Refs in added rows", function() {
    // `trunkAdvance` runs after the fork so source/target row id spaces
    // diverge, useful for exposing row id translation bugs.
    async function setupForkWithAdvance(opts: {
      trunkSeed: UserAction[],
      trunkAdvance?: UserAction[],
    }): Promise<{ trunk: DocAPI, fork: DocAPI }> {
      const docId = await owner.newDoc({ name: "doc" }, wsId);
      const trunk = owner.getDocAPI(docId);
      if (opts.trunkSeed.length > 0) {
        await trunk.applyUserActions(opts.trunkSeed);
      }
      const forkResult = await trunk.fork();
      const fork = owner.getDocAPI(forkResult.urlId);
      if (opts.trunkAdvance && opts.trunkAdvance.length > 0) {
        await trunk.applyUserActions(opts.trunkAdvance);
      }
      return { trunk, fork };
    }

    // Fork-side row ids mean nothing on the trunk, so these read references
    // back as the labels they point at rather than as ids.
    async function labelsById(api: DocAPI, tableId: string, colId: string) {
      const rows = await api.getRows(tableId);
      return new Map(rows.id.map((id, i) => [id, String(rows[colId][i])]));
    }

    function listedLabels(cell: CellValue, labels: Map<number, string>): string[] {
      if (!isList(cell)) { throw new Error(`expected a list, got ${JSON.stringify(cell)}`); }
      return cell.slice(1).map(id => labels.get(Number(id)) ?? `unknown row ${String(id)}`);
    }

    // One PatchItem per engine action in the patch's single bundle.
    async function applyAndGetActions(trunk: DocAPI, shortId: number): Promise<ActionRecord[]> {
      const result = await trunk.applyProposal(shortId);
      assert.isTrue(result.changes.log.applied,
        `patch not fully applied: ${JSON.stringify(result.changes.log.changes)}`);
      return result.changes.log.changes.map((c) => {
        if (c.kind === "error") { throw new Error(`unexpected error item: ${c.msg}`); }
        return {
          kind: c.kind,
          tableId: c.tableId,
          count: c.kind === "update" ? c.cellCount : c.rowCount,
        };
      });
    }

    it("translates a Ref to a row added in the same proposal", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "customer", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "Bob" }],
          ["AddRecord", "Customers", null, { name: "Dave" }],
        ],
      });
      const rA = await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Carol" }],
      ]);
      const carolForkId: number = rA.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Orders", null, { qty: 3, customer: carolForkId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // The Ref points at a row this proposal adds, so it is held back
      // from the Add and set by an update later in the same bundle.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Customers", count: 1 },
        { kind: "add", tableId: "Orders", count: 1 },
        { kind: "update", tableId: "Orders", count: 1 },
      ]);
      const result = await trunk.sql(
        "select c.name as cn, o.qty " +
        "from Orders o join Customers c on c.id = o.customer",
      );
      assert.deepEqual(result.records, [{ fields: { cn: "Carol", qty: 3 } }]);
    });

    it("translates a self-Ref to a row added in the same proposal", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Comments", [
            { id: "body", type: "Text", isFormula: false },
            { id: "parent_id", type: "Ref:Comments", isFormula: false },
          ]],
          ["AddRecord", "Comments", null, { body: "ancestor" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Comments", null, { body: "trunk-only-A" }],
          ["AddRecord", "Comments", null, { body: "trunk-only-B" }],
        ],
      });
      const rA = await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "Hello?" }],
      ]);
      const parentForkId: number = rA.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "Yes", parent_id: parentForkId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // One Add for both rows, since the reply's self-Ref is kept out of
      // it, then that Ref is set once both temp ids are known.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Comments", count: 2 },
        { kind: "update", tableId: "Comments", count: 1 },
      ]);
      const result = await trunk.sql(
        "select c.body as child, p.body as parent " +
        "from Comments c left join Comments p on c.parent_id = p.id " +
        "where c.body = 'Yes'",
      );
      assert.deepEqual(result.records, [{ fields: { child: "Yes", parent: "Hello?" } }]);
    });

    it("translates a self-Ref where the reply was drafted first", async function() {
      // Add the reply row before the parent row, so source row ids put the
      // dependency in reverse order. Exercises within-table deferral.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Comments", [
            { id: "body", type: "Text", isFormula: false },
            { id: "parent_id", type: "Ref:Comments", isFormula: false },
          ]],
          ["AddRecord", "Comments", null, { body: "ancestor" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Comments", null, { body: "trunk-only" }],
        ],
      });
      // Reply first, with a placeholder parent_id of 0.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "Yes" }],
      ]);
      const replyForkId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "Hello?" }],
      ]);
      const parentForkId: number = rB.retValues[0];
      // Update the reply's parent_id to point at the parent.
      await fork.applyUserActions([
        ["UpdateRecord", "Comments", replyForkId, { parent_id: parentForkId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // Both rows add first, then the reply's parent_id is set.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Comments", count: 2 },
        { kind: "update", tableId: "Comments", count: 1 },
      ]);
      const result = await trunk.sql(
        "select c.body as child, p.body as parent " +
        "from Comments c left join Comments p on c.parent_id = p.id " +
        "where c.body = 'Yes'",
      );
      assert.deepEqual(result.records, [{ fields: { child: "Yes", parent: "Hello?" } }]);
    });

    it("translates a RefList referencing new rows", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Tags", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Articles", [
            { id: "title", type: "Text", isFormula: false },
            { id: "tags", type: "RefList:Tags", isFormula: false },
          ]],
          ["AddRecord", "Tags", null, { name: "existing" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Tags", null, { name: "trunk-only" }],
          ["AddRecord", "Tags", null, { name: "trunk-only-2" }],
        ],
      });
      const rA = await fork.applyUserActions([
        ["AddRecord", "Tags", null, { name: "urgent" }],
        ["AddRecord", "Tags", null, { name: "draft" }],
      ]);
      const tagAId: number = rA.retValues[0];
      const tagBId: number = rA.retValues[1];
      await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "X", tags: ["L", tagAId, tagBId] }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // The RefList names rows this proposal adds, so the whole cell is
      // held back and set after both tables' Adds.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Tags", count: 2 },
        { kind: "add", tableId: "Articles", count: 1 },
        { kind: "update", tableId: "Articles", count: 1 },
      ]);
      const articles = await trunk.getRows("Articles");
      assert.lengthOf(articles.id, 1);
      assert.sameMembers(
        listedLabels(articles.tags[0], await labelsById(trunk, "Tags", "name")),
        ["draft", "urgent"]);
    });

    it("translates a three-table chain of Refs", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Companies", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Contacts", [
            { id: "name", type: "Text", isFormula: false },
            { id: "company", type: "Ref:Companies", isFormula: false },
          ]],
          ["AddTable", "Deals", [
            { id: "label", type: "Text", isFormula: false },
            { id: "company", type: "Ref:Companies", isFormula: false },
            { id: "contact", type: "Ref:Contacts", isFormula: false },
          ]],
          ["AddRecord", "Companies", null, { name: "OldCo" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Companies", null, { name: "trunk-only" }],
        ],
      });
      const rA = await fork.applyUserActions([
        ["AddRecord", "Companies", null, { name: "Acme" }],
      ]);
      const acmeId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Contacts", null, { name: "Alice", company: acmeId }],
      ]);
      const aliceId: number = rB.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Deals", null,
          { label: "BigOne", company: acmeId, contact: aliceId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // There is no table ordering left to lock: every Add lands before
      // any Ref cell is set, so the chain resolves whatever order the
      // summary happens to list the tables in. What matters is the phase
      // order, so assert that separately from the contents.
      assert.deepEqual(actions.map(a => a.kind), ["add", "add", "add", "update", "update"]);
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Companies", count: 1 },
        { kind: "add", tableId: "Contacts", count: 1 },
        { kind: "add", tableId: "Deals", count: 1 },
        { kind: "update", tableId: "Deals", count: 2 },
        { kind: "update", tableId: "Contacts", count: 1 },
      ]);
      const result = await trunk.sql(
        "select d.label, comp.name as cn, cont.name as ctn " +
        "from Deals d " +
        "join Companies comp on comp.id = d.company " +
        "join Contacts cont on cont.id = d.contact",
      );
      assert.deepEqual(result.records, [
        { fields: { label: "BigOne", cn: "Acme", ctn: "Alice" } },
      ]);
    });

    it("translates a two-table cycle in both directions", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          // Tables created without cycle-causing Refs first; the
          // primary_contact column on Companies has to be added after
          // Contacts exists, since you can't reference a table that
          // doesn't exist yet.
          ["AddTable", "Companies", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Contacts", [
            { id: "name", type: "Text", isFormula: false },
            { id: "company", type: "Ref:Companies", isFormula: false },
          ]],
          ["AddColumn", "Companies", "primary_contact",
            { type: "Ref:Contacts", isFormula: false }],
          ["AddRecord", "Companies", null, { name: "OldCo" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Companies", null, { name: "trunk-only" }],
        ],
      });
      // Add a Company and a Contact, then set the back edge.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Companies", null, { name: "Acme" }],
      ]);
      const acmeId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Contacts", null, { name: "Alice", company: acmeId }],
      ]);
      const aliceId: number = rB.retValues[0];
      await fork.applyUserActions([
        ["UpdateRecord", "Companies", acmeId, { primary_contact: aliceId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // Neither side of the cycle is privileged: both Refs are held back
      // from their Adds and set once both rows have landed, so both
      // directions come out right rather than one being nulled.
      assert.deepEqual(actions.map(a => a.kind), ["add", "add", "update", "update"]);
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Companies", count: 1 },
        { kind: "add", tableId: "Contacts", count: 1 },
        { kind: "update", tableId: "Companies", count: 1 },
        { kind: "update", tableId: "Contacts", count: 1 },
      ]);
      const result = await trunk.sql(
        "select comp.name as cn, cont.name as ctn " +
        "from Companies comp " +
        "left join Contacts cont on cont.id = comp.primary_contact " +
        "where comp.name = 'Acme'",
      );
      assert.deepEqual(result.records, [{ fields: { cn: "Acme", ctn: "Alice" } }]);
      const result2 = await trunk.sql(
        "select cont.name as ctn, comp.name as cn " +
        "from Contacts cont " +
        "join Companies comp on comp.id = cont.company " +
        "where cont.name = 'Alice'",
      );
      assert.deepEqual(result2.records, [{ fields: { ctn: "Alice", cn: "Acme" } }]);
    });

    it("does not translate Refs into untouched tables", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "customer", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "Bob" }],
          ["AddRecord", "Customers", null, { name: "Eve" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "Frank" }],
        ],
      });
      await fork.applyUserActions([
        ["AddRecord", "Orders", null, { qty: 7, customer: 2 }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      assert.sameDeepMembers(actions, [{ kind: "add", tableId: "Orders", count: 1 }]);
      const result = await trunk.sql(
        "select c.name as cn, o.qty from Orders o join Customers c on c.id = o.customer",
      );
      assert.deepEqual(result.records, [{ fields: { cn: "Bob", qty: 7 } }]);
    });

    it("translates Ref values on the update path", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "customer", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Orders", null, { qty: 1, customer: 1 }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "Bob" }],
          ["AddRecord", "Customers", null, { name: "Dave" }],
        ],
      });
      const rA = await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Carol" }],
      ]);
      const carolForkId: number = rA.retValues[0];
      await fork.applyUserActions([
        ["UpdateRecord", "Orders", 1, { customer: carolForkId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // 1 BulkAdd for the new Customer + 1 BulkUpdate for the existing
      // Order (one row, one cell).
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Customers", count: 1 },
        { kind: "update", tableId: "Orders", count: 1 },
      ]);
      const result = await trunk.sql(
        "select c.name as cn from Orders o " +
        "join Customers c on c.id = o.customer where o.id = 1",
      );
      assert.deepEqual(result.records, [{ fields: { cn: "Carol" } }]);
    });

    it("translates a self-RefList (cycle + RefList combined)", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Articles", [
            { id: "title", type: "Text", isFormula: false },
            { id: "related", type: "RefList:Articles", isFormula: false },
          ]],
          ["AddRecord", "Articles", null, { title: "ancestor" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Articles", null, { title: "trunk-only" }],
        ],
      });
      // Add A, B, C. A's related = [B, C].
      const rA = await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "B" }],
      ]);
      const bId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "C" }],
      ]);
      const cId: number = rB.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "A", related: ["L", bId, cId] }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // All three add together, since A's self-RefList is kept out of the
      // Add. It is set afterwards.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Articles", count: 3 },
        { kind: "update", tableId: "Articles", count: 1 },
      ]);
      // Fork-side row ids are meaningless on the trunk; look up by title.
      const articles = await trunk.getRows("Articles");
      const aIdx = articles.title.indexOf("A");
      assert.notEqual(aIdx, -1);
      assert.sameMembers(
        listedLabels(articles.related[aIdx], await labelsById(trunk, "Articles", "title")),
        ["B", "C"]);
    });

    it("translates a RefList mixing existing and new rows", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Tags", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Articles", [
            { id: "title", type: "Text", isFormula: false },
            { id: "tags", type: "RefList:Tags", isFormula: false },
          ]],
          ["AddRecord", "Tags", null, { name: "shared-tag" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Tags", null, { name: "trunk-only" }],
          ["AddRecord", "Tags", null, { name: "trunk-only-2" }],
        ],
      });
      // Add a new tag, and an Article whose tags include both the shared
      // existing tag (id 1, unchanged on both sides) and the new tag.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Tags", null, { name: "new-tag" }],
      ]);
      const newTagId: number = rA.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "X", tags: ["L", 1, newTagId] }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // The list mixes an existing tag with a new one. One new id is
      // enough to hold the whole cell back to the update.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Tags", count: 1 },
        { kind: "add", tableId: "Articles", count: 1 },
        { kind: "update", tableId: "Articles", count: 1 },
      ]);
      const articles = await trunk.getRows("Articles");
      assert.lengthOf(articles.id, 1);
      assert.sameMembers(
        listedLabels(articles.tags[0], await labelsById(trunk, "Tags", "name")),
        ["new-tag", "shared-tag"]);
    });

    it("holds back a whole RefList when some of its rows are new", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Articles", [
            { id: "title", type: "Text", isFormula: false },
            { id: "related", type: "RefList:Articles", isFormula: false },
          ]],
          ["AddRecord", "Articles", null, { title: "ancestor" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Articles", null, { title: "trunk-only" }],
        ],
      });
      // A is added first (lowest fork row id) and later updated to point
      // at B, C, and the shared ancestor row. The whole list is kept out of
      // A's Add, so all three rows add together, and it is set in full by
      // the update, preserving the passthrough ancestor id and the order.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "A" }],
      ]);
      const aId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Articles", null, { title: "B" }],
        ["AddRecord", "Articles", null, { title: "C" }],
      ]);
      const [bId, cId]: number[] = rB.retValues;
      await fork.applyUserActions([
        ["UpdateRecord", "Articles", aId, { related: ["L", bId, cId, 1] }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Articles", count: 3 },
        { kind: "update", tableId: "Articles", count: 1 },
      ]);
      const articles = await trunk.getRows("Articles");
      const aIdx = articles.title.indexOf("A");
      assert.notEqual(aIdx, -1);
      // deepEqual, not sameMembers: list order is preserved, and the shared
      // ancestor id passes through untranslated in its original position.
      assert.deepEqual(
        listedLabels(articles.related[aIdx], await labelsById(trunk, "Articles", "title")),
        ["B", "C", "ancestor"]);
    });

    it("handles add + update + remove in one proposal", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "customer", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "ToRemove" }],
          ["AddRecord", "Orders", null, { qty: 1, customer: 1 }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "trunk-only" }],
        ],
      });
      // On the fork: add Carol, add a new Order pointing at her, point
      // existing Order at Carol, remove ToRemove.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Carol" }],
      ]);
      const carolForkId: number = rA.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Orders", null, { qty: 5, customer: carolForkId }],
        ["UpdateRecord", "Orders", 1, { customer: carolForkId }],
        ["RemoveRecord", "Customers", 2],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // Phase order matters: removes, then adds, then updates. The two
      // updates are the existing Order's new customer and the added
      // Order's held-back Ref cell.
      assert.deepEqual(actions.map(a => a.kind), ["remove", "add", "add", "update", "update"]);
      assert.sameDeepMembers(actions, [
        { kind: "remove", tableId: "Customers", count: 1 },
        { kind: "add", tableId: "Customers", count: 1 },
        { kind: "add", tableId: "Orders", count: 1 },
        { kind: "update", tableId: "Orders", count: 1 },
        { kind: "update", tableId: "Orders", count: 1 },
      ]);
      const ordersResult = await trunk.sql(
        "select c.name as cn from Orders o " +
        "join Customers c on c.id = o.customer " +
        "order by o.id",
      );
      assert.deepEqual(ordersResult.records, [
        { fields: { cn: "Carol" } },
        { fields: { cn: "Carol" } },
      ]);
      const removed = await trunk.sql(
        "select name from Customers where name = 'ToRemove'",
      );
      assert.deepEqual(removed.records, []);
    });

    it("skips updates of rows that are also being removed", async function() {
      // Regression: the remove pass deletes the row; without Patch
      // filtering removed rows out of updateRows, the update pass would
      // throw on the missing row.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "ToRemove" }],
        ],
        trunkAdvance: [],
      });
      // Update + remove in one bundle.
      await fork.applyUserActions([
        ["UpdateRecord", "Customers", 2, { name: "renamed-then-removed" }],
        ["RemoveRecord", "Customers", 2],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      assert.sameDeepMembers(actions, [
        { kind: "remove", tableId: "Customers", count: 1 },
      ]);
      const rows = await trunk.sql(
        "select name from Customers order by id",
      );
      assert.deepEqual(rows.records, [
        { fields: { name: "Alice" } },
      ]);
    });

    it("does not delete the wrong trunk row on an add-then-remove transient", async function() {
      // Carol briefly takes fork row id 4, which on the trunk is Frank. The
      // fork nets to nothing, so the trunk must too. Mistaking this for a
      // recycle would delete Frank.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "Bob" }],
          ["AddRecord", "Customers", null, { name: "Eve" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "Frank" }],
        ],
      });
      // Carol gets fork row id 4 (no Frank on the fork). Add-then-remove
      // in one applyUserActions: net no-op on the fork.
      await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Carol" }],
        ["RemoveRecord", "Customers", 4],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      assert.deepEqual(actions, []);
      const rows = await trunk.sql(
        "select name from Customers order by id",
      );
      assert.deepEqual(rows.records, [
        { fields: { name: "Alice" } },
        { fields: { name: "Bob" } },
        { fields: { name: "Eve" } },
        { fields: { name: "Frank" } },
      ]);
    });

    it("applies a recycled row id as a remove and a fresh add", async function() {
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
          ]],
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "customer", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "Bob" }],
          ["AddRecord", "Customers", null, { name: "Eve" }],
          ["AddRecord", "Orders", null, { qty: 1, customer: 3 }],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "Frank" }],
        ],
      });
      // Remove Eve, then add Carol, who reuses Eve's fork row id 3. On the
      // trunk, id 3 is still Eve and Carol needs a fresh id past Frank's.
      await fork.applyUserActions([["RemoveRecord", "Customers", 3]]);
      const rC = await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Carol" }],
      ]);
      assert.equal(rC.retValues[0], 3);
      await fork.applyUserActions([
        ["AddRecord", "Orders", null, { qty: 2, customer: 3 }],
      ]);
      const proposal = await fork.makeProposal();
      await applyAndGetActions(trunk, proposal.shortId);
      assert.deepEqual(
        (await trunk.sql("select name from Customers order by id")).records,
        [
          { fields: { name: "Alice" } },
          { fields: { name: "Bob" } },
          { fields: { name: "Frank" } },
          { fields: { name: "Carol" } },
        ]);
      // The order that named Eve loses its customer, as on the fork, rather
      // than moving to Carol along with the id.
      const orders = await trunk.sql(
        "select o.qty, c.name as cn from Orders o " +
        "left join Customers c on c.id = o.customer order by o.id",
      );
      assert.deepEqual(orders.records, [
        { fields: { qty: 1, cn: null } },
        { fields: { qty: 2, cn: "Carol" } },
      ]);
    });

    it("adds rows with different column sets without nulling defaults", async function() {
      // Regression: without column-set grouping, untouched cells were
      // written as literal null instead of the column default (0 for
      // Numeric, "" for Text).
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
            { id: "age", type: "Numeric", isFormula: false },
            { id: "notes", type: "Text", isFormula: false },
          ]],
        ],
        trunkAdvance: [
          ["AddRecord", "Customers", null, { name: "trunk-only" }],
        ],
      });
      await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Alice" }],
        ["AddRecord", "Customers", null, { name: "Bob", age: 30 }],
        ["AddRecord", "Customers", null, { name: "Carol", notes: "hello" }],
      ]);
      const proposal = await fork.makeProposal();
      await applyAndGetActions(trunk, proposal.shortId);
      const rows = await trunk.sql(
        "select name, age, notes from Customers " +
        "where name in ('Alice', 'Bob', 'Carol') order by name",
      );
      assert.deepEqual(rows.records, [
        { fields: { name: "Alice", age: 0, notes: "" } },
        { fields: { name: "Bob",   age: 30, notes: "" } },
        { fields: { name: "Carol", age: 0, notes: "hello" } },
      ]);
    });

    it("keeps added rows in the order they were made", async function() {
      // Rex and Kit name a new customer, so their Ref waits for an update,
      // and they write different columns in their Adds than Tom does.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [{ id: "name", type: "Text", isFormula: false }]],
          ["AddTable", "Pets", [
            { id: "name", type: "Text", isFormula: false },
            { id: "owner", type: "Ref:Customers", isFormula: false },
          ]],
          ["AddRecord", "Customers", null, { name: "Ann" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Pets", null, { name: "trunk-pet" }],
        ],
      });
      const r = await fork.applyUserActions([["AddRecord", "Customers", null, { name: "Cat" }]]);
      const cat = r.retValues[0];
      await fork.applyUserActions([
        ["AddRecord", "Pets", null, { name: "Rex", owner: cat }],
        ["AddRecord", "Pets", null, { name: "Tom", owner: 1 }],
        ["AddRecord", "Pets", null, { name: "Kit", owner: cat }],
      ]);
      const proposal = await fork.makeProposal();
      await applyAndGetActions(trunk, proposal.shortId);
      const pets = await trunk.sql("select name from Pets order by manualSort");
      assert.deepEqual(pets.records.map(rec => rec.fields.name), ["trunk-pet", "Rex", "Tom", "Kit"]);
    });

    it("groups updates by changed-column-set", async function() {
      // Regression: disjoint changed columns must go in separate BulkUpdates
      // so the BulkUpdate doesn't null out cells the source didn't clear.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Orders", [
            { id: "qty", type: "Numeric", isFormula: false },
            { id: "label", type: "Text", isFormula: false },
          ]],
          ["AddRecord", "Orders", null, { qty: 1, label: "first" }],
          ["AddRecord", "Orders", null, { qty: 2, label: "second" }],
        ],
        trunkAdvance: [],
      });
      await fork.applyUserActions([
        ["UpdateRecord", "Orders", 1, { qty: 100 }],
        ["UpdateRecord", "Orders", 2, { label: "edited" }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      assert.sameDeepMembers(actions, [
        { kind: "update", tableId: "Orders", count: 1 },
        { kind: "update", tableId: "Orders", count: 1 },
      ]);
      const rows = await trunk.sql(
        "select id, qty, label from Orders order by id",
      );
      assert.deepEqual(rows.records, [
        { fields: { id: 1, qty: 100, label: "first" } },
        { fields: { id: 2, qty: 2, label: "edited" } },
      ]);
    });

    it("sets held-back columns separately when they differ across rows", async function() {
      // Regression: two rows setting the same columns, but with the Refs
      // to new rows in different ones. A single BulkUpdate would null out
      // each row's Ref to "ancestor", which went in with its Add.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Comments", [
            { id: "body", type: "Text", isFormula: false },
            { id: "parent_id", type: "Ref:Comments", isFormula: false },
            { id: "quoted_id", type: "Ref:Comments", isFormula: false },
          ]],
          ["AddRecord", "Comments", null, { body: "ancestor" }],
        ],
        trunkAdvance: [
          ["AddRecord", "Comments", null, { body: "trunk-only" }],
        ],
      });
      // A.parent_id=B and B.quoted_id=A; both also reference "ancestor"
      // (row 1) on the OTHER column inline. A.parent_id is set via
      // UpdateRecord since B doesn't exist at AddRecord time.
      const rA = await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "A", quoted_id: 1 }],
      ]);
      const aId: number = rA.retValues[0];
      const rB = await fork.applyUserActions([
        ["AddRecord", "Comments", null, { body: "B", parent_id: 1, quoted_id: aId }],
      ]);
      const bId: number = rB.retValues[0];
      await fork.applyUserActions([
        ["UpdateRecord", "Comments", aId, { parent_id: bId }],
      ]);
      const proposal = await fork.makeProposal();
      const actions = await applyAndGetActions(trunk, proposal.shortId);
      // What goes in each Add differs too, so 2 Adds + 2 updates.
      assert.sameDeepMembers(actions, [
        { kind: "add", tableId: "Comments", count: 1 },
        { kind: "add", tableId: "Comments", count: 1 },
        { kind: "update", tableId: "Comments", count: 1 },
        { kind: "update", tableId: "Comments", count: 1 },
      ]);
      const rows = await trunk.sql(
        "select c.body, p.body as parent, q.body as quoted " +
        "from Comments c " +
        "left join Comments p on p.id = c.parent_id " +
        "left join Comments q on q.id = c.quoted_id " +
        "where c.body in ('A', 'B') " +
        "order by c.body",
      );
      assert.deepEqual(rows.records, [
        { fields: { body: "A", parent: "B", quoted: "ancestor" } },
        { fields: { body: "B", parent: "ancestor", quoted: "A" } },
      ]);
    });

    describe("when the trunk has removed rows", function() {
      // Row 3 (Cat) is the last row, so a new row on the trunk after
      // removing it takes its id.
      async function setup(trunkAdvance: UserAction[]) {
        return setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Customers", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Orders", [
              { id: "qty", type: "Numeric", isFormula: false },
              { id: "customer", type: "Ref:Customers", isFormula: false },
            ]],
            ["AddRecord", "Customers", 1, { name: "Ann" }],
            ["AddRecord", "Customers", 2, { name: "Ben" }],
            ["AddRecord", "Customers", 3, { name: "Cat" }],
          ],
          trunkAdvance,
        });
      }

      const reuseCat: UserAction[] = [
        ["RemoveRecord", "Customers", 3],
        ["AddRecord", "Customers", null, { name: "Dan" }],
      ];

      async function assertRefused(trunk: DocAPI, shortId: number, pattern: RegExp) {
        const before = await trunk.sql("select * from Customers order by id");
        const result = await trunk.applyProposal(shortId);
        assert.isFalse(result.changes.log.applied);
        const [item] = result.changes.log.changes;
        assert.match(item.kind === "error" ? item.msg : "", pattern);
        assert.deepEqual((await trunk.sql("select * from Customers order by id")).records, before.records);
        assert.equal(result.changes.proposal.status.status, undefined);
      }

      it("refuses to change a row whose id the trunk reused", async function() {
        const { trunk, fork } = await setup(reuseCat);
        assert.deepEqual((await trunk.getRows("Customers")).name, ["Ann", "Ben", "Dan"]);
        await fork.applyUserActions([["UpdateRecord", "Customers", 3, { name: "Cathy" }]]);
        const proposal = await fork.makeProposal();
        await assertRefused(trunk, proposal.shortId, /changes row 3 of Customers, which was removed/);
      });

      it("refuses to change a row the trunk removed", async function() {
        const { trunk, fork } = await setup([["RemoveRecord", "Customers", 2]]);
        await fork.applyUserActions([["UpdateRecord", "Customers", 2, { name: "Benny" }]]);
        const proposal = await fork.makeProposal();
        await assertRefused(trunk, proposal.shortId, /changes row 2 of Customers, which was removed/);
      });

      it("refuses a reference to a row whose id the trunk reused", async function() {
        const { trunk, fork } = await setup(reuseCat);
        await fork.applyUserActions([["AddRecord", "Orders", null, { qty: 1, customer: 3 }]]);
        const proposal = await fork.makeProposal();
        await assertRefused(trunk, proposal.shortId, /Orders.customer to refer to row 3 of Customers/);
        assert.deepEqual((await trunk.getRows("Orders")).id, []);
      });

      it("lets a reference to a row the trunk removed dangle", async function() {
        const { trunk, fork } = await setup([["RemoveRecord", "Customers", 3]]);
        await fork.applyUserActions([["AddRecord", "Orders", null, { qty: 1, customer: 3 }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual((await trunk.getRows("Orders")).customer, [3]);
        assert.deepEqual((await trunk.getRows("Customers")).name, ["Ann", "Ben"]);
      });

      it("leaves the trunk's new row alone when both sides removed the old one", async function() {
        const { trunk, fork } = await setup(reuseCat);
        await fork.applyUserActions([
          ["RemoveRecord", "Customers", 3],
          ["UpdateRecord", "Customers", 1, { name: "Annie" }],
        ]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual((await trunk.getRows("Customers")).name, ["Annie", "Ben", "Dan"]);
      });
    });

    it("refuses to apply a summary marked mayBeIncomplete", async function() {
      // Truncated summaries read dropped cells as "?", which Patch would
      // apply as nulls over real data. The guard fails fast instead; no
      // engine access happens, so a stub ActiveDoc is enough.
      const fakeDoc: any = { docData: { getMetaTable: () => ({}) } };
      const patch = new Patch(fakeDoc, makeExceptionalDocSession("system"));
      const details: DocStateComparisonDetails = {
        leftChanges: {
          tableRenames: [],
          tableDeltas: {
            T: {
              updateRows: [1], removeRows: [], addRows: [], columnRenames: [],
              columnDeltas: { A: { 1: [["x"], "?"] } },
              mayBeIncomplete: true,
            },
          },
        },
        rightChanges: { tableRenames: [], tableDeltas: {} },
      };
      const log = await patch.applyChanges(details, createEmptyActionSummary());
      assert.isFalse(log.applied);
      assert.lengthOf(log.changes, 1);
      const [item] = log.changes;
      assert.equal(item.kind, "error");
      assert.match(item.kind === "error" ? item.msg : "", /may be incomplete/);
    });

    it("counts a patch with nothing to do as applied", async function() {
      // A proposal can resolve to no actions at all. Reporting that as
      // unapplied would leave it open forever, offering an Accept button
      // with nothing behind it.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
            { id: "shouty", type: "Text", isFormula: true, formula: "$name.upper()" },
          ]],
          ["AddRecord", "Customers", null, { name: "Alice" }],
        ],
      });
      // Touch only the formula column, which Patch skips.
      await fork.applyUserActions([
        ["ModifyColumn", "Customers", "shouty", { formula: "$name.lower()" }],
      ]);
      const proposal = await fork.makeProposal();
      const result = await trunk.applyProposal(proposal.shortId);
      assert.isTrue(result.changes.log.applied);
      assert.deepEqual(result.changes.log.changes, []);
      // And the proposal is closed out, rather than left open.
      assert.equal(result.changes.proposal.status.status, "applied");
    });

    describe("with two-way references", function() {
      // Pets.owner is a Ref:Owners, and Owners.Pets is its reverse RefList.
      // The engine keeps the two in step, so a change to either side shows
      // up in the summary on both.
      async function setup(options: { oneToOne?: boolean } = {}) {
        const { trunk, fork } = await setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Owners", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Pets", [
              { id: "name", type: "Text", isFormula: false },
              { id: "owner", type: "Ref:Owners", isFormula: false },
            ]],
            ["AddReverseColumn", "Pets", "owner"],
            ["AddRecord", "Owners", null, { name: "Ann" }],
            ["AddRecord", "Owners", null, { name: "Ben" }],
            ["AddRecord", "Pets", null, { name: "Rex", owner: 1 }],
            ["AddRecord", "Pets", null, { name: "Tom", owner: 2 }],
            ...(options.oneToOne ? [["ModifyColumn", "Owners", "Pets", { type: "Ref:Pets" }] as UserAction] : []),
          ],
          trunkAdvance: [
            ["AddRecord", "Owners", null, { name: "trunk-only" }],
            ["AddRecord", "Pets", null, { name: "trunk-pet" }],
          ],
        });
        return { trunk, fork };
      }

      // Each owner's pets, and each pet's owner, both by name.
      async function state(api: DocAPI) {
        const owners = await labelsById(api, "Owners", "name");
        const pets = await labelsById(api, "Pets", "name");
        const ownerRows = await api.getRows("Owners");
        const petRows = await api.getRows("Pets");
        return {
          pets: Object.fromEntries(ownerRows.id.map((id, i) =>
            [owners.get(id), listedLabels(ownerRows.Pets[i] ?? [GristObjCode.List], pets)])),
          owner: Object.fromEntries(petRows.id.map((id, i) =>
            [pets.get(id), owners.get(Number(petRows.owner[i])) ?? null])),
        };
      }

      it("moves a pet to a new owner", async function() {
        const { trunk, fork } = await setup();
        const r = await fork.applyUserActions([["AddRecord", "Owners", null, { name: "Cat" }]]);
        await fork.applyUserActions([["UpdateRecord", "Pets", 1, { owner: r.retValues[0] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual(await state(trunk), {
          pets: { "Ann": [], "Ben": ["Tom"], "trunk-only": [], "Cat": ["Rex"] },
          owner: { "Rex": "Cat", "Tom": "Ben", "trunk-pet": null },
        });
      });

      it("gives an owner a new pet, from the owner's side", async function() {
        const { trunk, fork } = await setup();
        const r = await fork.applyUserActions([["AddRecord", "Pets", null, { name: "Kit" }]]);
        await fork.applyUserActions([["UpdateRecord", "Owners", 1, { Pets: ["L", 1, r.retValues[0]] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual(await state(trunk), {
          pets: { "Ann": ["Rex", "Kit"], "Ben": ["Tom"], "trunk-only": [] },
          owner: { "Rex": "Ann", "Tom": "Ben", "trunk-pet": null, "Kit": "Ann" },
        });
      });

      it("swaps pets between existing owners", async function() {
        const { trunk, fork } = await setup();
        await fork.applyUserActions([["BulkUpdateRecord", "Pets", [1, 2], { owner: [2, 1] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual(await state(trunk), {
          pets: { "Ann": ["Tom"], "Ben": ["Rex"], "trunk-only": [] },
          owner: { "Rex": "Ben", "Tom": "Ann", "trunk-pet": null },
        });
      });

      it("adds an owner and a pet that point at each other", async function() {
        const { trunk, fork } = await setup();
        const r = await fork.applyUserActions([["AddRecord", "Owners", null, { name: "Cat" }]]);
        await fork.applyUserActions([["AddRecord", "Pets", null, { name: "Kit", owner: r.retValues[0] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual(await state(trunk), {
          pets: { "Ann": ["Rex"], "Ben": ["Tom"], "trunk-only": [], "Cat": ["Kit"] },
          owner: { "Rex": "Ann", "Tom": "Ben", "trunk-pet": null, "Kit": "Cat" },
        });
      });

      it("reorders an owner's pets", async function() {
        // Only Ann's list changes, since every pet keeps its owner.
        const { trunk, fork } = await setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Owners", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Pets", [
              { id: "name", type: "Text", isFormula: false },
              { id: "owner", type: "Ref:Owners", isFormula: false },
            ]],
            ["AddReverseColumn", "Pets", "owner"],
            ["AddRecord", "Owners", null, { name: "Ann" }],
            ["AddRecord", "Pets", null, { name: "Rex", owner: 1 }],
            ["AddRecord", "Pets", null, { name: "Kit", owner: 1 }],
          ],
        });
        await fork.applyUserActions([["UpdateRecord", "Owners", 1, { Pets: ["L", 2, 1] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual((await state(trunk)).pets.Ann, ["Kit", "Rex"]);
      });

      describe("when one-to-one", function() {
        // Both sides are Refs, so each owner has at most one pet. The engine
        // checks that after every action, not just at the end of a bundle.
        async function pairs(api: DocAPI) {
          const owners = await labelsById(api, "Owners", "name");
          const pets = await labelsById(api, "Pets", "name");
          const ownerRows = await api.getRows("Owners");
          const petRows = await api.getRows("Pets");
          return {
            pet: Object.fromEntries(ownerRows.id.map((id, i) =>
              [owners.get(id), pets.get(Number(ownerRows.Pets[i])) ?? null])),
            owner: Object.fromEntries(petRows.id.map((id, i) =>
              [pets.get(id), owners.get(Number(petRows.owner[i])) ?? null])),
          };
        }

        it("swaps pets when one is also renamed", async function() {
          const { trunk, fork } = await setup({ oneToOne: true });
          // Rex's row writes a different set of columns than Tom's, so the
          // two land in separate updates.
          await fork.applyUserActions([
            ["BulkUpdateRecord", "Pets", [1, 2], { owner: [2, 1] }],
            ["UpdateRecord", "Pets", 1, { name: "Rexy" }],
          ]);
          const proposal = await fork.makeProposal();
          await applyAndGetActions(trunk, proposal.shortId);
          assert.deepEqual(await pairs(trunk), {
            pet: { "Ann": "Tom", "Ben": "Rexy", "trunk-only": null },
            owner: { "Rexy": "Ben", "Tom": "Ann", "trunk-pet": null },
          });
        });

        it("hands a removed pet's owner to a new pet", async function() {
          const { trunk, fork } = await setup({ oneToOne: true });
          // Ann is only free once Rex is gone, so the remove has to come first.
          await fork.applyUserActions([
            ["RemoveRecord", "Pets", 1],
            ["AddRecord", "Pets", null, { name: "Kit", owner: 1 }],
          ]);
          const proposal = await fork.makeProposal();
          await applyAndGetActions(trunk, proposal.shortId);
          assert.deepEqual(await pairs(trunk), {
            pet: { "Ann": "Kit", "Ben": "Tom", "trunk-only": null },
            owner: { "Tom": "Ben", "trunk-pet": null, "Kit": "Ann" },
          });
        });

        it("hands an owner over to a new pet", async function() {
          const { trunk, fork } = await setup({ oneToOne: true });
          // The Add for Kit comes before the update that frees Ann.
          await fork.applyUserActions([
            ["UpdateRecord", "Pets", 1, { owner: 0 }],
            ["AddRecord", "Pets", null, { name: "Kit", owner: 1 }],
          ]);
          const proposal = await fork.makeProposal();
          await applyAndGetActions(trunk, proposal.shortId);
          assert.deepEqual(await pairs(trunk), {
            pet: { "Ann": "Kit", "Ben": "Tom", "trunk-only": null },
            owner: { "Rex": null, "Tom": "Ben", "trunk-pet": null, "Kit": "Ann" },
          });
        });
      });

      it("drops a reorder of a list the trunk also changed", async function() {
        const { trunk, fork } = await setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Owners", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Pets", [
              { id: "name", type: "Text", isFormula: false },
              { id: "owner", type: "Ref:Owners", isFormula: false },
            ]],
            ["AddReverseColumn", "Pets", "owner"],
            ["AddRecord", "Owners", null, { name: "Ann" }],
            ["AddRecord", "Pets", null, { name: "Rex", owner: 1 }],
            ["AddRecord", "Pets", null, { name: "Kit", owner: 1 }],
          ],
          // Meanwhile, the trunk gives Ann another pet.
          trunkAdvance: [["AddRecord", "Pets", null, { name: "Max", owner: 1 }]],
        });
        await fork.applyUserActions([["UpdateRecord", "Owners", 1, { Pets: ["L", 2, 1] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        // Writing the fork's list would have taken Max from Ann.
        assert.deepEqual(await state(trunk), {
          pets: { Ann: ["Rex", "Kit", "Max"] },
          owner: { Rex: "Ann", Kit: "Ann", Max: "Ann" },
        });
      });

      it("keeps a reorder when the trunk changed other cells of the row in bulk", async function() {
        // Eleven owners, so a bulk change to all of them is past the default
        // row cap of a summary.
        const names = ["Ann", ...Array.from({ length: 10 }, (_, i) => `O${i}`)];
        const { trunk, fork } = await setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Owners", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Pets", [
              { id: "name", type: "Text", isFormula: false },
              { id: "owner", type: "Ref:Owners", isFormula: false },
            ]],
            ["AddReverseColumn", "Pets", "owner"],
            ["BulkAddRecord", "Owners", names.map((_, i) => i + 1), { name: names }],
            ["AddRecord", "Pets", null, { name: "Rex", owner: 1 }],
            ["AddRecord", "Pets", null, { name: "Kit", owner: 1 }],
          ],
          trunkAdvance: [
            ["BulkUpdateRecord", "Owners", names.map((_, i) => i + 1), { name: names.map(n => `${n}!`) }],
          ],
        });
        await fork.applyUserActions([["UpdateRecord", "Owners", 1, { Pets: ["L", 2, 1] }]]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        assert.deepEqual((await state(trunk)).pets["Ann!"], ["Kit", "Rex"]);
      });

      it("handles a many-to-many pair, set from both sides", async function() {
        const { trunk, fork } = await setupForkWithAdvance({
          trunkSeed: [
            ["AddTable", "Tags", [{ id: "name", type: "Text", isFormula: false }]],
            ["AddTable", "Posts", [
              { id: "title", type: "Text", isFormula: false },
              { id: "tags", type: "RefList:Tags", isFormula: false },
            ]],
            ["AddReverseColumn", "Posts", "tags"],
            ["AddRecord", "Tags", null, { name: "old" }],
            ["AddRecord", "Posts", null, { title: "P1", tags: ["L", 1] }],
          ],
          trunkAdvance: [
            ["AddRecord", "Tags", null, { name: "trunk-tag" }],
            ["AddRecord", "Posts", null, { title: "trunk-post" }],
          ],
        });
        // One new tag set from the post's side, another from the tag's.
        const rTag = await fork.applyUserActions([
          ["AddRecord", "Tags", null, { name: "new" }],
          ["AddRecord", "Posts", null, { title: "P2" }],
        ]);
        const [newTag, p2] = rTag.retValues;
        await fork.applyUserActions([
          ["UpdateRecord", "Posts", 1, { tags: ["L", 1, newTag] }],
          ["AddRecord", "Tags", null, { name: "other", Posts: ["L", 1, p2] }],
        ]);
        const proposal = await fork.makeProposal();
        await applyAndGetActions(trunk, proposal.shortId);
        const tags = await labelsById(trunk, "Tags", "name");
        const posts = await labelsById(trunk, "Posts", "title");
        const postRows = await trunk.getRows("Posts");
        const tagRows = await trunk.getRows("Tags");
        assert.deepEqual(
          Object.fromEntries(postRows.id.map((id, i) =>
            [posts.get(id), listedLabels(postRows.tags[i] ?? [GristObjCode.List], tags)])),
          { "P1": ["old", "new", "other"], "trunk-post": [], "P2": ["other"] });
        assert.deepEqual(
          Object.fromEntries(tagRows.id.map((id, i) =>
            [tags.get(id), listedLabels(tagRows.Posts[i] ?? [GristObjCode.List], posts)])),
          { "old": ["P1"], "trunk-tag": [], "new": ["P1"], "other": ["P1", "P2"] });
      });
    });

    it("leaves the document untouched when the engine rejects the bundle", async function() {
      // Each customer has at most one desk, and each desk one customer.
      const { trunk, fork } = await setupForkWithAdvance({
        trunkSeed: [
          ["AddTable", "Desks", [{ id: "label", type: "Text", isFormula: false }]],
          ["AddTable", "Customers", [
            { id: "name", type: "Text", isFormula: false },
            { id: "desk", type: "Ref:Desks", isFormula: false },
          ]],
          ["AddReverseColumn", "Customers", "desk"],
          ["ModifyColumn", "Desks", "Customers", { type: "Ref:Customers" }],
          ["AddRecord", "Desks", null, { label: "D1" }],
          ["AddRecord", "Customers", null, { name: "Alice" }],
          ["AddRecord", "Customers", null, { name: "Zoe" }],
        ],
      });
      // Two adds and an update, in that order within the bundle.
      await fork.applyUserActions([
        ["AddRecord", "Customers", null, { name: "Bob" }],
        ["AddRecord", "Customers", null, { name: "Carol" }],
        ["UpdateRecord", "Customers", 1, { desk: 1 }],
      ]);
      const proposal = await fork.makeProposal();
      // Give the desk to Zoe meanwhile. The engine then rejects the update
      // giving it to Alice, after the adds in the same bundle have already
      // been processed. No guard in Patch catches this one.
      await trunk.applyUserActions([["UpdateRecord", "Customers", 2, { desk: 1 }]]);
      const before = await trunk.sql("select id, name, desk from Customers order by id");

      const result = await trunk.applyProposal(proposal.shortId);
      assert.isFalse(result.changes.log.applied);
      const [item] = result.changes.log.changes;
      assert.match(item.kind === "error" ? item.msg : "", /UNIQUE reference constraint/);

      // The adds were in the same bundle as the failing update, so none
      // of them landed: no half-applied wreckage to clean up.
      const after = await trunk.sql("select id, name, desk from Customers order by id");
      assert.deepEqual(after.records, before.records);
      assert.lengthOf(after.records, 2);
    });
  });
});
