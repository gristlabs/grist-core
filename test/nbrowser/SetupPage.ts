import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

/**
 * Tests for the setup gate that blocks fresh Grist installations until
 * the operator provides a boot key and configures the server.
 *
 * On main, the gate redirects browser requests to /boot (the BootPage).
 * The front-page mockup additionally exposes /auth/boot-key as a POC
 * boot-key login page (rendered via errorPages.ts).
 */
describe("SetupPage", function() {
  this.timeout(60000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  describe("fresh install without auth", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_BOOT_KEY;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("redirects / to the boot page", async function() {
      const resp = await fetch(`${server.getHost()}/`, { redirect: "manual" });
      assert.equal(resp.status, 302);
      const location = resp.headers.get("location");
      assert.match(location!, /\/boot$/);
    });

    it("redirects arbitrary paths to the boot page", async function() {
      const resp = await fetch(`${server.getHost()}/some/path`, { redirect: "manual" });
      assert.equal(resp.status, 302);
      const location = resp.headers.get("location");
      assert.match(location!, /\/boot$/);
    });

    it("allows /status through the gate", async function() {
      const resp = await fetch(`${server.getHost()}/status`);
      assert.equal(resp.status, 200);
      const text = await resp.text();
      assert.match(text, /alive/);
    });

    it("allows /admin through the gate", async function() {
      const resp = await fetch(`${server.getHost()}/admin`);
      assert.equal(resp.status, 200);
    });

    it("allows /auth/boot-key (POC mockup login) through the gate", async function() {
      const resp = await fetch(`${server.getHost()}/auth/boot-key`);
      assert.equal(resp.status, 200);
    });

    it("returns 503 JSON for API requests", async function() {
      const resp = await fetch(`${server.getHost()}/api/orgs`, {
        headers: { accept: "application/json" },
      });
      assert.equal(resp.status, 503);
      const body = await resp.json();
      assert.match(body.error, /not yet configured/);
    });

    it("shows the boot page in the browser after redirect", async function() {
      await driver.get(`${server.getHost()}/`);
      // Gate redirects to /boot which renders the BootPage with its key input.
      await driver.findWait(".test-boot-page-boot-key-input", 10000);
    });
  });

  describe("boot key validation", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      process.env.GRIST_BOOT_KEY = "test-boot-key-123";
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("rejects invalid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/boot/verify-boot-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bootKey: "wrong-key" }),
      });
      assert.equal(resp.status, 401);
    });

    it("accepts valid boot key and returns admin email", async function() {
      const resp = await fetch(`${server.getHost()}/boot/verify-boot-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bootKey: "test-boot-key-123" }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.adminEmail, "admin@example.com");
    });

    it("boot-key login establishes session and reaches setup wizard", async function() {
      // Drive the POC boot-key login mockup directly.
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys("test-boot-key-123");
      // Phase 1: check the key.
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: email field appears, pre-filled from GRIST_ADMIN_EMAIL.
      await driver.findWait(".test-boot-key-login-email", 10000);
      const emailVal = await driver.find(".test-boot-key-login-email").getAttribute("value");
      assert.equal(emailVal, "admin@example.com");
      // Click "Continue" to complete login. After login, we leave the boot-key
      // page (either to /admin/setup or wherever the next-redirect points).
      await driver.find(".test-boot-key-login-submit").click();
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 15000);
    });
  });

  describe("GRIST_IN_SERVICE bypass", function() {
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

    it("does not show setup gate when GRIST_IN_SERVICE is set", async function() {
      // With GRIST_IN_SERVICE=true, the gate is not active.
      // The response should NOT be a redirect to /boot.
      const resp = await fetch(`${server.getHost()}/`, { redirect: "manual" });
      const location = resp.headers.get("location") || "";
      assert.notMatch(location, /\/boot$/);
    });
  });

  // Path 4: Broken auth — OIDC configured but fails to initialize.
  // Server should fall back to boot-key login as the active login system.
  describe("broken auth fallback", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      // Set OIDC with an invalid issuer so it throws during init.
      process.env.GRIST_OIDC_IDP_ISSUER = "invalid-url";
      process.env.GRIST_IN_SERVICE = "true";
      process.env.GRIST_BOOT_KEY = "test-fallback-key";
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("server starts despite broken auth", async function() {
      const resp = await fetch(`${server.getHost()}/status`);
      assert.equal(resp.status, 200);
    });

    it("boot-key login page is reachable as fallback", async function() {
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
    });

    it("admin can log in with boot key when auth is broken", async function() {
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys("test-fallback-key");
      // Phase 1: Check the key.
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: Email field appears after key verification.
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Click "Continue" to complete login.
      await driver.find(".test-boot-key-login-submit").click();
      // After boot-key login, should leave the boot-key page.
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 10000);
    });

    it("admin API is accessible via X-Boot-Key header", async function() {
      const resp = await fetch(
        `${server.getHost()}/api/probes`,
        { headers: { "X-Boot-Key": "test-fallback-key" } },
      );
      assert.equal(resp.status, 200);
    });
  });

  // Path 7: Boot key recovery — GRIST_BOOT_KEY env var overrides DB-stored key.
  describe("boot key env var override", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      // The server may have a DB-stored boot key from first-boot detection.
      // Setting GRIST_BOOT_KEY in the env should override it.
      process.env.GRIST_BOOT_KEY = "recovery-key-456";
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("env var boot key works for login", async function() {
      // Use the POC boot-key login page directly; the gate would otherwise
      // redirect us to /boot (main's BootPage), which is also a valid path.
      await driver.get(`${server.getHost()}/auth/boot-key`);
      await driver.findWait(".test-boot-key-login-input", 10000);
      await driver.find(".test-boot-key-login-input").sendKeys("recovery-key-456");
      // Phase 1: Check the key.
      await driver.find(".test-boot-key-login-submit").click();
      // Phase 2: Email field appears after key verification.
      await driver.findWait(".test-boot-key-login-email", 10000);
      // Click "Continue" to complete login.
      await driver.find(".test-boot-key-login-submit").click();
      // After login, leave the boot-key page.
      await driver.wait(async () => {
        const url = await driver.getCurrentUrl();
        return !url.includes("/auth/boot-key");
      }, 15000);
    });

    it("env var boot key works for API auth", async function() {
      const resp = await fetch(
        `${server.getHost()}/api/probes`,
        { headers: { "X-Boot-Key": "recovery-key-456" } },
      );
      assert.equal(resp.status, 200);
    });

    it("wrong boot key is rejected", async function() {
      const resp = await fetch(
        `${server.getHost()}/api/probes`,
        { headers: { "X-Boot-Key": "wrong-key" } },
      );
      assert.notEqual(resp.status, 200);
    });
  });

  // Path 5: GRIST_IN_SERVICE takes precedence over GRIST_FORCE_SETUP_GATE.
  describe("in-service overrides setup gate", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      process.env.GRIST_IN_SERVICE = "true";
      process.env.GRIST_BOOT_KEY = "maint-key";
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("does not activate gate when GRIST_IN_SERVICE is true", async function() {
      // The gate would return 503 for API requests with "not yet configured".
      // When in service, the API should return a non-503 status.
      const resp = await fetch(`${server.getHost()}/api/orgs`, {
        headers: { accept: "application/json" },
      });
      assert.notEqual(resp.status, 503);
    });

    it("boot key still works for API auth when in service", async function() {
      const resp = await fetch(
        `${server.getHost()}/api/probes`,
        { headers: { "X-Boot-Key": "maint-key" } },
      );
      assert.equal(resp.status, 200);
    });
  });
});
