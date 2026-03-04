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

    it("all probes listing requires admin auth", async function() {
      // Without boot key, the probes listing should be rejected.
      const resp = await fetch(`${server.getHost()}/api/probes`);
      assert.include([401, 403], resp.status);
    });

    // --- Browser tests ---

    it("step 2 shows idle state before step 1 completion", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
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
  });
});
