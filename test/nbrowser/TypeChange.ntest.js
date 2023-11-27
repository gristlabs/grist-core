import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

// Helper that returns the cell text prefixed by "!" if the cell is invalid.
async function valText(cell) {
  const isInvalid = await cell.find('.field_clip').hasClass("invalid");
  const text = await cell.getText();
  return (isInvalid ? "!" : "") + text;
}

describe('TypeChange.ntest', function() {
  const cleanup = test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Hello.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should not use transform to convert type for an empty column', async function() {
    await gu.openSidePane('field');
    await gu.getCellRC(0, 0).click();
    await gu.sendKeys([$.ALT, '=']);
    await gu.waitForServer();
    gu.sendKeys($.ESCAPE);

    // Click on new column
    await gu.getCellRC(0, 1).click();

    // Change type
    await gu.userActionsCollect();
    await gu.setType('Numeric');
    await gu.userActionsVerify([["UpdateRecord", "_grist_Tables_column", 7, {"type": "Numeric"}]]);

    // Errors should not be present in converted column
    assert.isFalse(await gu.getCellRC(0, 1).find('.field_clip').hasClass('invalid'));

    // Ensure that column transform is not occurring.
    assert.isFalse(await $('.type_transform_prompt').isPresent());
  });

  it('should use transform to convert type for non-empty columns', async function() {
    // Enter text into numeric column
    await gu.getCellRC(0, 1).click();
    await gu.sendKeys('one', $.ENTER);
    await gu.waitForServer();
    assert.hasClass(await gu.getCellRC(0, 1).find('.field_clip'), 'invalid', true);

    // Change numeric to text
    await gu.userActionsCollect();
    await gu.setType('Text');

    // Accept, check that column is text and has no errors
    await gu.applyTypeConversion();
    assert.hasClass(await gu.getCellRC(0, 1).find('.field_clip'), 'invalid', false);
    await gu.userActionsVerify([
      ["AddColumn", "Table1", "gristHelper_Converted", { type: 'Any' }],
      ["AddColumn", "Table1", "gristHelper_Transform", { type: 'Any' }],
      ["ModifyColumn", "Table1", "gristHelper_Converted", {
        "formula": "",
        "isFormula": false,
        "type": "Text",
        "visibleCol": 0
      }],
      ["ModifyColumn", "Table1", "gristHelper_Transform", {
        "formula": "rec.gristHelper_Converted",
        "isFormula": true,
        "type": "Text",
        "visibleCol": 0
      }],
      ["ConvertFromColumn", "Table1", "F", "gristHelper_Converted", "Text", "", 0],

      // Repeated conversion just before applying
      ["ConvertFromColumn", "Table1", "F", "gristHelper_Converted", "Text", "", 0],

      ["CopyFromColumn", "Table1", "gristHelper_Transform", "F",
        "{\"widget\":\"TextBox\",\"alignment\":\"left\"}"],
      ["RemoveColumn", "Table1", "gristHelper_Transform"],
      ["RemoveColumn", "Table1", "gristHelper_Converted"],
    ]);

    // Check that selected reads text
    await gu.assertType('Text');
  });

  it('should allow cancelling type changes', async function() {
    // Enter bools into text column
    await gu.getCellRC(0, 1).click();
    await gu.sendKeys('false', $.ENTER);
    await gu.getCellRC(1, 1).click();
    await gu.sendKeys('true', $.ENTER);

    // Change text to bool
    await gu.setType('Toggle');

    // Check that column appears bool during transform
    assert.isDisplayed(await gu.getCellRC(1, 1).find('.widget_checkmark').wait(), true);
    assert.isDisplayed(await gu.getCellRC(0, 1).find('.widget_checkmark'), false);
    assert.hasClass(await gu.getCellRC(0, 1).find('.field_clip'), 'invalid', false);

    // Cancel transform, check that column is still text
    await $('.test-type-transform-cancel').wait().click();
    assert.equal(await gu.getCellRC(0, 1).find('.field_clip').text(), 'false');

    // Check that selected reads text
    await gu.assertType('Text');
  });

  it('should allow revising type changes', async function() {
    // Change text to integer
    await gu.setType('Integer');

    // Revise formula to get text length and accept
    await $('.test-type-transform-revise').wait().click();
    await $('.test-type-transform-formula').click();
    await gu.waitAppFocus(false);
    await gu.sendKeys($.SELECT_ALL, $.DELETE, 'return len($F) + 1');

    // Check that updating the type conversion works
    await $('.test-type-transform-update').click();
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 1).find('.field_clip').text(), '6');

    // Check that applying the type conversion without first updating works
    // (the weird formula keeps other tests consistent with past behaviour)
    await $('.test-type-transform-formula').click();
    await gu.waitAppFocus(false);
    await gu.sendKeys($.SELECT_ALL, $.DELETE, 'return len($F.replace("0", "0.0"))');
    await gu.waitForServer();
    await gu.applyTypeConversion();

    // Check that column is integer and has no errors
    assert.equal(await gu.getCellRC(0, 1).find('.field_clip').text(), '5');
    assert.isFalse(await gu.getCellRC(0, 1).find('.field_clip').hasClass('invalid'));
  });

  it('should allow configuring reference changes', async function() {
    // Prepare new table and section
    await gu.actions.addNewSection('New', 'Table');
    await gu.waitForServer();
    await $('.test-viewlayout-section-6').click();
    await gu.addRecord(['green']);
    await gu.addRecord(['blue']);

    // Change type to reference column
    await gu.actions.viewSection('Table1').selectSection();
    await gu.getCellRC(0, 3).click();
    await gu.waitAppFocus(true);
    await gu.sendKeys('blue', $.ENTER);
    await gu.getCellRC(1, 3).click();
    await gu.sendKeys('green', $.ENTER);
    await gu.waitForServer();
    await gu.userActionsCollect();
    await gu.setType('Reference');

    // Assert the correct column is selected and that the formula matches the selected
    assert.equal(await $('.test-fbuilder-ref-table-select .test-select-row').getText(), 'Table2');
    assert.equal(await $('.test-fbuilder-ref-col-select .test-select-row').getText(), 'A');
    await $('.test-type-transform-revise').click();
    var aceText = await gu.getAceText($('.test-type-transform-formula').elem());
    assert.equal(aceText, "rec.gristHelper_Converted");

    // Apply transform and check that field is a reference
    await gu.applyTypeConversion();
    await gu.userActionsVerify([
      ["AddColumn", "Table1", "gristHelper_Converted", { type: 'Any' }],
      ["AddColumn", "Table1", "gristHelper_Transform", { type: 'Any' }],
      ["ModifyColumn", "Table1", "gristHelper_Converted", {
        "formula": "",
        "isFormula": false,
        "type": "Ref:Table2",
        "visibleCol": 9
      }],
      ["ModifyColumn", "Table1", "gristHelper_Transform", {
        "formula": "rec.gristHelper_Converted",
        "isFormula": true,
        "type": "Ref:Table2",
        "visibleCol": 9
      }],
      ["ConvertFromColumn", "Table1", "C", "gristHelper_Converted", "Ref:Table2", "", 9],
      // Set display formula for transform column.
      ["SetDisplayFormula", "Table1", null, 13, "$gristHelper_Transform.A"],

      // Repeated conversion just before applying
      ["ConvertFromColumn", "Table1", "C", "gristHelper_Converted", "Ref:Table2", "", 9],

      ["CopyFromColumn", "Table1", "gristHelper_Transform", "C", "{\"widget\":\"Reference\",\"alignment\":\"left\"}"],
      // We used to unset field display formula, but we don't actually use it during transforms.
      ["RemoveColumn", "Table1", "gristHelper_Transform"],
      ["RemoveColumn", "Table1", "gristHelper_Converted"],
    ]);

    assert.hasClass(await gu.getCellRC(0, 3).find('.field_clip div'), 'test-ref-link-icon');

    // Check conversion back to text
    await gu.setType('Text');
    await $('.test-type-transform-revise').click();
    aceText = await gu.getAceText($('.test-type-transform-formula').elem());
    assert.equal(aceText, 'rec.gristHelper_Converted');
    await gu.applyTypeConversion();
    assert.equal(await gu.getCellRC(0, 3).find('.field_clip').getText(), 'blue');
  });

  it('should allow configuring date and datetime changes', async function() {
    await gu.toggleSidePanel("left", "close");
    await gu.getCellRC(0, 2).scrollIntoView({inline: "end"}).click();
    await gu.sendKeys('4/2/93', $.ENTER);
    await gu.getCellRC(1, 2).click();
    await gu.sendKeys('4/26/16', $.ENTER);

    // Convert to Date
    await gu.setType('Date');
    // Guessed date format M/D/YY
    assert.equal(await gu.dateFormat(), 'Custom');
    assert.equal(await $('$Widget_dateCustomFormat input').val(), 'M/D/YY');
    // Change manually to a more formal date format
    await gu.dateFormat('MM/DD/YYYY');
    assert.equal(await gu.dateFormat(), 'MM/DD/YYYY');
    await gu.waitForServer();
    // Check formula
    await $('.test-type-transform-revise').wait().click();
    var aceText = await gu.getAceText($('.test-type-transform-formula').elem());
    assert.equal(aceText, "rec.gristHelper_Converted");

    // Apply transform and check that field has correct value
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993', '04/26/2016'
    ]);

    // Convert back to text
    await gu.setType('Text');
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993', '04/26/2016'
    ]);

    await gu.getCellRC(0, 2).click();
    await gu.sendKeys($.ENTER, ' 12:00am');
    await gu.getCellRC(1, 2).click();
    await gu.sendKeys($.ENTER, ' 4:00am', $.ENTER);

    // Convert to DateTime and assert formula matches options
    await gu.setType('DateTime');
    await $('.test-tz-autocomplete').click();
    await gu.sendKeys('Los_Ang', $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.test-tz-autocomplete input').val(), 'America/Los_Angeles');
    assert.equal(await gu.dateFormat(), 'MM/DD/YYYY');
    assert.equal(await gu.timeFormat(), 'h:mma');
    await $('.test-type-transform-revise').click();
    aceText = await gu.getAceText($('.test-type-transform-formula').elem());
    assert.equal(aceText, "rec.gristHelper_Converted");

    // Apply transform and check that field has correct value
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993 12:00am', '04/26/2016 4:00am',
    ]);
    assert.equal(await $('.test-tz-autocomplete input').val(), 'America/Los_Angeles');

    // Convert DateTime to Date and check that we are getting the right date.
    await gu.setType('Date');
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993', '04/26/2016'
    ]);

    // Convert Date to DateTime and check that we are getting midnight in selected timezone.
    await gu.setType('DateTime');
    await gu.timeFormat('HH:mm z');
    await gu.waitForServer();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993 00:00 EST', '04/26/2016 00:00 EDT'
    ]);
    await $('.test-tz-autocomplete').click();
    await gu.sendKeys('Los_Ang', $.ENTER);
    await gu.waitForServer();
    assert.equal(await $('.test-tz-autocomplete input').val(), 'America/Los_Angeles');
    assert.equal(await gu.dateFormat(), 'MM/DD/YYYY');
    assert.equal(await gu.timeFormat(), 'HH:mm z');
    await gu.waitForServer();
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2], cols: [2], mapper: valText}), [
      '04/02/1993 00:00 PST', '04/26/2016 00:00 PDT'
    ]);
  });

  it('should trigger a transform when reference table is changed', async function() {
    // Set up conditions for the test
    await gu.actions.viewSection('Table1').selectSection();
    await gu.enterGridValues(2, 3, [['red', 'yellow']]);
    await gu.actions.addNewSection('New', 'Table');
    await gu.actions.viewSection('TABLE3').selectSection();
    await gu.enterGridValues(0, 1, [['yellow', 'red', 'green', 'blue']]);
    await gu.actions.viewSection('Table1').selectSection();
    await gu.clickCellRC(0, 3);
    await gu.openSidePane('field');
    await gu.setType('Reference');
    await gu.setRefTable('Table2');
    await gu.waitForServer();
    await gu.setVisibleCol('A');
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3], mapper: valText}), [
      'blue', 'green', '!red', '!yellow'
    ]);

    // Check that row ids shows 2, 1, (AltText), (AltText)
    await gu.setVisibleCol('Row ID');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['Table2[2]', 'Table2[1]', 'red', 'yellow']);
    await gu.setVisibleCol('A');

    // Should trigger the transform
    await gu.setRefTable('Table3');
    await gu.waitForServer();
    await gu.setVisibleCol('B');
    await assert.isPresent($('.type_transform_prompt'));

    // Transform should follow the format Ref:<oldTable> -> Text -> Ref:<newTable>
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['blue', 'green', 'red', 'yellow']);
    // Check that the cells are no longer invalid.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3], mapper: valText}), [
      'blue', 'green', 'red', 'yellow'
    ]);

    // Check that row ids have changed, despite text remaining the same.
    await gu.setVisibleCol('Row ID');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['Table3[4]', 'Table3[3]', 'Table3[2]', 'Table3[1]']);
  });

  it('should allow undoing a reference transform in one step', async function() {
    await gu.setVisibleCol('B');
    await gu.setType('Text');
    await gu.applyTypeConversion();
    await gu.setType('Reference');
    await gu.applyTypeConversion();
    await gu.undo();
    // Undoing once should return the column to Text with the correct values.
    await gu.assertType('Text');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['blue', 'green', 'red', 'yellow']);
  });

  it('should cancel an in-progress transformation on undo', async function() {
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['blue', 'green', 'red', 'yellow']);
    await gu.setType('Reference');
    await gu.assertType('Reference');
    await assert.isPresent($('.test-type-transform-top'), true);
    await gu.undo();
    await assert.isPresent($('.test-type-transform-top'), false);
    await gu.assertType('Text');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [3]}),
      ['blue', 'green', 'red', 'yellow']);
  });

  // NOTE: This tests a bug fix where integer values not present in the reference
  //  column were mistaken for row ids and converted to row values instead of AltText values.
  it('should properly convert from integer to reference', async function() {
    // Set up conditions for the test
    await gu.actions.viewSection('TABLE3').selectSection();
    await gu.enterGridValues(0, 2, [['3', '3', '4', '1']]);
    await gu.waitForServer();
    await gu.setType('Integer');
    await gu.applyTypeConversion();

    // Begin convert to reference.
    await gu.setType('Reference');
    await gu.assertType('Reference');
    await assert.isPresent($('.test-type-transform-top'), true);

    // Convert to a reference and check that the values are valid and as expected
    // before and after the conversion. The last row should be invalid since there
    // is no matching record in the destination col.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '!1'
    ]);
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '!1'
    ]);
  });

  // NOTE: This tests a bug fix where reference transforms to numeric types gave
  //  error values by default.
  it('should properly convert from reference to integer/numeric', async function() {
    await gu.clickCellRC(0, 2);

    // Convert to an integer and check that the values are valid and as expected before
    // and after the conversion. This ensures that AltText values can be cast back into ints.
    await gu.setType('Integer');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '1'
    ]);
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '1'
    ]);

    // Switch back to a reference column
    await gu.setType('Reference');
    await gu.assertType('Reference');
    await assert.isPresent($('.test-type-transform-top'), true);
    await gu.applyTypeConversion();

    // Convert to numeric and check the values are valid and as expected.
    // This ensures that AltText values can be cast back into floats.
    await gu.setType('Numeric');
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '1'
    ]);
    await gu.applyTypeConversion();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4], cols: [2], mapper: valText}), [
      '3', '3', '4', '1'
    ]);
  });

  // NOTE: This tests a bug fix where numeric types were not properly converted to
  //  boolean values.
  it('should properly convert from integer/numeric to boolean', async function() {
    // Update the Numeric column to include some falsy/truthy numbers and alttext.
    await gu.clickCellRC(0, 2);
    await gu.sendKeys('0');
    await gu.clickCellRC(4, 2);
    await gu.sendKeys('False', $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys('true', $.ENTER);
    await gu.waitForServer();

    // Assert that the values are set up properly.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6], cols: [2], mapper: valText}), [
      '0', '3', '4', '1', '!False', '!true'
    ]);

    // Convert the column to boolean. Assert all the values are valid and as expected.
    await gu.setType('Toggle');
    await gu.applyTypeConversion();
    await gu.setWidget('TextBox');

    // Check that the values have transformed without errors, and are as expected.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6], cols: [2], mapper: valText}), [
      'false', '!3', '!4', 'true', 'false', 'true'
    ]);
    // Check that sorting by the column has the expected effect.
    await gu.openColumnMenu('C');
    await $(`.grist-floating-menu .test-sort-asc`).click();
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6], cols: [2], mapper: valText}), [
      'false', 'false', 'true', 'true', '!3', '!4'
    ]);

    // Undo the widget option and type conversion and assert that the values are properly restored.
    // (but still sorted)
    await gu.undo(2);
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6], cols: [2], mapper: valText}), [
      '0', '1', '3', '4', '!False', '!true'
    ]);
  });
});
