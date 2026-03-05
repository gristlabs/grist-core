import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

/**
 * Tests for the setup gate that blocks fresh Grist installations until
 * the operator configures authentication or provides a boot key.
 */
describe("SetupPage", function() {
  this.timeout(60000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  describe("fresh install without auth", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      // Force the setup gate on (normally bypassed in test env due to GRIST_TESTING_SOCKET).
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_BOOT_KEY;
      await server.restart(true);
      // Clear any persisted wizard state from previous tests.
      await driver.get(`${server.getHost()}/`);
      await driver.executeScript(
        "try { sessionStorage.removeItem('grist-setup-state'); } catch(e) {}",
      );
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    // Clear persisted wizard state between tests so each starts fresh.
    afterEach(async function() {
      try {
        await driver.executeScript(
          "try { sessionStorage.removeItem('grist-setup-state'); } catch(e) {}",
        );
      } catch {
        // May fail if no page was loaded (API-only tests).
      }
    });

    it("serves error.html with setup config at /", async function() {
      const resp = await fetch(`${server.getHost()}/`);
      const text = await resp.text();
      assert.match(text, /errPage.*setup/);
    });

    it("serves error.html with setup config for arbitrary paths", async function() {
      const resp = await fetch(`${server.getHost()}/some/path`);
      const text = await resp.text();
      assert.match(text, /errPage.*setup/);
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

    it("serves static assets through the gate via /v/ prefix", async function() {
      const resp = await fetch(`${server.getHost()}/v/unknown/errorPages.bundle.js`);
      assert.equal(resp.status, 200);
      const contentType = resp.headers.get("content-type");
      assert.match(contentType!, /javascript/);
    });

    it("returns 503 JSON for API requests", async function() {
      const resp = await fetch(`${server.getHost()}/api/orgs`, {
        headers: { accept: "application/json" },
      });
      assert.equal(resp.status, 503);
      const body = await resp.json();
      assert.match(body.error, /not yet configured/);
    });

    it("renders the setup page in the browser", async function() {
      await driver.get(`${server.getHost()}/`);
      // Wait for the setup page header to appear.
      await driver.findContentWait("div", /Set up your Grist/, 5000);
    });

    it("shows the three setup steps", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Check for the three setup steps.
      assert.include(await driver.getPageSource(), "Register on getgrist.com");
      assert.include(await driver.getPageSource(), "Sandboxing");
      assert.include(await driver.getPageSource(), "Backups");
    });

    it("shows the boot key input field after toggling", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Boot key input is hidden by default; click toggle to show it.
      await driver.find(".test-setup-toggle-bootkey").click();
      const input = await driver.find(".test-setup-boot-key-input");
      assert.isTrue(await input.isDisplayed());
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
      // Clear any persisted wizard state from previous tests.
      await driver.get(`${server.getHost()}/`);
      await driver.executeScript(
        "try { sessionStorage.removeItem('grist-setup-state'); } catch(e) {}",
      );
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    // Clear persisted wizard state between tests so each starts fresh.
    afterEach(async function() {
      try {
        await driver.executeScript(
          "try { sessionStorage.removeItem('grist-setup-state'); } catch(e) {}",
        );
      } catch {
        // May fail if no page was loaded (API-only tests).
      }
    });

    it("rejects invalid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/boot/wrong-key`, { redirect: "manual" });
      assert.equal(resp.status, 403);
    });

    it("redirects to admin with valid boot key", async function() {
      const resp = await fetch(`${server.getHost()}/boot/test-boot-key-123`, { redirect: "manual" });
      assert.equal(resp.status, 302);
      const location = resp.headers.get("location");
      assert.match(location!, /\/admin\?boot-key=test-boot-key-123/);
    });

    it("advances to step 2 when boot key is submitted in browser", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /Set up your Grist/, 5000);
      // Toggle to boot key mode first.
      await driver.find(".test-setup-toggle-bootkey").click();
      const input = await driver.find(".test-setup-boot-key-input");
      await input.sendKeys("test-boot-key-123");
      const submit = await driver.find(".test-setup-boot-key-submit");
      await submit.click();
      // Should auto-advance to step 2 (sandbox configuration).
      await driver.findContentWait("div", /Sandboxing/, 5000);
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

    it("serves normal content at / when GRIST_IN_SERVICE is set", async function() {
      const resp = await fetch(`${server.getHost()}/`);
      assert.equal(resp.status, 200);
      const text = await resp.text();
      assert.notMatch(text, /Set up your Grist/);
    });
  });
});
