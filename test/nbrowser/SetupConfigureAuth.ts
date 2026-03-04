import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";
import fetch from "node-fetch";

/**
 * Build a fake GRIST_GETGRISTCOM_SECRET for testing.
 * The secret is a base64-encoded JSON with OIDC fields and an owner.
 */
function buildConfigKey(ownerEmail: string, ownerName = "Test User") {
  const payload = {
    oidcClientId: "test-client-id",
    oidcClientSecret: "test-client-secret",
    oidcIssuer: "https://login.getgrist.com",
    owner: { name: ownerName, email: ownerEmail },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * Build a config key with no owner field.
 */
function buildConfigKeyNoOwner() {
  const payload = {
    oidcClientId: "test-client-id",
    oidcClientSecret: "test-client-secret",
    oidcIssuer: "https://login.getgrist.com",
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

describe("SetupConfigureAuth", function() {
  this.timeout(60000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

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
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: buildConfigKey("admin@example.com") }),
      });
      assert.equal(resp.status, 404);
    });
  });

  describe("without GRIST_ADMIN_EMAIL", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      delete process.env.GRIST_ADMIN_EMAIL;
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    it("rejects API call when GRIST_ADMIN_EMAIL is not set", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: buildConfigKey("admin@example.com") }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /GRIST_ADMIN_EMAIL must be set/);
    });

    it("shows setup page with registration link and config key textarea", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /needs to be set up/, 5000);
      // Should show the GRIST_ADMIN_EMAIL instruction.
      assert.include(await driver.getPageSource(), "GRIST_ADMIN_EMAIL");
      // Should show the registration link.
      const link = await driver.find(".test-setup-register-link");
      assert.isTrue(await link.isDisplayed());
      const href = await link.getAttribute("href");
      assert.include(href, "login.getgrist.com/oauth/register");
      // Should show the config key textarea.
      const textarea = await driver.find(".test-setup-config-key");
      assert.isTrue(await textarea.isDisplayed());
    });

    it("shows error in browser when submitting without GRIST_ADMIN_EMAIL set", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /needs to be set up/, 5000);
      const textarea = await driver.find(".test-setup-config-key");
      await textarea.sendKeys(buildConfigKey("admin@example.com"));
      await driver.find(".test-setup-configure-submit").click();
      // Wait for error to appear.
      await driver.findContentWait(".test-setup-config-error", /GRIST_ADMIN_EMAIL must be set/, 5000);
    });
  });

  describe("with GRIST_ADMIN_EMAIL set", function() {
    before(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.GRIST_FORCE_SETUP_GATE = "true";
      delete process.env.GRIST_IN_SERVICE;
      process.env.GRIST_ADMIN_EMAIL = "admin@example.com";
      await server.restart(true);
    });

    after(async function() {
      oldEnv.restore();
      await server.restart(true);
    });

    // --- API tests ---

    it("rejects when body is missing the secret", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /Missing GRIST_GETGRISTCOM_SECRET/);
    });

    it("rejects an invalid (non-base64 / malformed) key", async function() {
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: "not-a-valid-key" }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /Invalid configuration key/);
    });

    it("rejects a key missing required OIDC fields", async function() {
      const incomplete = Buffer.from(JSON.stringify({
        oidcClientId: "test-client-id",
        // missing oidcClientSecret and oidcIssuer
      })).toString("base64");
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: incomplete }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /Invalid configuration key/);
    });

    it("rejects when key owner email does not match GRIST_ADMIN_EMAIL", async function() {
      const key = buildConfigKey("someone-else@example.com");
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: key }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /does not match GRIST_ADMIN_EMAIL/);
      assert.include(body.error, "someone-else@example.com");
      assert.include(body.error, "admin@example.com");
    });

    it("rejects when key has no owner email", async function() {
      const key = buildConfigKeyNoOwner();
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: key }),
      });
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /does not match GRIST_ADMIN_EMAIL/);
    });

    it("accepts a valid key with matching owner email", async function() {
      const key = buildConfigKey("admin@example.com");
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: key }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
      assert.equal(body.owner.email, "admin@example.com");
    });

    it("matches email case-insensitively", async function() {
      const key = buildConfigKey("Admin@Example.COM");
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: key }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
    });

    it("handles whitespace in the pasted key", async function() {
      // Users may paste keys with line breaks from the registration page.
      const key = buildConfigKey("admin@example.com");
      const keyWithWhitespace = key.slice(0, 10) + "\n" + key.slice(10, 20) + " " + key.slice(20);
      const resp = await fetch(`${server.getHost()}/api/setup/configure-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: keyWithWhitespace }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.msg, "ok");
    });

    // --- Browser tests ---

    it("shows error in browser when key email does not match", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /needs to be set up/, 5000);
      const textarea = await driver.find(".test-setup-config-key");
      await textarea.sendKeys(buildConfigKey("wrong@example.com"));
      await driver.find(".test-setup-configure-submit").click();
      await driver.findContentWait(".test-setup-config-error", /does not match/, 5000);
    });

    it("shows success in browser when key email matches", async function() {
      await driver.get(`${server.getHost()}/`);
      await driver.findContentWait("div", /needs to be set up/, 5000);
      const textarea = await driver.find(".test-setup-config-key");
      await textarea.sendKeys(buildConfigKey("admin@example.com"));
      await driver.find(".test-setup-configure-submit").click();
      // Wait for success message.
      await driver.findContentWait("div", /Authentication configured/, 5000);
      await driver.findContentWait("div", /restart your server/, 5000);
    });
  });
});
