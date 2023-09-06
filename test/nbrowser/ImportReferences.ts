/**
 * Parsing strings as references when importing into an existing table
 */
import {assert, driver, Key, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {openSource as openSourceMenu, waitForColumnMapping} from 'test/nbrowser/importerTestUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ImportReferences', function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  before(async function() {
    // Log in and import a sample document.
    const session = await gu.session().teamSite.user('user1').login();
    await session.tempDoc(cleanup, 'ImportReferences.grist');
  });

  afterEach(() => gu.checkForErrors());

  it('should convert strings to references', async function() {
    // Import a CSV file containing strings representing references
    await gu.importFileDialog('./uploads/name_references.csv');
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);

    // Change the destination to the existing table
    await driver.findContent('.test-importer-target-existing-table', /Table1/).click();
    await gu.waitForServer();

    // Finish import, and verify the import succeeded.
    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Verify data was imported to Names correctly.
    assert.deepEqual(
      await gu.getVisibleGridCells({rowNums: [1, 2, 3, 4, 5], cols: [0, 1, 2]}),
      [
        // Previously existing data in the fixture document
        'Alice',   '',      '',
        'Bob',     '',      '',

        // Imported data from the CSV file
        // The second column is references which have been successfully parsed from strings
        // The third column is a formula equal to the second column to demonstrate the references
        'Charlie', 'Alice', 'Table1[1]',
        'Dennis',  'Bob',   'Table1[2]',

        // 'add new' row
        '',        '',      '',
      ]
    );

    // TODO this test relies on the imported data referring to names (Alice,Bob)
    //   already existing in the table before the import, and not being changed by the import
  });

  it('should support importing into any reference columns and show preview', async function() {
    // Switch to page showing Projects and Tasks.
    await gu.getPageItem('Projects').click();
    await gu.waitForServer(); // wait for table load

    // Load up a CSV file that matches the structure of the Tasks table.
    await gu.importFileDialog('./uploads/ImportReferences-Tasks.csv');

    // The default import into "New Table" just shows the content of the file.
    assert.equal(await driver.findWait('.test-importer-preview', 2000).isPresent(), true);
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4, 5, 6], [1, 2, 3, 4], mapper), [
      'Foo2', 'Clean',  '1000', '1,000', '27 Mar 2023', '',             '0',
      'Bar2', 'Wash',   '3000', '2,000', '',            'Projects[2]',  '2',
      'Baz2', 'Build2', '',     '2',     '20 Mar 2023', 'Projects[1]',  '1',
      'Zoo2', 'Clean',  '2000', '4,000', '24 Apr 2023', 'Projects[3]',  '3',
    ]);

    await driver.findContent('.test-importer-target-existing-table', /Tasks/).click();
    await gu.waitForServer();

    // See that preview works, and cells that should be valid are valid.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4], mapper), [
      // Label, PName,   PIndex,   PDate,          PRowID
      'Foo2', 'Clean',   '1,000',  '27 Mar 2023',  '',
      'Bar2', 'Wash',    '3,000',  '',             '!Projects[2]',
      'Baz2', '!Build2', '',       '!2023-03-20',  '!Projects[1]',
      'Zoo2', 'Clean',   '2,000',  '24 Apr 2023',  '!Projects[3]',
    ]);

    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Verify data was imported to Tasks correctly.
    assert.deepEqual(
      await gu.getVisibleGridCells({section: 'TASKS', cols: [0, 1, 2, 3, 4], rowNums: [4, 5, 6, 7, 8, 9], mapper}), [
      // Label, PName,   PIndex,   PDate,          PRowID
      // Previous data in the fixture, in row 4
      'Zoo',  'Clean',   '2,000',  '27 Mar 2023',  'Projects[3]',
      // New rows (values like "!Project[2]" are invalid, which may be fixed in the future).
      'Foo2', 'Clean',   '1,000',  '27 Mar 2023',  '',
      'Bar2', 'Wash',    '3,000',  '',             '!Projects[2]',
      'Baz2', '!Build2', '',       '!2023-03-20',  '!Projects[1]',
      'Zoo2', 'Clean',   '2,000',  '24 Apr 2023',  '!Projects[3]',
      // 'Add New' row
      '', '', '', '', '',
    ]);

    await gu.undo();
  });

  it('should support importing numeric columns as lookups or rowIDs', async function() {
    // Load up the same CSV file again, with Tasks as the destination.
    await gu.importFileDialog('./uploads/ImportReferences-Tasks.csv');
    await driver.findContent('.test-importer-target-existing-table', /Tasks/).click();
    await gu.waitForServer();
    await waitForColumnMapping();

    // Check that preview works, and cells are valid.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4], mapper), [
      // Label, PName,   PIndex,   PDate,          PRowID
      'Foo2', 'Clean',   '1,000',  '27 Mar 2023',  '',
      'Bar2', 'Wash',    '3,000',  '',             '!Projects[2]',
      'Baz2', '!Build2', '',       '!2023-03-20',  '!Projects[1]',
      'Zoo2', 'Clean',   '2,000',  '24 Apr 2023',  '!Projects[3]',
    ]);

    // Check that dropdown for Label does not include "(as row ID)" entries, but the dropdown for
    // PName (a reference column) does.
    await openSourceMenu('Label');
    assert.equal(await findColumnMenuItem('PIndex').isPresent(), true);
    assert.equal(await findColumnMenuItem(/as row ID/).isPresent(), false);
    await driver.sendKeys(Key.ESCAPE);

    await openSourceMenu('PName');
    assert.equal(await findColumnMenuItem('PIndex').isPresent(), true);
    assert.equal(await findColumnMenuItem('PIndex (as row ID)').isPresent(), true);
    await driver.sendKeys(Key.ESCAPE);

    // Change PIndex column from lookup to row ID.
    await openSourceMenu('PIndex');
    await findColumnMenuItem('PIndex (as row ID)').click();
    await gu.waitForServer();

    // The values become invalid because there are no such rowIDs.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4], mapper), [
      // Label, PName,   PIndex,   PDate,          PRowID
      'Foo2', 'Clean',   '!1000',  '27 Mar 2023',  '',
      'Bar2', 'Wash',    '!3000',  '',             '!Projects[2]',
      'Baz2', '!Build2', '',       '!2023-03-20',  '!Projects[1]',
      'Zoo2', 'Clean',   '!2000',  '24 Apr 2023',  '!Projects[3]',
    ]);

    // Try a lookup using PIndex2. It is differently formatted, one value is invalid, and one is a
    // valid row ID (but shouldn't be seen as a rowID for a lookup)
    await openSourceMenu('PIndex');
    await findColumnMenuItem('PIndex2').click();
    await gu.waitForServer();

    // Note: two PIndex values are different, and two are invalid.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4], mapper), [
      // Label, PName,   PIndex,   PDate,          PRowID
      'Foo2', 'Clean',   '1,000',   '27 Mar 2023',  '',
      'Bar2', 'Wash',    '2,000',   '',             '!Projects[2]',
      'Baz2', '!Build2', '!2.0',    '!2023-03-20',  '!Projects[1]',
      'Zoo2', 'Clean',   '!4000.0', '24 Apr 2023',  '!Projects[3]',
    ]);

    // Change PRowID column to use "PID (as row ID)". It has 3 valid rowIDs.
    await openSourceMenu('PRowID');
    await findColumnMenuItem('PID (as row ID)').click();
    await gu.waitForServer();

    // Note: PRowID values are now valid.
    assert.deepEqual(await gu.getPreviewContents([0, 1, 2, 3, 4], [1, 2, 3, 4], mapper), [
      // Label, PName,   PIndex,   PDate,          PRowID
      'Foo2', 'Clean',   '1,000',   '27 Mar 2023',  '',
      'Bar2', 'Wash',    '2,000',   '',             'Projects[2]',
      'Baz2', '!Build2', '!2.0',    '!2023-03-20',  'Projects[1]',
      'Zoo2', 'Clean',   '!4000.0', '24 Apr 2023',  'Projects[3]',
    ]);

    await driver.find('.test-modal-confirm').click();
    await gu.waitForServer();

    // Verify data was imported to Tasks correctly.
    assert.deepEqual(
      await gu.getVisibleGridCells({section: 'TASKS', cols: [0, 1, 2, 3, 4], rowNums: [4, 5, 6, 7, 8, 9], mapper}), [
      // Label, PName,   PIndex,   PDate,          PRowID
      // Previous data in the fixture, in row 4
      'Zoo',  'Clean',   '2,000',  '27 Mar 2023',  'Projects[3]',
      // New rows; PRowID values are valid.
      'Foo2', 'Clean',   '1,000',   '27 Mar 2023',  '',
      'Bar2', 'Wash',    '2,000',   '',             'Projects[2]',
      'Baz2', '!Build2', '!2.0',    '!2023-03-20',  'Projects[1]',
      'Zoo2', 'Clean',   '!4000.0', '24 Apr 2023',  'Projects[3]',
      // 'Add New' row
      '', '', '', '', '',
    ]);

    await gu.undo();
  });
});

// mapper for getVisibleGridCells and getPreviewContents to get both text and whether the cell is
// invalid (pink). Invalid cells prefixed with "!".
async function mapper(el: WebElement) {
  let text = await el.getText();
  if (await el.find(".field_clip").matches(".invalid")) {
    text = "!" + text;
  }
  return text;
}

function findColumnMenuItem(label: RegExp|string) {
  return driver.findContent('.test-importer-column-match-menu-item', label);
}
