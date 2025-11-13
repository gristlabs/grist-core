/**
 * Test of the Importer dialog (part 2), for imports inside an open doc.
 */
import {DocAPI} from 'app/common/UserAPI';
import {DocCreationInfo} from 'app/common/DocListAPI';
import * as _ from 'lodash';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {getColumnMatchingRows, getPreviewDiffCellValues, openSource as openSourceFor,
        openTableMapping, waitForColumnMapping, waitForDiffPreviewToLoad} from 'test/nbrowser/importerTestUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('Importer2', function() {
  this.timeout(60000);
  gu.bigScreen();
  const cleanup = setupTestSuite();
  let doc: DocCreationInfo;
  let api: DocAPI;

  before(async function() {
    // Log in and import a sample document.
    const session = await gu.session().teamSite.login();
    doc = await session.tempDoc(cleanup, 'Hello.grist');
    api = session.createHomeApi().getDocAPI(doc.id);
  });

  afterEach(() => gu.checkForErrors());

  it('should close formula editor when switching sources or closing importer', async function() {
    await gu.importFileDialog('./uploads/World-v0.xlsx');
    assert.equal(await driver.findWait('.test-importer-preview', 5000).isPresent(), true);

    // Double-click a preview cell to open the formula editor in the preview grid.
    await gu.dbClick(await gu.getPreviewCell(0, 1));
    await waitForFormulaEditor();

    // Click away (on a configuration control) to remove focus and close the editor.
    await driver.find('.test-importer-target-new-table').click();
    await gu.waitForServer();
    await waitForFormulaEditorToClose();

    // Open the editor again in the preview grid.
    await gu.dbClick(await gu.getPreviewCell(1, 1));
    await waitForFormulaEditor();

    // Switching source tables should also close any open editor.
    await driver.findContent('.test-importer-source', /City/).click();
    await gu.waitForServer();
    await waitForFormulaEditorToClose();

    // Re-open once more, then cancel the importer and verify cleanup on close.
    await driver.findContent('.test-importer-source', /Table1/).click();
    await gu.waitForServer();
    await gu.dbClick(await gu.getPreviewCell(2, 2));
    await waitForFormulaEditor();

    // Cancel the import to verify that the formula editor is closed.
    await driver.find('.test-modal-cancel').click();
    await gu.waitAppFocus();
    await waitForFormulaEditorToClose();
  });

  it("should import new tables losslessly", async function() {
    // Import mixed_dates.csv into a new table
    await gu.importFileDialog('./uploads/mixed_dates.csv');
    await waitForDiffPreviewToLoad();
    await driver.find('.test-modal-confirm').click();
    await gu.waitAppFocus();

    // Import the same file again into the same table
    await gu.importFileDialog('./uploads/mixed_dates.csv');
    await driver.findContent('.test-importer-target-existing-table', /Mixed_dates/).click();
    await waitForDiffPreviewToLoad();
    await driver.find('.test-modal-confirm').click();
    await gu.waitAppFocus();

    assert.deepEqual(
      await gu.getVisibleGridCells({cols: [0], rowNums: _.range(1, 21)}),
      [
        // mixed_dates.csv contains 10 dates. The first 9 are YYYY-MM-DD so that's the guessed date format.
        // The last date '01/02/03' doesn't fit this format.
        // Since 90% of the values fit the guessed format, the column is guessed to have type Date.
        // The dates are parsed by DateGuesser which uses moment's strict parsing directly, not parseDate.
        // So '01/02/03' isn't parsed and remains a string, and the column is imported losslessly,
        // i.e. converting it back to text yields the original strings in the file unchanged.
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '01/02/03',

        // When the file is imported again into the same table, things go differently.
        // The intermediate hidden table goes through the same process and stores '01/02/03' as a string.
        // But for existing tables we set parseStrings to true when applying the final BulkAddRecord.
        // So '01/02/03' is parsed by parseDate according to the existing column's date format which gives 2001-02-03.
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '2020-03-04',
        '2020-03-05',
        '2020-03-06',
        '2001-02-03',
      ],
    );

    await gu.undo(2);
  });

  it("should set widget options for formatted numbers", async function() {
    // Import formatted_numbers.csv into a new table
    await gu.importFileDialog('./uploads/formatted_numbers.csv');
    await waitForDiffPreviewToLoad();
    await driver.find('.test-modal-confirm').click();
    await gu.waitAppFocus();

    // Numbers appear formatted as in the CSV file
    assert.deepEqual(
      await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1]}),
      ["$1.00", "1.20E3", "2,000,000", "43%", "(56)"],
    );

    const records = await api.getRecords('Formatted_numbers');
    const cols = await api.getRecords('_grist_Tables_column');

    // Actual data has correct values, e.g. 43% -> 0.43
    assert.deepEqual(records, [{
      id: 1,
      fields: {
        fn_currency: 1,
        fn_scientific: 1200,
        fn_decimal: 2000000,
        fn_percent: 0.43,
        fn_parens: -56,
      },
    }]);

    // Get the fields we care about describing the columns to allow comparison.
    // All column names in the CSV file start with "fn_"
    const colFields = cols.map(
      ({fields: {colId, type, widgetOptions}}) =>
        ({colId, type, widgetOptions: JSON.parse(widgetOptions as string || "{}")})
    ).filter(f => (f.colId as string).startsWith("fn_"));

    // All the columns are numeric and have some kind of formatting
    assert.deepEqual(colFields, [
      {
        colId: 'fn_currency',
        type: 'Numeric',
        widgetOptions: {decimals: 2, numMode: 'currency'}
      },
      {
        colId: 'fn_scientific',
        type: 'Numeric',
        widgetOptions: {decimals: 2, numMode: 'scientific'}
      },
      {
        colId: 'fn_decimal',
        type: 'Numeric',
        widgetOptions: {numMode: 'decimal'}
      },
      {
        colId: 'fn_percent',
        type: 'Numeric',
        widgetOptions: {numMode: 'percent'}
      },
      {
        colId: 'fn_parens',
        type: 'Numeric',
        widgetOptions: {numSign: 'parens'}
      },
    ]);

    // Remove the imported table
    await gu.undo();
  });

  it("should not show skip option for single table", async function() {
    async function noSkip() {
      await waitForDiffPreviewToLoad();
      assert.isFalse(await driver.find('.test-importer-target-skip').isPresent());
      await driver.sendKeys(Key.ESCAPE);
      await driver.find('.test-modal-cancel').click();
      await gu.waitAppFocus();
    }
    await gu.importFileDialog('./uploads/UploadedData1.csv');
    await noSkip();
    await gu.importFileDialog('./uploads/BooleanData.xlsx');
    await noSkip();
  });

  it("should show skip option for multiple tables", async function() {
    async function hasSkip() {
      await waitForDiffPreviewToLoad();
      assert.isTrue(await driver.find('.test-importer-target-skip').isDisplayed());
      await driver.find('.test-importer-source-not-selected').click();
      assert.isTrue(await driver.find('.test-importer-target-skip').isDisplayed());
      await driver.find('.test-modal-cancel').click();
      await gu.waitAppFocus();
    }
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    await hasSkip();
    await gu.importFileDialog('./uploads/homicide_rates.xlsx');
    await hasSkip();
  });

  it("should skip importing", async function() {
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    await waitForDiffPreviewToLoad();
    // Skip the first table.
    await driver.find('.test-importer-target-skip').click();
    // Make sure preview is grayed out.
    assert.isTrue(await driver.find(".test-importer-preview-overlay").isPresent());
    await driver.find('.test-modal-confirm').click();
    await gu.waitAppFocus();
    // Make sure only second table is visible.
    assert.deepEqual(await gu.getPageNames(), ['Table1', 'UploadedData2']);
    // And data is valid.
    await gu.getPageItem('UploadedData2').click();
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5, 6]}),
    [ 'BUS100',      'Intro to Business',   '',                    '01/13/2021',      '',
      'BUS102',      'Business Law',        'Nathalie Patricia',   '01/13/2021',      '',
      'BUS300',      'Business Operations', 'Michael Rian',        '01/14/2021',      '',
      'BUS301',      'History of Business', 'Mariyam Melania',     '01/14/2021',      '',
      'BUS500',      'Ethics and Law',      'Filip Andries',       '01/13/2021',      '',
      'BUS540',      'Capstone',            '',                    '01/13/2021',      '' ]);
    await gu.undo();
  });

  it("should clean mapping when skipped", async function() {
    // Import UploadedData2 to have a destination table.
    await gu.importFileDialog('./uploads/UploadedData2.csv');
    await waitForDiffPreviewToLoad();
    await driver.find('.test-modal-confirm').click();
    await gu.waitAppFocus();

    // Reimport
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    await waitForDiffPreviewToLoad();

    // Skip first table
    await driver.find('.test-importer-target-skip').click();

    // Select second table and add mapping to update existing records.
    await driver.find('.test-importer-source-not-selected').click();
    await driver.findContent('.test-importer-target-existing-table', /UploadedData2/).click();

    await waitForDiffPreviewToLoad();
    await waitForColumnMapping();
    await driver.find('.test-importer-update-existing-records').click();
    await driver.find('.test-importer-merge-fields-select').click();
    await driver.findWait('.test-multi-select-menu .test-multi-select-menu-option', 100);
    await driver.findContent(
      '.test-multi-select-menu .test-multi-select-menu-option',
      /CourseId/
    ).click();
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForServer();

    // Now skip and make sure options are hidden
    await openTableMapping();
    await driver.find('.test-importer-target-skip').click();

    // And unskip, and make sure options are back, but not filled
    await driver.findContent('.test-importer-target-existing-table', /UploadedData2/).click();
    await waitForDiffPreviewToLoad();

    await waitForColumnMapping();
    assert.isTrue(await driver.find('.test-importer-update-existing-records').isPresent());
    assert.isTrue(await driver.find('.test-importer-merge-fields-select').isPresent());
    assert.isTrue(await driver.find('.test-importer-merge-fields-message').isPresent());
    assert.equal(await driver.find('.test-importer-merge-fields-select').getText(),
      'Select fields to match on');

    await driver.find('.test-modal-cancel').click();
    await gu.waitAppFocus();
    await gu.undo(2); // Press two times, as we cancelled and import hasn't cleaned temps.
  });

  it("should disable import button when all tables are skipped", async function() {
    await gu.importFileDialog('./uploads/UploadedData1.csv,./uploads/UploadedData2.csv');
    await waitForDiffPreviewToLoad();
    // Make sure both previews are available
    for(const source of await driver.findAll(".test-importer-source")) {
      await source.click();
      assert.isFalse(await driver.find(".test-importer-preview-overlay").isPresent());
    }
    const sources = await driver.findAll(".test-importer-source");
    // Skip both tables.
     for(const source of sources) {
      await source.click();
      await gu.waitForServer();
      await driver.find('.test-importer-target-skip').click();
      await gu.waitForServer();
    }
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), 'true');
    // Make sure both previews are grayed out
    for(const source of sources) {
      await source.click();
      assert.isTrue(await driver.find(".test-importer-preview-overlay").isPresent());
    }

    // Enable first, and test if one is grayed out and the second is not.
    await sources[0].click();
    await gu.waitForServer();
    await driver.find(".test-importer-target-new-table").click();
    await gu.waitForServer();
    await waitForDiffPreviewToLoad();
    assert.isFalse(await driver.find(".test-importer-preview-overlay").isPresent());
    assert.equal(await driver.find('.test-modal-confirm').getAttribute('disabled'), null);

    // Second should be still grayed out
    await sources[1].click();
    assert.isTrue(await driver.find(".test-importer-preview-overlay").isPresent());

    await driver.find('.test-modal-cancel').click();
    await gu.waitAppFocus();
  });

  describe('when importing JSON', async function() {
    // A previous bug caused an error to be thrown when finishing importing a nested JSON file.
    it('should import successfully to new tables', async function() {
      // Import a nested JSON file.
      await gu.importFileDialog('./uploads/names.json');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Check that two preview tables were created.
      assert.lengthOf(await driver.findAll('.test-importer-source'), 2);
      assert.equal(
        await driver.find('.test-importer-source[class*=-selected] .test-importer-from').getText(),
        'names - names.json'
      );
      assert.deepEqual(
        await driver.findAll('.test-importer-source .test-importer-from', (e) => e.getText()),
        ['names - names.json', 'names_name - names.json']
      );

      // Check that the first table looks ok.
      assert.deepEqual(await gu.getPreviewContents([0], [1, 2, 3]), [ '[1]', '[2]', '']);

      // Check that the second table looks ok.
      await driver.findContent('.test-importer-source', /names_name/).click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getPreviewContents([0], [1, 2, 3]), [ 'Bob', 'Alice', '']);

      // Finish import, and verify the import succeeded.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'names',
        'names_name',
      ]);

      // Verify data was imported to Names correctly.
      assert.deepEqual(
        await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0] }),
        ['Names_name[1]', 'Names_name[2]', '']
      );

      // Open the side panel and check that the column type for 'name' is Reference (pointing to 'first').
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      assert.equal(await driver.find('.test-fbuilder-type-select').getText(), 'Reference');
      assert.equal(await gu.getRefTable(), 'names_name');
      assert.equal(await gu.getRefShowColumn(), 'Row ID');

      // Verify data was imported to Names_name correctly.
      await gu.getPageItem('names_name').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells({ rowNums: [1, 2, 3], cols: [0] }), ['Bob', 'Alice', '']);
    });

    it('should import successfully to existing tables with references', async function() {
      // Import the same nested JSON file again.
      await gu.importFileDialog('./uploads/names.json');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Change the destination of both source tables to the existing destination ones.
      await driver.findContent('.test-importer-target-existing-table', /Names/).click();
      await gu.waitForServer();
      // Now on the second tab.
      await driver.findContent('.test-importer-source', /names_name/).click();
      await driver.findContent('.test-importer-target-existing-table', /Names_name/).click();
      await gu.waitForServer();

      // Finish import, and verify the import succeeded.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'names',
        'names_name',
      ]);

      // Verify data was imported to Names correctly.
      assert.deepEqual(
        await gu.getVisibleGridCells({ rowNums: [1, 2, 3, 4, 5], cols: [0] }),
        ['Names_name[1]', 'Names_name[2]', 'Names_name[1]', 'Names_name[2]', '']
      );

      // Open the side panel and check that the column type for 'name' is Reference (pointing to 'first').
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      assert.equal(await driver.find('.test-fbuilder-type-select').getText(), 'Reference');
      assert.equal(await gu.getRefTable(), 'names_name');
      assert.equal(await gu.getRefShowColumn(), 'Row ID');

      // Verify data was imported to Names_name correctly.
      await gu.getPageItem('names_name').click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells(
        { rowNums: [1, 2, 3, 4, 5], cols: [0] }),
        ['Bob', 'Alice', 'Bob', 'Alice', '']
      );

      // Undo the last 2 imports.
      await gu.undo(2);
    });
  });

  describe('when matching columns', async function() {
    it('should not display column matching section for new destinations', async function() {
      // Import an Excel file with multiple sheets.
      await gu.importFileDialog('./uploads/World-v0.xlsx');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Check that the column matching section is not shown.
      assert.isFalse(await driver.find('.test-importer-column-match-options').isPresent());
    });

    it('should display column matching section for existing destinations', async function() {
      // From the previous test: finish importing World-v1.xlsx so we have tables to import to.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer(10_000);

      // Import the same file again.
      await gu.importFileDialog('./uploads/World-v0.xlsx');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Change the destination of the selected sheet to the table created earlier.
      await driver.findContent('.test-importer-target-existing-table', /Table1_2/).click();
      await gu.waitForServer();

      await waitForColumnMapping();
      // Check that source and destination are populated for each column from the first sheet.
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'a', source: 'a' },
        { destination: 'b', source: 'b' },
        { destination: 'c', source: 'c' },
        { destination: 'd', source: 'd' },
        { destination: 'E', source: 'E' },
      ]);
      assert.isFalse(await driver.find('.test-importer-unmatched-fields').isPresent());

      // Switch to the City sheet, and check that the column matching section is no longer shown.
      await driver.findContent('.test-importer-source', /City/).click();
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-importer-column-match-options').isPresent());

      // Change the destination to 'City', and now check that the section is shown.
      await driver.findContent('.test-importer-target-existing-table', /City/).click();
      await gu.waitForServer(10_000);

      await waitForColumnMapping();
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'Name', source: 'Name' },
        { destination: 'District', source: 'District' },
        { destination: 'Population', source: 'Population' },
        { destination: 'Country', source: 'Country' },
        { destination: 'Pop. \'000', source: 'Pop. \'000' },
      ]);
      assert.isFalse(await driver.find('.test-importer-unmatched-fields').isPresent());
    });

    it('should allow skipping importing columns', async function() {
      // Starting from the City sheet, open the menu for "Pop. '000".
      await driver.findContent('.test-importer-column-match-source', /Pop\. '000/).click();

      // Check that the menu contains only the selected source column, plus a 'Skip' option.
      const menu = gu.findOpenMenu();
      assert.deepEqual(
        await menu.findAll('.test-importer-column-match-menu-item', el => el.getText()),
        ['Skip', 'Pop. \'000']
      );

      // Click 'Skip', and check that the column mapping section and preview both updated.
      await menu.findContentWait('.test-importer-column-match-menu-item', /Skip/, 100).click();
      await gu.waitForServer();
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'Name', source: 'Name' },
        { destination: 'District', source: 'District' },
        { destination: 'Population', source: 'Population' },
        { destination: 'Country', source: 'Country' },
        { destination: 'Pop. \'000', source: 'Skip' },
      ]);
      assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]), [
        'Kabul',  'Kabol',  '1780000',  '2',  '0',
        'Qandahar',  'Qandahar',  '237500',  '2',  '0',
        'Herat',  'Herat',  '186800',  '2',  '0',
        'Mazar-e-Sharif',  'Balkh',  '127800',  '2',  '0',
        'Amsterdam',  'Noord-Holland',  '731200',  '159',  '0',
        'Rotterdam',  'Zuid-Holland',  '593321',  '159',  '0',
      ]);

      // Check that a message is now shown about there being 1 unmapped field.
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '1 unmatched field in import:\nPop. \'000'
      );

      // Click Country in the column mapping section, and clear the formula.
      await driver.findContent('.test-importer-column-match-source', /Country/).click();
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, Key.ENTER);
      await gu.waitForServer();

      // Check that the column mapping section and preview now show that it will be skipped.
      assert.deepEqual(await getColumnMatchingRows(), [
        { destination: 'Name', source: 'Name' },
        { destination: 'District', source: 'District' },
        { destination: 'Population', source: 'Population' },
        { destination: 'Country', source: 'Skip' },
        { destination: 'Pop. \'000', source: 'Skip' },
      ]);
      assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]), [
        'Kabul',  'Kabol',  '1780000',  '0',  '0',
        'Qandahar',  'Qandahar',  '237500',  '0',  '0',
        'Herat',  'Herat',  '186800',  '0',  '0',
        'Mazar-e-Sharif',  'Balkh',  '127800',  '0',  '0',
        'Amsterdam',  'Noord-Holland',  '731200',  '0',  '0',
        'Rotterdam',  'Zuid-Holland',  '593321',  '0',  '0',
      ]);
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '2 unmatched fields in import:\nCountry, Pop. \'000'
      );
    });

    it('should autocomplete formula in source', async function() {
      // Starting from the City sheet, open the menu for "Pop. '000".
      await openSourceFor(/Pop\. '000/);

      // We want to map the same column twice, which is not possible through the menu, so we will
      // use the formula.
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, '$Population', Key.ENTER);
      await gu.waitForServer();
      assert.deepEqual(await getColumnMatchingRows(), [
        { source: 'Name', destination: 'Name' },
        { source: 'District', destination: 'District' },
        { source: 'Population', destination: 'Population' },
        { source: 'Skip', destination: 'Country' },
        { source: '$Population\n', destination: 'Pop. \'000' },
      ]);
      assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]), [
        'Kabul',  'Kabol',  '1780000',  '0',  '1780000',
        'Qandahar',  'Qandahar',  '237500',  '0',  '237500',
        'Herat',  'Herat',  '186800',  '0',  '186800',
        'Mazar-e-Sharif',  'Balkh',  '127800',  '0',  '127800',
        'Amsterdam',  'Noord-Holland',  '731200',  '0',  '731200',
        'Rotterdam',  'Zuid-Holland',  '593321',  '0',  '593321',
      ]);
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '1 unmatched field in import:\nCountry'
      );

      // Click Country (with formula 'Skip') in the column mapping section, and start typing a formula.
      await openSourceFor(/Country/);
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.sendKeys('$');
      await gu.waitForServer();

      // Wait until the Ace autocomplete menu is shown.
      await driver.wait(() => driver.find('div.ace_autocomplete').isDisplayed(), 2000);

      // Check that the autocomplete is suggesting column ids from the imported table.
      const completions = await driver.findAll(
        'div.ace_autocomplete div.ace_line', async el => (await el.getText()).split(' ')[0]
      );
      await gu.waitToPass(async () => {
        assert.deepEqual(
          completions.slice(0, 6),
          [
            "$\nCountry",
            "$\nDistrict",
            "$\nid",
            "$\nName",
            "$\nPop_000",
            "$\nPopulation",
          ]
        );
      }, 2000);

      // Set a constant value for the formula.
      await gu.sendKeys(Key.BACK_SPACE, '123', Key.ENTER);
      await gu.waitForServer();

      // Check that the formula code is shown, as well as the evaluation result in the preview.
      assert.deepEqual(await getColumnMatchingRows(), [
        { source: 'Name', destination: 'Name' },
        { source: 'District', destination: 'District' },
        { source: 'Population', destination: 'Population' },
        { source: '123\n', destination: 'Country' },
        { source: '$Population\n', destination: 'Pop. \'000' },
      ]);

      assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]), [
        'Kabul',  'Kabol',  '1780000',  '123',  '1780000',
        'Qandahar',  'Qandahar',  '237500',  '123',  '237500',
        'Herat',  'Herat',  '186800',  '123',  '186800',
        'Mazar-e-Sharif',  'Balkh',  '127800',  '123',  '127800',
        'Amsterdam',  'Noord-Holland',  '731200',  '123',  '731200',
        'Rotterdam',  'Zuid-Holland',  '593321',  '123',  '593321',
      ]);
      assert.isFalse(await driver.find('.test-importer-unmatched-fields').isPresent());
    });

    it('should reflect mappings when import to new table is finished', async function() {
      // Skip 'Population', so that we can test imports with skipped columns.
      await openSourceFor(/Population/);
      await driver.findContentWait('.test-importer-column-match-menu-item', 'Skip', 100).click();
      await gu.waitForServer();

      // Finish importing, and check that the destination tables have the correct data.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer(10_000);
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'Table1',
        'City',
        'Country',
        'CountryLanguage',
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

      await gu.getPageItem('City').click();
      await gu.waitForServer();

      // The first half should be the original imported rows.
      assert.deepEqual(await gu.getVisibleGridCells(
        {cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5, 6]}),
        [
          'Kabul', 'Kabol', '1780000', '2', '1780',
          'Qandahar', 'Qandahar', '237500', '2', '237.5',
          'Herat', 'Herat', '186800', '2', '186.8',
          'Mazar-e-Sharif', 'Balkh', '127800', '2', '127.8',
          'Amsterdam', 'Noord-Holland', '731200', '159', '731.2',
          'Rotterdam', 'Zuid-Holland', '593321', '159', '593.321',
        ]
      );

      // The second half should be the newly imported rows with custom mappings.
      assert.equal(await gu.getGridRowCount(), 8159);
      assert.deepEqual(await gu.getVisibleGridCells(
        {cols: [0, 1, 2, 3, 4], rowNums: [8152, 8153, 8154, 8155, 8156, 8157]}),
        [
          'Gweru', 'Midlands', '0', '123', '128037',
          'Gaza', 'Gaza', '0', '123', '353632',
          'Khan Yunis', 'Khan Yunis', '0', '123', '123175',
          'Hebron', 'Hebron', '0', '123', '119401',
          'Jabaliya', 'North Gaza', '0', '123', '113901',
          'Nablus', 'Nablus', '0', '123', '100231',
        ]
      );
    });

    it('should reflect mappings in previews of incremental imports', async function() {
      // Delete the first row of the Country column. (Needed for a later assertion.)
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.UP));
      await gu.getCell(3, 1).click();
      await gu.sendKeys(Key.DELETE);
      await gu.waitForServer();

      // Import a CSV file containing city data, with column names that differ from the City table.
      await gu.importFileDialog('./uploads/Cities.csv');
      assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

      // Change the destination to City, and check that column mapping defaults to skipping all columns.
      await driver.findContent('.test-importer-target-existing-table', /City/).click();
      await gu.waitForServer();
      await waitForColumnMapping();
      assert.deepEqual(await getColumnMatchingRows(), [
        { source: 'Skip', destination: 'Name' },
        { source: 'Skip', destination: 'District' },
        { source: 'Skip', destination: 'Population' },
        { source: 'Skip', destination: 'Country' },
        { source: 'Skip', destination: 'Pop. \'000' },
      ]);

      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '5 unmatched fields in import:\nName, District, Population, Country, Pop. \'000'
      );

      // Set formula for 'Name' to 'city_name' by typing in the formula.
      await openSourceFor(/Name/);
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.sendKeys('$city_name', Key.ENTER);
      await gu.waitForServer();

      // Map 'District' to 'city_district' via the column mapping menu.
      await openSourceFor('District');
      const menu = gu.findOpenMenu();
      await menu.findContentWait('.test-importer-column-match-menu-item', /city_district/, 100).click();
      await gu.waitForServer();

      // Check the column mapping section and preview both updated correctly.
      assert.deepEqual(await getColumnMatchingRows(), [
        { source: '$city_name\n', destination: 'Name' },
        { source: 'city_district', destination: 'District' },
        { source: 'Skip', destination: 'Population' },
        { source: 'Skip', destination: 'Country' },
        { source: 'Skip', destination: 'Pop. \'000' },
      ]);
      assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6]), [
        'Kabul',  'Kabol',  '0',  '0',  '0',
        'Qandahar',  'Qandahar',  '0',  '0',  '0',
        'Herat',  'Herat',  '0',  '0',  '0',
        'Mazar-e-Sharif',  'Balkh',  '0',  '0',  '0',
        'Amsterdam',  'Noord-Holland',  '0',  '0',  '0',
        'Rotterdam',  'Zuid-Holland',  '0',  '0',  '0',
      ]);
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '3 unmatched fields in import:\nPopulation, Country, Pop. \'000'
      );

      // Now toggle 'Update existing records', and merge on 'Name' and 'District'.
      await driver.find('.test-importer-update-existing-records').click();
      await driver.find('.test-importer-merge-fields-select').click();
      await driver.findWait('.test-multi-select-menu .test-multi-select-menu-option', 100);
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /Name/
      ).click();
      await driver.findContent(
        '.test-multi-select-menu .test-multi-select-menu-option',
        /District/
      ).click();
      await gu.sendKeys(Key.ESCAPE);
      await gu.waitForServer();

      // Check that the column mapping section and preview updated correctly.
      assert.deepEqual(await getColumnMatchingRows(), [
        { source: '$city_name\n', destination: 'Name' },
        { source: 'city_district', destination: 'District' },
        { source: 'Skip', destination: 'Population' },
        { source: 'Skip', destination: 'Country' },
        { source: 'Skip', destination: 'Pop. \'000' },
      ]);
      await waitForDiffPreviewToLoad();
      await driver.findContentWait('.test-importer-preview .field_clip', 'Kabul', 100);
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5]), [
        'Kabul', 'Kabol', [undefined, undefined, '1780000'], '', [undefined, undefined, '1780'],
        'Qandahar', 'Qandahar', [undefined, undefined, '237500'], [undefined, undefined, '2'],
          [undefined, undefined, '237.5'],
        'Herat', 'Herat', [undefined, undefined, '186800'], [undefined, undefined, '2'],
          [undefined, undefined, '186.8'],
        'Mazar-e-Sharif', 'Balkh', [undefined, undefined, '127800'], [undefined, undefined, '2'],
          [undefined, undefined, '127.8'],
        'Amsterdam', 'Noord-Holland', [undefined, undefined, '731200'], [undefined, undefined, '159'],
          [undefined, undefined, '731.2'],
      ]);
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '3 unmatched fields in import:\nPopulation, Country, Pop. \'000'
      );

      // Map the remaining columns, except "Country"; we'll leave it skipped to check that
      // we don't overwrite any values in the destination table. (A previous bug caused non-text
      // skipped columns to overwrite data with default values, like 0.)
      await openSourceFor(/Population/);
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.sendKeys('$city_pop', Key.ENTER);
      await gu.waitForServer();

      // For "Pop. '000", deliberately map a duplicate column (so we can later check if import succeeded).
      await openSourceFor(/Pop\. '000/);
      await driver.findWait('.test-importer-apply-formula', 100).click();
      await gu.waitAppFocus(false);
      await gu.sendKeys('$city_pop', Key.ENTER);
      await gu.waitForServer();

      assert.deepEqual(await getColumnMatchingRows(), [
        { source: '$city_name\n',      destination: 'Name' },
        { source: 'city_district',   destination: 'District' },
        { source: '$city_pop\n',       destination: 'Population' },
        { source: 'Skip',            destination: 'Country' },
        { source: '$city_pop\n',       destination: 'Pop. \'000' },
      ]);

      await waitForDiffPreviewToLoad();
      assert.deepEqual(await getPreviewDiffCellValues([0, 1, 2, 3, 4], [1, 2, 3, 4, 5]), [
        // Kabul's Country column should appear blank, since we deleted it earlier.
        'Kabul', 'Kabol', ['1780000', '3560000', undefined], '', ['1780', '3560000', undefined],
        'Qandahar', 'Qandahar', ['237500', '475000', undefined], [undefined, undefined, '2'],
          ['237.5', '475000', undefined],
        'Herat', 'Herat', ['186800', '373600', undefined], [undefined, undefined, '2'],
          ['186.8', '373600', undefined],
        'Mazar-e-Sharif', 'Balkh', ['127800', '255600', undefined], [undefined, undefined, '2'],
          ['127.8', '255600', undefined],
        'Amsterdam', 'Noord-Holland', ['731200', '1462400', undefined], [undefined, undefined, '159'],
          ['731.2', '1462400', undefined],
      ]);
      assert.equal(
        await driver.find('.test-importer-unmatched-fields').getText(),
        '1 unmatched field in import:\nCountry'
      );
    });

    it('should reflect mappings when incremental import is finished', async function() {
      // Finish importing, and check that the destination table has the correct data.
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer(10_000);
      assert.deepEqual(await gu.getPageNames(), [
        'Table1',
        'Table1',
        'City',
        'Country',
        'CountryLanguage',
        'Country',
        'CountryLanguage',
      ]);

      assert.deepEqual(await gu.getVisibleGridCells({cols: [0, 1, 2, 3, 4], rowNums: [1, 2, 3, 4, 5]}),
        [
          // Kabul's Country column should still be blank, since we skipped it earlier.
          'Kabul', 'Kabol', '3560000', '', '3560000',
          'Qandahar', 'Qandahar', '475000', '2', '475000',
          'Herat', 'Herat', '373600', '2', '373600',
          'Mazar-e-Sharif', 'Balkh', '255600', '2', '255600',
          'Amsterdam', 'Noord-Holland', '1462400', '159', '1462400',
        ]
      );
    });
  });
});

// Wait until the formula editor is open or closed.
async function checkFormulaEditor(open: boolean, timeout: number = 2000): Promise<void> {
  await gu.waitToPass(async () => {
    assert.equal(await driver.find('.test-formula-editor').isPresent(), open);
  }, timeout);
}

const waitForFormulaEditor = checkFormulaEditor.bind(null, true);
const waitForFormulaEditorToClose = checkFormulaEditor.bind(null, false);
