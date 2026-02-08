import { UserAPI } from "app/common/UserAPI";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupCleanup, setupTestSuite } from "test/nbrowser/testUtils";

import { assert } from "mocha-webdriver";

describe("LazyLoad", function() {
  this.timeout(20000);
  setupTestSuite();
  let api: UserAPI;

  before(async () => {
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    api = gu.createHomeApi("Chimpy", "nasa");
  });

  const cleanup = setupCleanup();

  // NOTE: This test used to test that "Loading..." placeholder is shown in formula columns while
  // they are being calculated on load. Now that we load formula columns from the database, it
  // tests that the values are immediately shown even though calculation hasn't finished.
  it("can start showing table even if its row data has not arrived yet", async () => {
    const wsId = await api.newWorkspace({ name: "work" }, "current");
    // Clean up at the end of the suite, to avoid affecting other tests.
    cleanup.addAfterAll(() => api.deleteWorkspace(wsId));

    const docId = await api.newDoc({ name: "testdoc" }, wsId);
    // formula takes 1.5 seconds to evaluate.
    const formula =
      "import time\n" +
      "time.sleep(1.5)\n" +
      'return "42:%s" % int(time.time())';
    await api.applyUserActions(docId, [["AddTable", "Foo", [
      { id: "B", type: "Any", formula, isFormula: true },
    ]]]);
    await api.applyUserActions(docId, [["AddTable", "Bar", [
      { id: "B", type: "Any" },
      // This formula returns 5, 0, "X" for rowIds 1, 2, 3.
      { id: "C", type: "Numeric", formula: '[5, 0, "X"][$id - 1]', isformula: true },
    ]]]);
    // This action takes 1.5 sec because waits for the formula.
    await api.applyUserActions(docId, [["AddRecord", "Foo", 1, {}]]);
    await api.applyUserActions(docId, [["BulkAddRecord", "Bar", [1, 2, 3], { B: [33, 34, 35] }]]);
    await api.getDocAPI(docId).forceReload();
    await gu.loadDoc(`/o/nasa/doc/${docId}/p/2`);

    // Metadata about Foo table is known, and it is shown, AND formula data is already available
    // because it is now loaded from the database.
    const fooValue1 = await gu.getCell(0, 1, "FOO").getText();
    assert.match(fooValue1, /^42:\d+$/);

    // We can switch to Bar table, and plain data is available.
    await gu.openPage(/Bar/);
    assert.equal(await gu.getCell(0, 1, "BAR").getText(), "33");

    // Plain data AND formula data are already there.
    assert.deepEqual(await gu.getVisibleGridCells({ col: "B", rowNums: [1, 2, 3], section: "BAR" }),
      ["33", "34", "35"]);
    assert.deepEqual(await gu.getVisibleGridCells({ col: "C", rowNums: [1, 2, 3], section: "BAR" }),
      ["5", "0", "X"]);

    await gu.openPage(/Foo/);

    // The data in the slow-formula cell should still be old, it can't have been 1.5s yet.
    assert.equal(await gu.getCell(0, 1, "FOO").getText(), fooValue1);

    // The new value should be there after the time to load data into the data engine + 1.5s for the formula.
    await gu.waitToPass(async () => {
      const fooValue2 = await gu.getCell(0, 1, "FOO").getText();
      assert.match(fooValue2, /^42:\d+$/);
      // We test that the value changed after the calculation. This isn't necessarily what we
      // want (maybe we should NOT update formula values on open), but for now it serves to show the
      // recalculated values do show up on load.
      assert.notEqual(fooValue2, fooValue1);
    }, 1500 + 1500);    // Give it 1.5 to load into the data engine and 1.5 for the formula.
  });
});
