import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("Search3", async function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;

  before(async function() {
    mainSession = await gu.session().teamSite.user("user1").login();
    docId = await mainSession.tempNewDoc(cleanup, "Search3.grist", { load: false });
    const api = mainSession.createHomeApi();
    // Prepare a table with some interestingly-formatted columns, and some data.
    const { retValues } = await api.applyUserActions(docId, [
      ["AddTable", "Test", []],
      ["AddVisibleColumn", "Test", "Date", { type: "Date", widgetOptions: '{"dateFormat":"YY-MM-DD dd"}' }],
      ["AddVisibleColumn", "Test", "Ref", { type: "Ref:Test" }],
      ["AddVisibleColumn", "Test", "RefList", { type: "RefList:Test" }],
    ]);
    await api.applyUserActions(docId, [
      ["UpdateRecord", "_grist_Tables_column", retValues[2].colRef, { visibleCol: retValues[1].colRef }],
      ["UpdateRecord", "_grist_Tables_column", retValues[3].colRef, { visibleCol: retValues[1].colRef }],
      ["SetDisplayFormula", "Test", null, retValues[2].colRef, "$Ref.Date"],
      ["SetDisplayFormula", "Test", null, retValues[3].colRef, "$RefList.Date"],
      ["AddRecord", "Test", null, { Date: "2021-12-20", Ref: 2, RefList: ["L", 1, 2] }],
      ["AddRecord", "Test", null, { Date: "2021-12-17", Ref: 1, RefList: null }],

    ]);
    return docId;
  });

  afterEach(() => gu.checkForErrors());

  async function assertSearchPosition(position: { rowNum: number, col: number }) {
    await gu.waitToPass(async () => {
      assert.deepEqual(await gu.getCursorPosition(), position);
    }, 500);
  }

  it("should search after toggling columns", async () => {
    await mainSession.loadDoc(`/doc/${docId}/p/1`);
    await gu.getCell("A", 1).click();
    await gu.enterCell("a", Key.ENTER);
    await gu.openWidgetPanel();
    await gu.moveToHidden("B");

    await gu.search("a");
    await gu.moveToVisible("B");

    await driver.find(".test-tb-search-icon").click();
    await driver.sleep(500);
    await driver.find(".test-tb-search-next").click();
    await gu.checkForErrors();
  });

  it("should handle searching in Ref/RefList columns with dates", async () => {
    await mainSession.loadDoc(`/doc/${docId}/p/2`);
    await gu.search("12-");

    await assertSearchPosition({ rowNum: 1, col: 0 });
    await gu.searchNext();
    await assertSearchPosition({ rowNum: 1, col: 1 });
    await gu.searchNext();
    await assertSearchPosition({ rowNum: 1, col: 2 });
    await gu.searchNext();
    await assertSearchPosition({ rowNum: 2, col: 0 });
  });

  it("should search on raw data", async () => {
    await mainSession.tempDoc(cleanup, "World.grist");
    await driver.find(".test-tools-raw").click();
    await gu.search("Aruba");
    await gu.hasSomeResult();
    // This gets raw table name from the overlay, so it tests if raw view is visible.
    assert.equal("City", await gu.getActiveRawTableName());
    await assertSearchPosition({ rowNum: 129, col: 1 });
    await gu.searchNext();
    await assertSearchPosition({ rowNum: 129, col: 1 });
    assert.equal("City", await gu.getActiveRawTableName());
    await gu.toggleSearchAll();

    await gu.searchNext();
    await assertSearchPosition({ rowNum: 1, col: 0 });
    assert.equal("Country", await gu.getActiveRawTableName());

    await gu.searchNext();
    await assertSearchPosition({ rowNum: 1, col: 2 });
    assert.equal("Country", await gu.getActiveRawTableName());

    await gu.searchNext();
    await assertSearchPosition({ rowNum: 1, col: 11 });
    assert.equal("Country", await gu.getActiveRawTableName());

    await gu.searchNext();
    await assertSearchPosition({ rowNum: 129, col: 1 });
    assert.equal("City", await gu.getActiveRawTableName());

    await gu.searchPrev();
    await assertSearchPosition({ rowNum: 1, col: 11 });
    assert.equal("Country", await gu.getActiveRawTableName());

    await gu.searchIsOpened();

    // Clicking on any page, should hide the search bar.
    await gu.getPageItem("City").click();
    await gu.searchIsClosed();

    // Clicking on raw section should close the search bar.
    await gu.search("Aruba");
    await gu.searchIsOpened();
    await driver.find(".test-tools-raw").click();
    await gu.searchIsClosed();
  });
});
