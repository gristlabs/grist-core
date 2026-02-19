import * as gu from "test/nbrowser/gristUtils";
import { cleanupExtraWindows, setupTestSuite } from "test/nbrowser/testUtils";

import { identity } from "lodash";
import { assert, driver, Key, WebElement } from "mocha-webdriver";

const EMPTY_MARK = "\u2205";

describe("Comparison", function() {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();

  it("can access comparison details", async function() {
    // Create a document owned by default user.
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist", { load: false });

    // Check that comparing document with itself results in 'same.'
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${doc.id}`);
    await gu.waitToPass(async () => {
      assert.equal((await gu.getComparison())?.summary, "same");
    }, 3000);

    // Make a fork of the document with a change.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await gu.getCell({ rowNum: 1, col: 0 }).click();
    await gu.enterCell("123");
    await gu.waitForServer();
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "123");
    const forkId = await gu.getCurrentUrlId();

    // Check that comparing original with changed doc results in a difference.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`, { skipAlert: true });
    const comp = await gu.getComparison();
    assert.equal(comp?.summary, "right");
    assert.deepEqual(comp?.details?.rightChanges, {
      tableDeltas: {
        Table1: {
          addRows: [],
          removeRows: [],
          updateRows: [1],
          columnDeltas: {
            A: {
              [1]: [["hello"], ["123"]],
            },
            E: {
              [1]: [["HELLO"], ["123"]],
            },
          },
          columnRenames: [],
        },
      },
      tableRenames: [],
    });

    // Check that the one change we made is rendered sensibly.
    const cell = await gu.getCell(0, 1);
    assert.equal(await cell.getText(), "hello123");
    assert.equal(await cell.find(".diff-remote").getText(), "123");
    assert.equal(await cell.find(".diff-parent").getText(), "hello");
    assert.equal(await cell.find(".diff-local").isPresent(), false);

    // Check that context menu works.
    await gu.rightClick(cell);
    await gu.checkForErrors();
    await gu.sendKeys(Key.ESCAPE);
  });

  it("can render changes in remote doc", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "Favorite_Films.grist", { load: false });

    // Make a fork of the document with several changes.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Change a cell
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("800");
    await gu.waitForServer();

    // Remove a row
    await gu.removeRow(4);

    // Add a row
    await (await gu.openRowMenu(5)).findContent("li", /Insert row above/).click();
    await gu.waitForServer();
    await gu.enterCell("Unicorny");
    await gu.waitForServer();

    const forkId = await gu.getCurrentUrlId();

    // Check that comparing original with changed doc results in a difference.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`, { skipAlert: true });

    let cell = await gu.getCell({ rowNum: 1, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "30.0");
    assert.equal(await cell.find(".diff-remote").getText(), "800.0");
    assert.equal(await cell.find(".diff-local").isPresent(), false);

    assert.match(await driver.find(".record.diff-remote-remove").getText(), /Avatar/);

    assert.match(await driver.find(".record.diff-remote-add").getText(), /Unicorny/);

    // Now change some references.
    await mainSession.loadDoc(`/doc/${forkId}`);
    await gu.getPageItem("Performances").click();
    await gu.getCell({ rowNum: 1, col: "Film" }).click();
    await gu.enterCell("The Avengers");
    await gu.waitForServer();
    await gu.getCell({ rowNum: 2, col: "Film" }).click();
    await gu.enterCell("Unicorny");
    await gu.waitForServer();

    // Check that reference changes are visible, including one as an effect of
    // a removed row.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`, { skipAlert: true });
    await gu.getPageItem("Performances").click();
    cell = gu.getCell({ rowNum: 1, col: "Film" });
    assert.equal(await cell.find(".diff-remote").getText(), "The Avengers");
    assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
    assert.equal(await cell.find(".diff-local").isPresent(), false);
    cell = gu.getCell({ rowNum: 2, col: "Film" });
    assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
    assert.equal(await cell.find(".diff-remote").getText(), "Unicorny");
    assert.equal(await cell.find(".diff-local").isPresent(), false);
    cell = gu.getCell({ rowNum: 7, col: "Film" });
    assert.equal(await cell.find(".diff-parent").getText(), "Avatar");
    assert.equal(await cell.find(".diff-remote").getText(), EMPTY_MARK);
    assert.equal(await cell.find(".diff-local").isPresent(), false);
  });

  describe("mixed local and remote changes", function() {
    let mainSession: gu.Session;
    let comparisonPath: string;

    it("can render changes in table view", async function() {
      mainSession = await gu.session().teamSite.login();
      const doc = await mainSession.tempDoc(cleanup, "Favorite_Films.grist", { load: false });

      // Make a fork of the document with several changes.
      await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

      // Change a cell
      await gu.getCell({ rowNum: 1, col: 1 }).click();
      await gu.enterCell("800");
      await gu.waitForServer();

      // Remove a row
      await gu.removeRow(4);

      // Add a row
      await (await gu.openRowMenu(5)).findContent("li", /Insert row above/).click();
      await gu.waitForServer();
      await gu.enterCell("Unicorny");
      await gu.waitForServer();

      // Now change some references.
      await gu.getPageItem("Performances").click();
      await gu.getCell({ rowNum: 1, col: "Film" }).click();
      await gu.enterCell("The Avengers");
      await gu.waitForServer();
      await gu.getCell({ rowNum: 2, col: "Film" }).click();
      await gu.enterCell("Unicorny");
      await gu.waitForServer();

      const forkId = await gu.getCurrentUrlId();

      // Now return to original and make some changes there too.
      await mainSession.loadDoc(`/doc/${doc.id}`, { skipAlert: true });

      // Change a cell
      await gu.getCell({ rowNum: 2, col: 1 }).click();
      await gu.enterCell("400");
      await gu.waitForServer();

      // Remove a row
      await gu.removeRow(3);

      // Add a row
      await (await gu.openRowMenu(2)).findContent("li", /Insert row above/).click();
      await gu.waitForServer();
      await gu.enterCell("Pegasusy");
      await gu.waitForServer();

      // Now change some references.
      await gu.getPageItem("Performances").click();
      await gu.getCell({ rowNum: 4, col: "Film" }).click();
      await gu.enterCell("Pegasusy");
      await gu.waitForServer();
      await gu.removeRow(3);
      await (await gu.openRowMenu(10)).findContent("li", /Insert row above/).click();
      await gu.waitForServer();
      await gu.getCell({ rowNum: 10, col: "Film" }).click();
      await gu.enterCell("The Dark Knight");
      await gu.waitForServer();

      // Check that comparing original with changed doc results in a difference.
      comparisonPath = `/doc/${doc.id}?compare=${forkId}`;
      await mainSession.loadDoc(comparisonPath);

      let cell = await gu.getCell({ rowNum: 1, col: 1 });
      assert.equal(await cell.find(".diff-parent").getText(), "30.0");
      assert.equal(await cell.find(".diff-remote").getText(), "800.0");
      assert.equal(await cell.find(".diff-local").isPresent(), false);

      cell = await gu.getCell({ rowNum: 3, col: 1 });
      assert.equal(await cell.find(".diff-parent").getText(), "55.0");
      assert.equal(await cell.find(".diff-local").getText(), "400.0");
      assert.equal(await cell.find(".diff-remote").isPresent(), false);

      assert.match(await driver.find(".record.diff-local-add").getText(), /Pegasusy/);
      assert.match(await driver.find(".record.diff-remote-add").getText(), /Unicorny/);
      assert.match(await driver.find(".record.diff-remote-remove").getText(), /Avatar/);
      assert.match(await driver.find(".record.diff-local-remove").getText(), /Alien/);

      // Check that reference changes are visible, including one as an effect of
      // a removed row.
      await gu.getPageItem("Performances").click();
      cell = gu.getCell({ rowNum: 1, col: "Film" });
      assert.equal(await cell.find(".diff-remote").getText(), "The Avengers");
      assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
      assert.equal(await cell.find(".diff-local").isPresent(), false);
      cell = gu.getCell({ rowNum: 2, col: "Film" });
      assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
      assert.equal(await cell.find(".diff-remote").getText(), "Unicorny");
      assert.equal(await cell.find(".diff-local").isPresent(), false);
      cell = gu.getCell({ rowNum: 4, col: "Film" });
      assert.equal(await cell.find(".diff-parent").getText(), "Forrest Gump");
      assert.equal(await cell.find(".diff-local").getText(), "Pegasusy");
      assert.equal(await cell.find(".diff-remote").isPresent(), false);
      cell = gu.getCell({ rowNum: 6, col: "Film" });
      assert.equal(await cell.find(".diff-parent").getText(), "Alien");
      assert.equal(await cell.find(".diff-local").getText(), EMPTY_MARK);
      assert.equal(await cell.find(".diff-remote").isPresent(), false);
      cell = gu.getCell({ rowNum: 7, col: "Film" });
      assert.equal(await cell.find(".diff-parent").getText(), "Avatar");
      assert.equal(await cell.find(".diff-remote").getText(), EMPTY_MARK);
      assert.equal(await cell.find(".diff-local").isPresent(), false);
      assert.match(await driver.find(".record.diff-local-remove").getText(), /Don Rickles/);
      assert.match(await driver.find(".record.diff-local-add").getText(), /The Dark Knight/);
    });

    it("can render changes in card view", async function() {
      // Card view should work like table view for cells, and have record removal/addition
      // styling applied to full card.

      // Open a card view.
      await mainSession.loadDoc(comparisonPath);
      await gu.getPageItem("All").click();
      const section = "Performances detail";
      await gu.getSection(section).click();

      // Check that regular cells and diff cells are present as expected.
      assert.deepEqual(await gu.getVisibleDetailCells({ col: "Actor", rowNums: [1], section }), ["Tom Hanks"]);
      const cell = (await gu.getVisibleDetailCells<WebElement>({
        col: "Film", rowNums: [1], mapper: identity, section,
      }))[0];
      assert.equal(await cell.find(".diff-remote").getText(), "The Avengers");
      assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
      assert.equal(await cell.find(".diff-local").isPresent(), false);

      // Check that a locally-deleted record has expected styling.
      const sectionEl = await driver.find(".active_section");
      await sectionEl.find(".grist-single-record__menu .detail-right").click();
      await sectionEl.find(".grist-single-record__menu .detail-right").click();
      assert.deepEqual(await gu.getVisibleDetailCells({ col: "Actor", rowNums: [1] }), ["Don Rickles"]);
      assert.match(await sectionEl.find(".g_record_detail.diff-local-remove").getText(), /Don Rickles/);
    });

    it("can render changes in card list view", async function() {
      // Card view should work like table view for cells, and have record removal/addition
      // styling applied to individual cards.

      await mainSession.loadDoc(comparisonPath);
      await gu.getPageItem("All").click();

      // Delete existing card view, to avoid accidentally ambiguous tests passing.
      await gu.openSectionMenu("viewLayout", "Performances detail");
      await driver.findWait(".test-section-delete", 500).click();
      await gu.waitForServer();

      // Add a card list view.
      await gu.addNewSection(/List/, /Performances/);
      const section = gu.getSection("PERFORMANCES Card List");
      await section.click();

      // Check that regular cells and diff cells are present as expected.
      assert.deepEqual(await gu.getVisibleDetailCells({ col: "Actor", rowNums: [1, 3], section }),
        ["Tom Hanks", "Don Rickles"]);
      const cell = (await gu.getVisibleDetailCells<WebElement>({
        col: "Film", rowNums: [1], mapper: identity, section,
      }))[0];
      assert.equal(await cell.find(".diff-remote").getText(), "The Avengers");
      assert.equal(await cell.find(".diff-parent").getText(), "Toy Story");
      assert.equal(await cell.find(".diff-local").isPresent(), false);

      // Check that a locally-deleted record has expected styling.
      assert.equal(await section.find(".g_record_detail.diff-local-remove").getText(),
        ["3", "Actor", "Don Rickles", "Film", "Toy Story", "Character", "Mr. Potato Head"].join("\n"));

      // Check that context menu works.
      await gu.rightClick(cell);
      await gu.checkForErrors();
      await gu.sendKeys(Key.ESCAPE);
    });
  });

  it("can render cell-level conflicts", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist");

    // Set some cells.
    for (let rowNum = 1; rowNum <= 4; rowNum++) {
      await gu.getCell({ rowNum, col: 1 }).click();
      await gu.enterCell("V0");
    }
    await gu.waitForServer();

    // Make a fork of the document.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Change two of the cells.
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("V1");
    await gu.getCell({ rowNum: 2, col: 1 }).click();
    await gu.enterCell("V1");
    await gu.waitForServer();

    // Change two cells in trunk.
    const forkId = await gu.getCurrentUrlId();
    await mainSession.loadDoc(`/doc/${doc.id}`, { skipAlert: true });
    await gu.getCell({ rowNum: 2, col: 1 }).click();
    await gu.enterCell("V2");
    await gu.getCell({ rowNum: 3, col: 1 }).click();
    await gu.enterCell("V2");
    await gu.waitForServer();

    // Load comparison, and sanity-check it.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`);

    let cell = await gu.getCell({ rowNum: 1, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "V0");
    assert.equal(await cell.find(".diff-remote").getText(), "V1");
    assert.equal(await cell.find(".diff-local").isPresent(), false);

    cell = await gu.getCell({ rowNum: 2, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "V0");
    assert.equal(await cell.find(".diff-remote").getText(), "V1");
    assert.equal(await cell.find(".diff-local").getText(), "V2");

    cell = await gu.getCell({ rowNum: 3, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "V0");
    assert.equal(await cell.find(".diff-remote").isPresent(), false);
    assert.equal(await cell.find(".diff-local").getText(), "V2");

    cell = await gu.getCell({ rowNum: 4, col: 1 });
    assert.equal(await cell.find(".diff-parent").isPresent(), false);
    assert.equal(await cell.find(".diff-remote").isPresent(), false);
    assert.equal(await cell.find(".diff-local").isPresent(), false);
  });

  it("can distill long changes", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist");

    // Set a cell to some text.
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("This is some cell content");
    await gu.waitForServer();

    // Wrap text to make it all visible.
    await gu.toggleSidePanel("right", "open");
    await driver.find(".test-right-tab-field").click();
    await driver.find(".test-tb-wrap-text").click();
    await gu.waitForServer();

    // Make a fork of the document.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Change cell a bit more.
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("This is some cell content!");
    await gu.waitForServer();

    const forkId = await gu.getCurrentUrlId();

    // Check that comparing original with changed doc results in a difference.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`, { skipAlert: true });

    const cell = await gu.getCell({ rowNum: 1, col: 1 });
    assert.equal(await cell.find(".diff-common").getText(), "This is some cell content");
    assert.equal(await cell.find(".diff-remote").getText(), "!");
    assert.equal(await cell.find(".diff-local").isPresent(), false);
  });

  it("can tolerate table renames", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "Hello.grist");

    // Set a cell to some text.
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("test1");
    await gu.waitForServer();

    // Make a fork of the document.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Change cell a bit more.
    await gu.getCell({ rowNum: 1, col: 1 }).click();
    await gu.enterCell("test2");
    await gu.waitForServer();

    // And rename the table.
    await gu.renamePage(/Table1/, "Zap");

    const forkId = await gu.getCurrentUrlId();

    // Check that comparing original with changed doc results in a difference.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`, { skipAlert: true });
    let cell = await gu.getCell({ rowNum: 1, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "test1");
    assert.equal(await cell.find(".diff-remote").getText(), "test2");

    // Return to trunk, and rename table there too.
    await mainSession.loadDoc(`/doc/${doc.id}`);
    await gu.renamePage(/Table1/, "Zip");

    // Check that cell difference is still recognized.
    await mainSession.loadDoc(`/doc/${doc.id}?compare=${forkId}`);
    cell = await gu.getCell({ rowNum: 1, col: 1 });
    assert.equal(await cell.find(".diff-parent").getText(), "test1");
    assert.equal(await cell.find(".diff-remote").getText(), "test2");
  });

  it("can show a change among many rows", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "World.grist", { load: false });

    // Make a fork of the document.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Pick cell with "Dublin" in it, replace it with Irish version
    // of name.
    await gu.search("Dublin");
    await gu.waitToPass(async () => assert.equal(await driver.find(".field_clip.has_cursor").getText(), "Dublin"));
    await driver.sendKeys(Key.ESCAPE);
    await driver.sleep(500);
    await gu.enterCell("Baile Átha Cliath");
    await gu.waitForServer();

    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-compare-original", 5000).click();

    // Switch to the new tab, and wait for the doc to load.
    const windowHandles = await driver.getAllWindowHandles();
    await gu.switchToWindow(windowHandles[1]);
    await gu.waitForDocToLoad();

    assert.deepEqual(
      await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), [
        "[San Cristóbal de] la Laguna",   // first row retained
        "´s-Hertogenbosch",               // context row 1
        "A Coruña (La Coruña)",           // context row 2
        "...",                     // ... skip ...
        "Drobeta-Turnu Severin",   // context row -2
        "Dubai",                   // context row -1
        "DublinBaile Átha Cliath", // diff
        "Dudley",                  // context row 1
        "Duisburg",                // context row 2
        "...",                     // ... skip ...
        "Zwolle",                  // context row -2
        "Zytomyr",                 // context row -1
        "",                        // last row retained ('new' row in this case)
        undefined,                  // past end of rows
      ]);

    // Close the new tab and switch back to the original one.
    await driver.close();
    await driver.switchTo().window(windowHandles[0]);
  });

  // checks for a specific bug we used to have.
  it("can show an isolated row removal", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "World.grist", { load: false });

    // Make a fork of the document.
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);

    // Delete a row.
    await gu.removeRow(9);

    // Request comparison.
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-compare-original", 5000).click();

    // Switch to the new tab, and wait for the doc to load.
    await gu.waitToPass(async () => {
      assert.lengthOf(await driver.getAllWindowHandles(), 2);
    });
    const windowHandles = await driver.getAllWindowHandles();
    await gu.switchToWindow(windowHandles[1]);
    await gu.waitForDocToLoad();

    // Check comparison includes missing row.
    assert.deepEqual(
      await gu.getVisibleGridCells(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), [
        "[San Cristóbal de] la Laguna",   // first row retained
        "´s-Hertogenbosch",               // context row 1
        "A Coruña (La Coruña)",           // context row 2
        "...",                     // ... skip ...
        "Abadan",                  // context row -2
        "Abaetetuba",              // context row -1
        "Abakan",                  // diff
        "Abbotsford",              // context row 1
        "Abeokuta",                // context row 2
        "...",                     // ... skip ...
        "Zwolle",                  // context row -2
        "Zytomyr",                 // context row -1
        "",                        // last row retained ('new' row in this case)
        undefined,                  // past end of rows
      ]);

    // Now remove a row from the original document, and reload comparision.
    const api = mainSession.createHomeApi();
    await api.getDocAPI(doc.id).removeRows("City", [20]);
    await driver.executeScript("window.location.reload()");
    await gu.waitForDocToLoad();

    // Spot check that both removed rows are present in the diff.
    assert.deepEqual(
      await gu.getVisibleGridCells(0, [8, 2]),
      ["Abakan", "´s-Hertogenbosch"]);

    // Close the new tab and switch back to the original one.
    await driver.close();
    await driver.switchTo().window(windowHandles[0]);
  });

  it("disables selection summary", async function() {
    const mainSession = await gu.session().teamSite.login();
    const doc = await mainSession.tempDoc(cleanup, "World.grist", { load: false });
    await mainSession.loadDoc(`/doc/${doc.id}/m/fork`);
    await gu.removeRow(9);
    await driver.find(".test-tb-share").click();
    await driver.findWait(".test-compare-original", 5000).click();
    await gu.waitToPass(async () => {
      assert.lengthOf(await driver.getAllWindowHandles(), 2);
    });
    const windowHandles = await driver.getAllWindowHandles();
    await gu.switchToWindow(windowHandles[1]);
    await gu.waitForDocToLoad();
    await gu.getCell(0, 1).click();
    await gu.sendKeys(Key.chord(Key.SHIFT, Key.ARROW_RIGHT));
    assert.isFalse(await driver.find(".test-selection-summary-count").isPresent());
    await gu.checkForErrors();
    await driver.close();
    await driver.switchTo().window(windowHandles[0]);
  });
});
