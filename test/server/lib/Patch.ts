import { TableDelta } from "app/common/ActionSummary";
import { CellValue } from "app/common/DocActions";
import { CellDelta } from "app/common/TabularDiff";
import { GristObjCode } from "app/plugin/GristData";
import {
  buildActions, ColumnInfo, mergeLinks, TargetCells, targetReads, translateRefValue,
} from "app/server/lib/Patch";

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

  describe("mergeLinks", function() {
    it("adds the source's new links after the target's", function() {
      // Source added 3; target added 4 meanwhile.
      assert.deepEqual(mergeLinks([1], [1, 3], [1, 4]), [1, 4, 3]);
    });

    it("removes the source's dropped links, keeping the target's new ones", function() {
      assert.deepEqual(mergeLinks([1, 2], [2], [1, 2, 4]), [2, 4]);
    });

    it("does not bring back a link the target removed", function() {
      // Source kept 1 and added 3; target removed 1.
      assert.deepEqual(mergeLinks([1, 2], [1, 2, 3], [2]), [2, 3]);
    });

    it("does not repeat a link both sides added", function() {
      assert.deepEqual(mergeLinks([], [3], [3]), [3]);
    });

    it("keeps the target's order where the source only reordered", function() {
      assert.deepEqual(mergeLinks([1, 2], [2, 1], [1, 2, 4]), [1, 2, 4]);
    });
  });

  describe("buildActions", function() {
    // Owners.pet is a Ref:Pets, Pets.friends a RefList:Pets, Pets.shout a formula.
    // Pets.keeper is a Ref:Owners, with Owners.keeps as its reverse.
    const columns: Record<string, ColumnInfo> = {
      "Owners.name": { skip: false },
      "Owners.pet": { skip: false, refTableId: "Pets" },
      "Owners.keeps": { skip: false, refTableId: "Pets", twoWay: "following" },
      "Pets.keeper": { skip: false, refTableId: "Owners" },
      // Pets.partner is a Ref:Owners, one-to-one with Owners.partner.
      "Pets.partner": { skip: false, refTableId: "Owners", twoWay: "oneToOne" },
      "Owners.partner": { skip: false, refTableId: "Pets", twoWay: "following" },
      "Pets.name": { skip: false },
      "Pets.age": { skip: false },
      "Pets.friends": { skip: false, refTableId: "Pets" },
      "Pets.shout": { skip: true },
      // Pets.likes is a RefList:Owners, many-to-many with Owners.likedBy.
      "Pets.likes": { skip: false, refTableId: "Owners", twoWay: "manyToMany" },
      "Owners.likedBy": { skip: false, refTableId: "Pets", twoWay: "following" },
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

    it("refuses a cell whose value is unknown", function() {
      // Written as null, it would wipe out whatever the cell holds.
      for (const cellDelta of [[["Rex"], "?"], ["?", ["Max"]]] as CellDelta[]) {
        assert.throws(() => buildActions([["Pets", delta({
          updateRows: [1],
          columnDeltas: { name: { 1: cellDelta } },
        })]], getColumn), /change to Pets.name in row 1 is not known in full/);
      }
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

    describe("with a one-to-one partner the target gave away", function() {
      // Rex (1) takes Ann (1); new Kit (3) takes Ben (2).
      const claims: [string, TableDelta][] = [["Pets", delta({
        updateRows: [1],
        addRows: [3],
        columnDeltas: { name: { 3: [null, ["Kit"]] }, partner: { 1: [[0], [1]], 3: [null, [2]] } },
      })]];

      it("reads the rows now holding the partners claimed", function() {
        assert.deepEqual(targetReads(claims, getColumn), [{ tableId: "Pets", colId: "partner", values: [2, 1] }]);
      });

      it("releases them, so the claims win", function() {
        // The target gave Ann to Tom (2) and Ben to its own new pet (7).
        const target: TargetCells = { Pets: { partner: new Map([[2, 1], [7, 2]]) } };
        assert.deepEqual(buildActions(claims, getColumn, {}, target), [
          ["BulkUpdateRecord", "Pets", [1, 2, 7], { partner: [0, 0, 0] }],
          ["BulkAddRecord", "Pets", [-3], { name: ["Kit"], partner: [2] }],
          ["BulkUpdateRecord", "Pets", [1], { partner: [1] }],
        ]);
      });

      // Rex (1) takes Ann (1), and Tom (2) is removed.
      const claimAndRemove: [string, TableDelta][] = [["Pets", delta({
        updateRows: [1],
        removeRows: [2],
        columnDeltas: { partner: { 1: [[0], [1]] } },
      })]];

      it("leaves alone a holder the patch removes", function() {
        const target: TargetCells = { Pets: { partner: new Map([[2, 1]]) } };
        assert.deepEqual(buildActions(claimAndRemove, getColumn, {}, target), [
          ["BulkRemoveRecord", "Pets", [2]],
          ["BulkUpdateRecord", "Pets", [1], { partner: [0] }],
          ["BulkUpdateRecord", "Pets", [1], { partner: [1] }],
        ]);
      });

      it("releases a holder the target added under the id of a row both sides removed", function() {
        const trunkChanges = { Pets: delta({ removeRows: [2], addRows: [2] }) };
        const target: TargetCells = { Pets: { partner: new Map([[2, 1]]) } };
        assert.deepEqual(buildActions(claimAndRemove, getColumn, trunkChanges, target), [
          ["BulkUpdateRecord", "Pets", [1, 2], { partner: [0, 0] }],
          ["BulkUpdateRecord", "Pets", [1], { partner: [1] }],
        ]);
      });

      // Rex (1) gives up Ann (1).
      const unpair: [string, TableDelta][] = [["Pets", delta({
        updateRows: [1],
        columnDeltas: { partner: { 1: [[1], [0]] } },
      })]];

      it("reads the rows the patch unpairs", function() {
        assert.deepEqual(targetReads(unpair, getColumn), [{ tableId: "Pets", colId: "partner", rowIds: [1] }]);
      });

      it("unpairs a row still holding the partner given up", function() {
        const target: TargetCells = { Pets: { partner: new Map([[1, 1]]) } };
        assert.deepEqual(buildActions(unpair, getColumn, {}, target), [
          ["BulkUpdateRecord", "Pets", [1], { partner: [0] }],
          ["BulkUpdateRecord", "Pets", [1], { partner: [0] }],
        ]);
      });

      it("unpairs a row whose current partner access rules hide", function() {
        const target: TargetCells = { Pets: { partner: new Map([[1, [GristObjCode.Censored]]]) } };
        assert.deepEqual(buildActions(unpair, getColumn, {}, target), [
          ["BulkUpdateRecord", "Pets", [1], { partner: [0] }],
          ["BulkUpdateRecord", "Pets", [1], { partner: [0] }],
        ]);
      });

      it("leaves alone a row the target has paired anew", function() {
        // The target gave Rex Ben (2) meanwhile.
        const target: TargetCells = { Pets: { partner: new Map([[1, 2]]) } };
        assert.deepEqual(buildActions(unpair, getColumn, {}, target), []);
      });
    });

    describe("with a many-to-many list", function() {
      // Rex (1) comes to like Ben (2) as well as Ann (1). The engine
      // follows on Owners.likedBy.
      const likes = (after: unknown[]): [string, TableDelta][] => [["Pets", delta({
        updateRows: [1],
        columnDeltas: { likes: { 1: [[[L, 1]], [[L, ...after]]] } },
      })]];
      const target = (current: CellValue): TargetCells => ({ Pets: { likes: new Map([[1, current]]) } });

      it("reads the lists the patch writes", function() {
        assert.deepEqual(targetReads(likes([1, 2]), getColumn), [{ tableId: "Pets", colId: "likes", rowIds: [1] }]);
      });

      it("writes the source's list as is if the target's is unchanged", function() {
        // Order and all, since nothing needs merging.
        assert.deepEqual(buildActions(likes([2, 1]), getColumn, {}, target([L, 1])), [
          ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 2, 1]] }],
        ]);
      });

      it("merges into a list the target changed", function() {
        // The target had Rex like its own new owner (5) meanwhile.
        assert.deepEqual(buildActions(likes([1, 2]), getColumn, {}, target([L, 1, 5])), [
          ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 1, 5, 2]] }],
        ]);
      });

      it("writes nothing if merging changes nothing", function() {
        assert.deepEqual(buildActions(likes([1, 2]), getColumn, {}, target([L, 1, 2])), []);
      });

      it("merges a link to an added row as a temp id, leaving the target's ids alone", function() {
        // The source adds owner 5; the target's own row 5 is unrelated.
        const tables: [string, TableDelta][] = [
          ["Owners", delta({ addRows: [5], columnDeltas: { name: { 5: [null, ["Cat"]] } } })],
          ...likes([1, 5]),
        ];
        assert.deepEqual(buildActions(tables, getColumn, {}, target([L, 1, 5])), [
          ["BulkAddRecord", "Owners", [-5], { name: ["Cat"] }],
          ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 1, 5, -5]] }],
        ]);
      });

      it("drops the target's links to rows the patch removes", function() {
        // The target had Rex like owner 5, which the source removes.
        const tables: [string, TableDelta][] = [["Owners", delta({ removeRows: [5] })], ...likes([1, 2])];
        assert.deepEqual(buildActions(tables, getColumn, {}, target([L, 1, 5])), [
          ["BulkRemoveRecord", "Owners", [5]],
          ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 1, 2]] }],
        ]);
      });

      describe("where the target removed owner 3 and reused its id", function() {
        const trunkChanges = { Owners: delta({ removeRows: [3], addRows: [3] }) };

        it("leaves out a link to the old row the source kept", function() {
          const tables: [string, TableDelta][] = [["Pets", delta({
            updateRows: [1],
            columnDeltas: { likes: { 1: [[[L, 1, 3]], [[L, 1, 3, 2]]] } },
          })]];
          assert.deepEqual(buildActions(tables, getColumn, trunkChanges, target([L, 1])), [
            ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 1, 2]] }],
          ]);
        });

        it("refuses a new link to it", function() {
          assert.throws(() => buildActions(likes([1, 3]), getColumn, trunkChanges, target([L, 1])),
            /Pets.likes to refer to row 3 of Owners/);
        });
      });

      it("refuses if the target's list could not be read", function() {
        assert.throws(() => buildActions(likes([1, 2]), getColumn, {}, {}), /could not be read as a list/);
      });
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
