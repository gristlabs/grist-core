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

    // Check that the search without diacritics ("Quebec") matches a value that contains one ("Québec").
    await gu.search("Quebec");
    
    // Check that Québec is found.
    assert.deepEqual(await gu.getCursorPosition(), { rowNum: 1155, col: 2 });
    assert.include(await gu.getActiveCell().getText(), "Québec");
  });
});
