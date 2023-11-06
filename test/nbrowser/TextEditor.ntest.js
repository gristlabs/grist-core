import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('TextEditor.ntest', function() {
  test.setupTestSuite(this);
  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.actions.createNewDoc();
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  async function autoCompleteSelect(options) {
    await gu.sendKeys(options.input);
    const values = await $('.test-ref-editor-item').array().text();
    if (options.keys) {
      await gu.sendKeys(...options.keys);
      await $('.test-ref-editor-item.selected').wait(assert.isPresent, true);
    } else if (options.click) {
      await driver.findContent('.test-ref-editor-item', gu.exactMatch(options.click)).click();
    }
    return values;
  }

  async function autoCompleteWaitForSelection(text, selected) {
    await $('.test-ref-editor-item:contains('+ text +')').wait(assert.hasClass, 'selected', selected);
  }

  it('should allow saving values into new Reference column', async function() {
    await gu.getCellRC(0, 0).wait().click();
    await gu.sendKeys("foo", $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys("bar", $.ENTER);
    await gu.waitForServer();
    await gu.sendKeys("baz", $.ENTER);
    await gu.waitForServer();

    // Add a new section and switch to it.
    await gu.actions.addNewSection('New', 'Table');
    await gu.toggleSidePanel('left', 'close');
    await $(".viewsection_title:contains(TABLE2)").click();
    await gu.getCellRC(0, 0).click();
    await gu.setType('Reference');
    await gu.setRefTable('Table1');
    await gu.setVisibleCol('A');

    // Populate some of the reference column.
    await gu.getCellRC(0, 0).click();

    // Select "foo" from autocomplete dropdown with keyboard.
    await autoCompleteSelect({input: 'f'});
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 0).text(), "foo");

    // Select "bar" from autocomplete dropdown with the mouse.
    await autoCompleteSelect({input: 'b', click: 'bar'});
    await gu.waitForServer();
    await gu.sendKeys($.DOWN);      // Selecting with the mouse saves without moving the cursor
    assert.equal(await gu.getCellRC(1, 0).text(), "bar");

    // Entering an existing value should reference it
    await autoCompleteSelect({input: 'baz'});
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(2, 0).text(), "baz");

    // Select "foo" from autocomplete dropdown with tab.
    await autoCompleteSelect({input: 'foo'});
    await gu.sendKeys($.TAB);  // Select "foo" from autocomplete dropdown with tab.
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(3, 0).text(), "foo");

    // Esc should Cancel.
    await gu.getCellRC(4, 0).click();
    await autoCompleteSelect({input: 'baz'});
    await gu.sendKeys($.ESCAPE);
    assert.equal(await gu.getCellRC(4, 0).text(), "");
  });

  it('should allow adding new values from Reference column', async function() {
    // Select add new from autocomplete dropdown.
    await autoCompleteSelect({input: 'foobar', keys: [$.UP]});
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();
    await $(".viewsection_title:contains(TABLE1)").click();
    assert.equal(await gu.getCellRC(3, 0).text(), "foobar");

    // Add new by tab
    await $(".viewsection_title:contains(TABLE2)").click();
    await gu.getCellRC(4, 0).click();
    await autoCompleteSelect({input: 'foobar1', keys: [$.UP]});
    await gu.sendKeys($.TAB);
    await gu.waitForServer();
    await $(".viewsection_title:contains(TABLE1)").click();
    assert.equal(await gu.getCellRC(4, 0).text(), "foobar1");

    // Add new by click
    await $(".viewsection_title:contains(TABLE2)").click();
    await gu.getCellRC(5, 0).click();
    await autoCompleteSelect({input: 'foobar2', click: 'foobar2'});
    await gu.waitForServer();
    await $(".viewsection_title:contains(TABLE1)").click();
    assert.equal(await gu.getCellRC(5, 0).text(), "foobar2");

    // Cancel with escape
    await $(".viewsection_title:contains(TABLE2)").click();
    await gu.getCellRC(5, 0).click();
    await autoCompleteSelect({input: 'foobar3', keys: [$.UP]});
    await gu.sendKeys($.ESCAPE);
    await gu.waitForServer();
    await gu.waitAppFocus(true);
    await $(".viewsection_title:contains(TABLE1)").click();
    assert.equal(await gu.getCellRC(6, 0).text(), "");

    // Once add new is selected it should not be possible to change the input.
    await $(".viewsection_title:contains(TABLE2)").click();
    await gu.getCellRC(6, 0).click();
    await autoCompleteSelect({input: 'foobar4', keys: [$.UP]});
    await gu.sendKeys("567");
    // Make sure add item loses selection
    await autoCompleteWaitForSelection('foobar4', false);
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(6, 0).text(), "foobar4567");
    await assert.hasClass(gu.getCellRC(6, 0).find('.field_clip'), 'invalid');
    await $(".viewsection_title:contains(TABLE1)").click();
    assert.equal(await gu.getCellRC(6, 0).text(), "");
  });

  async function addColumnRightOf(index) {
    // Add a column. We have to hover over the column header first.
    await gu.openColumnMenu({col: index}, 'Insert column to the right');
    await driver.find('.test-new-columns-menu-add-new').click();
    await gu.waitForServer();
    await gu.sendKeys($.ESCAPE);
  }

  it('should allow saving values into new Date column', async function() {
    // Add another column. We have to hover over the column header first.
    await addColumnRightOf(0);
    await gu.getCellRC(0, 1).click();

    // Convert to Date. No need to "Apply conversion" since it's a new empty column.
    await gu.setType('Date');

    // Enter a new value and check that it's parsed and shows correctly.
    await gu.getCellRC(0, 1).click();
    await gu.sendKeys("2016/04/20", $.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 1).text(), "2016-04-20");
  });

  it('should show formatted values for ReferenceEditor autocomplete', async function() {
    // Set a Reference column to use a displayCol that's a Date, and ensure that properly
    // formatted dates show in its autocomplete.

    // First, fill in a few more dates into Table1.D
    await gu.enterGridValues(1, 1, [['2014-03-14', '2017-05-01', '2016-12-31', '', '2011-07-15']]);

    // Now switch to the section with the Reference column and switch its displayCol to Table1.D.
    await gu.actions.viewSection('TABLE2').selectSection();
    await gu.clickCell({rowNum: 1, col: 0});
    await gu.setVisibleCol('D');

    // Check that the values displayed are properly formatted.
    assert.deepEqual(await gu.getGridValues({rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0]}),
      ['2016-04-20', '2014-03-14', '2017-05-01', '2016-04-20', '[Blank]', '2011-07-15', 'foobar4567']);

    // Check that formatted values are shown in the auto-complete dropdown.
    await gu.clickCell({rowNum: 3, col: 0});
    assert.deepEqual(await autoCompleteSelect({input: '2016', keys: [$.DOWN]}),
      ['2016-04-20', '2016-12-31', '2011-07-15', '2014-03-14', '2017-05-01', '2016']);
    await gu.sendKeys($.ENTER);
    await gu.waitForServer();

    // Check that after selection, the right value is saved, and that it's valid (not AltText).
    let cell = await gu.getCell({rowNum: 3, col: 0});
    assert.equal(await cell.text(), '2016-12-31');
    await assert.hasClass(cell.find('.field_clip'), 'invalid', false);

    // Check that the formatted value is used to start the autocomplete lookup.
    await gu.clickCell({rowNum: 3, col: 0});
    assert.deepEqual(await autoCompleteSelect({input: $.ENTER}),
      ['2016-12-31', '2016-04-20', '2011-07-15', '2014-03-14', '2017-05-01']);
    await gu.sendKeys($.SELECT_ALL, '2017-05-01', $.ENTER);
    await gu.waitForServer();

    // Check that after typing, the right value is saved, and that it's valid (not AltText).
    cell = await gu.getCell({rowNum: 3, col: 0});
    assert.equal(await cell.text(), '2017-05-01');
    await assert.hasClass(cell.find('.field_clip'), 'invalid', false);

    // Switch back to the view section we started from.
    await gu.actions.viewSection('TABLE1').selectSection();
  });


  it('should allow saving values into new Checkbox column', async function() {
    await addColumnRightOf(1);
    await gu.getCellRC(0, 2).click();

    // Convert to Toggle. No need to "Apply conversion" since it's a new empty column.
    await  gu.setType('Toggle');

    // Toggle a value in the new column.
    await gu.getCellRC(1, 2).find('.widget_checkbox').click();
    await gu.waitForServer();

    // To ensure it got saved to the server, convert to text, and check the text.
    await gu.setType('Text');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells(2, [1, 2, 3]),
      ["false", "true", "false"]);
  });

  it('should allow saving values into a new row of a new column', async function() {
    await gu.getColumnHeader('A').scrollIntoView({inline: "end"});
    await addColumnRightOf(0);
    await gu.getCellRC(0, 1).click();
    await gu.setType('Date');

    assert.equal(await gu.getCellRC(6, 1).text(), "");    // Last "add new" row.
    await assert.isPresent(gu.getCellRC(7, 1), false);    // Check that there is no next row.

    await gu.getCellRC(0, 1).click();
    await gu.sendKeys([$.MOD, $.DOWN]);    // Jump to last row.
    await gu.sendKeys("2001/11/23", $.ENTER);
    await gu.waitForServer();

    assert.equal(await gu.getCellRC(6, 1).text(), "2001-11-23");
    await assert.isPresent(gu.getCellRC(7, 1), true);     // Check that there is now one more row.
  });

  it('should allow changing a Date column to/from formula', async function() {
    // What column D (index 1) start off with.
    assert.equal(await gu.getCellRC(0, 1).text(), "");
    assert.equal(await gu.getCellRC(6, 1).text(), "2001-11-23");

    // Replace it with a formula that uses another date column B.
    await gu.getCellRC(0, 1).click();
    await gu.sendKeys('=');
    await $('.test-editor-tooltip-convert').click();      // Convert to a formula
    await gu.sendKeys('$D and $D.replace(day=2)', $.ENTER);
    await gu.waitForServer();

    // Check that it worked.
    assert.equal(await gu.getCellRC(0, 1).text(), "2016-04-02");
    assert.equal(await gu.getCellRC(6, 1).text(), "");

    // Converting it to a data column.
    await gu.clickColumnMenuItem('F', 'Convert formula to data');
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 1).text(), "2016-04-02");
    assert.equal(await gu.getCellRC(6, 1).text(), "");

    // Enter a new value, make sure that works.
    await gu.getCellRC(6, 1).click();
    await gu.sendKeys("2016/05/01", $.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 1).text(), "2016-04-02");
    assert.equal(await gu.getCellRC(6, 1).text(), "2016-05-01");
  });

  // NOTE: This tests a specific bug which prevented moving the editor cursor via clicking.
  // See https://phab.getgrist.com/T326
  it('should allow moving cursor inside the editor via clicking', async function() {
    await gu.clickCellRC(0, 0);
    await gu.sendKeys($.ENTER);
    await gu.waitAppFocus(false);
    // Double click the cell to select all the text. This will fail if the bug is active.
    await driver.withActions(a => a.doubleClick($('.celleditor_text_editor').elem()));
    // Since the text was selected, the new text will replace the old text.
    await gu.sendKeys('abcd', $.ENTER);
    await gu.waitForServer();
    assert.equal(await gu.getCellRC(0, 0).text(), "abcd");
  });
});
