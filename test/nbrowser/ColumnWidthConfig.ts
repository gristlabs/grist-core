import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("ColumnWidthConfig", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  afterEach(() => gu.checkForErrors());

  const widthInput = () => driver.find(".test-column-width input");

  async function setWidth(value: string) {
    await widthInput().click();
    await gu.clearInput();
    await gu.sendKeys(value, Key.ENTER);
    await gu.waitForServer();
  }

  before(async function() {
    const session = await gu.session().teamSite.user("user1").login();
    await session.tempNewDoc(cleanup, "ColumnWidthConfig");
  });

  it("should show and set the width of a column", async function() {
    await gu.openColumnPanel("A");
    // A column that was never resized has the default width, shown as a placeholder.
    assert.equal(await widthInput().value(), "");
    assert.equal(await widthInput().getAttribute("placeholder"), "100");
    await gu.assertColumnWidth("A", 100);

    await setWidth("150");
    await gu.assertColumnWidth("A", 150);
    assert.equal(await widthInput().value(), "150");

    // The minimum is the same as when resizing by dragging. Typing 0 sets it too: only clearing
    // the value restores the default width, even though a stored width of 0 means the default.
    await setWidth("0");
    await gu.assertColumnWidth("A", 10);
    assert.equal(await widthInput().value(), "10");

    // Clearing the value restores the default width.
    await setWidth("");
    await gu.assertColumnWidth("A", 100);
    assert.equal(await widthInput().value(), "");

    await gu.undo();
    await gu.assertColumnWidth("A", 10);
    await gu.undo();
    await gu.assertColumnWidth("A", 150);
  });

  it("should follow resizing by dragging", async function() {
    await gu.openColumnPanel("B");
    assert.equal(await widthInput().value(), "");
    await gu.resizeColumn("B", 40);
    assert.closeTo(Number(await widthInput().value()), 140, 2);

    // The spinner buttons change the width by one pixel.
    const width = Number(await widthInput().value());
    await driver.find(".test-column-width .test-numeric-spinner-increment").click();
    await gu.waitForServer();
    assert.equal(await widthInput().value(), String(width + 1));
    await gu.assertColumnWidth("B", width + 1);
  });

  it("should set the width of all selected columns at once", async function() {
    await gu.selectColumnRange("A", "C");
    await gu.openColumnPanel();
    // Widths differ, so no value is shown.
    assert.equal(await widthInput().value(), "");
    assert.equal(await widthInput().getAttribute("placeholder"), "Mixed");

    await setWidth("80");
    for (const col of ["A", "B", "C"]) {
      await gu.assertColumnWidth(col, 80);
    }
    assert.equal(await widthInput().value(), "80");

    // A single undo restores all widths.
    await gu.undo();
    await gu.assertColumnWidth("A", 150);
    assert.isAbove(await gu.getColumnWidth("B"), 130);
    await gu.assertColumnWidth("C", 100);
    assert.equal(await widthInput().getAttribute("placeholder"), "Mixed");
  });

  it("should not save a value being typed to another column", async function() {
    // Give A the default width, like C, so that the input shows the same value for both.
    await gu.getCell({ col: "A", rowNum: 1 }).click();
    await setWidth("");
    await gu.getCell({ col: "C", rowNum: 1 }).click();
    assert.equal(await widthInput().value(), "");

    // Type a width for C, but click into A before saving it.
    await widthInput().click();
    await gu.sendKeys("200");
    await gu.getCell({ col: "A", rowNum: 1 }).click();
    await gu.waitForServer();
    await gu.assertColumnWidth("A", 100);
    assert.equal(await widthInput().value(), "");
  });

  it("should only be offered for grid widgets", async function() {
    await gu.changeWidget("Card");
    await gu.openColumnPanel();
    assert.isTrue(await driver.find(".test-right-panel").isPresent());
    assert.isFalse(await driver.find(".test-column-width").isPresent());
    await gu.undo();
  });
});
