/**
 * Tests the "Notifications and Automations" nudge in Document Settings. We force a "core"
 * deployment so the nudge (not the live Notifications card) shows whichever edition built the
 * server, and so "Choose full Grist edition" is never satisfied: no feature is fully set up and
 * all share that first unmet step.
 *
 * "Choose full Grist edition" is then deterministically unmet, but email and redis vary with the
 * server: email is done iff a notifier is configured, redis iff a Redis URL is. Neither can be
 * forced here, so the test reads `notifierEnabled` and `redisAvailable` from the page config and
 * asserts exact counts.
 */
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("NotificationsNudge", function() {
  this.timeout(30000);
  const cleanup = setupTestSuite();

  let session: gu.Session;

  // Force "core" so the nudge shows instead of the live card.
  gu.withEnvironmentSnapshot({ GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core" });

  before(async function() {
    session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup, "NotificationsNudge");
    await gu.openDocumentSettings();
  });

  // email and redis are the steps whose state varies by server config; read the page-config
  // flags behind them so the counts can be asserted exactly.
  function configFlag(name: string): Promise<boolean> {
    return driver.executeScript(
      `return Boolean(window.gristConfig && window.gristConfig.${name})`);
  }
  const emailStepDone = () => configFlag("notifierEnabled");
  const redisStepDone = () => configFlag("redisAvailable");

  it("shows the intro and a single shared next step", async function() {
    assert.isTrue(await driver.findWait(".test-notifications-intro", 5000).isDisplayed());
    assert.match(await driver.find(".test-notifications-intro").getText(),
      /need additional setup/);
    // The session user is a site owner but not an install admin, so on this self-hosted server
    // they can't act on the (install-level) edition step: descriptive voice and an ask affordance.
    assert.match(await driver.find(".test-notifications-intro").getText(),
      /whoever manages this Grist installation/);
    // All features share the same first unmet step, so the pointer appears once under the intro.
    assert.lengthOf(await driver.findAll(".test-notifications-next"), 1);
    assert.match(await driver.find(".test-notifications-next").getText(),
      /Everything below is waiting on.*Choose full Grist edition/);
    assert.isTrue(await driver.find(".test-notifications-ask").isPresent());
    // The learn-more link, upgrade button and remaining-steps list were removed.
    assert.isFalse(await driver.find(".test-notifications-buttons").isPresent());
    assert.isFalse(await driver.find(".test-notifications-remaining").isPresent());
  });

  it("shows a pip meter and step count per feature", async function() {
    for (const id of ["automations", "assistant", "invites", "notifications"]) {
      assert.isTrue(await driver.find(`.test-notifications-feature-${id}`).isPresent(),
        `missing feature ${id}`);
    }
    // "Choose full Grist edition" is never satisfied here, so no feature is fully installed.
    assert.lengthOf(await driver.findAll(".test-notifications-feature-todo"), 4);
    assert.lengthOf(await driver.findAll(".test-notifications-feature-ready"), 0);
    // One pip per prerequisite: automations 3 + invites 2 + notifications 3 + assistant 2.
    assert.lengthOf(await driver.findAll(".test-notifications-pip"), 10);
    // "n of m steps" — full Grist edition and the automations plan are always unmet here (a core
    // server); email and redis are done per their config flags. automations needs
    // full-grist + automations-plan + email; notifications needs full-grist + email + redis.
    assert.lengthOf(await driver.findAll(".test-notifications-steps"), 4);
    const emailDone = await emailStepDone() ? 1 : 0;
    const redisDone = await redisStepDone() ? 1 : 0;
    assert.match(await driver.find(".test-notifications-feature-automations").getText(),
      new RegExp(`${emailDone} of 3 steps`));
    assert.match(await driver.find(".test-notifications-feature-notifications").getText(),
      new RegExp(`${emailDone + redisDone} of 3 steps`));
  });

  it("expands a feature row to a description and step checklist", async function() {
    const feature = driver.find(".test-notifications-feature-automations");
    // Collapsed by default: the checklist exists but is hidden.
    assert.isFalse(await feature.find(".test-notifications-step").isDisplayed());
    await feature.find(".test-notifications-feature-head").click();
    await gu.waitToPass(async () => {
      assert.isTrue(await feature.find(".test-notifications-step").isDisplayed());
    });
    const stepText = await Promise.all(
      (await feature.findAll(".test-notifications-step")).map(e => e.getText()));
    assert.deepEqual(stepText,
      ["Choose full Grist edition", "Use a plan with automations", "Connect email delivery"]);
    // full Grist edition and the automations plan are always todos here; email is done iff a
    // notifier is configured.
    const emailDone = await emailStepDone();
    assert.lengthOf(await feature.findAll(".test-notifications-step-done"), emailDone ? 1 : 0);
    assert.lengthOf(await feature.findAll(".test-notifications-step-todo"), emailDone ? 2 : 3);
    // Collapse again.
    await feature.find(".test-notifications-feature-head").click();
    await gu.waitToPass(async () => {
      assert.isFalse(await feature.find(".test-notifications-step").isDisplayed());
    });
  });

  it("does not show the nudge on a fork (a non-live doc)", async function() {
    const docId = await session.tempNewDoc(cleanup, "NotificationsNudgeFork", { load: false });
    // Open in fork mode and make an edit; this turns the doc into an (unsaved) fork.
    await session.loadDoc(`/doc/${docId}/m/fork`);
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.enterCell("1");
    await gu.waitForServer();
    assert.match(await driver.getCurrentUrl(), /~/, "expected to be on a fork URL");

    await gu.openDocumentSettings();
    assert.isFalse(await driver.find(".test-notifications-intro").isPresent());
  });
});
