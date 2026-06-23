import { chunkByLattice, chunkByOwners } from "app/common/ActionLayout";
import {
  ActionSummaryOptions, canonicalizeSummary, concatenateSummaries, concatenateSummaryPair,
  rebaseSummary, summarizeAction, summarizeStoredAndUndo,
} from "app/common/ActionSummarizer";
import { ActionSummary, asTabularDiffs, createEmptyTableDelta, LabelDelta, TableDelta } from "app/common/ActionSummary";
import { DocAction } from "app/common/DocActions";
import { TimeCursor } from "app/common/TimeQuery";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";
import { assert } from "test/server/testUtils";

import { cloneDeep, keyBy } from "lodash";

/** get a summary of the last LocalActionBundle applied to a given document */
async function summarizeLastAction(doc: ActiveDoc, options?: ActionSummaryOptions) {
  return summarizeAction((await doc.getRecentActionsDirect(1))[0], options);
}

/** A TableDelta with the given fields overriding an empty one. */
function td(o: Partial<TableDelta> = {}): TableDelta {
  return { ...createEmptyTableDelta(), ...o };
}

/** An ActionSummary from its renames and (optional) per-table deltas. */
function S(tableRenames: LabelDelta[], tableDeltas: ActionSummary["tableDeltas"] = {}): ActionSummary {
  return { tableRenames, tableDeltas };
}

