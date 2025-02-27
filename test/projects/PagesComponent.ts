import { assert, driver, Key } from "mocha-webdriver";
import { server, setupTestSuite } from "./testUtils";

describe('PagesComponent', function() {
  setupTestSuite();
  this.timeout(10000);      // Set a longer default timeout.

  before(async function() {
    this.timeout(60000);      // Set a longer default timeout.
    await driver.get(`${server.getHost()}/PagesComponent`);
  });

  function findPage(name: RegExp) {
    return driver.findContent('.test-treeview-label', name);
  }

  async function beginRenaming(name: RegExp) {
    await findPage(name).mouseMove().find('.test-docpage-dots').click();
    await driver.find('.test-docpage-rename').doClick();
    // A textbox should open and get selected: wait for it, since it's not immediate, and
    // trying to type into it too soon may miss some initial characters.
    await driver.wait(() => driver.executeScript(
      () => ((document as any).activeElement.selectionStart != null)), 500);
  }

  it('should allow to manipulate text using mouse while renaming', async function() {
    // starts renaming Interactions
    await beginRenaming(/Interactions/);

    // click on the right part of the text input
    await driver.find('.test-docpage-editor').mouseMove({x: 100}).click();

    // enter 'Renamed'
    await driver.sendKeys('Renamed', Key.ENTER);

    // new name should be InteractionsRenamed
    assert.equal(await findPage(/Interactions/).find('.test-docpage-label').getText(), 'InteractionsRenamed');

    // rename to Interactions
    await beginRenaming(/Interactions/);
    await driver.sendKeys('Interactions', Key.ENTER);
    assert.equal(await findPage(/Interactions/).find('.test-docpage-label').getText(), 'Interactions');
  });

  it('clicking text input should not select page', async function() {
    // starts renaming People
    const page = driver.findContent('.test-treeview-label', /People/);
    await page.mouseMove().find('.test-docpage-dots').click();
    await driver.find('.test-docpage-rename').doClick();

    // click on the text input
    await driver.find('.test-docpage-editor').click();

    // abord rename
    await driver.sendKeys(Key.ESCAPE);

    // Interactions should be selected
    assert.equal(await driver.findContent('.test-treeview-itemHeader', /People/).matches('.selected'), false);
    assert.equal(await driver.findContent('.test-treeview-itemHeader', /Interactions/).matches('.selected'), true);
  });
});
