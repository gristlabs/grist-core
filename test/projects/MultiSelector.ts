import {assert, driver} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('MultiSelector', () => {
  setupTestSuite();

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/MultiSelector`);
  });

  it('should start with no columns selected', async function() {
    const items = await driver.find('.test-ms-list').findAll('.test-ms-item');
    assert.equal(items.length, 0);
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), []);
  });

  it('should allow adding a column with no option selected and set its value', async function() {
    await driver.find('.test-ms-add-btn').doClick();
    const addItem = await driver.find('.test-ms-list').find('.test-ms-add-item');
    assert.equal(await addItem.find('select').value(), 'Select state');
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), []);

    // 50 states plus the empty select
    assert.equal((await addItem.findAll('option')).length, 51);

    await addItem.find('select').doClick();
    await addItem.findContent('select > option', /New York/).doClick();

    const items = await driver.find('.test-ms-list').findAll('.test-ms-item');
    assert.equal(items.length, 1);
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "New York", value: "NY" }
    ]);
  });

  it('should allow adding a second column', async function() {
    await driver.find('.test-ms-add-btn').doClick();

    assert.equal((await driver.find('.test-ms-list').findAll('.test-ms-item')).length, 1);

    const addItem = await driver.find('.test-ms-list').find('.test-ms-add-item');
    assert.equal(await addItem.find('select').value(), 'Select state');

    await addItem.find('select').doClick();
    await addItem.findContent('select > option', /Alaska/).doClick();

    assert.equal((await driver.find('.test-ms-list').findAll('.test-ms-item')).length, 2);
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "New York", value: "NY" },
      { label: "Alaska", value: "AK" }
    ]);
  });

  it('should allow changing values', async function() {
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "New York", value: "NY" },
      { label: "Alaska", value: "AK" }
    ]);

    const items = await driver.find('.test-ms-list').findAll('.test-ms-item');
    await items[0].find('select').doClick();
    await items[0].findContent('select > option', /New Jersey/).doClick();
    await items[1].find('select').doClick();
    await items[1].findContent('select > option', /Rhode Island/).doClick();

    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "New Jersey", value: "NJ" },
      { label: "Rhode Island", value: "RI" }
    ]);
  });

  it('should allow removing a column', async function() {
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "New Jersey", value: "NJ" },
      { label: "Rhode Island", value: "RI" }
    ]);

    const items = await driver.find('.test-ms-list').findAll('.test-ms-item');
    await items[0].find('.test-ms-remove-btn').doClick();

    assert.equal((await driver.find('.test-ms-list').findAll('.test-ms-item')).length, 1);
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), [
      { label: "Rhode Island", value: "RI" }
    ]);

    await items[1].find('.test-ms-remove-btn').doClick();

    assert.equal((await driver.find('.test-ms-list').findAll('.test-ms-item')).length, 0);
    assert.deepEqual(JSON.parse(await driver.find('pre').getText()), []);
  });
});
