import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

describe("SetupConfigureSandbox", function() {
  this.timeout(60000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let bootKey: string;

  describe("when server is in service", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      process.env.GRIST_IN_SERVICE = "true";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("returns 404 when server is already in service", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": "anything",
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.equal(resp.status, 404);
    });
  });

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

    it("rejects missing boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.equal(resp.status, 401);
      const body = await resp.json();
      assert.match(body.error, /Boot key required/);
    });

    it("rejects wrong boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": "wrong-key",
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "gvisor" }),
      });
      assert.equal(resp.status, 401);
    });

    it("rejects unknown sandbox flavor", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
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
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
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
      const resp = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
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

    // --- Auth leakage tests ---

    it("configure-auth error responses do not include bootKey", async function() {
      // Missing secret → should NOT leak boot key.
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.isTrue(resp.status >= 400);
      const body = await resp.json();
      assert.notProperty(body, "bootKey");
    });

    it("configure-auth with wrong email does not include bootKey", async function() {
      // Build a key with wrong email.
      const wrongPayload = {
        oidcClientId: "test-client-id",
        oidcClientSecret: "test-client-secret",
        oidcIssuer: "https://login.getgrist.com",
        owner: { name: "Attacker", email: "attacker@evil.com" },
      };
      const wrongKey = Buffer.from(JSON.stringify(wrongPayload)).toString("base64");
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: wrongKey }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.notProperty(body, "bootKey");
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

    it("step 2 shows idle state before step 1 completion", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Click tab 2 to reveal step 2 content.
      await driver.find(".test-setup-tab-2").click();
      // Step 2 should show the "complete step 1" message.
      await driver.findContentWait("div", /Complete step 1/, 5000);
    });

    it("step 2 shows loading then sandbox options after boot key submit", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Switch to boot key mode.
      await driver.find(".test-setup-toggle-bootkey").click();
      // Enter the boot key.
      const input = await driver.find(".test-setup-boot-key-input");
      await input.sendKeys(bootKey);
      await driver.find(".test-setup-boot-key-submit").click();
      // Should see loading or loaded state.
      // Wait for sandbox options to appear (probe runs).
      await driver.findWait(".test-setup-sandbox-submit", 30000);
    });

    it("step 3 shows idle state before step 1 completion", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Click tab 3 to reveal step 3 content.
      await driver.find(".test-setup-tab-3").click();
      // Step 3 should show the "complete step 1" hint.
      await driver.findContentWait("div", /Complete step 1 to verify you are the installer/, 5000);
    });

    it("step 3 shows storage backend cards after boot key submit", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Switch to boot key mode and submit.
      await driver.find(".test-setup-toggle-bootkey").click();
      const input = await driver.find(".test-setup-boot-key-input");
      await input.sendKeys(bootKey);
      await driver.find(".test-setup-boot-key-submit").click();
      // Auto-advance goes to step 2; click tab 3 to see storage options.
      await driver.findWait(".test-setup-tab-3", 5000);
      await driver.find(".test-setup-tab-3").click();
      // Wait for storage detection to complete — should show backend cards.
      await driver.findWait(".test-setup-storage-not-configured", 15000);
      // All four options should be present: minio, s3, azure, none.
      await driver.findWait(".test-setup-storage-option-minio", 5000);
      await driver.findWait(".test-setup-storage-option-s3", 5000);
      await driver.findWait(".test-setup-storage-option-azure", 5000);
      await driver.findWait(".test-setup-storage-option-none", 5000);
    });

    it("step 3 minio is selectable and shows instructions; s3/azure are greyed out",
      async function() {
        await driver.get(`${server.getHost()}/`);
        await driver.findContentWait("div", /Set up your Grist/, 5000);
        await driver.find(".test-setup-toggle-bootkey").click();
        const input = await driver.find(".test-setup-boot-key-input");
        await input.sendKeys(bootKey);
        await driver.find(".test-setup-boot-key-submit").click();
        // Auto-advance goes to step 2; click tab 3 to see storage options.
        await driver.findWait(".test-setup-tab-3", 5000);
        await driver.find(".test-setup-tab-3").click();
        await driver.findWait(".test-setup-storage-not-configured", 15000);
        // MinIO should be selectable (not disabled), s3/azure should be greyed out.
        const minioCard = await driver.find(".test-setup-storage-option-minio");
        assert.notInclude(await minioCard.getAttribute("class"), "-disabled");
        const s3Card = await driver.find(".test-setup-storage-option-s3");
        assert.include(await s3Card.getAttribute("class"), "-disabled");
        const azureCard = await driver.find(".test-setup-storage-option-azure");
        assert.include(await azureCard.getAttribute("class"), "-disabled");
        // Select minio — should show setup instructions.
        await minioCard.click();
        await driver.findWait(".test-setup-storage-instructions", 5000);
        await driver.findContentWait("div", /GRIST_DOCS_MINIO_BUCKET/, 5000);
      });

    it("step 2 shows admin panel link after boot key submit", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Switch to boot key mode and submit.
      await driver.find(".test-setup-toggle-bootkey").click();
      const input = await driver.find(".test-setup-boot-key-input");
      await input.sendKeys(bootKey);
      await driver.find(".test-setup-boot-key-submit").click();
      // Wait for sandbox options to load.
      await driver.findWait(".test-setup-sandbox-submit", 30000);
      // Admin panel link should be present and point to /boot/{key}/.
      const link = await driver.findContentWait("a", /Open full admin panel/, 5000);
      const href = await link.getAttribute("href");
      assert.include(href, `/boot/${bootKey}/`);
      assert.equal(await link.getAttribute("target"), "_blank");
    });

    // --- Step 4: Go Live browser tests ---

    it("step 4 shows 'Complete step 1' message initially", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Click tab 4 to reveal step 4 content.
      await driver.find(".test-setup-tab-4").click();
      await driver.findContentWait("div", /Complete step 1 to verify you are the installer/, 5000);
    });

    it("step 4 shows 'Complete steps 2 and 3' after boot key but before sandbox/storage",
      async function() {
        await driver.get(`${server.getHost()}/`);
        await driver.findContentWait("div", /Set up your Grist/, 5000);
        await driver.find(".test-setup-toggle-bootkey").click();
        const input = await driver.find(".test-setup-boot-key-input");
        await input.sendKeys(bootKey);
        await driver.find(".test-setup-boot-key-submit").click();
        // Wait for sandbox options to appear (step 1 done, auto-advanced to step 2).
        await driver.findWait(".test-setup-sandbox-submit", 30000);
        // Click tab 4 to see step 4 content.
        await driver.find(".test-setup-tab-4").click();
        // Step 4 should still be blocked (steps 2/3 not completed).
        await driver.findWait(".test-setup-go-live-blocked", 5000);
      });

    it("step 4 shows Go Live button after sandbox configured and storage selected",
      async function() {
        await driver.get(`${server.getHost()}/`);
        await driver.findContentWait("div", /Set up your Grist/, 5000);
        await driver.find(".test-setup-toggle-bootkey").click();
        const input = await driver.find(".test-setup-boot-key-input");
        await input.sendKeys(bootKey);
        await driver.find(".test-setup-boot-key-submit").click();
        // Wait for sandbox probe to finish and "unsandboxed" option to appear (auto-advanced to step 2).
        const unsandboxed = await driver.findWait(".test-setup-sandbox-option-unsandboxed", 30000);
        await unsandboxed.click();
        await driver.find(".test-setup-sandbox-submit").click();
        await driver.findWait(".test-setup-sandbox-success", 15000);
        // Auto-advanced to step 3; select "none" for storage.
        await driver.find(".test-setup-tab-3").click();
        const noneCard = await driver.findWait(".test-setup-storage-option-none", 15000);
        await noneCard.click();
        // Click tab 4 to see Go Live button.
        await driver.find(".test-setup-tab-4").click();
        // Now Go Live button should appear.
        await driver.findWait(".test-setup-go-live-submit", 5000);
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

    it("rejects missing boot key", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(resp.status, 401);
    });

    it("accepts valid boot key and brings server into service", async function() {
      // Verify setup gate is active: configure-sandbox should be reachable (not 404).
      const gateBefore = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unsandboxed" }),
      });
      assert.equal(gateBefore.status, 200, "setup endpoint should be available before go-live");

      // Go live.
      const resp = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
      assert.include(body.adminUrl, "/admin");

      // Setup gate should now be gone: setup endpoints return 404.
      const gateAfter = await fetch(`${server.getHost()}/api/setup/configure-sandbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: "unsandboxed" }),
      });
      assert.equal(gateAfter.status, 404, "setup endpoint should return 404 after go-live");
    });

    it("returns 404 after server is already in service", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": bootKey,
        },
      });
      assert.equal(resp.status, 404);
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
      // Server should be in service — setup endpoints return 404.
      const before = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
      });
      assert.equal(before.status, 404, "go-live should return 404 when in service");

      // Enable maintenance mode.
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: true }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.maintenance, true);

      // Setup gate should now be active — setup endpoints should work.
      const after = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
      });
      assert.equal(after.status, 200, "go-live should succeed after entering maintenance mode");
    });

    it("disables maintenance mode (brings Grist back into service)", async function() {
      // After the previous test, server is back in service via go-live.
      // Take it out again to test the disable path.
      await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: true }),
      });

      // Disable maintenance mode.
      const resp = await fetch(`${server.getHost()}/api/admin/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
        body: JSON.stringify({ maintenance: false }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.maintenance, false);

      // Setup endpoints should now return 404 (server is in service).
      const after = await fetch(`${server.getHost()}/api/setup/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Boot-Key": bootKey },
      });
      assert.equal(after.status, 404, "go-live should return 404 after disabling maintenance");
    });
  });
});
