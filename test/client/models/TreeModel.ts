import { TableData } from "app/client/models/TableData";
import { find, fixIndents, fromTableData, TreeItemRecord, TreeNodeRecord } from "app/client/models/TreeModel";
import { nativeCompare } from "app/common/gutil";
import { assert } from "chai";
import flatten = require("lodash/flatten");
import noop = require("lodash/noop");
import sinon = require("sinon");

const buildDom = noop as any;

interface TreeRecord { indentation: number; id: number; name: string; pagePos: number; }

// builds a tree model from ['A0', 'B1', ...] where 'A0' reads {id: 'A', indentation: 0}. Spy on
function simpleArray(array: string[]) {
  return array.map((s: string, id: number) => ({ id, name: s[0], indentation: Number(s[1]), pagePos: id }));
}

function toSimpleArray(records: TreeRecord[]) {
  return records.map((rec) => rec.name + rec.indentation);
}

// return ['a', ['b']] if item has name 'a' and one children with name 'b'.
function toArray(item: any) {
  const name = item.storage.records[item.index].name;
  const children = flatten(item.children().get().map(toArray));
  return children.length ? [name, children] : [name];
}

function toJson(model: any) {
  return JSON.stringify(flatten(model.children().get().map(toArray)));
}

function findItems(model: TreeNodeRecord, names: string[]) {
  return names.map(name => findItem(model, name));
}

function findItem(model: TreeNodeRecord, name: string) {
  return find(model, (item: TreeItemRecord) => item.storage.records[item.index].name === name)!;
}

function testActions(records: TreeRecord[], actions: {update?: TreeRecord[], remove?: TreeRecord[]}) {
  const update = actions.update || [];
  const remove = actions.remove || [];
  if (remove.length) {
    const ids = remove.map(rec => rec.id);
    records = records.filter(rec => !ids.includes(rec.id));
  }
  if (update.length) {
    // In reality, the handling of pagePos is done by the sandbox (see relabeling.py, which is
    // quite complicated to handle updates of large tables efficiently). Here we simulate it in a
    // very simple way. The important property is that new pagePos values equal to existing ones
    // are inserted immediately before the existing ones.
    const map = new Map(update.map(rec => [rec.id, rec]));
    const newRecords = update.map(rec => ({...rec, pagePos: rec.pagePos ?? Infinity}));
    newRecords.push(...records.filter(rec => !map.has(rec.id)));
    newRecords.sort((a, b) => nativeCompare(a.pagePos, b.pagePos));
    records = newRecords.map((rec, i) => ({...rec, pagePos: i}));
  }
  return toSimpleArray(records);
}

