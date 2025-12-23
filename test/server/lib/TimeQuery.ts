import { summarizeAction } from "app/common/ActionSummarizer";
import { ActionSummary } from "app/common/ActionSummary";
import { TimeCursor, TimeLayout, TimeQuery } from "app/common/TimeQuery";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { SQLiteTimeData } from "app/server/lib/TimeQuery";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";
import { assert } from "test/server/testUtils";

/** get a summary of the last LocalActionBundle applied to a given document */
async function summarizeLastAction(doc: ActiveDoc): Promise<ActionSummary> {
  return summarizeAction((await doc.getRecentActionsDirect(1))[0]);
}

describe("TimeQuery", function() {
  // No sandboxing, to avoid change in speed.
  testUtils.withoutSandboxing();

  // Comment this out to see debug-log output when debugging tests.
  testUtils.setTmpLogLevel("error");

  const docTools = createDocTools();

  it("can view state of table in past", async function() {
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    const db = doc.docStorage;
    const cursor = new TimeCursor(new SQLiteTimeData(db));

    // We'll be interested in viewing the state of table "Fish", column "age".
    const fish = new TimeQuery(cursor, "Fish", ["age"]);
    const session = docTools.createFakeSession();

    // Stick some data in the Fish table.
    await doc.applyUserActions(session, [
      ["AddTable", "Fish", [{ id: "age" }, { id: "species" }, { id: "color" }]],
      ["AddRecord", "Fish", null, { age: "11", species: "flounder", color: "blue" }],
      ["AddRecord", "Fish", null, { age: "22", species: "bounder", color: "red" }],
    ]);
    const summary1 = await summarizeLastAction(doc);

    // Change some data, remove some data.
    await doc.applyUserActions(session, [
      ["UpdateRecord", "Fish", 1, { age: "111" }],
      ["RemoveRecord", "Fish", 2],
    ]);
    const summary2 = await summarizeLastAction(doc);

    // Now read out the current state.
    await fish.update();
    assert.sameDeepMembers(fish.all(),
      [{ id: 1, age: "111" }]);

    // Go back one step in time.
    cursor.prepend(summary2);
    await fish.update();
    assert.sameDeepMembers(fish.all(),
      [{ id: 1, age: "11" },
        { id: 2, age: "22" }]);

    // and one more step
    cursor.prepend(summary1);
    await fish.update();
    assert.sameDeepMembers(fish.all(), []);
  });

  it("can track column order and user-facing table name", async function() {
    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    const db = doc.docStorage;
    const cursor = new TimeCursor(new SQLiteTimeData(db));
    const layout = new TimeLayout(cursor);
    const session = docTools.createFakeSession();

    // Create a table with three columns.
    await doc.applyUserActions(session, [
      ["AddTable", "Fish!", [{ id: "age" }, { id: "species" }, { id: "color" }]],
      // AddTable doesn't actually set the requested name, so patch it up.
      ["UpdateRecord", "_grist_Views", 1, { name: "Fish!" }],
      ["UpdateRecord", "_grist_Views_section", 2, { title: "Fish!" }],  // Change section (and table) name
      ["AddRecord", "Fish_", null, { age: "11", species: "flounder", color: "blue" }],
      ["AddRecord", "Fish_", null, { age: "22", species: "bounder", color: "red" }],
    ]);
    const summary1 = await summarizeLastAction(doc);

    // Now move the species column. We need its field id to do so.
    // Just for practice, we read its field id from the db.
    await layout.update();
    const table = layout.tables.one({ tableId: "Fish_" });
    const column = layout.columns.one({ parentId: table.id, colId: "species" });
    const field = layout.fields.one({ parentId: table.primaryViewId, colRef: column.id });
    const section = layout.sections.one({ id: table.rawViewSectionRef });
    await doc.applyUserActions(session, [
      ["UpdateRecord", "_grist_Views_section_field", field.id, { parentPos: 999 }],
      ["UpdateRecord", "Fish_", 1, { age: "111" }],  // Change some data as well for the heck of it.
      ["RemoveRecord", "Fish_", 2],                // Remove some data as well for the heck of it.
      ["UpdateRecord", "_grist_Views", 1, { name: "Poissons!" }],  // Change view name
      ["UpdateRecord", "_grist_Views_section", section.id, { title: "Poissons!" }],  // Change section (and table) name
    ]);
    const summary2 = await summarizeLastAction(doc);

    // Check column order now.
    await layout.update();
    assert.deepEqual(layout.getColumnOrder("Poissons_"), ["age", "color", "species"]);
    assert.deepEqual(layout.getTableName("Poissons_"), "Poissons!");

    // Move back one step, then check column order again.
    cursor.prepend(summary2);
    await layout.update();
    assert.deepEqual(layout.getColumnOrder("Fish_"), ["age", "species", "color"]);
    assert.deepEqual(layout.getTableName("Fish_"), "Fish!");

    // Move back one step, then check column order again.
    cursor.prepend(summary1);
    await layout.update();
    assert.throws(() => layout.getColumnOrder("Fish_"),
      /could not find/);
  });

  it("can handle renames", async function() {
    this.timeout(10000);

    const doc: ActiveDoc = await docTools.createDoc("test.grist");
    const db = doc.docStorage;
    const cursor = new TimeCursor(new SQLiteTimeData(db));
    const session = docTools.createFakeSession();

    // Create a table with three columns. In this test, we will rename
    // the table and a column and make sure the renames don't affect
    // querying information prior to those changes.
    await doc.applyUserActions(session, [
      ["AddTable", "Fish", [{ id: "age" }, { id: "species" }, { id: "color" }]],
      ["AddRecord", "Fish", null, { age: "11", species: "flounder", color: "blue" }],
      ["AddRecord", "Fish", null, { age: "22", species: "bounder", color: "red" }],
    ]);
    await doc.applyUserActions(session, [
      ["RenameTable", "Fish", "Fish2"],
    ]);
    cursor.append(await summarizeLastAction(doc));
    const query = new TimeQuery(cursor, "Fish", ["species"]);
    const expectedResult = [
      { id: 1, species: "flounder" },
      { id: 2, species: "bounder" },
    ];
    let result = await query.update();
    assert.deepEqual(result, expectedResult);

    await doc.applyUserActions(session, [
      ["RenameColumn", "Fish2", "species", "species2"],
    ]);
    cursor.append(await summarizeLastAction(doc));
    result = await query.update();
    assert.deepEqual(result, expectedResult);

    await doc.applyUserActions(session, [
      ["RenameColumn", "Fish2", "color", "color2"],
      ["RenameColumn", "Fish2", "species2", "color"],
    ]);
    cursor.append(await summarizeLastAction(doc));
    result = await query.update();
    assert.deepEqual(result, expectedResult);

    await doc.applyUserActions(session, [
      ["AddTable", "Fish", [{ id: "species" }]],
      ["AddRecord", "Fish", null, { species: "tadpole" }],
    ]);
    cursor.append(await summarizeLastAction(doc));
    result = await query.update();
    assert.deepEqual(result, expectedResult);

    await doc.applyUserActions(session, [
      ["UpdateRecord", "Fish2", 1, { color: "whale" }],
    ]);
    cursor.append(await summarizeLastAction(doc));
    result = await query.update();
    assert.deepEqual(result, expectedResult);

    // Double check that we've actually made all the changes we think we have.
    assert.deepEqual(await doc.fetchQuery(session, { tableId: "Fish2", filters: {} }), {
      tableData: [
        "TableData",
        "Fish2",
        [1, 2],
        {
          manualSort: [
            1,
            2,
          ],
          age: [
            "11",
            "22",
          ],
          color2: [
            "blue",
            "red",
          ],
          color: [
            "whale",
            "bounder",
          ],
        },
      ],
    });

    query.reset("Fish", "*");
    result = await query.update();
    assert.deepEqual(result, [
      {
        id: 1,
        manualSort: 1,
        age: "11",
        species: "flounder",
        color: "blue",
      },
      {
        id: 2,
        manualSort: 2,
        age: "22",
        species: "bounder",
        color: "red",
      },
    ]);
  });
});
