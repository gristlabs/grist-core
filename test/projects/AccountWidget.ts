import {assert, driver, Key, stackWrapFunc} from 'mocha-webdriver';
import {server, setupTestSuite} from './testUtils';

describe('AccountWidget', function() {
  this.timeout(60000);      // Set a longer default timeout.
  setupTestSuite();

  const testCase = stackWrapFunc(async function(org: string, selectedOrgs: boolean[]) {
    // See the icon and open menu when loading plain DocMenu page.
    await driver.get(`${server.getHost()}/DocMenu#org=${org}&user=santa`);

    // The sign-in buttons shouldn't be shown on top.
    assert.equal(await driver.find('.test-user-sign-in').isPresent(), false);
    assert.equal(await driver.find('.test-user-sign-up').isPresent(), false);

    await driver.find('.test-user-icon').click();   // open the menu
    assert.equal(await driver.find('.test-usermenu-email').getText(), 'santa@getgrist.com');
    assert.deepEqual(await driver.findAll('.test-site-switcher-org-tick', (x) => x.isDisplayed()),
      selectedOrgs);
    await driver.sendKeys(Key.ESCAPE);              // close the menu

    // With an anonymous user, should see "Sign In" and "Sign Up", but NOT a user icon.
    await driver.get(`${server.getHost()}/DocMenu#org=${org}&user=anon`);
    assert.equal(await driver.find('.test-user-sign-in').getText(), 'Sign In');
    assert.equal(await driver.find('.test-user-sign-up').getText(), 'Sign Up');
    assert.equal(await driver.find('.test-user-icon').isPresent(), false);

    // Same with a null user.
    await driver.get(`${server.getHost()}/DocMenu#org=${org}&user=null`);
    assert.equal(await driver.find('.test-user-sign-in').getText(), 'Sign In');
    assert.equal(await driver.find('.test-user-sign-up').getText(), 'Sign Up');
    assert.equal(await driver.find('.test-user-icon').isPresent(), false);
  });

  it('should show user icon and open menu when logged in', async function() {
    // The booleans are the expected selection status for orgs listed in user menu.
    await testCase('chase', [false, false, true, false, false]);
  });

  it('should show user icon in the same way for inaccessible orgs', async function() {
    // The booleans are the expected selection status for orgs listed in user menu.
    await testCase('nonexistent', [false, false, false, false, false]);
  });
});