describe("ActionSummary", function() {
  this.timeout(4000);

  // Comment this out to see debug-log output when debugging tests.
  testUtils.setTmpLogLevel("error");

  const docTools = createDocTools();

  it("summarizes table-level changes", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Ducks", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddTable", "Bricks", [{ id: "texture" }, { id: "length" }]],
    ]);
    // add two tables, remove a table, rename a table
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddTable", "Moons", [{ id: "planet" }, { id: "radius" }]],
      ["RemoveTable", "Ducks"],
      ["RenameTable", "Bricks", "Blocks"],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.sameDeepMembers(sum.tableRenames,
      [[null, "Frogs"],
        [null, "Moons"],
        ["Ducks", null],
        ["Bricks", "Blocks"]]);
    // Last change touched content of Ducks, Frogs, and Moons.  Bricks was renamed but had
    // no column or row changes.  Ducks was removed, so it is referred to as "-Ducks".
    assert.sameDeepMembers(Object.keys(sum.tableDeltas).filter(name => !(name.startsWith("_"))),
      ["-Ducks", "Frogs", "Moons"]);
  });

  it("summarizes column-level changes", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Ducks", [{ id: "species" }, { id: "color" }, { id: "place" }]],
    ]);
    // add a column, remove a column, rename a column
    await doc.applyUserActions(session, [
      ["AddColumn", "Ducks", "wings", {}],
      ["RemoveColumn", "Ducks", "color"],
      ["RenameColumn", "Ducks", "place", "location"],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.sameDeepMembers(sum.tableDeltas.Ducks.columnRenames,
      [["place", "location"],
        [null, "wings"],
        ["color", null]]);
  });

  it("summarizes row-level changes", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    // add a row, remove a row, update a row
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Frogs", 1, { place: "Alaska" }],
      ["AddRecord", "Frogs", null, { species: "gretons", color: "green", place: "Northern France" }],
      ["RemoveRecord", "Frogs", 2],
    ]);
    const sum = await summarizeLastAction(doc);
    assert(sum.tableRenames.length === 0);
    assert.deepEqual(sum, {
      tableRenames: [],
      tableDeltas: {
        Frogs: {
          columnRenames: [],
          updateRows: [1],
          removeRows: [2],
          addRows: [3],
          columnDeltas: {
            manualSort: {
              2: [[2], null],
              3: [null, [3]],
            },
            species: {
              2: [["parrots"], null],
              3: [null, ["gretons"]],
            },
            color: {
              2: [["green"], null],
              3: [null, ["green"]],
            },
            place: {
              1: [["Alaskers"], ["Alaska"]],
              2: [["Jungletown"], null],
              3: [null, ["Northern France"]],
            },
          },
        },
      },
    });
  });

  it("produces reasonable tabular diffs", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    // add a row, remove a row, update a row
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Frogs", 1, { place: "Alaska" }],
      ["AddRecord", "Frogs", null, { species: "gretons", color: "green", place: "Northern France" }],
      ["RemoveRecord", "Frogs", 2],
    ]);
    const sum = await summarizeLastAction(doc);
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.sameDeepMembers(tabularDiffs.Frogs.header,
      ["species", "color", "place"]);
    assert.lengthOf(tabularDiffs.Frogs.cells, 3);
    const rowTypes = tabularDiffs.Frogs.cells.map(row => row.type);
    assert.sameDeepMembers(rowTypes, ["+", "-", "→"]);
    const colsList = tabularDiffs.Frogs.header.map((name, idx) => [name, idx] as [string, number]);
    const cols = new Map<string, number>(colsList);
    const rows = keyBy(tabularDiffs.Frogs.cells, row => row.type);
    assert.deepEqual(rows["+"].cellDeltas[cols.get("species")!], [null, ["gretons"]]);
    assert.deepEqual(rows["→"].cellDeltas[cols.get("place")!], [["Alaskers"], ["Alaska"]]);
    assert.deepEqual(rows["-"].cellDeltas[cols.get("species")!], [["parrots"], null]);
  });

  it("produces reasonable tabular diffs of simple bulk actions", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    const ids = Array.from(Array(100).keys()).map(x => x + 3);
    // add many rows
    await doc.applyUserActions(session, [
      ["BulkAddRecord", "Frogs", ids,
        {
          species: ids.map(x => "species " + x),
          color: ids.map(x => "color " + x),
          place: ids.map(x => "place " + x),
        }],
    ]);
    const sum = await summarizeLastAction(doc);
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.sameDeepMembers(tabularDiffs.Frogs.header,
      ["species", "color", "place"]);
    assert(tabularDiffs.Frogs.cells.length < ids.length);
    const rowTypes = tabularDiffs.Frogs.cells.map(row => row.type);
    assert.equal(rowTypes.length - 1, rowTypes.filter(label => label === "+").length);
    assert.equal(1, rowTypes.filter(label => label === "...").length);
  });

  it("produces tabular diffs that separate out reused rowIds", async function() {
    const sum: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Duck: {
          addRows: [1],
          removeRows: [1],
          updateRows: [],
          columnRenames: [],
          columnDeltas: {
            color: {
              1: [["yellow"], ["red"]],
            },
          },
        },
      },
    };
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.lengthOf(tabularDiffs.Duck.cells, 2);
    assert.sameDeepMembers(tabularDiffs.Duck.cells,
      [{ type: "-", rowId: 1, cellDeltas: [[["yellow"], null]] },
        { type: "+", rowId: 1, cellDeltas: [[null, ["red"]]] }]);
  });

  it("summarizes ReplaceTableData actions", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    await doc.applyUserActions(session, [
      ["ReplaceTableData", "Frogs", [1],
        { species: ["bouncers"], color: ["blue"], place: ["Bouncy Castle"] }],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.deepEqual(sum, {
      tableRenames: [],
      tableDeltas: {
        Frogs: {
          columnRenames: [],
          updateRows: [],
          removeRows: [1, 2],
          addRows: [1],
          columnDeltas: {
            manualSort: {
              1: [[1], [1]],
              2: [[2], null],
            },
            species: {
              1: [["yellers"], ["bouncers"]],
              2: [["parrots"], null],
            },
            color: {
              1: [["yellow"], ["blue"]],
              2: [["green"], null],
            },
            place: {
              1: [["Alaskers"], ["Bouncy Castle"]],
              2: [["Jungletown"], null],
            },
          },
        },
      },
    });
  });

  it("summarizes changes in sample documents", async function() {
    // The history of sample documents was crudely migrated from an older form,
    // so we check that diffs are generated for it.
    const doc = await docTools.loadFixtureDoc("Favorite_Films.grist");
    const session = docTools.createFakeSession();
    const { actions } = await doc.getRecentActions(session, true);
    assert(Object.keys(actions[0].actionSummary.tableDeltas).length > 0, "some diff present");

    // Pick out a change where Captain America is replaced with Steve Rogers.
    // Identifying this requires collating the action and undo information.
    const history = doc.getActionHistory();
    const [firstAction] = await history.getActions([118]);
    const summary = summarizeAction(firstAction!);
    assert.deepEqual(summary.tableDeltas.Performances.columnDeltas.Character[6],
      [["Captain America"], ["Steve Rogers"]]);
  });

  it("includes adequate information about table deletions", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc(":memory:");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    // add a row, remove a row, update a row
    await doc.applyUserActions(session, [
      ["RemoveTable", "Frogs"],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.include(Object.keys(sum.tableDeltas), "-Frogs");
    assert.notInclude(Object.keys(sum.tableDeltas), "Frogs");
    const columns = sum.tableDeltas["-Frogs"].columnDeltas;
    assert.sameDeepMembers(Object.keys(columns), ["-manualSort", "-species", "-color", "-place"]);
    assert.deepEqual(columns["-color"][1], [["yellow"], null]);
  });

  it("can compose table renames", async function() {
    const summary1: ActionSummary = {
      tableRenames: [[null, "Frogs"],        // created in summary1
        ["Spaces", "Spices"],   // renamed in s1
        ["Dinosaurs", null],    // removed in s1
        ["Fish", "Sharks"],     // renamed in both
        [null, "Transients"],   // created in s1, removed in s2
        ["Doppelganger", null]], // removed in s1, same name created in s2
      tableDeltas: {
        "Frogs": createEmptyTableDelta(),
        "Spices": createEmptyTableDelta(),
        "Sharks": createEmptyTableDelta(),
        "Transients": createEmptyTableDelta(),
        "-Dinosaurs": createEmptyTableDelta(),
        "-Doppelganger": createEmptyTableDelta(),
        "Koalas": createEmptyTableDelta(),
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [[null, "Ducks"],        // created in s2
        ["Colours", "Colors"],  // renamed in s2
        ["Trilobytes", null],   // removed in s2
        ["Sharks", "GreatWhites"],  // renamed in both
        ["Transients", null],   // created in s1, removed in s2
        [null, "Doppelganger"], // removed in s1, same name created in s2
        ["Koalas", "Pajamas"]],  // mentioned in s1, renamed here
      tableDeltas: {
        "Ducks": createEmptyTableDelta(),
        "Colors": createEmptyTableDelta(),
        "GreatWhites": createEmptyTableDelta(),
        "Doppelganger": createEmptyTableDelta(),
        "-Trilobytes": createEmptyTableDelta(),
        "-Transients": createEmptyTableDelta(),
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [["Colours", "Colors"],
        ["Dinosaurs", null],
        ["Doppelganger", null],
        ["Fish", "GreatWhites"],
        ["Koalas", "Pajamas"],
        ["Spaces", "Spices"],
        ["Trilobytes", null],
        [null, "Doppelganger"],
        [null, "Ducks"],
        [null, "Frogs"]],
      // The inputs' per-table deltas are all empty, so
      // the composed summary omits them: table existence is conveyed by
      // tableRenames, and an empty per-table delta carries nothing.
      tableDeltas: {},
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it("can compose column renames", async function() {
    const summary1: ActionSummary = {
      tableRenames: [["Fish", "Sharks"]],
      tableDeltas: {
        Sharks: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [["age", "years"],
            [null, "color"],
            ["depth", null],
            [null, "transient"]],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [["Sharks", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [["years", "minutes"],
            [null, "weight"],
            ["anger", null],
            ["transient", null]],
        },
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [["Fish", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [["age", "minutes"],
            ["anger", null],
            ["depth", null],
            [null, "color"],
            [null, "weight"]],
        },
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it("can compose cell changes", async function() {
    const summary1: ActionSummary = {
      tableRenames: [["Fish", "Sharks"]],
      tableDeltas: {
        Sharks: {
          updateRows: [1],
          removeRows: [10],
          addRows: [11, 12],
          columnDeltas: {
            "years": {
              1: [["11"], ["111"]],
              11: [null, ["15"]],
              12: [null, ["99"]],
            },
            "-color": {
              1: [["gray"], null],
              // Rows 11, 12 are added in this scope, so they had no pre-state
              // value: a cell under the removed `color` column is [null, null]
              // for them, and so is omitted. An added row cannot have a pre value.
            },
          },
          columnRenames: [["age", "years"], ["color", null]],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [["Sharks", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [2, 11],
          removeRows: [9, 12],
          addRows: [],
          columnDeltas: {
            minutes: {
              2: [["22"], ["222"]],
              9: [["99"], null],
              11: [["15"], ["6000"]],
              12: [["99"], null],
            },
          },
          columnRenames: [["years", "minutes"]],
        },
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [["Fish", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [1, 2],
          removeRows: [9, 10],
          addRows: [11],
          columnDeltas: {
            "minutes": {
              1: [["11"], ["111"]],
              2: [["22"], ["222"]],
              9: [["99"], null],
              11: [null, ["6000"]],
            },
            "-color": {
              1: [["gray"], null],
              // Row 11 is added in this scope: no pre-state value, so its
              // cell under the removed `color` column is omitted.
            },
          },
          columnRenames: [["age", "minutes"], ["color", null]],
        },
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it("can compose remove-then-add of same rowId preserving old values", async function() {
    // When a row is removed in one summary and a new row reuses the same ID
    // in the next summary, the composed result should have the row in both
    // removeRows and addRows, with the column delta preserving the old
    // (pre-removal) value at index 0 and the new (post-add) value at index 1.
    const summary1: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Animals: {
          updateRows: [],
          removeRows: [1],
          addRows: [],
          columnDeltas: {
            name: {
              1: [["Fish"], null],
            },
          },
          columnRenames: [],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        Animals: {
          updateRows: [],
          removeRows: [],
          addRows: [1],
          columnDeltas: {
            name: {
              1: [null, ["Elephant"]],
            },
          },
          columnRenames: [],
        },
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    const td = result.tableDeltas.Animals;
    // Row 1 should be in both removeRows and addRows.
    assert.include(td.removeRows, 1);
    assert.include(td.addRows, 1);
    // The column delta should preserve the old value from the removal
    // and the new value from the add.
    assert.deepEqual(td.columnDeltas.name[1], [["Fish"], ["Elephant"]]);
  });

  it("can work through full history of a test file", async function() {
    // At the time of writing, this fixture has 216 rows in its ActionHistory.
    const doc = await docTools.loadFixtureDoc("Favorite_Films.grist");
    const history = doc.getActionHistory();
    const actions = await history.getRecentActions();
    const sums = actions.map(act => summarizeAction(act));
    const renames = sums.map(s => s.tableRenames).filter(rn => rn.length > 0);
    // Check the sequence of table renames recovered.
    assert.deepEqual(renames,
      [[[null, "Table1"]],
        [["Table1", "Films"]],
        [[null, "Table"]],
        [["Table", "Actors"]],
        [[null, "Table"]],
        [["Table", "Friends"]],
        [["Actors", "Performances"]],
        [["Films", "Films_"]],
        [["Films_", "Films"]],
        [["Friends", "Friends_"]],
        [["Friends_", "Friends"]],
        [["Performances", "Performances2"]],
        [["Performances2", "Performances"]]]);
    const sum = concatenateSummariesCleanly(sums);
    // at the end of history, we have three tables
    assert.deepEqual(sum.tableRenames,
      [[null, "Films"],
        [null, "Friends"],
        [null, "Performances"]]);
    // all columns should be created, since nothing existed beforehand
    assert.deepEqual(sum.tableDeltas.Films.columnRenames,
      [[null, "Budget_millions"],
        [null, "Release_Date"],
        [null, "Title"]]);
  });

  it("summarizes a legacy-shaped bundle (orphaned metadata undos) correctly", function() {
    // Legacy (pre-~2017) bundles recorded only the user-facing action in
    // `stored` while `undo` also carried the metadata-side inverses. The
    // chunker can't attribute those extra undos to a stored action, so it
    // gathers them as orphans; concat merges them back, with no whole-bundle-
    // walk fallback. For an AddTable, the metadata churn is the table's own
    // creation, so the summary surfaces just the new table and its columns --
    // exactly what the old whole-bundle walk produced (verified bundle-by-
    // bundle against Favorite_Films.grist's real history, which has this shape
    // at runs 1/7/9).
    const stored: DocAction[] = [
      ["AddTable", "Foo", [{ id: "a" }, { id: "b" }] as any],
    ];
    const undo: DocAction[] = [
      ["RemoveTable", "Foo"],
      ["RemoveRecord", "_grist_Tables", 5],
      ["BulkRemoveRecord", "_grist_Tables_column", [10, 11]],
    ];
    const sum = summarizeStoredAndUndo(stored, undo, { maximumInlineRows: null });
    // The new table is summarized with its columns; the orphaned metadata
    // undos (the table's own creation records) are absorbed, not surfaced as
    // spurious _grist_* deltas.
    assert.deepEqual(sum.tableRenames, [[null, "Foo"]]);
    assert.deepEqual(Object.keys(sum.tableDeltas), ["Foo"]);
    assert.deepEqual(sum.tableDeltas.Foo.columnRenames, [[null, "a"], [null, "b"]]);
  });

  it("summarizes partially uncached changes consistently", async function() {
    // The summaries here simulate a summarizer that dropped some cell
    // values to stay under the inline-rows limit: rows 12-14 / 15-16 are
    // in updateRows but their cellDelta entries were not recorded.
    // mayBeIncomplete = true marks that state, so composition keeps the
    // '?' wildcard rather than recovering an intermediate value from the
    // other summary (which wouldn't be the bundle-overall pre / post).
    const summary1: ActionSummary = {
      tableRenames: [["Fish", "Sharks"]],
      tableDeltas: {
        Sharks: {
          updateRows: [1, 13, 14, 15, 16],
          removeRows: [10],
          addRows: [11, 12],
          mayBeIncomplete: true,
          columnDeltas: {
            "years": {
              1: [["11"], ["111"]],
              10: [["10"], null],
              11: [null, ["15"]],
              // rows 12 + 13 + 14 happen not to be cached.
              15: [["15"], ["115"]],
              16: [["16"], ["166"]],
            },
            "-color": {
              1: [["gray"], null],
              10: [["yellow"], null],
              // Row 11 is added in this scope: no pre-state value, so its cell
              // under the removed `color` column is omitted (an added row
              // cannot carry a pre-value).
              // rows 12 + 13 + 14 happen not to be cached.
              15: [["white"], null],
              16: [["black"], null],
            },
          },
          columnRenames: [["age", "years"], ["color", null]],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [["Sharks", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [2, 11, 12, 14, 15],
          removeRows: [9, 16],
          addRows: [],
          mayBeIncomplete: true,
          columnDeltas: {
            minutes: {
              2: [["22"], ["222"]],
              9: [["99"], null],
              11: [["15"], ["6000"]],
              12: [["99"], ["98"]],
              14: [["14"], ["55"]],
              // row 15 happens not to be cached.
              // row 16 happens not to be cached.
            },
          },
          columnRenames: [["years", "minutes"]],
        },
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [["Fish", "GreatWhites"]],
      tableDeltas: {
        GreatWhites: {
          updateRows: [1, 2, 13, 14, 15],
          removeRows: [9, 10, 16],
          addRows: [11, 12],
          mayBeIncomplete: true,
          columnDeltas: {
            "minutes": {
              1: [["11"], ["111"]],
              2: [["22"], ["222"]],
              9: [["99"], null],
              10: [["10"], null],
              11: [null, ["6000"]],
              12: [null, ["98"]],
              14: ["?", ["55"]],
              15: [["15"], "?"],
              16: [["16"], null],
            },
            "-color": {
              1: [["gray"], null],
              10: [["yellow"], null],
              // Row 11 is added: omitted under the removed `color` column.
              15: [["white"], null],
              16: [["black"], null],
            },
          },
          columnRenames: [["age", "minutes"], ["color", null]],
        },
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it("composes a row touched in one summary with a value carried only by the other", async function() {
    // Focused regression test for `mergeColumn` precision: row 1 is marked
    // "updated" in summary1 because summary1 changed its `other` column,
    // but summary1 doesn't carry an entry for the `target` column. summary2
    // carries the real pre/post for `target` on row 1. The composed result
    // should report `target[1]` at its real values, not synthesize a `'?'`
    // wildcard for the side summary1 didn't carry.
    const summary1: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        T: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: { other: { 1: [["x"], ["y"]] } },
          columnRenames: [],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        T: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: { target: { 1: [["a"], ["b"]] } },
          columnRenames: [],
        },
      },
    };
    const merged = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(merged.tableDeltas.T.columnDeltas.target[1], [["a"], ["b"]]);
    // The composed summary inherits no `mayBeIncomplete` (neither input
    // had it).
    assert.notProperty(merged.tableDeltas.T, "mayBeIncomplete");
  });

  it("sets mayBeIncomplete on a bulk action that exceeds the inline-rows cap", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("incomplete-cap.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }]],
    ]);
    // Add many rows in one bulk action - well over the default 10-row cap.
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    await doc.applyUserActions(session, [
      ["BulkAddRecord", "Frogs", ids, { species: ids.map(x => "frog " + x) }],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.equal(sum.tableDeltas.Frogs.mayBeIncomplete, true);
  });

  it("does not set mayBeIncomplete on a small update", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("incomplete-small.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }]],
      ["AddRecord", "Frogs", null, { species: "frog 1" }],
    ]);
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Frogs", 1, { species: "renamed" }],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.notProperty(sum.tableDeltas.Frogs, "mayBeIncomplete");
  });

  it("keeps the '?' wildcard when composing summaries flagged as mayBeIncomplete", async function() {
    // Same shape as the test above, but summary1 declares itself
    // `mayBeIncomplete: true` (some cells were dropped to stay under the
    // inline-rows limit). The composition should respect that and keep
    // the '?' wildcard on the pre side rather than recovering from
    // summary2's pre, because for a dropped cell summary2's pre is an
    // intermediate value, not the bundle-overall pre.
    const summary1: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        T: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          mayBeIncomplete: true,
          columnDeltas: { target: { 2: [["a2"], ["b2"]] } },
          columnRenames: [],
        },
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [],
      tableDeltas: {
        T: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: { target: { 1: [["a"], ["b"]] } },
          columnRenames: [],
        },
      },
    };
    const merged = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(merged.tableDeltas.T.columnDeltas.target[1], ["?", ["b"]]);
    // mayBeIncomplete propagates through composition.
    assert.equal(merged.tableDeltas.T.mayBeIncomplete, true);
  });

  it("recognizes bulk removal", async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    await doc.applyUserActions(session, [
      ["BulkRemoveRecord", "Frogs", [1, 2]],
    ]);
    const sum = await summarizeLastAction(doc);
    assert.deepEqual(sum.tableDeltas.Frogs.removeRows, [1, 2]);
    assert.deepEqual(sum.tableDeltas.Frogs.columnDeltas.species, {
      1: [["yellers"], null],
      2: [["parrots"], null],
    });
  });

  it("can preserve all rows or specific columns entirely if requested", async function() {
    // Make a document, and then as the last action add many rows.
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{ id: "species" }, { id: "color" }, { id: "place" }]],
      ["AddRecord", "Frogs", null, { species: "yellers", color: "yellow", place: "Alaskers" }],
      ["AddRecord", "Frogs", null, { species: "parrots", color: "green", place: "Jungletown" }],
    ]);
    const ids = [3, 4, 5, 6, 7, 8];
    await doc.applyUserActions(session, [
      ["BulkAddRecord", "Frogs", ids,
        {
          species: ids.map(x => "species " + x),
          color: ids.map(x => "color " + x),
          place: ids.map(x => "place " + x),
        }],
    ]);

    // Request a summarization with no row limit.
    const sum = await summarizeLastAction(doc, { maximumInlineRows: Infinity });

    // Check result is as expected, with no rows omitted.
    assert.deepEqual(sum, {
      tableRenames: [],
      tableDeltas: {
        Frogs: {
          updateRows: [],
          removeRows: [],
          addRows: [3, 4, 5, 6, 7, 8],
          columnDeltas: {
            manualSort: {
              3: [null, [3]],
              4: [null, [4]],
              5: [null, [5]],
              6: [null, [6]],
              7: [null, [7]],
              8: [null, [8]],
            },
            species: {
              3: [null, ["species 3"]],
              4: [null, ["species 4"]],
              5: [null, ["species 5"]],
              6: [null, ["species 6"]],
              7: [null, ["species 7"]],
              8: [null, ["species 8"]],
            },
            color: {
              3: [null, ["color 3"]],
              4: [null, ["color 4"]],
              5: [null, ["color 5"]],
              6: [null, ["color 6"]],
              7: [null, ["color 7"]],
              8: [null, ["color 8"]],
            },
            place: {
              3: [null, ["place 3"]],
              4: [null, ["place 4"]],
              5: [null, ["place 5"]],
              6: [null, ["place 6"]],
              7: [null, ["place 7"]],
              8: [null, ["place 8"]],
            },
          },
          columnRenames: [],
        },
      },
    });

    // Request a summarization with a row limit but full preservation of some columns.
    const sum2 = await summarizeLastAction(doc, { alwaysPreserveColIds: ["color", "species"],
      maximumInlineRows: 4 });

    // Check result is as expected, with full color and species, but other columns curtailed.
    sum.tableDeltas.Frogs.columnDeltas.manualSort = {
      3: [null, [3]],
      4: [null, [4]],
      5: [null, [5]],
      8: [null, [8]],
    };
    sum.tableDeltas.Frogs.columnDeltas.place = {
      3: [null, ["place 3"]],
      4: [null, ["place 4"]],
      5: [null, ["place 5"]],
      8: [null, ["place 8"]],
    };
    // Truncation drove `mayBeIncomplete` on; the no-limit summary above
    // didn't have it. Mark the expected to match.
    sum.tableDeltas.Frogs.mayBeIncomplete = true;
    assert.deepEqual(sum2, sum);
  });

  describe("rebasing", async function() {
    function expand(deltas?: { [key: string]: Partial<TableDelta> }) {
      const result: { [key: string]: TableDelta } = {};
      if (!deltas) { return result; }
      for (const [key, delta] of Object.entries(deltas)) {
        result[key] = { ...empty, ...delta };
      }
      return result;
    }
    function assertRebase(options: {
      trunk?: {
        renames?: LabelDelta[],
        deltas?: { [key: string]: Partial<TableDelta> },
      },
      fork?: {
        renames?: LabelDelta[],
        deltas?: { [key: string]: Partial<TableDelta> },
      },
      result?: {
        renames?: LabelDelta[],
        deltas?: { [key: string]: Partial<TableDelta> },
      }
    }) {
      const ref: ActionSummary = {
        tableRenames: options.trunk?.renames ?? [],
        tableDeltas: expand(options.trunk?.deltas),
      };
      const target: ActionSummary = {
        tableRenames: options.fork?.renames ?? [],
        tableDeltas: expand(options.fork?.deltas),
      };
      const expected: ActionSummary = {
        tableRenames: options.result?.renames ?? [],
        tableDeltas: expand(options.result?.deltas),
      };
      rebaseSummary(ref, target);
      assert.deepEqual(target, expected);
    }
    const empty = createEmptyTableDelta();
    const something: TableDelta = {
      ...createEmptyTableDelta(),
      columnRenames: [["col1", "col2"]],
    };
    it("leaves target untouched if empty", async function() {
      assertRebase({});
      assertRebase({
        trunk: { renames: [["table1", "table2"]] },
      });
      assertRebase({
        trunk: { renames: [["table1", "table2"]],
          deltas: { table2: empty } },
      });
    });

    it("renames tables in target as needed", async function() {
      assertRebase({
        trunk: { renames: [["table1", "table2"]] },
        fork: { deltas: { table1: empty, table3: empty } },
        result: { deltas: { table2: empty, table3: empty } },
      });
      assertRebase({
        trunk: { renames: [["table1", "table2"], ["table2", "table1"]] },
        fork: { deltas: { table1: empty, table2: something } },
        result: { deltas: { table1: something, table2: empty } },
      });
    });

    it("preserves table renames in target", async function() {
      assertRebase({
        trunk: { renames: [["table1", "table2"], ["table2", "table1"]] },
        fork: {
          renames: [["table2", "table3"]],
          deltas: { table1: empty, table3: something },
        },
        result: {
          renames: [["table1", "table3"]],
          deltas: { table3: something, table2: empty },
        },
      });
    });

    it("respects table deletion in reference", async function() {
      assertRebase({
        trunk: { renames: [["table1", null]] },
        fork: {
          renames: [["table1", "table2"], ["table4", "table5"]],
          deltas: { table2: something, table3: empty },
        },
        result: {
          renames: [["table4", "table5"]],
          deltas: { table3: empty },
        },
      });
      assertRebase({
        trunk: { renames: [["table1", null]] },
        fork: {
          renames: [["table1", null]],
        },
        result: {
          renames: [],
        },
      });
      assertRebase({
        trunk: { renames: [["table1", null]] },
        fork: {
          renames: [["table1", "table2"]],
        },
        result: {
          renames: [],
        },
      });
      assertRebase({
        trunk: { renames: [["table1", null]] },
        fork: {
          renames: [["table1", "table2"], [null, "table1"]],
        },
        result: {
          renames: [[null, "table1"]],
        },
      });
    });

    it("handles column renames", async function() {
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [["col1", "col2"]] } } },
      });
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [["col1", "col2"]] } } },
        fork: { renames: [["table1", "table2"]] },
        result: { renames: [["table1", "table2"]] },
      });
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [["col1", "col2"]] } } },
        fork: { deltas: { table1: { columnDeltas: { col1: { 1: [null, null] } } } } },
        result: { deltas: { table1: { columnDeltas: { col2: { 1: [null, null] } } } } },
      });
      assertRebase({
        trunk: { deltas: { table1: {
          columnRenames: [["col1", "col2"], ["col2", "col1"], ["col3", null]],
        } } },
        fork: { deltas: { table1: { columnDeltas: {
          col1: { 1: [null, null] },
          col2: { 2: [null, null] },
          col3: { 3: [null, null] },
        } } } },
        result: { deltas: { table1: { columnDeltas: {
          col1: { 2: [null, null] },
          col2: { 1: [null, null] },
        } } } },
      });
      assertRebase({
        trunk: { deltas: { table1: {
          columnRenames: [["col1", "col2"], ["col2", "col1"], ["col3", null]],
        } } },
        fork: { deltas: { table1: {
          columnRenames: [["col1", "col9"]],
          columnDeltas: {
            col9: { 1: [null, null] },
            col2: { 2: [null, null] },
            col3: { 3: [null, null] },
          } } } },
        result: { deltas: { table1: {
          columnRenames: [["col2", "col9"]],
          columnDeltas: {
            col1: { 2: [null, null] },
            col9: { 1: [null, null] },
          } } } },
      });
    });
  });
});

