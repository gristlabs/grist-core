import {arrayRepeat} from 'app/plugin/gutil';
import * as gu from 'test/nbrowser/gristUtils';
import {ColumnType} from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {UserAPIImpl} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
let api: UserAPIImpl;
let doc: string;

const transparent = 'rgba(0, 0, 0, 0)';
const blue = '#0000FF';
const red = '#FF0000';
const types: Array<ColumnType> = [
  'Any', 'Text', 'Integer', 'Numeric', 'Toggle', 'Date', 'DateTime', 'Choice', 'Choice List',
  'Reference', 'Reference List', 'Attachment'
];

describe('MultiColumn', function() {
  this.timeout(80000);
  const cleanup = setupTestSuite();
  before(async function() {
    const session = await gu.session().login();
    doc = await session.tempNewDoc(cleanup, "MultiColumn", {load: false});
    api = session.createHomeApi();
    await api.applyUserActions(doc, [
      ['BulkAddRecord', 'Table1', arrayRepeat(2, null), {}]
    ]);
    // Leave only A column which will have AnyType. We don't need it, but
    // table must have at least one column and we will be removing all columns
    // that we test.
    await api.applyUserActions(doc, [
      ['RemoveColumn', 'Table1', 'B'],
      ['RemoveColumn', 'Table1', 'C'],
    ]);
    await session.loadDoc('/doc/' + doc);
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
  });

  describe("behavior tests", function() {
    let revertEach: () => Promise<void>;
    let revertAll: () => Promise<void>;
    let failed = false;
    before(async function() {
      revertAll = await gu.begin();
      await addAnyColumn('Test1');
      await addAnyColumn('Test2');
      await addAnyColumn('Test3');
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
      if (this.currentTest?.state !== 'failed') {
        await revertEach();
      } else {
        failed = true;
      }
    });

    it('should not work on card view', async () => {
      await gu.changeWidget('Card');
      await gu.openColumnPanel();
      assert.notEqual(await gu.getType(), "Mixed types");
      await gu.openColumnPanel();
      // Should be able to change type.
      await gu.getDetailCell('Test1', 1);
      await gu.enterCell("aa");
      await gu.setType("Integer", {apply: true});
      assert.equal(await gu.getType(), "Integer");
    });

    it('should undo color change', async () => {
      // This is test for a bug, colors were not saved when "click outside" was done by clicking
      // one of the cells.
      await selectColumns('Test1', 'Test2');
      await gu.setType('Reference');
      await gu.getCell('Test1', 1).click();
      await gu.enterCell('Table1', Key.ENTER);
      await gu.getCell('Test2', 3).click();
      await gu.enterCell('Table1', Key.ENTER);
      await selectColumns('Test1', 'Test2');
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      // Clicking on one of the cell caused that the color was not saved.
      await gu.getCell('Test2', 1).click();
      // Test if color is set.
      await gu.assertFillColor(await gu.getCell('Test1', 1), blue);
      await gu.assertFillColor(await gu.getCell('Test2', 1), blue);
      // Press undo
      await gu.undo();
      await gu.assertFillColor(await gu.getCell('Test1', 1), transparent);
      await gu.assertFillColor(await gu.getCell('Test2', 1), transparent);
    });

    for (const type of ['Choice', 'Text', 'Reference', 'Numeric'] as Array<ColumnType>) {
      it(`should reset all columns to first column type for ${type}`, async () => {
        // We start with empty columns, then we will change first one
        // to a data column, select all and then change all other to the same type.
        // This tests if creator panel is enabled properly, and we can change
        // all columns to the type of the first selected columns (it was a bug).
        await selectColumns('Test1');
        await gu.setType(type);
        await selectColumns('Test1', 'Test3');
        assert.equal(await gu.getType(), "Mixed types");
        await gu.setType(type);
        assert.equal(await gu.getType(), type);
        await selectColumns('Test1');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test2');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test3');
        assert.equal(await gu.getType(), type);
        await gu.undo();
        await selectColumns('Test1');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test2');
        assert.equal(await gu.getType(), 'Any');
        await selectColumns('Test3');
        assert.equal(await gu.getType(), 'Any');
      });
    }

    it('should show proper behavior label', async () => {
      await selectColumns('Test1');
      assert.equal(await gu.columnBehavior(), 'Empty Column');
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Empty Columns');

      // Change first to be data column.
      await selectColumns('Test1');
      await driver.find(".test-field-set-data").click();
      await gu.waitForServer();
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Mixed Behavior');

      // Change second to be a data column
      await selectColumns('Test2');
      await driver.find(".test-field-set-data").click();
      await gu.waitForServer();
      await selectColumns('Test1', 'Test2');
      assert.equal(await gu.columnBehavior(), 'Data Columns');
      // Now make them all formulas
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'Test1', {formula: '1', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test2', {formula: '1', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test3', {formula: '1', isFormula: true}],
      ]);
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Formula Columns');

      // Make one of them data column and test that the mix is recognized.
      await selectColumns('Test1');
      await gu.changeBehavior('Convert column to data');
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Mixed Behavior');
    });

    it('should reset multiple columns', async () => {
      // Now make them all formulas
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'Test1', {formula: '1', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test2', {formula: '1', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test3', {formula: '1', isFormula: true}],
      ]);
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Formula Columns');
      await alignment('center');
      assert.equal(await alignment(), 'center');

      // Reset all of them
      assert.deepEqual(await gu.availableBehaviorOptions(), ['Convert columns to data', 'Clear and reset']);
      await gu.changeBehavior('Clear and reset');
      assert.equal(await gu.columnBehavior(), 'Empty Columns');
      assert.equal(await alignment(), 'left');

      // Make them all data columns
      await gu.getCell('Test1', 1).click(); await gu.enterCell('a');
      await gu.getCell('Test2', 1).click(); await gu.enterCell('a');
      await gu.getCell('Test3', 1).click(); await gu.enterCell('a');
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Data Columns');
      await selectColumns('Test1');
      assert.equal(await gu.columnBehavior(), 'Data Column');

      // Reset all of them
      await selectColumns('Test1', 'Test3');
      assert.deepEqual(await gu.availableBehaviorOptions(), ['Clear and reset']);
      await gu.changeBehavior('Clear and reset');
      assert.equal(await gu.columnBehavior(), 'Empty Columns');
      await selectColumns('Test1');
      assert.equal(await gu.columnBehavior(), 'Empty Column');
      assert.equal(await gu.getCell('Test1', 1).getText(), '');
      assert.equal(await gu.getCell('Test2', 1).getText(), '');
      assert.equal(await gu.getCell('Test3', 1).getText(), '');
    });

    it('should convert to data multiple columns', async () => {
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Empty Columns');
      assert.deepEqual(await gu.availableBehaviorOptions(), ['Convert columns to data', 'Clear and reset']);
      await gu.changeBehavior('Convert columns to data');
      assert.equal(await gu.columnBehavior(), 'Data Columns');
      await selectColumns('Test1');
      assert.equal(await gu.columnBehavior(), 'Data Column');

      // Now make them all formula columns
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'Test1', {formula: '1', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test2', {formula: '2', isFormula: true}],
        ['ModifyColumn', 'Table1', 'Test3', {formula: '3', isFormula: true}],
      ]);
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.columnBehavior(), 'Formula Columns');

      // Convert them to data
      assert.deepEqual(await gu.availableBehaviorOptions(), ['Convert columns to data', 'Clear and reset']);
      await gu.changeBehavior('Convert columns to data');
      assert.equal(await gu.columnBehavior(), 'Data Columns');
      await selectColumns('Test1');
      assert.equal(await gu.columnBehavior(), 'Data Column');
      // Test that data stays.
      assert.equal(await gu.getCell('Test1', 1).getText(), '1');
      assert.equal(await gu.getCell('Test2', 1).getText(), '2');
      assert.equal(await gu.getCell('Test3', 1).getText(), '3');
    });

    it('should disable formula editor for multiple columns', async () => {
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'Test1', {formula: '1', isFormula: true}],
      ]);
      await selectColumns('Test1');
      assert.isFalse(await formulaEditorDisabled());
      await selectColumns('Test1', 'Test3');
      assert.isTrue(await formulaEditorDisabled());
      await selectColumns('Test1');
      assert.isFalse(await formulaEditorDisabled());
    });

    it('should disable column id and other unique options', async () => {
      await selectColumns('Test1', 'Test3');
      assert.isTrue(await colIdDisabled());
      assert.isTrue(await deriveDisabled());
      assert.isTrue(await labelDisabled());
      assert.isTrue(await transformSectionDisabled());
      assert.isTrue(await setTriggerDisabled());
      assert.isTrue(await setDataDisabled());
      assert.isTrue(await setFormulaDisabled());
      assert.isTrue(await addConditionDisabled());
      assert.isFalse(await columnTypeDisabled());

      await selectColumns('Test1');
      assert.isTrue(await colIdDisabled());
      assert.isFalse(await deriveDisabled());
      assert.isFalse(await labelDisabled());
      assert.isFalse(await setTriggerDisabled());
      assert.isTrue(await transformSectionDisabled());
      assert.isFalse(await addConditionDisabled());
      assert.isFalse(await columnTypeDisabled());

      // Make one column a data column, to disable type selector.
      await selectColumns('Test1');
      await gu.changeBehavior('Convert column to data');
      assert.isFalse(await transformSectionDisabled());
      await selectColumns('Test1', 'Test3');
      assert.isTrue(await columnTypeDisabled());

      // Make sure that a colId disabled state is not altered accidentally.
      await selectColumns('Test1');
      assert.isTrue(await colIdDisabled());
      await toggleDerived();
      assert.isFalse(await colIdDisabled());
      await selectColumns('Test1', 'Test2');
      assert.isTrue(await colIdDisabled());
      await selectColumns('Test1');
      assert.isFalse(await colIdDisabled());
      await toggleDerived();
      assert.isTrue(await colIdDisabled());
    });

    it('should change column type for mixed behaviors', async () => {
      // For empty columns
      await selectColumns('Test1', 'Test3');
      assert.isFalse(await columnTypeDisabled());
      // Check every column type
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns('Test1');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test1', 'Test3');
        assert.equal(await gu.getType(), type);
      }
      // For mix of empty and formulas
      await gu.sendActions([
        ['ModifyColumn', 'Table1', 'Test2', {formula: '2', isFormula: true}],
      ]);
      await selectColumns('Test1', 'Test3');
      assert.isFalse(await columnTypeDisabled());
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns('Test1');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test1', 'Test3');
        assert.equal(await gu.getType(), type);
      }

      // For mix of empty and formulas and data
      await gu.sendActions([
        // We are changing first column, so the selection will start from data column.
        ['ModifyColumn', 'Table1', 'Test1', {type: 'Choice'}],
      ]);
      await selectColumns('Test1', 'Test3');
      assert.isFalse(await columnTypeDisabled());
      for (const type of types) {
        await gu.setType(type);
        await gu.checkForErrors();
        await selectColumns('Test1');
        assert.equal(await gu.getType(), type);
        await selectColumns('Test1', 'Test3');
        assert.equal(await gu.getType(), type);
      }

      // Shows proper label for mixed types
      await selectColumns('Test1');
      await gu.setType('Numeric');
      await selectColumns('Test2');
      await gu.setType('Toggle');
      await selectColumns('Test1', 'Test3');
      assert.equal(await gu.getType(), 'Mixed types');
    });
  });

  describe("color tests", function() {
    before(async function() {
      await addAnyColumn('Test1');
      await addAnyColumn('Test2');
    });
    after(async function() {
      await removeColumn('Test1');
      await removeColumn('Test2');
    });
    it('should change cell background for multiple columns', async () => {
      await selectColumns('Test1', 'Test2');
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), blue);
      await driver.sendKeys(Key.ESCAPE);
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), transparent);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), transparent);
      assert.equal(await cellColorLabel(), "Default cell style");

      // Change one cell to red
      await selectColumns('Test1');
      await gu.openCellColorPicker();
      await gu.setFillColor(red);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), red);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), transparent);

      // Check label and colors for multicolumn selection.
      await selectColumns('Test1', 'Test2');
      assert.equal(await cellColorLabel(), "Mixed style");
      // Try to change to blue, but press escape.
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), blue);
      await driver.sendKeys(Key.ESCAPE);

      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), red);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), transparent);

      // Change both colors.
      await gu.openCellColorPicker();
      await gu.setFillColor(blue);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), blue);

      // Make sure they stick.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      assert.equal(await cellColorLabel(), "Default cell style");
      await gu.assertFillColor(await gu.getCell('Test1', 1).find(".field_clip"), blue);
      await gu.assertFillColor(await gu.getCell('Test2', 1).find(".field_clip"), blue);
    });

    it('should change header background for multiple columns', async () => {
      const defaultHeaderFillColor = 'rgba(247, 247, 247, 1)';
      await selectColumns('Test1', 'Test2');
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await gu.assertHeaderFillColor('Test1', blue);
      await gu.assertHeaderFillColor('Test2', blue);
      await driver.sendKeys(Key.ESCAPE);
      await gu.assertHeaderFillColor('Test1', defaultHeaderFillColor);
      await gu.assertHeaderFillColor('Test2', defaultHeaderFillColor);
      assert.equal(await headerColorLabel(), "Default header style");

      // Change one header to red
      await selectColumns('Test1');
      await gu.openHeaderColorPicker();
      await gu.setFillColor(red);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      await gu.assertHeaderFillColor('Test1', red);
      await gu.assertHeaderFillColor('Test2', defaultHeaderFillColor);

      // Check label and colors for multicolumn selection.
      await selectColumns('Test1', 'Test2');
      assert.equal(await headerColorLabel(), "Mixed style");
      // Try to change to blue, but press escape.
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await gu.assertHeaderFillColor('Test1', blue);
      await gu.assertHeaderFillColor('Test2', blue);
      await driver.sendKeys(Key.ESCAPE);

      await gu.assertHeaderFillColor('Test1', red);
      await gu.assertHeaderFillColor('Test2', defaultHeaderFillColor);

      // Change both colors.
      await gu.openHeaderColorPicker();
      await gu.setFillColor(blue);
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.assertHeaderFillColor('Test1', blue);
      await gu.assertHeaderFillColor('Test2', blue);

      // Make sure they stick.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      assert.equal(await headerColorLabel(), "Default header style");
      await gu.assertHeaderFillColor('Test1', blue);
      await gu.assertHeaderFillColor('Test2', blue);
    });
  });

  describe(`test for Integer column`, function() {
    beforeEach(async () => {
      await gu.addColumn('Left', 'Integer');
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn('Left');
        await removeColumn('Right');
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn('Right', right);
        await selectColumns('Left', 'Right');
        if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
          assert.equal(await wrapDisabled(), true);
        } else {
          assert.equal(await wrapDisabled(), false);
          assert.equal(await wrap(), false);
        }
        if (['Toggle', 'Attachment'].includes(right)) {
          assert.equal(await alignmentDisabled(), true);
        } else {
          assert.equal(await alignmentDisabled(), false);
        }
        if (['Integer', 'Numeric'].includes(right)) {
          assert.equal(await alignment(), 'right');
        } else if (['Toggle', 'Attachment'].includes(right)) {
          // With toggle, alignment is unset.
        } else {
          assert.equal(await alignment(), null);
        }
        if (['Toggle', 'Attachment'].includes(right)) {
          // omit tests for alignment
        } else {
          await testAlignment();
        }
        if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
          // omit tests for wrap
        } else if (['Choice'].includes(right)) {
          // Choice column doesn't support wrapping.
          await testSingleWrapping();
        } else {
          await testWrapping();
        }
        await selectColumns('Left', 'Right');
        if (['Integer', 'Numeric'].includes(right)) {
          // Test number formatting, be default nothing should be set.
          assert.isFalse(await numberFormattingDisabled());
          assert.isNull(await numMode());

          for (const mode of ['decimal', 'currency', 'percent', 'exp']) {
            await selectColumns('Left', 'Right');
            await numMode(mode as any);
            assert.equal(await numMode(), mode);
            await selectColumns('Left');
            assert.equal(await numMode(), mode);
            await selectColumns('Right');
            assert.equal(await numMode(), mode);
            await selectColumns('Left', 'Right');
            assert.equal(await numMode(), mode);
          }
          await selectColumns('Left', 'Right');
          await numMode('decimal');

          const decimalsProps = [minDecimals, maxDecimals];
          for (const decimals of decimalsProps) {
            await selectColumns('Left', 'Right');
            await decimals(5);
            assert.equal(await decimals(), 5);
            await selectColumns('Left');
            assert.equal(await decimals(), 5);
            await selectColumns('Right');
            assert.equal(await decimals(), 5);
            // Set different decimals for left and right.
            await selectColumns('Left');
            await decimals(2);
            await selectColumns('Right');
            await decimals(4);
            await selectColumns('Left', 'Right');
            assert.isNaN(await decimals()); // default value that is empty
            // Setting it will reset both.
            await decimals(8);
            await selectColumns('Left');
            assert.equal(await decimals(), 8);
            await selectColumns('Right');
            assert.equal(await decimals(), 8);
          }

          // Clearing will clear both, but only for Numeric columns, Integer
          // has a default value of 0, that will be set when element is cleared.
          // TODO: This looks like a buggy behavior, and should be fixed.
          await selectColumns('Left', 'Right');
          await minDecimals(null);
          await selectColumns('Left');
          assert.equal(await minDecimals(), 0);
          await selectColumns('Right');
          if (right === 'Numeric') {
            assert.isNaN(await minDecimals());
          } else {
            assert.equal(await minDecimals(), 0);
          }

          // Clearing max value works as expected.
          await selectColumns('Left', 'Right');
          await maxDecimals(null);
          await selectColumns('Left');
          assert.isNaN(await maxDecimals()); // default value that is empty
          await selectColumns('Right');
          assert.isNaN(await maxDecimals()); // default value that is empty
        } else {
          assert.isTrue(await numberFormattingDisabled());
        }
      });
    }
  });

  for (const left of ['Choice', 'Choice List']) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn('Left', left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn('Left');
          await removeColumn('Right');
        }
      });
      for (const right of types) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn('Right', right);
          await selectColumns('Left', 'Right');
          if (['Choice', 'Choice List'].includes(right)) {
            await testChoices();
          } else {
            assert.isTrue(await choiceEditorDisabled());
          }

          if (left === 'Choice List') {
            if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
              assert.equal(await wrapDisabled(), true);
            } else {
              assert.equal(await wrapDisabled(), false);
              assert.equal(await wrap(), false);
            }
          }

          if (['Toggle', 'Attachment'].includes(right)) {
            assert.equal(await alignmentDisabled(), true);
          } else {
            assert.equal(await alignmentDisabled(), false);
          }
          if (['Integer', 'Numeric'].includes(right)) {
            assert.equal(await alignment(), null);
          } else if (['Toggle', 'Attachment'].includes(right)) {
            // With toggle, alignment is unset.
          } else {
            assert.equal(await alignment(), 'left');
          }
          if (['Toggle', 'Attachment'].includes(right)) {
            // omit tests for alignment
          } else {
            await testAlignment();
          }

          // Choice doesn't support wrapping.
          if (left === 'Choice List') {
            if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
              // omit tests for wrap
            } else if (['Choice'].includes(right)) {
              // Choice column doesn't support wrapping.
              await testSingleWrapping();
            } else {
              await testWrapping();
            }
          }
        });
      }
    });
  }

  for (const left of ['Reference', 'Reference List']) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn('Left', left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn('Left');
          await removeColumn('Right');
        }
      });
      // Test for types that matter (have different set of defaults).
      for (const right of ['Any', 'Reference', 'Reference List', 'Toggle', 'Integer']) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn('Right', right);
          await selectColumns('Left', 'Right');
          assert.isTrue(await refControlsDisabled(), "Reference controls should be disabled");
          await commonTestsForAny(right);
        });
      }
    });
  }


  describe(`test for Date column`, function() {
    beforeEach(async () => {
      await gu.addColumn('Left', 'Date');
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn('Left');
        await removeColumn('Right');
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn('Right', right);
        await selectColumns('Left', 'Right');
        if (['Date', 'DateTime'].includes(right)) {
          assert.isFalse(await dateFormatDisabled());
        } else {
          assert.isTrue(await dateFormatDisabled());
        }
        if (['Toggle', 'Attachment'].includes(right)) {
          assert.equal(await alignmentDisabled(), true);
        } else {
          assert.equal(await alignmentDisabled(), false);
        }
        if (['Integer', 'Numeric'].includes(right)) {
          assert.equal(await alignment(), null);
        } else if (['Toggle', 'Attachment'].includes(right)) {
          // With toggle, alignment is unset.
        } else {
          assert.equal(await alignment(), 'left');
        }
        if (['Toggle', 'Attachment'].includes(right)) {
          // omit tests for alignment
        } else {
          await testAlignment();
        }
      });
      if (['Date', 'DateTime'].includes(right)) {
        it(`should change format with ${right} column`, async function() {
          await gu.addColumn('Right', right);
          await selectColumns('Left', 'Right');
          assert.isFalse(await dateFormatDisabled());
          // Test for mixed format.
          await selectColumns('Left');
          await dateFormat('MM/DD/YY');
          await selectColumns('Left', 'Right');
          assert.equal(await dateFormat(), 'Mixed format');
          // Test that both change when format is changed.
          for (const mode of ['MM/DD/YY', 'DD-MM-YYYY']) {
            await dateFormat(mode);
            await selectColumns('Left');
            assert.equal(await dateFormat(), mode);
            await selectColumns('Right');
            assert.equal(await dateFormat(), mode);
            await selectColumns('Left', 'Right');
            assert.equal(await dateFormat(), mode);
          }
          // Test that custom format works
          await gu.setCustomDateFormat('MM');
          await selectColumns('Left');
          assert.equal(await gu.getDateFormat(), "MM");
          await selectColumns('Right');
          assert.equal(await gu.getDateFormat(), "MM");
          await selectColumns('Left', 'Right');
          assert.equal(await gu.getDateFormat(), "MM");
          // Test that we can go back to normal format.
          await gu.setDateFormat("MM/DD/YY");
          assert.isFalse(await customDateFormatVisible());
          await selectColumns('Left');
          assert.isFalse(await customDateFormatVisible());
          assert.equal(await gu.getDateFormat(), "MM/DD/YY");
          await selectColumns('Right');
          assert.isFalse(await customDateFormatVisible());
          assert.equal(await gu.getDateFormat(), "MM/DD/YY");
        });
      }
    }
  });

  describe(`test for Toggle column`, function() {
    beforeEach(async () => {
      await gu.addColumn('Left', 'Toggle');
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn('Left');
        await removeColumn('Right');
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn('Right', right);
        // There is not match to test
        if (right === 'Toggle') {
          await selectColumns('Left', 'Right');
          assert.isFalse(await widgetTypeDisabled());
          // Test for mixed format.
          await selectColumns('Left');
          await gu.setFieldWidgetType('TextBox');
          await selectColumns('Right');
          await gu.setFieldWidgetType('CheckBox');
          await selectColumns('Left', 'Right');
          assert.equal(await gu.getFieldWidgetType(), 'Mixed format');
          // Test that both change when format is changed.
          for (const mode of ['TextBox', 'CheckBox', 'Switch']) {
            await gu.setFieldWidgetType(mode);
            await selectColumns('Left');
            assert.equal(await gu.getFieldWidgetType(), mode);
            await selectColumns('Right');
            assert.equal(await gu.getFieldWidgetType(), mode);
            await selectColumns('Left', 'Right');
            assert.equal(await gu.getFieldWidgetType(), mode);
          }
        } else {
          await selectColumns('Left', 'Right');
          assert.isTrue(await widgetTypeDisabled());
        }
      });
    }
  });

  // Any and Text column are identical in terms of formatting.
  for (const left of ['Text', 'Any']) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn('Left', left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn('Left');
          await removeColumn('Right');
        }
      });
      for (const right of types) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn('Right', right);
          await selectColumns('Left', 'Right');
          if (left === 'Text') {
            if (right === 'Text') {
              assert.isFalse(await widgetTypeDisabled());
            } else {
              assert.isTrue(await widgetTypeDisabled());
            }
          }
          await commonTestsForAny(right);
        });
      }
    });
  }


  describe(`test for Attachment column`, function() {
    beforeEach(async () => {
      await gu.addColumn('Left', 'Attachment');
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn('Left');
        await removeColumn('Right');
      }
    });
    // Test for types that matter (have different set of defaults).
    for (const right of ['Any', 'Attachment']) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn('Right', right);
        await selectColumns('Left', 'Right');
        if (right !== 'Attachment') {
          assert.isTrue(await sliderDisabled());
        } else {
          assert.isFalse(await sliderDisabled());
          // Test it works as expected
          await slider(16); // min value
          assert.equal(await slider(), 16);
          await selectColumns('Left');
          assert.equal(await slider(), 16);
          await selectColumns('Right');
          assert.equal(await slider(), 16);
          // Set max for Right column, left still has minium
          await slider(96); // max value
          await selectColumns('Left', 'Right');
          // When mixed, slider is in between.
          assert.equal(await slider(), (96 - 16) / 2 + 16);
        }
      });
    }
  });
});

