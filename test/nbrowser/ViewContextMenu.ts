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
    await assertShiftF10Works();
  });

  it("should support opening a RecordView context menu with keyboard", async function() {
    await gu.addNewSection("Card", "Table1");
    await assertShiftF10Works();
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
    assert.isTrue(await gu.findOpenMenu(200).isDisplayed());
    await gu.selectSectionByTitle("Table1");
    await gu.waitForMenuToClose();
  });
});

async function assertShiftF10Works() {
  await gu.waitAppFocus();
  await pressShiftF10();
  assert.isTrue(await gu.findOpenMenu().isDisplayed());
  await gu.sendKeys(Key.ESCAPE);
  await gu.waitForMenuToClose();
}

// Using gu.sendKeys doesn't work with Shift+F10 so we have to deal with the testing environment limitations.
async function pressShiftF10(inMenu: boolean = false) {
  return driver.find(inMenu ? ".grist-floating-menu" : ".copypaste").sendKeys(Key.chord(Key.SHIFT, Key.F10));
}
