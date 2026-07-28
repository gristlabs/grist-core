import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("UserManagerNudge", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  let session: gu.Session;
  let docId: string;

  const restartWithEnv = gu.withEnvironmentSnapshot({ GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core" });

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "UserManagerNudge");
  });

  function configFlag(name: string): Promise<boolean> {
    return driver.executeScript(
      `return Boolean(window.gristConfig && window.gristConfig.${name})`);
  }

  async function openDocUserManager() {
    await driver.findWait(".test-tb-share", 2000).click();
    await driver.findContentWait(".test-tb-share-option", /(manage users)|(access details)/i, 1000).click();
    await driver.findWait(".test-um-members", 3000);
  }

  async function closeUserManager() {
    await driver.find(".test-um-cancel").click();
    await driver.wait(async () => !(await driver.find(".test-um-members").isPresent()), 3000);
  }

  it("explains why invites won't be sent and offers to ask the admin", async function() {
    await openDocUserManager();
    const nudge = await driver.findWait(".test-um-no-invite-email", 2000);
    assert.match(await nudge.getText(), /Invitation emails are not sent on Grist Community edition/);
    assert.isFalse(await nudge.find(".test-um-no-invite-email-action").isPresent());
    assert.isTrue(await nudge.find(".test-notifications-ask").isPresent());
    await closeUserManager();
  });

  it("shows the nudge on the team site dialog", async function() {
    await session.loadDocMenu("/");
    await gu.editOrgAcls();
    assert.match(await driver.findWait(".test-um-no-invite-email", 2000).getText(),
      /Invitation emails are not sent on Grist Community edition/);
    await closeUserManager();
  });

  it("records a setup request when asking the admin", async function() {
    await session.loadDoc(`/doc/${docId}`);
    await openDocUserManager();
    await driver.findWait(".test-um-no-invite-email", 2000).find(".test-notifications-ask").click();
    await gu.waitToPass(async () => {
      assert.match(await driver.find(".test-notifications-asked").getText(), /You've asked for this/);
    });

    // Reopening reads the request back from the server, rather than offering the button again.
    await closeUserManager();
    await openDocUserManager();
    await driver.findWait(".test-notifications-asked", 2000);
    assert.isFalse(await driver.find(".test-notifications-ask").isPresent());
    await closeUserManager();
  });

  it("is not shown in the personal access details dialog", async function() {
    const viewer = gu.session().teamSite.user("user2");
    await session.createHomeApi().updateDocPermissions(docId, {
      users: { [viewer.email]: "viewers" },
    });
    await viewer.login();
    await viewer.loadDoc(`/doc/${docId}`);
    await openDocUserManager();
    assert.isFalse(await driver.find(".test-um-no-invite-email").isPresent());
  });

  describe("as an install admin on the community edition", function() {
    before(async function() {
      await restartWithEnv({
        GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core",
        GRIST_DEFAULT_EMAIL: gu.session().email,
      });
      session = await gu.session().teamSite.login();
      await session.loadDoc(`/doc/${docId}`);
    });

    it("links to the admin panel to switch to the full edition", async function() {
      await openDocUserManager();
      const nudge = await driver.findWait(".test-um-no-invite-email", 2000);
      assert.match(await nudge.getText(), /Invitation emails are not sent on Grist Community edition/);
      assert.isFalse(await nudge.find(".test-notifications-ask").isPresent());

      const action = nudge.find(".test-um-no-invite-email-action");
      assert.equal(await action.getText(), "Choose full Grist edition");
      assert.match(await action.getAttribute("href"), /\/admin#edition$/);
      assert.equal(await action.getAttribute("target"), "_blank");
      await closeUserManager();
    });
  });

  describe("as an install admin on the full edition", function() {
    before(async function() {
      await restartWithEnv({
        GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "enterprise",
        GRIST_DEFAULT_EMAIL: gu.session().email,
      });
      session = await gu.session().teamSite.login();
      await session.loadDoc(`/doc/${docId}`);
    });

    it("links to the Help Center to set up email notifications", async function() {
      assert.isFalse(await configFlag("notifierEnabled"), "expected no notifier on this server");

      await openDocUserManager();
      const nudge = await driver.findWait(".test-um-no-invite-email", 2000);
      assert.match(await nudge.getText(), /Invitation emails are not enabled on this installation/);
      assert.isFalse(await nudge.find(".test-notifications-ask").isPresent());

      const action = nudge.find(".test-um-no-invite-email-action");
      assert.equal(await action.getText(), "Configure notifications");
      assert.equal(await action.getAttribute("href"),
        "https://support.getgrist.com/self-managed/#how-do-i-set-up-email-notifications");
      assert.equal(await action.getAttribute("target"), "_blank");
      await closeUserManager();
    });
  });
});