async function numModeDisabled() {
  return await hasDisabledSuffix(".test-numeric-mode");
}

async function numSignDisabled() {
  return await hasDisabledSuffix(".test-numeric-sign");
}

async function decimalsDisabled() {
  const min = await hasDisabledSuffix(".test-numeric-min-decimals");
  const max = await hasDisabledSuffix(".test-numeric-max-decimals");
  return min && max;
}

async function numberFormattingDisabled() {
  return (await numModeDisabled()) && (await numSignDisabled()) && (await decimalsDisabled());
}

async function testWrapping(colA: string = 'Left', colB: string = 'Right') {
  await selectColumns(colA, colB);
  await wrap(true);
  assert.isTrue(await wrap());
  assert.isTrue(await colWrap(colA), `${colA} should be wrapped`);
  assert.isTrue(await colWrap(colB), `${colB} should be wrapped`);
  await wrap(false);
  assert.isFalse(await wrap());
  assert.isFalse(await colWrap(colA), `${colA} should not be wrapped`);
  assert.isFalse(await colWrap(colB), `${colB} should not be wrapped`);

  // Test common wrapping.
  await selectColumns(colA);
  await wrap(true);
  await selectColumns(colB);
  await wrap(false);
  await selectColumns(colA, colB);
  assert.isFalse(await wrap());
  await selectColumns(colB);
  await wrap(true);
  assert.isTrue(await wrap());
}

