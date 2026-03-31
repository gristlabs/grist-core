import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { addToRepl, assert, driver, Key } from "mocha-webdriver";

describe("Search4", function() {
  this.timeout("25s");
  setupTestSuite();
  addToRepl("gu.searchIsOpened", gu.searchIsOpened);
  gu.bigScreen("big");

  it("should support accent-insensitive search", async function() {
    // Log in and open the doc 'World'.
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await gu.importFixturesDoc("chimpy", "nasa", "Horizon", "World.grist");

    // Open the search input and enter a search term.
    await gu.search("Què");

    // Check that Albequerque is found.
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 103, col: 0 });
    assert.include(await gu.getActiveCell().getText(), "Albuquerque");

    // Search forward.
    await gu.searchNext();
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 382, col: 1 });
    assert.include(await gu.getActiveCell().getText(), "Mozambique");

    // Typing more characters searches incrementally.
    await driver.sendKeys("tz");    // The search term is now "Quètz".
    // Sleep for search debounce time
    await driver.sleep(120);

    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2922, col: 0 });
    assert.include(await gu.getActiveCell().getText(), "Quetzaltenango");

    // Search forward by clicking
    await gu.searchNext();
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2922, col: 2 });
    assert.include(await gu.getActiveCell().getText(), "Quetzaltenango");

    // Search backward by clicking
    await gu.searchPrev();
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2922, col: 0 });
    assert.include(await gu.getActiveCell().getText(), "Quetzaltenango");

    // Search forward with keyboard
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 2922, col: 2 });

	// Add more letters with accents and case
	await driver.sendKeys("ÀlTénängô"); // The search term is now "QuètzÀlTénängô"
    await driver.sleep(120);
    assert.include(await gu.getActiveCell().getText(), "Quetzaltenango");
  });
});