function concatenateSummariesCleanly(args: ActionSummary[]) {
  const argsCopy = cloneDeep(args);
  const result = concatenateSummaries(args);
  for (let i = 0; i < args.length; i++) {
    assert.deepEqual(args[i], argsCopy[i]);
  }
  return result;
}

// Canonical-form normalization in composition, and the lattice chunker.

describe("ActionSummary canonical form", function() {
  it("erases a transient row's orphan-column cell without mutating the input", function() {
    // sum1 adds row 5 (no cell). sum2 removes row 5 and carries a cell for it in
    // column A. Row 5 is transient in the combined scope, so its cell is erased.
    // Because sum1 has no columns, mergeTable's column-level copy-on-write never
    // fires, so without care the erase would write straight into sum2's
    // columnDeltas dict (the shallow TableDelta copy still aliases it) and mutate
    // the caller's input. concatenateSummariesCleanly asserts both inputs are
    // left untouched.
    const sum1 = S([], { T: td({ addRows: [5] }) });
    const sum2 = S([], { T: td({ removeRows: [5], columnDeltas: { A: { 5: [["x"], ["y"]] } } }) });
    const result = concatenateSummariesCleanly([sum1, sum2]);
    // The transient row leaves no trace, so its table delta nets to empty.
    assert.isUndefined(result.tableDeltas.T);
  });

  it("drops a vacuous [v,v] cell and reclassifies the row out of updateRows", function() {
    // Oscillation: v -> w in a, w -> v in b. The combined cell is [v,v]
    // (no net change), so it is dropped, the row leaves updateRows, and
    // the now-empty table delta is omitted.
    const a = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["v"], ["w"]] } } }) });
    const b = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["w"], ["v"]] } } }) });
    const result = concatenateSummariesCleanly([a, b]);
    assert.deepEqual(result.tableDeltas, {});
  });

  it("drops empty column deltas and empty per-table deltas", function() {
    // Transient row 5 (added in a, removed in b). Its customer cell
    // cancels; region (recorded only by b) is stripped because the row
    // never existed at either combined endpoint. Nothing remains.
    const a = S([], { T: td({ addRows: [5], columnDeltas: { customer: { 5: [null, ["Alice"]] } } }) });
    const b = S([], { T: td({ removeRows: [5], columnDeltas: {
      customer: { 5: [["Alice"], null] }, region: { 5: [["NA"], null] } } }) });
    const result = concatenateSummariesCleanly([a, b]);
    assert.deepEqual(result.tableDeltas, {});
  });

  it("preserves recycled-row per-entity cells (no synthesis, no drop)", function() {
    // Row 5 removed (old entity, colX=x) then re-added (new entity,
    // colY=y). Recycled: row in both lists; colX stays [x,null] (old
    // entity), colY stays [null,y] (new entity). Neither is vacuous, so
    // neither is dropped; no "?" is introduced.
    const a = S([], { T: td({ removeRows: [5], columnDeltas: { colX: { 5: [["x"], null] } } }) });
    const b = S([], { T: td({ addRows: [5], columnDeltas: { colY: { 5: [null, ["y"]] } } }) });
    const result = concatenateSummariesCleanly([a, b]);
    const t = result.tableDeltas.T;
    assert.deepEqual(t.addRows, [5]);
    assert.deepEqual(t.removeRows, [5]);
    assert.deepEqual(t.columnDeltas.colX, { 5: [["x"], null] });
    assert.deepEqual(t.columnDeltas.colY, { 5: [null, ["y"]] });
  });

  it("keeps a row in updateRows under mayBeIncomplete even when its cell cancels", function() {
    // Same oscillation, but the table is mayBeIncomplete: the missing
    // cell might be a dropped value rather than "no change", so the row
    // is not reclassified out of updateRows.
    const a = S([], { T: td({ updateRows: [1], mayBeIncomplete: true,
      columnDeltas: { c: { 1: [["v"], ["w"]] } } }) });
    const b = S([], { T: td({ updateRows: [1], mayBeIncomplete: true,
      columnDeltas: { c: { 1: [["w"], ["v"]] } } }) });
    const result = concatenateSummariesCleanly([a, b]);
    assert.deepEqual(result.tableDeltas.T.updateRows, [1]);
    assert.equal(result.tableDeltas.T.mayBeIncomplete, true);
  });

  it("composition is associative with normalization (oscillation then a real change)", function() {
    const a = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["v"], ["w"]] } } }) });
    const b = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["w"], ["v"]] } } }) });
    const c = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["v"], ["u"]] } } }) });
    const left = concatenateSummariesCleanly([concatenateSummariesCleanly([a, b]), c]);
    const right = concatenateSummariesCleanly([a, concatenateSummariesCleanly([b, c])]);
    assert.deepEqual(left, right);
    assert.deepEqual(left.tableDeltas.T.columnDeltas.c, { 1: [["v"], ["u"]] });
  });
});

