import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver, Key } from "mocha-webdriver";

describe("Search2", async function() {
  this.timeout(20000);
  setupTestSuite();
  gu.bigScreen();
  let closedSize: ClientRect;
  const waitForClose = async () => {
    await driver.wait(async () => {
      const currentSize = await driver.find(".test-tb-search-wrapper").rect();
      return currentSize.width === closedSize.width;
    });
  };

  before(async function() {
    // Log in and open the doc 'World'.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await gu.importFixturesDoc("chimpy", "nasa", "Horizon", "World.grist");
    await gu.waitForDocToLoad();
    closedSize = await driver.find(".test-tb-search-wrapper").rect();
  });

  it("should handle sending Cmd+f repeatedly", async () => {
    await gu.getPageItem(/City/).click();
    await gu.waitForServer();

    // open search
    await driver.find(".test-tb-search-icon").doClick();
    await driver.sleep(500);

    // click multiPage options
    await driver.find(".test-tb-search-option-all-pages").click();

    // type in 'gorane'
    await driver.find(".test-tb-search-input").doClick();
    await driver.sendKeys("gorane");

    // repeteadly send Cmd+G
    for (let i = 0; i < 10; ++i) {
      await driver.find("body").sendKeys(Key.chord(await gu.modKey(), "g"));
    }

    // unclick multiPage options
    await driver.find(".test-tb-search-icon").doClick();
    await driver.sleep(500);
    await driver.find(".test-tb-search-option-all-pages").click();
    await driver.sendKeys(Key.ESCAPE);
    await waitForClose();

    // check for any js errors
    await gu.checkForErrors();
  });

  it("should update linked sections", async () => {
    // Link City sections
    await gu.getPageItem(/City/).click();
    await gu.waitForServer();
    await gu.getSection("CITY Card List").click();
    await gu.toggleSidePanel("right", "open");
    await driver.findContent(".test-right-panel button", /Change widget/).click();
    await driver.find(".test-wselect-selectby").doClick();
    await driver.findContent(".test-wselect-selectby option", /CITY/).doClick();
    await driver.find(".test-wselect-addBtn").doClick();
    await gu.waitForServer();
    await gu.getSection("CITY").click();
    await gu.getCell("Name", 1).click();

    // Search for "CHN"
    await gu.search("CHN");

    // Leave search
    await driver.sendKeys(Key.ESCAPE);
    await waitForClose();

    // Make sure linked sections ended up where we'd expect, and consistent
    await gu.selectSectionByTitle("CITY Card List");
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 4, col: "Country" });
    await gu.selectSectionByTitle("CITY");
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 3293, col: 0 });
  });

  it("should scroll to the active element", async () => {
    await gu.getPageItem(/Country/).click();
    await gu.waitForServer();
    // Select a first row
    await gu.getCell(0, 1).click();
    const test = async (rowCount: number) => {
      // Scroll
      await gu.scrollActiveView(0, 22 * rowCount); // 22 is a row height
      // Search for Aruba.
      await gu.search("Aruba");
      // Leave search
      await driver.sendKeys(Key.ESCAPE);
      await waitForClose();
      // First row should be scrolled into, and we should be able to click it.
      await gu.getCell(0, 1).click();
      // check for any js errors
      await gu.checkForErrors();
    };
    // Scroll 2 rows, to hide the first row with Aruba.
    // By scrolling only two rows, the active row is still rendered.
    await test(2);
    // Now scroll 100 rows, which removes the active record from the dom (replaces it with another).
    await test(100);
  });
});