async function testSingleWrapping(colA: string = 'Left', colB: string = 'Right') {
  await selectColumns(colA, colB);
  await wrap(true);
  assert.isTrue(await wrap());
  assert.isTrue(await colWrap(colA), `${colA} should be wrapped`);
  await wrap(false);
  assert.isFalse(await wrap());
  assert.isFalse(await colWrap(colA), `${colA} should not be wrapped`);
}

async function testChoices(colA: string = 'Left', colB: string = 'Right') {
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "No choices configured");

  // Add two choices elements.
  await choiceEditor.edit();
  await choiceEditor.add("one");
  await choiceEditor.add("two");
  await choiceEditor.save();

  // Check that both column have them.
  await selectColumns(colA);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two']);
  await selectColumns(colB);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two']);
  // Check that they are shown normally and not as mixed.
  await selectColumns(colA, colB);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two']);

  // Modify only one.
  await selectColumns(colA);
  await choiceEditor.edit();
  await choiceEditor.add("three");
  await choiceEditor.save();

  // Test that we now have a mix.
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "Mixed configuration");
  // Edit them, but press cancel.
  await choiceEditor.reset();
  await choiceEditor.cancel();
  // Test that we still have a mix.
  assert.equal(await choiceEditor.label(), "Mixed configuration");
  await selectColumns(colA);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two', 'three']);
  await selectColumns(colB);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two']);

  // Reset them back and add records to the table.
  await selectColumns(colA, colB);
  await choiceEditor.reset();
  await choiceEditor.add("one");
  await choiceEditor.add("two");
  await choiceEditor.save();
  await gu.getCell(colA, 1).click();
  await gu.sendKeys("one", Key.ENTER);
  // If this is choice list we need one more enter.
  if (await getColumnType() === 'Choice List') {
    await gu.sendKeys(Key.ENTER);
  }
  await gu.waitForServer();
  await gu.getCell(colB, 1).click();
  await gu.sendKeys("one", Key.ENTER);
  if (await getColumnType() === 'Choice List') {
    await gu.sendKeys(Key.ENTER);
  }
  await gu.waitForServer();
  // Rename one of the choices.
  await selectColumns(colA, colB);
  const undo = await gu.begin();
  await choiceEditor.edit();
  await choiceEditor.rename("one", "one renamed");
  await choiceEditor.save();
  // Test if grid is ok.
  assert.equal(await gu.getCell(colA, 1).getText(), 'one renamed');
  assert.equal(await gu.getCell(colB, 1).getText(), 'one renamed');
  await undo();
  assert.equal(await gu.getCell(colA, 1).getText(), 'one');
  assert.equal(await gu.getCell(colB, 1).getText(), 'one');

  // Test that colors are also treated as different.
  await selectColumns(colA, colB);
  assert.deepEqual(await choiceEditor.read(), ['one', 'two']);
  await selectColumns(colA);
  await choiceEditor.edit();
  await choiceEditor.color("one", red);
  await choiceEditor.save();
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "Mixed configuration");
}

