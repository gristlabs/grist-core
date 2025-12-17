import { ActionSummaryOptions, concatenateSummaries, rebaseSummary, summarizeAction} from 'app/common/ActionSummarizer';
import { ActionSummary, asTabularDiffs, createEmptyTableDelta, LabelDelta, TableDelta} from 'app/common/ActionSummary';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import { cloneDeep, keyBy} from 'lodash';
import {createDocTools} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';
import {assert} from 'test/server/testUtils';

/** get a summary of the last LocalActionBundle applied to a given document */
async function summarizeLastAction(doc: ActiveDoc, options?: ActionSummaryOptions) {
  return summarizeAction((await doc.getRecentActionsDirect(1))[0], options);
}

/** Make a blank TableDelta object for testng */
function makeTableDelta(name: string): TableDelta {
  return {
    updateRows: [],
    removeRows: [],
    addRows: [],
    columnDeltas: {},
    columnRenames: [],
  };
}

describe("ActionSummary", function() {
  this.timeout(4000);

  // Comment this out to see debug-log output when debugging tests.
  testUtils.setTmpLogLevel('error');

  const docTools = createDocTools();

  it ('summarizes table-level changes', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Ducks", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddTable", "Bricks", [{id: "texture"}, {id: "length"}]],
    ]);
    // add two tables, remove a table, rename a table
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddTable", "Moons", [{id: "planet"}, {id: "radius"}]],
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
    assert.sameDeepMembers(Object.keys(sum.tableDeltas).filter(name => !(name[0] === '_')),
                           ["-Ducks", "Frogs", "Moons"]);
  });

  it ('summarizes column-level changes', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Ducks", [{id: "species"}, {id: "color"}, {id: "place"}]],
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

  it ('summarizes row-level changes', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    // add a row, remove a row, update a row
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Frogs", 1, {place: "Alaska"}],
      ["AddRecord", "Frogs", null, {species: "gretons", color: "green", place: "Northern France"}],
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
        }
      }
    });
  });

  it ('produces reasonable tabular diffs', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    // add a row, remove a row, update a row
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Frogs", 1, {place: "Alaska"}],
      ["AddRecord", "Frogs", null, {species: "gretons", color: "green", place: "Northern France"}],
      ["RemoveRecord", "Frogs", 2],
    ]);
    const sum = await summarizeLastAction(doc);
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.sameDeepMembers(tabularDiffs.Frogs.header,
                           ['species', 'color', 'place']);
    assert.lengthOf(tabularDiffs.Frogs.cells, 3);
    const rowTypes = tabularDiffs.Frogs.cells.map(row => row.type);
    assert.sameDeepMembers(rowTypes, ['+', '-', '→']);
    const colsList = tabularDiffs.Frogs.header.map((name, idx) => [name, idx] as [string, number]);
    const cols = new Map<string, number>(colsList);
    const rows = keyBy(tabularDiffs.Frogs.cells, row => row.type);
    assert.deepEqual(rows['+'].cellDeltas[cols.get('species')!], [null, ['gretons']]);
    assert.deepEqual(rows['→'].cellDeltas[cols.get('place')!], [['Alaskers'], ['Alaska']]);
    assert.deepEqual(rows['-'].cellDeltas[cols.get('species')!], [['parrots'], null]);
  });

  it ('produces reasonable tabular diffs of simple bulk actions', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    const ids = Array.from(Array(100).keys()).map(x => x + 3);
    // add many rows
    await doc.applyUserActions(session, [
      ["BulkAddRecord", "Frogs", ids,
       {
        species: ids.map(x => 'species ' + x),
        color: ids.map(x => 'color ' + x),
        place: ids.map(x => 'place ' + x),
      }]
    ]);
    const sum = await summarizeLastAction(doc);
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.sameDeepMembers(tabularDiffs.Frogs.header,
                           ['species', 'color', 'place']);
    assert(tabularDiffs.Frogs.cells.length < ids.length);
    const rowTypes = tabularDiffs.Frogs.cells.map(row => row.type);
    assert.equal(rowTypes.length - 1, rowTypes.filter(label => label === '+').length);
    assert.equal(1, rowTypes.filter(label => label === '...').length);
  });

  it ('produces tabular diffs that separate out reused rowIds', async function() {
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
            }
          }
        }
      }
    };
    const tabularDiffs = asTabularDiffs(sum, {});
    assert.lengthOf(tabularDiffs.Duck.cells, 2);
    assert.sameDeepMembers(tabularDiffs.Duck.cells,
                           [{type: "-", rowId: 1, cellDeltas: [[["yellow"], null]]},
                            {type: "+", rowId: 1, cellDeltas: [[null, ["red"]]]}]);
  });

  it ('summarizes ReplaceTableData actions', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    await doc.applyUserActions(session, [
      ["ReplaceTableData", "Frogs", [1],
       {species: ["bouncers"], color: ["blue"], place: ["Bouncy Castle"]}]
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
        }
      }
    });
  });

  it ('summarizes changes in sample documents', async function() {
    // The history of sample documents was crudely migrated from an older form,
    // so we check that diffs are generated for it.
    const doc = await docTools.loadFixtureDoc('Favorite_Films.grist');
    const session = docTools.createFakeSession();
    const {actions} = await doc.getRecentActions(session, true);
    assert(Object.keys(actions[0].actionSummary.tableDeltas).length > 0, "some diff present");

    // Pick out a change where Captain America is replaced with Steve Rogers.
    // Identifying this requires collating the action and undo information.
    const history = doc.getActionHistory();
    const [firstAction] = await history.getActions([118]);
    const summary = summarizeAction(firstAction!);
    assert.deepEqual(summary.tableDeltas.Performances.columnDeltas.Character[6],
                     [["Captain America"], ["Steve Rogers"]]);
  });

  it ('includes adequate information about table deletions', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc(':memory:');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
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

  it ('can compose table renames', async function() {
    const summary1: ActionSummary = {
      tableRenames: [[null, 'Frogs'],        // created in summary1
                     ['Spaces', 'Spices'],   // renamed in s1
                     ['Dinosaurs', null],    // removed in s1
                     ['Fish', 'Sharks'],     // renamed in both
                     [null, 'Transients'],   // created in s1, removed in s2
                     ['Doppelganger', null]], // removed in s1, same name created in s2
      tableDeltas: {
        "Frogs": makeTableDelta('Frogs'),
        "Spices": makeTableDelta('Spices'),
        "Sharks": makeTableDelta('Sharks'),
        "Transients": makeTableDelta('Transients'),
        "-Dinosaurs": makeTableDelta('-Dinosaurs'),
        "-Doppelganger": makeTableDelta('-Doppelganger'),
        "Koalas": makeTableDelta('Koalas'),
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [[null, 'Ducks'],        // created in s2
                     ['Colours', 'Colors'],  // renamed in s2
                     ['Trilobytes', null],   // removed in s2
                     ['Sharks', 'GreatWhites'],  // renamed in both
                     ['Transients', null],   // created in s1, removed in s2
                     [null, 'Doppelganger'], // removed in s1, same name created in s2
                     ['Koalas', 'Pajamas']],  // mentioned in s1, renamed here
      tableDeltas: {
        "Ducks": makeTableDelta('Ducks'),
        "Colors": makeTableDelta('Colors'),
        "GreatWhites": makeTableDelta('GreatWhites'),
        "Doppelganger": makeTableDelta('Doppelganger'),
        "-Trilobytes": makeTableDelta('-Trilobytes'),
        "-Transients": makeTableDelta('-Transients'),
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [[null, 'Doppelganger'],
                     [null, 'Ducks'],
                     [null, 'Frogs'],
                     ['Colours', 'Colors'],
                     ['Dinosaurs', null],
                     ['Doppelganger', null],
                     ['Fish', 'GreatWhites'],
                     ['Koalas', 'Pajamas'],
                     ['Spaces', 'Spices'],
                     ['Trilobytes', null]],
      tableDeltas: {
        "Frogs": makeTableDelta('Frogs'),
        "Ducks": makeTableDelta('Ducks'),
        "Colors": makeTableDelta('Colors'),
        "Spices": makeTableDelta('Spices'),
        "GreatWhites": makeTableDelta('GreatWhites'),
        "Doppelganger": makeTableDelta('Doppelganger'),
        "-Dinosaurs": makeTableDelta('-Dinosaurs'),
        "-Doppelganger": makeTableDelta('-Doppelganger'),
        "-Trilobytes": makeTableDelta('-Trilobytes'),
        "Pajamas": makeTableDelta('Pajamas'),
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it ('can compose column renames', async function() {
    const summary1: ActionSummary = {
      tableRenames: [['Fish', 'Sharks']],
      tableDeltas: {
        Sharks: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [['age', 'years'],
                          [null, 'color'],
                          ['depth', null],
                          [null, 'transient']],
        }
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [['Sharks', 'GreatWhites']],
      tableDeltas: {
        GreatWhites: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [['years', 'minutes'],
                          [null, 'weight'],
                          ['anger', null],
                          ['transient', null]],
        }
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [['Fish', 'GreatWhites']],
      tableDeltas: {
        GreatWhites: {
          updateRows: [],
          removeRows: [],
          addRows: [],
          columnDeltas: {},
          columnRenames: [[null, 'color'],
                          [null, 'weight'],
                          ['age', 'minutes'],
                          ['anger', null],
                          ['depth', null]],
        }
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it ('can compose cell changes', async function() {
    const summary1: ActionSummary = {
      tableRenames: [['Fish', 'Sharks']],
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
              11: [["gray"], null],
              12: [["gray"], null],
            }
          },
          columnRenames: [['age', 'years'], ['color', null]],
        }
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [['Sharks', 'GreatWhites']],
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
            }
          },
          columnRenames: [['years', 'minutes']],
        }
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [['Fish', 'GreatWhites']],
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
              11: [["gray"], null],
            }
          },
          columnRenames: [['age', 'minutes'], ['color', null]],
        }
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it ('can work through full history of a test file', async function() {
    // At the time of writing, this fixture has 216 rows in its ActionHistory.
    const doc = await docTools.loadFixtureDoc('Favorite_Films.grist');
    const history = doc.getActionHistory();
    const actions = await history.getRecentActions();
    const sums = actions.map(act => summarizeAction(act));
    const renames = sums.map(s => s.tableRenames).filter(rn => rn.length > 0);
    // Check the sequence of table renames recovered.
    assert.deepEqual(renames,
                     [[[null, 'Table1']],
                      [['Table1', 'Films']],
                      [[null, 'Table']],
                      [['Table', 'Actors']],
                      [[null, 'Table']],
                      [['Table', 'Friends']],
                      [['Actors', 'Performances']],
                      [['Films', 'Films_']],
                      [['Films_', 'Films']],
                      [['Friends', 'Friends_']],
                      [['Friends_', 'Friends']],
                      [['Performances', 'Performances2']],
                      [['Performances2', 'Performances']]]);
    const sum = concatenateSummariesCleanly(sums);
    // at the end of history, we have three tables
    assert.deepEqual(sum.tableRenames,
                     [[null, 'Films'],
                      [null, 'Friends'],
                      [null, 'Performances']]);
    // all columns should be created, since nothing existed beforehand
    assert.deepEqual(sum.tableDeltas.Films.columnRenames,
                     [[null, 'Budget_millions'],
                      [null, 'Release_Date'],
                      [null, 'Title']]);
  });

  it ('summarizes partially uncached changes consistently', async function() {
    const summary1: ActionSummary = {
      tableRenames: [['Fish', 'Sharks']],
      tableDeltas: {
        Sharks: {
          updateRows: [1, 13, 14, 15, 16],
          removeRows: [10],
          addRows: [11, 12],
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
              11: [["gray"], null],
              // rows 12 + 13 + 14 happen not to be cached.
              15: [["white"], null],
              16: [["black"], null],
            }
          },
          columnRenames: [['age', 'years'], ['color', null]],
        }
      },
    };
    const summary2: ActionSummary = {
      tableRenames: [['Sharks', 'GreatWhites']],
      tableDeltas: {
        GreatWhites: {
          updateRows: [2, 11, 12, 14, 15],
          removeRows: [9, 16],
          addRows: [],
          columnDeltas: {
            minutes: {
              2: [["22"], ["222"]],
              9: [["99"], null],
              11: [["15"], ["6000"]],
              12: [["99"], ["98"]],
              14: [["14"], ["55"]],
              // row 15 happens not to be cached.
              // row 16 happens not to be cached.
            }
          },
          columnRenames: [['years', 'minutes']],
        }
      },
    };
    const summary3: ActionSummary = {
      tableRenames: [['Fish', 'GreatWhites']],
      tableDeltas: {
        GreatWhites: {
          updateRows: [1, 2, 13, 14, 15],
          removeRows: [9, 10, 16],
          addRows: [11, 12],
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
              11: [["gray"], null],
              15: [["white"], null],
              16: [["black"], null],
            }
          },
          columnRenames: [['age', 'minutes'], ['color', null]],
        }
      },
    };
    const result = concatenateSummariesCleanly([summary1, summary2]);
    assert.deepEqual(result, summary3);
  });

  it ('recognizes bulk removal', async function() {
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    await doc.applyUserActions(session, [
      ["BulkRemoveRecord", "Frogs", [1, 2]]
    ]);
    const sum = await summarizeLastAction(doc);
    assert.deepEqual(sum.tableDeltas.Frogs.removeRows, [1, 2]);
    assert.deepEqual(sum.tableDeltas.Frogs.columnDeltas.species, {
      1: [["yellers"], null],
      2: [["parrots"], null],
    });
  });

  it ('can preserve all rows or specific columns entirely if requested', async function() {
    // Make a document, and then as the last action add many rows.
    const session = docTools.createFakeSession();
    const doc: ActiveDoc = await docTools.createDoc('test.grist');
    await doc.applyUserActions(session, [
      ["AddTable", "Frogs", [{id: "species"}, {id: "color"}, {id: "place"}]],
      ["AddRecord", "Frogs", null, {species: "yellers", color: "yellow", place: "Alaskers"}],
      ["AddRecord", "Frogs", null, {species: "parrots", color: "green", place: "Jungletown"}],
    ]);
    const ids = [ 3, 4, 5, 6, 7, 8 ];
    await doc.applyUserActions(session, [
      ["BulkAddRecord", "Frogs", ids,
       {
        species: ids.map(x => 'species ' + x),
        color: ids.map(x => 'color ' + x),
        place: ids.map(x => 'place ' + x),
      }]
    ]);

    // Request a summarization with no row limit.
    const sum = await summarizeLastAction(doc, {maximumInlineRows: Infinity});

    // Check result is as expected, with no rows omitted.
    assert.deepEqual(sum, {
      tableRenames: [],
      tableDeltas: {
        Frogs: {
          updateRows: [],
          removeRows: [],
          addRows: [ 3, 4, 5, 6, 7, 8 ],
          columnDeltas: {
            manualSort: {
              '3': [ null, [ 3 ] ],
              '4': [ null, [ 4 ] ],
              '5': [ null, [ 5 ] ],
              '6': [ null, [ 6 ] ],
              '7': [ null, [ 7 ] ],
              '8': [ null, [ 8 ] ]
            },
            species: {
              '3': [ null, [ 'species 3' ] ],
              '4': [ null, [ 'species 4' ] ],
              '5': [ null, [ 'species 5' ] ],
              '6': [ null, [ 'species 6' ] ],
              '7': [ null, [ 'species 7' ] ],
              '8': [ null, [ 'species 8' ] ]
            },
            color: {
              '3': [ null, [ 'color 3' ] ],
              '4': [ null, [ 'color 4' ] ],
              '5': [ null, [ 'color 5' ] ],
              '6': [ null, [ 'color 6' ] ],
              '7': [ null, [ 'color 7' ] ],
              '8': [ null, [ 'color 8' ] ]
            },
            place: {
              '3': [ null, [ 'place 3' ] ],
              '4': [ null, [ 'place 4' ] ],
              '5': [ null, [ 'place 5' ] ],
              '6': [ null, [ 'place 6' ] ],
              '7': [ null, [ 'place 7' ] ],
              '8': [ null, [ 'place 8' ] ]
            }
          },
          columnRenames: []
        }
      }
    });

    // Request a summarization with a row limit but full preservation of some columns.
    const sum2 = await summarizeLastAction(doc, {alwaysPreserveColIds: ['color', 'species'],
                                                maximumInlineRows: 4});

    // Check result is as expected, with full color and species, but other columns curtailed.
    sum.tableDeltas.Frogs.columnDeltas.manualSort = {
      '3': [ null, [ 3 ] ],
      '4': [ null, [ 4 ] ],
      '5': [ null, [ 5 ] ],
      '8': [ null, [ 8 ] ]
    };
    sum.tableDeltas.Frogs.columnDeltas.place = {
      '3': [ null, [ 'place 3' ] ],
      '4': [ null, [ 'place 4' ] ],
      '5': [ null, [ 'place 5' ] ],
      '8': [ null, [ 'place 8' ] ]
    };
    assert.deepEqual(sum2, sum);
  });

  describe('rebasing', async function() {
    function expand(deltas?: {[key: string]: Partial<TableDelta>}) {
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
        deltas?: {[key: string]: Partial<TableDelta>},
      },
      fork?: {
        renames?: LabelDelta[],
        deltas?: {[key: string]: Partial<TableDelta>},
      },
      result?: {
        renames?: LabelDelta[],
        deltas?: {[key: string]: Partial<TableDelta>},
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
      columnRenames: [['col1', 'col2']],
    };
    it('leaves target untouched if empty', async function() {
      assertRebase({});
      assertRebase({
        trunk: { renames: [['table1', 'table2']] },
      });
      assertRebase({
        trunk: { renames: [['table1', 'table2']],
                 deltas: { table2: empty } }
      });
    });

    it('renames tables in target as needed', async function() {
      assertRebase({
        trunk: { renames: [['table1', 'table2']] },
        fork: { deltas: { table1: empty, table3: empty } },
        result: { deltas: { table2: empty, table3: empty } },
      });
      assertRebase({
        trunk: { renames: [['table1', 'table2'], ['table2', 'table1']] },
        fork: { deltas: { table1: empty, table2: something } },
        result: { deltas: { table1: something, table2: empty } },
      });
    });

    it('preserves table renames in target', async function() {
      assertRebase({
        trunk: { renames: [['table1', 'table2'], ['table2', 'table1']] },
        fork: {
          renames: [['table2', 'table3']],
          deltas: { table1: empty, table3: something }
        },
        result: {
          renames: [['table1', 'table3']],
          deltas: { table3: something, table2: empty }
        },
      });
    });

    it('respects table deletion in reference', async function() {
      assertRebase({
        trunk: { renames: [['table1', null]] },
        fork: {
          renames: [['table1', 'table2'], ['table4', 'table5']],
          deltas: { table2: something, table3: empty }
        },
        result: {
          renames: [['table4', 'table5']],
          deltas: { table3: empty }
        },
      });
      assertRebase({
        trunk: { renames: [['table1', null]] },
        fork: {
          renames: [['table1', null]],
        },
        result: {
          renames: [],
        },
      });
      assertRebase({
        trunk: { renames: [['table1', null]] },
        fork: {
          renames: [['table1', 'table2']],
        },
        result: {
          renames: [],
        },
      });
      assertRebase({
        trunk: { renames: [['table1', null]] },
        fork: {
          renames: [['table1', 'table2'], [null, 'table1']],
        },
        result: {
          renames: [[null, 'table1']],
        },
      });
    });

    it('handles column renames', async function() {
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [['col1', 'col2']] } } },
      });
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [['col1', 'col2']] } } },
        fork: { renames: [['table1', 'table2']] },
        result: { renames: [['table1', 'table2']] },
      });
      assertRebase({
        trunk: { deltas: { table1: { columnRenames: [['col1', 'col2']] } } },
        fork: { deltas: { table1: { columnDeltas: { col1: {1: [null, null]} } } } },
        result: { deltas: { table1: { columnDeltas: { col2: {1: [null, null]} } } } },
      });
      assertRebase({
        trunk: { deltas: { table1: {
          columnRenames: [['col1', 'col2'], ['col2', 'col1'], ['col3', null]],
        } } },
        fork: { deltas: { table1: { columnDeltas: {
          col1: {1: [null, null]},
          col2: {2: [null, null]},
          col3: {3: [null, null]},
        } } } },
        result: { deltas: { table1: { columnDeltas: {
          col1: {2: [null, null]},
          col2: {1: [null, null]},
        } } } },
      });
      assertRebase({
        trunk: { deltas: { table1: {
          columnRenames: [['col1', 'col2'], ['col2', 'col1'], ['col3', null]],
        } } },
        fork: { deltas: { table1: {
          columnRenames: [['col1', 'col9']],
          columnDeltas: {
            col9: {1: [null, null]},
            col2: {2: [null, null]},
            col3: {3: [null, null]},
          } } } },
        result: { deltas: { table1: {
          columnRenames: [['col2', 'col9']],
          columnDeltas: {
            col1: {2: [null, null]},
            col9: {1: [null, null]},
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
