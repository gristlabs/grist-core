/**
 * Test of the Importer dialog (part 1), for imports inside an open doc.
 * (See Import.ts for tests from the DocMenu page.)
 */
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {getColumnMatchingRows, getParseOptionInput, getPreviewDiffCellValues,
        openTableMapping, waitForColumnMapping, waitForDiffPreviewToLoad} from 'test/nbrowser/importerTestUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('Importer', function() {
  this.timeout(70000); // Imports can take some time, especially in tests that import larger files.
  const cleanup = setupTestSuite();

  let docUrl: string|undefined;

  beforeEach(async function() {
    // Log in and import a sample document. If this is already done, we can skip these tests, to
    // have tests go faster. Each successful test case should leave the document unchanged.
    if (!docUrl || !await gu.testCurrentUrl(docUrl)) {
      const session = await gu.session().teamSite.login();
      // TODO: tests check colors literally, so need to be in
      // light theme - but calling gu.setGristTheme results in
      // some problems so right now if you are a dev you just
      // need to run these tests in light mode, sorry.
      await session.tempDoc(cleanup, 'Hello.grist');
      docUrl = await driver.getCurrentUrl();
    }
  });

  afterEach(() => gu.checkForErrors());

  it('should show correct preview', async function() {
    await gu.importFileDialog('./uploads/UploadedData1.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
    assert.lengthOf(await driver.findAll('.test-importer-source'), 1);

    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3]),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    // Check that the preview table cannot be edited by double-clicking a cell or via keyboard.
    const cell = await (await gu.getPreviewCell(0, 1)).doClick();
    await driver.withActions(a => a.doubleClick(cell));
    assert(await driver.find(".default_editor.readonly_editor").isPresent());
    await gu.sendKeys(Key.ESCAPE);
    assert.isFalse(await driver.find(".default_editor.readonly_editor").isPresent());
    await gu.sendKeys(Key.DELETE);
    await gu.waitForServer();
    assert.equal(await cell.getText(), 'Lily');

    // Check that the column matching section is not shown for new tables.
    assert.isFalse(await driver.find('.test-importer-column-match-options').isPresent());

    // Check that the preview table doesn't show formula icons in cells.
    assert.isFalse(await cell.find('.formula_field').isPresent());

    // Check that we have "Import Options" link and click it.
    assert.equal(await driver.find('.test-importer-options-link').isPresent(), true);
    await driver.find('.test-importer-options-link').click();

    // Check that initially we see a button "Close" (nothing to update)
    assert.equal(await driver.findWait('.test-parseopts-back', 500).getText(), 'Close');
    assert.equal(await driver.find('.test-parseopts-update').isPresent(), false);

    // After a change to parse options, button should change to 'Update Preview'
    await getParseOptionInput(/Field separator/).doClear().sendKeys("|");
    assert.equal(await driver.findWait('.test-parseopts-update', 500).getText(), 'Update preview');
    assert.equal(await driver.find('.test-parseopts-back').isPresent(), false);

    // Changing the parse option back to initial state reverts the button back too.
    await getParseOptionInput(/Field separator/).doClear().sendKeys(",");
    assert.equal(await driver.findWait('.test-parseopts-back', 500).getText(), 'Close');
    assert.equal(await driver.find('.test-parseopts-update').isPresent(), false);

    // ensure that option 'First row contains headers' is checked if headers were guessed
    let useHeaders = await getParseOptionInput(/First row/);
    assert.equal(await useHeaders.getAttribute('checked'), 'true');

    // Uncheck the option and update the preview.
    await useHeaders.click();
    assert.equal(await useHeaders.getAttribute('checked'), null);
    await driver.find('.test-parseopts-update').click();
    await gu.waitForServer();

    // Ensure that column names become the first row in preview data.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3, 4]),
      [ 'Name', 'Phone', 'Title',
        'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    // Check the option again and update the preview.
    await driver.find('.test-importer-options-link').click();
    useHeaders = await getParseOptionInput(/First row/);
    assert.equal(await useHeaders.getAttribute('checked'), null);
    await useHeaders.click();
    await driver.find('.test-parseopts-update').click();
    await gu.waitForServer();

    // Ensure that column names are used as headers again.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3]),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    // Right-click a column header, to ensure we don't get a JS error in this case.
    const colHeader = await driver.findContent('.test-importer-preview .column_name', /Name/);
    await driver.withActions(actions => actions.contextClick(colHeader));
    await gu.checkForErrors();

    // Change Field separator and update the preview.
    await driver.find('.test-importer-options-link').click();
    await getParseOptionInput(/Field separator/).doClick().sendKeys("|");
    assert.equal(await getParseOptionInput(/Field separator/).value(), "|");
    assert.equal(await getParseOptionInput(/Line terminator/).value(), "\\n");
    await driver.find('.test-parseopts-update').click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getPreviewContents([0], [1, 2, 3]),
      [ 'Lily,Jones,director',
        'Kathy,Mills,student',
        'Karen,Gold,professor' ]);

    // Close the dialog.
    await driver.find('.test-modal-cancel').click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);

    // No new pages should be present.
    assert.deepEqual(await gu.getPageNames(), ['Table1']);
  });

  it('should show correct preview for multiple tables', async function() {
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 8000).isPresent(), true);
    assert.lengthOf(await driver.findAll('.test-importer-source'), 2);
    assert.equal(await driver.find('.test-importer-source-selected .test-importer-from').getText(),
      'UploadedData1.csv');

    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3]),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    // Select another table
    await driver.findContent('.test-importer-from', /UploadedData2/).click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-importer-source-selected .test-importer-from').getText(),
      'UploadedData2.csv');
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]),
      [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
        'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
        'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
        'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
        'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
        'BUS540',      'Capstone',            '',                    '01/13/2021',      '' ]);

    // Check that changing a parse option (Field Separator to "|") affects both tables.
    await driver.find('.test-importer-options-link').click();
    await getParseOptionInput(/Field separator/).doClick().sendKeys("|");
    await driver.find('.test-parseopts-update').click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getPreviewContents([0], [1, 2, 3]),
      [ 'Lily,Jones,director',
        'Kathy,Mills,student',
        'Karen,Gold,professor' ]);

    await driver.findContent('.test-importer-from', /UploadedData2/).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getPreviewContents([0], [1, 2, 3, 4, 5, 6]),
      [ 'BUS100,Intro to Business,,01/13/2021,false',
        'BUS102,Business Law,Nathalie Patricia,01/13/2021,false',
        'BUS300,Business Operations,Michael Rian,01/14/2021,false',
        'BUS301,History of Business,Mariyam Melania,01/14/2021,false',
        'BUS500,Ethics and Law,Filip Andries,01/13/2021,false',
        'BUS540,Capstone,,01/13/2021,true' ]);

    // Close the dialog.
    await driver.find('.test-modal-cancel').click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);
  });

  it('should not show preview for single empty file', async function() {
    await gu.importFileDialog('./uploads/UploadedDataEmpty.csv');
    assert.match(await driver.findWait('.test-importer-error', 1000).getText(),
      /Import failed: No data was imported/);

    await driver.find('.test-modal-cancel').click();
    await gu.waitForServer();
  });

  it('should not show preview for empty file when importing with non empty files', async function() {
    await gu.importFileDialog(
      './uploads/UploadedData1.csv,./uploads/UploadedData2.csv,./uploads/UploadedDataEmpty.csv');

    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

    // Ensure that there are no empty tables shown.
    assert.deepEqual(await driver.findAll('.test-importer-from', (el) => el.getText()),
      ['UploadedData1.csv', 'UploadedData2.csv']);

    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3]),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    await driver.findContent('.test-importer-from', /UploadedData2/).click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]),
      [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
        'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
        'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
        'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
        'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
        'BUS540',      'Capstone',            '',                    '01/13/2021',      '' ]);

    await driver.find('.test-modal-cancel').click();
    await gu.waitForServer();
  });

  it('should finish import into an existing table', async function() {
    // First import the file into a new table, which is the default import action.
    await gu.importFileDialog('./uploads/UploadedData1.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4], cols: [0, 1, 2] }),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor',
        '', '', '']);
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'UploadedData1']);

    // Now import the same file again, choosing the same table as the first time.
    await gu.importFileDialog('./uploads/UploadedData1.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
    await driver.findContent('.test-importer-target-existing-table', /UploadedData1/).click();
    await gu.waitForServer();

    // The preview content should be the same, since all columns match.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2], [1, 2, 3]),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    await waitForColumnMapping();
    assert.deepEqual(await getColumnMatchingRows(), [
      { destination: 'Name', source: 'Name' },
      { destination: 'Phone', source: 'Phone' },
      { destination: 'Title', source: 'Title' },
    ]);

    // Complete this second import.
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4, 5, 6, 7], cols: [0, 1, 2] }),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor',
        'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor',
        '', '', '']);
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'UploadedData1']);

    // Undo the import
    await gu.undo(2);

    // Ensure that imported table is removed, and we are back to the original one.
    assert.deepEqual(await gu.getPageNames(), ['Table1']);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1], cols: [0, 1, 2] }),
      [ 'hello', '', '']);
  });

  it('should finish import multiple files', async function() {
    // Import two files together.
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    await driver.findWait('.test-modal-confirm', 2000).click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getPageNames(), ['Table1', 'UploadedData1', 'UploadedData2']);
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2], rowNums: [1, 2, 3]}),
      [ 'Lily', 'Jones', 'director',
        'Kathy', 'Mills', 'student',
        'Karen', 'Gold', 'professor' ]);

    await gu.getPageItem('UploadedData2').click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5, 6]}),
    [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
      'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
      'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
      'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
      'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
      'BUS540',      'Capstone',            '',                    '01/13/2021',      '' ]);

    // Undo and check that we are back to the original state.
    await gu.undo();
    assert.deepEqual(await gu.getPageNames(), ['Table1']);
    assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1], cols: [0, 1, 2] }),
      [ 'hello', '', '']);
  });

  it('should import empty dates', async function() {
    await gu.importFileDialog('./uploads/EmptyDate.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

    // Finish import and check that the dialog gets closed.
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);

    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: [0, 1]}),
      [ "Bob", "2018-01-01",
        "Alice", "",
        "Carol", "2017-01-01" ]);

    assert.deepEqual(await gu.getPageNames(), ['Table1', 'EmptyDate']);

    // Add a new column, with a formula to examine the first.
    await gu.openColumnMenu('Birthday', 'Insert column to the right');
    await driver.find('.test-new-columns-menu-add-new').click();
    await gu.waitForServer();
    await driver.sendKeys(Key.ESCAPE);
    await gu.getCell({col: 2, rowNum: 1}).click();
    await driver.sendKeys('=type($Birthday).__name__', Key.ENTER);
    await gu.waitForServer();
    // Ensure that there is no ValueError in second row
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: [0, 1, 2]}),
      [ "Bob",    "2018-01-01",   "date",
        "Alice",  "",             "NoneType",
        "Carol",  "2017-01-01",   "date" ]);
  });

  it('should finish import xlsx file', async function() {
    await gu.importFileDialog('./uploads/homicide_rates.xlsx');
    assert.equal(await driver.findWait('.test-importer-preview', 5000).isPresent(), true);
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer(5000);
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);
    // Look at a small subset of the imported table.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: [0, 1, 2]}),
                     [ 'Africa', 'Eastern Africa', 'Burundi',
                       'Africa', 'Eastern Africa', 'Burundi',
                       'Africa', 'Eastern Africa', 'Comoros']);
  });

  it('should import correctly in prefork mode', async function() {
    await driver.get(`${docUrl}/m/fork`);
    await gu.waitForDocToLoad();

    await gu.importFileDialog('./uploads/homicide_rates.xlsx');
    assert.equal(await driver.findWait('.test-importer-preview', 5000).isPresent(), true);
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer(5000);
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);
    // Look at a small subset of the imported table.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [1, 2, 3], cols: [0, 1, 2]}),
                     [ 'Africa', 'Eastern Africa', 'Burundi',
                       'Africa', 'Eastern Africa', 'Burundi',
                       'Africa', 'Eastern Africa', 'Comoros']);
    await driver.get(`${docUrl}`);
    await gu.acceptAlert();
    await gu.waitForDocToLoad();
  });

  it('should support importing into on-demand tables', async function() {
    // Mark EmptyDate as on-demand.
    await gu.getPageItem('EmptyDate').click();
    await gu.waitForServer();
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-config-data').click();
    await driver.find('[data-test-id=ViewConfig_advanced').click();
    await driver.find('[data-test-id=ViewConfig_onDemandBtn').click();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();
    await gu.waitForDocToLoad();

    // Import EmptyDate.csv into EmptyDate and check the import was successful.
    await gu.importFileDialog('./uploads/EmptyDate.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 5000).isPresent(), true);
    await driver.findContent('.test-importer-target-existing-table', /EmptyDate/).click();
    await gu.waitForServer();
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer(5000);
    assert.equal(await driver.find('.test-importer-dialog').isPresent(), false);

    // Check that the imported file contents were added to the end of EmptyDate.
    assert.deepEqual(await gu.getVisibleGridCells({rowNums: [4, 5, 6], cols: [0, 1]}),
      [ "Bob", "2018-01-01",
        "Alice", "",
        "Carol", "2017-01-01" ]);
    assert.equal(await gu.getGridRowCount(), 7);
  });

  describe('when updating existing records', async function() {
    it('should populate merge columns/fields menu with columns from preview', async function() {
      // First import a file into a new table, so that we have a base for merging.
      await gu.importFileDialog('./uploads/UploadedData1.csv');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();

      // Now import the same file again.
      await gu.importFileDialog('./uploads/UploadedData1.csv');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Check that the 'Update existing records' checkbox is not visible (since destination is 'New Table').
      assert.isNotTrue(await driver.find('.test-importer-update-existing-records').isPresent());
      assert.isNotTrue(await driver.find('.test-importer-merge-fields-select').isPresent());
      assert.isNotTrue(await driver.find('.test-importer-merge-fields-message').isPresent());

      // Change the destination to the table we created earlier ('UploadedData1').
      await driver.findContent('.test-importer-target-existing-table', /UploadedData1/).click();
      await gu.waitForServer();

      // Check that the 'Update existing records' checkbox is now visible and unchecked.
      assert(await driver.find('.test-importer-update-existing-records').isPresent());
      assert.isNotTrue(await driver.find('.test-importer-merge-fields-select').isPresent());
      assert.isNotTrue(await driver.find('.test-importer-merge-fields-message').isPresent());

      // Click 'Update existing records' and verify that additional merge options are shown.
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      assert.equal(
        await driver.find('.test-importer-merge-fields-message').getText(),
        'Merge rows that match these fields:'
      );
      assert.equal(
        await driver.find('.test-importer-merge-fields-select').getText(),
        'Select fields to match on'
      );

      // Open the field select menu and check that all the preview table columns are available options.
      await driver.find('.test-importer-merge-fields-select').click();
      assert.deepEqual(
        await driver.findAll('.test-multi-select-menu .test-multi-select-menu-option-text', e => e.getText()),
        ['Name', 'Phone', 'Title']
      );

      // Close the field select menu.
      await gu.sendKeys(Key.ESCAPE);
    });

    it('should display an error when clicking Import with no merge fields selected', async function() {
      // No merge fields are currently selected. Click Import and check that nothing happened.
      await driver.find('.test-modal-confirm').click();
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Check that the merge field select button has a red outline.
      assert.match(
        await driver.find('.test-importer-merge-fields-select').getCssValue('border'),
        /solid rgb\(208, 2, 27\)/
      );

      // Select a merge field, and check that the red outline is gone.
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Name/
      ).click();
      assert.match(
        await driver.find('.test-importer-merge-fields-select').getCssValue('border'),
        /solid rgb\(217, 217, 217\)/
      );
      // Hide dropdown
      await gu.sendKeys(Key.ESCAPE);

      await gu.checkForErrors();
    });


    it('should not throw an error when a column in the preview is clicked', async function() {
      // A bug was previosuly causing an error to be thrown whenever a column header was
      // clicked while merge columns were set.
      await driver.findContent('.test-importer-preview .column_name', /Name/).click();
      await gu.checkForErrors();
    });

    it('should merge fields of matching records when Import is clicked', async function() {
      // The 'Name' field is selected as the only merge field. Click Import.
      assert.equal(await driver.find('.test-importer-merge-fields-select').getText(), 'Name');
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();

      // Check that the destination table is unchanged since we imported the same file.
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4], cols: [0, 1, 2] }),
        [ 'Lily', 'Jones', 'director',
          'Kathy', 'Mills', 'student',
          'Karen', 'Gold', 'professor',
          '', '', ''
        ]
      );

      // Undo the import, and check that the destination table is still unchanged.
      await gu.undo();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4], cols: [0, 1, 2] }),
        [ 'Lily', 'Jones', 'director',
          'Kathy', 'Mills', 'student',
          'Karen', 'Gold', 'professor',
          '', '', ''
        ]
      );

      // Import from another file containing some duplicates (with new values).
      await gu.importFileDialog('./uploads/UploadedData1Extended.csv');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
      await driver.findContent('.test-importer-target-existing-table', /UploadedData1/).click();
      await gu.waitForServer();

      // Set the merge fields to 'Name' and 'Phone'.
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Name/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Phone/
      ).click();

      // Close the merge fields menu.
      await gu.sendKeys(Key.ESCAPE);
      assert.equal(await driver.find('.test-importer-merge-fields-select').getText(), 'Name, Phone');

      // Check the preview shows a diff of the changes importing will make.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2], [1, 2, 3, 4, 5, 6]),
        [ 'Lily', 'Jones', ['director', 'student', undefined],
          'Kathy', 'Mills', ['student', 'professor', undefined],
          'Karen', 'Gold', ['professor', 'director', undefined],
          [undefined, 'Michael', undefined], [undefined, 'Smith', undefined], [undefined, 'student', undefined],
          [undefined, 'Lily', undefined], [undefined, 'James', undefined], [undefined, 'student', undefined],
          '', '', '',
        ]
      );

      // Complete the import, and verify that incoming data was merged into matching records in UploadedData1.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4, 5, 6], cols: [0, 1, 2] }),
        [ 'Lily', 'Jones', 'student',
          'Kathy', 'Mills', 'professor',
          'Karen', 'Gold', 'director',
          'Michael', 'Smith', 'student',
          'Lily', 'James', 'student',
          '', '', ''
        ]
      );

      // Undo the import, and check the table is back to how it was pre-import.
      await gu.undo();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4], cols: [0, 1, 2] }),
        [ 'Lily', 'Jones', 'director',
          'Kathy', 'Mills', 'student',
          'Karen', 'Gold', 'professor',
          '', '', ''
        ]
      );
    });

    it('should support merging multiple CSV files into multiple tables', async function() {
      // Import a second table, so we have 2 destinations to incrementally import into.
      await gu.importFileDialog('./uploads/UploadedData2.csv');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();

      // Now import new versions of both files together.
      await gu.importFileDialog('./uploads/UploadedData1Extended.csv,./uploads/UploadedData2Extended.csv');

      // For UploadedData1Extended.csv, check 'Update existing records', but don't pick any merge fields yet.
      await driver.findContent('.test-importer-target-existing-table', /UploadedData1/).click();

      await gu.waitForServer();
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();

      // Try to click on UploadedData2.csv.
      await driver.findContent('.test-importer-source', /UploadedData2Extended.csv/).click();

      // Check that it failed, and that the merge fields select button is outlined in red.
      assert.match(
        await driver.find('.test-importer-merge-fields-select').getCssValue('border'),
        /solid rgb\(208, 2, 27\)/
      );
      assert.equal(
        await driver.find('.test-importer-source-selected .test-importer-from').getText(),
        'UploadedData1Extended.csv'
      );

      // Now pick the merge fields, and check that the preview diff looks correct.
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Name/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Phone/
      ).click();
      await gu.sendKeys(Key.ESCAPE);

      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2], [1, 2, 3, 4, 5, 6]),
        [ 'Lily', 'Jones', ['director', 'student', undefined],
          'Kathy', 'Mills', ['student', 'professor', undefined],
          'Karen', 'Gold', ['professor', 'director', undefined],
          [undefined, 'Michael', undefined], [undefined, 'Smith', undefined], [undefined, 'student', undefined],
          [undefined, 'Lily', undefined], [undefined, 'James', undefined], [undefined, 'student', undefined],
          '', '', '',
        ]
      );

      // Check that clicking UploadedData2 now works.
      await driver.findContent('.test-importer-source', /UploadedData2Extended.csv/).click();
      await gu.waitForServer();
      await driver.findContent('.test-importer-target-existing-table', /UploadedData2/).click();
      await gu.waitForServer();
      assert.equal(
        await driver.find('.test-importer-source-selected .test-importer-from').getText(),
        'UploadedData2Extended.csv'
      );

      // Set the merge fields for UploadedData2 to 'CourseId'.
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /CourseId/
      ).click();

      // Close the merge fields menu.
      await gu.sendKeys(Key.ESCAPE);

      assert.equal(await driver.find('.test-importer-merge-fields-select').getText(), 'CourseId');

      // Check that the preview diff looks correct for UploadedData2.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8, 9]),
        [ 'BUS100',      'Intro to Business',   [undefined, 'Mariyam Melania', undefined], '01/13/2021', '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',       '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',       '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',       '',
          'BUS500',      [undefined, undefined, 'Ethics and Law'],     'Filip Andries',    '01/13/2021', '',
          [undefined, 'BUS501', undefined], [undefined, 'Marketing', undefined], [undefined, 'Michael Rian', undefined],
            [undefined, '01/13/2021', undefined], [undefined, 'false', undefined],
          [undefined, 'BUS539', undefined], [undefined, 'Independent Study', undefined],   '',
            [undefined, '01/13/2021', undefined], [undefined, 'true', undefined],
          'BUS540',      'Capstone',            '',                    '01/13/2021',      ['true', 'false', undefined],
          '', '', '', '', ''
        ]
      );

      // Complete the import, and verify that incoming data was merged into both UploadedData1 and UploadedData2.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'EmptyDate',
        'Homicide counts and rates (2000',
        'Sheet1',
        'UploadedData1',
        'UploadedData2'
      ]);

      // Check the contents of UploadedData1.
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4, 5, 6], cols: [0, 1, 2] }),
        [ 'Lily', 'Jones', 'student',
          'Kathy', 'Mills', 'professor',
          'Karen', 'Gold', 'director',
          'Michael', 'Smith', 'student',
          'Lily', 'James', 'student',
          '', '', ''
        ]
      );

      // Check the contents of UploadedData2.
      await gu.getPageItem('UploadedData2').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5, 6, 7, 8, 9]}),
        [ 'BUS100',      'Intro to Business',   'Mariyam Melania',     '01/13/2021',      '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
          'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
          'BUS540',      'Capstone',            '',                    '01/13/2021',      '',
          'BUS501',      'Marketing',           'Michael Rian',        '01/13/2021',      '',
          'BUS539',      'Independent Study',   '',                    '01/13/2021',      '',
          '',            '',                    '',                    '',                '' ]);
    });

    it('should support merging multiple Excel sheets into multiple tables', async function() {
      this.timeout(90000);

      // Import an Excel file with multiple sheets into new tables.
      await gu.importFileDialog('./uploads/World-v0.xlsx');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer(10_000);

      // Now import a new version of the Excel file with updated data.
      await gu.importFileDialog('./uploads/World-v1.xlsx');

      // For sheet Table1, don't pick any merge fields and import into the existing table (Table1_2).
      await driver.findContent('.test-importer-target-existing-table', /Table1_2/).click();

      await gu.waitForServer();

      // For sheet City, merge on Name, District and Country.
      await driver.findContent('.test-importer-source', /City/).click();
      await gu.waitForServer();
      await driver.findContent('.test-importer-target-existing-table', /City/).click();
      await gu.waitForServer();
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Name/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /District/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Country/
      ).click();
      await gu.sendKeys(Key.ESCAPE);

      // Check the preview diff of City. The population should have doubled in every row.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5]),
        [
          'Kabul', 'Kabol', ['1780000', '3560000', undefined], '2', ['1780', '3560', undefined],
          'Qandahar', 'Qandahar', ['237500', '475000', undefined], '2', ['237.5', '475', undefined],
          'Herat', 'Herat', ['186800', '373600', undefined], '2', ['186.8', '373.6', undefined],
          'Mazar-e-Sharif', 'Balkh', ['127800', '255600', undefined], '2', ['127.8', '255.6', undefined],
          'Amsterdam', 'Noord-Holland', ['731200', '1462400', undefined], '159',  ['731.2', '1462.4', undefined],
        ]
      );

      // For sheet Country, merge on Code.
      await driver.findContent('.test-importer-source', /Country/).click();
      await gu.waitForServer();
      await driver.findContent('.test-importer-target-existing-table', /Country/).click();
      await gu.waitForServer();
      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Code/
      ).click();
      await gu.sendKeys(Key.ESCAPE);

      // Check the preview diff of Country. The population should have doubled in every row.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(
        await getPreviewDiffCellValues([0, 6], [1, 2, 3, 4, 5]),
        [ 'ABW', ['103000', '206000', undefined],
          'AFG', ['22720000', '45440000', undefined],
          'AGO', ['12878000', '25756000', undefined],
          'AIA', ['8000', '16000', undefined],
          'ALB', [ '3401200', '6802400', undefined]
        ]
      );

      // For sheet CountryLanguage, merge on Country and Language.
      await driver.findContent('.test-importer-source', /CountryLanguage/).click();
      await gu.waitForServer();
      await driver.findContent('.test-importer-target-existing-table', /CountryLanguage/).click();
      await gu.waitForServer();

      await waitForColumnMapping();
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Country/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Language/
      ).click();
      await gu.sendKeys(Key.ESCAPE);

      // Check the preview diff of CountryLanguage. The first few percentages should be slightly different.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3], [1, 2, 3, 4, 5]),
        [ 'Dutch', ['5.3', '5.5', undefined], 'ABW', '',
          'English', ['9.5', '9.3', undefined], 'ABW', '',
          'Papiamento', ['76.7', '76.3', undefined], 'ABW', '',
          'Spanish', ['7.4', '7.8', undefined], 'ABW', '',
          'Balochi', ['0.9', '1.1', undefined], 'AFG', ''
        ]
      );

      // Complete the import, and verify that incoming data was merged correctly.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'EmptyDate',
        'Homicide counts and rates (2000',
        'Sheet1',
        'UploadedData1',
        'UploadedData2',
        'Table1',
        'City',
        'Country',
        'CountryLanguage'
      ]);

      // Check the contents of Table1; it should have duplicates of the original 2 rows.
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4, 5], cols: [0, 1, 2, 3, 4] }),
        [
          'hello', '', '', '', 'HELLO',
          '', 'world', '', '', '',
          'hello', '', '', '', 'HELLO',
          '', 'world', '', '', '',
          '', '', '', '', '',
        ]
      );

      // Check the contents of City. The population should have doubled in every row.
      await gu.getPageItem('City').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5]}),
        [
          'Kabul', 'Kabol', '3560000', '2', '3560',
          'Qandahar', 'Qandahar', '475000', '2', '475',
          'Herat', 'Herat', '373600', '2', '373.6',
          'Mazar-e-Sharif', 'Balkh', '255600', '2', '255.6',
          'Amsterdam', 'Noord-Holland', '1462400', '159', '1462.4',
        ]
      );

      // Check that no new rows were added to City.
      assert.equal(await gu.getGridRowCount(), 4080);

      // Check the contents of Country. The population should have doubled in every row.
      await gu.getPageItem('Country').click();
      await gu.waitForServer();
      assert.deepEqual(
        await gu.getVisibleGridCells({
          cols: [0, 6],
          rowNums: [1, 2, 3, 4, 5]
        }),
        [ 'ABW', '206000',
          'AFG', '45440000',
          'AGO', '25756000',
          'AIA', '16000',
          'ALB', '6802400'
        ]
      );

      // Check that no new rows were added to Country.
      assert.equal(await gu.getGridRowCount(), 240);

      // Check the contents of CountryLanguage. The first few percentages should be slightly different.
      await gu.getPageItem('CountryLanguage').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3], rowNums: [1, 2, 3, 4, 5]}),
        [ 'Dutch', '5.5', 'ABW', '',
          'English', '9.3', 'ABW', '',
          'Papiamento', '76.3', 'ABW', '',
          'Spanish', '7.8', 'ABW', '',
          'Balochi', '1.1', 'AFG', ''
        ]
      );

      // Check that no new rows were added to CountryLanguage.
      assert.equal(await gu.getGridRowCount(), 985);
    });

    it('should show diff of changes in preview', async function() {
      // Import UploadedData2.csv again, and change the destination to UploadedData2.
      await gu.importFileDialog('./uploads/UploadedData2.csv');
      await driver.findContent('.test-importer-target-existing-table', /UploadedData2/).click();
      await gu.waitForServer();
      await waitForColumnMapping();

      // Click 'Update existing records', and check the preview does not yet show a diff.
      await driver.find('.test-importer-update-existing-records').click();
      await gu.waitForServer();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7]),
        [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
          'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
          'BUS540',      'Capstone',            '',                    '01/13/2021',      '',
          '',            '',                    '',                    '',                '' ]);

      // Select 'CourseId' as the merge column, and check that the preview now contains a diff of old/new values.
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /CourseId/
      ).click();
      await gu.sendKeys(Key.ESCAPE);
      await gu.waitForServer();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7]),
        [ 'BUS100',      'Intro to Business',   [undefined, undefined, 'Mariyam Melania'], '01/13/2021', '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
          'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
          'BUS540',      'Capstone',            '',                    '01/13/2021',      ['false', 'true', undefined],
          '',            '',                    '',                    '',                '' ]);


      // Uncheck 'Update existing records', and check that the preview no longer shows a diff.
      await driver.find('.test-importer-update-existing-records').click();
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7]),
        [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
          'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
          'BUS540',      'Capstone',            '',                    '01/13/2021',      '',
          '',            '',                    '',                    '',                '' ]);

      // Check that the column matching section is correct.
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'CourseId', source: 'CourseId' },
        { destination: 'CourseName', source: 'CourseName' },
        { destination: 'Instructor', source: 'Instructor' },
        { destination: 'StartDate', source: 'StartDate' },
        { destination: 'PassFail', source: 'PassFail' },
      ]);

      // Click 'Update existing records' again, and edit the formula for CourseId to append a suffix.
      await driver.find('.test-importer-update-existing-records').click();
      await waitForDiffPreviewToLoad();
      await driver.findContent('.test-importer-column-match-source-destination', /CourseId/)
        .find('.test-importer-column-match-formula').click();
      await driver.find('.test-importer-apply-formula').click();
      await gu.sendKeys(' + "-NEW"');

      // Before saving the formula, check that the preview isn't showing the hidden helper column ids.
      assert.deepEqual(
        await driver.find('.test-importer-preview').findAll('.g-column-label', el => el.getText()),
        ['CourseId', 'CourseName', 'Instructor', 'StartDate', 'PassFail']
      );
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();

      // Check that the preview diff was updated and now shows that all 6 rows are new rows.
      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7]),
        [
          [undefined, 'BUS100-NEW', undefined], [undefined, 'Intro to Business', undefined], '',
            [undefined, '01/13/2021', undefined], [undefined, 'false', undefined],
          [undefined, 'BUS102-NEW', undefined], [undefined, 'Business Law', undefined],
            [undefined, 'Nathalie Patricia', undefined], [undefined, '01/13/2021', undefined],
            [undefined, 'false', undefined],
          [undefined, 'BUS300-NEW', undefined], [undefined, 'Business Operations', undefined],
            [undefined, 'Michael Rian', undefined], [undefined, '01/14/2021', undefined],
            [undefined, 'false', undefined],
          [undefined, 'BUS301-NEW', undefined], [undefined, 'History of Business', undefined],
            [undefined, 'Mariyam Melania', undefined], [undefined, '01/14/2021', undefined],
            [undefined, 'false', undefined],
          [undefined, 'BUS500-NEW', undefined], [undefined, 'Ethics and Law', undefined],
            [undefined, 'Filip Andries', undefined], [undefined, '01/13/2021', undefined],
            [undefined, 'false', undefined],
          [undefined, 'BUS540-NEW', undefined], [undefined, 'Capstone', undefined], '',
            [undefined, '01/13/2021', undefined], [undefined, 'true', undefined],
          '', '', '', '', ''
        ]
      );

      // Check the column mapping section updated with the new formula.
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'CourseId', source: '$CourseId + "-NEW"\n' },
        { destination: 'CourseName', source: 'CourseName' },
        { destination: 'Instructor', source: 'Instructor' },
        { destination: 'StartDate', source: 'StartDate' },
        { destination: 'PassFail', source: 'PassFail' },
      ]);

      // Change the destination back to new table, and check that the preview no longer shows a diff.
      await openTableMapping();
      await driver.find('.test-importer-target-new-table').click();
      await gu.waitForServer();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7]),
        [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
          'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
          'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
          'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
          'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
          'BUS540',      'Capstone',            '',                    '01/13/2021',      '',
          '',            '',                    '',                    '',                '' ]);

      // Close the dialog.
      await driver.find('.test-modal-cancel').click();
      await gu.waitForServer();
    });
  });
});