const choiceEditor = {
  async hasReset() {
    return (await driver.find(".test-choice-list-entry-edit").getText()) === "Reset";
  },
  async reset() {
    await driver.find(".test-choice-list-entry-edit").click();
  },
  async label() {
    return await driver.find(".test-choice-list-entry-row").getText();
  },
  async add(label: string) {
    await driver.find(".test-tokenfield-input").click();
    await driver.find(".test-tokenfield-input").clear();
    await gu.sendKeys(label, Key.ENTER);
  },
  async rename(label: string, label2: string) {
    const entry = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${label}']`, 100);
    await entry.click();
    await gu.sendKeys(label2);
    await gu.sendKeys(Key.ENTER);
  },
  async color(token: string, color: string) {
    const label = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${token}']`, 100);
    await label.findClosest(".test-tokenfield-token").find(".test-color-button").click();
    await gu.setFillColor(color);
    await gu.sendKeys(Key.ENTER);
  },
  async read() {
    return await driver.findAll(".test-choice-list-entry-label", e => e.getText());
  },
  async edit() {
    await this.reset();
  },
  async save() {
    await driver.find(".test-choice-list-entry-save").click();
    await gu.waitForServer();
  },
  async cancel() {
    await driver.find(".test-choice-list-entry-cancel").click();
  }
};

