/**
 * Test for copying Grist data with headers.
 */

import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {createDummyTextArea, removeDummyTextArea} from 'test/nbrowser/CopyPaste';

describe("CopyWithHeaders", function() {
  this.timeout(90000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();
  afterEach(() => gu.checkForErrors());
  gu.bigScreen();

  after(async function() {
    await driver.executeScript(removeDummyTextArea);
  });

  it('should copy headers', async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');
    await driver.executeScript(createDummyTextArea);

    await clipboard.lockAndPerform(async (cb) => {
        // Select all
        await gu.sendKeys(Key.chord(Key.CONTROL, 'a'));
        await gu.rightClick(gu.getCell({rowNum: 1, col: 'A'}));
        await driver.findContent('.grist-floating-menu li', 'Copy with headers').click();

        await pasteAndCheck(cb, ["A", "B", "C", "D", "E"], 5);
    });

    await clipboard.lockAndPerform(async (cb) => {
        // Select a single cell.
        await gu.getCell({rowNum: 2, col: 'D'}).click();
        await gu.rightClick(gu.getCell({rowNum: 2, col: 'D'}));
        await driver.findContent('.grist-floating-menu li', 'Copy with headers').click();

        await pasteAndCheck(cb, ["D"], 2);
    });
  });
});

async function pasteAndCheck(cb: gu.IClipboard, headers: string[], rows: number) {
  // Paste into the dummy textarea.
  await driver.find('#dummyText').click();
  await gu.waitAppFocus(false);
  await cb.paste();

  const textarea = await driver.find('#dummyText');
  const text = await textarea.getAttribute('value');
  const lines = text.split('\n');
  const regex = new RegExp(`^${headers.join('\\s+')}$`);
  assert.match(lines[0], regex);
  assert.equal(lines.length, rows);
  await textarea.clear();
}
