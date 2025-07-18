import {addToRepl, assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from './testUtils';


describe("Mentions", function() {
  setupTestSuite();
  addToRepl('getInput', getInput);
  addToRepl('getOutput', getOutput);
  addToRepl('click', click);
  addToRepl('type', type);
  addToRepl('clear', clear);
  addToRepl("Key", Key);
  this.timeout('30s');

  before(async function() {
    await driver.get(`${server.getHost()}/Mentions`);
    await getInput(10000);
  });

  afterEach(async function() {
    // Clear the input after each test to avoid interference.
    await click();
    await waitForFocus();
    await clear();
    // Ensure the output is also cleared.
    const output = await getOutput();
    assert.equal(await output.getText(), '');
  });

  it('has always focus', async function() {
    await waitForFocus();
    // Click away to ensure the input is focused.
    await driver.find('.test-away').click();
    await waitForFocus();
    // Click the input again to ensure it remains focused.
    await click();
    await waitForFocus();
    // Open the menu to ensure it doesn't lose focus.
    await type('@');
    await gu.findOpenMenu();
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();
    await waitForFocus();
  });

  it('works with plain text', async function() {
    const input = await getInput();
    await input.click();
    await input.sendKeys('Hello, this is a test.');
    const output = await getOutput();
    assert.strictEqual(await output.getText(), 'Hello, this is a test.');
    await clear();
    assert.strictEqual(await output.getText(), '');
  });

  it('works with mentions', async function() {
    await click();
    await type('Hello @');
    await gu.findOpenMenu();
    await type(Key.ARROW_DOWN);
    await type(Key.ENTER);
    await gu.waitForMenuToClose();
    const output = await getOutput();
    assert.strictEqual(await output.getText(), 'Hello [@Alice](user:alice)');
  });

  async function typeWithAccept(accept: () => Promise<void>) {
    await click();
    await type('Hello @');
    await gu.findOpenMenu();
    await type('Alice');
    await accept();
    await gu.waitForMenuToClose();
    const output = await getOutput();
    assert.strictEqual(await output.getText(), 'Hello [@Alice](user:alice)');
  }

  it('accepts by pressing enter', async function() {
    await typeWithAccept(async () => {
      await type(Key.ENTER);
    });
    await click(); // Click to ensure the input is focused again.
  });

  it('accepts by pressing tab', async function() {
    await typeWithAccept(async () => {
      await type(Key.TAB);
    });
    await click(); // Click to ensure the input is focused again.
  });

  it('accepts by clicking', async function() {
    await typeWithAccept(async () => {
      await clickItem('Alice');
    });
  });

  it('removes span by pressing backspace', async function() {
    await click();
    await type('Hello @Alice');
    await gu.findOpenMenu();
    await type(...Array.from('Alice').map(() => Key.BACK_SPACE));
    await type(Key.BACK_SPACE);
    await gu.waitForMenuToClose();
    const output = await getOutput();
    assert.strictEqual((await output.getText()).trim(), 'Hello');
  });

  it('deletes span by pressing backspace', async function() {
    await click();
    await type('Hello @Al');
    await gu.findOpenMenu();
    await type('ice');
    await type(Key.ENTER);
    await gu.waitForMenuToClose();

    // Sanity check for the output.
    const output = await getOutput();
    assert.strictEqual(await output.getText(), 'Hello [@Alice](user:alice)');
  });

  it('converts to plain text by clicking away', async function() {
    await click();
    await type('Hello @Alice');
    await gu.findOpenMenu();
    await driver.find('.test-away').click();
    await gu.waitForMenuToClose();
    const output = await getOutput();
    assert.strictEqual((await output.getText()).trim(), 'Hello @Alice');
  });

  it('converts to plain text by pressing escape', async function() {
    await click();
    await type('Hello @Alice');
    await gu.findOpenMenu();
    await type(Key.ESCAPE);
    await gu.waitForMenuToClose();
    const output = await getOutput();
    assert.strictEqual((await output.getText()).trim(), 'Hello @Alice');
  });

  it("doesn't show html tags in input", async function() {
    await driver.executeScript(() => {
      (window as any).initial.set('Hello <b>world</b>');
    });
    assert.isFalse(await getInput().find('b').isPresent());
    assert.equal(await getInput().getText(), 'Hello <b>world</b>');
  });

  it("parses user links in correct way", async function() {
    await driver.executeScript(() => {
      (window as any).initial.set('Hello [@Alice](user:alice)');
    });
    assert.isTrue(await getInput().find('.grist-mention').isDisplayed());
    assert.equal(await getInput().find('.grist-mention').getText(), '@Alice');
    assert.equal(await getInput().find('.grist-mention').getAttribute('data-userref'), 'alice');
    assert.equal(await getInput().find('.grist-mention').getAttribute('contenteditable'), 'false');
  });

  it('starts picker only once', async function() {
    await click();
    await type('Hello @');
    await gu.findOpenMenu();
    for (let i = 0; i < 10; i++) {
      await type('@');
    }
    await driver.sleep(100);
    // Count the number of open menus.
    const menus = await driver.findAll('.grist-floating-menu');
    assert.strictEqual(menus.length, 1, "Picker should only be opened once");
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();
  });

  it("trims spaces in markdown", async function() {
    await click();
    await type('  ');
    assert.equal(await getInput().getText(), '  ');
    assert.equal(await getOutput().getText(), '');
    await clear();

    await type('a  ');
    assert.equal(await getInput().getText(), 'a  ');
    assert.equal(await getOutput().getText(), 'a');
  });
});

async function click() {
  const input = await getInput();
  await input.click();
  assert.isTrue(await input.hasFocus(), "Input should be focused");
}

async function type(...keys: string[]) {
  await driver.sendKeys(...keys);
}

async function waitForFocus() {
  await gu.waitToPass(async () => {
    assert.isTrue(await driver.find('.test-input').hasFocus(), "Input should be focused");
  }, 100);
}

function getInput(ts = 1000) {
  return driver.findWait('.test-input', ts);
}

function getOutput() {
  return driver.find('.test-output');
}

function clickItem(item: string) {
  return driver.findContent('.test-mention-textbox-acitem-text', item).click();
}

async function clear() {
  await gu.clearInput();
}
