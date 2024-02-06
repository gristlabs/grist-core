import {assert, driver, Key, stackWrapFunc} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {Session} from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('ReferenceColumns', function() {
  this.timeout(20000);
  let session: Session;
  const cleanup = setupTestSuite({team: true});

  describe('rendering', function() {
    before(async function() {
      session = await gu.session().teamSite.login();
      await session.tempDoc(cleanup, 'Favorite_Films.grist');

      await gu.toggleSidePanel('right');
      await driver.find('.test-config-data').click();
    });

    it('should render Row ID values as TableId[RowId]', async function() {
      await driver.find('.test-right-tab-field').click();
      await driver.find('.mod-add-column').click();
      await driver.findWait('.test-new-columns-menu-add-new', 100).click();
      await gu.waitForServer();
      await gu.setType(/Reference/);
      await gu.waitForServer();
      await gu.enterGridRows({col: 3, rowNum: 1}, [['1'], ['2'], ['3'], ['4']]);
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', '', '']);
      await driver.find('.test-fbuilder-ref-table-select').click();
      await driver.findContent('.test-select-row', /Friends/).click();
      await gu.waitForServer();

      // These are now invalid cells containing AltText such as 'Films[1]'
      // We don't simply convert Films[1] -> Friends[1]
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', '', '']);

      await driver.find('.test-type-transform-apply').click();
      await gu.waitForServer();
      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Name/).click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', '', '']);
      await gu.getCell(3, 5).click();
      await driver.sendKeys('Roger');
      await driver.sendKeys(Key.ENTER);
      await gu.waitForServer();

      // 'Roger' is an actual reference
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', 'Roger', '']);

      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Row ID/).click();
      await gu.waitForServer();

      // 'Friends[1]' is an actual reference, the rest are invalid
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', 'Friends[1]', '']);

      await driver.find('.test-fbuilder-ref-col-select').click();
      await driver.findContent('.test-select-row', /Name/).click();
      await gu.waitForServer();
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6]),
        ['Films[1]', 'Films[2]', 'Films[3]', 'Films[4]', 'Roger', '']);

      await gu.undo();
    });

    it('should allow entering numeric id before target table is loaded', async function() {
      if (server.isExternalServer()) {
        this.skip();
      }
      // Refresh the document.
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();

      // Now pause the server
      const cell = gu.getCell({col: 'A', rowNum: 1});
      await server.pauseUntil(async () => {
        assert.equal(await cell.getText(), 'Films[1]');
        await cell.click();
        await gu.sendKeys('5');
        // Check that the autocomplete has no items yet.
        assert.isEmpty(await driver.findAll('.test-autocomplete .test-ref-editor-new-item'));
        await gu.sendKeys(Key.ENTER);
      });
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Friends[5]');

      await gu.undo();
      assert.equal(await cell.getText(), 'Films[1]');

      // Once server is responsive, a valid value should not offer a "new item".
      await cell.click();
      await gu.sendKeys('5');
      await driver.findWait('.test-ref-editor-item', 500);
      assert.isFalse(await driver.find('.test-ref-editor-new-item').isPresent());
      await gu.sendKeys(Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Friends[5]');
    });

    it(`should show '[Blank]' if the referenced item is blank`, async function() {
      // Open the All page.
      await driver.findContentWait('.test-treeview-itemHeader', /All/, 2000).click();
      await gu.waitForDocToLoad();

      // Clear the cells in Films record containing Avatar and Alien.
      await gu.getCell('Title', 3, 'Films record').doClick();
      await gu.sendKeys(Key.BACK_SPACE);
      await gu.waitForServer();
      await gu.sendKeys(Key.ARROW_DOWN, Key.BACK_SPACE);
      await gu.waitForServer();

      // Check that all references to Avatar and Alien now show '[Blank]'.
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump',
          'Toy Story',
          '[Blank]',
          'The Dark Knight',
          'Forrest Gump',
          '[Blank]'
        ]
      );

      // Check that '[Blank]' is not shown when the reference editor is open.
      await gu.getCell('Favorite Film', 3, 'Friends record').doClick();
      await gu.sendKeys(Key.ENTER);
      assert.equal(await driver.find('.celleditor_text_editor').value(), '');
      await gu.sendKeys(Key.ESCAPE);

      // Undo (twice), and check that it shows Avatar and Alien again.
      await gu.undo(2);
      assert.deepEqual(
        await gu.getVisibleGridCells('Favorite Film', [1, 2, 3, 4, 5, 6], 'Friends record'),
        [
          'Forrest Gump',
          'Toy Story',
          'Avatar',
          'The Dark Knight',
          'Forrest Gump',
          'Alien'
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
      await session.tempDoc(cleanup, 'Ref-AC-Test.grist');
      await gu.toggleSidePanel('right', 'close');
    });

    it('should open to correct item selected, and leave it unchanged on Enter', async function() {
      const checkRefCell = stackWrapFunc(async (col: string, rowNum: number, expValue: string) => {
        // Click cell and open for editing.
        const cell = await gu.getCell({section: 'References', col, rowNum})
          .find('.test-ref-text').doClick();
        assert.equal(await cell.getText(), expValue);
        await driver.sendKeys(Key.ENTER);
        // Wait for expected value to appear in the list; check that it's selected.
        const match = await driver.findContentWait('.test-ref-editor-item', expValue, 1000);
        assert.equal(await match.matches('.selected'), true);
        // Save the value.
        await driver.sendKeys(Key.ENTER);
        await gu.waitForServer();
        assert.equal(await cell.getText(), expValue);
        // Assert that the undo is disabled, i.e. no action was generated.
        assert.equal(await driver.find('.test-undo').matches('[class*=-disabled]'), true);
      });
      await checkRefCell('Color', 1, 'Dark Slate Blue');
      await checkRefCell('ColorCode', 2, '#808080');
      await checkRefCell('XNum', 3, '2019-11-05');
      await checkRefCell('School', 1, 'TECHNOLOGY, ARTS AND SCIENCES STUDIO');
    });

    it('should render first items when opening empty cell', async function() {
      await driver.sendKeys(Key.HOME);

      let cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 4}).doClick();
      assert.equal(await cell.getText(), '');
      await driver.sendKeys(Key.ENTER);
      // Check the first few items.
      assert.deepEqual(await getACOptions(3), ["Alice Blue", "Añil", "Aqua"]);
      // No item is selected.
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'School', rowNum: 6}).doClick();
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
      let cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2}).doClick();
      await driver.withActions(a => a.doubleClick(cell));
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Red');

      // Scroll to another item and click it.
      let item = driver.findContent('.test-ref-editor-item', 'Rosy Brown');
      await gu.scrollIntoView(item);
      await item.click();

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Rosy Brown');
      await gu.undo();
      assert.equal(await cell.getText(), 'Red');

      // Edit another cell by starting to type.
      cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 4}).doClick();
      await driver.sendKeys("gr");
      await driver.findWait('.test-ref-editor-item', 1000);
      item = driver.findContent('.test-ref-editor-item', 'Medium Sea Green');
      await gu.scrollIntoView(item);
      await item.click();

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Medium Sea Green');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should save correct item after selecting with arrow keys', async function() {
      // Same as the previous test, but instead of clicking items, select item using arrow keys.

      // Edit a cell by double-clicking.
      let cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2}).doClick();
      await driver.withActions(a => a.doubleClick(cell));
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Red');

      // Move to another item and hit Enter
      await driver.sendKeys(Key.DOWN, Key.DOWN, Key.DOWN, Key.DOWN, Key.DOWN);
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Pale Violet Red');
      await driver.sendKeys(Key.ENTER);

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Pale Violet Red');
      await gu.undo();
      assert.equal(await cell.getText(), 'Red');

      // Edit another cell by starting to type.
      cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 4}).doClick();
      await driver.sendKeys("gr");
      await driver.findWait('.test-ref-editor-item', 1000);
      await driver.sendKeys(Key.UP, Key.UP, Key.UP, Key.UP, Key.UP);
      assert.equal(await driver.findWait('.test-ref-editor-item.selected', 1000).getText(), 'Chocolate');
      await driver.sendKeys(Key.ENTER);

      // It should get saved; and undo should restore the previous value.
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'Chocolate');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should return to text-as-typed when nothing is selected', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2}).doClick();
      await driver.sendKeys("da");
      assert.deepEqual(await getACOptions(2), ["Dark Blue", "Dark Cyan"]);

      // Check that the first item is highlighted by default.
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'da');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Blue');

      // Select second item. Both the textbox and the dropdown show the selection.
      await driver.sendKeys(Key.DOWN);
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'Dark Cyan');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Cyan');

      // Move back to no-selection state.
      await driver.sendKeys(Key.UP, Key.UP);
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'da');
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);

      // Clear the typed-in text temporarily. Something changed in a recent version of Chrome,
      // causing the wrong item to be moused over below when the "Add New" option is visible.
      await driver.sendKeys(Key.BACK_SPACE, Key.BACK_SPACE);

      // Mouse over an item.
      await driver.findContent('.test-ref-editor-item', /Dark Gray/).mouseMove();
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'Dark Gray');
      assert.equal(await driver.find('.test-ref-editor-item.selected').getText(), 'Dark Gray');

      // Mouse back out of the dropdown
      await driver.find('.celleditor_text_editor').mouseMove();
      assert.equal(await driver.find('.celleditor_text_editor').value(), '');
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);

      // Re-enter the typed-in text and click away to save it.
      await driver.sendKeys('da', Key.UP);
      await gu.getCell({section: 'References', col: 'Color', rowNum: 1}).doClick();
      await gu.waitForServer();
      assert.equal(await cell.getText(), "da");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), true);

      await gu.undo();
      assert.equal(await cell.getText(), "Red");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), false);
    });

    it('should save text as typed when nothing is selected', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 1}).doClick();
      await driver.sendKeys("lavender ", Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), "Lavender");
      await gu.undo();
      assert.equal(await cell.getText(), "Dark Slate Blue");
    });

    it('should offer an add-new option when no good match', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2}).doClick();
      await driver.sendKeys("pinkish");
      // There are inexact matches.
      assert.deepEqual(await getACOptions(3),
        ["Pink", "Deep Pink", "Hot Pink"]);
      // Nothing is selected, and the "add new" item is present.
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      assert.equal(await driver.find('.test-ref-editor-new-item').getText(), "pinkish");

      // Click the "add new" item. The new value should be saved, and should not appear invalid.
      await driver.find('.test-ref-editor-new-item').click();
      await gu.waitForServer();
      assert.equal(await cell.getText(), "pinkish");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), false);

      // Requires 2 undos, because adding the "pinkish" record is a separate action. TODO these
      // actions should be bundled.
      await gu.undo(2);
      assert.equal(await cell.getText(), "Red");
    });

    it('should offer an add-new option when opening alt-text', async function() {
      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2}).doClick();

      // Enter and invalid value and save without clicking "add new".
      await driver.sendKeys("super pink", Key.ENTER);

      // It should be saved but appear invalid (as alt-text).
      await gu.waitForServer();
      assert.equal(await cell.getText(), "super pink");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), true);

      // Open the cell again. The "Add New" option should be there.
      await driver.withActions(a => a.doubleClick(cell));
      assert.equal(await driver.find('.test-ref-editor-new-item').getText(), "super pink");
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);

      // Select "add new" (this time with arrow keys), and save.
      await driver.sendKeys(Key.UP);
      assert.equal(await driver.find('.test-ref-editor-new-item').matches('.selected'), true);
      await driver.sendKeys(Key.ENTER);

      // Once "add new" is clicked, the "super pink" no longer appears as invalid.
      await gu.waitForServer();
      assert.equal(await cell.getText(), "super pink");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), false);

      await gu.undo(3);
      assert.equal(await cell.getText(), "Red");
    });

    it('should not offer an add-new option when target is a formula', async function() {
      // Click on an alt-text cell.
      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 3}).doClick();
      assert.equal(await cell.getText(), "hello");
      assert.equal(await cell.find('.field_clip').matches('.invalid'), true);

      await driver.sendKeys(Key.ENTER);
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
      await driver.sendKeys(Key.ENTER);
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'hello');
      await driver.findWait('.test-ref-editor-item', 1000);
      assert.equal(await driver.find('.test-ref-editor-item.selected').isPresent(), false);
      assert.equal(await driver.find('.test-ref-editor-new-item').isPresent(), false);
      await driver.sendKeys(Key.ESCAPE);

      await gu.undo();
      await gu.toggleSidePanel('right', 'close');
    });

    it('should offer items ordered by best match', async function() {
      let cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 1}).doClick();
      assert.equal(await cell.getText(), 'Dark Slate Blue');
      await driver.sendKeys(Key.ENTER);
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

      cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 3}).doClick();
      assert.equal(await cell.getText(), 'hello');    // Alt-text
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(2),
        ['Honeydew', 'Hot Pink']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'ColorCode', rowNum: 2}).doClick();
      assert.equal(await cell.getText(), '#808080');
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(5),
        ['#808080', '#808000', '#800000', '#800080', '#87CEEB']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'XNum', rowNum: 2}).doClick();
      assert.equal(await cell.getText(), '2019-04-29');
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(4),
        ['2019-04-29', '2020-04-29', '2019-11-05', '2020-04-28']);
      await driver.sendKeys(Key.ESCAPE);
    });

    it('should update choices as user types into textbox', async function() {
      let cell = await gu.getCell({section: 'References', col: 'School', rowNum: 1})
        .find('.test-ref-text').doClick();
      assert.equal(await cell.getText(), 'TECHNOLOGY, ARTS AND SCIENCES STUDIO');
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(3), [
        'TECHNOLOGY, ARTS AND SCIENCES STUDIO',
        'SCIENCE AND TECHNOLOGY ACADEMY',
        'SCHOOL OF SCIENCE AND TECHNOLOGY',
      ]);
      await driver.sendKeys(Key.ESCAPE);
      cell = await gu.getCell({section: 'References', col: 'School', rowNum: 2}).doClick();
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
      assert.equal(await driver.find('.celleditor_text_editor').value(), 'stu bre');
      assert.deepEqual(await getACOptions(3), [
        'ST BRENDAN SCHOOL',
        'BRONX STUDIO SCHOOL-WRITERS-ARTISTS',
        'BROOKLYN STUDIO SECONDARY SCHOOL',
      ]);

      await driver.sendKeys(Key.DOWN, Key.ENTER);
      await gu.waitForServer();
      assert.equal(await cell.getText(), 'ST BRENDAN SCHOOL');
      await gu.undo();
      assert.equal(await cell.getText(), '');
    });

    it('should highlight matching parts of items', async function() {
      await driver.sendKeys(Key.HOME);

      let cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 2})
        .find('.test-ref-text').doClick();
      assert.equal(await cell.getText(), 'Red');
      await driver.sendKeys(Key.ENTER);
      await driver.findWait('.test-ref-editor-item', 1000);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /Dark Red/).findAll('span', e => e.getText()),
        ['Red']);
      assert.deepEqual(
        await driver.findContent('.test-ref-editor-item', /Rebecca Purple/).findAll('span', e => e.getText()),
        ['Re']);
      await driver.sendKeys(Key.ESCAPE);

      cell = await gu.getCell({section: 'References', col: 'School', rowNum: 1})
        .find('.test-ref-text').doClick();
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

      const cell = await gu.getCell({section: 'References', col: 'Color', rowNum: 4}).doClick();
      assert.equal(await cell.getText(), '');
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(2), ['Alice Blue', 'Añil']);
      await driver.sendKeys(Key.ESCAPE);

      // Change a color
      await gu.getCell({section: 'Colors', col: 'Color Name', rowNum: 1}).doClick();
      await driver.sendKeys('HAZELNUT', Key.ENTER);
      await gu.waitForServer();

      // See that the old value is gone from the autocomplete, and the new one is present.
      await cell.click();
      await driver.sendKeys(Key.ENTER);
      assert.deepEqual(await getACOptions(2), ['Añil', 'Aqua']);
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['HAZELNUT', 'Honeydew']);
      await driver.sendKeys(Key.ESCAPE);

      // Delete a row.
      await gu.getCell({section: 'Colors', col: 'Color Name', rowNum: 1}).doClick();
      await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
      await gu.confirm(true, true);
      await gu.waitForServer();

      // See that the value is gone from the autocomplete.
      await cell.click();
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
      await cell.click();
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['HELIOTROPE', 'Honeydew']);
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getACOptions(2), ['Añil', 'Aqua']);
      await driver.sendKeys(Key.ESCAPE);

      // Undo all the changes.
      await gu.undo(4);

      await cell.click();
      await driver.sendKeys('H');
      assert.deepEqual(await getACOptions(2), ['Honeydew', 'Hot Pink']);
      await driver.sendKeys(Key.BACK_SPACE);
      assert.deepEqual(await getACOptions(2), ['Alice Blue', 'Añil']);
      await driver.sendKeys(Key.ESCAPE);
    });
  });
});
