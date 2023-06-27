import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('FieldConfigTab.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Hello.grist", true);
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it("should stay open when switching between columns or views", async function() {
    // Add another table to the document.
    await gu.actions.addNewTable();

    await gu.actions.selectTabView('Table1');
    await gu.openSidePane('field');
    var fieldLabel = await $(".test-field-label").wait(assert.isDisplayed).elem();

    await assert.isDisplayed(fieldLabel);
    assert.equal(await fieldLabel.val(), "A");

    // Move cursor to a different column.
    await $("$GridView_columnLabel:nth-child(2)").click();
    assert.equal(await fieldLabel.val(), "B");

    // Switch to another view. The first column should be selected.
    await gu.actions.selectTabView('Table2');

    fieldLabel = $(".test-field-label").elem();
    await assert.isDisplayed(fieldLabel);
    assert.equal(await fieldLabel.val(), "A");
  });

  it("should support changing the column label and id together", async function() {
    await gu.actions.selectTabView('Table1');
    var fieldLabel = await $(".test-field-label").elem();
    await gu.clickCellRC(0, 0); // Move back to the first cell.
    assert.equal(await fieldLabel.val(), "A");
    await $(".test-field-label").sendNewText("foo");
    await gu.waitForServer();

    // Check that both the label and colId changed in the side pane.
    assert.equal(await fieldLabel.val(), "foo");
    await $(".test-field-col-id").wait(async function(el) { return assert.equal(await el.val(), "$foo"); });

    // Check that the label changed among column headers.
    assert.equal(await $("$GridView_columnLabel:nth-child(1)").text(), "foo");
  });

  it("should support changing the column label and id separately", async function() {
    await gu.actions.selectTabView('Table1');
    await $("$GridView_columnLabel:nth-child(2)").click();
    var fieldLabel = $(".test-field-label");
    assert.equal(await fieldLabel.val(), "B");

    // Uncheck the "derive id" checkbox.
    var deriveIdCheckbox = $(".test-field-derive-id");
    assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
    await deriveIdCheckbox.click();
    await gu.waitForServer();
    assert.isFalse(await deriveIdCheckbox.is('[class*=-selected]'));

    // Check that only the label changed in the side pane.
    await fieldLabel.sendNewText("bar");
    await gu.waitForServer();
    assert.equal(await fieldLabel.val(), "bar");
    await $("$GridView_columnLabel:nth-child(2)").wait(async function(el) { return assert.equal(await el.text(), "bar"); });

    // Id should be unchanged, but we should be able to change it now.
    assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2, 3, 4], cols: [1] }),
                     ['', 'world', '', '']);
    assert(await $(".test-field-col-id").val(), "B");
    await $(".test-field-col-id").sendNewText("baz");
    assert(await $(".test-field-col-id").val(), "baz");
    assert.equal(await fieldLabel.val(), "bar");
    assert.equal(await $("$GridView_columnLabel:nth-child(1)").text(), "foo");
    assert.equal(await $("$GridView_columnLabel:nth-child(2)").text(), "bar");

    // Make sure the changing Ids does not effect the data in the column
    assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2, 3, 4], cols: [1] }),
                     ['', 'world', '', '']);
    await assert.hasClass(gu.getCell(0, 1).find('.field_clip'), 'invalid', false);
  });

  describe('Duplicate Labels', async function() {
    let fieldLabel, deriveIdCheckbox;

    beforeEach(() => {
      fieldLabel = $(".test-field-label");
      deriveIdCheckbox = $(".test-field-derive-id");
    });

    it('should allow duplicate labels with underived colIds', async function() {
      // Change column 4 to have the same label as column 1
      await $("$GridView_columnLabel:nth-child(4)").click();
      assert.equal(await fieldLabel.val(), "D");
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
      await deriveIdCheckbox.click();
      await gu.waitForServer();
      assert.isFalse(await deriveIdCheckbox.is('[class*=-selected]'));
      await fieldLabel.sendNewText("foo");
      // Columns 1 and 4 should both be named foo
      await $("$GridView_columnLabel:nth-child(1)").wait(async function(el) { return assert.equal(await el.text(), "foo"); });
      await $("$GridView_columnLabel:nth-child(4)").wait(async function(el) { return assert.equal(await el.text(), "foo"); });
      // But colId should be unchanged
      assert(await $(".test-field-col-id").val(), "D");
    });

    it('should allow duplicate labels with derived colIds', async function() {
      // Now clicking the derive box should be leave the labels the same
      // but the conflicting Id should be sanitized
      await deriveIdCheckbox.click();
      await gu.waitForServer();
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
      await deriveIdCheckbox.click();
      await gu.waitForServer();
      assert.isFalse(await deriveIdCheckbox.is('[class*=-selected]'));
      await $("$GridView_columnLabel:nth-child(1)").scrollIntoView({inline: "end"}).click();
      await $("$GridView_columnLabel:nth-child(1)").wait(async function(el) { return assert.equal(await el.text(), "foo"); });
      assert(await $(".test-field-col-id").val(), "foo");
      await $("$GridView_columnLabel:nth-child(4)").click();
      await $("$GridView_columnLabel:nth-child(4)").wait(async function(el) { return assert.equal(await el.text(), "foo"); });
      assert(await $(".test-field-col-id").val(), "foo2");
    });

    it('should not change the derived id unnecessarly', async function() {
      // Toggling the box should not change the derived Id
      await deriveIdCheckbox.click();
      await gu.waitForServer();
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
      await deriveIdCheckbox.click();
      await gu.waitForServer();
      assert.isFalse(await deriveIdCheckbox.is('[class*=-selected]'));
      assert(await $(".test-field-col-id").val(), "foo2");
    });

    it('should not automatically modify the derived checkbox', async function() {
      // When derived labels are changed to an existing Id, the derived box should remain checked
      // even if the id and label are different
      await $("$GridView_columnLabel:nth-child(1)").scrollIntoView({inline: "end"}).click();
      await $("$GridView_columnLabel:nth-child(1)").wait(async function(el) { return assert.equal(await el.text(), "foo"); });
      assert(await $(".test-field-col-id").val(), "foo");
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
      await fieldLabel.sendNewText("foo2");
      await gu.waitForServer();
      assert.equal(await fieldLabel.val(), "foo2");
      assert(await $(".test-field-col-id").val(), "foo2_2");
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
    });

    it('should allow out of sync colIds to still derive from labels', async function() {
      // Entering a new label should still sync the Id
      await fieldLabel.sendNewText("foobar");
      await gu.waitForServer();
      assert.isTrue(await deriveIdCheckbox.is('[class*=-selected]'));
      await deriveIdCheckbox.click();
      assert(await $(".test-field-col-id").val(), "foobar");
    });
  });

  it("should allow editing column data after column rename", async function() {
    await gu.actions.selectTabView('Table1');
    await $("$GridView_columnLabel:nth-child(3)").click();
    assert.equal(await $(".test-field-label").val(), "C");

    // Switch type to numeric. This makes it easier to tell whether the value actually gets
    // processed by the server.
    await gu.setType('Numeric');
    await $('.test-type-transform-apply').wait().click();
    await gu.waitForServer();
    var cell = await gu.getCellRC(0, 2);
    await cell.click();     // row index 0, column index 2
    await gu.sendKeys('17', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), '17');
    await assert.hasClass(cell.find('.field_clip'), 'invalid', false);

    // Rename the column, make sure we can still type into it, and get results from the server.
    await $(".test-field-label").sendNewText("c2");
    await gu.waitForServer();
    assert.equal(await $("$GridView_columnLabel:nth-child(3)").text(), "c2");
    await gu.waitForServer();
    cell = await gu.getCellRC(0, 2);
    await cell.click();     // row index 0, column index 2
    await gu.sendKeys('23', $.ENTER);
    await gu.waitForServer();
    assert.equal(await cell.text(), '23');
    await assert.hasClass(cell.find('.field_clip'), 'invalid', false);
  });

});
