import {assert, driver} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('Icons', () => {
  setupTestSuite();

  before(async function() {
    this.timeout(90000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/Icons`);
  });

  it('should display all icons', async function() {
    const icons = await driver.findWait('#all_icons', 5000).findAll('#all_icons > div > *');
    assert.isAtLeast(icons.length, 10);
  });

  it('should have correct icon size', async function() {
    const searchIcon = await driver.find('#search_icon > div');
    assert.equal((await searchIcon.rect()).width, 16);
  });

  it('should allow resizing icons', async function() {
    const bigSearchIcon = await driver.find('#big_search_icon > div');
    assert.equal((await bigSearchIcon.rect()).width, 32);
  });
});
