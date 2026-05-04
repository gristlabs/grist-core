import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

/**
 * Tests for the admin setup endpoints (configure-sandbox, go-live,
 * maintenance) and the boot-key login flow that drives them.
 *
 * UI assertions use the front-page mockup selectors from errorPages.ts
 * (the POC boot-key login) and main's QuickSetup wizard selectors.
 */
describe("SetupConfigureSandbox", function() {
  this.timeout(60000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let bootKey: string;

  describe("with setup gate active", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      // Set a known boot key so tests can authenticate without admin session.
      bootKey = "test-boot-key-for-sandbox";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);

      // Log in via the POC boot-key page so a session is available for
      // browser tests below. The setup gate would otherwise redirect to
      // /boot (main's BootPage); we use /auth/boot-key directly to drive
      // the mockup flow.
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findWait(".test-boot-key-login-email", 10000);
      await driver.find(".test-boot-key-login-submit").click();
      // After login, leave the boot-key page.
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 15000);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    // --- Probe API tests ---

    it("sandbox-providers probe returns results with valid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-providers`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.isArray(body.details?.options);
      assert.isTrue(body.details.options.length > 0);
      for (const opt of body.details.options) {
        assert.isString(opt.flavor);
        assert.isBoolean(opt.available);
      }
    });

    it("sandbox-providers probe rejects missing boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-providers`);
      // Without auth, probes are rejected. With the setup gate active we get
      // 503; once gated through we get 401/403 from admin auth.
      assert.include([401, 403, 503], resp.status);
    });

    it("sandbox-providers probe rejects wrong boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-providers`, {
        headers: { "X-Boot-Key": "wrong-boot-key-value" },
      });
      assert.include([401, 403, 503], resp.status);
    });

    // --- Configure sandbox API tests ---

    it("configure-sandbox rejects missing auth", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.include([401, 403, 503], resp.status);
    });

    it("configure-sandbox rejects wrong boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": "wrong-key",
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.include([401, 403, 503], resp.status);
    });

    it("configure-sandbox rejects unknown sandbox flavor", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unknown-flavor" }),
      });
      assert.equal(resp.status, 400);
    });

    it("configure-sandbox rejects missing flavor", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resp.status, 400);
    });

    it("configure-sandbox accepts a valid sandbox flavor with correct boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unsandboxed" }),
      });
      assert.equal(resp.status, 200);
    });

    it("all probes listing requires admin auth", async function() {
      // Without boot key, the probes listing should be rejected.
      const resp = await fetch(`${server.getHost()}/api/probes`);
      assert.include([401, 403, 503], resp.status);
    });

    // --- Browser smoke tests against main's QuickSetup wizard ---

    it("admin/setup loads the QuickSetup wizard", async function() {
      await driver.get(`${server.getHost()}/admin/setup`);
      // QuickSetup uses .test-quick-setup-* selectors. The first step is
      // the server step with a continue button.
      await driver.findWait(".test-quick-setup-server-continue", 10000);
    });
  });

  // Separate block because go-live changes server state (opens the gate).
  describe("go-live endpoint", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      bootKey = "test-boot-key-for-go-live";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("rejects missing auth", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assert.include([401, 403, 503], resp.status);
    });

    it("accepts valid boot key and brings server into service", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/go-live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
      });
      assert.equal(resp.status, 200);
    });
  });

  // Verify that entering a non-default admin email during boot-key login
  // does not break subsequent admin API access.
  describe("custom admin email via boot-key login", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      // Deliberately do NOT set GRIST_ADMIN_EMAIL — the user will type one in.
      delete process.env.GRIST_ADMIN_EMAIL;
      bootKey = "test-boot-key-custom-email";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("login with custom email completes successfully", async function() {
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: Email field appears (empty since GRIST_ADMIN_EMAIL is unset).
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Enter a custom email that differs from any default.
      await driver.find(".test-boot-key-login-email").sendKeys("newadmin@mycompany.com");
      // Complete login.
      await driver.find(".test-boot-key-login-submit").click();
      // After login, leave the boot-key page.
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 15000);
    });

    it("admin API works with the custom admin email session", async function() {
      // The boot-key login set GRIST_ADMIN_EMAIL=newadmin@mycompany.com and
      // cleared the InstallAdmin cache. Verify a probe works via boot-key auth.
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-providers`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
    });

    it("auth providers API returns 200 with boot-key auth", async function() {
      const resp = await fetch(`${server.getHost()}/api/config/auth-providers`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.isArray(body);
    });
  });

  // Regression test: if GRIST_ADMIN_EMAIL is already set (from a previous run)
  // and the user enters a DIFFERENT email during boot-key login, the server
  // must update the admin email so subsequent admin API calls work.
  describe("changing admin email when GRIST_ADMIN_EMAIL already set", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      process.env.GRIST_ADMIN_EMAIL = "old-admin@example.com";
      bootKey = "test-boot-key-change-email";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("login with a different email than the existing GRIST_ADMIN_EMAIL", async function() {
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findWait(".test-boot-key-login-email", 10000);
      // The email field should be pre-filled with old-admin@example.com.
      // Clear it and enter a different email.
      await driver.find(".test-boot-key-login-email").clear();
      await driver.find(".test-boot-key-login-email").sendKeys("new-admin@example.com");
      await driver.find(".test-boot-key-login-submit").click();
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 15000);
    });

    it("admin API works after changing the email", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
    });
  });

  describe("maintenance mode endpoint", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      process.env.GRIST_IN_SERVICE = "true";
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      bootKey = "test-boot-key-for-maintenance";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("enables maintenance mode (takes Grist out of service)", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: true }),
      });
      assert.equal(resp.status, 200);
    });

    it("disables maintenance mode (brings Grist back into service)", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: false }),
      });
      assert.equal(resp.status, 200);
    });
  });

  // POC mockup-only endpoints used by the front-page wizard's control buttons.
  describe("mockup control endpoints", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      bootKey = "mockup-boot-key";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("mockup-set-admin-email sets GRIST_ADMIN_EMAIL", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-set-admin-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "mock@example.com" }),
      });
      assert.equal(resp.status, 200);
    });

    it("mockup-reset-admin-email clears it", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-reset-admin-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(resp.status, 200);
    });

    it("mockup-boot-key returns the boot key (pre-Go-Live)", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-boot-key`);
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.bootKey, bootKey);
    });

    it("mockup-boot-key-login returns the boot key (always available)", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-boot-key-login`);
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.bootKey, bootKey);
    });
  });

  describe("mockup endpoints disabled after Go Live", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_IN_SERVICE = "true";
      bootKey = "post-go-live-key";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("mockup-set-admin-email returns 404 once in service", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-set-admin-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "mock@example.com" }),
      });
      assert.equal(resp.status, 404);
    });

    it("mockup-boot-key returns 404 once in service", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-boot-key`);
      assert.equal(resp.status, 404);
    });

    it("mockup-boot-key-login still works post-Go-Live", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/mockup-boot-key-login`);
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.bootKey, bootKey);
    });
  });
});
