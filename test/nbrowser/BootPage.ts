import { Activation } from "app/gen-server/entity/Activation";
import { toggleItem } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("BootPage", function() {
  this.timeout(60000);

  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  const waitForBootPage = () => driver.findWait(".test-boot-page-content", 2000);

  const setActivationNoVars = async () => {
    const db = await server.getDatabase();
    await db.connection.manager.deleteAll(Activation);
    await db.connection.manager.insert(Activation, {
      id: "installation1",
      prefs: {},
    });
  };

  describe("setup gate on new installation", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";

      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_BOOT_KEY;

      await server.restart();
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("redirects most paths to /boot", async function() {
      for (const path of ["/", "/p/trash", "/account", "/login", "/somewhere"]) {
        await driver.get(server.getHost() + path);
        await waitForBootPage();
      }
    });

    it("allows access to /admin", async function() {
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      assert.equal(await driver.find(".test-admin-panel").isDisplayed(), true);
      assert.match(await driver.find(".test-admin-panel").getText(), /Administrator Panel Unavailable/);
    });
  });

  describe("setup gate on existing installation", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
      process.env.GRIST_DEFAULT_EMAIL = gu.session().user("user1").email;

      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_BOOT_KEY;

      // Existing installations have an activations record without `GRIST_IN_SERVICE` or `GRIST_BOOT_KEY`
      // in `prefs.envVars`.
      await setActivationNoVars();

      await server.restart();
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("is disabled by default", async function() {
      await gu.session().user("user1").login();

      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();

      await driver.get(`${server.getHost()}/somewhere`);
      assert.match(await driver.findWait(".test-error-header", 2000).getText(), /Page not found/);
    });

    it("reports server is in service in Admin Panel", async function() {
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "in service",
      );
      await toggleItem("service-status");
      assert.isFalse(await driver.find(".test-service-status-env-variable-notice").isPresent());
    });

    it("reports boot key is disabled in Admin Panel", async function() {
      assert.equal(
        await driver.find(".test-admin-panel-item-value-boot-key").getText(),
        "disabled",
      );
      await toggleItem("boot-key");
      assert.isFalse(await driver.find(".test-boot-key-status-remove-boot-key").isPresent());
      assert.isFalse(await driver.find(".test-boot-key-status-env-variable-notice").isPresent());
    });

    it("can take server out of service via Admin Panel", async function() {
      // Add another user to check their access after taking server out of service.
      await gu.session().user("user2").addLogin();
      await gu.switchUser(gu.session().user("user1").email);

      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      await toggleItem("service-status");
      await driver.find(".test-service-status-enter-maintenance-mode").click();
      await driver.find(".test-modal-confirm").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.equal(
          await driver.find(".test-admin-panel-item-value-service-status").getText(),
          "out of service",
        ),
      );

      // Admin still has access.
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();

      // Non-admin no longer has access.
      await gu.switchUser(gu.session().user("user2").email);
      await driver.get(`${server.getHost()}/`);
      await waitForBootPage();

      // Anonymous no longer has access.
      await gu.removeLogin();
      await driver.get(`${server.getHost()}/`);
      await waitForBootPage();
    });

    it("can restore service via Admin Panel", async function() {
      process.env.GRIST_BOOT_KEY = "abc123";
      await server.restart();

      await driver.get(`${server.getHost()}/admin?boot-key=abc123`);
      await gu.waitForAdminPanel();
      await toggleItem("service-status");
      await driver.find(".test-service-status-restore-service").click();
      await driver.find(".test-modal-confirm").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.equal(
          await driver.find(".test-admin-panel-item-value-service-status").getText(),
          "in service",
        ),
      );
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();
    });
  });

  describe("login without GRIST_BOOT_KEY set", function() {
    let bootKey = "";

    before(async function() {
      await server.removeLogin();

      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";

      delete process.env.DOC_ID_NEW_USER_INFO;
      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_BOOT_KEY;

      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("rejects invalid boot key", async function() {
      await driver.get(`${server.getHost()}/`);
      await waitForBootPage();
      await driver.find(".test-boot-page-boot-key-input").sendKeys("invalid");
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.match(
          await driver.find(".test-boot-page-boot-key-error").getText(),
          /Invalid boot key/,
        ),
      );
    });

    it("accepts valid boot key", async function() {
      const db = await server.getDatabase();
      const activation = await db.connection.manager.findOneOrFail(Activation, { where: {} });
      bootKey = activation.prefs?.envVars?.GRIST_BOOT_KEY ?? "";
      assert.lengthOf(bootKey, 24);

      await driver.find(".test-boot-page-boot-key-input").doClear().sendKeys(bootKey);
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      assert.match(
        await driver.findWait(".test-boot-page-boot-key-verified", 2000).getText(),
        /Valid boot key/,
      );
    });

    it("redirects to /admin after submitting admin email", async function() {
      assert.equal(
        await driver.find(".test-boot-page-email-input").getAttribute("value"),
        "",
      );
      await driver.find(".test-boot-page-email-input").sendKeys("john@example.com");
      await driver.find(".test-boot-page-continue").click();
      await gu.waitForServer();
      await gu.waitForAdminPanel();
      const { name, email } = await gu.getUser();
      assert.deepEqual({ name, email }, { name: "john", email: "john@example.com" });
    });

    it("auto-fills admin email on subsequent login", async function() {
      await driver.get(`${server.getHost()}/boot`);
      await waitForBootPage();
      await driver.find(".test-boot-page-boot-key-input").doClear().sendKeys(bootKey);
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      assert.equal(
        await driver.find(".test-boot-page-email-input").getAttribute("value"),
        "john@example.com",
      );
    });

    it("changes admin email on login", async function() {
      await driver.find(".test-boot-page-email-input").doClear().sendKeys("admin@example.com");
      await driver.find(".test-boot-page-continue").click();
      await gu.waitForServer();
      await gu.waitForAdminPanel();
      const { name, email } = await gu.getUser();
      assert.deepEqual({ name, email }, { name: "admin", email: "admin@example.com" });

      // Make sure signing in cleared the previous session user.
      await driver.find(".test-user-icon").click();
      assert.isEmpty(await driver.findAll(".test-usermenu-other-email"));
    });

    it("reports server is out of service in Admin Panel", async function() {
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "out of service",
      );
      await toggleItem("service-status");
      assert.isFalse(await driver.find(".test-service-status-env-variable-notice").isPresent());
    });

    it("allows admins to visit other pages", async function() {
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();
    });

    it("blocks non-admins from visiting other pages", async function() {
      await server.removeLogin();
      for (const path of ["/", "/p/trash", "/account", "/login", "/somewhere"]) {
        await driver.get(server.getHost() + path);
        await waitForBootPage();
      }
    });

    it("allows access to /admin with boot-key param", async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=${bootKey}`);
      await gu.waitForAdminPanel();
      await driver.findContentWait("div", /Is home page available/, 2000);
    });

    it("can restore service via Admin Panel", async function() {
      await toggleItem("service-status");
      await driver.find(".test-service-status-restore-service").click();
      await driver.find(".test-modal-confirm").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.equal(
          await driver.find(".test-admin-panel-item-value-service-status").getText(),
          "in service",
        ),
      );

      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();
    });

    it("reports boot key is enabled in Admin Panel", async function() {
      await driver.get(`${server.getHost()}/boot`);
      await waitForBootPage();
      await driver.find(".test-boot-page-boot-key-input").doClear().sendKeys(bootKey);
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      await driver.find(".test-boot-page-continue").click();
      await gu.waitForServer();
      await gu.waitForAdminPanel();

      assert.equal(
        await driver.findWait(".test-admin-panel-item-value-boot-key", 2000).getText(),
        "enabled",
      );

      await toggleItem("boot-key");
      assert.isTrue(await driver.find(".test-boot-key-status-remove-boot-key").isDisplayed());
      assert.isFalse(await driver.find(".test-boot-key-status-env-variable-notice").isPresent());
    });

    it("can remove boot key via Admin Panel", async function() {
      await gu.waitToPass(async () =>
        driver.find(".test-boot-key-status-remove-boot-key").click());
      await driver.find(".test-modal-confirm").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.equal(
          await driver.find(".test-admin-panel-item-value-boot-key").getText(),
          "disabled",
        ),
      );
      const db = await server.getDatabase();
      const activation = await db.connection.manager.findOneOrFail(Activation, { where: {} });
      assert.isUndefined(activation.prefs?.envVars?.GRIST_BOOT_KEY);

      await driver.get(`${server.getHost()}/boot`);
      await waitForBootPage();
      await driver.find(".test-boot-page-boot-key-input").sendKeys(bootKey);
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.match(
          await driver.find(".test-boot-page-boot-key-error").getText(),
          /Invalid boot key/,
        ),
      );
    });
  });

  describe("login with GRIST_BOOT_KEY set", function() {
    before(async function() {
      await server.removeLogin();

      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
      process.env.GRIST_ADMIN_EMAIL = "john@example.com";
      process.env.GRIST_BOOT_KEY = "abc123";

      delete process.env.DOC_ID_NEW_USER_INFO;
      delete process.env.GRIST_IN_SERVICE;

      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("accepts boot key", async function() {
      await driver.get(`${server.getHost()}/boot`);
      await waitForBootPage();
      await driver.find(".test-boot-page-boot-key-input").doClear().sendKeys("abc123");
      await driver.find(".test-boot-page-check-key").click();
      await gu.waitForServer();
      await gu.waitToPass(async () =>
        assert.match(
          await driver.find(".test-boot-page-boot-key-verified").getText(),
          /Valid boot key/,
        ),
      );
    });

    it("redirects to /admin after confirming admin email", async function() {
      assert.equal(
        await driver.find(".test-boot-page-email-input").getAttribute("value"),
        "john@example.com",
      );
      await driver.find(".test-boot-page-continue").click();
      await gu.waitForServer();
      await gu.waitForAdminPanel();
      const { name, email } = await gu.getUser();
      assert.deepEqual({ name, email }, { name: "john", email: "john@example.com" });
    });

    it("restores service after login", async function() {
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();
    });

    it("reports server is out of service in Admin Panel", async function() {
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "out of service",
      );
      await toggleItem("service-status");
      assert.isFalse(await driver.find(".test-service-status-env-variable-notice").isPresent());
    });

    it("reports boot key is enabled in Admin Panel", async function() {
      assert.equal(
        await driver.find(".test-admin-panel-item-value-boot-key").getText(),
        "enabled",
      );
      await toggleItem("boot-key");
      assert.isFalse(await driver.find(".test-boot-key-status-remove-boot-key").isPresent());
      assert.match(
        await driver.find(".test-boot-key-status-env-variable-notice").getText(),
        /This setting is currently being managed by an environment variable \(GRIST_BOOT_KEY\)/,
      );
    });
  });

  describe("with GRIST_IN_SERVICE set to true", function() {
    before(async function() {
      await server.removeLogin();

      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
      process.env.GRIST_IN_SERVICE = "true";
      process.env.GRIST_BOOT_KEY = "abc123";

      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("bypasses setup gate", async function() {
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();

      await driver.get(`${server.getHost()}/somewhere`);
      assert.match(await driver.findWait(".test-error-header", 2000).getText(), /Page not found/);
    });

    it("reports server is in service in Admin Panel", async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=abc123`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "in service",
      );
      await toggleItem("service-status");
      assert.match(
        await driver.find(".test-service-status-env-variable-notice").getText(),
        /This setting is currently being managed by an environment variable \(GRIST_IN_SERVICE\)/,
      );
      assert.isFalse(await driver.find(".test-service-status-enter-maintenance-mode").isPresent());
    });

    it("restores setup gate on removal of env variable", async function() {
      delete process.env.GRIST_IN_SERVICE;
      await server.restart();

      await driver.get(`${server.getHost()}/admin?boot-key=abc123`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "out of service",
      );
      await toggleItem("service-status");
      assert.isTrue(await driver.find(".test-service-status-restore-service").isDisplayed());
      assert.isFalse(await driver.find(".test-service-status-env-variable-notice").isPresent());
      await driver.get(`${server.getHost()}/`);
      await waitForBootPage();
    });
  });

  describe("with GRIST_IN_SERVICE set to false", function() {
    before(async function() {
      await server.removeLogin();

      oldEnv = new testUtils.EnvironmentSnapshot();

      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
      process.env.GRIST_IN_SERVICE = "false";
      process.env.GRIST_BOOT_KEY = "abc123";

      await setActivationNoVars();

      await server.restart();
    });

    after(async function() {
      oldEnv.restore();

      await server.restart();
    });

    it("enforces setup gate", async function() {
      for (const path of ["/", "/p/trash", "/account", "/login", "/somewhere"]) {
        await driver.get(server.getHost() + path);
        await waitForBootPage();
      }

      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
      assert.equal(await driver.find(".test-admin-panel").isDisplayed(), true);
      assert.match(await driver.find(".test-admin-panel").getText(), /Administrator Panel Unavailable/);
    });

    it("reports server is out of service in Admin Panel", async function() {
      await driver.get(`${server.getHost()}/admin?boot-key=abc123`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "out of service",
      );
      await toggleItem("service-status");
      assert.match(
        await driver.find(".test-service-status-env-variable-notice").getText(),
        /This setting is currently being managed by an environment variable \(GRIST_IN_SERVICE\)/,
      );
      assert.isFalse(await driver.find(".test-service-status-restore-service").isPresent());
    });

    it("removes setup gate on removal of env variable", async function() {
      delete process.env.GRIST_IN_SERVICE;
      await server.restart();

      await driver.get(`${server.getHost()}/admin?boot-key=abc123`);
      await gu.waitForAdminPanel();
      assert.equal(
        await driver.find(".test-admin-panel-item-value-service-status").getText(),
        "in service",
      );
      await toggleItem("service-status");
      assert.isTrue(await driver.find(".test-service-status-enter-maintenance-mode").isDisplayed());
      assert.isFalse(await driver.find(".test-service-status-env-variable-notice").isPresent());
      await driver.get(`${server.getHost()}/`);
      await gu.waitForDocMenuToLoad();
    });
  });
});