// Re-keying a delta's history onto the defunct name when its entity is
// modified/renamed in part 1 and then removed in part 2. Without this,
// part 1's row/cell history is stranded under a name (live or renamed)
// that no longer exists in the combined scope, and endpoint
// reconstruction cannot recover the removed entity's pre-state contents from
// the defunct key.

describe("ActionSummary defunct re-keying on remove-after-history", function() {
  it("merges a renamed-then-removed table's history under the defunct original name", function() {
    // Table existed as A, renamed A->B with a row update (part 1), then
    // B removed (part 2). Combined: A is removed, so its whole history
    // keys under "-A" with the pre-value from before everything.
    const part1 = S([["A", "B"]],
      { B: td({ updateRows: [1], columnDeltas: { col: { 1: [["old"], ["new"]] } } }) });
    const part2 = S([["B", null]],
      { ["-B"]: td({ removeRows: [1], columnDeltas: { col: { 1: [["new"], null] } } }) });
    const result = concatenateSummariesCleanly([part1, part2]);
    assert.deepEqual(result.tableRenames, [["A", null]]);
    assert.deepEqual(Object.keys(result.tableDeltas), ["-A"]);
    assert.deepEqual(result.tableDeltas["-A"].removeRows, [1]);
    assert.deepEqual(result.tableDeltas["-A"].columnDeltas.col, { 1: [["old"], null] });
  });

  it("re-keys a stable-but-edited table's history when it is removed in part 2", function() {
    // Table C is untouched-but-data-edited in part 1 (no rename), then
    // removed in part 2. Part 1's delta is keyed by the live name C and
    // must move to "-C" to merge with part 2's defunct delta.
    const part1 = S([],
      { C: td({ updateRows: [1], columnDeltas: { col: { 1: [["old"], ["new"]] } } }) });
    const part2 = S([["C", null]],
      { ["-C"]: td({ removeRows: [1], columnDeltas: { col: { 1: [["new"], null] } } }) });
    const result = concatenateSummariesCleanly([part1, part2]);
    assert.deepEqual(result.tableRenames, [["C", null]]);
    assert.deepEqual(Object.keys(result.tableDeltas), ["-C"]);
    assert.deepEqual(result.tableDeltas["-C"].removeRows, [1]);
    assert.deepEqual(result.tableDeltas["-C"].columnDeltas.col, { 1: [["old"], null] });
  });

  it("merges a renamed-then-removed column's history under its defunct original name", function() {
    // Same shape one level down: column a renamed a->b with a cell edit
    // (part 1), then b removed (part 2). The column history keys under
    // "-a" within the (surviving) table T.
    const part1 = S([], { T: td({ updateRows: [1],
      columnRenames: [["a", "b"]], columnDeltas: { b: { 1: [["old"], ["new"]] } } }) });
    const part2 = S([], { T: td({ updateRows: [1],
      columnRenames: [["b", null]], columnDeltas: { ["-b"]: { 1: [["new"], null] } } }) });
    const result = concatenateSummariesCleanly([part1, part2]);
    const t = result.tableDeltas.T;
    assert.deepEqual(t.columnRenames, [["a", null]]);
    assert.deepEqual(Object.keys(t.columnDeltas), ["-a"]);
    assert.deepEqual(t.columnDeltas["-a"], { 1: [["old"], null] });
  });
});

