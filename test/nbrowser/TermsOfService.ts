import { assert, driver } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from 'test/nbrowser/testUtils';
import { EnvironmentSnapshot } from 'test/server/testUtils';

describe('Terms of service link', function () {
  this.timeout(20000);
  setupTestSuite({samples: true});

  let session: gu.Session;
  let oldEnv: EnvironmentSnapshot;

  before(async function () {
    oldEnv = new EnvironmentSnapshot();
    session = await gu.session().teamSite.login();
  });

  after(async function () {
    oldEnv.restore();
    await server.restart();
  });

  it('is visible in home menu', async function () {
    process.env.GRIST_TERMS_OF_SERVICE_URL = 'https://example.com/tos';
    await server.restart();
    await session.loadDocMenu('/');
    assert.isTrue(await driver.find('.test-dm-tos').isDisplayed());
    assert.equal(await driver.find('.test-dm-tos').getAttribute('href'), 'https://example.com/tos');
  });

  it('is not visible when environment variable is not set', async function () {
    delete process.env.GRIST_TERMS_OF_SERVICE_URL;
    await server.restart();
    await session.loadDocMenu('/');
    assert.isFalse(await driver.find('.test-dm-tos').isPresent());
  });
});
