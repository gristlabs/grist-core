import { assert, driver, Key, until } from 'mocha-webdriver';
import { server, setupTestSuite } from './testUtils';

describe('ColumnFilterMenu', function() {
  setupTestSuite();
  this.timeout(10000);

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/ColumnFilterMenu`);
    await driver.findWait('.fixture-json', 2000);
  });

  beforeEach(async () => {
    await driver.find('.fixture-reset').click();
  });

  it('should update json and filter in response to stored filter updates', async () => {
    // Verify that everything is selected by default
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.isTrue((await driver.find('.fixture-all-values').getText()).includes('Apples, Bananas'));
    assert.isTrue((await driver.find('.fixture-displayed-values').getText()).includes('Apples, Bananas'));

    // Click on Apples, check that they get added to filter
    await driver.findContent('.fixture-stored-menu label', /Apples/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));

    // Check that array of values got filtered
    assert.isTrue((await driver.find('.fixture-all-values').getText()).includes('Apples'));
    assert.isFalse((await driver.find('.fixture-displayed-values').getText()).includes('Apples'));

    // Click on Bananas, check that they get added to filterj
    await driver.findContent('.fixture-stored-menu label', /Bananas/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples', 'Bananas']}));

    // Check that array of values got filtered
    assert.isTrue((await driver.find('.fixture-all-values').getText()).includes('Bananas'));
    assert.isFalse((await driver.find('.fixture-displayed-values').getText()).includes('Bananas'));

    // Click both again, check that array of values includes them
    await driver.findContent('.fixture-stored-menu label', /Apples/).click();
    await driver.findContent('.fixture-stored-menu label', /Bananas/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.isTrue((await driver.find('.fixture-displayed-values').getText()).includes('Apples, Bananas'));
  });

  it('should have a working select all / none', async () => {

    // Check that everything is selected
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.equal(await driver.find('.fixture-all-values').getText(),
    await driver.find('.fixture-displayed-values').getText());

    // Check menu offers bulk-action
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action', (e) => e.getText()), ['All', 'None']);

    // Check only `All` is disabled
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
      ['All']);

    // Deselect apples
    await driver.findContent('.test-filter-menu-list label', /Apples/).click();

    // Check that there is no disabled
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()), []);

    // Click 'Select all'
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();

    // Check that everything is back to being selected
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));

    // Check that 'All' is disabled
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
      ['All']);

    // Click 'Select none', check that filter gets switched to inclusion
    await driver.findContent('.test-filter-menu-bulk-action', /None/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({included: []}));

    // Check that only 'None' is disabled
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
                     ['None']);

    // Verify that no values are display
    assert.equal(await driver.find('.fixture-displayed-values').getText(), '[]');

    // Select apples
    await driver.findContent('.test-filter-menu-list label', /Apples/).click();

    // Check that there is no disabled
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()), []);

    // Verify that it's the only value included
    assert.deepEqual(await driver.find('.fixture-json').getText(), JSON.stringify({included: ['Apples']}));
    assert.equal(await driver.find('.fixture-displayed-values').getText(), '[Apples]');

    // Select all, check values
    await driver.findContent('.test-filter-menu-bulk-action', /All/).click();
    assert.deepEqual(await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
                     ['All']);
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.equal(await driver.find('.fixture-all-values').getText(),
    await driver.find('.fixture-displayed-values').getText());
  });

  it('should offer a working `Future Values` option', async () => {
    // Check `Future Values` is present
    assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).isPresent(),
                 true, 'Future Values not present');

    // Check all values are selected
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));

    // Check `Future Values` is selected
    assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').isSelected(),
                 true, 'Future values should be selected');

    // Uncheck `Apple`
    await driver.findContent('.test-filter-menu-list label', /Apples/).click();

    // Check the filter spec
    assert.equal(await driver.find('.fixture-json').getText(),
                 JSON.stringify({excluded: ['Apples']}), 'Spec not correct');

    // Uncheck the `Future Values` checkbox
    await driver.findContent('.test-filter-menu-summary', /Future Values/).find('label').click();

    // check the filter spec is now an inclusion filter all values but 'Apple'
    const spec = JSON.parse(await driver.find('.fixture-json').getText());
    assert.notInclude(spec.included, 'Apple', 'filter should not exclude apple');
    assert.equal(spec.included.length, 16, 'filter should have 16 excluded values');

    // Check `Future Values` is unselected
    assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').isSelected(),
                 false);

    // Check again the `Future Values`
    await driver.findContent('.test-filter-menu-summary', /Future Values/).find('label').click();

    // Check the filter spec is now an inclusion filter with only 'Apple' in it
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));

    // Check `Future Values` is selected
    assert.equal(await driver.findContent('.test-filter-menu-summary', /Future Values/).find('input').isSelected(),
                 true);
  });

  it('should update filter in response to filter menu', async () => {
    // Check that nothing is excluded
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    const applesCheck = await driver.findContent('.fixture-stored-menu label', /Apples/).find('input');
    const bananasCheck = await driver.findContent('.fixture-stored-menu label', /Bananas/).find('input');

    // Open the popup menu, check that Apples and Bananas are selected
    await driver.find('.fixture-filter-menu-btn').click();
    await driver.findWait('.grist-floating-menu', 100);
    assert.isTrue(await driver.findContent('.grist-floating-menu label', /Apples/).find('input').isSelected());
    assert.isTrue(await driver.findContent('.grist-floating-menu label', /Bananas/).find('input').isSelected());
    assert.isTrue(await applesCheck.isSelected());
    assert.isTrue(await bananasCheck.isSelected());

    // Deselect Apples
    await driver.findContent('.grist-floating-menu label', /Apples/).click();

    // Check that Apples got deselected in the stored menu
    assert.isFalse(await driver.findContent('.grist-floating-menu label', /Apples/).find('input').isSelected());
    assert.isFalse(await applesCheck.isSelected());
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));

    // Close the menu
    await driver.find('.fixture-filter-menu-btn').click();

    // Check that the stored filter stayed unchanges
    assert.isFalse(await applesCheck.isSelected());
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));

    // Deselect Bananas in the stored menu
    await driver.findContent('.fixture-stored-menu label', /Bananas/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples', 'Bananas']}));

    // Open the menu and check that it matches the values
    await driver.find('.fixture-filter-menu-btn').click();
    const openMenu = await driver.findWait('.grist-floating-menu', 100);
    assert.isFalse(await driver.findContent('.grist-floating-menu label', /Apples/).find('input').isSelected());
    assert.isFalse(await driver.findContent('.grist-floating-menu label', /Bananas/).find('input').isSelected());
    assert.isFalse(await applesCheck.isSelected());
    assert.isFalse(await bananasCheck.isSelected());

    // Select all values in the open menu and check values
    await driver.find('.grist-floating-menu .test-filter-menu-bulk-action').click();
    assert.isTrue(await driver.findContent('.grist-floating-menu label', /Apples/).find('input').isSelected());
    assert.isTrue(await driver.findContent('.grist-floating-menu label', /Bananas/).find('input').isSelected());
    assert.isTrue(await applesCheck.isSelected());
    assert.isTrue(await bananasCheck.isSelected());
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));

    // Click apply in the open menu
    await driver.find('.grist-floating-menu .test-filter-menu-apply-btn').click();
    // Check that the menu closed
    await driver.wait(until.stalenessOf(openMenu));

    // Verify that the stored filter is saved
    assert.isTrue(await applesCheck.isSelected());
    assert.isTrue(await bananasCheck.isSelected());
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
  });

  it('should reset filter to open state on cancel', async () => {
    // Check that nothing is excluded
    let applesCheck = await driver.findContent('.fixture-stored-menu label', /Apples/).find('input');
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.isTrue(await applesCheck.isSelected());

    // Open the filter menu
    await driver.find('.fixture-filter-menu-btn').click();
    let openMenu = await driver.findWait('.grist-floating-menu', 100);

    // Deselect Apples, check that stored menu is updated
    await driver.findContent('.grist-floating-menu label', /Apples/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));
    assert.isFalse(await applesCheck.isSelected());

    // Click cancel, check that the menu closed
    await driver.find('.grist-floating-menu .test-filter-menu-cancel-btn').click();
    await driver.wait(until.stalenessOf(openMenu));

    // Check that stored menu is back to initial state
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    // Filter has been rebuilt, so need new reference to checkbox
    applesCheck = await driver.findContent('.fixture-stored-menu label', /Apples/).find('input');
    assert.isTrue(await applesCheck.isSelected());

    // Open the filter menu again, check that Apples is selected
    await driver.find('.fixture-filter-menu-btn').click();
    openMenu = await driver.findWait('.grist-floating-menu', 100);
    assert.isTrue(await openMenu.findContent('label', /Apples/).find('input').isSelected());

    // Deselect Apples again
    await openMenu.findContent('label', /Apples/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));

    // Hit Escape, check that stored menu is back to initial state
    await driver.sendKeys(Key.ESCAPE);
    await driver.wait(until.stalenessOf(openMenu));
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));

    // Select all
    await driver.find('.test-filter-menu-bulk-action').click();
  });

  it('should filter items by search value', async () => {
    // Check that all items are displayed in the list
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: []}));
    assert.lengthOf(await driver.findAll('.test-filter-menu-list label'), 17);

    // Enter 'App'
    const searchInput = await driver.find('.test-filter-menu-search-input');
    await searchInput.click();
    assert.equal(await searchInput.value(), '');
    await driver.sendKeys('App');
    assert.equal(await searchInput.value(), 'App');

    // Check that only Apples and Knapples are in the list
    const elems = await driver.findAll('.test-filter-menu-list label');
    assert.lengthOf(elems, 2);
    assert.deepEqual(await Promise.all(elems.map(el => el.getText())), ['Apples', 'Knapples']);

    // Deselect Apples, check that filter is updated
    await driver.findContent('.test-filter-menu-list label', /Apples/).click();
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({excluded: ['Apples']}));
  });

  it('should show the total count of all values that don\'t match the search term', async () => {
    // click search input
    await driver.find('.test-filter-menu-search-input').click();

    // search `zzz`
    await driver.sendKeys('zzz');

    // check there are no matching values
    assert.match(await driver.find('.test-filter-menu-list').getText(), /No matching values/);

    // check the summary label is showing 'Others'
    assert.match(await driver.find('.test-filter-menu-summary label').getText(), /Others/);

    // check count is 8157
    assert.match(await driver.findContent('.test-filter-menu-summary', /Others/).getText(), /8,157/);

    // search 'Oranges'
    await driver.find('.test-filter-menu-search-close').click();
    await driver.sendKeys('Oranges');

    // check only one matching value
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()), ['Oranges']);

    // check 'Oranges' count is 14
    assert.deepEqual(await driver.findAll('.test-filter-menu-list .test-filter-menu-count', (e) => e.getText()),
      ['14']);

    // check `others` count is 8143
    assert.match(await driver.findContent('.test-filter-menu-summary', /Others/).getText(), /8,143/);

    // check 8143 + 14 = 8157
    assert.equal(8143 + 14, 8157);
  });

  it('should unselect all others when un-checking `others`', async () => {
    // click search input
    await driver.find('.test-filter-menu-search-input').click();

    // search 'App'
    await driver.sendKeys('App');

    // check Apples and Knapples are visible
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()), ['Apples', 'Knapples']);

    // check Others is checked
    assert.isTrue(await driver.findContent('.test-filter-menu-summary', /Others/).find('input').isSelected());

    // click Others
    await driver.findContent('.test-filter-menu-summary', /Others/).find('label').click();

    // check others is unchecked
    assert.isFalse(await driver.findContent('.test-filter-menu-summary', /Others/).find('input').isSelected());

    // press Escape to clear the search box
    await driver.sendKeys(Key.ESCAPE);

    // check only Apples and Knapples are selected
    assert.equal(await driver.find('.fixture-json').getText(), JSON.stringify({included: ['Apples', 'Knapples']}));
  });

  it('should select all others when checking `others`', async () => {
    // click search input
    await driver.find('.test-filter-menu-search-input').click();

    // search 'App'
    await driver.sendKeys('App');

    // check Apples and Knapples are visible
    assert.deepEqual(await driver.findAll('.test-filter-menu-list label', (e) => e.getText()), ['Apples', 'Knapples']);

    // check others is checked
    assert.isTrue(await driver.findContent('.test-filter-menu-summary', /Others/).find('input').isSelected());

    // uncheck Apple
    await driver.findContent('.test-filter-menu-list label', /Apples/).click();

    // click others twice to uncheck and check again
    await driver.findContent('.test-filter-menu-summary', /Others/).find('label').click();
    await driver.findContent('.test-filter-menu-summary', /Others/).find('label').click();

    // press escape to clear search box
    await driver.sendKeys(Key.ESCAPE);

    // check Apples is unselected
    const spec = JSON.parse(await driver.find('.fixture-json').getText());
    assert.deepEqual(spec.excluded, ['Apples']);
  });

  it('should clear the search box on Escape', async () => {
    await driver.sendKeys('App');

    // Check that searchbox is not empty
    assert.equal(await driver.find('.test-filter-menu-search-input').value(), 'App');

    // Press escape
    await driver.sendKeys(Key.ESCAPE);

    // check that search box is empty
    assert.equal(await driver.find('.test-filter-menu-search-input').value(), '');
  });

  it('should clear the search box when clicking the `x`', async () => {

    // search for App
    await driver.sendKeys('App');

    // check the search is not empty
    assert.equal(await driver.find('.test-filter-menu-search-input').value(), 'App');

    // click the 'x'
    await driver.find('.test-filter-menu-search-close').click();

    // check search box is empty
    assert.equal(await driver.find('.test-filter-menu-search-input').getText(), '');

    // search for app: to check if search box still has focus
    await driver.sendKeys('App');

    // check the search input is up to date
    assert.equal(await driver.find('.test-filter-menu-search-input').value(), 'App');
  });

  it('should give focus to the search input', async () => {
    // Open the filter menu
    await driver.find('.fixture-filter-menu-btn').click();
    const menu = await driver.findWait('.grist-floating-menu', 100);

    // check search input has autofocus
    assert.equal(await menu.findWait('.test-filter-menu-search-input:focus', 100).isPresent(), true);

    // type in App
    await driver.sendKeys('App');

    // check values are filtered
    assert.deepEqual(await menu.findAll('.test-filter-menu-list label', (e) => e.getText()), ['Apples', 'Knapples']);
  });

  it('should properly escape search and filter menu', async () => {
    // Open filter menu
    await driver.find('.fixture-filter-menu-btn').click();
    let menu = await driver.findWait('.grist-floating-menu', 100);

    // Hit escape, check that menu closed
    await driver.sendKeys(Key.ESCAPE);
    await driver.wait(until.stalenessOf(menu));
    assert.equal(await menu.isPresent(), false);

    // open filter menu again
    await driver.find('.fixture-filter-menu-btn').click();
    menu = await driver.findWait('.grist-floating-menu', 100);

    // search App
    await driver.sendKeys('App');

    // check search input is update to date
    assert.equal(await menu.find('.test-filter-menu-search-input').value(), 'App');

    // hit escape and check search input is clear
    await driver.sendKeys(Key.ESCAPE);
    assert.equal(await menu.find('.test-filter-menu-search-input').value(), '');

    // Hit escape again, check that menu has closed
    await driver.sendKeys(Key.ESCAPE);

    // Check that menu has been removed
    await driver.wait(until.stalenessOf(menu));
  });

  it('should update selection properly when clicking `All Shown`', async () => {
    // search for App
    await driver.sendKeys('App');

    // check All Shown and All Except are visible
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-bulk-action', (e) => e.getText()),
      ['All Shown', 'All Except']
    );

    // click All Shown
    await driver.findContent('.test-filter-menu-bulk-action', /All Shown/).click();

    // send Escape to clear the search box
    await driver.sendKeys(Key.ESCAPE);

    // check filter is inclusion filter with only Apples and Knapples
    const spec = JSON.parse(await driver.find('.fixture-json').getText());
    assert.deepEqual(spec.included, ['Apples', 'Knapples']);

    // search for App again
    await driver.sendKeys('App');

    // check App Shown is disabled
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
      ['All Shown']
    );
  });

  it('should update selection properly when clicking `All Except`', async () => {
    // search for App
    await driver.sendKeys('App');

    // click App Except
    await driver.findContent('.test-filter-menu-bulk-action', /All Except/).click();

    // send Escape to clear the search box
    await driver.sendKeys(Key.ESCAPE);

    // check filter is exclusion filter with only Apples and Knapples excluded
    const spec = JSON.parse(await driver.find('.fixture-json').getText());
    assert.deepEqual(spec.excluded, ['Apples', 'Knapples']);

    // search for App again
    await driver.sendKeys('App');

    // check App Except is disabled
    assert.deepEqual(
      await driver.findAll('.test-filter-menu-bulk-action:disabled', (e) => e.getText()),
      ['All Except']
    );
  });

  it('should update selection property on ENTER', async () => {
    // search for App
    await driver.sendKeys('App');

    // send ENTER
    await driver.sendKeys(Key.ENTER);

    // check filter is inclusion filter with only Apples and Knapples included
    const spec = JSON.parse(await driver.find('.fixture-json').getText());
    assert.deepEqual(spec.included, ['Apples', 'Knapples']);
  });
});
