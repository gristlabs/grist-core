/**
 * Tests for the "View as" list users filter.
 * Covers both the Access Rules page "view as" dropdown button and the Tools "Access Rules (…)" menu.
 */
import { startEditingAccessRules } from "test/nbrowser/aclTestUtils";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

/** Emails used to push the shared-user count above the filter threshold. */
const EXTRA_FILTER_USERS = Array.from({ length: 12 }, (_, i) => `filter-user-${i + 1}@example.com`);

interface ViewAsEntry {
  name: string;
  /** CSS selector for a listed user row/item inside the open menu. */
  itemSelector: string;
  open: () => Promise<void>;
}

async function openAclViewAsPopup() {
  await startEditingAccessRules();
  await driver.findContentWait("button", /View as/, 3000).click();
  await gu.findOpenMenu();
}

async function closeViewAsMenu() {
  if (!(await driver.find(".grist-floating-menu").isPresent())) { return; }
  // Escape clears an active filter before closing; send a second time if still open.
  await driver.sendKeys(Key.ESCAPE);
  if (await driver.find(".grist-floating-menu").isPresent()) {
    await driver.sendKeys(Key.ESCAPE);
  }
  await gu.waitToPass(async () => {
    assert.isFalse(await driver.find(".grist-floating-menu").isPresent());
  });
}

async function filterWith(text: string) {
  const input = driver.find(".test-acl-user-filter");
  await input.click();
  await gu.sendKeys(await gu.selectAllKey(), Key.DELETE, text);
}

async function menuItemsCount(itemSelector: string): Promise<number> {
  return (await driver.findAll(`.grist-floating-menu ${itemSelector}`)).length;
}

