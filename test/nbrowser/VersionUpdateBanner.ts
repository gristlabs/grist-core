import { version as installedVersion } from "app/common/version";
import * as testUtils from 'test/server/testUtils';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {FakeUpdateServer, startFakeUpdateServer} from 'test/server/customUtil';
import {assert, driver} from 'mocha-webdriver';

describe('VersionUpdateBanner', function() {
  this.timeout(300000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let session: gu.Session;
  let fakeServer: FakeUpdateServer;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING = 'true';
    process.env.GRIST_TEST_IMMEDIATE_VERSION_CHECK = 'true';
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    fakeServer = await startFakeUpdateServer();
    process.env.GRIST_TEST_VERSION_CHECK_URL = `${fakeServer.url()}/version`;

  });

  beforeEach(async function() {
    fakeServer.payload = null;
    await server.restart(true);
    assert.isNotNull(fakeServer.payload, 'fake server should have received a version payload');
  });

  after(async function() {
    await fakeServer.close();
    oldEnv.restore();
    await server.restart();
  });

  it('should not be shown to non-managers', async () => {
    session = await gu.session().user('user2').personalSite.login({freshAccount: true});
    await driver.executeScript('window.localStorage.clear();');
    await session.loadDocMenu('/');

    await driver.findWait('.test-top-panel', 100);
    assert.equal((await driver.findAll('.test-version-update-banner-text')).length, 0);
  });

  it('should be shown to managers', async () => {
    session = await gu.session().personalSite.login({freshAccount: true});
    await driver.executeScript('window.localStorage.clear();');
    await session.loadDocMenu('/');

    await driver.findWait('.test-top-panel', 100);
    assert.equal(await driver.find('.test-version-update-banner-text').isDisplayed(), true);

    // Should be dismissable
    await driver.find('.test-banner-close').click();
    assert.equal((await driver.findAll('.test-version-update-banner-text')).length, 0);

    // Let's make sure it's still not there after being dismissed once
    await driver.navigate().refresh();
    await session.loadDocMenu('/');
    await driver.findWait('.test-top-panel', 100);
    assert.equal((await driver.findAll('.test-version-update-banner-text')).length, 0);

    // Update the version, the banner should come back
    fakeServer.bumpVersion();
    await server.restart(false);
    session = await gu.session().personalSite.login({freshAccount: false});
    await session.loadDocMenu('/');
    assert.equal(await driver.find('.test-version-update-banner-text').isDisplayed(), true);
  });

  it('should not be shown to managers when there is no newer version', async () => {
    fakeServer.latestVersion = installedVersion;
    await server.restart(true);
    session = await gu.session().personalSite.login({freshAccount: true});
    await driver.executeScript('window.localStorage.clear();');
    await session.loadDocMenu('/');

    await driver.findWait('.test-top-panel', 100);
    assert.equal((await driver.findAll('.test-version-update-banner-text')).length, 0);
  });

});
