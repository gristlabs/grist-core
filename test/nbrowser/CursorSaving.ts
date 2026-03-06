import * as gu from "test/nbrowser/gristUtils";
import { cleanupExtraWindows, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("CursorSaving", function() {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();
  afterEach(() => gu.checkForErrors());

  describe("WithRefLists", function() {
    before(async function() {
      const session = await gu.session().login();
      await session.tempDoc(cleanup, "CursorWithRefLists1.grist");
    });

    it("should remember positions when record is linked from multiple source records", async function() {
      // Select Tag 'a' (row 1), and Item 'Apples' (row 1), which has tags 'b' and 'a'.
      await clickAndCheck({ section: "Tags", rowNum: 1, col: 0 }, "a");
      await clickAndCheck({ section: "Items", rowNum: 1, col: 0 }, "Apple");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 1, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 1, col: 0 });
      assert.equal(await gu.getCardCell("Name", "Items Card").getText(), "Apple");

      // Now select a different Tag, but the same Item.
      await clickAndCheck({ section: "Tags", rowNum: 2, col: 0 }, "b");
      await clickAndCheck({ section: "Items", rowNum: 1, col: 0 }, "Apple");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 1, col: 0 });
      assert.equal(await gu.getCardCell("Name", "Items Card").getText(), "Apple");

      // Try the third section.
      await clickAndCheck({ section: "Items", rowNum: 3, col: 0 }, "Orange");
      await clickAndCheckCard({ section: "ITEMS Card", col: "Name", rowNum: 1 }, "Orange");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 3, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Name", "ITEMS Card").getText(), "Orange");

      // Try getting to the same card via different selections.
      await clickAndCheck({ section: "Tags", rowNum: 1, col: 0 }, "a");
      await clickAndCheck({ section: "Items", rowNum: 2, col: 0 }, "Orange");
      await clickAndCheckCard({ section: "ITEMS Card", col: "Name", rowNum: 1 }, "Orange");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 1, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 2, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Name", "ITEMS Card").getText(), "Orange");
    });

    it('should remember positions when "new" row is involved', async function() {
      // Try a position when when the parent record is on a "new" row.
      await clickAndCheck({ section: "Tags", rowNum: 2, col: 0 }, "b");
      await clickAndCheck({ section: "Items", rowNum: 4, col: 0 }, "");
      await clickAndCheckCard({ section: "ITEMS Card", col: "Tags", rowNum: 1 }, "");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 4, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Tags", "ITEMS Card").getText(), "");

      // Try a position when when the grandparent parent record is on a "new" row.
      await clickAndCheck({ section: "Tags", rowNum: 5, col: 0 }, "");
      assert.match(await gu.getSection("Items").find(".disable_viewpane").getText(), /No row selected/);
      await clickAndCheckCard({ section: "ITEMS Card", col: "Tags", rowNum: 1 }, "");

      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 5, col: 0 });
      assert.match(await gu.getSection("Items").find(".disable_viewpane").getText(), /No row selected/);
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Tags", "ITEMS Card").getText(), "");
    });

    it("should create anchor links that preserve row positions in linking sources", async function() {
      await clickAndCheck({ section: "Tags", rowNum: 1, col: 0 }, "a");
      await clickAndCheck({ section: "Items", rowNum: 1, col: 0 }, "Apple");
      await gu.openRowMenu(1);

      const anchorLinks: string[] = [];
      anchorLinks.push(await getAnchorLink());

      // Now select a different Tag, but the same Item.
      await clickAndCheck({ section: "Tags", rowNum: 2, col: 0 }, "b");
      await clickAndCheck({ section: "Items", rowNum: 1, col: 0 }, "Apple");
      anchorLinks.push(await getDifferentAnchorLink(anchorLinks.at(-1)));

      // Try the third section.
      await clickAndCheck({ section: "Items", rowNum: 3, col: 0 }, "Orange");
      await clickAndCheckCard({ section: "ITEMS Card", col: "Name", rowNum: 1 }, "Orange");
      anchorLinks.push(await getDifferentAnchorLink(anchorLinks.at(-1)));

      // A different way to get to the same value in third section.
      await clickAndCheck({ section: "Tags", rowNum: 1, col: 0 }, "a");
      await clickAndCheck({ section: "Items", rowNum: 2, col: 0 }, "Orange");
      await gu.getCardCell("Name", "ITEMS Card").click();
      anchorLinks.push(await getDifferentAnchorLink(anchorLinks.at(-1)));

      // Now go through the anchor links, and make sure each gets us to the expected point.
      await navigateToAnchor(anchorLinks[0]);
      // It can take a small amount of time for the cursor positions to update
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 1, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 1, col: 0 });
      assert.equal(await gu.getCardCell("Name", "Items Card").getText(), "Apple");

      await navigateToAnchor(anchorLinks[1]);
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 1, col: 0 });
      assert.equal(await gu.getCardCell("Name", "Items Card").getText(), "Apple");

      await navigateToAnchor(anchorLinks[2]);
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 3, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Name", "ITEMS Card").getText(), "Orange");

      await navigateToAnchor(anchorLinks[3]);
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 1, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 2, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Name", "ITEMS Card").getText(), "Orange");
    });

    it('should handle anchor links when "new" row is involved', async function() {
      const anchorLinks: string[] = [];

      // Try a position when when the parent record is on a "new" row.
      await clickAndCheck({ section: "Tags", rowNum: 2, col: 0 }, "b");
      await clickAndCheck({ section: "Items", rowNum: 4, col: 0 }, "");
      await clickAndCheckCard({ section: "ITEMS Card", col: "Tags", rowNum: 1 }, "");
      anchorLinks.push(await getDifferentAnchorLink(""));

      // Try a position when when the grandparent parent record is on a "new" row.
      await clickAndCheck({ section: "Tags", rowNum: 5, col: 0 }, "");
      assert.match(await gu.getSection("Items").find(".disable_viewpane").getText(), /No row selected/);
      await clickAndCheckCard({ section: "ITEMS Card", col: "Tags", rowNum: 1 }, "");

      anchorLinks.push(await getDifferentAnchorLink(anchorLinks.at(-1)));

      await navigateToAnchor(anchorLinks[0]);
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("Items"), { rowNum: 4, col: 0 });
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Tags", "ITEMS Card").getText(), "");

      await navigateToAnchor(anchorLinks[1]);
      assert.deepEqual(await gu.getCursorPosition("Tags"), { rowNum: 5, col: 0 });
      assert.match(await gu.getSection("Items").find(".disable_viewpane").getText(), /No row selected/);
      assert.equal(await gu.getActiveSectionTitle(), "ITEMS Card");
      assert.equal(await gu.getCardCell("Tags", "ITEMS Card").getText(), "");
    });
  });

  describe("WithRefs", function() {
    // This is a similar test to the above, but without RefLists. In particular it checks that
    // when a cursor is in the "new" row, enough is remembered to restore positions.

    before(async function() {
      const session = await gu.session().login();
      const doc = await session.tempDoc(cleanup, "World.grist", { load: false });
      await session.loadDoc(`/doc/${doc.id}/p/5`, { wait: true });
    });

    it("should remember row positions in linked sections", async function() {
      // Select a country and a city within it.
      await clickAndCheck({ section: "Country", rowNum: 2, col: 0 }, "AFG");
      await clickAndCheck({ section: "City", rowNum: 4, col: 1 }, "Balkh");
      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Country"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("City"), { rowNum: 4, col: 1 });

      // Now select a country, and the "new" row in the linked City widget.
      await clickAndCheck({ section: "Country", rowNum: 3, col: 0 }, "AGO");
      await clickAndCheck({ section: "City", rowNum: 6, col: 1 }, "");
      await gu.reloadDoc();
      assert.deepEqual(await gu.getCursorPosition("Country"), { rowNum: 3, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("City"), { rowNum: 6, col: 1 });
    });

    it("should create anchor links that preserve row positions in linked sections", async function() {
      const anchorLinks: string[] = [];

      // Select a country and a city within it.
      await clickAndCheck({ section: "Country", rowNum: 2, col: 0 }, "AFG");
      await clickAndCheck({ section: "City", rowNum: 4, col: 1 }, "Balkh");
      anchorLinks.push(await getAnchorLink());

      // Now select a country, and the "new" row in the linked City widget.
      await clickAndCheck({ section: "Country", rowNum: 3, col: 0 }, "AGO");
      await clickAndCheck({ section: "City", rowNum: 6, col: 1 }, "");

      anchorLinks.push(await getDifferentAnchorLink(anchorLinks.at(-1)));

      await navigateToAnchor(anchorLinks[0]);
      assert.deepEqual(await gu.getCursorPosition("Country"), { rowNum: 2, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("City"), { rowNum: 4, col: 1 });

      await navigateToAnchor(anchorLinks[1]);
      assert.deepEqual(await gu.getCursorPosition("Country"), { rowNum: 3, col: 0 });
      assert.deepEqual(await gu.getCursorPosition("City"), { rowNum: 6, col: 1 });
    });
  });

  async function getAnchorLink() {
    let anchor: string = "";
    await clipboard.lockAndPerform(async () => { anchor = await gu.getAnchor(); });
    return anchor;
  }

  async function getDifferentAnchorLink(oldAnchorLink?: string) {
    let anchor: string = "";
    await gu.waitToPass(async () => {
      anchor = await getAnchorLink();
      assert.notEqual(anchor, oldAnchorLink);
    });
    return anchor;
  }
});

async function navigateToAnchor(anchorLink: string) {
  await gu.clearTestState();
  await driver.get(anchorLink);
  await gu.waitForAnchor();
}

async function clickAndCheck(options: gu.ICellSelect, expectedValue: string) {
  const cell = gu.getCell(options);
  await cell.click();
  assert.equal(await cell.getText(), expectedValue);
}

async function clickAndCheckCard(options: gu.ICellSelect, expectedValue: string) {
  const cell = gu.getDetailCell(options);
  await cell.click();
  assert.equal(await cell.getText(), expectedValue);
}
