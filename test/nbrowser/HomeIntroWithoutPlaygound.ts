import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('HomeIntroWithoutPlayground', function() {
  this.timeout(40000);
  setupTestSuite({samples: true});
  gu.withEnvironmentSnapshot({'GRIST_ANON_PLAYGROUND': false});

  describe("Anonymous on merged-org", function() {
    it('should show welcome page with signin and signup buttons and "add new" button disabled', async function () {
      // Sign out
      const session = await gu.session().personalSite.anon.login();

      // Open doc-menu
      await session.loadDocMenu('/');

      assert.equal(await driver.find('.test-welcome-title').getText(), 'Welcome to Grist!');
      assert.match(
        await driver.find('.test-welcome-text-no-playground').getText(),
        /Visit our Help Center.*about Grist./
      );

      // Check the sign-up and sign-in buttons.
      const getSignUp = async () => await driver.findContent('.test-intro-sign-up', 'Sign up');
      const getSignIn = async () => await driver.findContent('.test-intro-sign-in', 'Sign in');
      // Check that these buttons take us to a Grist login page.
      for (const getButton of [getSignUp, getSignIn]) {
        const button = await getButton();
        await button.click();
        await gu.checkLoginPage();
        await driver.navigate().back();
        await gu.waitForDocMenuToLoad();
      }
    });

    it('should not allow creating new documents', async function () {
      // Sign out
      const session = await gu.session().personalSite.anon.login();

      // Open doc-menu
      await session.loadDocMenu('/');

      // Check that add-new button is disabled
      assert.equal(await driver.find('.test-dm-add-new').matches('[class*=-disabled]'), true);

      // Check that add-new menu is not displayed
      await driver.find('.test-dm-add-new').doClick();
      assert.equal(await driver.find('.test-dm-new-doc').isPresent(), false);
    });
  });
});
