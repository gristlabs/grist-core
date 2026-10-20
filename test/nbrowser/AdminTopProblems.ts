import { Activation } from "app/gen-server/entity/Activation";
import { OUTGOING_REQUEST_ENV_VARS } from "app/server/lib/outgoingRequests";
import * as gu from "test/nbrowser/gristUtils";
import { useFastSandboxProbe } from "test/nbrowser/sandboxProbeFixture";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { randomUUID } from "crypto";

import { assert, driver } from "mocha-webdriver";

describe("AdminTopProblems", function() {
  this.timeout("2m");
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    OUTGOING_REQUEST_ENV_VARS.forEach((v) => { delete process.env[v]; });
    // Set here, since only the dev server turns REQUEST() on by default.
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    useFastSandboxProbe();
    await server.restart(true);
    await gu.session().personalSite.login();
    await openAdminPanel();
    // Start without anything dismissed by earlier runs.
    await driver.executeScript("window.localStorage.clear(); window.sessionStorage.clear();");
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  afterEach(() => gu.checkForErrors());

  // Tests run with GRIST_SANDBOX_FLAVOR=unsandboxed, the minimal login, and REQUEST() without a
  // URL filter, so the page always reports these problems.

  describe("wells", function() {
    it("lists errors before warnings in one well", async function() {
      await openAdminPanel();
      assert.isTrue(await well.isDisplayed());
      assert.equal(await well.severity(), "error");
      assert.equal(await well.heading(), "3 problems need attention");
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      assert.deepEqual(await well.listSeverities(), ["error", "warning", "warning"]);
      assert.isTrue(await well.canBeDismissedAt(0));
      assert.isTrue(await well.canBeDismissedAt(1));
      assert.isTrue(await well.canBeDismissedAt(2));
    });

    it("goes to the row of a problem with Show", async function() {
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      // The Sandboxing row is below the part of the page that is shown.
      const before = await pagePositions("sandboxing");
      assert.isFalse(isBetween(before.windowTop, before.itemTop, before.windowBottom));

      // Show scrolls the page so that the Sandboxing row is shown.
      await well.showAt(0);
      await gu.waitToPass(async () => {
        const after = await pagePositions("sandboxing");
        assert.isTrue(isBetween(after.windowTop, after.itemTop, after.windowBottom));
      }, 1000);
    });

    it("has no Dismiss for problems that cannot be dismissed", async function() {
      // Without an admin, only the boot key opens the admin panel.
      await withServerEnv({ GRIST_DEFAULT_EMAIL: "", GRIST_BOOT_KEY: "zig" }, async () => {
        await gu.removeLogin();
        await openAdminPanel("?boot-key=zig");
        assert.deepEqual((await well.listProblems()).slice(0, 2), [
          "No install admin",
          "Formulas are not sandboxed",
        ]);
        assert.isFalse(await well.canBeDismissedAt(0));
        assert.isTrue(await well.canBeDismissedAt(1));
      });
      await gu.session().personalSite.login();
    });
  });

  describe("dismissing", function() {
    it("hides a dismissed problem until it is restored", async function() {
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      assert.isTrue(await well.canBeDismissedAt(0));
      assert.equal(await dismissed.count(), 0);

      // Without errors, the well turns amber.
      await well.dismissAt(0);
      assert.deepEqual(await well.listProblems(), WARNINGS);
      assert.equal(await well.severity(), "warning");
      assert.equal(await well.heading(), "2 warnings");
      assert.equal(await dismissed.count(), 1);

      // Stays dismissed after a reload.
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), WARNINGS);
      assert.equal(await dismissed.count(), 1);
      assert.deepEqual(await dismissed.readTooltip(), [
        "Formulas are not sandboxed",
        "Click to show them again.",
      ]);

      await dismissed.click();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      assert.equal(await well.severity(), "error");
      assert.equal(await dismissed.count(), 0);
    });

    it("hides the well when all problems are dismissed", async function() {
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);

      await well.dismissAt(0);
      await well.dismissAt(0);
      await well.dismissAt(0);
      assert.isFalse(await well.isDisplayed());
      assert.equal(await dismissed.count(), 3);

      await dismissed.click();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
    });

    it("shows dismissed problems again on another installation", async function() {
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      assert.isTrue(await well.canBeDismissedAt(0));
      assert.equal(await dismissed.count(), 0);

      await well.dismissAt(0);
      assert.deepEqual(await well.listProblems(), WARNINGS);
      assert.equal(await dismissed.count(), 1);

      // Another installation at the same address does not see what was dismissed here.
      await setInstallationId(randomUUID());
      await server.restart();
      await openAdminPanel();
      assert.deepEqual(await well.listProblems(), ALL_PROBLEMS);
      assert.equal(await dismissed.count(), 0);
    });
  });
});

