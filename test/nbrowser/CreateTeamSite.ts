import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { cleanupExtraWindows, setupTestSuite } from 'test/nbrowser/testUtils';

describe('Create Team Site', function () {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();

  before(async function () {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
  });

  async function openCreateTeamModal() {
    await driver.findWait('.test-dm-org', 500).click();
    assert.equal(await driver.find('.test-site-switcher-create-new-site').isPresent(), true);
    await driver.find('.test-site-switcher-create-new-site').click();
  }

  async function fillCreateTeamModalInputs(name: string, domain: string) {
    await driver.findWait('.test-create-team-name', 500).click();
    await gu.sendKeys(name);
    await gu.sendKeys(Key.TAB);
    await gu.sendKeys(domain);
  }

  async function goToNewTeamSite() {
    await driver.findWait('.test-create-team-confirmation-link', 500).click();
  }

  async function getTeamSiteName() {
    return await driver.findWait('.test-dm-orgname', 500).getText();
  }

  it('should work using the createTeamModal', async () => {
    assert.equal(await driver.find('.test-dm-org').isPresent(), true);
    const teamSiteName = await getTeamSiteName();
    assert.equal(teamSiteName, 'Test Grist');
    await openCreateTeamModal();
    assert.equal(await driver.find('.test-create-team-creation-title').isPresent(), true);

    await fillCreateTeamModalInputs("Test Create Team Site", "testteamsite");
    await gu.sendKeys(Key.ENTER);
    assert.equal(await driver.findWait('.test-create-team-confirmation', 500).isPresent(), true);
    await goToNewTeamSite();
    const newTeamSiteName = await getTeamSiteName();
    assert.equal(newTeamSiteName, 'Test Create Team Site');
  });

  it('should work only with unique domain', async () => {
    await openCreateTeamModal();
    await fillCreateTeamModalInputs("Test Create Team Site 1", "same-domain");
    await gu.sendKeys(Key.ENTER);
    await goToNewTeamSite();
    await openCreateTeamModal();
    await fillCreateTeamModalInputs("Test Create Team Site 2", "same-domain");
    await gu.sendKeys(Key.ENTER);
    const errorMessage = await driver.findWait('.test-notifier-toast-wrapper ', 500).getText();
    assert.include(errorMessage, 'Domain already in use');
  });
});
