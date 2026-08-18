import { Activation } from "app/gen-server/entity/Activation";
import * as gu from "test/nbrowser/gristUtils";
import { startMockOIDCIssuer } from "test/nbrowser/oidcMockServer";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

const BOOT_KEY = "bootkey";
const ADMIN_EMAIL = "boot@example.com";

// A session made with a boot key is the only one kept when an auth change clears sessions,
// so the operator is not signed out half-way through the wizard. Going live ends the setup
// and drops it with the rest.
describe("QuickSetupBoot", function() {
  this.timeout("2m");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let oidc: Awaited<ReturnType<typeof startMockOIDCIssuer>>;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    await server.removeLogin();
    oidc = await startMockOIDCIssuer({ authorize: true });

    // Set through prefs below instead, so that going live can change it.
    delete process.env.GRIST_IN_SERVICE;
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_BOOT_KEY = BOOT_KEY;

    // Start once to get a fresh database, write the prefs into it, then restart so the
    // server picks them up. Prefs are only read at startup.
    const opts = { useCoreCmd: true, restartShell: true };
    await server.restart(true, undefined, opts);
    await setPrefs(freshInstallPrefs(new URL(server.getHost()).port));
    await server.restart(undefined, undefined, opts);
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
    await oidc?.shutdown();
  });

  // A getgrist.com configuration key pointing at the mock issuer. getgrist.com needs no
  // activation key, so the wizard can stage it as the active method in a community install.
  function buildGetGristKey() {
    return Buffer.from(JSON.stringify({
      oidcClientId: "test-client-id",
      oidcClientSecret: "test-client-secret",
      oidcIssuer: oidc.url + "?provider=getgrist.com",
      oidcSkipEndSessionEndpoint: true,
      owner: { name: "Boot", email: ADMIN_EMAIL },
    })).toString("base64");
  }

  // Prefs, unlike process.env, can still be changed later by the wizard.
  async function setPrefs(envVars: Record<string, string>) {
    const db = await server.getDatabase();
    await db.connection.manager.deleteAll(Activation);
    const activation = new Activation();
    activation.id = "installation1";
    activation.prefs = { envVars };
    await db.connection.manager.save(activation);
  }

  // A fresh install: the gate is up and nothing is configured yet, so the operator signs
  // in with the boot key and picks a method in the wizard.
  function freshInstallPrefs(homePort: string) {
    return {
      GRIST_IN_SERVICE: "false",
      GRIST_GETGRISTCOM_SP_HOST: `http://localhost:${homePort}`,
    };
  }

  // The restart endpoint marks the server not-ready before it answers, so a poll cannot
  // miss the window: wait for it to stop being ready, then for it to come back.
  async function waitForRestart() {
    await driver.wait(async () => !(await server.isServerReady()), 30000);
    await server.waitServerReady(30000);
  }

  async function isInstallAdmin(): Promise<boolean> {
    return await driver.executeAsyncScript((done: any) => {
      fetch(location.origin + "/api/session/access/active", { credentials: "include" })
        .then(r => r.json())
        .then(body => done(Boolean(body?.user?.isInstallAdmin)))
        .catch(() => done(false));
    });
  }

  async function signInWithBootKey() {
    await driver.get(`${server.getHost()}/boot`);
    await driver.findWait(".test-boot-page-content", 4000);
    await driver.find(".test-boot-page-boot-key-input").doClear().sendKeys(BOOT_KEY);
    await driver.find(".test-boot-page-check-key").click();
    await gu.waitForServer();
    await driver.findWait(".test-boot-page-boot-key-verified", 4000);
    await driver.find(".test-boot-page-email-input").doClear().sendKeys(ADMIN_EMAIL);
    await driver.find(".test-boot-page-continue").click();
    await gu.waitForServer();
    await gu.waitForAdminPanel();
  }

  it("keeps the boot-key session across a session-clearing auth change", async function() {
    await signInWithBootKey();
    await driver.findContentWait("button", /Authentication/, 4000).click();

    // Configuring getgrist.com also stages it as the pending activation, which asks for
    // sessions to be cleared on restart.
    await gu.waitToPass(async () => {
      await driver.findWait(".test-admin-auth-hero-configure", 4000).click();
    });
    await driver.findWait(".test-admin-auth-config-key-textarea", 2000).sendKeys(buildGetGristKey());
    await driver.find(".test-admin-auth-modal-configure").click();
    await gu.waitForServer();

    await gu.waitToPass(async () => {
      const continueBtn = await driver.findWait(".test-quick-setup-auth-continue", 2000);
      assert.match(await continueBtn.getText(), /Apply and Continue/i);
      await continueBtn.click();
    }, 4000);

    // The click returns before the restart happens, so wait for the server to go down and
    // come back. Asserting any earlier only reads the old process, where the session is
    // still there no matter what.
    await waitForRestart();

    // The boot-key session is kept, so the operator is still the install admin. Without it
    // they would be anonymous and the gate would send them back to /boot.
    assert.equal(await isInstallAdmin(), true);
  });

  it("drops the boot-key session when going live", async function() {
    await driver.get(`${server.getHost()}/admin/setup`);
    await driver.findWait(".test-stepper-step-4", 4000).click();
    await driver.findWait(".test-permissions-setup-go-live", 4000).click();
    await waitForRestart();

    assert.equal(await isInstallAdmin(), false);
  });
});
