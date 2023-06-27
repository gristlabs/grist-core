/* global window */

import { assert, driver } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

describe('NewDocument.ntest', function() {
  test.setupTestSuite(this);

  before(async function() {
    await gu.supportOldTimeyTestCode();
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should create new Untitled document', async function() {
    this.timeout(10000);
    await gu.actions.createNewDoc('Untitled');
    assert.equal(await gu.actions.getDocTitle(), 'Untitled');
    assert.equal(await driver.getTitle(), 'Untitled - Grist');
    assert.equal(await $('.active_section .test-viewsection-title').wait().text(), 'TABLE1');
    await gu.waitForServer();
  });

  it('should start with a 1x3 grid', async function() {
    await $('.record.record-add').wait();
    assert.lengthOf(await $('.grid_view_data .record:not(.column_names)').array(), 1, 'should have 1 row ("add" row)');
    assert.lengthOf(await $('.column_names .column_name').array(), 4, 'should have 3 columns and 1 "add" column');
  });

  it('should have first cell selected', async function() {
    assert.isDisplayed(await gu.getCellRC(0, 0).find('.active_cursor'));
  });

  it('should open notify toasts on errors', async function() {
    // Verify that uncaught exceptions and errors from server cause the notifications box to open.

    // For a plain browser error, we attach an error-throwing handler to click-on-logo.
    await driver.executeScript(
      'setTimeout(() => window.gristApp.testTriggerError("Our fake error"))', 0);

    // Wait for the notifications window to open and check it has the error we expect.
    await $('.test-notifier-toast-message').wait(1, assert.isDisplayed);
    assert.match(await $('.test-notifier-toast-message').last().text(), /Our fake error/);

    // Close the notifications window.
    await $(".test-notifier-toast-close").click();
    await assert.isPresent($('.test-notifier-toast-message'), false);

    // Try a server command that should fail. We need a reasonble timeout for executeAsyncScript.
    await driver.manage().setTimeouts({script: 500});
    let result = await driver.executeAsyncScript(() => {
      var cb = arguments[arguments.length - 1];
      window.gristApp.comm.getDocList()
      .then(
        newName => cb("unexpected success"),
        err => { cb(err.toString()); throw err; }
      );
    });
    assert.match(result, /Unknown method getDocList/);

    // Now make sure the notifications window is open and has the error we expect.
    await assert.isDisplayed($('.test-notifier-toast-message'));
    assert.match(await $('.test-notifier-toast-message').last().text(), /Unknown method getDocList/);

    // Close the notifications window.
    await $(".test-notifier-toast-close").click();
    await assert.isPresent($('.test-notifier-toast-message'), false);

    assert.deepEqual(await driver.executeScript(() => window.getAppErrors()),
      ['Our fake error', 'Unknown method getDocList']);
    await driver.executeScript(
      'setTimeout(() => window.gristApp.topAppModel.notifier.clearAppErrors())');
  });

  describe('Cell editing', function() {

    it('should add rows on entering new data', async function() {
      assert.equal(await gu.getGridRowCount(), 1);
      await gu.getCellRC(0, 0).click();
      await gu.sendKeys('hello', $.ENTER);
      await gu.waitForServer();
      await gu.getCellRC(1, 1).click();
      await gu.sendKeys('world', $.ENTER);
      await gu.waitForServer();
      assert.equal(await gu.getGridRowCount(), 3);
    });

    it('should edit on Enter, cancel on Escape, save on Enter', async function() {
      var cell_1_b = gu.getCellRC(0, 1);
      assert.equal(await cell_1_b.text(), '');
      await cell_1_b.click();

      await gu.sendKeys($.ENTER);
      await $('.test-widget-text-editor').wait();
      await gu.sendKeys('foo', $.ESCAPE);
      await gu.waitForServer();
      assert.equal(await cell_1_b.text(), '');

      await gu.sendKeys($.ENTER);
      await $('.test-widget-text-editor').wait();
      await gu.sendKeys('bar', $.ENTER);
      await gu.waitForServer();
      assert.equal(await cell_1_b.text(), 'bar');
    });

    it('should append to cell with content on Enter', async function() {
      var cell_1_a = gu.getCellRC(0, 0);
      assert.equal(await cell_1_a.text(), 'hello');
      await cell_1_a.click();

      await gu.sendKeys($.ENTER);
      await $('.test-widget-text-editor').wait();
      assert.equal(await $('.test-widget-text-editor textarea').val(), 'hello');
      await gu.sendKeys(', world!', $.ENTER);
      await gu.waitForServer();

      assert.equal(await cell_1_a.text(), 'hello, world!');
    });

    it('should clear data in selected cells on Backspace and Delete', async function() {
      let testDelete = async function(delKey) {
        // should clear a single cell
        var cell_1_a = gu.getCellRC(0, 0);
        await cell_1_a.click();
        await gu.sendKeys('A1', $.ENTER);
        await gu.waitForServer();
        assert.equal(await cell_1_a.text(), 'A1');
        await cell_1_a.click();
        await gu.sendKeys(delKey);
        await gu.waitForServer();
        assert.equal(await cell_1_a.text(), '');

        // should clear a selection of cells
        await gu.enterGridValues(0, 0, [['A1', 'A2'], ['B1', 'B2']]);
        await gu.waitForServer();
        assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2], cols: [0, 1] }), ['A1', 'B1', 'A2', 'B2']);
        await cell_1_a.click();
        await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN], delKey);
        await gu.waitForServer();
        assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2], cols: [0, 1] }), ['', '', '', '']);

        // should clear a selection of cells with a formula column
        await gu.enterGridValues(0, 0, [['A1', 'A2'], ['B1', 'B2']]);
        await gu.clickCellRC(0, 2);
        await gu.sendKeys('=', '$A', $.ENTER);
        await gu.waitForServer();
        assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2], cols: [0, 1, 2] }),
                         ['A1', 'B1', 'A1', 'A2', 'B2', 'A2']);
        await gu.clickCellRC(0, 1);
        await gu.sendKeys([$.SHIFT, $.RIGHT], [$.SHIFT, $.DOWN], delKey);
        await gu.waitForServer();
        assert.deepEqual(await gu.getGridValues({ rowNums: [1, 2], cols: [0, 1, 2] }),
                         [ 'A1', '', 'A1', 'A2', '', 'A2' ]);
      };
      await testDelete($.BACK_SPACE);
      await testDelete($.DELETE);
    });
  });
});
