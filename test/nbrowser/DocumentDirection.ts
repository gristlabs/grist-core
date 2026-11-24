import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

/**
 * A document has a language, the language of its locale, and a sheet that was given no
 * orientation is laid out in that language's direction. The interface has a language of its
 * own, and its direction stops at the edge of each widget.
 */
describe("DocumentDirection", function() {
  this.timeout("60s");
  const cleanup = setupTestSuite();
  let docId: string;
  let session: gu.Session;

  async function setLocale(locale: string) {
    const api = session.createHomeApi().getDocAPI(docId);
    const info = await api.getRows("_grist_DocInfo");
    const settings = JSON.parse(String(info.documentSettings[0] || "{}"));
    await api.applyUserActions([
      ["UpdateRecord", "_grist_DocInfo", 1, { documentSettings: JSON.stringify({ ...settings, locale }) }],
    ]);
    await gu.waitForServer();
  }

  // The direction a widget is laid out in, and the language it declares.
  async function widget(section: string): Promise<{ direction: string, lang: string | null }> {
    return await driver.executeScript((el: HTMLElement) => {
      const pane = el.querySelector(".view_data_pane_container > :not(.disable_viewpane):last-of-type") ||
        el.querySelector(".view_data_pane_container")!;
      return {
        direction: getComputedStyle(pane.querySelector(".gridview_data_pane, .detailview_scroll_pane") || pane)
          .direction,
        lang: el.querySelector(".view_data_pane_container")!.getAttribute("lang"),
      };
    }, await gu.getSection(section));
  }

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "DocumentDirection");
    await gu.sendActions([["AddRecord", "Table1", null, { A: "apples" }]]);
    await gu.addNewSection("Table", "Table1");
    await gu.renameActiveSection("Held");
    await gu.addNewSection("Card", "Table1");
    await gu.renameActiveSection("Card");
    await setLocale("en-US");
  });

  it("lays sheets out left-to-right in a document whose language is", async function() {
    assert.deepEqual(await widget("TABLE1"), { direction: "ltr", lang: "en-US" });
  });

  it("takes nothing from the direction of the interface", async function() {
    await driver.executeScript(() => document.documentElement.setAttribute("dir", "rtl"));
    try {
      assert.equal((await widget("TABLE1")).direction, "ltr");
      assert.equal((await widget("Held")).direction, "ltr");
      assert.equal((await widget("Card")).direction, "ltr");
    } finally {
      await driver.executeScript(() => document.documentElement.removeAttribute("dir"));
    }
  });

  it("lays undecided sheets out right-to-left in an Arabic document, at once", async function() {
    // One sheet is held left-to-right before the document changes language.
    await gu.selectSectionByTitle("Held");
    await gu.openWidgetPanel();
    await driver.find(".test-sheet-orientation .test-select-open").click();
    await (await gu.findOpenMenu(1000)).findContent("li", "Left to right").click();
    await gu.waitForServer();

    await setLocale("ar-SY");
    await gu.waitToPass(async () =>
      assert.deepEqual(await widget("TABLE1"), { direction: "rtl", lang: "ar-SY" }));
    // A sheet with an orientation of its own keeps it.
    assert.equal((await widget("Held")).direction, "ltr");
    // A card follows its document too.
    assert.deepEqual(await widget("Card"), { direction: "rtl", lang: "ar-SY" });
  });

  it("is the same after a reload, and under raw data", async function() {
    await gu.reloadDoc();
    assert.equal((await widget("TABLE1")).direction, "rtl");
    assert.equal((await widget("Held")).direction, "ltr");
    await driver.find(".test-tools-raw").click();
    await driver.findWait(".test-raw-data-list", 2000);
    await driver.findContent(".test-raw-data-table-title", "Table1").click();
    await gu.waitToPass(async () => assert.equal(
      await driver.find(".test-raw-data-overlay .gridview_data_pane").getCssValue("direction"), "rtl"));
    await gu.sendKeys(Key.ESCAPE);
    await driver.navigate().back();
    await gu.waitForDocToLoad();
  });

  it("says in the document's settings which way sheets go", async function() {
    await driver.find(".test-tools-settings").click();
    const note = await driver.findWait(".test-settings-locale-direction", 2000);
    assert.equal(await note.getText(), "Sheets are right-to-left unless set otherwise");
    await setLocale("fr-FR");
    await gu.waitToPass(async () =>
      assert.equal(await note.getText(), "Sheets are left-to-right unless set otherwise"));
    await driver.navigate().back();
    await gu.waitForDocToLoad();
    assert.deepEqual(await widget("TABLE1"), { direction: "ltr", lang: "fr-FR" });
  });
});
