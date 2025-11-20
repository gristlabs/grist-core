import {DocCreationInfo} from 'app/common/DocListAPI';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('FieldEditor', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  gu.bigScreen();

  afterEach(() => gu.checkForErrors());
  let doc: DocCreationInfo;
  let api: UserAPI;

  before(async () => {
    // Log in and open a sample doc
    const mainSession = await gu.session().teamSite.login();
    doc = await mainSession.tempDoc(cleanup, 'Favorite_Films.grist');
    api = mainSession.createHomeApi();
  });

  it('should close editor without saving on any column', async function() {
    // This tests a bug, when the editor is opened and closed on the any column (without typing),
    // the column is converted to a Text Column (value is updated with an empty string).
    await gu.addNewTable();
    await (await gu.openRowMenu(1)).findContent('li', /Insert row above/).click();
    await gu.waitForServer();
    await gu.getCell(0, 1).click();
    await gu.sendKeys(Key.ENTER);
    await gu.checkTextEditor(gu.exactMatch(""));
    await gu.getCell(2, 1).click(); // Click away to save
    await gu.waitForServer(); // Server receives an empty string, which isn't enough to change type to Text
    await gu.getCell(0, 1).click();
    // Make sure it is still Any column.
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    assert.equal(await driver.find('.test-fbuilder-type-select').getText(), "Any");
    await gu.undo(3);
  });

  it('should close field editor on switching page', async function() {
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Films/);

    // Open a cell in 'add-row' for editing, and start typing.
    await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.DOWN));
    assert.deepEqual(await gu.getCursorPosition(), {rowNum: 7, col: 0});
    await driver.sendKeys("FieldEditor1");
    assert.equal(await driver.find('.cell_editor').isDisplayed(), true);

    // Click another page.
    await driver.findContent('.test-treeview-itemHeader', /Friends/).doClick();
    await gu.waitForServer();
    assert.match(await driver.find('.test-treeview-itemHeader.selected').getText(), /Friends/);

    // Cell editor should close.
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    await gu.waitForServer();

    // Enter a value into a Reference column; we add a non-existent value using the "+" button in
    // the auto-complete dropdown since that triggers the harder case with two async actions.
    await gu.getCell({rowNum: 2, col: 1}).click();
    assert.equal(await gu.getCell({rowNum: 2, col: 1}).getText(), 'Toy Story');
    await driver.sendKeys("FieldEditor-New");
    await driver.sendKeys(Key.UP);      // Select the last "+" item.
    assert.equal(await driver.find('.test-ref-editor-new-item').matches('.selected'), true);
    assert.equal(await driver.find('.cell_editor').isPresent(), true);

    // Switch back; check that the previous value got saved.
    await driver.findContent('.test-treeview-itemHeader', /Films/).doClick();
    await gu.waitForServer();
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    assert.equal(await gu.getCell({rowNum: 7, col: 0}).getText(), 'FieldEditor1');
    assert.equal(await gu.getCell({rowNum: 8, col: 0}).getText(), 'FieldEditor-New');

    // Switch and check that the Reference value got saved.
    await driver.findContent('.test-treeview-itemHeader', /Friends/).doClick();
    assert.equal(await gu.getCell({rowNum: 2, col: 1}).getText(), 'FieldEditor-New');

    await gu.undo(3);
  });

  it('should close field editor when code viewer is opened', async function() {
    await driver.findContent('.test-treeview-itemHeader', /Friends/).doClick();
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), "Roger");
    await gu.getCell({rowNum: 1, col: 0}).click();
    await gu.sendKeys("FieldEditor2");
    assert.equal(await driver.find('.cell_editor').isDisplayed(), true);

    // Switch to code editor page.
    await driver.find('.test-tools-code').doClick();
    assert.equal(await driver.find('.test-bc-page').value(), 'code');
    assert.equal(await driver.find('.cell_editor').isPresent(), false);
    await gu.waitForServer();

    // When we go back, we should see the value in the cell saved.
    await driver.findContent('.test-treeview-itemHeader', /Friends/).doClick();

    // Check that the value got saved.
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), "FieldEditor2");
    await gu.undo(1);
  });

  it('should prompt when navigating away with editor open', async function() {
    await driver.findContent('.test-treeview-itemHeader', /Films/).doClick();
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), "Toy Story");
    await gu.getCell({rowNum: 1, col: 0}).click();

    await gu.sendKeys("FieldEditor3");
    assert.equal(await driver.find('.cell_editor').isPresent(), true);

    // Navigating away, we should get a prompt. Dismiss it to stay on the page.
    await driver.get('about:blank');
    await driver.switchTo().alert().dismiss();
    assert.equal(await driver.findWait('.cell_editor', 500).isPresent(), true);

    // Once saved, we can navigate away.
    await driver.sendKeys(Key.ENTER);
    await driver.get('about:blank');
    assert.equal(await driver.find('.cell_editor').isPresent(), false);

    // Navigate back to see the value saved.
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), "FieldEditor3");
  });

  describe('should scroll when editor is activated', () => {
    before(async () => {
      const records = new Array(200).fill(['AddRecord', 'Table1', null, { A: 'Text', B: 'Text' }]);
      await api.applyUserActions(doc.id, [
        ['AddTable', 'Table1', [ {id: 'A', type: 'Text'}, {id: 'B', type: 'Text'}]],
        ...records
      ]);
      await gu.waitForServer();
      await driver.findContent('.test-treeview-itemHeader', /Table1/).click();
      // Add Card List view
      await gu.openAddWidgetToPage();
      await driver.findContentWait('.test-wselect-type', /Card List/, 500).click();
      // Select Table1
      await driver.findContent('.test-wselect-table', /Table1/).click();
      // Press add
      await driver.find('.test-wselect-addBtn').click();
      await gu.waitForServer();
    });

    // Some long text, to make sure it is all typed in.
    const sampleText = "Test0000000000000000000000000000000000000000000123";
    // Scroll 2 rows, to hide the first row. By scrolling only two rows, the active row is still rendered.
    // Then scroll 150 (arbitrary big number) rows, which removes the active record from the
    // dom (replaces it with another). Actually it would be enough to scroll by 5 records only.
    for (const rowCount of [2, 150]) {
      it(`in a GridView scrolled by ${rowCount} rows `, async function() {
        await gu.getCell(0, 1, 'TABLE1').click();
        // Scroll
        await gu.scrollActiveView(0, 23 * rowCount); // 23 is row height.
        await driver.sendKeys(sampleText);
        await gu.checkTextEditor(gu.exactMatch(sampleText));
        await driver.sendKeys(Key.ESCAPE);
        await gu.waitAppFocus(true);
        // Second cell should be clickable - this means view was scrolled to the active record.
        await gu.getCell(1, 1).click();
        await gu.waitForServer();
        await gu.checkForErrors();
      });

      it(`in a Detail view scrolled by ${rowCount} cards`, async function() {
        await gu.getDetailCell('A', 1, 'TABLE1 Card List').click();
        // Scroll (for CardList it will not scroll exactly, but close enough for the test).
        await gu.scrollActiveView(0, 100 * rowCount); // 100 is card height.
        await driver.sendKeys(sampleText);
        await gu.checkTextEditor(gu.exactMatch(sampleText));
        await driver.sendKeys(Key.ESCAPE);
        await gu.waitAppFocus(true);
        // Second field should be clickable - this means view was scrolled to the active card.
        await gu.getDetailCell('B', 1).click();
        await gu.waitForServer();
        await gu.checkForErrors();
      });
    }
  });
});
