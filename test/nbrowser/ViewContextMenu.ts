import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("ViewContextMenu", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup);
  });

  afterEach(() => gu.checkForErrors());

  it("should support opening a GridView cell context menu with keyboard", async function() {
    await assertShortcutWorks(Key.chord(Key.SHIFT, Key.F10), "Clear cell");
  });

  it("should support opening a RecordView context menu with keyboard", async function() {
    await gu.addNewSection("Card", "Table1");
    await assertShortcutWorks(Key.chord(Key.SHIFT, Key.F10), "Clear field");
  });

  it("should not open a context menu twice when opening it with keyboard", async function() {
    await pressShiftF10();
    assert.isTrue(await gu.findOpenMenu().isDisplayed());
    await pressShiftF10(true);
    await driver.sleep(100);
    const openedMenus = await driver.findAll(".grist-floating-menu");
    assert.equal(openedMenus.length, 1);

    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();
  });

  it("should hide the context menu when clicking outside of it after opening it with keyboard", async function() {
    await pressShiftF10();
    assert.isTrue(await gu.findOpenMenu().isDisplayed());
    await gu.selectSectionByTitle("Table1");
    await gu.waitForMenuToClose();
  });

  it("should support opening a GridView column context menu with keyboard", async function() {
    await assertShortcutWorks(Key.chord(Key.CONTROL, Key.SHIFT, Key.F10), "Column Options");
  });

  it("should support opening a GridView row context menu with keyboard", async function() {
    await assertShortcutWorks(Key.chord(Key.ALT, Key.SHIFT, Key.F10), "Duplicate row");
  });
});

// Make sure a given keyboard shortcut opens a menu containing a given item.
async function assertShortcutWorks(shortcut: string, menuItemToTest: string) {
  await gu.waitAppFocus();
  await pressShortcut(shortcut);
  assert.isTrue(await gu.findOpenMenu().isDisplayed());
  await gu.findOpenMenuItem("li", menuItemToTest);
  await gu.sendKeys(Key.ESCAPE);
  await gu.waitForMenuToClose();
}

// Using gu.sendKeys doesn't work with Shift+F10 and similar shortcuts,
// so we have to deal with the testing environment limitations.
async function pressShortcut(shortcut: string, inMenu: boolean = false) {
  await driver.find(inMenu ? ".grist-floating-menu" : ".copypaste").sendKeys(shortcut);
}
async function pressShiftF10(inMenu: boolean = false) {
  return pressShortcut(Key.chord(Key.SHIFT, Key.F10), inMenu);
}