async function testAlignment(colA: string = 'Left', colB: string = 'Right') {
  await selectColumns(colA, colB);
  await alignment('left');
  assert.equal(await colAlignment(colA), 'left', `${colA} alignment should be left`);
  assert.equal(await colAlignment(colB), 'left', `${colB} alignment should be left`);
  assert.equal(await alignment(), 'left', 'Alignment should be left');
  await alignment('center');
  assert.equal(await colAlignment(colA), 'center', `${colA} alignment should be center`);
  assert.equal(await colAlignment(colB), 'center', `${colB} alignment should be center`);
  assert.equal(await alignment(), 'center', 'Alignment should be center');
  await alignment('right');
  assert.equal(await colAlignment(colA), 'right', `${colA} alignment should be right`);
  assert.equal(await colAlignment(colB), 'right', `${colB} alignment should be right`);
  assert.equal(await alignment(), 'right', 'Alignment should be right');

  // Now align first column to left, and second to right.
  await selectColumns(colA);
  await alignment('left');
  await selectColumns(colB);
  await alignment('right');
  // And test we don't have alignment set.
  await selectColumns(colA, colB);
  assert.isNull(await alignment());

  // Now change alignment of first column to right, so that we have common alignment.
  await selectColumns(colA);
  await alignment('right');
  await selectColumns(colA, colB);
  assert.equal(await alignment(), 'right');
}

