import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("Features", function() {
  this.timeout(20000);
  setupTestSuite({ samples: true });

  let session: gu.Session;
  let oldEnv: EnvironmentSnapshot;

  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    session = await gu.session().teamSite.login();
  });

  after(async function() {
    oldEnv.restore();
    await server.restart();
  });

  it("can be enabled with the GRIST_UI_FEATURES env variable", async function() {
    process.env.GRIST_TEMPLATE_ORG = "templates";
    process.env.GRIST_UI_FEATURES = "helpCenter,templates";
    await server.restart();
    await session.loadDocMenu("/");
    assert.isTrue(await driver.find(".test-dm-templates-page").isDisplayed());
    assert.isTrue(await driver.find(".test-left-feedback").isDisplayed());
    assert.isFalse(await driver.find(".test-dm-basic-tutorial").isDisplayed());
  });

  it("can be disabled with the GRIST_HIDE_UI_ELEMENTS env variable", async function() {
    process.env.GRIST_UI_FEATURES = "helpCenter,tutorials";
    process.env.GRIST_HIDE_UI_ELEMENTS = "templates";
    process.env.GRIST_ONBOARDING_TUTORIAL_DOC_ID = "tutorialDocId";
    await server.restart();
    await session.loadDocMenu("/");
    assert.isTrue(await driver.find(".test-left-feedback").isDisplayed());
    assert.isTrue(await driver.find(".test-dm-basic-tutorial").isDisplayed());
    assert.isFalse(await driver.find(".test-dm-templates-page").isDisplayed());
  });

  it("that are disabled take precedence over those that are also enabled", async function() {
    process.env.GRIST_UI_FEATURES = "tutorials,templates";
    process.env.GRIST_HIDE_UI_ELEMENTS = "helpCenter,templates";
    await server.restart();
    await session.loadDocMenu("/");
    assert.isTrue(await driver.find(".test-dm-basic-tutorial").isDisplayed());
    assert.isFalse(await driver.find(".test-left-feedback").isPresent());
    assert.isFalse(await driver.find(".test-dm-templates-page").isDisplayed());
  });

  it("can hide automations with GRIST_HIDE_UI_ELEMENTS", async function() {
    process.env.GRIST_HIDE_UI_ELEMENTS = "automations";
    delete process.env.GRIST_UI_FEATURES;
    await server.restart();
    // Login fresh after restart and create a doc to check the left panel.
    const s = await gu.session().personalSite.login();
    const api = s.createHomeApi();
    const wss = await api.getOrgWorkspaces("current");
    const docId = await api.newDoc({ name: "TestFeatures" }, wss[0].id);
    await s.loadDoc(`/doc/${docId}`);
    assert.isFalse(await driver.find(".test-tools-automations").isPresent());
    await api.deleteDoc(docId);
  });
});
