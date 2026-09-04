import * as gu from "test/nbrowser/gristUtils";
import { cleanupExtraWindows, server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

async function fillCreateTeamModalInputs(name: string, domain: string) {
  await driver.findWait(".test-create-team-name", 500).click();
  await gu.sendKeys(name);
  await gu.sendKeys(Key.TAB);
  await gu.sendKeys(domain);
}

describe("Create Team Site", function() {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);
  });

  async function openCreateTeamModal() {
    await driver.findWait(".test-dm-org", 500).click();
    await driver.wait(async () => await driver.find(".test-site-switcher-create-new-site").isPresent(), 1000);
    await driver.find(".test-site-switcher-create-new-site").click();
  }

  async function goToNewTeamSite() {
    await driver.findWait(".test-create-team-confirmation-link", 500).click();
  }

  async function getTeamSiteName() {
    return await driver.findWait(".test-dm-orgname", 500).getText();
  }

  it("should work using the createTeamModal", async () => {
    assert.equal(await driver.find(".test-dm-org").isPresent(), true);
    const teamSiteName = await getTeamSiteName();
    assert.equal(teamSiteName, "Test Grist");
    await openCreateTeamModal();
    assert.equal(await driver.find(".test-create-team-creation-title").isPresent(), true);

    await fillCreateTeamModalInputs("Test Create Team Site", "testteamsite");
    await gu.sendKeys(Key.ENTER);
    assert.equal(await driver.findWait(".test-create-team-confirmation", 500).isPresent(), true);
    await goToNewTeamSite();
    const newTeamSiteName = await getTeamSiteName();
    assert.equal(newTeamSiteName, "Test Create Team Site");
  });

  it("should work only with unique domain", async () => {
    await openCreateTeamModal();
    await fillCreateTeamModalInputs("Test Create Team Site 1", "same-domain");
    await gu.sendKeys(Key.ENTER);
    await goToNewTeamSite();
    await openCreateTeamModal();
    await fillCreateTeamModalInputs("Test Create Team Site 2", "same-domain");
    await gu.sendKeys(Key.ENTER);
    const errorMessage = await driver.findWait(".test-notifier-toast-wrapper ", 500).getText();
    assert.include(errorMessage, "Domain already in use");
  });
});

// The welcome page offers this same modal when personal sites are off and the user has no team
// site to fall back on. Lives here rather than with the other welcome-page tests because only
// grist-core reaches CreateTeamModal from that button.
describe("Create Team Site from the welcome page", function() {
  this.timeout(30000);
  setupTestSuite();
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_PERSONAL_ORGS = "false";
    await server.restart(true); // clear database
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  it("creates the first site and then lists it", async function() {
    // No personal site to log into, so attach the session profile to no org at all.
    const { name, email } = gu.translateUser("user1");
    await gu.simulateLogin(name, email);
    await driver.get(`${server.getHost()}/welcome/teams`);
    await driver.findWait(".test-welcome-create-team-site", 3000).click();
    await fillCreateTeamModalInputs("Team Site", "team-site");
    await gu.sendKeys(Key.ENTER);
    await driver.findWait(".test-create-team-confirmation", 2000);
    await driver.get(`${server.getHost()}/welcome/teams`);
    assert.equal(await driver.findWait(".test-org", 3000).getText(), "Team Site");
    assert.isFalse(await driver.find(".test-welcome-no-sites").isPresent());
  });
});
