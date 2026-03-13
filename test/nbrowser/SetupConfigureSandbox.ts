import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

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

      // Log in via boot key to establish a session.
      // Navigating to / redirects to /auth/boot-key?next=...
      await driver.get(`${server.getHost()}/`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      // Phase 1: Check the key.
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: Email field appears after key verification.
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Click "Continue" to complete login.
      await driver.find(".test-boot-key-login-submit").click();
      // After login, redirects to /admin/setup (the wizard).
      await driver.findContentWait("div", /Quick Setup/, 15000);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    // --- Probe API tests ---

    it("sandbox-availability probe returns results with valid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-availability`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.isArray(body.details?.flavors);
      assert.isTrue(body.details.flavors.length > 0);
      // Each flavor should have name and available fields.
      for (const f of body.details.flavors) {
        assert.isString(f.name);
        assert.isBoolean(f.available);
      }
    });

    it("sandbox-availability probe rejects missing boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-availability`);
      // Without auth, probes return 401 or 403.
      assert.include([401, 403], resp.status);
    });

    it("sandbox-availability probe rejects wrong boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-availability`, {
        headers: { "X-Boot-Key": "wrong-boot-key-value" },
      });
      assert.include([401, 403], resp.status);
    });

    // --- Configure sandbox API tests ---

    it("rejects missing auth", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.include([401, 403], resp.status);
    });

    it("rejects wrong boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": "wrong-key",
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.include([401, 403], resp.status);
    });

    it("rejects unknown sandbox flavor", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unknown-flavor" }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /Unknown sandbox flavor/);
    });

    it("rejects missing flavor", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({}),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /Missing GRIST_SANDBOX_FLAVOR/);
    });

    it("accepts a valid sandbox flavor with correct boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/admin/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unsandboxed" }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
      assert.equal(body.flavor, "unsandboxed");
    });

    // --- External storage probe API tests ---

    it("external-storage probe returns not-configured with valid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/external-storage`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.deepEqual(body.details, { configured: false });
      assert.equal(body.status, "none");
    });

    it("external-storage probe rejects missing boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/probes/external-storage`);
      assert.include([401, 403], resp.status);
    });

    it("all probes listing requires admin auth", async function() {
      // Without boot key, the probes listing should be rejected.
      const resp = await fetch(`${server.getHost()}/api/probes`);
      assert.include([401, 403], resp.status);
    });

    // --- Browser tests ---
    // The setup gate redirects to /admin?adminPanel=setup which renders
    // the SetupWizard (Server, Sandboxing, Authentication, Backups, Apply & Restart).
    // The wizard uses session auth — probes auto-start on load.

    // Navigate directly to /admin/setup (the wizard URL) to avoid
    // re-triggering the gate redirect to boot-key login on each test.
    const wizardUrl = () => `${server.getHost()}/admin/setup`;

    it("wizard starts on server step with URL configurator", async function() {
      await driver.get(wizardUrl());
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Server step is first — should show the URL section.
      await driver.findWait(".test-server-configurator", 10000);
      await driver.findWait(".test-server-url-section", 5000);
    });

    it("sandbox step shows options after navigating to it", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Navigate to sandbox tab.
      await driver.find(".test-setup-tab-sandbox").click();
      // Wait for sandbox probe to complete and submit button to appear.
      await driver.findWait(".test-sandbox-submit", 30000);
      // "unsandboxed" is available via the "Other options" toggle.
      await driver.findWait(".test-sandbox-show-alternatives", 5000);
      await driver.find(".test-sandbox-show-alternatives").click();
      await driver.findWait(".test-sandbox-option-unsandboxed", 5000);
    });

    it("auth step shows authentication providers", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 2 to see authentication options.
      await driver.find(".test-setup-tab-auth").click();
      await driver.findWait(".test-setup-step-auth", 5000);
      // Should show the auth configurator with hero card and submit button.
      await driver.findWait(".test-auth-configurator", 10000);
      await driver.findWait(".test-auth-submit", 5000);
    });

    it("storage step shows backend cards", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 3 to see storage options.
      await driver.find(".test-setup-tab-storage").click();
      // Wait for storage detection to complete — should show backend cards.
      await driver.findWait(".test-storage-option-minio", 15000);
      await driver.findWait(".test-storage-option-s3", 5000);
      await driver.findWait(".test-storage-option-azure", 5000);
      await driver.findWait(".test-storage-option-none", 5000);
    });

    it("storage step: minio is selectable; s3/azure are greyed out", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 3 to see storage options.
      await driver.find(".test-setup-tab-storage").click();
      await driver.findWait(".test-storage-option-minio", 15000);
      // MinIO should be selectable (not disabled), s3/azure should be greyed out.
      const minioCard = await driver.find(".test-storage-option-minio");
      assert.notInclude(await minioCard.getAttribute("class"), "-disabled");
      const s3Card = await driver.find(".test-storage-option-s3");
      assert.include(await s3Card.getAttribute("class"), "-disabled");
      const azureCard = await driver.find(".test-storage-option-azure");
      assert.include(await azureCard.getAttribute("class"), "-disabled");
    });

    it("apply step shows apply & restart panel", async function() {
      // Append no-mockup to hide the mockup controls panel that can overlap tabs.
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 4 to see Apply & Restart step.
      await driver.find(".test-setup-tab-apply").click();
      await driver.findWait(".test-setup-step-apply", 5000);
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
      assert.include([401, 403], resp.status);
    });

    it("accepts valid boot key and brings server into service", async function() {
      // Go live.
      const resp = await fetch(`${server.getHost()}/api/admin/go-live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
    });
  });

  // Verify that entering a non-default admin email during boot-key login
  // does not break subsequent wizard screens (sandbox probes, etc.).
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

    it("login with custom email allows wizard probes to succeed", async function() {
      // Navigate to root — gate redirects to boot-key login.
      await driver.get(`${server.getHost()}/`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      // Phase 1: Check the key.
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: Email field appears (empty since GRIST_ADMIN_EMAIL is unset).
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Enter a custom email that differs from any default.
      await driver.find(".test-boot-key-login-email").sendKeys("newadmin@mycompany.com");
      // Complete login.
      await driver.find(".test-boot-key-login-submit").click();
      // Should reach the wizard.
      await driver.findContentWait("div", /Quick Setup/, 15000);
    });

    it("sandbox probe succeeds with the custom admin email session", async function() {
      // The boot-key login set GRIST_ADMIN_EMAIL=newadmin@mycompany.com and
      // cleared the InstallAdmin cache. Verify API probes work with both
      // session auth and boot-key auth.
      const resp = await fetch(`${server.getHost()}/api/probes/sandbox-availability`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.isArray(body.details?.flavors);
      assert.isTrue(body.details.flavors.length > 0);
    });

    it("wizard sandbox step renders without errors", async function() {
      const wizardUrl = `${server.getHost()}/admin/setup?no-mockup`;
      await driver.get(wizardUrl);
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Wait for sandbox probe to complete and submit button to appear.
      await driver.findWait(".test-sandbox-submit", 30000);
      // A sandbox option should be visible (hero card).
      await driver.findWait(".test-sandbox-configurator", 5000);
    });

    it("wizard auth step renders without access denied", async function() {
      const wizardUrl = `${server.getHost()}/admin/setup?no-mockup`;
      await driver.get(wizardUrl);
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 2 to see authentication options.
      await driver.find(".test-setup-tab-auth").click();
      await driver.findWait(".test-setup-step-auth", 5000);
      // Should show auth configurator with hero card — NOT an access denied error.
      await driver.findWait(".test-auth-configurator", 10000);
      // The submit button should appear (may be disabled until auth acknowledged).
      await driver.findWait(".test-auth-submit", 5000);
      // Verify no error text about access denied.
      const pageText = await driver.find(".test-setup-step-auth").getText();
      assert.notMatch(pageText, /access denied/i);
      assert.notMatch(pageText, /403/);
    });

    it("auth providers API returns 200 with boot-key auth", async function() {
      const resp = await fetch(`${server.getHost()}/api/config/auth-providers`, {
        headers: { "X-Boot-Key": bootKey },
      });
      assert.equal(resp.status, 200, `Expected 200 but got ${resp.status}: ${await resp.clone().text()}`);
      const body = await resp.json();
      assert.isArray(body);
    });

    it("auth providers API returns 200 with browser session auth", async function() {
      // This is the critical test: the browser uses session cookies (not X-Boot-Key header)
      // to call /api/config/auth-providers. This is what the wizard's AuthenticationSection
      // actually does. If the session doesn't match the admin email, this returns 403.
      const wizardUrl = `${server.getHost()}/admin/setup?no-mockup`;
      await driver.get(wizardUrl);
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Use the browser's native fetch (with session cookies) to call the API.
      // Must use a string script to avoid capturing the node-fetch import.
      const result = await driver.executeScript<{ status: number; body: string }>(
        `return window.fetch("/api/config/auth-providers", {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(resp) {
          return resp.text().then(function(body) {
            return { status: resp.status, body: body };
          });
        });`,
      );
      assert.equal(result.status, 200,
        `Expected 200 but got ${result.status}: ${result.body}`);
      const body = JSON.parse(result.body);
      assert.isArray(body);
    });
  });

  // Test that GRIST_DEFAULT_EMAIL doesn't interfere with custom admin email.
  // If GRIST_DEFAULT_EMAIL is set to one email but the user logs in with a different
  // email via boot-key, the admin check should use the new email, not the default.
  describe("custom admin email with GRIST_DEFAULT_EMAIL set", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_ADMIN_EMAIL;
      // Set GRIST_DEFAULT_EMAIL to a DIFFERENT email than what we'll enter.
      process.env.GRIST_DEFAULT_EMAIL = "default@example.com";
      bootKey = "test-boot-key-default-email";
      process.env.GRIST_BOOT_KEY = bootKey;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("login with different email than GRIST_DEFAULT_EMAIL works", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Enter an email different from GRIST_DEFAULT_EMAIL.
      await driver.find(".test-boot-key-login-email").sendKeys("realadmin@myorg.com");
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findContentWait("div", /Quick Setup/, 15000);
    });

    it("auth providers API works via browser session despite GRIST_DEFAULT_EMAIL", async function() {
      const wizardUrl = `${server.getHost()}/admin/setup?no-mockup`;
      await driver.get(wizardUrl);
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Use browser's native fetch with session cookies (same as the wizard does).
      const result = await driver.executeScript<{ status: number; body: string }>(
        `return window.fetch("/api/config/auth-providers", {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(resp) {
          return resp.text().then(function(body) {
            return { status: resp.status, body: body };
          });
        });`,
      );
      assert.equal(result.status, 200,
        `Expected 200 but got ${result.status}: ${result.body}`);
    });

    it("install prefs API works via browser session despite GRIST_DEFAULT_EMAIL", async function() {
      // The AuthenticationSection also calls getInstallPrefs which requires admin auth.
      const result = await driver.executeScript<{ status: number; body: string }>(
        `return window.fetch("/api/install/prefs", {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(resp) {
          return resp.text().then(function(body) {
            return { status: resp.status, body: body };
          });
        });`,
      );
      assert.equal(result.status, 200,
        `Expected 200 but got ${result.status}: ${result.body}`);
    });
  });

  // Regression test: if GRIST_ADMIN_EMAIL is already set (from a previous run)
  // and the user enters a DIFFERENT email during boot-key login, the server
  // must update the admin email. Otherwise the session email won't match and
  // all admin API calls return 403.
  describe("changing admin email when GRIST_ADMIN_EMAIL already set", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      // Simulate a previous run that already set GRIST_ADMIN_EMAIL.
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
      await driver.get(`${server.getHost()}/`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys(bootKey);
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findWait(".test-boot-key-login-email", 10000);
      // The email field should be pre-filled with old-admin@example.com.
      // Clear it and enter a different email.
      await driver.find(".test-boot-key-login-email").clear();
      await driver.find(".test-boot-key-login-email").sendKeys("new-admin@example.com");
      await driver.find(".test-boot-key-login-submit").click();
      await driver.findContentWait("div", /Quick Setup/, 15000);
    });

    it("probes API works via browser session with changed email", async function() {
      const wizardUrl = `${server.getHost()}/admin/setup?no-mockup`;
      await driver.get(wizardUrl);
      await driver.findContentWait("div", /Quick Setup/, 5000);
      const result = await driver.executeScript<{ status: number; body: string }>(
        `return window.fetch("/api/probes", {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(resp) {
          return resp.text().then(function(body) {
            return { status: resp.status, body: body };
          });
        });`,
      );
      assert.equal(result.status, 200,
        `Expected 200 but got ${result.status}: ${result.body}`);
    });

    it("auth providers API works via browser session with changed email", async function() {
      const result = await driver.executeScript<{ status: number; body: string }>(
        `return window.fetch("/api/config/auth-providers", {
          headers: { "X-Requested-With": "XMLHttpRequest" }
        }).then(function(resp) {
          return resp.text().then(function(body) {
            return { status: resp.status, body: body };
          });
        });`,
      );
      assert.equal(result.status, 200,
        `Expected 200 but got ${result.status}: ${result.body}`);
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
      // Enable maintenance mode.
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: true }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.maintenance, true);
    });

    it("disables maintenance mode (brings Grist back into service)", async function() {
      // Disable maintenance mode.
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: false }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.maintenance, false);
    });
  });
});