// concat must be associative. A row
// removed-then-readded within a scope is `recycled`, not `transient`:
// its pre-state value must survive a later removal. The bug this guards
// was that both the row-list (`transients`) and the cell merge treated
// "added in left ∧ removed in right" as transient, dropping the recycled
// row's pre-value -- so left- and right-association disagreed.

describe("ActionSummary concat associativity: recycled row then table removal", function() {
  // A: row 2 removed (had value v2). B: row 2 re-added (value a2) -- so
  // A.B recycles row 2. C: the whole table removed (row 2 then holds a2,
  // row 1 holds v1). True net: table existed with row 2 = v2, now gone, so
  // -T/-c row 2 must carry [v2, null].
  const A = S([], { T: td({ removeRows: [2], columnDeltas: { c: { 2: [["v2"], null] } } }) });
  const B = S([], { T: td({ addRows: [2], columnDeltas: { c: { 2: [null, ["a2"]] } } }) });
  const C = S([["T", null]], { ["-T"]: td({ removeRows: [1, 2],
    columnRenames: [["c", null]],
    columnDeltas: { ["-c"]: { 1: [["v1"], null], 2: [["a2"], null] } } }) });

  it("(A.B).C equals A.(B.C)", function() {
    const left = concatenateSummaryPair(concatenateSummaryPair(A, B), C);
    const right = concatenateSummaryPair(A, concatenateSummaryPair(B, C));
    assert.deepEqual(left, right);
  });

  it("keeps the recycled row's pre-state value through the removal", function() {
    const left = concatenateSummaryPair(concatenateSummaryPair(A, B), C);
    assert.deepEqual(left.tableRenames, [["T", null]]);
    const t = left.tableDeltas["-T"];
    assert.deepEqual(t.removeRows, [1, 2]);
    // Row 2's original value v2 must survive (not a2, and not dropped).
    assert.deepEqual(t.columnDeltas["-c"], { 1: [["v1"], null], 2: [["v2"], null] });
  });
});

// concat associativity for a recycled TABLE name. When a table is removed and a
// new one created under the same name, the old contents key under "-T" and the
// new table under "T".
// The bug this guards: composing the recycle ([T,null]+[null,T]) with a
// later edit marked the live name "T" dead, deleting the *new* table's
// delta -- so left- and right-association disagreed.

describe("ActionSummary concat associativity: recycled table name", function() {
  // A: remove table T (old contents land under "-T"). B: add a new table T
  // with column d (recycle). C: add column e to the new T. Combined: old T
  // removed (under "-T"), new T with columns d and e (under "T").
  const A = S([["T", null]], { ["-T"]: td({ removeRows: [1],
    columnRenames: [["c", null]], columnDeltas: { ["-c"]: { 1: [["old"], null] } } }) });
  const B = S([[null, "T"]], { T: td({ columnRenames: [[null, "d"]] }) });
  const C = S([], { T: td({ columnRenames: [[null, "e"]] }) });

  it("(A.B).C equals A.(B.C)", function() {
    const left = concatenateSummaryPair(concatenateSummaryPair(A, B), C);
    const right = concatenateSummaryPair(A, concatenateSummaryPair(B, C));
    assert.deepEqual(left, right);
  });

  it("keeps both the removed old table and the new recycled table", function() {
    const left = concatenateSummaryPair(concatenateSummaryPair(A, B), C);
    assert.deepEqual(left.tableRenames, [["T", null], [null, "T"]]);
    // Old table's contents preserved under the defunct name.
    assert.deepEqual(left.tableDeltas["-T"].columnDeltas["-c"], { 1: [["old"], null] });
    // New table's column-creation entries survive (not deleted as "dead").
    assert.deepEqual(left.tableDeltas.T.columnRenames, [[null, "d"], [null, "e"]]);
  });
});

// concat associativity when one table is renamed into a name freed by
// removing the previous occupant. The bug
// this guards: composing a rename T2->T3 with a part where T3 is recycled
// (old T3 removed, a new T3 added) marked the live name T3 dead on the
// right-hand deltas, deleting the *new* T3 -- so left- and right-
// association disagreed.

describe("ActionSummary concat associativity: rename into a recycled name", function() {
  // A: rename T2 -> T3. B: remove T3 (the former T2; contents land under
  // "-T3"). C: add a new table T3 with column y. Combined: the original T2
  // is gone (its contents under "-T2"), and a new T3 exists with column y.
  const A = S([["T2", "T3"]]);
  const B = S([["T3", null]], { ["-T3"]: td({ removeRows: [1],
    columnRenames: [["x", null]], columnDeltas: { ["-x"]: { 1: [["old"], null] } } }) });
  const C = S([[null, "T3"]], { T3: td({ columnRenames: [[null, "y"]] }) });

  it("(A.B).C equals A.(B.C)", function() {
    const left = concatenateSummaryPair(concatenateSummaryPair(A, B), C);
    const right = concatenateSummaryPair(A, concatenateSummaryPair(B, C));
    assert.deepEqual(left, right);
  });

  it("keeps the new T3 and routes the old T2's contents to its defunct name", function() {
    // Check the right fold: that is the grouping where the bug deleted the
    // new T3 (the recycle happens inside B.C before A is applied).
    const right = concatenateSummaryPair(A, concatenateSummaryPair(B, C));
    assert.deepEqual(right.tableRenames, [["T2", null], [null, "T3"]]);
    // New T3's column-creation entry survives (not deleted as "dead").
    assert.deepEqual(right.tableDeltas.T3.columnRenames, [[null, "y"]]);
    // Original T2's contents preserved under its defunct name.
    assert.deepEqual(right.tableDeltas["-T2"].columnDeltas["-x"], { 1: [["old"], null] });
  });
});

// Canonical rename order: rename entries
// sort by pre-name ascending, with additions (null pre-name) after all
// non-null pre-names, tie-broken by post-name. concat must apply this
// uniformly so that a delta merged here and one copied through untouched
// end up identically ordered -- otherwise composition is not associative
// on presentation.

describe("ActionSummary concat canonical rename order", function() {
  const EMPTY = S([], {});

  it("sorts table and column renames: renames first, additions last by post-name", function() {
    // Deliberately non-canonical input order (additions interleaved/out of order).
    const a = S([[null, "Z"], ["B", "A"], [null, "M"]],
      { T: td({ columnRenames: [[null, "m"], [null, "c"], ["x", "y"]] }) });
    const r = concatenateSummaryPair(a, EMPTY);
    assert.deepEqual(r.tableRenames, [["B", "A"], [null, "M"], [null, "Z"]]);
    assert.deepEqual(r.tableDeltas.T.columnRenames, [["x", "y"], [null, "c"], [null, "m"]]);
  });

  it("rename order is grouping-independent (associative)", function() {
    const a = S([], { T: td({ columnRenames: [[null, "m"], [null, "c"]] }) });
    const b = S([], { T: td({ columnRenames: [[null, "d"]] }) });
    const c = S([], { T: td({ columnRenames: [[null, "a"]] }) });
    const left = concatenateSummaryPair(concatenateSummaryPair(a, b), c);
    const right = concatenateSummaryPair(a, concatenateSummaryPair(b, c));
    assert.deepEqual(left, right);
    assert.deepEqual(left.tableDeltas.T.columnRenames, [[null, "a"], [null, "c"], [null, "d"], [null, "m"]]);
  });
});

// A removed row has no cells afterward,
// for every column -- including columns the removing summary did not
// mention (the engine drops all-default columns from a removal's restore
// undo). Composition must null the post side of such a column's cells at
// the removed rows, rather than copying the earlier summary's post value
// through a deleted row. Otherwise composition is not associative.

describe("ActionSummary concat: removal reaches a column only the earlier summary recorded", function() {
  it("nulls the post of an only-in-part-1 column at a row part 2 removes", function() {
    // A changes column c at row 1. B removes row 1 but mentions only column
    // x (as the engine would, having dropped all-default c from the restore).
    // c is present only in A; row 1 is gone, so c's post must be absent.
    const a = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: [["old"], ["new"]] } } }) });
    const b = S([], { T: td({ removeRows: [1], columnDeltas: { x: { 1: [["o"], null] } } }) });
    const r = concatenateSummaryPair(a, b);
    assert.deepEqual(r.tableDeltas.T.removeRows, [1]);
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c, { 1: [["old"], null] });
  });

  it("is associative when removing summaries omit a column the first recorded", function() {
    const a = S([], { T: td({ updateRows: [1, 2],
      columnDeltas: { c: { 1: [["a1"], ["b1"]], 2: [["a2"], ["b2"]] } } }) });
    const b = S([], { T: td({ removeRows: [1], columnDeltas: { x: { 1: [["o"], null] } } }) });
    const c = S([], { T: td({ removeRows: [2], columnDeltas: { x: { 2: [["p"], null] } } }) });
    const left = concatenateSummaryPair(concatenateSummaryPair(a, b), c);
    const right = concatenateSummaryPair(a, concatenateSummaryPair(b, c));
    assert.deepEqual(left, right);
    assert.deepEqual(left.tableDeltas.T.columnDeltas.c, { 1: [["a1"], null], 2: [["a2"], null] });
  });
});

// Delta keying: a removed column's cells
// key under its `-`-prefixed pre-name, never the now-defunct live name.
// The chunk walk can leave a cell under the live name (a row removed before
// the column went defunct), and planNameMerge assumes the defunct keying is
// already in place. normalizeTableDelta must enforce it, or composition is
// not associative.

