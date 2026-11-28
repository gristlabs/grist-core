import * as gu from "test/nbrowser/gristUtils";
import { enableTableSyncFeature } from "test/nbrowser/tableSyncTestUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";
import { Cleanup } from "test/server/testCleanup";

import { assert, driver, Key, WebElement } from "mocha-webdriver";

describe("TableSyncSource", function() {
  this.timeout(15000);
  const cleanup = setupTestSuite();

  let session: gu.Session;
  let docId: string;
  let restoreFeatures: (() => Promise<void>) | undefined;
  let hadSyncTablesButton: boolean;

  gu.withEnvironmentSnapshot({ GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "saas" });

  before(async function() {
    session = await gu.session().teamSite.login();
    restoreFeatures = await enableTableSyncFeature(session);
    docId = await session.tempNewDoc(cleanup, "TableSyncSource", { load: false });
    await session.createHomeApi().applyUserActions(docId, [
      ["AddTable", "Table2", [{ id: "A", type: "Text", isFormula: false }]],
    ]);
    await session.loadDoc(`/doc/${docId}`);
  });

  after(async () => { await restoreFeatures?.(); });

  afterEach(() => gu.checkForErrors());

  it("allows syncing a table", async function() {
    await rawData.open();
    // Not every build has this button.
    hadSyncTablesButton = await rawData.hasSyncTablesButton();
    await rawData.openMenu("Table1");
    await menu.click("Allow syncing…");
    assert.equal(await modal.title(), "Allow syncing Table1?");
    await modal.confirm();
    assert.deepEqual(await tableOptions(session, docId, "Table1"), { allowSyncing: true });
    await rawData.expectBadges({ Table1: "Allowed", Table2: null });
    await rawData.expectSyncTablesButton(false);
  });

  it("disables rename of an allowed table", async function() {
    await rawData.openMenu("Table1");
    assert.deepEqual(await menu.disabledItems(), ["Rename table"]);
    await menu.close();
  });

  it("disables syncing and allows rename again", async function() {
    await rawData.openMenu("Table1");
    await menu.click("Disable syncing…");
    assert.equal(await modal.title(), "Disable Table1 syncing?");
    await modal.confirm();
    await rawData.expectSyncColumn(false);
    assert.deepEqual(await tableOptions(session, docId, "Table1"), {});
    await rawData.expectSyncTablesButton(hadSyncTablesButton);

    await rawData.openMenu("Table1");
    assert.deepEqual(await menu.disabledItems(), []);
    await menu.close();
  });

  it("still renames an allowed table through the API", async function() {
    await setOptionsViaApi(session, docId, "Table1", { allowSyncing: true });
    await renameTableViaApi(session, docId, "Table1", "Renamed");
    assert.deepEqual(await tableOptions(session, docId, "Renamed"), { allowSyncing: true });
  });

  it("shows an error to an editor who may not change the structure", async function() {
    // User2 is an editor, and a rule takes away their right to change the structure.
    const editDocId = await makeDocSharedWithUser2(session, cleanup, "TableSyncSourceNoSchemaEdit", "editors");
    await session.createHomeApi().applyUserActions(editDocId, [
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
      ["AddRecord", "_grist_ACLRules", null, {
        resource: -1, aclFormula: "user.Access != OWNER", permissionsText: "-S",
      }],
    ]);
    await asUser2(session, editDocId, async () => {
      // The page can't know about the rule, so the menu item is enabled.
      await rawData.openMenu("Table1");
      assert.notInclude(await menu.disabledItems(), "Allow syncing…");

      // Saving is refused: the dialog stays open, and the editor sees why.
      await menu.click("Allow syncing…");
      await driver.findWait(".test-modal-confirm", 1000).click();
      await gu.waitToPass(async () => assert.include((await gu.getToasts()).join(),
        "Blocked by full structure access rules"));
      await driver.find(".test-modal-cancel").click();
    });

    // The table still doesn't allow syncing.
    assert.deepEqual(await tableOptions(session, editDocId, "Table1"), {});
  });

  it("allows syncing for editors", async function() {
    const editDocId = await makeDocSharedWithUser2(session, cleanup, "TableSyncSourceEditor", "editors");
    await asUser2(session, editDocId, async () => {
      await rawData.openMenu("Table1");
      assert.notInclude(await menu.disabledItems(), "Allow syncing…");
      await menu.close();
    });
  });

  it("disables allow syncing for viewers", async function() {
    const viewDocId = await makeDocSharedWithUser2(session, cleanup, "TableSyncSourceViewer", "viewers");
    await asUser2(session, viewDocId, async () => {
      await rawData.openMenu("Table1");
      assert.deepEqual(await menu.disabledItems(), [
        "Rename table", "Duplicate table", "Remove table", "Edit record card", "Disable Record Card",
        "Allow syncing…",
      ]);
      await menu.close();
    });
  });
});

