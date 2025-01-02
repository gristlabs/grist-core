/**
 * Test for action bundling, e.g. when changing column type. Before the action is finalized, the
 * user has a chance to make further changes that are part of the bundle. If any change is
 * attempted that doesn't belong in the bundle, the bundle should be finalized before the change
 * is appled.
 */
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {SQLiteDB} from 'app/server/lib/SQLiteDB';
import fs from 'fs';


describe('BundleActions', function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    const mainSession = await gu.session().login();
    await mainSession.tempNewDoc(cleanup, 'TransformBug');

    // Import a file
    await gu.importFileDialog('./uploads/UploadedData1.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();
  });

  it.skip('bug: bundle is properly finished', async function() {
    // There was a bug in the finalization of the bundle. There was previously a race condition
    // as the finalizer was sending the `RemoveAction(column)` without waiting for the result.
    // So sometimes column was added before removing the transform column. This was causing
    // undo to fail (known bug in grist, adding and removing columns in two tabs and then undoing
    // in one tab doesn't work, as `AddColumn` action is not idempotent, undoing and redoing can
    // result with different PK).

    // I don't have a good way to reproduce it. It can be done by brute force (a while loop)
    // over the next test (on my machine it fails after 3 seconds). So this test is skipped and
    // just a documentation of the bug for later use.

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rollback = await gu.begin();
      // Start a transform.
      await gu.getCell({col: 'Name', rowNum: 1}).click();
      // This does not include a click on the "Apply" button.
      await gu.setType(/Reference/);
      assert.equal(await gu.getCell({col: 'Name', rowNum: 1}).matches('.transform_field'), true);

      // Add a column while inside the transform.
      await driver.find('body').sendKeys(Key.chord(Key.ALT, Key.SHIFT, '='));
      await gu.waitForServer();
      const file = fs.readdirSync(server.testDocDir)[0];
      const fullPath = server.testDocDir + '/' + file;
      // This is sqlite file, open it and read the last id in the _grist_Tables_column.
      const db = await SQLiteDB.openDBRaw(fullPath);
      const rows = await db.get("SELECT id FROM _grist_Tables_column ORDER BY id DESC LIMIT 1");
      await db.close();
      const lastId = rows?.id as number;

      await gu.sendKeys(Key.ESCAPE);

      // if the id == 11 break;
      if (lastId != 9) {
        throw new Error("The RemoveColumn in the ColumnTransform._doFinalize was processed before adding the column");
        // So in the test below, the redo used to fail.
      }
      await rollback();
    }
  });

  it('should complete transform if column is added during it', async function() {
    // Start a transform.
    await gu.getCell({col: 'Name', rowNum: 1}).click();
    // This does not include a click on the "Apply" button.
    await gu.setType(/Reference/);
    assert.equal(await gu.getCell({col: 'Name', rowNum: 1}).matches('.transform_field'), true);

    // Add a column while inside the transform.
    await driver.find('body').sendKeys(Key.chord(Key.ALT, Key.SHIFT, '='));
    await gu.waitForServer();

    // Check there are no user-visible errors at this point.
    assert.equal(await driver.find('.test-notifier-toast-message').isPresent(), false);
    await gu.checkForErrors();

    // Close column-rename textbox.
    await driver.sendKeys(Key.ESCAPE);

    // Check the Name column is no longer being transformed. Cells are invalid because it's now an
    // invalid reference.
    let cell = gu.getCell({col: 'Name', rowNum: 1});
    assert.equal(await cell.matches('.transform_field'), false);
    assert.equal(await cell.find('.field_clip').matches('.invalid'), true);

    // Do something with the new column.
    await driver.sendKeys("HELLO", Key.ENTER);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({col: 'A', rowNums: [1, 2, 3]}), ['HELLO', '', '']);
    await gu.enterFormula('str($Name).upper()');
    assert.deepEqual(await gu.getVisibleGridCells({col: 'A', rowNums: [1, 2, 3]}), ['LILY', 'KATHY', 'KAREN']);

    await gu.checkForErrors();

    // Undo the column changes and the column addition.
    await gu.undo(3);

    // The transform result is still applied
    cell = gu.getCell({col: 'Name', rowNum: 1});
    assert.equal(await cell.find('.field_clip').matches('.invalid'), true);
    assert.equal(await cell.matches('.transform_field'), false);
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");

    // Undo the transform now.
    await gu.undo();

    cell = gu.getCell({col: 'Name', rowNum: 1});
    assert.equal(await cell.find('.field_clip').matches('.invalid'), false);
    assert.equal(await cell.matches('.transform_field'), false);
    assert.deepEqual(await gu.getVisibleGridCells({col: 'Name', rowNums: [1, 2, 3]}), ['Lily', 'Kathy', 'Karen']);
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Text");
    await gu.checkForErrors();

    // For good measure, check that REDO works too.
    await gu.redo(4);
    assert.deepEqual(await gu.getVisibleGridCells({col: 'A', rowNums: [1, 2, 3]}), ['LILY', 'KATHY', 'KAREN']);
    cell = gu.getCell({col: 'Name', rowNum: 1});
    assert.equal(await cell.find('.field_clip').matches('.invalid'), true);
    assert.equal(await cell.matches('.transform_field'), false);
    await cell.click();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");
    await gu.checkForErrors();

    // And back to where we started.
    await gu.undo(4);
  });

  it('should complete transform if a page widget is added during it', async function() {
    // Start a transform.
    await gu.getCell({col: 'Name', rowNum: 1}).click();
    await gu.setType(/Reference/);     // This does not include a click on the "Apply" button.
    assert.equal(await gu.getCell({col: 'Name', rowNum: 1}).matches('.transform_field'), true);

    await gu.addNewSection(/Table/, /New Table/);

    // Check there are no user-visible errors at this point.
    assert.equal(await driver.find('.test-notifier-toast-message').isPresent(), false);
    await gu.checkForErrors();

    // Check that we see two sections.
    assert.deepEqual(await gu.getSectionTitles(), ['UPLOADEDDATA1', 'TABLE2']);
    await gu.getCell({col: 'Name', rowNum: 1, section: "UPLOADEDDATA1"}).click();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Reference");

    // Undo both actions.
    await gu.undo(2);
    assert.deepEqual(await gu.getSectionTitles(), ['UPLOADEDDATA1']);
    await gu.getCell({col: 'Name', rowNum: 1, section: "UPLOADEDDATA1"}).click();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Text");

    assert.equal(await driver.find('.test-notifier-toast-message').isPresent(), false);
    await gu.checkForErrors();
  });
});
