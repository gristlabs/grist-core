import { GristDeploymentType } from "app/common/gristUrls";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("VersionFooter", function() {
  this.timeout("20s");
  const cleanup = setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let mainSession: gu.Session;
  let docId: string;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    mainSession = await gu.session().teamSite.user("user1").login();
    docId = await mainSession.tempNewDoc(cleanup, "VersionFooter.grist", { load: false });
  });

  after(async function() {
    oldEnv.restore();
    await server.restart();
  });

  afterEach(() => gu.checkForErrors());

  async function restartWithDeploymentType(deploymentType: GristDeploymentType) {
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = deploymentType;
    await server.restart();
    mainSession = await gu.session().teamSite.user("user1").login();
  }

  describe("in the community edition", function() {
    before(async function() {
      await restartWithDeploymentType("core");
    });

    it("shows a community banner in the doc page left panel", async function() {
      await mainSession.loadDoc(`/doc/${docId}`);
      await gu.toggleSidePanel("left", "open");

      const footer = await driver.find(".test-version-footer");
      assert.include(await footer.getText(), "Grist Community edition");
      assert.include(await footer.getText(), "No official support");
    });

    it("shows a popup with version and links on hover", async function() {
      await driver.find(".test-version-footer").mouseMove();
      const popup = await driver.findWait(".test-version-footer-popup", 2000);
      assert.equal(await popup.find(".test-version-footer-popup-title").getText(), "Grist Community edition");
      assert.match(await popup.find(".test-version-footer-popup-version").getText(), /^Version \d+\./);
      const links = await popup.findAll(".test-version-footer-popup-link", l => l.getAttribute("href"));
      assert.lengthOf(links, 2);
      assert.match(links[0], /grist-core\/releases\/tag/);
      assert.match(links[1], /grist-edition-comparison/);

      await popup.mouseMove();
      await driver.sleep(500);
      assert.isTrue(await driver.find(".test-version-footer-popup").isDisplayed());

      await driver.find(".test-top-header").mouseMove();
      await gu.waitToPass(async () => {
        assert.isFalse(await driver.find(".test-version-footer-popup").isPresent());
      }, 2000);
    });

    it("shows only the logo when the panel is collapsed", async function() {
      await gu.toggleSidePanel("left", "close");
      const footer = await driver.find(".test-version-footer");
      assert.isTrue(await footer.isDisplayed());
      assert.equal(await footer.getText(), "");
      await gu.toggleSidePanel("left", "open");
    });

    it("shows the footer on the home page", async function() {
      await mainSession.loadDocMenu("/");
      assert.include(await driver.find(".test-version-footer").getText(), "Grist Community edition");
    });
  });

  describe("in the full edition", function() {
    before(async function() {
      await restartWithDeploymentType("enterprise");
    });

    it("shows a plain version footer with a release notes link", async function() {
      await mainSession.loadDocMenu("/");
      assert.match(await driver.find(".test-version-footer").getText(), /^Grist v\d+\./);

      await driver.find(".test-version-footer").mouseMove();
      const popup = await driver.findWait(".test-version-footer-popup", 2000);
      assert.equal(await popup.find(".test-version-footer-popup-title").getText(), "Grist");
      const links = await popup.findAll(".test-version-footer-popup-link", l => l.getAttribute("href"));
      assert.lengthOf(links, 1);
      assert.match(links[0], /grist-core\/releases\/tag/);
    });
  });

  describe("on getgrist.com", function() {
    before(async function() {
      await restartWithDeploymentType("saas");
    });

    it("shows a plain version footer without links", async function() {
      await mainSession.loadDocMenu("/");
      assert.match(await driver.find(".test-version-footer").getText(), /^Grist v\d+\./);

      await driver.find(".test-version-footer").mouseMove();
      const popup = await driver.findWait(".test-version-footer-popup", 2000);
      assert.equal(await popup.find(".test-version-footer-popup-title").getText(), "Grist");
      assert.isFalse(await popup.find(".test-version-footer-popup-link").isPresent());
    });
  });
});
