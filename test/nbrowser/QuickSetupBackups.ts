import { InstallAPIImpl } from "app/common/InstallAPI";
import { sectionValue } from "test/nbrowser/AdminPanelTools";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import * as os from "os";
import * as path from "path";

import * as fse from "fs-extra";
import { assert, driver } from "mocha-webdriver";

describe("QuickSetupBackups", function() {
  this.timeout(process.env.DEBUG ? "10m" : "40s");
  setupTestSuite();
  gu.bigScreen();

  let oldEnv: testUtils.EnvironmentSnapshot;
  let installApi: InstallAPIImpl;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    await restart();
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  async function restart() {
    await server.restart(true); // clear database
    const session = await gu.session().personalSite.login();
    installApi = session.createApi(InstallAPIImpl);
  }

  async function openStep() {
    await driver.get(`${server.getHost()}/admin/setup`);
    await driver.findWait(".test-stepper-step-3", 2000).click();
    await driver.findContentWait(".test-setup-card-item", /No external storage/, 2000).click();
  }

  async function assertContinue(enabled: boolean) {
    const button = await driver.findWait(".test-quick-setup-backups-continue", 2000);
    await gu.waitToPass(async () => {
      assert.equal(await button.getAttribute("disabled"), enabled ? null : "true");
      assert.equal(await button.getText(), enabled ? "Continue" : "Check storage to continue");
    }, 2000);
  }

  async function getAnswer() {
    return (await installApi.getInstallPrefs()).persistenceConfirmed;
  }

  async function assertAdminSummary(text: string, status: string) {
    await driver.get(`${server.getHost()}/admin`);
    await gu.waitToPass(async () => {
      assert.equal(await sectionValue("backups").text(), text);
      assert.equal(await sectionValue("backups").status(), status);
    }, 5000);
  }

  async function assertConfirmed() {
    await gu.waitToPass(async () => assert.equal(
      await driver.find(".test-backups-persist-confirmed-row").getText(), "Persistent storage confirmed"));
    assert.isFalse(await driver.find(".test-backups-persist-verify").isPresent());
    assert.isFalse(await driver.find(".test-backups-persist-warning").isPresent());
    await assertContinue(true);
  }

  describe("with no sign of a problem", function() {
    before(async function() {
      // Storage in memory (e.g. a /tmp on tmpfs) gets the red card, tested below; external
      // storage with Postgres gets no card at all.
      const { status, details } = await installApi.runCheck("persist-data");
      if (status === "fault" || (details?.externalStorageActive && details?.usesPostgres)) { this.skip(); }
    });

    it("asks about storage and blocks Continue until answered", async function() {
      await assertAdminSummary("unconfirmed", "danger");

      await openStep();
      await gu.waitToPass(async () => {
        const text = await driver.find(".test-backups-persist-verify").getText();
        assert.match(text, /Is your data on persistent storage\?/);
        assert.match(text, /Grist can't check this for itself\./);
      }, 2000);
      await assertContinue(false);
      assert.isUndefined(await getAnswer());
    });

    it("lets Quick Setup continue on \"I will check later\", until the page reloads", async function() {
      await driver.find(".test-backups-persist-later").click();
      await gu.waitToPass(async () => assert.equal(
        await driver.find(".test-backups-persist-confirmed-row").getText(), "Will check storage later"));
      assert.isFalse(await driver.find(".test-backups-persist-verify").isPresent());
      await assertContinue(true);
      assert.isUndefined(await getAnswer());

      // Nothing was saved, so the question is back.
      await openStep();
      await driver.findWait(".test-backups-persist-verify", 2000);
      await assertContinue(false);
    });

    it("saves a confirmation and lets Quick Setup continue", async function() {
      await driver.find(".test-backups-persist-confirm").click();
      await assertConfirmed();
      assert.isTrue(await getAnswer());

      // The answer is remembered.
      await openStep();
      await assertConfirmed();
    });

    it("takes back the confirmation from the pencil", async function() {
      await driver.find(".test-backups-persist-edit").click();
      await driver.findWait(".test-backups-persist-verify", 2000);
      await assertContinue(false);
      assert.isFalse(await getAnswer());

      // It stays taken back.
      await openStep();
      await driver.findWait(".test-backups-persist-verify", 2000);
    });
  });

  describe("with storage in memory", function() {
    let envBefore: testUtils.EnvironmentSnapshot | undefined;
    let dataDir: string;

    before(async function() {
      // /dev/shm is a tmpfs on Linux; the check reads /proc, so other systems can't run this.
      if (os.platform() !== "linux" || !await fse.pathExists("/dev/shm")) { this.skip(); }
      envBefore = new testUtils.EnvironmentSnapshot();
      dataDir = await fse.mkdtemp(path.join("/dev/shm", "grist-persist-test-"));
      process.env.GRIST_DATA_DIR = dataDir;
      await restart();
      const { status, details } = await installApi.runCheck("persist-data");
      // External storage would keep documents off local disk.
      if (details?.externalStorageActive) { this.skip(); }
      assert.equal(status, "fault");
    });

    after(async function() {
      if (!envBefore) { return; }
      envBefore.restore();
      await fse.remove(dataDir);
      await restart();
    });

    it("warns, and lets the admin confirm anyway", async function() {
      await assertAdminSummary("at risk", "error");

      await openStep();
      await gu.waitToPass(async () => {
        const text = await driver.find(".test-backups-persist-warning").getText();
        assert.match(text, /Your data may be lost\./);
        assert.match(text, /Grist is storing data in memory\. Move it to a disk or volume\./);
      }, 2000);
      await assertContinue(false);

      await driver.find(".test-backups-persist-confirm").click();
      await assertConfirmed();
      assert.isTrue(await getAnswer());
    });
  });
});