class Well {
  constructor(private _selector: string) {}

  public async isDisplayed() {
    return driver.find(this._selector).isPresent();
  }

  public async severity() {
    return colorOf(await driver.find(this._selector).getAttribute("class"));
  }

  public async heading() {
    return (await driver.find(this._selector).getText()).split("\n")[0];
  }

  public async listProblems(): Promise<string[]> {
    if (!await this.isDisplayed()) {
      return [];
    }
    return driver.find(this._selector).findAll(".test-top-problems-title", e => e.getText());
  }

  public async listSeverities(): Promise<string[]> {
    return driver.find(this._selector).findAll(".test-top-problems-icon",
      async e => colorOf(await e.getAttribute("class")));
  }

  public async showAt(index: number) {
    await (await this._problemAt(index)).find(".test-top-problems-show").click();
  }

  public async canBeDismissedAt(index: number) {
    return (await this._problemAt(index)).find(".test-top-problems-dismiss").isPresent();
  }

  public async dismissAt(index: number) {
    const title = (await this.listProblems())[index];
    await (await this._problemAt(index)).find(".test-top-problems-dismiss").click();
    await gu.waitToPass(async () => assert.notInclude(await this.listProblems(), title));
  }

  private async _problemAt(index: number) {
    return (await driver.find(this._selector).findAll(".test-top-problems-problem"))[index];
  }
}

const well = new Well(".test-top-problems-well");

const WARNINGS = [
  "Anyone can open this server",
  "User-triggered outgoing requests aren't filtered",
];
const ALL_PROBLEMS = ["Formulas are not sandboxed", ...WARNINGS];

function colorOf(className: string): string {
  return className.match(/-(error|warning)\b/)?.[1] ?? "";
}

const dismissed = {
  async count() {
    const link = driver.find(".test-top-problems-dismissed");
    if (!await link.isPresent()) {
      return 0;
    }
    return parseInt(await link.getText(), 10);
  },

  async readTooltip() {
    await driver.find(".test-top-problems-dismissed").mouseMove();
    const tooltip = await driver.findWait(".test-tooltip", 2000);
    return (await tooltip.getText()).split("\n");
  },

  async click() {
    await driver.find(".test-top-problems-dismissed").click();
    await gu.waitToPass(async () => assert.equal(await dismissed.count(), 0));
  },
};

// Positions in the admin page, in pixels from its top: the top of the item, and the top and
// bottom of the part of the page that is shown now. The browser window does not scroll; the
// admin page (.test-admin-panel) scrolls inside it.
async function pagePositions(itemId: string): Promise<{ itemTop: number, windowTop: number, windowBottom: number }> {
  return driver.executeScript((id: string) => {
    const page = document.querySelector(".test-admin-panel")!;
    const item = document.querySelector(`.test-admin-panel-item-${id}`)!;
    const windowTop = page.scrollTop;
    return {
      itemTop: item.getBoundingClientRect().top - page.getBoundingClientRect().top + windowTop,
      windowTop,
      windowBottom: windowTop + page.clientHeight,
    };
  }, itemId);
}

async function openAdminPanel(query = "") {
  await driver.get(`${server.getHost()}/admin${query}`);
  await gu.waitForAdminPanel();
  await gu.waitForAdminChecks();
}

async function withServerEnv(env: Record<string, string | undefined>, body: () => Promise<void>) {
  const snapshot = new testUtils.EnvironmentSnapshot();
  try {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await server.restart();
    await body();
  } finally {
    snapshot.restore();
    await server.restart();
  }
}

async function setInstallationId(id: string) {
  const db = await server.getDatabase();
  const activation = await db.connection.manager.findOneOrFail(Activation, { where: {} });
  await db.connection.manager.deleteAll(Activation);
  await db.connection.manager.insert(Activation, { ...activation, id });
}

function isBetween(left: number, val: number, right: number) {
  return left <= val && val <= right;
}