describe('TreeModel', function() {

  let table: any;
  let sendActionsSpy: any;
  let records: TreeRecord[];

  before(function() {
    table = sinon.createStubInstance(TableData);
    table.getRecords.callsFake(() => records);
    sendActionsSpy = sinon.spy(TreeNodeRecord.prototype, 'sendActions');
  });

  after(function() {
    sendActionsSpy.restore();
  });

  afterEach(function() {
    sendActionsSpy.resetHistory();
  });

  it('fixIndent should work correctly', function() {

    function fix(items: string[]) {
      const recs = items.map((item, id) => ({id, indentation: Number(item[1]), name: item[0], pagePos: id}));
      return fixIndents(recs).map((rec) => rec.name + rec.indentation);
    }

    assert.deepEqual(fix(["A0", "B2"]), ["A0", "B1"]);
    assert.deepEqual(fix(["A0", "B3", "C3"]), ["A0", "B1", "C2"]);
    assert.deepEqual(fix(["A3", "B1"]), ["A0", "B1"]);

    // should not change when indentation is already correct
    assert.deepEqual(fix(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']), ['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
  });

  describe("fromTableData", function() {

    it('should build correct model', function() {
      records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
      const model = fromTableData(table, buildDom);
      assert.equal(toJson(model), JSON.stringify(['A', ['B'], 'C', ['D', ['E']], 'F']));

    });

    it('should build correct model even with gaps in indentation', function() {
      records = simpleArray(['A0', 'B3', 'C3']);
      const model = fromTableData(table, buildDom);
      assert.equal(toJson(model), JSON.stringify(['A', ['B', ['C']]]));
    });

    it('should sort records', function() {
      records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
      // let's shuffle records
      records = [2, 3, 5, 1, 4, 0].map(i => records[i]);
      // check that it's shuffled
      assert.deepEqual(toSimpleArray(records), ['C0', 'D1', 'F0', 'B1', 'E2', 'A0']);
      const model = fromTableData(table, buildDom);
      assert.equal(toJson(model), JSON.stringify(['A', ['B'], 'C', ['D', ['E']], 'F']));
    });

    it('should reuse item from optional oldModel', function() {
      // create a model
      records = simpleArray(['A0', 'B1', 'C0']);
      const oldModel = fromTableData(table, buildDom);
      assert.deepEqual(oldModel.storage.records.map(r => r.id), [0, 1, 2]);
      const items = findItems(oldModel, ['A', 'B', 'C']);

      // create a new model with overlap in ids
      records = simpleArray(['A0', 'B0', 'C1', 'D0']);
      const model = fromTableData(table, buildDom, oldModel);
      assert.deepEqual(model.storage.records.map(r => r.id), [0, 1, 2, 3]);

      // item with same ids should be the same
      assert.deepEqual(findItems(model, ['A', 'B', 'C']), items);

      // new model is correct
      assert.equal(toJson(model), JSON.stringify(['A', 'B', ['C'], 'D']));
    });

  });

  describe("TreeNodeRecord", function() {

    it("removeChild(...) should work properly", async function() {
      records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
      const model = fromTableData(table, buildDom);

      await model.removeChild(model.children().get()[1]);

      const [C, D, E] = [2, 3, 4].map(i => records[i]);
      const actions = sendActionsSpy.getCall(0).args[0];
      assert.deepEqual(actions, {remove: [C, D, E]});
      assert.deepEqual(testActions(records, actions), ['A0', 'B1', 'F0']);
    });

    describe("insertBefore", function() {

      it("should insert before a child properly", async function() {

        records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
        const model = fromTableData(table, buildDom);

        const F = model.children().get()[2];
        const C = model.children().get()[1];
        await model.insertBefore(F, C);

        const actions = sendActionsSpy.getCall(0).args[0];
        assert.deepEqual(actions, {update: [{...records[5], pagePos: 2}]});
        assert.deepEqual(testActions(records, actions), ['A0', 'B1', 'F0', 'C0', 'D1', 'E2']);
      });

      it("should insert as last child correctly", async function() {

        records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
        const model = fromTableData(table, buildDom);

        const B = findItem(model, 'B');
        await model.insertBefore(B, null);

        let actions = sendActionsSpy.getCall(0).args[0];
        assert.deepEqual(actions, {update: [{...records[1], indentation: 0, pagePos: null}]});
        assert.deepEqual(testActions(records, actions), ['A0', 'C0', 'D1', 'E2', 'F0', 'B0']);

        // handle case when the last child has chidlren
        const C = model.children().get()[1];
        await C.insertBefore(B, null);

        actions = sendActionsSpy.getCall(1).args[0];
        assert.deepEqual(actions, {update: [{...records[1], indentation: 1, pagePos: 5}]});
        assert.deepEqual(testActions(records, actions), ['A0', 'C0', 'D1', 'E2', 'B1', 'F0']);
      });

      it("should insert into a child correctly", async function() {

        records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
        const model = fromTableData(table, buildDom);

        const A = model.children().get()[0];
        const F = model.children().get()[2];

        await A.insertBefore(F, null);

        const actions = sendActionsSpy.getCall(0).args[0];
        assert.deepEqual(actions, {update: [{...records[5], indentation: 1, pagePos: 2}]});
        assert.deepEqual(testActions(records, actions), ['A0', 'B1', 'F1', 'C0', 'D1', 'E2']);
      });

      it("should insert item with nested children correctly", async function() {

        records = simpleArray(['A0', 'B1', 'C0', 'D1', 'E2', 'F0']);
        const model = fromTableData(table, buildDom);

        const D = model.children().get()[1].children().get()[0];

        await model.insertBefore(D, null);

        const actions = sendActionsSpy.getCall(0).args[0];
        assert.deepEqual(actions, {update: [{...records[3], indentation: 0, pagePos: null},
                                            {...records[4], indentation: 1, pagePos: null}]});
        assert.deepEqual(testActions(records, actions), ['A0', 'B1', 'C0', 'F0', 'D0', 'E1']);
      });

    });
  });
});
