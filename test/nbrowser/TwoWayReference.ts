import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {Session} from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('TwoWayReference', function() {
  this.timeout('3m');
  let session: Session;
  let docId: string;
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());
  before(async function() {
    session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup);
    await gu.toggleSidePanel('left', 'close');
    await petsSetup();
  });

  async function petsSetup() {
    await gu.sendActions([
      ['RenameColumn', 'Table1', 'A', 'Name'],
      ['ModifyColumn', 'Table1', 'Name', {label: 'Name'}],
      ['RemoveColumn', 'Table1', 'B'],
      ['RemoveColumn', 'Table1', 'C'],
      ['RenameTable', 'Table1', 'Owners'],
      ['AddTable', 'Pets', [
        {id: 'Name', type: 'Text'},
        {id: 'Owner', type: 'Ref:Owners'},
      ]],
      ['AddRecord', 'Owners', -1, {Name: 'Alice'}],
      ['AddRecord', 'Owners', -2, {Name: 'Bob'}],
      ['AddRecord', 'Pets', null, {Name: 'Rex', Owner: -2}],
    ]);
    await gu.addNewSection('Table', 'Pets');
    await gu.openColumnPanel('Owner');
    await gu.setRefShowColumn('Name');
    await addReverseColumn('Pets', 'Owner');
  }

  it('deletes tables with 2 way references', async function() {
    const revert = await gu.begin();
    await gu.toggleSidePanel('left', 'open');
    await driver.find('.test-tools-raw').click();
    const removeTable = async (tableId: string) => {
      await driver.findWait(`.test-raw-data-table-menu-${tableId}`, 1000).click();
      await driver.find('.test-raw-data-menu-remove-table').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
    };
    await removeTable('Pets');
    await revert();
    await removeTable('Owners');
    await gu.checkForErrors();
    await revert();
    await gu.openPage('Table1');
  });

  it('detects new columns after modify', async function() {
    const revert = await gu.begin();

    await gu.selectSectionByTitle('Owners');
    await gu.selectColumn('Pets');
    await gu.setType('Reference', {apply: true});
    await gu.setType('Reference List', {apply: true});

    await gu.selectSectionByTitle('Pets');
    await gu.getCell('Owner', 1).click();
    await gu.sendKeys(Key.DELETE);
    await gu.waitForServer();

    await gu.selectSectionByTitle('Owners');
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2]), ['', '']);
    await revert();
  });

  it('can delete reverse column without an error', async function() {
    const revert = await gu.begin();
    // This can't be tested easily in python as it requries node server for type transformation.
    await gu.toggleSidePanel('left', 'close');
    await gu.toggleSidePanel('right', 'close');

    // Remove the reverse column.
    await gu.selectSectionByTitle('OWNERS');
    await gu.deleteColumn('Pets');
    await gu.checkForErrors();

    // Check data.
    assert.deepEqual(await columns(), [
      ['Name'],
      ['Name', 'Owner']
    ]);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1], 'PETS'), ['Bob']);
    await gu.undo();

    // Check data.
    assert.deepEqual(await columns(), [
      ['Name', 'Pets'],
      ['Name', 'Owner']
    ]);
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2], 'OWNERS'), ['', 'Rex']);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1], 'PETS'), ['Bob']);

    // Check that connection works.

    // Make sure we can change data.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell('Alice', Key.ENTER);
    await gu.waitForServer();
    await gu.checkForErrors();

    // Check data.
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1], 'PETS'), ['Alice']);
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2], 'OWNERS'), ['Rex', '']);

    // Now delete Owner column, and redo it
    await gu.selectSectionByTitle('Pets');
    await gu.deleteColumn('Owner');
    await gu.checkForErrors();
    await gu.undo();
    await gu.checkForErrors();

    // Check data.
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1], 'PETS'), ['Alice']);
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2], 'OWNERS'), ['Rex', '']);
    await revert();
  });

  it('breaks connection after removing reverseCol', async function() {
    const revert = await gu.begin();

    // Make sure Rex is owned by Bob, in both tables.
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", ""],
      [2, "Bob",   "Rex"],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Bob"],
    ]);

    // Now move Rex to Alice.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell("Alice", Key.ENTER);
    await gu.waitForServer();
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", "Rex"],
      [2, "Bob", ""],
    ]);

    // Now remove connection using Owner column.
    await gu.sendActions([['ModifyColumn', 'Pets', 'Owner', {reverseCol: 0}]]);
    await gu.checkForErrors();

    // And check that after moving Rex to Bob, it's not shown in the Owners table.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell("Bob", Key.ENTER);
    await gu.waitForServer();
    await gu.checkForErrors();

    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", "Rex"],
      [2, "Bob", ""],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Bob"],
    ]);

    // Check undo, it should restore the link.
    await gu.undo(2);

    // Rex is now in Alice again in both tables.
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", "Rex"],
      [2, "Bob", ""],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Alice"],
    ]);

    // Move Rex to Bob again.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell("Bob", Key.ENTER);
    await gu.waitForServer();
    await gu.checkForErrors();

    // And check that connection works.
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", ""],
      [2, "Bob", "Rex"],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Bob"],
    ]);
    await revert();
  });

  it('works after reload', async function() {
    const revert = await gu.begin();

    await gu.selectSectionByTitle('OWNERS');
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2]), ['', 'Rex']);
    await session.createHomeApi().getDocAPI(docId).forceReload();
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    // Change Rex owner to Alice.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.sendKeys('Alice', Key.ENTER);
    await gu.waitForServer();
    await gu.selectSectionByTitle('OWNERS');
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2]), ['Rex', '']);
    await revert();
  });

  async function projectSetup() {
    await gu.sendActions([
      ['AddTable', 'Projects', []],
      ['AddTable', 'People', []],

      ['AddVisibleColumn', 'Projects', 'Name', {type: 'Text'}],
      ['AddVisibleColumn', 'Projects', 'Owner', {type: 'Ref:People'}],

      ['AddVisibleColumn', 'People', 'Name', {type: 'Text'}],
    ]);
    await gu.addNewPage('Table', 'Projects');
    await gu.addNewSection('Table', 'People');
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel();
    await gu.toggleSidePanel('left', 'close');
  }

  it('undo works for adding reverse column', async function() {
    await projectSetup();
    const revert = await gu.begin();

    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
    await addReverseColumn('Projects', 'Owner');
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name', 'Projects']
    ]);
    await gu.undo(1);
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
    await gu.redo(1);
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name', 'Projects']
    ]);
    await revert();
  });

  it('creates proper names when added multiple times', async function() {
    const revert = await gu.begin();
    await addReverseColumn('Projects', 'Owner');

    // Add another reference to Projects from People.
    await gu.selectSectionByTitle('Projects');
    await gu.addColumn('Tester', 'Reference');
    await gu.setRefTable('People');
    await gu.setRefShowColumn('Name');

    // And now show it on People.
    await addReverseColumn('Projects', 'Tester');

    // We should now see 3 columns on People.
    await gu.selectSectionByTitle('People');
    assert.deepEqual(await gu.getColumnNames(), ['Name', 'Projects', 'Projects_Tester']);

    // Add yet another one.
    await gu.selectSectionByTitle('Projects');
    await gu.addColumn('PM', 'Reference');
    await gu.setRefTable('People');
    await gu.setRefShowColumn('Name');
    await addReverseColumn('Projects', 'PM');

    // We should now see 4 columns on People.
    await gu.selectSectionByTitle('People');
    assert.deepEqual(await gu.getColumnNames(), ['Name', 'Projects', 'Projects_Tester', 'Projects_PM']);

    await revert();
  });

  it('works well for self reference', async function() {
    const revert = await gu.begin();

    // Create a new table with task hierarchy and check if looks sane.
    await gu.addNewPage('Table', 'New Table', {
      tableName: 'Tasks',
    });
    await gu.renameColumn('A', 'Name');
    await gu.renameColumn('B', 'Parent');
    await gu.sendActions([
      ['RemoveColumn', 'Tasks', 'C']
    ]);
    await gu.setType('Reference');
    await gu.setRefTable('Tasks');
    await gu.setRefShowColumn('Name');
    await gu.sendActions([
      ['AddRecord', 'Tasks', -1, {Name: 'Parent'}],
      ['AddRecord', 'Tasks', null, {Name: 'Child', Parent: -1}],
    ]);
    await gu.openColumnPanel('Parent');
    await addReverseColumn('Tasks', 'Parent');

    // We should now see 3 columns on Tasks.
    assert.deepEqual(await gu.getColumnNames(), ['Name', 'Parent', 'Tasks']);

    await gu.openColumnPanel('Tasks');
    await gu.setRefShowColumn('Name');

    // Check that data looks ok.
    assert.deepEqual(await gu.getVisibleGridCells('Name', [1, 2]), ['Parent', 'Child']);
    assert.deepEqual(await gu.getVisibleGridCells('Parent', [1, 2]), ['', 'Parent']);
    assert.deepEqual(await gu.getVisibleGridCells('Tasks', [1, 2]), ['Child', '']);

    await revert();
  });

  it('converts from RefList to Ref without problems', async function() {
    await session.tempNewDoc(cleanup);
    const revert = await gu.begin();
    await gu.sendActions([
      ['AddTable', 'People', [
        {id: 'Name', type: 'Text'},
        {id: 'Supervisor', type: 'Ref:People'},
      ]],
      ['AddRecord', 'People', 1, {Name: 'Alice'}],
      ['AddRecord', 'People', 4, {Name: 'Bob'}],
      ['UpdateRecord', 'People', 1, {Supervisor: 4}],
      ['UpdateRecord', 'People', 3, {Supervisor: 0}],
    ]);

    await gu.toggleSidePanel('left', 'open');
    await gu.openPage('People');
    await gu.openColumnPanel('Supervisor');
    await gu.setRefShowColumn('Name');

    // Using the convert dialog caused an error, which wasn't raised when doing it manually.
    await gu.setType('Reference List', {apply: true});
    await gu.setType('Reference', {apply: true});
    await gu.checkForErrors();

    await revert();
  });
});

async function addReverseColumn(tableId: string, colId: string) {
  await gu.sendActions([
    ['AddReverseColumn', tableId, colId],
  ]);
}

/**
 * Returns an array of column headers for each table in the document.
 */
async function columns() {
  const headers: string[][] = [];

  for (const table of await driver.findAll('.gridview_stick-top')) {
    const cols = await table.findAll('.g-column-label', e => e.getText());
    headers.push(cols);
  }
  return headers;
}