const BADGE_SELECTORS = [".test-raw-data-table-allowed", ".test-raw-data-table-sync-status"];

const rawData = {
  async open() {
    await driver.find(".test-tools-raw").click();
    await driver.findWait(".test-raw-data-list", 2000);
    await gu.waitForServer();
  },

  async badges() {
    const result: Record<string, string | null> = {};
    for (const row of await driver.findAll(".test-raw-data-table")) {
      const tableId = await row.find(".test-raw-data-table-id").getText();
      result[tableId] = await badgeOf(row);
    }
    return result;
  },

  async expectBadges(expected: Record<string, string | null>) {
    await gu.waitToPass(async () => {
      assert.deepEqual(await rawData.badges(), expected);
    }, 5000);
  },

  async expectSyncColumn(shown: boolean) {
    await gu.waitToPass(async () => {
      assert.equal(await driver.find(".test-raw-data-table-sync").isPresent(), shown);
    }, 5000);
  },

  async hasSyncTablesButton() {
    return driver.find(".test-raw-data-sync-tables").isPresent();
  },

  async expectSyncTablesButton(shown: boolean) {
    await gu.waitToPass(async () => {
      assert.equal(await rawData.hasSyncTablesButton(), shown);
    });
  },

  async openMenu(tableId: string) {
    // Changing access rules reloads the document, so the list may still be coming back.
    await driver.findWait(`.test-raw-data-table-menu-${tableId}`, 5000).click();
    await driver.findWait(".grist-floating-menu .test-raw-data-menu-rename-table", 2000);
  },
};

const menu = {
  async items() {
    return driver.findAll(".grist-floating-menu li", el => el.getText());
  },

  async disabledItems() {
    return driver.findAll('.grist-floating-menu li[aria-disabled="true"]', el => el.getText());
  },

  async click(text: string) {
    await gu.findOpenMenuItem("li", text).click();
  },

  async close() {
    await gu.sendKeys(Key.ESCAPE);
  },
};

const modal = {
  async title() {
    return driver.findWait(".test-modal-title", 2000).getText();
  },

  async confirm() {
    await driver.findWait(".test-modal-confirm", 1000).click();
    await driver.wait(async () => !(await driver.find(".test-modal-dialog").isPresent()), 10000);
    await gu.waitForServer();
  },
};

async function badgeOf(row: WebElement) {
  for (const selector of BADGE_SELECTORS) {
    if (await row.find(selector).isPresent()) {
      return row.find(selector).getText();
    }
  }
  return null;
}

async function tableOptions(session: gu.Session, docId: string, tableId: string) {
  const tables = await session.createHomeApi().getDocAPI(docId).getRecords("_grist_Tables");
  const table = tables.find(t => t.fields.tableId === tableId);
  return JSON.parse(String(table?.fields.options || "{}"));
}

async function setOptionsViaApi(session: gu.Session, docId: string, tableId: string, options: object) {
  const api = session.createHomeApi();
  const tables = await api.getDocAPI(docId).getRecords("_grist_Tables");
  const table = tables.find(t => t.fields.tableId === tableId)!;
  await api.applyUserActions(docId, [
    ["UpdateRecord", "_grist_Tables", table.id, { options: JSON.stringify(options) }],
  ]);
}

async function renameTableViaApi(session: gu.Session, docId: string, from: string, to: string) {
  await session.createHomeApi().applyUserActions(docId, [["RenameTable", from, to]]);
}

async function makeDocSharedWithUser2(
  session: gu.Session, cleanup: Cleanup, name: string, role: "editors" | "viewers",
) {
  const docId = await session.tempNewDoc(cleanup, name, { load: false });
  await session.createHomeApi().updateDocPermissions(docId, {
    users: { [gu.translateUser("user2").email]: role },
  });
  return docId;
}

async function asUser2(session: gu.Session, docId: string, body: () => Promise<void>) {
  const user2 = await gu.session().teamSite.user("user2").login();
  try {
    await user2.loadDoc(`/doc/${docId}`);
    await rawData.open();
    await body();
  } finally {
    await session.login();
    await session.loadDocMenu("/");
  }
}
