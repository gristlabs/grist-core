import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {Session} from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('TwoWayReference', function() {
  this.timeout('3m');
  let session: Session;
  let docId: string;
  let revert: () => Promise<void>;
  const cleanup = setupTestSuite();
  afterEach(() => gu.checkForErrors());
  before(async function() {
    session = await gu.session().login();
    docId = await session.tempNewDoc(cleanup);
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
    await addReverseColumn();
  }

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


  it('creates proper names when labels are not standard', async function() {
    const revert = await gu.begin();
    await gu.toggleSidePanel('left', 'close');

    // Remove the reverse column, then rename the table to contain illegal characters
    // in label, and add ref columns to it.
    await gu.selectSectionByTitle('PETS');
    await gu.openColumnPanel('Owner');
    await removeTwoWay();
    await removeModal.wait();
    await removeModal.confirm();
    await gu.waitForServer();

    // Now add another Ref:Owners column to Pets table.
    await gu.sendActions([
      ['AddVisibleColumn', 'Pets', 'Friend', {type: 'Ref:Owners'}],
    ]);
    await gu.selectColumn('Friend');
    await gu.setRefShowColumn('Name');
    await gu.getCell('Friend', 1).click();
    await gu.enterCell('Bob', Key.ENTER);
    await gu.waitForServer();

    // Now rename the Pets table to start with a number and contain a space + person emoji.
    const LABEL = '2 🧑 + 🐕';
    await gu.renameTable('Pets', LABEL);

    // Now create reverse column for Owner and Friend.
    await gu.openColumnPanel('Owner');
    await addReverseColumn();
    await gu.openColumnPanel('Friend');
    await addReverseColumn();

    // Hide side panels.
    await gu.toggleSidePanel('left', 'close');
    await gu.toggleSidePanel('right', 'close');

    // Make sure we see proper data.
    await gu.assertGridData(LABEL, [
      [0, "Name", "Owner", "Friend"],
      [1, "Rex",  "Alice", "Bob"],
    ]);

    await gu.assertGridData("OWNERS", [
      [0, "Name", LABEL, `${LABEL}-Friend`],
      [1, "Alice", "Rex", ""],
      [2, "Bob",   "", "Rex"],
    ]);

    await gu.selectSectionByTitle("OWNERS");
    // Check that creator panel contains proper names.
    await gu.openColumnPanel(LABEL);
    assert.equal(await driver.find('.test-field-col-id').value(), '$c2_');

    await revert();
  });

  it('properly reasings reflists', async function() {
    const revert = await gu.begin();

    // Add two more dogs and move all of them to Alice
    await gu.sendActions([
      ['AddRecord', 'Pets', null, {Name: 'Pluto', Owner: 1}],
      ['AddRecord', 'Pets', null, {Name: 'Azor', Owner: 1}],
      ['UpdateRecord', 'Pets', 1, {Owner: 1}],
    ]);

    // Now reasign Azor to Bob using Owners table.
    await gu.selectSectionByTitle('OWNERS');
    await gu.getCell('Pets', 2).click();
    await gu.sendKeys(Key.ENTER, 'Azor', Key.ENTER, Key.ENTER);
    await gu.waitForServer();

    // Make sure we see it.
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2]), ['Rex\nPluto\nAzor', '']);

    // We are now in a modal dialog.
    assert.equal(
      await driver.findWait('.test-modal-dialog label', 100).getText(),
      'Reassign to Owners record "Bob".'
    );

    // Reassign it.
    await driver.findWait('.test-modal-dialog input', 100).click();
    await driver.findWait('.test-modal-dialog button', 100).click();
    await gu.waitForServer();

    // Make sure we see correct value.
    assert.deepEqual(await gu.getVisibleGridCells('Pets', [1, 2]), ['Rex\nPluto', 'Azor']);

    await revert();
  });

  it('deletes tables with 2 way references', async function() {
    const revert = await gu.begin();

    const beforeRemove = await gu.begin();
    await driver.find('.test-tools-raw').click();
    const removeTable = async (tableId: string) => {
      await driver.findWait(`.test-raw-data-table-menu-${tableId}`, 1000).click();
      await driver.find('.test-raw-data-menu-remove-table').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
    };
    await removeTable('Pets');
    await beforeRemove();
    await removeTable('Owners');
    await gu.checkForErrors();
    await revert();
    await gu.toggleSidePanel('left', 'open');
    await gu.openPage('Table1');
  });

  it('detects new columns after modify', async function() {
    const revert = await gu.begin();

    await gu.selectSectionByTitle('Owners');
    await gu.openColumnPanel('Pets');
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

    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", "Rex"],
      [2, "Bob", ""],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Alice"],
    ]);

    // Remove the reverse column.
    await gu.selectSectionByTitle('OWNERS');
    await gu.deleteColumn('Pets');
    await gu.checkForErrors();

    // Check data.
    assert.deepEqual(await columns(), [
      ['Name'],
      ['Name', 'Owner']
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Alice"],
    ]);
    await gu.undo();

    // Check data.
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", "Rex"],
      [2, "Bob", ""],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Alice"],
    ]);

    // Check that connection works.

    // Make sure we can change data.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell('Bob', Key.ENTER);
    await gu.waitForServer();
    await gu.checkForErrors();

    // Check data.
    await gu.assertGridData('OWNERS', [
      [0, "Name", "Pets"],
      [1, "Alice", ""],
      [2, "Bob", "Rex"],
    ]);
    await gu.assertGridData("PETS", [
      [0, "Name", "Owner"],
      [1, "Rex",  "Bob"],
    ]);

    // Now delete Owner column, and redo it
    await gu.selectSectionByTitle('Pets');
    await gu.deleteColumn('Owner');
    await gu.checkForErrors();
    await gu.undo();
    await gu.redo();
    await gu.undo();
    await gu.checkForErrors();

    // Check data.
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

  it('breaks connection after removing reverseCol', async function() {
    const revert = await gu.begin();

    // Move Rex to Bob.
    await gu.selectSectionByTitle('PETS');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell('Bob', Key.ENTER);
    await gu.waitForServer();

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

  it('common setup', async function() {
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
    revert = await gu.begin();
  });

  it('clicking show on creates a new column', async function() {
    await gu.selectColumn('Owner');
    await addReverseColumn();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name', 'Projects']
    ]);

    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');
    assert.equal(await configText(), 'Projects.Owner(Ref)');
  });

  it('can remove two way reference', async function() {
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    await removeTwoWay();
    await removeModal.wait();
    await removeModal.confirm();
    await gu.waitForServer();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
  });

  it('right column looks ok', async function() {
    await addReverseColumn();
    await gu.waitForServer();

    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');

    assert.equal(await gu.getType(), 'Reference List');
    assert.equal(await gu.getRefTable(), 'Projects');
  });

  it('right column has same options', async function() {
    await gu.openColumnPanel('Projects');
    assert.equal(await gu.getType(), 'Reference List');
    assert.equal(await configText(), 'Projects.Owner(Ref)');
  });

  it('reloading the page keeps the options', async function() {
    await gu.reloadDoc();
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    assert.equal(await configText(), 'People.Projects(RefList)');

    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');
    assert.equal(await configText(), 'Projects.Owner(Ref)');
  });

  it('relationship can be removed through the right column', async function() {
    await removeTwoWay();
    await removeModal.confirm();
    await gu.waitForServer();
    assert.deepEqual(await columns(), [
      ['Name'],
      ['Name', 'Projects']
    ]);
  });

  it('undo works', async function() {
    // First revert all changes.
    await revert();
    await gu.checkForErrors();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);

    // Now redo all changes.
    await gu.redoAll();
    await gu.checkForErrors();
    assert.deepEqual(await columns(), [
      ['Name'],
      ['Name', 'Projects']
    ]);

    await revert();
    await gu.checkForErrors();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);

    // And now check individual changes.
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    assert.isTrue(await canAddReverseColumn());

    // Now add and do a single undo to make sure it is bundled.
    await addReverseColumn();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name', 'Projects']
    ]);
    await gu.undo(1);
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
  });

  it('can delete left column', async function() {
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    await addReverseColumn();
    await gu.deleteColumn('Owner');
    await gu.checkForErrors();
    assert.deepEqual(await columns(), [
      ['Name'],
      ['Name', 'Projects']
    ]);
    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');
    assert.isTrue(await canAddReverseColumn());
    await gu.deleteColumn('Projects');
    await gu.checkForErrors();
    await revert();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
  });

  it('can delete right column', async function() {
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    await addReverseColumn();
    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');
    await gu.deleteColumn('Projects');
    await gu.checkForErrors();
    assert.deepEqual(await columns(), [
      ['Name', 'Owner'],
      ['Name']
    ]);
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    assert.isFalse(await isConfigured());
  });

  it('syncs columns', async function() {
    await gu.selectSectionByTitle('Projects');
    await gu.openColumnPanel('Owner');
    await gu.setRefShowColumn('Name');
    await addReverseColumn();

    // Show better names.
    await gu.selectSectionByTitle('People');
    await gu.openColumnPanel('Projects');
    await gu.setRefShowColumn('Name');

    // Add two projects.
    await gu.sendActions([
      ['AddRecord', 'Projects', null, {Name: 'Apps'}],
      ['AddRecord', 'Projects', null, {Name: 'Backend'}],
    ]);
    // Add two people.
    await gu.sendActions([
      ['AddRecord', 'People', null, {Name: 'Alice'}],
      ['AddRecord', 'People', null, {Name: 'Bob'}],
    ]);

    // Now assign Bob to Backend and Alice to Apps.
    await gu.selectSectionByTitle('Projects');
    await gu.getCell('Owner', 1).click();
    await gu.enterCell('Alice');
    await gu.getCell('Owner', 2).click();
    await gu.enterCell('Bob');

    // And now make sure the reverse reference is correct.
    await gu.selectSectionByTitle('People');
    assert.deepEqual(await gu.getVisibleGridCells('Name', [1, 2]), ['Alice', 'Bob']);
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2]), ['Apps', 'Backend']);
  });

  it('sync columns when edited from right', async function() {
    await gu.getCell('Projects', 1).click();
    // Remove the project from Alice.
    await gu.sendKeys(Key.DELETE);
    await gu.waitForServer();
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['', 'Backend']);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['', 'Bob']);
    // Single undo restores it.
    await gu.undo(1);
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['Apps', 'Backend']);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['Alice', 'Bob']);

    await gu.redo(1);
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['', 'Backend']);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['', 'Bob']);

    await gu.undo(1);
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['Apps', 'Backend']);
    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['Alice', 'Bob']);
  });

  it('honors relations from list to single', async function() {
    // Now make Alice owner of Backend project. Apps project should now have no owner,
    // and Bob shouldn't be owner of Backend.

    const checkInitial = async () => {
      assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['Alice', 'Bob']);
      assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['Apps', 'Backend']);
    };
    await checkInitial();

    await gu.selectSectionByTitle('People');
    await gu.getCell('Projects', 1).click();
    await gu.sendKeys('Backend');
    await gu.sendKeys(Key.ENTER);
    await gu.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // We should see a modal dialog
    await driver.findWait('.test-modal-dialog', 100);

    // We should have an option there.
    assert.equal(
      await driver.findWait('.test-modal-dialog label', 100).getText(),
      'Reassign to People record "Alice".'
    );

    // Reassign it.
    await driver.findWait('.test-modal-dialog input', 100).click();
    await driver.findWait('.test-modal-dialog button', 100).click();
    await gu.waitForServer();

    assert.deepEqual(await gu.getVisibleGridCells('Owner', [1, 2], 'Projects'), ['', 'Alice']);
    assert.deepEqual(await gu.getVisibleGridCells('Projects', [1, 2], 'People'), ['Backend', '']);

    // Single undo restores it.
    await gu.undo(1);
    await checkInitial();
  });


  it('creates proper names when added multiple times', async function() {
    const revert = await gu.begin();

    // Add another reference to Projects from People.
    await gu.selectSectionByTitle('Projects');
    await gu.addColumn('Tester', 'Reference');
    await gu.setRefTable('People');
    await gu.setRefShowColumn('Name');

    // And now show it on People.
    await addReverseColumn();

    // We should now see 3 columns on People.
    await gu.selectSectionByTitle('People');
    assert.deepEqual(await gu.getColumnNames(), ['Name', 'Projects', 'Projects-Tester']);

    // Add yet another one.
    await gu.selectSectionByTitle('Projects');
    await gu.addColumn('PM', 'Reference');
    await gu.setRefTable('People');
    await gu.setRefShowColumn('Name');
    await addReverseColumn();

    // We should now see 4 columns on People.
    await gu.selectSectionByTitle('People');
    assert.deepEqual(await gu.getColumnNames(), ['Name', 'Projects', 'Projects-Tester', 'Projects-PM']);

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
    await addReverseColumn();

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

const canAddReverseColumn = async () => {
  return await driver.findWait('.test-add-reverse-columm', 100).isPresent();
};

const isConfigured = async () => {
  if (!await driver.find('.test-reverse-column-label').isPresent()) {
    return false;
  }
  return await driver.findWait('.test-reverse-column-label', 100).isDisplayed();
};

const addReverseColumn = () => driver.findWait('.test-add-reverse-columm', 100)
                              .click().then(() => gu.waitForServer());

const removeTwoWay = () => driver.findWait('.test-remove-reverse-column', 100).click()
                                  .then(() => gu.waitForServer());

const configText = async () => {
  const text = await driver.findWait('.test-reverse-column-label', 100).getText();
  return text.trim().split('\n').join('').replace('COLUMN', '.').replace("TARGET TABLE", "");
};

const removeModal = {
  wait: async () => assert.isTrue(await driver.findWait('.test-modal-confirm', 100).isDisplayed()),
  confirm: () => driver.findWait('.test-modal-confirm', 100).click().then(() => gu.waitForServer()),
  cancel: () => driver.findWait('.test-modal-cancel', 100).click(),
  checkUnlink: () => driver.findWait('.test-option-unlink', 100).click(),
  checkRemove: () => driver.findWait('.test-option-remove', 100).click(),
};


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
