import {assert, driver, Key, stackWrapFunc} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {Session} from 'test/nbrowser/gristUtils';

describe('ReferenceList', function() {
  this.timeout(60000);
  let session: Session;
  const cleanup = setupTestSuite({team: true});

  before(async function() {
    session = await gu.session().teamSite.login();
  });

  describe('other', function() {
    it('allows to delete document with self reference', async function() {
      const docId = await session.tempNewDoc(cleanup);
      await gu.sendActions([
        ['AddEmptyTable', 'Table2'],
        ['ModifyColumn', 'Table1', 'B', {type: 'RefList:Table1'}],
        ['AddRecord', 'Table1', null, {A: 'a'}],
        ['AddRecord', 'Table1', null, {A: 'b', B: ["L", 1]}],
        ['AddRecord', 'Table1', null, {A: 'c', B: ["L", 2]}],
      ]);

      // Now try to delete the table.
      await gu.removeTable('Table1');
      await gu.checkForErrors();

      // Make sure table is deleted. Previously it ended with an engine error
      // in the 'a' row which has NULL instead of a list of ids.
      const api = session.createHomeApi().getDocAPI(docId);
      const tables = await api.getRows('_grist_Tables');
      assert.deepEqual(tables.tableId, ['Table2']);
    });
  });

  describe('transforms', function() {

    before(async function() {
      await session.tempDoc(cleanup, 'Favorite_Films.grist');
      await gu.toggleSidePanel('right');
      await driver.find(".test-right-tab-pagewidget").click();
      await driver.find('.test-config-data').click();
    });

    afterEach(() => gu.checkForErrors());

    it('should correctly transform references to reference lists', async function() {
      // Open the Friends page.
      await driver.findContentWait('.test-treeview-itemHeader', /Friends/, 2000).click();
      await gu.waitForDocToLoad();

      // Change the column type of Favorite Film to Reference List.
      await gu.getCell({col: 'Favorite Film', rowNum: 1}).doClick();
      await gu.setType(/Reference List/);

      // Check that the column preview shows valid reference lists.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6, 7]),
        [
          'Forrest Gump',
          'Toy Story',
          'Avatar',
          'The Dark Knight',
          'Forrest Gump',
          'Alien',
          ''
        ]
      );

      // Apply the conversion.
      await driver.findContent('.type_transform_prompt button', /Apply/).click();
      await gu.waitForServer();

      // Check that Favorite Film now contains reference lists of length 1.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6, 7]),
        [
          'Forrest Gump',
          'Toy Story',
          'Avatar',
          'The Dark Knight',
          'Forrest Gump',
          'Alien',
          ''
        ]
      );
    });
  });

  describe('rendering', function() {
    afterEach(() => gu.checkForErrors());

    it('should reflect the current values from the referenced column', async function() {
      // Open the All page.
      await driver.findContentWait('.test-treeview-itemHeader', /All/, 2000).click();
      await gu.waitForDocToLoad();

      // Add additional favorite films to a few rows in Friends.
      await gu.getCell('Favorite Film', 1, 'Friends record').doClick();
      await gu.sendKeys(Key.ENTER, 'Alien', Key.ENTER, Key.ENTER);
      await gu.sendKeys(Key.ENTER, 'Avatar', Key.ENTER, 'The Avengers', Key.ENTER, Key.ENTER);
      await gu.sendKeys(Key.ARROW_DOWN, Key.ENTER, 'The Avengers', Key.ENTER, Key.ENTER);

      // Check that the cells are rendered correctly.
      await gu.resizeColumn({col: 'Favorite Film'}, 100);
      assert.deepEqual(await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6]),
        [
          'Forrest Gump\nAlien',
          'Toy Story\nAvatar\nThe Avengers',
          'Avatar',
          'The Dark Knight\nThe Avengers',
          'Forrest Gump',
          'Alien'
        ]
      );

      // Change a few of the film titles.
      await gu.getCell('Title', 1, 'Films record').doClick();
      await gu.sendKeys('Toy Story 2', Key.ENTER);
      await gu.sendKeys(Key.ARROW_DOWN, 'Aliens', Key.ENTER);
      await gu.sendKeys(Key.ARROW_DOWN, 'The Dark Knight Rises', Key.ENTER);

      // Check that the Favorite Film column reflects the new titles.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\nAvatar\nThe Avengers',
          'Avatar',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );
    });

    it(`should show '[Blank]' if the referenced item is blank`, async function() {
      // Clear the cell in Films record containing Avatar.
      await gu.getCell('Title', 4, 'Films record').doClick();
      await gu.sendKeys(Key.BACK_SPACE);
      await gu.waitForServer();

      // Check that all references to Avatar now show '[Blank]'.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\n[Blank]\nThe Avengers',
          '[Blank]',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );

      // Check that a '[Blank]' token is shown when the reference list editor is open.
      await gu.getCell('Favorite Film', 2, 'Friends record').doClick();
      await gu.sendKeys(Key.ENTER);
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['Toy Story 2', '[Blank]', 'The Avengers']
      );
      await gu.sendKeys(Key.ESCAPE);

      // Undo, and check that it shows Avatar again.
      await gu.undo();
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\nAvatar\nThe Avengers',
          'Avatar',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );

      // Now delete the row containing Avatar.
      await gu.getCell('Title', 4, 'Films record').doClick();
      await gu.removeRow(4);

      // Check that all references to Avatar are deleted.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\nThe Avengers',
          '',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );

      await gu.undo();
    });

    it('should still work after renaming visible column', async function() {
      // Check that we have a Ref:Films column displaying Title.
      await gu.getCell({section: 'Friends record', col: 'Favorite Film', rowNum: 2}).doClick();
      assert.equal(await driver.find('.test-fbuilder-ref-table-select .test-select-row').getText(), 'Films');
      assert.equal(await driver.find('.test-fbuilder-ref-col-select .test-select-row').getText(), 'Title');

      // Rename the Title column in Films, to TitleX.
      // In browser tests, first record is hidden, we need to scroll first.
      await gu.selectSectionByTitle('Films record');
      await gu.scrollActiveView(0, -100);
      await gu.getCell({section: 'Films record', col: 'Title', rowNum: 1}).doClick();
      await driver.find('.test-field-label').click();
      await gu.sendKeys(await gu.selectAllKey(), 'TitleX', Key.ENTER);
      await gu.waitForServer();

      // Check that the Ref:Films column shows TitleX and is still correct.
      await gu.getCell({section: 'Friends record', col: 'Favorite Film', rowNum: 2}).doClick();
      await driver.find('.test-fbuilder-ref-table-select').click();
      assert.equal(await driver.find('.test-fbuilder-ref-table-select .test-select-row').getText(), 'Films');
      assert.equal(await driver.find('.test-fbuilder-ref-col-select .test-select-row').getText(), 'TitleX');
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6]),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\nAvatar\nThe Avengers',
          'Avatar',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );

      // Undo and verify again.
      await gu.undo();
      await gu.getCell({section: 'Friends record', col: 'Favorite Film', rowNum: 2}).doClick();
      assert.equal(await driver.find('.test-fbuilder-ref-col-select .test-select-row').getText(), 'Title');
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6]),
        [
          'Forrest Gump\nAliens',
          'Toy Story 2\nAvatar\nThe Avengers',
          'Avatar',
          'The Dark Knight Rises\nThe Avengers',
          'Forrest Gump',
          'Aliens'
        ]
      );
    });

    it('should switch to rowId if the selected visible column is deleted', async function() {
      // Delete the Title column from Films.
      await gu.getCell({section: 'Films record', col: 'Title', rowNum: 1}).doClick();
      await gu.sendKeys(Key.chord(Key.ALT, '-'));
      await gu.waitForServer();

      // Check that Favorite Film switched to showing RowID.
      await gu.getCell({section: 'Friends record', col: 'Favorite Film', rowNum: 2}).doClick();
      assert.equal(await driver.find('.test-fbuilder-ref-table-select .test-select-row').getText(), 'Films');
      assert.equal(await driver.find('.test-fbuilder-ref-col-select .test-select-row').getText(), 'Row ID');
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6]),
        [
          'Films[2]\nFilms[3]',
          'Films[1]\nFilms[4]\nFilms[6]',
          'Films[4]',
          'Films[5]\nFilms[6]',
          'Films[2]',
          'Films[3]'
        ]
      );

      await gu.undo();
    });

    it('should render Row ID values as TableId[RowId]', async function() {
      await driver.findContentWait('.test-treeview-itemHeader', /Friends/, 2000).click();
      await gu.waitForDocToLoad();

      // Create a new Reference List column.
      await driver.find('.test-right-tab-field').click();
      await driver.find('.mod-add-column').click();
      await driver.findWait('.test-new-columns-menu-add-new', 100).click();

      await gu.waitForServer();
      await gu.setType(/Reference List/);
      await gu.waitForServer();

      // Populate the first few rows of the new column with some references.
      await gu.getCell({rowNum: 1, col: 'A'}).click();
      await driver.sendKeys('1', Key.ENTER, '2', Key.ENTER, Key.ENTER);
      await driver.sendKeys('2', Key.ENTER, Key.ENTER);
      await driver.sendKeys('3', Key.ENTER, '4', Key.ENTER, '5', Key.ENTER, Key.ENTER);

      // Check that the cells render their tokens as TableId[RowId].
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Friends[1]\nFriends[2]', 'Friends[2]', 'Friends[3]\nFriends[4]\nFriends[5]', '', '', '']);

      // Check that switching Shown Column to Name works correctly.
      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Name/).click();
      await gu.waitForServer();
      await gu.resizeColumn({col: 'A'}, 100);
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Roger\nTom', 'Tom', 'Sydney\nBill\nEvan', '', '', '']);

      // Add a new reference.
      await gu.getCell(3, 5).click();
      await driver.sendKeys('Roger');
      await driver.sendKeys(Key.ENTER, Key.ENTER);
      await gu.waitForServer();

      // Check that switching between Row ID and Name still works correctly.
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Roger\nTom', 'Tom', 'Sydney\nBill\nEvan', '', 'Roger', '']);
      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Row ID/).click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Friends[1]\nFriends[2]', 'Friends[2]', 'Friends[3]\nFriends[4]\nFriends[5]', '', 'Friends[1]', '']);
      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Name/).click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Roger\nTom', 'Tom', 'Sydney\nBill\nEvan', '', 'Roger', '']);

      await gu.undo();
    });

    it('should allow entering numeric id before target table is loaded', async function() {
      if (server.isExternalServer()) {
        this.skip();
      }
      // Refresh the document.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();

      // Now pause the server.
      const cell = gu.getCell({col: 'A', rowNum: 1});
      await server.pauseUntil(async () => {
        assert.equal(await cell.getText(), 'Friends[1]\nFriends[2]');
        await gu.clickReferenceListCell(cell);
        await gu.sendKeys('5');
        // Check that the autocomplete has no items yet.
        assert.isEmpty(await driver.findAll('.test-autocomplete .test-ref-editor-new-item'));
        await gu.sendKeys(Key.ENTER, Key.ENTER);
      });
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Friends[5]');

      await gu.undo();
      assert.equal(await cell.getText(), 'Friends[1]\nFriends[2]');

      // Once server is responsive, a valid value should not offer a "new item".
      await gu.clickReferenceListCell(cell);
      await gu.sendKeys('5');
      await driver.findWait('.test-ref-editor-item', 500);
      assert.isFalse(await driver.find('.test-ref-editor-new-item').isPresent());
      await gu.sendKeys(Key.ENTER, Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Friends[5]');
    });
  });

  describe('sorting', function() {
    afterEach(() => gu.checkForErrors());

    it('should sort by the display values of the referenced column', async function() {
      this.timeout(10000);
      await driver.findContentWait('.test-treeview-itemHeader', /All/, 2000).click();
      await gu.waitForDocToLoad();
      await gu.getCell('Favorite Film', 1, 'Friends record').doClick();

      await driver.find('.test-right-tab-pagewidget').click();
      await driver.find('.test-config-sortAndFilter').click();

      // Sort the Favorite Film column.
      await gu.addColumnToSort('Favorite Film');
      await gu.saveSortConfig();

      // Check that the records are sorted by display value.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Aliens',
          'Avatar',
          'Forrest Gump',
          'Forrest Gump\nAliens',
          'The Dark Knight Rises\nThe Avengers',
          'Toy Story 2\nAvatar\nThe Avengers'
        ]
      );
    });

    it("should update sort when display column is changed", async function() {
      // Change a film title to cause the sort order to change.
      await gu.getCell('Title', 5, 'Films record').doClick();
      await gu.sendKeys('Batman Begins', Key.ENTER);
      await gu.waitForServer();

      // Check that the updated sort order is correct.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Aliens',
          'Avatar',
          'Batman Begins\nThe Avengers',
          'Forrest Gump',
          'Forrest Gump\nAliens',
          'Toy Story 2\nAvatar\nThe Avengers'
        ]
      );

      // Clear a film title to cause the sort order to change.
      await gu.getCell('Title', 2, 'Films record').doClick();
      await gu.sendKeys(Key.BACK_SPACE);
      await gu.waitForServer();

      // Check that the updated sort order is correct.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          '[Blank]',
          '[Blank]\nAliens',
          'Aliens',
          'Avatar',
          'Batman Begins\nThe Avengers',
          'Toy Story 2\nAvatar\nThe Avengers'
        ]
      );

      // Clear a film reference to cause the sort order to change.
      await gu.getCell('Favorite Film', 4, 'Friends record').doClick();
      await gu.sendKeys(Key.BACK_SPACE);
      await gu.waitForServer();

      // Check that the updated sort order is correct.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          '',
          '[Blank]',
          '[Blank]\nAliens',
          'Aliens',
          'Batman Begins\nThe Avengers',
          'Toy Story 2\nAvatar\nThe Avengers'
        ]
      );
    });

    it("should sort consistently when column contains AltText", async function() {
      // Enter an invalid reference in Favorite Film.
      await gu.getCell('Favorite Film', 4, 'Friends record').doClick();
      await gu.sendKeys('Aliens 4', Key.ENTER, Key.ENTER);
      await gu.waitForServer();

      // Check that the updated sort order is correct.
      // Accept '[u\'Aliens 4\']' as a py2 variant of '[\'Aliens 4\']'
      const variant = await gu.getCell('Favorite Film', 1, 'Friends record').getText();
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          variant.startsWith('[u') ? '[u\'Aliens 4\']' : '[\'Aliens 4\']',
          '',
          '[Blank]',
          '[Blank]\nAliens',
          'Batman Begins\nThe Avengers',
          'Toy Story 2\nAvatar\nThe Avengers'
        ]
      );
    });
  });

  describe('autocomplete', function() {
    const getACOptions = stackWrapFunc(async (limit?: number) => {
      await driver.findWait('.test-ref-editor-item', 1000);
      return (await driver.findAll('.test-ref-editor-item', el => el.getText())).slice(0, limit);
    });

    before(async function() {
      await session.tempDoc(cleanup, 'Ref-List-AC-Test.grist');
      await gu.toggleSidePanel('right', 'close');
    });

    afterEach(() => gu.checkForErrors());

    it('should render first items when opening empty cell', async function() {
      await driver.sendKeys(Key.HOME);

      let cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 4}).doClick();
      assert.equal(await cell.getText(), '');
      await driver.sendKeys(Key.ENTER);
      // Check the first few items.
      assert.deepEqual(await getACOptions(3), ["Alice Blue", "Añil", "Aqua"]);
      // No item is selected.
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'Schools', rowNum: 6}).doClick();
      assert.equal(await cell.getText(), '');
      await driver.sendKeys(Key.ENTER);
      // Check the first few items; should be sorted alphabetically.
      assert.deepEqual(await getACOptions(3),
        ["2 SCHOOL", "4 SCHOOL", "47 AMER SIGN LANG & ENG LOWER "]);
      // No item is selected.
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      await driver.sendKeys(Key.ESCAPE);
    });

    it('should save correct item on click', async function() {
      await driver.sendKeys(Key.HOME);

      // Edit a cell by double-clicking.
      let cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 2}).doClick();
      await driver.withActions(a => a.doubleClick(cell));

      // Scroll to another item and click it.
      await gu.sendKeys('ro');
      let item = driver.findContent('.test-ref-editor-item', 'Rosy Brown');
      await gu.scrollIntoView(item);
      await item.click();

      // It should get added; and undo should revert adding it.
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['Red', 'Rosy Brown']
      );
      await gu.sendKeys(Key.chord(await gu.modKey(), 'z'));
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['Red']
      );
      await gu.sendKeys(Key.ESCAPE);
      assert.equal(await cell.getText(), 'Red');

      // Edit another cell by starting to type.
      cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 4}).doClick();
      await driver.sendKeys("gr");
      await driver.findWait('.test-ref-editor-item', 1000);
      item = driver.findContent('.test-ref-editor-item', 'Medium Sea Green');
      await gu.scrollIntoView(item);
      await item.click();
      await gu.sendKeys(Key.ENTER);

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Medium Sea Green');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should save correct item after selecting with arrow keys', async function() {
      // Same as the previous test, but instead of clicking items, select item using arrow keys.

      // Edit a cell by double-clicking.
      let cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 2}).doClick();
      await driver.withActions(a => a.doubleClick(cell));

      // Move to another item and hit Enter
      await gu.sendKeys('pa');
      await driver.sendKeys(Key.DOWN, Key.DOWN, Key.DOWN);
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Pale Violet Red');
      await driver.sendKeys(Key.ENTER);

      // It should get added; and undo should revert adding it.
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['Red', 'Pale Violet Red']
      );
      await gu.sendKeys(Key.chord(await gu.modKey(), 'z'));
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['Red']
      );
      await gu.sendKeys(Key.ESCAPE);
      assert.equal(await cell.getText(), 'Red');

      // Edit another cell by starting to type.
      cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 4}).doClick();
      await driver.sendKeys("gr");
      await driver.findWait('.test-ref-editor-item', 1000);
      await driver.sendKeys(Key.UP, Key.UP, Key.UP, Key.UP, Key.UP);
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Chocolate');
      await driver.sendKeys(Key.ENTER, Key.ENTER);

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Chocolate');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should return to text-as-typed when nothing is selected', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 2}).doClick();
      await driver.sendKeys("da");
      assert.deepEqual(await getACOptions(2), ["Dark Blue", "Dark Cyan"]);

      // Check that the first item is highlighted by default.
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), 'da');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Blue');

      // Select second item. Both the textbox and the dropdown show the selection.
      await driver.sendKeys(Key.DOWN);
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), 'Dark Cyan');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Cyan');

      // Move back to no-selection state.
      await driver.sendKeys(Key.UP, Key.UP);
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), 'da');
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);

      // Clear the typed-in text temporarily. Something changed in a recent version of Chrome,
      // causing the wrong item to be moused over below when the "Add New" option is visible.
      await driver.sendKeys(Key.BACK_SPACE, Key.BACK_SPACE);

      // Mouse over an item.
      await driver.findContent('.test-ref-editor-item', /Dark Gray/).mouseMove();
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), 'Dark Gray');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Gray');

      // Mouse back out of the dropdown
      await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').mouseMove();
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), '');
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);

      // Re-enter the typed-in text and click away. Check the cell is now empty since
      // no reference items were added.
      await driver.sendKeys('da', Key.UP);
      await gu.getCell({section: 'References', col: 'Colors', rowNum: 1}).doClick();
      await gu.waitForServer();
      assert.equal(await cell.getText(), "");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), false);

      await gu.undo();
      assert.equal(await cell.getText(), "Red");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), false);
    });

    it('should save text as typed when nothing is selected', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 1}).doClick();
      await driver.sendKeys("lavender ", Key.ENTER, Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), "Lavender");
      await gu.undo();
      assert.equal(await cell.getText(), "Dark Slate Blue");
    });

    it('should offer an add-new option when no good match', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 2}).doClick();
      await driver.sendKeys("pinkish");
      // There are inexact matches.
      assert.deepEqual(await getACOptions(3),
        ["Pink", "Deep Pink", "Hot Pink"]);
      // Nothing is selected, and the "add new" item is present.
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      assert.equal(await driver.find('.test-ref-editor-new-item').getText(), "pinkish");

      // Click the "add new" item. The new value should be added, and should not appear invalid.
      await driver.find('.test-ref-editor-new-item').click();
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['pinkish']
      );
      assert.deepEqual(
        await driver.findAll(
          '.cell_editor .test-tokenfield .test-tokenfield-token',
          el => el.matches('[class*=-invalid]')
        ),
        [false]
      );

      // Add another new item (with the keyboard), and check that it also appears correctly.
      await driver.sendKeys("almost pink", Key.ARROW_UP, Key.ENTER);
      assert.deepEqual(
        await driver.findAll('.cell_editor .test-tokenfield .test-tokenfield-token', el => el.getText()),
        ['pinkish', 'almost pink']
      );
      assert.deepEqual(
        await driver.findAll(
          '.cell_editor .test-tokenfield .test-tokenfield-token',
          el => el.matches('[class*=-invalid]')
        ),
        [false, false]
      );

      // Save the changes to the cell.
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), "pinkish\nalmost pink");

      // Check that the referenced table now has "pinkish" and "almost pink".
      await driver.findContentWait('.test-treeview-itemHeader', /Colors/, 2000).click();
      await gu.waitForDocToLoad();
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.ARROW_DOWN));
      assert.deepEqual(
        await gu.getVisibleGridCells('Color Name', [146, 147]),
        ['pinkish', 'almost pink']
      );
      assert.deepEqual(
        await gu.getVisibleGridCells('C2', [146, 147]),
        ['pinkish', 'almost pink']
      );

      // Requires 2 undos, because adding the "pinkish" and "almost pink" records is a separate action. TODO these
      // actions should be bundled.
      await gu.undo(2);
      assert.equal(await gu.getCell({section: 'References', col: 'Colors', rowNum: 2}).getText(), 'Red');
    });

    it('should not offer an add-new option when target is a formula', async function() {
      // Click on an alt-text cell.
      const cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 3}).doClick();
      assert.equal(await cell.getText(), "hello");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), true);

      await driver.sendKeys(Key.ENTER, 'hello');
      assert.equal(await driver.find('.test-ref-editor-new-item').getText(), "hello");
      await driver.sendKeys(Key.ESCAPE);

      // Change the visible column to the formula column "C2".
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /C2/).click();
      await gu.waitForServer();

      // Check that for the same cell, the dropdown no longer has an "add new" option.
      await cell.click();
      await driver.sendKeys(Key.ENTER, 'hello');
      await driver.findWait('.test-ref-editor-item', 1000);
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      assert.equal(await driver.find('.test-ref-editor-new-item').isPresent(), false);
      await driver.sendKeys(Key.ESCAPE);

      await gu.undo();
      await gu.toggleSidePanel('right', 'close');
    });

    it('should offer items ordered by best match', async function() {
      let cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 1}).doClick();
      assert.equal(await cell.getText(), 'Dark Slate Blue');
      await driver.sendKeys(Key.ENTER, 'Dark Slate Blue');
      assert.deepEqual(await getACOptions(4),
        ['Dark Slate Blue', 'Dark Slate Gray', 'Slate Blue', 'Medium Slate Blue']);
      await driver.sendKeys(Key.ESCAPE);

      // Starting to type Añil with the accent
      await driver.sendKeys('añ');
      assert.deepEqual(await getACOptions(2),
        ['Añil', 'Alice Blue']);
      await driver.sendKeys(Key.ESCAPE);

      // Starting to type Añil without the accent should work too
      await driver.sendKeys('an');
      assert.deepEqual(await getACOptions(2),
        ['Añil', 'Alice Blue']);
      await driver.sendKeys(Key.ESCAPE);

      await driver.sendKeys('blac');
      assert.deepEqual(await getACOptions(6),
        ['Black', 'Blanched Almond', 'Blue', 'Blue Violet', 'Alice Blue', 'Cadet Blue']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 3}).doClick();
      assert.equal(await cell.getText(), 'hello');    // Alt-text
      await driver.sendKeys('hello');
      assert.deepEqual(await getACOptions(2),
        ['Honeydew', 'Hot Pink']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'ColorCodes', rowNum: 2}).doClick();
      assert.equal(await cell.getText(), '#808080');
      await driver.sendKeys('#808080');
      assert.deepEqual(await getACOptions(5),
        ['#808080', '#808000', '#800000', '#800080', '#87CEEB']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'XNums', rowNum: 2}).doClick();
      assert.equal(await cell.getText(), '2019-04-29');
      await driver.sendKeys('2019-04-29');
      assert.deepEqual(await getACOptions(4),
        ['2019-04-29', '2020-04-29', '2019-11-05', '2020-04-28']);
      await driver.sendKeys(Key.ESCAPE);
    });

    it('should update choices as user types into textbox', async function() {
      let cell = await gu.getCell({section: 'References', col: 'Schools', rowNum: 1});
      await gu.clickReferenceListCell(cell);
      assert.equal(await cell.getText(), 'TECHNOLOGY, ARTS AND SCIENCES STUDIO');
      await driver.sendKeys('TECHNOLOGY, ARTS AND SCIENCES STUDIO');
      assert.deepEqual(await getACOptions(3), [
        'TECHNOLOGY, ARTS AND SCIENCES STUDIO',
        'SCIENCE AND TECHNOLOGY ACADEMY',
        'SCHOOL OF SCIENCE AND TECHNOLOGY',
      ]);
      await driver.sendKeys(Key.ESCAPE);
      cell = await gu.getCell({section: 'References', col: 'Schools', rowNum: 2});
      await gu.clickReferenceListCell(cell);
      await driver.sendKeys('stuy');
      assert.deepEqual(await getACOptions(3), [
        'STUYVESANT HIGH SCHOOL',
        'BEDFORD STUY COLLEGIATE CHARTER SCH',
        'BEDFORD STUY NEW BEGINNINGS CHARTER',
      ]);
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getACOptions(3), [
        'STUART M TOWNSEND MIDDLE SCHOOL',
        'STUDIO SCHOOL (THE)',
        'STUYVESANT HIGH SCHOOL',
      ]);
      await driver.sendKeys(' bre');
      assert.equal(await driver.find('.cell_editor .test-tokenfield .test-tokenfield-input').value(), 'stu bre');
      assert.deepEqual(await getACOptions(3), [
        'ST BRENDAN SCHOOL',
        'BRONX STUDIO SCHOOL-WRITERS-ARTISTS',
        'BROOKLYN STUDIO SECONDARY SCHOOL',
      ]);

      await driver.sendKeys(Key.DOWN, Key.ENTER, Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'ST BRENDAN SCHOOL');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should highlight matching parts of items', async function() {
      await driver.sendKeys(Key.HOME);

      let cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 2});
      await gu.clickReferenceListCell(cell);
      assert.equal(await cell.getText(), 'Red');
      await driver.sendKeys(Key.ENTER, 'Red');
      await driver.findWait('.test-ref-editor-item', 1000);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /Dark Red/).findAll('span', e => e.getText()),
        ['Red']);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /Rebecca Purple/).findAll('span', e => e.getText()),
        ['Re']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'Schools', rowNum: 1});
      await gu.clickReferenceListCell(cell);
      await driver.sendKeys('br tech');
      assert.deepEqual(
        await driver.findContentWait('.test-ref-editor-item', /BROOKLYN TECH/, 1000).findAll('span', e => e.getText()),
        ['BR', 'TECH']);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /BUFFALO.*TECHNOLOGY/).findAll('span', e => e.getText()),
        ['B', 'TECH']);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /ENERGY TECH/).findAll('span', e => e.getText()),
        ['TECH']);
      await driver.sendKeys(Key.ESCAPE);
    });

    it('should reflect changes to the target column', async function() {
      await driver.sendKeys(Key.HOME);

      const cell = await gu.getCell({section: 'References', col: 'Colors', rowNum: 4});
      await gu.clickReferenceListCell(cell);
      assert.equal(await cell.getText(), '');
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(2), ['Alice Blue', 'Añil']);
      await driver.sendKeys(Key.ESCAPE);

      // Change a color
      await gu.clickReferenceListCell(await gu.getCell({section: 'Colors', col: 'Color Name', rowNum: 1}));
      await driver.sendKeys('HAZELNUT', Key.ENTER, Key.ENTER);
      await gu.waitForServer();

      // See that the old value is gone from the autocomplete, and the new one is present.
      await gu.clickReferenceListCell(cell);
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(2), ['Añil', 'Aqua']);
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['HAZELNUT', 'Honeydew']);
      await driver.sendKeys(Key.ESCAPE);

      // Delete a row.
      await gu.clickReferenceListCell(await gu.getCell({section: 'Colors', col: 'Color Name', rowNum: 1}));
      await gu.removeRow(1);

      // See that the value is gone from the autocomplete.
      await gu.clickReferenceListCell(cell);
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['Honeydew', 'Hot Pink']);
      await driver.sendKeys(Key.ESCAPE);

      // Add a row.
      await gu.getCell({section: 'Colors', col: 'Color Name', rowNum: 1}).doClick();
      await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.ENTER));
      await gu.waitForServer();
      await driver.sendKeys('HELIOTROPE', Key.ENTER);
      await gu.waitForServer();

      // See that the new value is visible in the autocomplete.
      await gu.clickReferenceListCell(cell);
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['HELIOTROPE', 'Honeydew']);
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getACOptions(2), ['Añil', 'Aqua']);
      await driver.sendKeys(Key.ESCAPE);

      // Undo all the changes.
      await gu.undo(4);

      await gu.clickReferenceListCell(cell);
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['Honeydew', 'Hot Pink']);
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getACOptions(2), ['Alice Blue', 'Añil']);
      await driver.sendKeys(Key.ESCAPE);
    });
  });
});
