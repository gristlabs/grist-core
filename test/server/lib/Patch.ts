import { TableDelta } from "app/common/ActionSummary";
import { GristObjCode } from "app/plugin/GristData";
import { buildActions, ColumnInfo, translateRefValue } from "app/server/lib/Patch";

import { assert } from "chai";

const L = GristObjCode.List;

describe("Patch", function() {
  describe("translateRefValue", function() {
    // Rows 5 and 6 of Pets are being added; everything else is shared.
    const isAddedRow = (tableId: string, rowId: number) => tableId === "Pets" && [5, 6].includes(rowId);

    it("turns a Ref to an added row into a temp id", function() {
      assert.deepEqual(translateRefValue("Pets", 5, isAddedRow), { value: -5 });
    });

    it("leaves a Ref to a shared row alone", function() {
      assert.isUndefined(translateRefValue("Pets", 1, isAddedRow));
      assert.isUndefined(translateRefValue("Pets", 0, isAddedRow));
      assert.isUndefined(translateRefValue("Pets", null, isAddedRow));
      // Same id, but in a table where it is not being added.
      assert.isUndefined(translateRefValue("Owners", 5, isAddedRow));
    });

    it("leaves non-reference columns alone", function() {
      assert.isUndefined(translateRefValue(undefined, 5, isAddedRow));
      assert.isUndefined(translateRefValue(undefined, [L, 5], isAddedRow));
    });

    it("translates only the added rows in a RefList, keeping order", function() {
      assert.deepEqual(translateRefValue("Pets", [L, 6, 1, 5], isAddedRow), { value: [L, -6, 1, -5] });
      assert.isUndefined(translateRefValue("Pets", [L, 1, 2], isAddedRow));
      assert.isUndefined(translateRefValue("Pets", [L], isAddedRow));
    });

    it("leaves other values in a reference column alone", function() {
      // Alt text left in a Ref column when a value failed to convert.
      assert.isUndefined(translateRefValue("Pets", "Rex", isAddedRow));
    });
  });

  describe("buildActions", function() {
    // Owners.pet is a Ref:Pets, Pets.friends a RefList:Pets, Pets.shout a formula.
    // Pets.keeper is a Ref:Owners, with Owners.keeps as its reverse.
    const columns: Record<string, ColumnInfo> = {
      "Owners.name": { skip: false },
      "Owners.pet": { skip: false, refTableId: "Pets" },
      "Owners.keeps": { skip: false, refTableId: "Pets", following: true },
      "Pets.keeper": { skip: false, refTableId: "Owners" },
      // Pets.partner is a Ref:Owners, one-to-one with Owners.partner.
      "Pets.partner": { skip: false, refTableId: "Owners", oneToOne: true },
      "Owners.partner": { skip: false, refTableId: "Pets", following: true },
      "Pets.name": { skip: false },
      "Pets.age": { skip: false },
      "Pets.friends": { skip: false, refTableId: "Pets" },
      "Pets.shout": { skip: true },
    };
    function getColumn(tableId: string, colId: string): ColumnInfo {
      const info = columns[`${tableId}.${colId}`];
      if (!info) { throw new Error(`column not found: ${colId}`); }
      return info;
    }

    function delta(parts: Partial<TableDelta>): TableDelta {
      return { updateRows: [], removeRows: [], addRows: [], columnDeltas: {}, columnRenames: [], ...parts };
    }

    it("builds nothing from an empty summary", function() {
      assert.deepEqual(buildActions([], getColumn), []);
      assert.deepEqual(buildActions([["Pets", delta({})]], getColumn), []);
    });

    it("adds rows under temp ids, grouped by the columns they set", function() {
      const actions = buildActions([["Pets", delta({
        addRows: [3, 4, 5],
        columnDeltas: {
          name: { 3: [null, ["Rex"]], 4: [null, ["Tom"]], 5: [null, ["Kit"]] },
          age: { 5: [null, [2]] },
        },
      })]], getColumn);
      // Rex and Tom leave age alone, so it stays at its default for them.
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Pets", [-3, -4], { name: ["Rex", "Tom"] }],
        ["BulkAddRecord", "Pets", [-5], { name: ["Kit"], age: [2] }],
      ]);
    });

    it("adds rows in the order the source created them", function() {
      // The engine gives real ids in bundle order, so grouping Rex with Kit
      // ahead of Tom would put Kit before Tom on the target.
      const actions = buildActions([["Pets", delta({
        addRows: [5, 3, 4],
        columnDeltas: {
          name: { 3: [null, ["Rex"]], 4: [null, ["Tom"]], 5: [null, ["Kit"]] },
          age: { 4: [null, [2]] },
        },
      })]], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Pets", [-3], { name: ["Rex"] }],
        ["BulkAddRecord", "Pets", [-4], { name: ["Tom"], age: [2] }],
        ["BulkAddRecord", "Pets", [-5], { name: ["Kit"] }],
      ]);
    });

    it("skips formula columns", function() {
      const actions = buildActions([["Pets", delta({
        updateRows: [1],
        columnDeltas: { name: { 1: [["Rex"], ["Max"]] }, shout: { 1: [["REX"], ["MAX"]] } },
      })]], getColumn);
      assert.deepEqual(actions, [["BulkUpdateRecord", "Pets", [1], { name: ["Max"] }]]);
    });

    it("sets Refs to added rows only after every Add", function() {
      // Owners is listed first, and its new owner names a pet added later.
      const actions = buildActions([
        ["Owners", delta({
          addRows: [7],
          columnDeltas: { name: { 7: [null, ["Ann"]] }, pet: { 7: [null, [3]] } },
        })],
        ["Pets", delta({
          addRows: [3],
          columnDeltas: { name: { 3: [null, ["Rex"]] } },
        })],
      ], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Owners", [-7], { name: ["Ann"] }],
        ["BulkAddRecord", "Pets", [-3], { name: ["Rex"] }],
        ["BulkUpdateRecord", "Owners", [-7], { pet: [-3] }],
      ]);
    });

    it("keeps Refs to shared rows in the Add", function() {
      const actions = buildActions([["Owners", delta({
        addRows: [7],
        columnDeltas: { name: { 7: [null, ["Ann"]] }, pet: { 7: [null, [1]] } },
      })]], getColumn);
      assert.deepEqual(actions, [["BulkAddRecord", "Owners", [-7], { name: ["Ann"], pet: [1] }]]);
    });

    it("resolves a cycle between added rows", function() {
      const actions = buildActions([["Pets", delta({
        addRows: [3, 4],
        columnDeltas: {
          name: { 3: [null, ["Rex"]], 4: [null, ["Tom"]] },
          friends: { 3: [null, [[L, 4]]], 4: [null, [[L, 3, 1]]] },
        },
      })]], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Pets", [-3, -4], { name: ["Rex", "Tom"] }],
        ["BulkUpdateRecord", "Pets", [-3, -4], { friends: [[L, -4], [L, -3, 1]] }],
      ]);
    });

    it("translates Refs in updates to existing rows, after the Adds", function() {
      const actions = buildActions([
        ["Owners", delta({
          updateRows: [1, 2],
          columnDeltas: { pet: { 1: [[1], [3]], 2: [[1], [2]] } },
        })],
        ["Pets", delta({
          addRows: [3],
          columnDeltas: { name: { 3: [null, ["Rex"]] } },
        })],
      ], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Pets", [-3], { name: ["Rex"] }],
        ["BulkUpdateRecord", "Owners", [1, 2], { pet: [-3, 2] }],
      ]);
    });

    it("groups updates by the columns they set", function() {
      const actions = buildActions([["Pets", delta({
        updateRows: [1, 2, 3],
        columnDeltas: {
          name: { 1: [["Rex"], ["Max"]], 3: [["Kit"], ["Cat"]] },
          age: { 2: [[1], [2]] },
        },
      })]], getColumn);
      assert.deepEqual(actions, [
        ["BulkUpdateRecord", "Pets", [1, 3], { name: ["Max", "Cat"] }],
        ["BulkUpdateRecord", "Pets", [2], { age: [2] }],
      ]);
    });

    it("removes first, and skips updates to rows it adds or removes", function() {
      const actions = buildActions([["Pets", delta({
        removeRows: [2],
        addRows: [3],
        updateRows: [1, 2, 3],
        columnDeltas: {
          name: { 1: [["Rex"], ["Max"]], 2: [["Tom"], ["Tim"]], 3: [null, ["Kit"]] },
        },
      })]], getColumn);
      assert.deepEqual(actions, [
        ["BulkRemoveRecord", "Pets", [2]],
        ["BulkAddRecord", "Pets", [-3], { name: ["Kit"] }],
        ["BulkUpdateRecord", "Pets", [1], { name: ["Max"] }],
      ]);
    });

    it("treats a recycled row id as a remove and a fresh add", function() {
      // Row 2 was removed and its id reused, and an owner points at the new row.
      const actions = buildActions([
        ["Pets", delta({
          removeRows: [2],
          addRows: [2],
          columnDeltas: { name: { 2: [["Tom"], ["Kit"]] } },
        })],
        ["Owners", delta({
          updateRows: [1],
          columnDeltas: { pet: { 1: [[2], [2]] } },
        })],
      ], getColumn);
      assert.deepEqual(actions, [
        ["BulkRemoveRecord", "Pets", [2]],
        ["BulkAddRecord", "Pets", [-2], { name: ["Kit"] }],
        ["BulkUpdateRecord", "Owners", [1], { pet: [-2] }],
      ]);
    });

    // This is why applyChanges refuses a summary that may be incomplete.
    it("writes null for a cell whose new value is unknown", function() {
      const actions = buildActions([["Pets", delta({
        updateRows: [1],
        columnDeltas: { name: { 1: [["Rex"], "?"] } },
      })]], getColumn);
      assert.deepEqual(actions, [["BulkUpdateRecord", "Pets", [1], { name: [null] }]]);
    });

    it("looks up each column once, however many rows it touches", function() {
      const lookups: string[] = [];
      buildActions([["Pets", delta({
        addRows: [3, 4],
        updateRows: [1, 2],
        columnDeltas: {
          name: { 1: [["a"], ["b"]], 2: [["c"], ["d"]], 3: [null, ["e"]], 4: [null, ["f"]] },
          age: { 1: [[1], [2]], 3: [null, [3]] },
        },
      })]], (tableId, colId) => {
        lookups.push(`${tableId}.${colId}`);
        return getColumn(tableId, colId);
      });
      assert.deepEqual(lookups, ["Pets.name", "Pets.age"]);
    });

    it("leaves the following side of a two-way reference to the engine", function() {
      // Rex moves from Ann (1) to Ben (2), which shows on both sides.
      const actions = buildActions([
        ["Pets", delta({
          updateRows: [1],
          columnDeltas: { keeper: { 1: [[1], [2]] } },
        })],
        ["Owners", delta({
          updateRows: [1, 2],
          columnDeltas: { keeps: { 1: [[[L, 1, 3]], [[L, 3]]], 2: [[null], [[L, 1]]] } },
        })],
      ], getColumn);
      assert.deepEqual(actions, [["BulkUpdateRecord", "Pets", [1], { keeper: [2] }]]);
    });

    it("writes a reordered following side last", function() {
      // Ann's pets change order, which shows on her side only. Tom (4) is
      // new, and joins Ben's list, which the engine follows.
      const actions = buildActions([
        ["Owners", delta({
          updateRows: [1, 2],
          columnDeltas: { keeps: { 1: [[[L, 1, 3]], [[L, 3, 1]]], 2: [[null], [[L, 4]]] } },
        })],
        ["Pets", delta({
          addRows: [4],
          columnDeltas: { name: { 4: [null, ["Tom"]] }, keeper: { 4: [null, [2]] } },
        })],
      ], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Pets", [-4], { name: ["Tom"], keeper: [2] }],
        ["BulkUpdateRecord", "Owners", [1], { keeps: [[L, 3, 1]] }],
      ]);
    });

    it("frees one-to-one partners before anything claims them", function() {
      // Rex (1) gives up Ann (1) and is renamed; Tom (2) moves from Ben (2)
      // to Ann; new Kit (3) takes Ben.
      const actions = buildActions([["Pets", delta({
        updateRows: [1, 2],
        addRows: [3],
        columnDeltas: {
          name: { 1: [["Rex"], ["Rexy"]], 3: [null, ["Kit"]] },
          partner: { 1: [[1], [0]], 2: [[2], [1]], 3: [null, [2]] },
        },
      })]], getColumn);
      assert.deepEqual(actions, [
        ["BulkUpdateRecord", "Pets", [1, 2], { partner: [0, 0] }],
        ["BulkAddRecord", "Pets", [-3], { name: ["Kit"], partner: [2] }],
        ["BulkUpdateRecord", "Pets", [1], { name: ["Rexy"], partner: [0] }],
        ["BulkUpdateRecord", "Pets", [2], { partner: [1] }],
      ]);
    });

    describe("with rows the target has removed", function() {
      // The target removed Owners rows 2 and 3 and Pets row 2 since the
      // branch point, and reused id 3 of Owners for a new row.
      const trunkChanges = {
        Owners: delta({ removeRows: [2, 3], addRows: [3] }),
        Pets: delta({ removeRows: [2] }),
      };

      it("drops removes of rows the target removed too", function() {
        const actions = buildActions([["Pets", delta({ removeRows: [1, 2] })]], getColumn, trunkChanges);
        assert.deepEqual(actions, [["BulkRemoveRecord", "Pets", [1]]]);
      });

      it("refuses to update a row the target removed", function() {
        assert.throws(() => buildActions([["Pets", delta({
          updateRows: [2],
          columnDeltas: { name: { 2: [["Tom"], ["Tim"]] } },
        })]], getColumn, trunkChanges), /changes row 2 of Pets, which was removed/);
      });

      it("refuses a reference to a row whose id the target reused", function() {
        assert.throws(() => buildActions([["Pets", delta({
          addRows: [5],
          columnDeltas: { keeper: { 5: [null, [3]] } },
        })]], getColumn, trunkChanges), /Pets.keeper to refer to row 3 of Owners/);
      });

      it("lets a reference to a row the target removed dangle", function() {
        const actions = buildActions([["Pets", delta({
          addRows: [5],
          updateRows: [1],
          columnDeltas: { keeper: { 5: [null, [2]] }, friends: { 1: [[null], [[L, 1, 2]]] } },
        })]], getColumn, trunkChanges);
        assert.deepEqual(actions, [
          ["BulkAddRecord", "Pets", [-5], { keeper: [2] }],
          ["BulkUpdateRecord", "Pets", [1], { friends: [[L, 1, 2]] }],
        ]);
      });

      it("allows a reference to a row the source re-added under a removed id", function() {
        // On the source, Owners row 2 was removed and its id reused.
        const actions = buildActions([
          ["Owners", delta({ removeRows: [2], addRows: [2], columnDeltas: { name: { 2: [["Ben"], ["Bo"]] } } })],
          ["Pets", delta({ updateRows: [1], columnDeltas: { keeper: { 1: [[1], [2]] } } })],
        ], getColumn, trunkChanges);
        assert.deepEqual(actions, [
          ["BulkAddRecord", "Owners", [-2], { name: ["Bo"] }],
          ["BulkUpdateRecord", "Pets", [1], { keeper: [-2] }],
        ]);
      });
    });

    it("drops a reorder of a list the target also changed", function() {
      const reorder: [string, TableDelta][] = [["Owners", delta({
        updateRows: [1, 2],
        columnDeltas: { keeps: { 1: [[[L, 1, 3]], [[L, 3, 1]]], 2: [[[L, 2, 4]], [[L, 4, 2]]] } },
      })]];
      // The target gave Ann (1) another pet, and renamed Ben (2).
      const trunkChanges = {
        Owners: delta({
          updateRows: [1, 2],
          columnDeltas: { keeps: { 1: [[[L, 1, 3]], [[L, 1, 3, 5]]] }, name: { 2: [["Ben"], ["Benny"]] } },
        }),
      };
      assert.deepEqual(buildActions(reorder, getColumn, trunkChanges), [
        ["BulkUpdateRecord", "Owners", [2], { keeps: [[L, 4, 2]] }],
      ]);
      // If the target's summary may be missing cells, any change to the row counts.
      trunkChanges.Owners.mayBeIncomplete = true;
      assert.deepEqual(buildActions(reorder, getColumn, trunkChanges), []);
    });

    it("throws for a column the target does not have", function() {
      assert.throws(() => buildActions([["Pets", delta({
        updateRows: [1],
        columnDeltas: { color: { 1: [["red"], ["blue"]] } },
      })]], getColumn), /column not found: color/);
    });
  });
});