describe("ActionSummary canonical form: removed column re-keys live-name cells", function() {
  it("moves a stranded live-name cell onto the column's defunct name", function() {
    // Column c is removed (columnRenames [c, null]). Row 1's cell is stranded
    // under the live name `c` (its row died before the column did); row 2's is
    // already under `-c`. Normalization must put both under `-c`.
    const x = S([], { T: td({
      removeRows: [1],
      columnDeltas: { "c": { 1: [["old"], null] }, "-c": { 2: [["a"], null] } },
      columnRenames: [["c", null]],
    }) });
    const r = concatenateSummaryPair(x, { tableRenames: [], tableDeltas: {} });
    assert.isUndefined(r.tableDeltas.T.columnDeltas.c, "no cell stranded under the live name");
    assert.deepEqual(r.tableDeltas.T.columnDeltas["-c"], { 1: [["old"], null], 2: [["a"], null] });
  });

  it("does not re-key a recycled column (removed and re-added)", function() {
    // c is removed AND re-added in scope: the live `c` key holds a distinct
    // new entity and must be preserved, not folded into `-c`.
    const x = S([], { T: td({
      columnDeltas: { "c": { 3: [null, ["new"]] }, "-c": { 1: [["old"], null] } },
      columnRenames: [["c", null], [null, "c"]],
    }) });
    const r = concatenateSummaryPair(x, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c, { 3: [null, ["new"]] }, "recycled column preserved");
    assert.deepEqual(r.tableDeltas.T.columnDeltas["-c"], { 1: [["old"], null] });
  });

  it("does not re-key a column another was renamed into (rename target)", function() {
    // Old `c2` was removed (its data is under `-c2`); `c1` is then renamed to
    // `c2`, so the live `c2` key holds the renamed-in c1 entity. That live
    // entity keys by its post-name `c2`, and must not be swept to
    // `-c2` and collide with the removed old c2.
    const x = S([], { T: td({
      columnDeltas: { "c2": { 1: [["c1val"], [""]] }, "-c2": { 1: [["oldc2"], null] } },
      columnRenames: [["c1", "c2"], ["c2", null]],
    }) });
    const r = concatenateSummaryPair(x, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c2, { 1: [["c1val"], [""]] },
      "renamed-in entity stays under its post-name");
    assert.deepEqual(r.tableDeltas.T.columnDeltas["-c2"], { 1: [["oldc2"], null] },
      "removed old occupant unaffected");
  });
});

// updateRows means "same entity persisted and its contents
// changed". Contents changes live in cells, so updateRows is DERIVED from the
// cells -- a persisting row with a cell delta -- not accumulated. Deriving it
// keeps concat associative: the accumulated list can differ by composition
// order, the cells cannot.
describe("ActionSummary canonical form: updateRows derived from cells", function() {
  it("marks a persisting row updated when a removed column leaves it a cell", function() {
    // Row 4 persists; column c is removed, so row 4 keeps a `-c` cell. Even
    // with no incoming updateRows entry, it is `updated` (its contents changed).
    const x = S([], { T: td({ columnRenames: [["c", null]], columnDeltas: { "-c": { 4: [["v"], null] } } }) });
    const r = canonicalizeSummary(x);
    assert.deepEqual(r.tableDeltas.T.updateRows, [4]);
  });

  it("does not mark an added row as updated", function() {
    const x = S([], { T: td({ addRows: [4], columnDeltas: { c: { 4: [null, ["new"]] } } }) });
    assert.deepEqual(canonicalizeSummary(x).tableDeltas.T.updateRows, []);
  });

  it("does not mark a recycled row as updated", function() {
    const x = S([], { T: td({ addRows: [4], removeRows: [4],
      columnDeltas: { c: { 4: [["old"], ["new"]] } } }) });
    assert.deepEqual(canonicalizeSummary(x).tableDeltas.T.updateRows, []);
  });

  it("drops an updateRows entry whose cell change canceled out (no cell left)", function() {
    // Row 2 was in updateRows but its only cell oscillated back, so it has no
    // canonical cell -- no net change, so not updated. With nothing else in the
    // table delta, it canonicalizes to empty and is dropped entirely.
    const x = S([], { T: td({ updateRows: [2], columnDeltas: { c: { 2: [["x"], ["x"]] } } }) });
    assert.isUndefined(canonicalizeSummary(x).tableDeltas.T,
      "no net change -> empty table delta -> dropped");
  });
});

// A rename A -> B whose target B is already occupied must merge the two
// (they are facets of the same final entity), not overwrite B and drop its
// data. This arises when a calc-flush restore records a defunct entity's
// data under its POST-rename name while the removal is recorded under the
// PRE-rename name; the RenameTable then collides. Overwriting drops the
// restored values and breaks composition associativity.

describe("ActionSummary concat: rename onto an occupied key merges, not overwrites", function() {
  it("preserves data recorded under the post-rename table name", function() {
    // Part 1 holds the SAME table under two keys: T1 (column c removed) and a
    // premature T2 (c's pre-values, as a calc-flush restore would key them by
    // the final name). Part 2 renames T1 -> T2. The two T2 facets must merge:
    // c removed + c pre-values  =>  c's values under the defunct `-c`.
    const a = S([], {
      T1: td({ columnRenames: [["c", null]] }),
      T2: td({ updateRows: [2], columnDeltas: { c: { 2: [["v"], null] } } }),
    });
    const b = S([["T1", "T2"]]);
    const r = concatenateSummaryPair(a, b);
    assert.isUndefined(r.tableDeltas.T1, "T1 folded into T2");
    assert.deepEqual(r.tableDeltas.T2.columnRenames, [["c", null]]);
    assert.deepEqual(r.tableDeltas.T2.columnDeltas["-c"], { 2: [["v"], null] },
      "the value recorded under the post-rename name survives, re-keyed to -c");
    assert.isUndefined(r.tableDeltas.T2.columnDeltas.c, "nothing stranded under the live name");
  });
});

// A row removed in part 1 carries its old value as the cell's pre side. That
// pre is the combined pre-state value, so it must survive however part 2
// treats the row, including when part 2 also removes it.
describe("ActionSummary concat: a removed row's old value survives a second removal", function() {
  it("keeps the original pre-value when both parts remove the row", function() {
    // Part 1: row 1 recycled, old entity's c = "1", now gone. Part 2: removes
    // row 1 (the new entity), whose c reads "" (a formula default). The
    // combined pre-state value of c is the old entity's "1".
    const a = S([], { T: td({ addRows: [1], removeRows: [1], columnDeltas: { c: { 1: [["1"], null] } } }) });
    const b = S([], { T: td({ removeRows: [1], columnDeltas: { c: { 1: [[""], null] } } }) });
    const r = concatenateSummaryPair(a, b);
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c, { 1: [["1"], null] },
      "old entity's value preserved, not overwritten by part 2's removal pre");
  });
});

// A defunct column (keyed by its `-`-prefixed name) does not exist
// post-scope, so every one of its cells has no post value. concat must enforce
// this: composition can
// otherwise synthesize a stray `"?"` post for a recycled row in a removed
// column, and the result then depends on grouping (not associative).

describe("ActionSummary concat: a defunct column has no post-scope cells", function() {
  it("nulls the post side of every cell in a defunct column", function() {
    // Column c is removed (defunct, keyed `-c`). Whatever a cell's post
    // appears to be -- a stray value or the unknown sentinel `"?"` -- the
    // column is gone, so the post must be absent. A cell that thereby
    // becomes [null, null] drops as vacuous.
    const a = S([], { T: td({ removeRows: [1, 2, 3],
      columnRenames: [["c", null]],
      columnDeltas: { ["-c"]: { 1: [["x"], ["y"]], 2: [["z"], "?"], 3: [null, "?"] } } }) });
    const r = concatenateSummaryPair(a, S([], {}));
    assert.deepEqual(r.tableDeltas.T.columnDeltas["-c"], { 1: [["x"], null], 2: [["z"], null] });
  });

  it("nulls the pre side of every cell in an added column (mirror)", function() {
    // Column c is added in scope (rename [null, c]), so it had no cells
    // pre-scope: every pre side must be absent, whatever composition left
    // there (here a stray `"?"`). Row 2 becomes [null, null] and drops.
    const a = S([], { T: td({ addRows: [1],
      columnRenames: [[null, "c"]],
      columnDeltas: { c: { 1: ["?", ["v"]], 2: ["?", null] } } }) });
    const r = concatenateSummaryPair(a, S([], {}));
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c, { 1: [null, ["v"]] });
  });

  it("nulls the pre of an added row's cells and the post of a removed row's", function() {
    // Row 5 is added (no pre-state) and row 7 is removed (no post-state), so
    // a pre value on row 5 or a post value on row 7 is impossible -- whatever
    // composition left there (here stray values) is replaced with absence.
    const a = S([], { T: td({ addRows: [5], removeRows: [7],
      columnDeltas: { c: { 5: [["stray"], ["v"]], 7: [["w"], ["stray"]] } } }) });
    const r = concatenateSummaryPair(a, S([], {}));
    assert.deepEqual(r.tableDeltas.T.columnDeltas.c, { 5: [null, ["v"]], 7: [["w"], null] });
  });

  it("resolves a stray '?' to absent in a complete summary, but keeps it when incomplete", function() {
    // A complete summary carries no unknowns, so a `"?"` left by
    // composition (a value never recorded, with nothing to recover it from)
    // resolves to absent. When mayBeIncomplete is set, `"?"` is meaningful
    // and preserved.
    const complete = S([], { T: td({ updateRows: [1], columnDeltas: { c: { 1: ["?", ["v"]] } } }) });
    assert.deepEqual(concatenateSummaryPair(complete, S([], {})).tableDeltas.T.columnDeltas.c,
      { 1: [null, ["v"]] });
    const incomplete = S([], { T: td({ updateRows: [1], mayBeIncomplete: true,
      columnDeltas: { c: { 1: ["?", ["v"]] } } }) });
    assert.deepEqual(concatenateSummaryPair(incomplete, S([], {})).tableDeltas.T.columnDeltas.c,
      { 1: ["?", ["v"]] });
  });
});

