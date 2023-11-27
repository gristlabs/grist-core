import { assert } from 'mocha-webdriver';
import { $, gu, test } from 'test/nbrowser/gristUtil-nbrowser';

/**
 * This test verifies that when a section is auto-filtered using section-linking, newly added
 * records automatically get assigned the filter value.
 */
describe('FillLinkedRecords.ntest', function() {
  const cleanup = test.setupTestSuite(this);
  const clipboard = gu.getLockableClipboard();

  gu.bigScreen();

  before(async function() {
    await gu.supportOldTimeyTestCode();
    await gu.useFixtureDoc(cleanup, "Favorite_Films.grist", true);
    await gu.toggleSidePanel("left", "close");
  });

  afterEach(function() {
    return gu.checkForErrors();
  });

  it('should auto-fill values when typing into add-row', async function() {
    await gu.openSidePane('view');
    await $('.test-config-data').click();
    await gu.actions.selectTabView('All');

    // Link the sections first since the sample document start with no links.
    // Connect Friends -> Films
    await gu.actions.viewSection('Films record').selectSection();
    await $('.test-right-select-by').click();
    await $('.test-select-row:contains(Friends record)').click();
    await gu.waitForServer();

    // Connect Films -> Performances grid
    await gu.actions.viewSection('Performances record').selectSection();
    await $('.test-right-select-by').click();
    await $('.test-select-row:contains(Films record)').click();
    await gu.waitForServer();

    // Connect Films -> Performances detail
    await gu.actions.viewSection('Performances detail').selectSection();
    await $('.test-right-select-by').click();
    await $('.test-select-row:contains(Films record)').click();
    await gu.waitForServer();

    // Now pick a movie, and select the Performances grid.
    await gu.clickCell({section: 'Films record', col: 0, rowNum: 2});
    await gu.actions.viewSection('Performances record').selectSection();

    // It should have just two records initially, with an Add-New row.
    assert.equal(await gu.getGridLastRowText(), '3');
    assert.deepEqual(await gu.getGridValues({cols: [0, 1], rowNums: [2, 3]}), [
      'Robin Wright', 'Forrest Gump',
      '', '']);

    // Add a record, and ensure it shows up, and has Film auto-filled in.
    await gu.userActionsCollect(true);
    await gu.addRecord(['Rebecca Williams']);
    await gu.userActionsVerify([
      ["AddRecord", "Performances", null, {"Actor": "Rebecca Williams", "Film": 2}]
    ]);
    assert.deepEqual(await gu.getGridValues({cols: [0, 1], rowNums: [2, 3]}), [
      'Robin Wright', 'Forrest Gump',
      'Rebecca Williams', 'Forrest Gump']);
    assert.equal(await gu.getGridLastRowText(), '4');
  });

  it('should auto-fill values when inserting records', async function() {
    // Click another movie, and check the values we see.
    await gu.clickCell({section: 'Films record', col: 0, rowNum: 5});
    await gu.actions.viewSection('Performances record').selectSection();
    assert.deepEqual(await gu.getGridValues({cols: [0, 1], rowNums: [1, 2]}), [
      'Christian Bale', 'The Dark Knight',
      'Heath Ledger',   'The Dark Knight'
    ]);
    assert.equal(await gu.getGridLastRowText(), '3');

    // Add a couple of records in Performances grid using keyboard shortcuts.
    await gu.clickCell({col: 0, rowNum: 3});
    await gu.sendKeys([$.MOD, $.SHIFT, $.ENTER]);
    await gu.clickCell({col: 0, rowNum: 1});
    await gu.sendKeys([$.MOD, $.ENTER]);
    await gu.waitForServer();

    // Verify they are shown where expected with Film filled in.
    assert.deepEqual(await gu.getGridValues({cols: [0, 1], rowNums: [1, 2, 3, 4]}), [
      'Christian Bale', 'The Dark Knight',
      '',               'The Dark Knight',
      'Heath Ledger',   'The Dark Knight',
      '',               'The Dark Knight',
    ]);
    assert.equal(await gu.getGridLastRowText(), '5');

    // Add a record in Performances detail using keyboard shortcuts.
    await gu.actions.viewSection('Performances detail').selectSection();
    assert.deepEqual(await gu.getDetailValues({cols: ['Actor', 'Film'], rowNums: [1]}),
      ['Christian Bale', 'The Dark Knight']);
    await gu.sendKeys([$.MOD, $.ENTER]);
    await gu.waitForServer();

    // Verify the record is shown with Film filled in, and added to the grid section too.
    // Note: rowNum needs to be 1 now for card views without row numbers shown.
    assert.deepEqual(await gu.getDetailValues({cols: ['Actor', 'Film'], rowNums: [1]}),
      ['', 'The Dark Knight']);

    await gu.actions.viewSection('Performances record').selectSection();
    assert.deepEqual(await gu.getGridValues({cols: [0, 1], rowNums: [1, 2, 3, 4, 5]}), [
      'Christian Bale', 'The Dark Knight',
      '',               'The Dark Knight',
      '',               'The Dark Knight',
      'Heath Ledger',   'The Dark Knight',
      '',               'The Dark Knight',
    ]);
    assert.equal(await gu.getGridLastRowText(), '6');

    // Undo the record insertions.
    await gu.undo(3);
  });

  it('should auto-fill when pasting data', async function() {
    // Click a movie, and check the values we expect to start with.
    await gu.clickCell({section: 'Films record', col: 0, rowNum: 6});
    await gu.actions.viewSection('Performances record').selectSection();
    assert.deepEqual(await gu.getGridValues({cols: [0, 1, 2], rowNums: [1, 4]}), [
      'Chris Evans',        'The Avengers', 'Steve Rogers',
      'Scarlett Johansson', 'The Avengers', 'Natasha Romanoff',
    ]);
    assert.equal(await gu.getGridLastRowText(), '5');

    // Copy a range of three values, and paste them into the Add-New row.
    await gu.clickCell({col: 2, rowNum: 1});
    await gu.sendKeys([$.SHIFT, $.DOWN, $.DOWN]);
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.clickCell({col: 2, rowNum: 5});
      await cb.paste();
    });
    await gu.waitForServer();

    // Verify that three new rows now show up, with Film auto-filled.
    assert.deepEqual(await gu.getGridValues({cols: [0, 1, 2], rowNums: [1, 4, 5, 6, 7]}), [
      'Chris Evans',        'The Avengers', 'Steve Rogers',
      'Scarlett Johansson', 'The Avengers', 'Natasha Romanoff',
      '',                   'The Avengers', 'Steve Rogers',
      '',                   'The Avengers', 'Tony Stark',
      '',                   'The Avengers', 'Bruce Banner',
    ]);
    assert.equal(await gu.getGridLastRowText(), '8');
  });
});