describe("AccessRulesViewAsFilter", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let mainSession: gu.Session;
  let docId: string;

  afterEach(() => gu.checkForErrors());

  before(async function() {
    mainSession = await gu.session().teamSite.user("user1").login();
    docId = await mainSession.tempNewDoc(cleanup, "AccessRulesViewAsFilter", { load: false });
    const api = mainSession.createHomeApi();
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: "owners",
      [gu.translateUser("user3").email]: "editors",
    } });
  });

  describe("with few users", function() {
    before(async function() {
      await mainSession.loadDoc(`/doc/${docId}`);
    });

    afterEach(async () => closeViewAsMenu());

    it("does not show a filter in the ACL View as popup", async function() {
      await openAclViewAsPopup();
      assert.isFalse(await driver.find(".test-acl-user-filter").isPresent());
      // Make sure that users are still listed
      const count = await menuItemsCount(".test-acl-user-item");
      assert.isBelow(count, 10);
      assert.isAbove(count, 0);
    });

    it("does not show a filter in the Tools View as menu", async function() {
      await gu.openAccessRulesDropdown();
      assert.isFalse(await driver.find(".test-acl-user-filter").isPresent());
      // Make sure that users are still listed
      const count = await menuItemsCount(".test-acl-user-access");
      assert.isBelow(count, 10);
      assert.isAbove(count, 0);
    });
  });

  describe("with many users", function() {
    const popups: ViewAsEntry[] = [
      { name: "ACL View as popup", itemSelector: ".test-acl-user-item", open: openAclViewAsPopup },
      { name: "Tools View as menu", itemSelector: ".test-acl-user-access", open: gu.openAccessRulesDropdown },
    ];

    before(async function() {
      const api = mainSession.createHomeApi();
      const users: Record<string, "viewers"> = {};
      for (const email of EXTRA_FILTER_USERS) {
        users[email] = "viewers";
      }
      await api.updateDocPermissions(docId, { users });
      // Add a user-attribute row with a Name that does not appear in the Email, so we can
      // assert name-based filtering independently of email matching.
      await api.applyUserActions(docId, [
        ["AddTable", "NamedUsers", [{ id: "Email" }, { id: "Name" }]],
        ["AddRecord", "NamedUsers", null, { Email: "secret-email@example.com", Name: "Jane Doe" }],
        ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
        ["AddRecord", "_grist_ACLRules", null, {
          resource: -1,
          userAttributes: JSON.stringify({
            name: "NamedUser",
            tableId: "NamedUsers",
            charId: "Email",
            lookupColId: "Email",
          }),
        }],
      ]);
      await mainSession.loadDoc(`/doc/${docId}`);
    });

    for (const popup of popups) {
      describe(popup.name, function() {
        afterEach(async () => closeViewAsMenu());

        it("shows the filter and focuses it on open", async function() {
          await popup.open();
          await gu.waitToPass(async () => {
            assert.isTrue(await driver.find(".test-acl-user-filter").isPresent());
            assert.isTrue(await driver.find(".test-acl-user-filter").hasFocus());
          });
          assert.isAbove(await menuItemsCount(popup.itemSelector), 10);
        });

        it("filters the list by name or email", async function() {
          await popup.open();
          await gu.waitToPass(async () => {
            assert.isTrue(await driver.find(".test-acl-user-filter").hasFocus());
          });

          // Filter by name
          await filterWith("Doe");
          await gu.waitToPass(async () => {
            assert.isTrue(
              await driver.findContent(
                `.grist-floating-menu ${popup.itemSelector}`, "Jane Doe").isPresent(),
            );
            assert.isFalse(
              await driver.findContent(
                `.grist-floating-menu ${popup.itemSelector}`, EXTRA_FILTER_USERS[0]).isPresent(),
            );
            assert.equal(await menuItemsCount(popup.itemSelector), 1);
          });

          // Filter by email
          await filterWith("filter-user-1@");
          await gu.waitToPass(async () => {
            assert.isTrue(
              await driver.findContent(`.grist-floating-menu ${popup.itemSelector}`, EXTRA_FILTER_USERS[0]).isPresent(),
            );
            assert.isFalse(
              await driver.findContent(`.grist-floating-menu ${popup.itemSelector}`, EXTRA_FILTER_USERS[1]).isPresent(),
            );
            assert.isFalse(
              await driver.findContent(`.grist-floating-menu ${popup.itemSelector}`, "Jane Doe").isPresent(),
            );
            assert.equal(await menuItemsCount(popup.itemSelector), 1);
          });

          // Check when there is no match
          await filterWith("azdf");
          await gu.waitToPass(async () => {
            assert.equal(await menuItemsCount(popup.itemSelector), 0);
            assert.isTrue(await driver.find(".test-acl-user-filter-empty").isPresent());
          });
        });

        it("resets the list when the clear button is clicked", async function() {
          await popup.open();
          await gu.waitToPass(async () => {
            assert.isTrue(await driver.find(".test-acl-user-filter").hasFocus());
          });

          const totalBefore = await menuItemsCount(popup.itemSelector);
          await filterWith("filter-user-1");
          await gu.waitToPass(async () => {
            assert.isBelow(await menuItemsCount(popup.itemSelector), totalBefore);
            assert.isTrue(await driver.find(".test-acl-user-filter-clear").isPresent());
          });

          await driver.find(".test-acl-user-filter-clear").click();
          await gu.waitToPass(async () => {
            assert.equal(await driver.find(".test-acl-user-filter").value(), "");
            assert.equal(await menuItemsCount(popup.itemSelector), totalBefore);
            assert.isFalse(await driver.find(".test-acl-user-filter-clear").isPresent());
          });
        });

        it("Escape clears the filter first, then closes the menu", async function() {
          await popup.open();
          await gu.waitToPass(async () => {
            assert.isTrue(await driver.find(".test-acl-user-filter").hasFocus());
          });

          const totalBefore = await menuItemsCount(popup.itemSelector);
          await filterWith("filter-user-1");
          await gu.waitToPass(async () => {
            assert.isBelow(await menuItemsCount(popup.itemSelector), totalBefore);
          });

          // First Escape: clear filter, keep menu open.
          await driver.sendKeys(Key.ESCAPE);
          await gu.waitToPass(async () => {
            assert.equal(await driver.find(".test-acl-user-filter").value(), "");
            assert.equal(await menuItemsCount(popup.itemSelector), totalBefore);
            assert.isTrue(await driver.find(".grist-floating-menu").isPresent());
          });

          // Second Escape: close menu.
          await driver.sendKeys(Key.ESCAPE);
          await gu.waitToPass(async () => {
            assert.isFalse(await driver.find(".grist-floating-menu").isPresent());
          });
        });
      });
    }
  });
});