async function colWrap(col: string) {
  const cell = await gu.getCell(col, 1).find(".field_clip");
  let hasTextWrap = await cell.matches("[class*=text_wrapping]");
  if (!hasTextWrap) {
    // We can be in a choice column, where wrapping is done differently.
    hasTextWrap = await cell.matches("[class*=-wrap]");
  }
  return hasTextWrap;
}

async function colAlignment(col: string) {
  // TODO: unify how widgets are aligned.
  let cell = await gu.getCell(col, 1).find(".field_clip");
  let style = await cell.getAttribute('style');
  if (!style) {
    // We might have a choice column, use flex attribute of first child;
    cell = await gu.getCell(col, 1).find(".field_clip > div");
    style = await cell.getAttribute('style');
    // Get justify-content style
    const match = style.match(/justify-content: ([\w-]+)/);
    if (!match) { return null; }
    switch (match[1]) {
      case 'left': return 'left';
      case 'center': return 'center';
      case 'flex-end': return 'right';
    }
  }
  let match = style.match(/text-align: (\w+)/);
  if (!match) {
    // We might be in a choice list column, so check if we have a flex attribute.
    match = style.match(/justify-content: ([\w-]+)/);
  }
  if (!match) { return null; }
  return match[1] === 'flex-end' ? 'right' : match[1];
}

