import { TableDelta } from "app/common/ActionSummary";
import { CellDelta } from "app/common/TabularDiff";
import { GristObjCode } from "app/plugin/GristData";
import { buildActions, ColumnInfo, translateRefValue } from "app/server/lib/Patch";

import { assert } from "chai";

const L = GristObjCode.List;

describe("Patch", function() {
  describe("buildActions", function() {
    const columns: Record<string, ColumnInfo> = {
      "Owners.name": { skip: false },
      "Owners.pet": { skip: false, refTableId: "Pets" },
      // Reverse of Pets.keeper.
      "Owners.keeps": { skip: false, refTableId: "Pets", twoWay: { pair: "manyToOne", mirror: true } },
      // Reverse of Pets.partner.
      "Owners.partner": { skip: false, refTableId: "Pets", twoWay: { pair: "oneToOne", mirror: true } },
      // Reverse of Pets.likes.
      "Owners.likedBy": { skip: false, refTableId: "Pets", twoWay: { pair: "manyToMany", mirror: true } },
      "Pets.name": { skip: false },
      "Pets.age": { skip: false },
      "Pets.keeper": { skip: false, refTableId: "Owners", twoWay: { pair: "manyToOne", mirror: false } },
      "Pets.partner": { skip: false, refTableId: "Owners", twoWay: { pair: "oneToOne", mirror: false } },
      "Pets.likes": { skip: false, refTableId: "Owners", twoWay: { pair: "manyToMany", mirror: false } },
      "Pets.friends": { skip: false, refTableId: "Pets" },
      // A formula column.
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

    it("adds rows in the order the fork created them", function() {
      // The engine gives real ids in bundle order, so grouping Rex with Kit
      // ahead of Tom would put Kit before Tom on the trunk.
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

    it("sets Refs to added rows only after every BulkAddRecord", function() {
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

    it("keeps Refs to shared rows in the BulkAddRecord", function() {
      const actions = buildActions([["Owners", delta({
        addRows: [7],
        columnDeltas: { name: { 7: [null, ["Ann"]] }, pet: { 7: [null, [1]] } },
      })]], getColumn);
      assert.deepEqual(actions, [["BulkAddRecord", "Owners", [-7], { name: ["Ann"], pet: [1] }]]);
    });

    it("translates only Refs into the table where rows are added", function() {
      // Owners row 7 is added, but Pets row 7 is not, and age is not a Ref.
      const actions = buildActions([
        ["Owners", delta({ addRows: [7], columnDeltas: { name: { 7: [null, ["Ann"]] }, pet: { 7: [null, [7]] } } })],
        ["Pets", delta({ updateRows: [1], columnDeltas: { age: { 1: [[1], [7]] } } })],
      ], getColumn);
      assert.deepEqual(actions, [
        ["BulkAddRecord", "Owners", [-7], { name: ["Ann"], pet: [7] }],
        ["BulkUpdateRecord", "Pets", [1], { age: [7] }],
      ]);
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

    it("translates Refs in updates to existing rows, after the BulkAddRecords", function() {
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

    it("leaves the mirror side of a two-way reference to the engine", function() {
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

    it("ignores a reorder on the mirror side", function() {
      // Ann's pets, and the pets who like her, change order, which shows on
      // her side only.
      assert.deepEqual(buildActions([["Owners", delta({
        updateRows: [1],
        columnDeltas: {
          keeps: { 1: [[[L, 1, 3]], [[L, 3, 1]]] },
          likedBy: { 1: [[[L, 1, 2]], [[L, 2, 1]]] },
        },
      })]], getColumn), []);
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

    describe("where the trunk changed the same two-way cell", function() {
      // Rex (1) comes to like Ben (2) as well as Ann (1), which shows on
      // both sides.
      const likeBen: [string, TableDelta][] = [
        ["Pets", delta({ updateRows: [1], columnDeltas: { likes: { 1: [[[L, 1]], [[L, 1, 2]]] } } })],
        ["Owners", delta({ updateRows: [2], columnDeltas: { likedBy: { 2: [[null], [[L, 1]]] } } })],
      ];

      it("refuses, on the written side", function() {
        // The trunk had Rex like Cat (3) meanwhile.
        const trunkChanges = {
          Pets: delta({ updateRows: [1], columnDeltas: { likes: { 1: [[[L, 1]], [[L, 1, 3]]] } } }),
        };
        assert.throws(() => buildActions(likeBen, getColumn, trunkChanges),
          /changes Pets.likes in row 1, a two-way reference this document has also changed/);
      });

      it("refuses, on the mirror side", function() {
        // The trunk had Kit (3) like Ben meanwhile.
        const trunkChanges = {
          Owners: delta({ updateRows: [2], columnDeltas: { likedBy: { 2: [[null], [[L, 3]]] } } }),
        };
        assert.throws(() => buildActions(likeBen, getColumn, trunkChanges), /changes Owners.likedBy in row 2/);
      });

      it("refuses when one-to-one", function() {
        // Rex (1) takes Ann (1), while the trunk gave her to Tom (2).
        const claim: [string, TableDelta][] = [
          ["Pets", delta({ updateRows: [1], columnDeltas: { partner: { 1: [[0], [1]] } } })],
          ["Owners", delta({ updateRows: [1], columnDeltas: { partner: { 1: [[0], [1]] } } })],
        ];
        const trunkChanges = {
          Owners: delta({ updateRows: [1], columnDeltas: { partner: { 1: [[0], [2]] } } }),
        };
        assert.throws(() => buildActions(claim, getColumn, trunkChanges), /changes Owners.partner in row 1/);
      });

      it("applies if the trunk changed other cells of the row", function() {
        const trunkChanges = {
          Pets: delta({ updateRows: [1], columnDeltas: { name: { 1: [["Rex"], ["Rexy"]] } } }),
        };
        assert.deepEqual(buildActions(likeBen, getColumn, trunkChanges), [
          ["BulkUpdateRecord", "Pets", [1], { likes: [[L, 1, 2]] }],
        ]);
      });

      it("refuses on any change to the row if the trunk's summary may be missing cells", function() {
        const trunkChanges = { Pets: delta({ updateRows: [1], mayBeIncomplete: true }) };
        assert.throws(() => buildActions(likeBen, getColumn, trunkChanges), /changes Pets.likes in row 1/);
      });

      it("lets the fork win the Ref of a Ref/RefList pair", function() {
        // Rex (1) moves from Ann (1) to Ben (2), while the trunk moved him to Cat (3).
        const move: [string, TableDelta][] = [
          ["Pets", delta({ updateRows: [1], columnDeltas: { keeper: { 1: [[1], [2]] } } })],
          ["Owners", delta({
            updateRows: [1, 2],
            columnDeltas: { keeps: { 1: [[[L, 1]], [null]], 2: [[null], [[L, 1]]] } },
          })],
        ];
        const trunkChanges = {
          Pets: delta({ updateRows: [1], columnDeltas: { keeper: { 1: [[1], [3]] } } }),
          Owners: delta({
            updateRows: [1, 3],
            columnDeltas: { keeps: { 1: [[[L, 1]], [null]], 3: [[null], [[L, 1]]] } },
          }),
        };
        assert.deepEqual(buildActions(move, getColumn, trunkChanges), [
          ["BulkUpdateRecord", "Pets", [1], { keeper: [2] }],
        ]);
      });
    });

    describe("with rows the trunk has removed", function() {
      // The trunk removed Owners rows 2 and 3 and Pets row 2 since the
      // branch point, and reused id 3 of Owners for a new row.
      const trunkChanges = {
        Owners: delta({ removeRows: [2, 3], addRows: [3] }),
        Pets: delta({ removeRows: [2] }),
      };

      it("drops removes of rows the trunk removed too", function() {
        const actions = buildActions([["Pets", delta({ removeRows: [1, 2] })]], getColumn, trunkChanges);
        assert.deepEqual(actions, [["BulkRemoveRecord", "Pets", [1]]]);
      });

      it("refuses to update a row the trunk removed", function() {
        assert.throws(() => buildActions([["Pets", delta({
          updateRows: [2],
          columnDeltas: { name: { 2: [["Tom"], ["Tim"]] } },
        })]], getColumn, trunkChanges), /changes row 2 of Pets, which was removed/);
      });

      it("refuses a reference to a row whose id the trunk reused", function() {
        assert.throws(() => buildActions([["Pets", delta({
          addRows: [5],
          columnDeltas: { keeper: { 5: [null, [3]] } },
        })]], getColumn, trunkChanges), /Pets.keeper to refer to row 3 of Owners/);
      });

      it("lets a reference to a row the trunk removed dangle", function() {
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

      it("allows a reference to a row the fork re-added under a removed id", function() {
        // On the fork, Owners row 2 was removed and its id reused.
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

    it("throws for a column the trunk does not have", function() {
      assert.throws(() => buildActions([["Pets", delta({
        updateRows: [1],
        columnDeltas: { color: { 1: [["red"], ["blue"]] } },
      })]], getColumn), /column not found: color/);
    });
  });

  describe("translateRefValue", function() {
    // Rows 5 and 6 are being added; everything else is shared.
    const isForkAdded = (rowId: number) => [5, 6].includes(rowId);

    it("turns a Ref to an added row into a temp id", function() {
      assert.deepEqual(translateRefValue(5, isForkAdded), { value: -5 });
    });

    it("leaves a Ref to a shared row alone", function() {
      assert.isUndefined(translateRefValue(1, isForkAdded));
      assert.isUndefined(translateRefValue(0, isForkAdded));
      assert.isUndefined(translateRefValue(null, isForkAdded));
    });

    it("translates only the added rows in a RefList, keeping order", function() {
      assert.deepEqual(translateRefValue([L, 6, 1, 5], isForkAdded), { value: [L, -6, 1, -5] });
      assert.isUndefined(translateRefValue([L, 1, 2], isForkAdded));
      assert.isUndefined(translateRefValue([L], isForkAdded));
    });

    it("leaves other values in a reference column alone", function() {
      // Alt text left in a Ref column when a value failed to convert.
      assert.isUndefined(translateRefValue("Rex", isForkAdded));
    });
  });
});
