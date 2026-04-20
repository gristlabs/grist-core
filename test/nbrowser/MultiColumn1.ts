import * as gu from "test/nbrowser/gristUtils";
import {
  addAnyColumn,
  addConditionDisabled,
  alignment,
  alignmentDisabled,
  blue,
  cellColorLabel,
  colIdDisabled,
  columnTypeDisabled,
  deriveDisabled,
  formulaEditorDisabled,
  headerColorLabel,
  labelDisabled,
  maxDecimals,
  minDecimals,
  numberFormattingDisabled,
  numMode,
  red,
  removeColumn,
  selectColumns,
  setDataDisabled,
  setFormulaDisabled,
  setTriggerDisabled,
  setupMultiColumnDoc,
  testAlignment,
  testSingleWrapping,
  testWrapping,
  toggleDerived,
  transformSectionDisabled,
  transparent,
  types,
  wrap,
  wrapDisabled,
} from "test/nbrowser/multiColumnHelpers";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("MultiColumn1", function() {
  this.timeout(80000);
  const cleanup = setupTestSuite();
  before(async function() {
    await setupMultiColumnDoc(cleanup);
  });

  describe("behavior tests", function() {
    let revertEach: () => Promise<void>;
    let revertAll: () => Promise<void>;
    let failed = false;
    before(async function() {
      revertAll = await gu.begin();
      await addAnyColumn("Test1");
      await addAnyColumn("Test2");
      await addAnyColumn("Test3");
    });
    after(async function() {
      if (!failed) {
        await revertAll();
      }
    });

    beforeEach(async () => {
      revertEach = await gu.begin();
    });
    afterEach(async function() {
      if (this.currentTest?.state !== "failed") {
        await revertEach();
      } else {
        failed = true;
      }
    });

    it("should not work on card view", async () => {
      await gu.changeWidget("Card");
      await gu.openColumnPanel();
      assert.notEqual(await gu.getType(), "Mixed types");
      await gu.openColumnPanel();
      // Should be able to change type.
      await gu.getDetailCell("Test1", 1);
      await gu.enterCell("aa");
      await gu.setType("Integer", { apply: true });
      assert.equal(await gu.getType(), "Integer");
    });

    it("should undo color change", async () => {
      // This is test for a bug, colors were not saved when "click outside" was done by clicking
      // one of the cells.
      await selectColumns("Test1", "Test2");
      await gu.setType("Reference");
      await gu.getCell("Test1", 1).click();
      await gu.enterCell("Table1", Key.ENTER);
      await gu.getCell("Test2", 3).click();
      await gu.enterCell("Table1", Key.ENTER);
      await selectColumns("Test1", "Test2");
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      // Clicking on one of the cell caused that the color was not saved.
      await gu.getCell("Test2", 1).click();
      // Test if color is set.
      await gu.assertFillColor(await gu.getCell("Test1", 1), blue);
      await gu.assertFillColor(await gu.getCell("Test2", 1), blue);
      // Press undo
      await gu.undo();
      await gu.assertFillColor(await gu.getCell("Test1", 1), transparent);
      await gu.assertFillColor(await gu.getCell("Test2", 1), transparent);
    });

    for (const type of ["Choice", "Text", "Reference", "Numeric"] as gu.ColumnType[]) {
      it(`should reset all columns to first column type for ${type}`, async () => {
        // We start with empty columns, then we will change first one
        // to a data column, select all and then change all other to the same type.
        // This tests if creator panel is enabled properly, and we can change
        // all columns to the type of the first selected columns (it was a bug).
        await selectColumns("Test1");
        await gu.setType(type);
        await selectColumns("Test1", "Test3");
        assert.equal(await gu.getType(), "Mixed types");
        await gu.setType(type);
        assert.equal(await gu.getType(), type);
        await selectColumns("Test1");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test2");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test3");
        assert.equal(await gu.getType(), type);
        await gu.undo();
        await selectColumns("Test1");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test2");
        assert.equal(await gu.getType(), "Any");
        await selectColumns("Test3");
        assert.equal(await gu.getType(), "Any");
      });
    }

    it("should show proper behavior label", async () => {
      await selectColumns("Test1");
      assert.equal(await gu.columnBehavior(), "Empty column");
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Empty columns");

      // Change first to be data column.
      await selectColumns("Test1");
      await driver.find(".test-field-set-data").click();
      await gu.waitForServer();
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Mixed Behavior");

      // Change second to be a data column
      await selectColumns("Test2");
      await driver.find(".test-field-set-data").click();
      await gu.waitForServer();
      await selectColumns("Test1", "Test2");
      assert.equal(await gu.columnBehavior(), "Data columns");
      // Now make them all formulas
      await gu.sendActions([
        ["ModifyColumn", "Table1", "Test1", { formula: "1", isFormula: true }],
        ["ModifyColumn", "Table1", "Test2", { formula: "1", isFormula: true }],
        ["ModifyColumn", "Table1", "Test3", { formula: "1", isFormula: true }],
      ]);
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Formula columns");

      // Make one of them data column and test that the mix is recognized.
      await selectColumns("Test1");
      await gu.changeBehavior("Convert column to data");
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Mixed Behavior");
    });

    it("should reset multiple columns", async () => {
      // Now make them all formulas
      await gu.sendActions([
        ["ModifyColumn", "Table1", "Test1", { formula: "1", isFormula: true }],
        ["ModifyColumn", "Table1", "Test2", { formula: "1", isFormula: true }],
        ["ModifyColumn", "Table1", "Test3", { formula: "1", isFormula: true }],
      ]);
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Formula columns");
      await alignment("center");
      assert.equal(await alignment(), "center");

      // Reset all of them
      assert.deepEqual(await gu.availableBehaviorOptions(), ["Convert columns to data", "Clear and reset"]);
      await gu.changeBehavior("Clear and reset");
      assert.equal(await gu.columnBehavior(), "Empty columns");
      assert.equal(await alignment(), "left");

      // Make them all data columns
      await gu.getCell("Test1", 1).click(); await gu.enterCell("a");
      await gu.getCell("Test2", 1).click(); await gu.enterCell("a");
      await gu.getCell("Test3", 1).click(); await gu.enterCell("a");
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Data columns");
      await selectColumns("Test1");
      assert.equal(await gu.columnBehavior(), "Data column");

      // Reset all of them
      await selectColumns("Test1", "Test3");
      assert.deepEqual(await gu.availableBehaviorOptions(), ["Clear and reset"]);
      await gu.changeBehavior("Clear and reset");
      assert.equal(await gu.columnBehavior(), "Empty columns");
      await selectColumns("Test1");
      assert.equal(await gu.columnBehavior(), "Empty column");
      assert.equal(await gu.getCell("Test1", 1).getText(), "");
      assert.equal(await gu.getCell("Test2", 1).getText(), "");
      assert.equal(await gu.getCell("Test3", 1).getText(), "");
    });

    it("should convert to data multiple columns", async () => {
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Empty columns");
      assert.deepEqual(await gu.availableBehaviorOptions(), ["Convert columns to data", "Clear and reset"]);
      await gu.changeBehavior("Convert columns to data");
      assert.equal(await gu.columnBehavior(), "Data columns");
      await selectColumns("Test1");
      assert.equal(await gu.columnBehavior(), "Data column");

      // Now make them all formula columns
      await gu.sendActions([
        ["ModifyColumn", "Table1", "Test1", { formula: "1", isFormula: true }],
        ["ModifyColumn", "Table1", "Test2", { formula: "2", isFormula: true }],
        ["ModifyColumn", "Table1", "Test3", { formula: "3", isFormula: true }],
      ]);
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.columnBehavior(), "Formula columns");

      // Convert them to data
      assert.deepEqual(await gu.availableBehaviorOptions(), ["Convert columns to data", "Clear and reset"]);
      await gu.changeBehavior("Convert columns to data");
      assert.equal(await gu.columnBehavior(), "Data columns");
      await selectColumns("Test1");
      assert.equal(await gu.columnBehavior(), "Data column");
      // Test that data stays.
      assert.equal(await gu.getCell("Test1", 1).getText(), "1");
      assert.equal(await gu.getCell("Test2", 1).getText(), "2");
      assert.equal(await gu.getCell("Test3", 1).getText(), "3");
    });

    it("should disable formula editor for multiple columns", async () => {
      await gu.sendActions([
        ["ModifyColumn", "Table1", "Test1", { formula: "1", isFormula: true }],
      ]);
      await selectColumns("Test1");
      assert.isFalse(await formulaEditorDisabled());
      await selectColumns("Test1", "Test3");
      assert.isTrue(await formulaEditorDisabled());
      await selectColumns("Test1");
      assert.isFalse(await formulaEditorDisabled());
    });

    it("should disable column id and other unique options", async () => {
      await selectColumns("Test1", "Test3");
      assert.isTrue(await colIdDisabled());
      assert.isTrue(await deriveDisabled());
      assert.isTrue(await labelDisabled());
      assert.isTrue(await transformSectionDisabled());
      assert.isTrue(await setTriggerDisabled());
      assert.isTrue(await setDataDisabled());
      assert.isTrue(await setFormulaDisabled());
      assert.isTrue(await addConditionDisabled());
      assert.isFalse(await columnTypeDisabled());

      await selectColumns("Test1");
      assert.isTrue(await colIdDisabled());
      assert.isFalse(await deriveDisabled());
      assert.isFalse(await labelDisabled());
      assert.isFalse(await setTriggerDisabled());
      assert.isTrue(await transformSectionDisabled());
      assert.isFalse(await addConditionDisabled());
      assert.isFalse(await columnTypeDisabled());

      // Make one column a data column, to disable type selector.
      await selectColumns("Test1");
      await gu.changeBehavior("Convert column to data");
      assert.isFalse(await transformSectionDisabled());
      await selectColumns("Test1", "Test3");
      assert.isTrue(await columnTypeDisabled());

      // Make sure that a colId disabled state is not altered accidentally.
      await selectColumns("Test1");
      assert.isTrue(await colIdDisabled());
      await toggleDerived();
      assert.isFalse(await colIdDisabled());
      await selectColumns("Test1", "Test2");
      assert.isTrue(await colIdDisabled());
      await selectColumns("Test1");
      assert.isFalse(await colIdDisabled());
      await toggleDerived();
      assert.isTrue(await colIdDisabled());
    });

    it("should change column type for mixed behaviors", async () => {
      // For empty columns
      await selectColumns("Test1", "Test3");
      assert.isFalse(await columnTypeDisabled());
      // Check every column type
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns("Test1");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test1", "Test3");
        assert.equal(await gu.getType(), type);
      }
      // For mix of empty and formulas
      await gu.sendActions([
        ["ModifyColumn", "Table1", "Test2", { formula: "2", isFormula: true }],
      ]);
      await selectColumns("Test1", "Test3");
      assert.isFalse(await columnTypeDisabled());
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns("Test1");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test1", "Test3");
        assert.equal(await gu.getType(), type);
      }

      // For mix of empty and formulas and data
      await gu.sendActions([
        // We are changing first column, so the selection will start from data column.
        ["ModifyColumn", "Table1", "Test1", { type: "Choice" }],
      ]);
      await selectColumns("Test1", "Test3");
      assert.isFalse(await columnTypeDisabled());
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns("Test1");
        assert.equal(await gu.getType(), type);
        await selectColumns("Test1", "Test3");
        assert.equal(await gu.getType(), type);
      }

      // Shows proper label for mixed types
      await selectColumns("Test1");
      await gu.setType("Numeric");
      await selectColumns("Test2");
      await gu.setType("Toggle");
      await selectColumns("Test1", "Test3");
      assert.equal(await gu.getType(), "Mixed types");
    });
  });

  describe("color tests", function() {
    before(async function() {
      await addAnyColumn("Test1");
      await addAnyColumn("Test2");
    });
    after(async function() {
      await removeColumn("Test1");
      await removeColumn("Test2");
    });
    it("should change cell background for multiple columns", async () => {
      await selectColumns("Test1", "Test2");
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), blue);
      await driver.sendKeys(Key.ESCAPE);
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), transparent);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), transparent);
      assert.equal(await cellColorLabel(), "Default cell style");

      // Change one cell to red
      await selectColumns("Test1");
      await gu.openCellColorPicker();
      await gu.setFillColor(red);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), red);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), transparent);

      // Check label and colors for multicolumn selection.
      await selectColumns("Test1", "Test2");
      assert.equal(await cellColorLabel(), "Mixed style");
      // Try to change to blue, but press escape.
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), blue);
      await driver.sendKeys(Key.ESCAPE);

      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), red);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), transparent);

      // Change both colors.
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), blue);

      // Make sure they stick.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.assertFillColor(await gu.getCell("Test1", 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell("Test2", 1).find(".field_clip"), blue);
    });

    it("should change header background for multiple columns", async () => {
      const defaultHeaderFillColor = "rgba(247, 247, 247, 1)";
      await selectColumns("Test1", "Test2");
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await gu.assertHeaderFillColor("Test1", blue);
      await gu.assertHeaderFillColor("Test2", blue);
      await driver.sendKeys(Key.ESCAPE);
      await gu.assertHeaderFillColor("Test1", defaultHeaderFillColor);
      await gu.assertHeaderFillColor("Test2", defaultHeaderFillColor);
      assert.equal(await headerColorLabel(), "Default header style");

      // Change one header to red
      await selectColumns("Test1");
      await gu.openHeaderColorPicker();
      await gu.setFillColor(red);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await gu.assertHeaderFillColor("Test1", red);
      await gu.assertHeaderFillColor("Test2", defaultHeaderFillColor);

      // Check label and colors for multicolumn selection.
      await selectColumns("Test1", "Test2");
      assert.equal(await headerColorLabel(), "Mixed style");
      // Try to change to blue, but press escape.
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await gu.assertHeaderFillColor("Test1", blue);
      await gu.assertHeaderFillColor("Test2", blue);
      await driver.sendKeys(Key.ESCAPE);

      await gu.assertHeaderFillColor("Test1", red);
      await gu.assertHeaderFillColor("Test2", defaultHeaderFillColor);

      // Change both colors.
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.assertHeaderFillColor("Test1", blue);
      await gu.assertHeaderFillColor("Test2", blue);

      // Make sure they stick.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.assertHeaderFillColor("Test1", blue);
      await gu.assertHeaderFillColor("Test2", blue);
    });
  });

  describe(`test for Integer column`, function() {
    beforeEach(async () => {
      await gu.addColumn("Left", "Integer");
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn("Left");
        await removeColumn("Right");
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn("Right", right);
        await selectColumns("Left", "Right");
        if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
          assert.equal(await wrapDisabled(), true);
        } else {
          assert.equal(await wrapDisabled(), false);
          assert.equal(await wrap(), false);
        }
        if (["Toggle", "Attachment"].includes(right)) {
          assert.equal(await alignmentDisabled(), true);
        } else {
          assert.equal(await alignmentDisabled(), false);
        }
        if (["Integer", "Numeric"].includes(right)) {
          assert.equal(await alignment(), "right");
        } else if (["Toggle", "Attachment"].includes(right)) {
          // With toggle, alignment is unset.
        } else {
          assert.equal(await alignment(), null);
        }
        if (["Toggle", "Attachment"].includes(right)) {
          // omit tests for alignment
        } else {
          await testAlignment();
        }
        if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
          // omit tests for wrap
        } else if (["Choice"].includes(right)) {
          // Choice column doesn't support wrapping.
          await testSingleWrapping();
        } else {
          await testWrapping();
        }
        await selectColumns("Left", "Right");
        if (["Integer", "Numeric"].includes(right)) {
          // Test number formatting, be default nothing should be set.
          assert.isFalse(await numberFormattingDisabled());
          assert.isNull(await numMode());

          for (const mode of ["decimal", "currency", "percent", "exp"]) {
            await selectColumns("Left", "Right");
            await numMode(mode as any);
            assert.equal(await numMode(), mode);
            await selectColumns("Left");
            assert.equal(await numMode(), mode);
            await selectColumns("Right");
            assert.equal(await numMode(), mode);
            await selectColumns("Left", "Right");
            assert.equal(await numMode(), mode);
          }
          await selectColumns("Left", "Right");
          await numMode("decimal");

          const decimalsProps = [minDecimals, maxDecimals];
          for (const decimals of decimalsProps) {
            await selectColumns("Left", "Right");
            await decimals(5);
            assert.equal(await decimals(), 5);
            await selectColumns("Left");
            assert.equal(await decimals(), 5);
            await selectColumns("Right");
            assert.equal(await decimals(), 5);
            // Set different decimals for left and right.
            await selectColumns("Left");
            await decimals(2);
            await selectColumns("Right");
            await decimals(4);
            await selectColumns("Left", "Right");
            assert.isNaN(await decimals()); // default value that is empty
            // Setting it will reset both.
            await decimals(8);
            await selectColumns("Left");
            assert.equal(await decimals(), 8);
            await selectColumns("Right");
            assert.equal(await decimals(), 8);
          }

          // Clearing will clear both, but only for Numeric columns, Integer
          // has a default value of 0, that will be set when element is cleared.
          // TODO: This looks like a buggy behavior, and should be fixed.
          await selectColumns("Left", "Right");
          await minDecimals(null);
          await selectColumns("Left");
          assert.equal(await minDecimals(), 0);
          await selectColumns("Right");
          if (right === "Numeric") {
            assert.isNaN(await minDecimals());
          } else {
            assert.equal(await minDecimals(), 0);
          }

          // Clearing max value works as expected.
          await selectColumns("Left", "Right");
          await maxDecimals(null);
          await selectColumns("Left");
          assert.isNaN(await maxDecimals()); // default value that is empty
          await selectColumns("Right");
          assert.isNaN(await maxDecimals()); // default value that is empty
        } else {
          assert.isTrue(await numberFormattingDisabled());
        }
      });
    }
  });
});