async function wrap(state?: boolean) {
  const buttons = await driver.findAll(".test-tb-wrap-text .test-select-button");
  if (buttons.length !== 1) {
    assert.isUndefined(state, "Can't set wrap");
    return undefined;
  }
  if (await buttons[0].matches('[class*=-selected]')) {
    if (state === false) {
      await buttons[0].click();
      await gu.waitForServer();
      return false;
    }
    return true;
  }
  if (state === true) {
    await buttons[0].click();
    await gu.waitForServer();
    return true;
  }
  return false;
}


// Many controls works the same as any column for wrapping and alignment.
async function commonTestsForAny(right: string) {
  await selectColumns('Left', 'Right');
  if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
    assert.equal(await wrapDisabled(), true);
  } else {
    assert.equal(await wrapDisabled(), false);
    assert.equal(await wrap(), false);
  }
  if (['Toggle', 'Attachment'].includes(right)) {
    assert.equal(await alignmentDisabled(), true);
  } else {
    assert.equal(await alignmentDisabled(), false);
  }
  if (['Integer', 'Numeric'].includes(right)) {
    assert.equal(await alignment(), null);
  } else if (['Toggle', 'Attachment'].includes(right)) {
    // With toggle, alignment is unset.
  } else {
    assert.equal(await alignment(), 'left');
  }
  if (['Toggle', 'Attachment'].includes(right)) {
    // omit tests for alignment
  } else {
    await testAlignment();
  }
  if (['Toggle', 'Date', 'DateTime', 'Attachment'].includes(right)) {
    // omit tests for wrap
  } else if (['Choice'].includes(right)) {
    // Choice column doesn't support wrapping.
    await testSingleWrapping();
  } else {
    await testWrapping();
  }
}

async function selectColumns(col1: string, col2?: string) {
  // Clear selection in grid.
  await driver.executeScript("gristDocPageModel.gristDoc.get().currentView.get().clearSelection();");
  if (col2 === undefined) {
    await gu.selectColumn(col1);
  } else {
    // First make sure we start with col1 selected.
    await gu.selectColumnRange(col1, col2);
  }
}

async function alignmentDisabled() {
  return await hasDisabledSuffix(".test-alignment-select");
}

async function choiceEditorDisabled() {
  return await hasDisabledSuffix(".test-choice-list-entry");
}

async function alignment(value?: 'left' | 'right' | 'center') {
  const buttons = await driver.findAll(".test-alignment-select .test-select-button");
  if (buttons.length !== 3) {
    assert.isUndefined(value, "Can't set alignment");
    return undefined;
  }
  if (value) {
    if (value === 'left') {
      await buttons[0].click();
    }
    if (value === 'center') {
      await buttons[1].click();
    }
    if (value === 'right') {
      await buttons[2].click();
    }
    await gu.waitForServer();
    return;
  }
  if (await buttons[0].matches('[class*=-selected]')) {
    return 'left';
  }
  if (await buttons[1].matches('[class*=-selected]')) {
    return 'center';
  }
  if (await buttons[2].matches('[class*=-selected]')) {
    return 'right';
  }
  return null;
}


async function dateFormatDisabled() {
  const format = await driver.find('[data-test-id=Widget_dateFormat]');
  return await format.matches(".disabled");
}

async function customDateFormatVisible() {
  const control = driver.find('[data-test-id=Widget_dateCustomFormat]');
  return await control.isPresent();
}

async function dateFormat(format?: string) {
  if (!format) {
    return await gu.getDateFormat();
  }
  await driver.find("[data-test-id=Widget_dateFormat]").click();
  await driver.findContent('.test-select-menu li', gu.exactMatch(format)).click();
  await gu.waitForServer();
}

async function widgetTypeDisabled() {
  // Maybe we have selectbox
  const selectbox = await driver.findAll(".test-fbuilder-widget-select .test-select-open");
  if (selectbox.length === 1) {
    return await selectbox[0].matches('.disabled');
  }
  const buttons = await driver.findAll(".test-fbuilder-widget-select > div");
  const allDisabled = await Promise.all(buttons.map(button => button.matches('[class*=-disabled]')));
  return allDisabled.every(disabled => disabled) && allDisabled.length > 0;
}