// A type/formula conversion emits its sub-steps' inverses in reverse order
// (a "crossing": U(s0) lands after U(s1) in the undo array). A monotone chunker
// cannot pair them one-to-one; it must coarsen the pair into one closed chunk,
// or it strands a real step as a spurious zero-case and breaks the value chain.
// chunkByLattice's tier-2 objective (minimize zero-cases)
// forces the coarsening: the split leaves the UpdateRecord unpaired (1 zero),
// the coarsening pairs both (0 zeros).
describe("chunkByLattice: coarsens a reversed-undo crossing", function() {
  it("merges a ModifyColumn + UpdateRecord whose undos cross, instead of stranding one", function() {
    const stored: DocAction[] = [
      ["ModifyColumn", "T", "c", { type: "Bool" }],
      ["UpdateRecord", "T", 1, { c: false }],
    ];
    // Crossed: undo[0] inverts stored[1] (the data), undo[1] inverts stored[0] (the type).
    const undo: DocAction[] = [
      ["UpdateRecord", "T", 1, { c: "0" }],
      ["ModifyColumn", "T", "c", { type: "Text" }],
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 1, "the crossing coarsens into a single closed chunk");
    assert.deepEqual(chunks[0].stored, stored);
    assert.deepEqual(chunks[0].undo, undo);
  });

  it("does not coarsen a genuine zero-case (a step that truly emitted no undo)", function() {
    // Two updates each with their own undo, and a no-op update in between with
    // no undo. The no-op can't be paired by coarsening (no undo exists for it),
    // so tier 2 is indifferent and tier 3 keeps the partition fine.
    const stored: DocAction[] = [
      ["UpdateRecord", "T", 1, { c: 1 }],
      ["UpdateRecord", "T", 2, { c: 2 }],   // no-op: no undo emitted
      ["UpdateRecord", "T", 3, { c: 3 }],
    ];
    const undo: DocAction[] = [
      ["UpdateRecord", "T", 1, { c: 10 }],
      ["UpdateRecord", "T", 3, { c: 30 }],
    ];
    const chunks = chunkByLattice(stored, undo);
    // Each stored keeps its own chunk; the middle one is a (genuine) zero-case.
    assert.deepEqual(chunks.map(c => c.stored.length), [1, 1, 1]);
    assert.deepEqual(chunks[1].undo, [], "genuine zero-case stays unpaired, not coarsened");
  });
});

describe("chunkByLattice", function() {
  it("returns an empty list for an empty bundle", function() {
    assert.deepEqual(chunkByLattice([], []), []);
  });

  it("splits a bundle into one chunk per stored, pairing undos by emission order", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { x: 1 }],
      ["UpdateRecord", "T", 2, { x: 9 }],
    ];
    const undo: DocAction[] = [
      ["RemoveRecord", "T", 1],
      ["UpdateRecord", "T", 2, { x: 8 }],
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 2);
    assert.deepEqual(chunks[0],
      { stored: [["AddRecord", "T", 1, { x: 1 }]], undo: [["RemoveRecord", "T", 1]] });
    assert.deepEqual(chunks[1],
      { stored: [["UpdateRecord", "T", 2, { x: 9 }]], undo: [["UpdateRecord", "T", 2, { x: 8 }]] });
  });

  it("gives a RemoveColumn its data-restore + schema-restore undos in one chunk", function() {
    const stored: DocAction[] = [["RemoveColumn", "T", "c"]];
    const undo: DocAction[] = [
      ["BulkUpdateRecord", "T", [1, 2], { c: ["a", "b"] }],   // data restore
      ["AddColumn", "T", "c", { type: "Text" } as any],        // schema restore
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 1);
    assert.deepEqual(chunks[0].stored, [["RemoveColumn", "T", "c"]]);
    assert.deepEqual(chunks[0].undo, [
      ["BulkUpdateRecord", "T", [1, 2], { c: ["a", "b"] }],
      ["AddColumn", "T", "c", { type: "Text" } as any],
    ]);
  });
});

// Shapes the lattice chunker should partition correctly: per-stored blocks
// in stored order (the lockstep main region), the front region for a
// defunct formula column's data restore, an adjacent table-data restore,
// trailing orphan undos, and the no-undo case. Each asserts the exact
// chunk-to-undo assignment, not just the summary.
describe("chunkByLattice: shapes it should handle", function() {
  // Helper: one chunk per stored, undos in the given order, no orphans.
  function expectPerStored(chunks: ReturnType<typeof chunkByLattice>,
    stored: DocAction[], undos: DocAction[][]) {
    assert.lengthOf(chunks, stored.length);
    chunks.forEach((c, i) => {
      assert.deepEqual(c.stored, [stored[i]]);
      assert.deepEqual(c.undo, undos[i]);
    });
  }

  it("splits a long single-table record sequence into one chunk per stored", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { a: 1 }],
      ["AddRecord", "T", 2, { a: 2 }],
      ["UpdateRecord", "T", 1, { a: 9 }],
      ["BulkAddRecord", "T", [3, 4], { a: [3, 4] }],
      ["RemoveRecord", "T", 2],
      ["UpdateRecord", "T", 3, { a: 30 }],
      ["BulkRemoveRecord", "T", [3, 4]],
      ["AddRecord", "T", 5, { a: 5 }],
    ];
    const undo: DocAction[] = [
      ["RemoveRecord", "T", 1],
      ["RemoveRecord", "T", 2],
      ["UpdateRecord", "T", 1, { a: 1 }],
      ["BulkRemoveRecord", "T", [3, 4]],
      ["AddRecord", "T", 2, { a: 2 }],
      ["UpdateRecord", "T", 3, { a: 3 }],
      ["BulkAddRecord", "T", [3, 4], { a: [3, 4] }],
      ["RemoveRecord", "T", 5],
    ];
    expectPerStored(chunkByLattice(stored, undo), stored, undo.map(u => [u]));
  });

  it("splits interleaved record ops across tables into one chunk per stored", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T1", 1, { a: 1 }],
      ["AddRecord", "T2", 1, { b: 1 }],
      ["UpdateRecord", "T1", 1, { a: 9 }],
      ["RemoveRecord", "T2", 1],
    ];
    const undo: DocAction[] = [
      ["RemoveRecord", "T1", 1],
      ["RemoveRecord", "T2", 1],
      ["UpdateRecord", "T1", 1, { a: 1 }],
      ["AddRecord", "T2", 1, { b: 1 }],
    ];
    expectPerStored(chunkByLattice(stored, undo), stored, undo.map(u => [u]));
  });

  it("attaches a defunct formula column's front data restore to its RemoveColumn", function() {
    // The data restore for the removed (formula) column c is a front
    // insert(0) entry, separated from its schema AddColumn (in the main
    // region) by an unrelated record removal. The chunker must give the
    // RemoveColumn both its front data restore and its schema restore.
    const stored: DocAction[] = [
      ["AddRecord", "T", 5, { a: 5 }],
      ["RemoveColumn", "T", "c"],
    ];
    const undo: DocAction[] = [
      ["BulkUpdateRecord", "T", [1, 2], { c: ["x", "y"] }],  // front: defunct c data restore
      ["RemoveRecord", "T", 5],                              // main: inverse of AddRecord 5
      ["AddColumn", "T", "c", {} as any],                    // main: schema restore for RemoveColumn
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 2);
    assert.deepEqual(chunks[0], { stored: [["AddRecord", "T", 5, { a: 5 }]], undo: [["RemoveRecord", "T", 5]] });
    assert.deepEqual(chunks[1], { stored: [["RemoveColumn", "T", "c"]], undo: [
      ["BulkUpdateRecord", "T", [1, 2], { c: ["x", "y"] }],
      ["AddColumn", "T", "c", {} as any],
    ] });
  });

  it("keeps a RemoveTable's adjacent data restore and schema restore in one chunk", function() {
    const stored: DocAction[] = [["RemoveTable", "T"]];
    const undo: DocAction[] = [
      ["BulkAddRecord", "T", [1, 2], { a: ["x", "y"] }],     // data restore
      ["AddTable", "T", [{ id: "a" }] as any],               // schema restore
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 1);
    assert.deepEqual(chunks[0].undo, [
      ["BulkAddRecord", "T", [1, 2], { a: ["x", "y"] }],
      ["AddTable", "T", [{ id: "a" }] as any],
    ]);
  });

  it("keeps a trailing orphan undo adjacent, with its delta preserved", function() {
    // A normal record sequence followed by an undo entry that inverts no
    // stored action (a calc-flush restore for a column made defunct in an
    // earlier bundle). Discarding it costs the same whether it sits alone or
    // rides along in the last chunk (it is a ghost either way), so the lattice
    // keeps it adjacent rather than isolating it -- a free tie-break that does
    // not change the summary, since the orphan's delta is recorded regardless.
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { a: 1 }],
      ["UpdateRecord", "T", 1, { a: 9 }],
      ["RemoveRecord", "T", 1],
    ];
    const undo: DocAction[] = [
      ["RemoveRecord", "T", 1],
      ["UpdateRecord", "T", 1, { a: 1 }],
      ["AddRecord", "T", 1, { a: 9 }],
      ["BulkUpdateRecord", "T", [2, 3], { b: ["p", "q"] }],  // orphan: no owning stored
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 3);
    assert.deepEqual(chunks[0], { stored: [stored[0]], undo: [undo[0]] });
    assert.deepEqual(chunks[1], { stored: [stored[1]], undo: [undo[1]] });
    // The last real chunk carries its own inverse plus the orphan restore.
    assert.deepEqual(chunks[2], { stored: [stored[2]], undo: [undo[2], undo[3]] });
  });

  it("gives each stored its own empty chunk when there is no undo", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { a: 1 }],
      ["UpdateRecord", "T", 2, { a: 2 }],
    ];
    expectPerStored(chunkByLattice(stored, []), stored, [[], []]);
  });

  it("pairs a recompute with a restore over fewer rows (undo rows ⊆ stored rows)", function() {
    // A data->formula conversion: c becomes formula "0", so the recompute
    // touches all rows [1..5], but the restore-undo covers only the
    // pre-existing rows [1,2,3] (rows 4,5 were just added, no prior value).
    // The undo's rows are a subset of the recompute's -- the chunker must
    // still pair them.
    const stored: DocAction[] = [
      ["ModifyColumn", "T", "c", { isFormula: true, formula: "0" } as any],
      ["BulkUpdateRecord", "T", [1, 2, 3, 4, 5], { c: ["0", "0", "0", "0", "0"] }],
    ];
    const undo: DocAction[] = [
      ["ModifyColumn", "T", "c", { isFormula: false, formula: "" } as any],
      ["BulkUpdateRecord", "T", [1, 2, 3], { c: [null, "", ""] }],
    ];
    const chunks = chunkByLattice(stored, undo);
    assert.lengthOf(chunks, 2);
    assert.deepEqual(chunks[0].undo, [["ModifyColumn", "T", "c", { isFormula: false, formula: "" } as any]]);
    assert.deepEqual(chunks[1].undo, [["BulkUpdateRecord", "T", [1, 2, 3], { c: [null, "", ""] }]]);
  });
});

