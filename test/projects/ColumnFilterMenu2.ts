import { assert, driver, Key } from 'mocha-webdriver';
import { selectAllKey } from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from './testUtils';

async function parseFilterState() {
  const json = await driver.find('.fixture-json').getText();
  return JSON.parse(json);
}

async function parseAllValues() {
  return (await driver.find('.fixture-all-values').getText()).split(',');
}

describe('ColumnFilterMenu2', function() {
  setupTestSuite();
  this.timeout(10000);
  let limitShown: number|undefined;

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/ColumnFilterMenu`);
  });

  beforeEach(async () => {
    // reset filter to all selected
    await driver.find('.fixture-limit-shown').click();
    await driver.find('.fixture-limit-shown').sendKeys(await selectAllKey(), Key.DELETE);
    if (limitShown !== undefined) {
      await driver.sendKeys(limitShown.toString());
    }
    await driver.find('.fixture-reset').click();
  });

  describe('opt.limitShown', function() {

    before(() => {
      limitShown = 3;
    });

    it('should limit shown value to the first opt.limitShown', async () => {
      // check list has 3 items
      assert.lengthOf(await driver.findAll('.test-filter-menu-list label'), 3);

      // check Apple is included
      assert.equal(await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(), true);

      // click 'Apple'
      await driver.findContent('.test-filter-menu-list label', /Apple/).click();

      // check Apple is excluded
      assert.equal(await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(), false);
    });

    it('should group values beyond', async () => {
      // check `Other Values` is present
      assert.deepEqual(await driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText()),
                       ['Other Values (14)', 'Future Values']);

      // check there are actually 17 unique values in total (where 17 is 14 unique other values
      // added to the 3 the number of values shown);
      assert.equal(
        14 + 3,
        (await parseAllValues()).length
      );

      // check `Other Values` is checked
      assert.equal(await driver.findContent('.test-filter-menu-summary', /Other Values/).find('input').isSelected(),
                   true);

      // check 'Date', 'Figs' and 'Rhubarb' are not shown
      assert.notIncludeMembers(
        await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
        ['Dates', 'Figs', 'Rhubarb']);

      // click 'Other Values'
      await driver.findContent('.test-filter-menu-summary', /Other Values/).find('label').click();

      // check 'Other Values' is unchecked
      assert.equal(await driver.findContent('.test-filter-menu-summary', /Other Values/).find('input').isSelected(),
                   false);

      // check 'Date', 'Figs' and 'Rhubarb' are excluded
      assert.includeMembers((await parseFilterState()).excluded, ['Dates', 'Figs', 'Rhubarb']);
    });

    it('should maintain selection across shown item when clicking `Other Values`', async () => {
      // unselect Apple
      await driver.findContent('.test-filter-menu-list label', /Apple/).click();

      // check Apple is not included
      assert.equal(await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(),
                   false);

      // Click 'Other Values'
      await driver.findContent('.test-filter-menu-summary', /Other Values/).find('label').click();

      // Check Apple is still not included
      assert.equal(await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(),
                   false);
    });

    it('should also have a working `Future Values`', async () => {
      // check Future Values is checked
      assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').isSelected(),
                   true);

      // check filter is an exclusion filter
      assert.deepEqual(Object.keys(await parseFilterState()), ['excluded']);

      // Click Future Values
      await driver.findContent('.test-filter-menu-summary', /Future Values/).find('label').click();

      // check Future values is unchecked
      assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').isSelected(),
                   false);

      // Check filter is an inclusion filter
      assert.deepEqual(Object.keys(await parseFilterState()), ['included']);
    });

    describe('when searching', function() {

      it('should have a `Other Matching` group', async () => {
        // enter 'A'
        await driver.sendKeys('A');

        // Check `Other Matching` is shown
        assert.deepEqual(await driver.findAll('.test-filter-menu-summary', (e) => e.find('label').getText()),
                         ['Other Matching (6)', 'Other Non-Matching (8)']);

        // chech all values adds up (shown values) + (other matching) + (other non-matching)
        assert.equal(3 + 6 + 8, (await parseAllValues()).length);

        // Check Apples, Bananas are shown
        assert.lengthOf(await driver.findAll('.test-filter-menu-list label'), 3);
        assert.includeMembers(
          await driver.findAll('.test-filter-menu-list label', (e) => e.getText()),
          ['Apples', 'Bananas']);

        // check Dates, Knapples are not excluded
        assert.deepEqual(await parseFilterState(), {excluded: []});

        // click `Other Matching`
        await driver.findContent('.test-filter-menu-summary', /Other Matching/).find('label').click();

        // check `Other Matching` is unchecked
        assert.equal(
          await driver.findContent('.test-filter-menu-summary', /Other Matching/).find('input').isSelected(),
          false
        );

        // check Dates, Knapples are NOT included
        assert.isArray((await parseFilterState()).excluded);
        assert.include((await parseFilterState()).excluded, 'Dates');
        assert.include((await parseFilterState()).excluded, 'Knapples');

        // click Other Matching
        await driver.findContent('.test-filter-menu-summary', /Other Matching/).find('label').click();

        // check `Other Matching` is checked
        assert.equal(
          await driver.findContent('.test-filter-menu-summary', /Other Matching/).find('input').isSelected(),
          true
        );

        // Check Dates, Knapples are included
        assert.isArray((await parseFilterState()).excluded);
        assert.notIncludeMembers((await parseFilterState()).excluded, ['Dates', 'Knapples']);
      });

      it('should maintain selection across shown item when click `Other Matching`', async () => {
        // enter 'A'
        await driver.sendKeys('A');

        // click 'Apple'
        await driver.findContent('.test-filter-menu-list label', /Apple/).click();

        // check Apple is not included
        assert.equal(
          await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(),
          false);

        // click 'Other Matching'
        await driver.findContent('.test-filter-menu-summary label', /Other Matching/).click();

        // check Apple is still not included
        assert.equal(
          await driver.findContent('.test-filter-menu-list label', /Apple/).find('input').isSelected(),
          false);
      });

      it('should also have a working `Other Non-Matching` group', async () => {
        // enter 'A'
        await driver.sendKeys('A');

        // check 'Other Non-Matching' is checked
        assert.equal(
          await driver.findContent('.test-filter-menu-summary label', /Other Non-Matching/).find('input').isSelected(),
          true
        );

        // check filter is an exclusion filter
        assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));

        // click 'Other Non-Matching'
        await driver.findContent('.test-filter-menu-summary label', /Other Non-Matching/).click();

        // check 'Other Non-Matching' is un-checked
        assert.equal(
          await driver.findContent('.test-filter-menu-summary label', /Other Non-Matching/).find('input').isSelected(),
          false
        );

        // check filter is an inclusion filter
        const spec = await parseFilterState();
        assert.isArray(spec.included);
        assert.include(spec.included, 'Apples');
        assert.include(spec.included, 'Bananas');
      });
    });

  });
});
