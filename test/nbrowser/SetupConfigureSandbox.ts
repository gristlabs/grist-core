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
    // the new SetupWizard (3-step: Sandboxing, Backups, Apply & Restart).
    // The wizard uses session auth — probes auto-start on load.

    // Navigate directly to /admin/setup (the wizard URL) to avoid
    // re-triggering the gate redirect to boot-key login on each test.
    const wizardUrl = () => `${server.getHost()}/admin/setup`;

    it("wizard shows title and sandbox options on load", async function() {
      await driver.get(wizardUrl());
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Step 1 (Sandboxing) is active by default.
      // Wait for sandbox probe to complete and submit button to appear.
      await driver.findWait(".test-sandbox-submit", 30000);
      // "unsandboxed" should always be present as a fallback.
      await driver.findWait(".test-sandbox-option-unsandboxed", 5000);
    });

    it("step 2 shows authentication providers", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 2 to see authentication options.
      await driver.find(".test-setup-tab-2").click();
      await driver.findWait(".test-setup-step-auth", 5000);
      // Should show either a provider list or a skip button.
      await driver.findWait(".test-auth-skip", 10000);
    });

    it("step 3 shows storage backend cards", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 3 to see storage options.
      await driver.find(".test-setup-tab-3").click();
      // Wait for storage detection to complete — should show backend cards.
      await driver.findWait(".test-storage-option-minio", 15000);
      await driver.findWait(".test-storage-option-s3", 5000);
      await driver.findWait(".test-storage-option-azure", 5000);
      await driver.findWait(".test-storage-option-none", 5000);
    });

    it("step 3 minio is selectable; s3/azure are greyed out", async function() {
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 3 to see storage options.
      await driver.find(".test-setup-tab-3").click();
      await driver.findWait(".test-storage-option-minio", 15000);
      // MinIO should be selectable (not disabled), s3/azure should be greyed out.
      const minioCard = await driver.find(".test-storage-option-minio");
      assert.notInclude(await minioCard.getAttribute("class"), "-disabled");
      const s3Card = await driver.find(".test-storage-option-s3");
      assert.include(await s3Card.getAttribute("class"), "-disabled");
      const azureCard = await driver.find(".test-storage-option-azure");
      assert.include(await azureCard.getAttribute("class"), "-disabled");
    });

    it("step 4 shows apply & restart panel", async function() {
      // Append no-mockup to hide the mockup controls panel that can overlap tabs.
      await driver.get(wizardUrl() + "?no-mockup");
      await driver.findContentWait("div", /Quick Setup/, 5000);
      // Click tab 4 to see Apply & Restart step.
      await driver.find(".test-setup-tab-4").click();
      await driver.findWait(".test-setup-step-go-live", 5000);
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
