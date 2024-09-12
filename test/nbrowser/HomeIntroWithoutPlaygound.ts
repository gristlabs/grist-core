import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('HomeIntroWithoutPlayground', function() {
  this.timeout(20000);
  setupTestSuite({samples: true});
  gu.withEnvironmentSnapshot({'GRIST_ANON_PLAYGROUND': false});

  describe("Anonymous on merged-org", function() {
    it('should show welcome page', async function () {
      const session = await gu.session().personalSite.anon.login();
      await session.loadDocMenu('/');
      assert.equal(await driver.find('.test-welcome-title').getText(), 'Welcome to Grist!');
    });

    it('should not allow creating new documents', async function () {
      const session = await gu.session().personalSite.anon.login();
      await session.loadDocMenu('/');

      // Check that the Add New button is disabled.
      assert.equal(await driver.find('.test-dm-add-new').matches('[class*=-disabled]'), true);
      await driver.find('.test-dm-add-new').doClick();
      assert.equal(await driver.find('.test-dm-new-doc').isPresent(), false);

      // Check that the intro buttons are also disabled.
      assert.equal(await driver.find('.test-intro-create-doc').getAttribute('disabled'), 'true');
      assert.equal(await driver.find('.test-intro-import-doc').getAttribute('disabled'), 'true');
    });
  });
});
