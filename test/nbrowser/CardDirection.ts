import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, until, WebElement } from "mocha-webdriver";

/**
 * A card is laid out in the direction of its document's language, as a sheet is: its fields
 * start from the right in an Arabic document. The arrangement of the fields is edited by
 * dragging, and a field dropped at the left of another lands at its left either way.
 */
describe("CardDirection", function() {
  this.timeout("90s");
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

  // As in RecordLayout.ts: drags `elem` to an edge of the layout box containing `destElem`.
  async function dragInsertLayoutBox(
    elem: WebElement, destElem: WebElement, edge: "left" | "right", edgeOffset: number,
  ) {
    const box = await destElem.findClosest(".layout_box");
    await driver.wait(async () => await elem.isDisplayed() && await box.isDisplayed(), 1000);
    const size = await box.rect();
    const boxX = edge === "left" ? edgeOffset : size.width + edgeOffset;
    const body = await driver.find("body");
    const bodyRect = await body.rect();
    const offset = {
      x: Math.round(size.left + boxX - (bodyRect.left + bodyRect.width / 2)),
      y: Math.round(size.top + size.height / 2 - (bodyRect.top + bodyRect.height / 2)),
    };
    await elem.mouseMove();
    await driver.mouseDown();
    await body.mouseMove(offset);
    await driver.mouseUp();
    await driver.sleep(1000);
    await driver.wait(async () =>
      (await destElem.findClosest(".layout_root").getAttribute("data-useredit")) === "stop", 5000);
  }

  async function fieldRect(col: string) {
    return await gu.getDetailCell(col, 1).rect();
  }

  before(async function() {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, "CardDirection");
    await gu.sendActions([["AddRecord", "Table1", null, { A: "apples", B: "bananas", C: "cherries" }]]);
    await gu.addNewSection("Card", "Table1");
    await gu.renameActiveSection("Card");
  });

  for (const [locale, dir] of [["en-US", "ltr"], ["ar-SY", "rtl"]] as const) {
    describe(`in a ${dir} document`, function() {
      before(async function() {
        await setLocale(locale);
      });

      it("lays the card out in the document's direction", async function() {
        const cell = await gu.getDetailCell("A", 1);
        await gu.waitToPass(async () => assert.equal(await cell.getCssValue("direction"), dir));
        // The label of a field is at the edge where the card starts.
        const label = await cell.findClosest(".g_record_detail_el").find(".g_record_detail_label");
        const [cellRect, labelRect] = [await cell.rect(), await label.rect()];
        const fromStart = dir === "rtl" ?
          (cellRect.left + cellRect.width) - (labelRect.left + labelRect.width) : labelRect.left - cellRect.left;
        assert.isBelow(Math.abs(fromStart), 12);
      });

      it("drops a field on the side of another that it is dragged to", async function() {
        await gu.selectSectionByTitle("Card");
        await gu.openWidgetPanel();
        await driver.find(".test-vconfigtab-detail-edit-layout").click();
        const controls = await driver.findWait(".active_section .test-edit-layout-controls", 1000);
        // C starts below A; dragged to A's left edge, it ends beside it, at its left.
        assert.isAbove((await fieldRect("C")).top, (await fieldRect("A")).top);
        await dragInsertLayoutBox(gu.getDetailCell("C", 1), gu.getDetailCell("A", 1), "left", 2);
        await driver.wait(() => gu.getDetailCell("C", 1).isPresent(), 2000);
        const [a, c] = [await fieldRect("A"), await fieldRect("C")];
        assert.closeTo(c.top, a.top, 3);
        assert.isBelow(c.left, a.left);
        await controls.findContent("button", /Cancel/).click();
        await driver.wait(until.stalenessOf(controls), 2000);
      });
    });
  }
});
