import {assert, driver, Key, until} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('SectionFilter', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  describe('Core tests', function() {

    before(async function() {
      this.timeout(10000);
      const session = await gu.session().teamSite.login();
      await session.tempNewDoc(cleanup);
    });

    it('should be able to open / close filter menu', async () => {
      const menu = await gu.openColumnMenu('A', 'Filter');
      assert.equal(await menu.find('.test-filter-menu-list').getText(), 'No matching values');
      await driver.sendKeys(Key.ESCAPE);
      await driver.wait(until.stalenessOf(menu));
    });

    it('should filter out records in response to filter menu selections', async () => {
      this.timeout(10000);

      await gu.enterGridRows({col: 'A', rowNum: 1}, [
        ['Apples',  '1'],
        ['Oranges', '2'],
        ['Bananas', '1'],
        ['Apples',  '2'],
        ['Bananas', '1'],
        ['Apples',  '2'],
      ]);

      const menu = await gu.openColumnMenu('A', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: 'Apples', count: 3},
        { checked: true, value: 'Bananas', count: 2},
        { checked: true, value: 'Oranges', count: 1}
      ]);
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);

      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: false, value: 'Apples', count: 3},
        { checked: true, value: 'Bananas', count: 2},
        { checked: true, value: 'Oranges', count: 1}
      ]);
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Oranges', 'Bananas', 'Bananas']);

      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: 'Apples', count: 3},
        { checked: true, value: 'Bananas', count: 2},
        { checked: true, value: 'Oranges', count: 1}
      ]);
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);

      await driver.sendKeys(Key.ESCAPE);
    });

    it('should undo filter changes on cancel', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);

      const menu = await gu.openColumnMenu('A', 'Filter');

      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: false, value: 'Apples', count: 3},
        { checked: true, value: 'Bananas', count: 2},
        { checked: true, value: 'Oranges', count: 1}
      ]);
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Oranges', 'Bananas', 'Bananas']);

      await menu.find('.test-filter-menu-cancel-btn').click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);
    });

    it('should display new/updated rows even when only certain values are filtered in', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);

      let menu = await gu.openColumnMenu('A', 'Filter');

      // Put the filter into the "inclusion" state, with nothing selected initially.
      assert.deepEqual(
        await driver.findAll('.test-filter-menu-bulk-action:not(:disabled)', (e) => e.getText()),
        ['None']);
      await driver.findContent('.test-filter-menu-bulk-action', /None/).click();
      assert.deepEqual(
        await driver.findAll('.test-filter-menu-bulk-action:not(:disabled)', (e) => e.getText()),
        ['All']);

      // Include only "Apples".
      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: 'Apples', count: 3},
        { checked: false, value: 'Bananas', count: 2},
        { checked: false, value: 'Oranges', count: 1}
      ]);

      await driver.find('.test-filter-menu-apply-btn').click();

      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4]),
        ['Apples', 'Apples', 'Apples', '']);

      // Update first row to Oranges; it should remain shown.
      await gu.getCell(0, 1).click();
      await gu.enterCell('Oranges');

      // Enter a new row using a keyboard shortcut.
      await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.ENTER));

      // Enter a new row by typing in a value into the "add-row".
      await driver.find('.gridview_row .record-add .field').click();
      await gu.enterCell('Bananas');

      // Ensure all 3 changes are visible.
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Oranges', 'Apples', '', 'Apples', 'Bananas', '']);

      // Check that the filter menu looks as expected.
      menu = await gu.openColumnMenu('A', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: false, value: '', count: 1},
        { checked: true, value: 'Apples', count: 2},
        { checked: false, value: 'Bananas', count: 3},
        { checked: false, value: 'Oranges', count: 2}
      ]);

      // Apply the filter to make it only-Apples again.
      await menu.find('.test-filter-menu-apply-btn').click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Apples', 'Apples', '']);

      // Reset the filter
      menu = await gu.openColumnMenu('A', 'Filter');
      assert.deepEqual(
        await driver.findAll('.test-filter-menu-bulk-action:not([class*=-disabled])', (e) => e.getText()),
        ['All', 'None']);
      await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
      await menu.find('.test-filter-menu-apply-btn').click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['Oranges', 'Oranges', 'Bananas', 'Apples', 'Bananas', '', 'Apples', 'Bananas']);

      // Restore changes of this test case.
      await gu.undo(3);
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);
    });

    it('should display new/updated rows even when filtered, but refilter on menu changes', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples']);

      let menu = await gu.openColumnMenu('A', 'Filter');

      await menu.findContent('label', /Apples/).click();
      await driver.find('.test-filter-menu-apply-btn').click();

      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Oranges', 'Bananas', 'Bananas']);

      // Update Oranges to Apples and make sure it's not filtered out
      await (await gu.getCell(0, 1)).click();
      await gu.enterCell('Apples');

      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Apples', 'Bananas', 'Bananas']);

      // Set back to Oranges and make sure it stays
      await driver.sendKeys(Key.UP);
      await gu.enterCell('Oranges');

      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3]),
        ['Oranges', 'Bananas', 'Bananas']);

      // Enter two new rows and make sure they're also not filtered out
      await driver.find('.gridview_row .record-add .field').click();
      await gu.enterCell('Apples');
      await gu.enterCell('Bananas');

      // Enter a new row using a keyboard shortcut.
      await driver.find('body').sendKeys(Key.chord(await gu.modKey(), Key.ENTER));
      await gu.waitForServer();

      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6]),
        ['Oranges', 'Bananas', 'Bananas', 'Apples', 'Bananas', '']);

      menu = await gu.openColumnMenu('A', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: false, value: 'Apples', count: 4},
        { checked: true, value: 'Bananas', count: 3},
        { checked: true, value: 'Oranges', count: 1}
      ]);

      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['Apples', 'Oranges', 'Bananas', 'Apples', 'Bananas', 'Apples', 'Apples', 'Bananas']);
      await menu.findContent('label', /Apples/).click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4]),
        ['Oranges', 'Bananas', 'Bananas', 'Bananas']);
      await driver.sendKeys(Key.ESCAPE);
    });
  });

  describe('Type tests', function() {

    before(async function() {
      const session = await gu.session().teamSite.login();
      await session.tempDoc(cleanup, 'FilterTest.grist');
    });

    it('should properly filter strings', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['Foo', 'Bar', '1', '2.0', '2016-01-01', '5+6', '', '']);

      const menu = await gu.openColumnMenu('Text', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: '1', count: 1},
        { checked: true, value: '2.0', count: 1},
        { checked: true, value: '5+6', count: 1},
        { checked: true, value: '2016-01-01', count: 1},
        { checked: true, value: 'Bar', count: 1},
        { checked: true, value: 'Foo', count: 1}
      ]);
      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /Bar/).click();
      assert.deepEqual(await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7]),
        ['Foo', '1', '2.0', '2016-01-01', '5+6', '', undefined]);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });


    it('should properly filter numbers', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['5.00', '6.00', '7.00', '-1.00', 'foo', '0.00', '', '']);

      const menu = await gu.openColumnMenu('Number', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: 'foo', count: 1},
        { checked: true, value: '-1.00', count: 1},
        { checked: true, value: '0.00', count: 1},
        { checked: true, value: '5.00', count: 1},
        { checked: true, value: '6.00', count: 1},
        { checked: true, value: '7.00', count: 1},
      ]);
      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /7/).click();
      await menu.findContent('label', /foo/).click();
      assert.deepEqual(await gu.getVisibleGridCells(1, [1, 2, 3, 4, 5, 6]),
        ['5.00', '6.00', '-1.00', '0.00', '', undefined]);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter dates', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(2, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['2019-06-03', '2019-06-07', '2019-06-05', 'bar', '2019-06-123', '0', '', '']);

      const menu = await gu.openColumnMenu('Date', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: '2019-06-123', count: 1},
        { checked: true, value: 'bar', count: 1},
        { checked: true, value: '0', count: 1},
        { checked: true, value: '2019-06-03', count: 1},
        { checked: true, value: '2019-06-05', count: 1},
        { checked: true, value: '2019-06-07', count: 1},
      ]);
      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /2019-06-05/).click();
      await menu.findContent('label', /bar/).click();
      assert.deepEqual(await gu.getVisibleGridCells(2, [1, 2, 3, 4, 5, 6]),
        ['2019-06-03', '2019-06-07', '2019-06-123', '0', '', undefined]);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly search through list of date to filter', async () => {
      const menu = await gu.openColumnMenu('Date', 'Filter');
      assert.lengthOf(await gu.getFilterMenuState(), 7);
      await driver.sendKeys('07');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '2019-06-07', count: 1}
      ]);
      assert.deepEqual(
        await menu.findAll('.test-filter-menu-list label', (e) => e.getText()),
        ['2019-06-07']
      );
      await menu.findContent('.test-filter-menu-bulk-action', /All Shown/).click();
      assert.deepEqual(
        await gu.getVisibleGridCells(2, [1, 2]),
        ['2019-06-07', '']
      );
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter formulas', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['25', '36', '49', '1', '#TypeError', '0', '#TypeError', '']);

      const menu = await gu.openColumnMenu('Formula', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '#TypeError', count: 2},
        { checked: true, value: '0', count: 1},
        { checked: true, value: '1', count: 1},
        { checked: true, value: '25', count: 1},
        { checked: true, value: '36', count: 1},
        { checked: true, value: '49', count: 1},
      ]);

      await menu.findContent('label', /0/).click();
      await menu.findContent('label', /#TypeError/).click();
      await menu.findContent('label', /25/).click();

      assert.deepEqual(await gu.getVisibleGridCells(3, [1, 2, 3, 4, 5]),
        ['36', '49', '1', '', undefined]);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter references', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(4, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['alice', 'carol', 'bob', 'denis', '0', 'denis', '', '']);

      const menu = await gu.openColumnMenu('Reference', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: '#Invalid Ref: 0', count: 1},
        { checked: true, value: '#Invalid Ref: denis', count: 2},
        { checked: true, value: 'alice', count: 1},
        { checked: true, value: 'bob', count: 1},
        { checked: true, value: 'carol', count: 1},
      ]);

      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /#Invalid Ref: denis/).click();
      await menu.findContent('label', /bob/).click();

      assert.deepEqual(await gu.getVisibleGridCells(4, [1, 2, 3, 4, 5]),
        ['alice', 'carol', '0', '', undefined]);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter choice lists', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(5, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['Foo\nBar\nBaz', 'Foo\nBar', 'Foo', 'InvalidChoice', 'Baz\nBaz\nBaz', 'Bar\nBaz', '', '']);

      const menu = await gu.openColumnMenu('ChoiceList', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: 'Bar', count: 3},
        { checked: true, value: 'Baz', count: 5},
        { checked: true, value: 'Foo', count: 3},
        { checked: true, value: 'InvalidChoice', count: 1},
      ]);

      // Check that all the choices are rendered in the right colors.
      const choiceColors = await menu.findAll(
        'label .test-filter-menu-choice-token',
        async (c) => [await c.getCssValue('background-color'), await c.getCssValue('color')]
      );

      assert.deepEqual(
        choiceColors,
        [
          [ 'rgba(254, 204, 129, 1)', 'rgba(0, 0, 0, 1)' ],
          [ 'rgba(53, 253, 49, 1)', 'rgba(0, 0, 0, 1)' ],
          [ 'rgba(204, 254, 254, 1)', 'rgba(0, 0, 0, 1)' ],
          [ 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 1)' ]
        ]
      );

      // Check that Foo is rendered with font options.
      const boldFonts = await menu.findAll(
        'label .test-filter-menu-choice-token.font-italic.font-bold',
        (c) => c.getText()
      );

      assert.deepEqual(boldFonts, ['Foo']);

      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /Bar/).click();
      await menu.findContent('label', /Baz/).click();

      assert.deepEqual(await gu.getVisibleGridCells(5, [1, 2, 3, 4, 5]),
        ['Foo\nBar\nBaz', 'Foo\nBar', 'Foo', 'InvalidChoice', '']);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter errors in choice lists', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(6, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['25.0', '36.0', '49.0', '1.0', '#TypeError', '', '#TypeError', '']);

      await gu.scrollIntoView(gu.getColumnHeader('ChoiceListErrors'));
      const menu = await gu.openColumnMenu('ChoiceListErrors', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1},
        { checked: true, value: '#TypeError', count: 2},
        { checked: true, value: '1.0', count: 1},
        { checked: true, value: '25.0', count: 1},
        { checked: true, value: '36.0', count: 1},
        { checked: true, value: '49.0', count: 1},
        { checked: true, value: 'A', count: 0},
        { checked: true, value: 'B', count: 0},
        { checked: true, value: 'C', count: 0},
        { checked: true, value: 'D', count: 0},
      ]);

      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /#TypeError/).click();
      await menu.findContent('label', /25\.0/).click();
      await menu.findContent('label', /36\.0/).click();
      await menu.findContent('label', /49\.0/).click();

      assert.deepEqual(await gu.getVisibleGridCells(6, [1, 2]),
        ['1.0', '']);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter choices', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(7, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['Red', 'Orange', 'Yellow', 'InvalidChoice', '', 'Red', '', '']);

      const menu = await gu.openColumnMenu('Choice', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 2},
        { checked: true, value: 'InvalidChoice', count: 1},
        { checked: true, value: 'Orange', count: 1},
        { checked: true, value: 'Red', count: 2},
        { checked: true, value: 'Yellow', count: 1},
      ]);

      // Check that all the choices are rendered in the right colors.
      const choiceColors = await menu.findAll(
        'label .test-filter-menu-choice-token',
        async (c) => [await c.getCssValue('background-color'), await c.getCssValue('color')]
      );

      assert.deepEqual(
        choiceColors,
        [
          [ 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 1)' ],
          [ 'rgba(254, 204, 129, 1)', 'rgba(0, 0, 0, 1)' ],
          [ 'rgba(252, 54, 59, 1)', 'rgba(255, 255, 255, 1)' ],
          [ 'rgba(255, 250, 205, 1)', 'rgba(0, 0, 0, 1)' ]
        ]
      );

      // Check that Red is rendered with font options.
      const withFonts = await menu.findAll(
        'label .test-filter-menu-choice-token.font-underline.font-strikethrough',
        (c) => c.getText()
      );

      assert.deepEqual(withFonts, ['Red']);

      await menu.findContent('label', /InvalidChoice/).click();
      await menu.findContent('label', /Orange/).click();
      await menu.findContent('label', /Yellow/).click();

      assert.deepEqual(await gu.getVisibleGridCells(7, [1, 2, 3, 4, 5]),
        ['Red', '', 'Red', '', '']);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should properly filter reference lists', async () => {
      assert.deepEqual(await gu.getVisibleGridCells(8, [1, 2, 3, 4, 5, 6, 7, 8]),
        ['alice\ncarol', 'bob', 'carol\nbob\nalice', '[u\'denis\']', '[u\'0\']', '[u\'denis\', u\'edward\']', '', '']);

      const menu = await gu.openColumnMenu('ReferenceList', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1 },
        { checked: true, value: '#Invalid RefList: [u\'0\']', count: 1 },
        {
          checked: true,
          value: '#Invalid RefList: [u\'denis\', u\'edward\']',
          count: 1
        },
        {
          checked: true,
          value: '#Invalid RefList: [u\'denis\']',
          count: 1
        },
        { checked: true, value: 'alice', count: 2 },
        { checked: true, value: 'bob', count: 2 },
        { checked: true, value: 'carol', count: 2 }
      ]);

      await menu.findContent('label', /^$/).click();
      await menu.findContent('label', /bob/).click();
      await menu.findContent('label', /#Invalid RefList: \[u'0'\]/).click();

      assert.deepEqual(await gu.getVisibleGridCells(8, [1, 2, 3, 4, 5]),
        ['alice\ncarol', 'carol\nbob\nalice', '[u\'denis\']', '[u\'denis\', u\'edward\']', '']);
      await menu.find('.test-filter-menu-cancel-btn').click();
    });

    it('should reflect the section show column setting in the filter menu', async () => {
      // Scroll col 3 into view to make sure col 4 is clickable
      await gu.scrollIntoView(gu.getCell(3, 1));

      // Change the show column setting of the Reference column to 'color'.
      await gu.getCell(4, 1).click();
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      await gu.setRefShowColumn('color');

      // Open the filter menu for Reference, and check that the values are now from 'color'.
      const menu = await gu.openColumnMenu('Reference', 'Filter');
      assert.deepEqual(await gu.getFilterMenuState(), [
        { checked: true, value: '', count: 1 },
        { checked: true, value: '#Invalid Ref: 0', count: 1 },
        { checked: true, value: '#Invalid Ref: denis', count: 2 },
        { checked: true, value: 'blue', count: 1 },
        { checked: true, value: 'green', count: 1 },
        { checked: true, value: 'red', count: 1 }
      ]);

      await menu.find('.test-filter-menu-cancel-btn').click();
    });
  });
});
