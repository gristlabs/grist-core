import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("SheetOrientation", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();
  let docId: string;
  let session: gu.Session;

  type Choice = "Not specified" | "Right to left" | "Left to right";

  async function chooseOrientation(label: Choice) {
    await gu.openWidgetPanel();
    await driver.find(".test-sheet-orientation .test-select-open").click();
    await (await gu.findOpenMenu(1000)).findContent("li", label).click();
    await gu.waitForServer();
  }

  function pane(section: string) {
    return gu.getSection(section).find(".gridview_data_pane");
  }

  // The pane's own `dir` attribute; null when it carries none and so follows its container.
  async function ownDirection(section: string): Promise<string | null> {
    return await driver.executeScript((el: Element) => el.getAttribute("dir"), await pane(section));
  }

  // Whether the row-number gutter sits at the right edge of the grid pane.
  async function rowNumbersAtRight(section: string): Promise<boolean> {
    const paneRect = await pane(section).getRect();
    const gutter = await gu.getSection(section).find(".gridview_data_row_num").getRect();
    return Math.abs((paneRect.x + paneRect.width) - (gutter.x + gutter.width)) <= 2;
  }

  async function savedOptions(): Promise<Record<string, any>[]> {
    const sections = await session.createHomeApi().getDocAPI(docId).getRows("_grist_Views_section");
    return sections.options.map(options => JSON.parse(String(options || "{}")));
  }

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "SheetOrientation");
    await gu.sendActions([
      ["AddRecord", "Table1", null, { A: "apples" }],
      ["AddRecord", "Table1", null, { A: "bananas" }],
    ]);
    await gu.addNewSection("Table", "Table1");
    await gu.renameActiveSection("Other");
  });

  it("offers the orientation as a labelled choice, undecided by default", async function() {
    await gu.selectSectionByTitle("TABLE1");
    await gu.openWidgetPanel();
    const select = driver.find(".test-sheet-orientation .test-select-open");
    assert.equal(await select.getText(), "Not specified");
    const labelId = await select.getAttribute("aria-labelledby");
    assert.equal((await driver.find(`#${labelId}`).getText()).toLowerCase(), "sheet orientation");
    assert.isNull(await ownDirection("TABLE1"));
  });

  it("mirrors the sheet it is set on, and no other", async function() {
    await chooseOrientation("Right to left");
    assert.equal(await ownDirection("TABLE1"), "rtl");
    assert.isTrue(await rowNumbersAtRight("TABLE1"));
    assert.isNull(await ownDirection("Other"));
    assert.isFalse(await rowNumbersAtRight("Other"));
  });

  it("is saved in the document", async function() {
    assert.deepEqual((await savedOptions()).map(o => o.sheetOrientation).filter(Boolean), ["rtl"]);
    await gu.reloadDoc();
    assert.equal(await ownDirection("TABLE1"), "rtl");
    assert.isTrue(await rowNumbersAtRight("TABLE1"));
  });

  it("can hold a sheet left to right inside a right-to-left page", async function() {
    await gu.selectSectionByTitle("TABLE1");
    await chooseOrientation("Left to right");
    await driver.executeScript(() => document.documentElement.setAttribute("dir", "rtl"));
    try {
      assert.equal(await ownDirection("TABLE1"), "ltr");
      assert.isFalse(await rowNumbersAtRight("TABLE1"));
      // The undecided sheet does not follow the page either: it follows its document.
      assert.isFalse(await rowNumbersAtRight("Other"));
    } finally {
      await driver.executeScript(() => document.documentElement.removeAttribute("dir"));
    }
  });

  it("stores nothing once set back to not specified", async function() {
    await chooseOrientation("Not specified");
    assert.isNull(await ownDirection("TABLE1"));
    assert.isFalse(await rowNumbersAtRight("TABLE1"));
    for (const options of await savedOptions()) {
      assert.notProperty(options, "sheetOrientation");
    }
  });

  it("keeps the orientation of a sheet imported from Excel", async function() {
    // The workbook has two sheets: Patients is marked right-to-left in Excel, Notes is not.
    await gu.importFileDialog("./uploads/RightToLeftSheet.xlsx");
    await driver.findWait(".test-importer-preview", 5000);
    await driver.find(".test-modal-confirm").click();
    await gu.waitForServer(5000);
    const tables = await session.createHomeApi().getDocAPI(docId).getRows("_grist_Tables");
    const sections = await session.createHomeApi().getDocAPI(docId).getRows("_grist_Views_section");
    const orientations = (tableId: string) => {
      const tableRef = tables.id[tables.tableId.indexOf(tableId)];
      return sections.id.map((_id, i) => i)
        .filter(i => sections.tableRef[i] === tableRef && sections.parentKey[i] === "record")
        .map(i => JSON.parse(String(sections.options[i] || "{}")).sheetOrientation);
    };
    // Both grids of the new table have it: the one on its page, and the one under Raw data.
    assert.deepEqual(orientations("Patients"), ["rtl", "rtl"]);
    assert.deepEqual(orientations("Notes"), [undefined, undefined]);
    await gu.openPage("Patients");
    assert.equal(await ownDirection("PATIENTS"), "rtl");
    assert.isTrue(await rowNumbersAtRight("PATIENTS"));
    await gu.openPage("Notes");
    assert.isNull(await ownDirection("NOTES"));
    await gu.openPage("Table1");
  });

  it("is undone like any other change", async function() {
    await chooseOrientation("Right to left");
    assert.equal(await ownDirection("TABLE1"), "rtl");
    await gu.undo();
    assert.isNull(await ownDirection("TABLE1"));
  });
});