// chunkByOwners uses the engine's recorded per-undo ownership directly, instead
// of inferring chunk boundaries the way the lattice does. owners[k] is the index
// into stored of the action that produced undo[k], or null for a front
// calc-flush restore (which is still attributed to its removal, shared with the
// lattice via analyzeStored).
describe("chunkByOwners", function() {
  it("returns an empty list for an empty bundle", function() {
    assert.deepEqual(chunkByOwners([], [], []), []);
  });

  it("makes one chunk per stored, routing each undo by its declared owner", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { x: 1 }],
      ["UpdateRecord", "T", 2, { x: 9 }],
    ];
    const undo: DocAction[] = [
      ["RemoveRecord", "T", 1],
      ["UpdateRecord", "T", 2, { x: 8 }],
    ];
    assert.deepEqual(chunkByOwners(stored, undo, [0, 1]), [
      { stored: [stored[0]], undo: [undo[0]] },
      { stored: [stored[1]], undo: [undo[1]] },
    ]);
  });

  it("splits the conversion 2-swap the lattice keeps together, since ownership is known", function() {
    // The to-data ModifyColumn: stored is the schema change then the converted
    // data; undo is the data restore (owns the data update) then the ModifyColumn
    // inverse (owns the schema change), crossed. The lattice must keep these in
    // one [2,2] chunk because it can't tell which undo is which; with ownership we
    // split them into the two finer chunks, which compose to the same summary (the
    // fuzz harness cross-checks that).
    const stored: DocAction[] = [
      ["ModifyColumn", "T", "c", { isFormula: false, formula: "" } as any],
      ["BulkUpdateRecord", "T", [1, 2, 3], { c: ["0", "0", "0"] }],
    ];
    const undo: DocAction[] = [
      ["BulkUpdateRecord", "T", [1, 2, 3], { c: [null, "", ""] }],   // owns the data update (1)
      ["ModifyColumn", "T", "c", { isFormula: true, formula: "0" } as any],   // owns the schema (0)
    ];
    assert.deepEqual(chunkByOwners(stored, undo, [1, 0]), [
      { stored: [stored[0]], undo: [undo[1]] },
      { stored: [stored[1]], undo: [undo[0]] },
    ]);
  });

  it("routes a null-owner front restore to its removal, the way the lattice does", function() {
    // A removed formula column's front data restore arrives unowned (null); it must
    // still land in the RemoveColumn's chunk, ahead of the schema restore.
    const stored: DocAction[] = [
      ["AddRecord", "T", 5, { a: 5 }],
      ["RemoveColumn", "T", "c"],
    ];
    const undo: DocAction[] = [
      ["BulkUpdateRecord", "T", [1, 2], { c: ["x", "y"] }],   // front: defunct c data restore (null)
      ["RemoveRecord", "T", 5],                               // inverse of AddRecord 5 (owner 0)
      ["AddColumn", "T", "c", {} as any],                     // schema restore for RemoveColumn (owner 1)
    ];
    assert.deepEqual(chunkByOwners(stored, undo, [null, 0, 1]), [
      { stored: [stored[0]], undo: [undo[1]] },
      { stored: [stored[1]], undo: [undo[0], undo[2]] },
    ]);
  });

  it("collects a genuine orphan (null owner, no removal) into a trailing chunk", function() {
    const stored: DocAction[] = [["UpdateRecord", "T", 1, { a: 9 }]];
    const undo: DocAction[] = [
      ["UpdateRecord", "T", 1, { a: 1 }],                     // owner 0
      ["BulkUpdateRecord", "Other", [2, 3], { b: ["p", "q"] }],   // unowned, no removal -> orphan
    ];
    assert.deepEqual(chunkByOwners(stored, undo, [0, null]), [
      { stored: [stored[0]], undo: [undo[0]] },
      { stored: [], undo: [undo[1]] },
    ]);
  });

  it("treats an out-of-range owner as unowned and routes it for itself", function() {
    // A defensive fallback: an owner index outside stored is ignored and the undo
    // is attributed by shape instead (here, to its removal).
    const stored: DocAction[] = [["RemoveColumn", "T", "c"]];
    const undo: DocAction[] = [
      ["BulkUpdateRecord", "T", [1], { c: ["x"] }],   // bogus owner 7 -> route by shape to the RemoveColumn
      ["AddColumn", "T", "c", {} as any],
    ];
    assert.deepEqual(chunkByOwners(stored, undo, [7, 0]), [
      { stored: [stored[0]], undo: [undo[0], undo[1]] },
    ]);
  });

  it("gives each stored its own empty chunk when there is no undo", function() {
    const stored: DocAction[] = [
      ["AddRecord", "T", 1, { a: 1 }],
      ["UpdateRecord", "T", 2, { a: 2 }],
    ];
    assert.deepEqual(chunkByOwners(stored, [], []), [
      { stored: [stored[0]], undo: [] },
      { stored: [stored[1]], undo: [] },
    ]);
  });
});

// The chunker is value-blind (shape-only): when a no-op step shares a target
// with a real step, only the cell values would say which one a surviving undo
// belongs to, and the chunker never inspects them. The lattice does not try to
// resolve this at the chunk level; soundness comes from the value-preserving
// concat downstream, which the property test exercises directly.

describe("ActionSummary incremental folds: canonicalize once, not per step", function() {
  // Regression for the DocApi and TimeQuery fix. concatenateSummaries
  // canonicalizes its result, which strips an insignificant [[v],[v]] cell. That
  // is safe only at the end of a fold. A consumer that folds summaries one at a
  // time through concatenateSummaries canonicalizes between steps, and a middle
  // step can canonicalize a value-bearing summary on its own (dropping the
  // insignificant cell) before a later removal needs it. So consumers compose
  // with the raw concatenateSummaryPair and canonicalize once at the end
  // (ActionLog and DocApi's getChanges do this via concatenateSummaries;
  // TimeCursor folds the pair directly).

  const summ = (tableDeltas: { [t: string]: TableDelta }): ActionSummary => ({ tableRenames: [], tableDeltas });

  // first: row 5's column A is set to the value it already holds (insignificant)
  // while column B genuinely changes. mid: an unrelated change to another table,
  // which is what lets a per-step fold canonicalize `first` on its own and drop
  // A. last: row 5 is removed without carrying A's value, as a truncated bulk
  // removal would not. A's value lives only in `first`'s insignificant cell.
  const first = summ({ T: td({ updateRows: [5],
    columnDeltas: { A: { 5: [["v"], ["v"]] }, B: { 5: [["x"], ["y"]] } } }) });
  const mid = summ({ U: td({ updateRows: [1], columnDeltas: { c: { 1: [["p"], ["q"]] } } }) });
  const last = summ({ T: td({ removeRows: [5] }) });
  const parts = [first, mid, last];

  it("a forward fold keeps a value that a per-step fold drops", function() {
    // Correct, as the consumers now do it: fold raw, canonicalize once at the
    // end. A's value survives the removal.
    let raw = parts[0];
    for (const p of parts.slice(1)) { raw = concatenateSummaryPair(raw, p); }
    const correct = canonicalizeSummary(raw);
    assert.deepEqual(correct.tableDeltas.T.columnDeltas.A, { 5: [["v"], null] });

    // Buggy, as folding through concatenateSummaries one at a time would: the mid
    // step canonicalizes `first` on its own and drops A before the removal needs
    // it.
    let perStep = parts[0];
    for (const p of parts.slice(1)) { perStep = concatenateSummaries([perStep, p]); }
    assert.isUndefined(perStep.tableDeltas.T?.columnDeltas?.A);
    assert.notDeepEqual(perStep, correct);
  });

  it("TimeCursor.append folds raw, so the value survives", function() {
    const tc = new TimeCursor(null as any);   // db is unused by prepend/append
    tc.summary = first;
    tc.append(mid);
    tc.append(last);
    assert.deepEqual(canonicalizeSummary(tc.summary).tableDeltas.T.columnDeltas.A,
      { 5: [["v"], null] });
  });
});