async function labelDisabled() {
  return (await driver.find(".test-field-label").getAttribute('readonly')) === 'true';
}

async function colIdDisabled() {
  return (await driver.find(".test-field-col-id").getAttribute('readonly')) === 'true';
}

async function hasDisabledSuffix(selector: string) {
  return (await driver.find(selector).matches('[class*=-disabled]'));
}

async function hasDisabledClass(selector: string) {
  return (await driver.find(selector).matches('.disabled'));
}

async function deriveDisabled() {
  return await hasDisabledSuffix(".test-field-derive-id");
}

async function toggleDerived() {
  await driver.find(".test-field-derive-id").click();
  await gu.waitForServer();
}



async function wrapDisabled() {
  return (await driver.find(".test-tb-wrap-text > div").matches('[class*=disabled]'));
}

async function columnTypeDisabled() {
  return await hasDisabledClass(".test-fbuilder-type-select .test-select-open");
}

async function getColumnType() {
  return await driver.find(".test-fbuilder-type-select").getText();
}

async function setFormulaDisabled() {
  return (await driver.find(".test-field-set-formula").getAttribute('disabled')) === 'true';
}

async function formulaEditorDisabled() {
  return await hasDisabledSuffix(".formula_field_sidepane");
}

async function setTriggerDisabled() {
  return (await driver.find(".test-field-set-trigger").getAttribute('disabled')) === 'true';
}

async function refControlsDisabled() {
  return (await hasDisabledClass(".test-fbuilder-ref-table-select .test-select-open")) &&
    (await hasDisabledClass(".test-fbuilder-ref-col-select .test-select-open"));
}

async function setDataDisabled() {
  return (await driver.find(".test-field-set-data").getAttribute('disabled')) === 'true';
}

async function transformSectionDisabled() {
  return (await driver.find(".test-fbuilder-edit-transform").getAttribute('disabled')) === 'true';
}

async function addConditionDisabled() {
  return (await driver.find(".test-widget-style-add-conditional-style").getAttribute('disabled')) === 'true';
}

async function addAnyColumn(name: string) {
  await gu.sendActions([
    ['AddVisibleColumn', 'Table1', name, {}]
  ]);
  await gu.waitForServer();
}

async function removeColumn(...names: string[]) {
  await gu.sendActions([
    ...names.map(name => (['RemoveColumn', 'Table1', name]))
  ]);
  await gu.waitForServer();
}

function maxDecimals(value?: number|null) {
  return modDecimals(".test-numeric-max-decimals input", value);
}

function minDecimals(value?: number|null) {
  return modDecimals(".test-numeric-min-decimals input", value);
}

async function modDecimals(selector: string, value?: number|null) {
  const element = await driver.find(selector);
  if (value === undefined) {
    return parseInt(await element.value());
  } else {
    await element.click();
    if (value !== null) {
      await element.sendKeys(value.toString());
    } else {
      await element.doClear();
    }
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  }
}


async function numMode(value?: 'currency' | 'percent' | 'exp' | 'decimal') {
  const mode = await driver.findAll(".test-numeric-mode");
  if (value !== undefined) {
    if (mode.length === 0) {
      assert.fail("No number format");
    }
    if (value === 'currency') {
      if (await numMode() !== 'currency') {
        await driver.findContent('.test-numeric-mode .test-select-button', /\$/).click();
      }
    } else if (value === 'percent') {
      if (await numMode() !== 'percent') {
        await driver.findContent('.test-numeric-mode .test-select-button', /%/).click();
      }
    } else if (value === 'decimal') {
      if (await numMode() !== 'decimal') {
        await driver.findContent('.test-numeric-mode .test-select-button', /,/).click();
      }
    } else if (value === 'exp') {
      if (await numMode() !== 'exp') {
        await driver.findContent('.test-numeric-mode .test-select-button', /Exp/).click();
      }
    }
    await gu.waitForServer();
  }
  if (mode.length === 0) {
    return undefined;
  }
  const curr = await driver.findContent('.test-numeric-mode .test-select-button', /\$/).matches('[class*=-selected]');
  if (curr) {
    return 'currency';
  }
  const decimal = await driver.findContent('.test-numeric-mode .test-select-button', /,/).matches('[class*=-selected]');
  if (decimal) {
    return 'decimal';
  }
  const percent = await driver.findContent('.test-numeric-mode .test-select-button', /%/).matches('[class*=-selected]');
  if (percent) {
    return 'percent';
  }
  const exp = await driver.findContent('.test-numeric-mode .test-select-button', /Exp/).matches('[class*=-selected]');
  if (exp) {
    return 'exp';
  }
  return null;
}

async function sliderDisabled() {
  return (await driver.find(".test-pw-thumbnail-size").getAttribute('disabled')) === 'true';
}

async function slider(value?: number) {
  if (value !== undefined) {
    await driver.executeScript(`
    document.querySelector('.test-pw-thumbnail-size').value = '${value}';
    document.querySelector('.test-pw-thumbnail-size').dispatchEvent(new Event('change'));
    `);
    await gu.waitForServer();
  }
  return parseInt(await driver.find(".test-pw-thumbnail-size").getAttribute('value'));
}

async function cellColorLabel() {
  // Text actually contains T symbol before.
  const label = await driver.find(".test-cell-color-select .test-color-select").getText();
  return label.replace(/^T/, '').trim();
}

async function headerColorLabel() {
  // Text actually contains T symbol before.
  const label = await driver.find(".test-header-color-select .test-color-select").getText();
  return label.replace(/^T/, '').trim();
}
