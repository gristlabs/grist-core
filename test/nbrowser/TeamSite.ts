import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("TeamSite", function() {
  this.timeout(60000);
  setupTestSuite();

  let session: gu.Session;
  let originalName: string;

  afterEach(() => gu.checkForErrors());

  gu.withEnvironmentSnapshot({
    GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core",
  });

  it("should not show Site settings on a personal site", async function() {
    session = await gu.session().personalSite.login();
    await session.loadDocMenu("/");

    await gu.openAccountMenu();
    assert.equal(await driver.find(".test-dm-site-settings").isPresent(), false);
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should show Site settings menu item on the team site", async function() {
    session = await gu.session().teamSite.login();
    await session.loadDocMenu("/");

    await gu.openAccountMenu();
    assert.equal(await driver.find(".test-dm-site-settings").isPresent(), true);
    await driver.sendKeys(Key.ESCAPE);
  });

  it("should load the site settings page", async function() {
    await gu.openAccountMenu();
    await driver.findWait(".test-dm-site-settings", 100).click();

    assert.equal(await driver.findWait(".test-ts-page", 1000).isDisplayed(), true);

    originalName = await driver.find(".test-ts-name").getText();
    assert.equal(originalName, session.teamSite.orgName);
  });

  it("should open edit mode and change team name", async function() {
    // Click "Change info" to enter edit mode.
    await driver.find(".test-ts-change").click();
    await driver.findWait(".test-ts-edit", 2000);

    // Clear the name and type a new one.
    const nameInput = driver.find(".test-ts-name-input");
    await nameInput.clear();
    const newName = originalName + " Renamed";
    await nameInput.sendKeys(newName);

    // Save.
    await driver.find(".test-ts-save").click();
    await gu.waitForServer();

    // Should be back in summary view with updated name.
    await driver.findWait(".test-ts-page", 5000);
    const updatedName = await driver.find(".test-ts-name").getText();
    assert.equal(updatedName, newName);

    // Restore original name.
    await driver.find(".test-ts-change").click();
    await driver.findWait(".test-ts-edit", 2000);
    const restoreInput = driver.find(".test-ts-name-input");
    await restoreInput.clear();
    await restoreInput.sendKeys(originalName);
    await driver.find(".test-ts-save").click();
    await gu.waitForServer();
    await driver.findWait(".test-ts-page", 5000);
  });

  it("should allow going back from edit mode without saving", async function() {
    await driver.find(".test-ts-change").click();
    await driver.findWait(".test-ts-edit", 2000);

    // Type something different.
    const nameInput = driver.find(".test-ts-name-input");
    await nameInput.clear();
    await nameInput.sendKeys("Should Not Save");

    // Click back.
    await driver.find(".test-ts-back").click();

    // Should be back in summary view with original name.
    await driver.findWait(".test-ts-page", 5000);
    const currentName = await driver.find(".test-ts-name").getText();
    assert.equal(currentName, originalName);
  });
});
