/**
 * Test for copy-pasting file data into Attachments columns.
 */
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";
import { fixturesRoot } from "test/server/testUtils";

import fs from "fs/promises";
import * as path from "path";

import { assert, driver, Key, WebElement } from "mocha-webdriver";

describe("CopyPasteFiles", function() {
  this.timeout(90000);
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());

  it("should not fail when columns are trimmed", async function() {
    const session = await gu.session().login();
    const docId = await session.tempNewDoc(cleanup, "CopyPaste", { load: false });

    // Ensure there is both an Attachments column and a non-Attachments one.
    const api = session.createHomeApi();
    await api.applyUserActions(docId, [
      ["ModifyColumn", "Table1", "A", { label: "Name" }],
      ["ModifyColumn", "Table1", "B", { label: "Photo" }],
      ["ModifyColumn", "Table1", "Photo", { type: "Attachments" }],
    ]);

    await gu.loadDoc(`/doc/${docId}`);

    const samplePngContent = await fs.readFile(path.resolve(fixturesRoot, "uploads/flower.png"));
    const samplePdfContent = await fs.readFile(path.resolve(fixturesRoot, "uploads/sample.pdf"));

    await gu.getCell({ rowNum: 1, col: "Photo" }).click();
    await driver.executeScript(syntheticPasteFile,
      [{ content: samplePngContent.toString("base64"), name: "flower.png", type: "image/png" }]);
    await gu.waitToPass(async () =>
      assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 1, col: "Photo" })), ["flower.png"]));

    // Add a couple more records
    await api.applyUserActions(docId, [
      ["BulkAddRecord", "Table1", [null, null], { Name: ["Alice", "Bob"] }],
    ]);

    await gu.selectGridArea([2, 1], [3, 2]);
    await driver.executeScript(syntheticPasteFile, [
      { content: samplePngContent.toString("base64"), name: "flower.png", type: "image/png" },
      { content: samplePdfContent.toString("base64"), name: "sample.pdf", type: "application/pdf" },
    ]);

    assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 1, col: "Name" })), []);
    assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 1, col: "Photo" })), ["flower.png"]);
    assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 2, col: "Photo" })), ["flower.png", "sample.pdf"]);
    assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 3, col: "Photo" })), ["flower.png", "sample.pdf"]);
    assert.deepEqual(await getCellThumbTitles(gu.getCell({ rowNum: 4, col: "Photo" })), []);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], col: "Name" }), ["", "Alice", "Bob"]);

    // Check in more detail the content in one of the cells.
    await gu.getCell({ rowNum: 2, col: "Photo" }).click();
    await driver.sendKeys(Key.ENTER);
    assert.equal(await driver.findWait(".test-pw-counter", 500).getText(), "1 of 2");
    assert.equal(await driver.find(".test-pw-name").value(), "flower.png");
    assert.equal(await driver.find(".test-pw-attachment-content").getTagName(), "img");
    assert.match(await driver.find(".test-pw-attachment-content").getAttribute("src"), /name=flower.png&/);

    await driver.sendKeys(Key.RIGHT);
    assert.equal(await driver.find(".test-pw-name").value(), "sample.pdf");
    assert.equal(await driver.find(".test-pw-attachment-content").getTagName(), "object");
    assert.match(await driver.find(".test-pw-attachment-content").getAttribute("data"), /name=sample.pdf&/);
    assert.equal(await driver.find(".test-pw-attachment-content").getAttribute("type"), "application/pdf");
  });
});

function getCellThumbTitles(cell: WebElement): Promise<string[]> {
  return cell.findAll(".test-pw-thumbnail", el => el.getAttribute("title"));
}

// Creates a synthetic paste of a file, not from the real clipboard but by dispatching within the
// browser an event we construct ourselves.
function syntheticPasteFile(contentList: { content: string, name: string, type: string }[]) {
  const dt = new DataTransfer();
  for (const { content, name, type } of contentList) {
    const bytes = Uint8Array.from(atob(content), c => c.charCodeAt(0));
    dt.items.add(new File([bytes], name, { type }));
  }
  const evt = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clipboardData", { value: dt });
  (document.activeElement || document.body).dispatchEvent(evt);
}
