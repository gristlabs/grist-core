import {assert, driver} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('errorPages', function() {
  this.timeout(60000);      // Set a longer default timeout.
  setupTestSuite();

  it('should show forbidden page for inaccessible orgs', async function() {
    // No error loading plain DocMenu page.
    await driver.get(`${server.getHost()}/DocMenu`);
    assert.equal(await driver.find('.test-error-header').isPresent(), false);

    // We are still user "Santa"
    await driver.get(`${server.getHost()}/DocMenu#org=nonexistent`);
    assert.equal(await driver.find('.test-error-header').getText(), 'Access denied');
    assert.equal(await driver.find('.test-error-signin').getText(), 'Add account');

    // Check the same for the Anonymous user.
    await driver.get(`${server.getHost()}/DocMenu#org=nonexistent&user=anon`);
    assert.equal(await driver.find('.test-error-header').getText(), 'Access denied');
    assert.equal(await driver.find('.test-error-signin').getText(), 'Sign in');

    // Check the same for missing user.
    await driver.get(`${server.getHost()}/DocMenu#org=nonexistent&user=null`);
    assert.equal(await driver.find('.test-error-header').getText(), 'Access denied');
    assert.equal(await driver.find('.test-error-signin').getText(), 'Sign in');
  });
});
