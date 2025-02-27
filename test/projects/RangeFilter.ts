import { assert, driver } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';
import * as gu from 'test/nbrowser/gristUtils';
import * as fu from 'test/projects/filterUtils';

function findItem(val: string) {
  return driver.findContent('.fixture-stored-menu label', val);
}

function isSelected(val: string) {
  return findItem(val).find('input').isSelected();
}

describe('RangeFilter', function() {
  setupTestSuite();
  fu.addFilterUtilsToRepl();
  this.timeout(10000);
  let filterType = 'Numeric';

  async function refresh() {
    await driver.get(`${server.getHost()}/ColumnFilterMenu?filterType=${filterType}`);
    await gu.waitToPass(async () => {
      assert(await driver.find('.test-filter-menu-search-input').hasFocus());
    });
  }

  async function setFilterType(type: string) {
    filterType = type;
    await refresh();
  }

  beforeEach(async () => {
    await refresh();
  });

  it('should put focus on search (not the min bound...)', async function() {
    assert(await driver.find('.test-filter-menu-search-input').hasFocus());
  });

  it('should handle correctly [min] < []', async function() {
    // set min to 2
    await fu.setBound('min', '2');
    assert.equal(await driver.find('.fixture-json').getText(), '{"min":2}');
    assert.equal(await isSelected('1'), false);
    assert.equal(await isSelected('2'), true);
    assert.equal(await isSelected('3'), true);

    await fu.setBound('min', '3');
    assert.equal(await driver.find('.fixture-json').getText(), '{"min":3}');
    assert.equal(await isSelected('1'), false);
    assert.equal(await isSelected('2'), false);
    assert.equal(await isSelected('3'), true);
  });

  it('should handle correctly [] < [max]', async function() {
    await fu.setBound('max', '2');
    assert.equal(await driver.find('.fixture-json').getText(), '{"max":2}');
    assert.equal(await isSelected('1'), true);
    assert.equal(await isSelected('2'), true);
    assert.equal(await isSelected('3'), false);

    await fu.setBound('max', '3');
    assert.equal(await driver.find('.fixture-json').getText(), '{"max":3}');
    assert.equal(await isSelected('1'), true);
    assert.equal(await isSelected('2'), true);
    assert.equal(await isSelected('3'), true);
  });

  it('should handle correctly [min] < [max]', async function() {
    await fu.setBound('min', '2');
    await fu.setBound('max', '3');
    assert.equal(await driver.find('.fixture-json').getText(), '{"min":2,"max":3}');
    assert.equal(await isSelected('1'), false);
    assert.equal(await isSelected('2'), true);
    assert.equal(await isSelected('3'), true);
    assert.equal(await isSelected('7'), false);
  });

  it('should switch to search when click a checkbox', async function() {
    await fu.setBound('min', '4');
    assert.equal(await driver.find('.fixture-json').getText(), '{"min":4}');
    await findItem('2').click();
    assert.equal(await driver.find('.fixture-json').getText(), '{"excluded":[1,3]}');
  });

  it('should switch to search when clicking on None', async function() {
    await fu.setBound('min', '4');
    assert.equal(await driver.find('.fixture-json').getText(), '{"min":4}');
    await driver.findContent('.test-filter-menu-bulk-action', 'None').click();
    assert.equal(await driver.find('.fixture-json').getText(), '{"included":[]}');
  });

  it('should leave all val selected when users delete last bounds', async function() {
    // set min bound to 4
    await fu.setBound('min', '4');

    // delete min bound
    await fu.setBound('min', null);

    // check couple values are selected
    assert.equal(await isSelected('1'), true);
    assert.equal(await isSelected('1'), true);
  });

  it('should show date and dropdown icons only for date column', async function() {
    assert.equal(await driver.find('.test-filter-menu-min [style*=--icon-FieldDate]').isPresent(), false);
    await setFilterType('Date');
    assert.equal(await driver.find('.test-filter-menu-min [style*=--icon-FieldDate]').isPresent(), true);
  });

  it('should toggle relative options on click only for date column', async function() {
    await setFilterType('Numeric');
    assert.equal(await fu.isOptionsVisible(), false);
    await fu.findBound('min').click();
    assert.equal(await fu.isOptionsVisible(), false);

    await setFilterType('Date');
    assert.equal(await fu.isOptionsVisible(), false);
    await fu.findBound('min').click();
    assert.equal(await fu.isOptionsVisible(), true);
  });

  it('should handle Date column correctly', async function () {
    await setFilterType('Date');

    // set min bound to 2022-04-05
    await fu.setBound('min', '2022-04-05');

    // check state is {"min":1649116800}
    function parseDate(s: string) { return Number(new Date(s)) / 1000; }
    assert.equal(await driver.find('.fixture-json').getText(), `{"min":${parseDate("2022-04-05")}}`);



    // check checkboxes states
    await fu.switchToDefaultView();
    assert.equal(await isSelected('2022-01-05'), false);
    assert.equal(await isSelected('2022-04-05'), true);
    assert.equal(await isSelected('2022-05-05'), true);

    // set max bound to 2022-04-12
    await fu.setBound('max', '2022-04-12');


    // check state is {"min":1649116800,"max"}
    await fu.switchToDefaultView();
    assert.equal(await driver.find('.fixture-json').getText(),
                 `{"min":${parseDate('2022-04-05')},"max":${parseDate('2022-04-12')}}`);

    // check checkboxes state
    assert.equal(await isSelected('2022-01-05'), false);
    assert.equal(await isSelected('2022-04-05'), true);
    assert.equal(await isSelected('2022-05-05'), false);

    // clear min
    await fu.setBound('min', null);

    // check
    await fu.switchToDefaultView();
    assert.equal(await driver.find('.fixture-json').getText(),
                 `{"max":${parseDate('2022-04-12')}}`);
    assert.equal(await isSelected('2022-01-05'), true);
    assert.equal(await isSelected('2022-04-05'), true);
    assert.equal(await isSelected('2022-05-05'), false);
  });
});
