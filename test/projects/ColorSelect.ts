import { swatches } from 'app/client/ui2018/ColorPalette';
import { addToRepl, assert, driver, Key, stackWrapFunc, WebElement } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { server, setupTestSuite } from './testUtils';

const black = '#000000';
const white = '#FFFFFF';
const pink = '#FF00FF';
const red  = '#FF0000';

const bold = 1 << 3;
const underline = 1 << 2;
const italic = 1 << 1;
const strike = 1;

const rgbToHex = (color: string) => gu.rgbToHex(color).toUpperCase();

describe("ColorSelect", function() {
  setupTestSuite();
  addToRepl('setColor', setColor);
  addToRepl('rgbToHex', rgbToHex);
  this.timeout(20000);

  before(async function() {
    this.timeout(60000);
    await driver.get(`${server.getHost()}/ColorSelect`);
  });

  beforeEach(async function() {
    await driver.find('.test-reset').click();
  });


  const checkSelectedColor = stackWrapFunc(async function(fill: string|null, text: string|null) {

    // check Text selected color
    assert.deepEqual(await driver.findAll('.test-text-palette [class*=-selected]', async (e) => (
      rgbToHex(await e.getCssValue('background-color'))
    )), text ? [text] : []);

    // check Fill selected color
    assert.deepEqual(await driver.findAll('.test-fill-palette [class*=-selected]', async (e) => (
      rgbToHex(await e.getCssValue('background-color'))
    )), fill ? [fill] : []);

  });

  const checkCurrentColor = stackWrapFunc(async function(fill: string, text: string) {
    assert.equal(rgbToHex(await driver.find('.test-client-cell').getCssValue('color')), text);
    assert.equal(rgbToHex(await driver.find('.test-client-cell').getCssValue('background-color')), fill);
  });

  async function checkCurrentOption(option: number) {
    const isBold = (await driver.findAll('.test-client-cell.font-bold')).length === 1;
    const isUnderline = (await driver.findAll('.test-client-cell.font-underline')).length === 1;
    const isItalic = (await driver.findAll('.test-client-cell.font-italic')).length === 1;
    const isStrikeThrough = (await driver.findAll('.test-client-cell.font-strikethrough')).length === 1;
    const current =
        (isBold ? bold : 0) |
        (isUnderline ? underline : 0) |
        (isItalic ? italic : 0) |
        (isStrikeThrough ? strike : 0);
    return assert.equal(current, option);
  }

  async function checkSelectedOption(option: number) {
    const isBold = (await driver.findAll('.test-font-option-FontBold[class*=-selected]')).length === 1;
    const isUnderline = (await driver.findAll('.test-font-option-FontUnderline[class*=-selected]')).length === 1;
    const isItalic = (await driver.findAll('.test-font-option-FontItalic[class*=-selected]')).length === 1;
    const isStrikeThrough = (await driver.findAll('.test-font-option-FontStrikethrough[class*=-selected]'))
                            .length === 1;
    const selected =
        (isBold ? bold : 0) |
        (isUnderline ? underline : 0) |
        (isItalic ? italic : 0) |
        (isStrikeThrough ? strike : 0);
    return assert.equal(selected, option);
  }

  async function clickApply() {
    await driver.find('.test-colors-save').click();
  }

  async function clickCancel() {
    await driver.find('.test-colors-cancel').click();
  }

  async function applyDisabled() {
    assert.equal(await driver.find('.test-colors-save').getAttribute('disabled'), 'true');
  }

  async function applyEnabled() {
    assert.equal(await driver.find('.test-colors-save').getAttribute('disabled'), null);
  }

  it('should show buttons and disable apply', async function() {
    await driver.find('.test-color-select').click();

    await applyDisabled();
    await clickUnderline();
    await applyEnabled();
    await clickUnderline();
    await applyDisabled();

    await setColor(driver.find('.test-text-input'), white);
    await applyEnabled();
    await setColor(driver.find('.test-text-input'), black);
    await applyDisabled();
  });

  it('should allow picking fill and text color and options', async function() {

    // check current color
    await checkCurrentColor(white, black);
    await checkCurrentOption(0);

    // open picker and check selected color
    await driver.find('.test-color-select').click();
    await checkSelectedColor(white, black);
    // and options
    await checkSelectedOption(0);

    // pick fill and text color
    await driver.find('.test-fill-palette div:nth-of-type(5)').click();
    await driver.find('.test-text-palette div:nth-of-type(4)').click();

    // and options
    await clickUnderline();
    await clickStrikethrough();

    // check current colors
    await checkCurrentColor(swatches[4], swatches[3]);

    // check selected color
    await checkSelectedColor(swatches[4], swatches[3]);

    // and options
    await checkCurrentOption(underline | strike);
    await checkSelectedOption(underline | strike);

    // close picker and check a call was made
    await driver.find('.test-color-select').mouseMove({x: 300});
    await driver.withActions((a) => a.click());
    assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                     [`Called: ${JSON.stringify(
                      { fill: swatches[4], text: swatches[3],
                        underline: true, strikethrough: true}) }`]);
  });

  it('should allow to choose custom color', async function() {

    // open picker
    await driver.find('.test-color-select').click();

    // check selected color
    await checkSelectedColor(white, black);

    // select custom color
    await setColor(driver.find('.test-text-input'), '#FF0000');

    // check palette has no selected colors
    await checkSelectedColor(white, null);

    // check current colors
    await checkCurrentColor(white, "#FF0000");
  });

  it('should save colors and options on `enter` and apply', async function() {
    // open picker
    await driver.find('.test-color-select').click();

    // select text color
    await driver.find('.test-text-palette div:nth-of-type(8)').click();
    await clickItalic();

    // press enter
    await driver.sendKeys(Key.ENTER);

    // check logs
    assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                     [`Called: ${JSON.stringify({fill: "#FFFFFF", text: swatches[7], italic: true})}`]);

    await driver.find('.test-reset').click();
    await driver.find('.test-color-select').click();
    await driver.find('.test-text-palette div:nth-of-type(8)').click();
    await clickItalic();
    await clickApply();
    assert.deepEqual(await driver.findAll('.test-call-log li', (el) => el.getText()),
                     [`Called: ${JSON.stringify({fill: "#FFFFFF", text: swatches[7], italic: true})}`]);
  });

  it('should not make a save call on Escape', async function() {
    // open picker
    await driver.find('.test-color-select').click();

    // select text color
    await driver.find('.test-text-palette div:nth-of-type(6)').click();
    await clickBold();

    // press Escape
    await driver.sendKeys(Key.ESCAPE);

    // check logs
    const checkNoSave = async () => assert.deepEqual(
      await driver.findAll('.test-call-log li', (el) => el.getText()), []);
    await checkNoSave();

    await driver.find('.test-color-select').click();
    await clickBold();
    await clickCancel();
    await checkNoSave();
  });

  it('should revert on Escape', async function() {
    // prepare update form
    await setColor(driver.find('.test-fill-server-value input'), '#00FF00');
    await setColor(driver.find('.test-text-server-value input'), '#FF0000');
    await setOption(driver.find('.test-bold-server-value input'), true);

    // open picker
    await driver.find('.test-color-select').click();

    // check initial colors and options
    await checkCurrentColor(white, black);
    await checkSelectedColor(white, black);
    await checkCurrentOption(0);
    await checkSelectedOption(0);

    // send ctrl+u
    await driver.find('.test-server-update').sendKeys(Key.chord(Key.CONTROL, 'U'));

    // check colors and options changed
    await checkCurrentColor('#00FF00', '#FF0000');
    await checkSelectedColor(null, null);
    await checkCurrentOption(bold);
    await checkSelectedOption(bold);

    // pick color and option
    await driver.find('.test-fill-palette div:nth-of-type(5)').click();
    await driver.find('.test-text-palette div:nth-of-type(4)').click();
    await driver.find('.test-font-option-FontItalic').click();

    // check colors and options
    await checkCurrentColor(swatches[4], swatches[3]);
    await checkSelectedColor(swatches[4], swatches[3]);
    await checkCurrentOption(bold | italic);
    await checkSelectedOption(bold | italic);

    // send ESC
    await driver.sendKeys(Key.ESCAPE);

    // check panel is closed
    assert.isFalse(await driver.find('.test-text-palette').isPresent());

    // check current colors and options were reverted
    await checkCurrentColor('#00FF00', '#FF0000');
    await checkCurrentOption(bold);
  });

  it('should revert on Escape (2)', async function() {
    // prepare update form
    await setColor(driver.find('.test-fill-server-value input'), swatches[4]);
    await setColor(driver.find('.test-text-server-value input'), swatches[3]);
    await setOption(driver.find('.test-bold-server-value input'), true);
    await setOption(driver.find('.test-italic-server-value input'), true);

    // open picker
    await driver.find('.test-color-select').click();

    // check initial colors and options
    await checkCurrentColor(white, black);
    await checkSelectedColor(white, black);
    await checkCurrentOption(0);
    await checkSelectedOption(0);

    // pick same colors and options as planned server update
    await driver.find('.test-fill-palette div:nth-of-type(5)').click();
    await driver.find('.test-text-palette div:nth-of-type(4)').click();
    await clickBold();
    await clickItalic();

    // check colors and options changed
    await checkCurrentColor(swatches[4], swatches[3]);
    await checkSelectedColor(swatches[4], swatches[3]);
    await checkCurrentOption(bold | italic);
    await checkSelectedOption(bold | italic);

    // send ctrl+u
    await driver.find('.test-server-update').sendKeys(Key.chord(Key.CONTROL, 'U'));

    // check nothing changed
    await checkCurrentColor(swatches[4], swatches[3]);
    await checkSelectedColor(swatches[4], swatches[3]);
    await checkCurrentOption(bold | italic);
    await checkSelectedOption(bold | italic);

    // send Escape
    await driver.sendKeys(Key.ESCAPE);

    // check current colors and options are still the same
    await checkCurrentColor(swatches[4], swatches[3]);
    await checkCurrentOption(bold | italic);
  });

  it('should support lowercase hex color', async function() {
    // open picker
    await driver.find('.test-color-select').click();

    // set custom color in lowercase
    await setColor(driver.find('.test-text-input'), swatches[3].toLowerCase());

    // check correct value was selected.
    await checkSelectedColor(white, swatches[3]);
  });

  it('should truncate transparency bit', async function() {
    // set transparency to server value
    await setColor(driver.find('.test-fill-server-value input'), '#FF00FF00');
    await driver.find('.test-server-update').click();

    // open picker
    await driver.find('.test-color-select').click();

    // check correct value selected
    await checkSelectedColor(null, black);

    // check correct color
    await checkCurrentColor('#FF00FF', black);
    assert.equal(await driver.find('.test-fill-hex').value(), '#FF00FF');

  });

  describe('Editable hex', async function() {

    it('should allow typing in hex value', async function() {
      // open the picker
      await driver.find('.test-color-select').click();

      // click the hex value
      await driver.find('.test-text-hex').click();

      // start typing '#'
      await driver.sendKeys('#');

      // check hex value is now '#'
      assert.equal(await driver.find('.test-text-hex').value(), '#');

      // type in '...FOO' (not a valid hex)
      await driver.sendKeys('FOO');
      assert.equal(await driver.find('.test-text-hex').value(), '#FOO');

      // press enter
      await driver.sendKeys(Key.ENTER);

      // check hex value reverted to #000000
      assert.equal(await driver.find('.test-text-hex').value(), '#000000');

      // click the hex value
      await driver.find('.test-text-hex').click();

      // type in #FF00FF and press enter
      await driver.sendKeys(pink, Key.ENTER);

      // check value has changed
      assert.equal(await driver.find('.test-text-hex').value(), pink);

      // press enter again
      await driver.sendKeys(Key.ENTER);

      // check the picker is closed
      assert.equal(await driver.find('.test-text-hex').isPresent(), false);

      // check value was saved
      await checkCurrentColor(white, pink);

      // open the picker
      await driver.find('.test-color-select').click();

      // click the hex value
      await driver.find('.test-text-hex').click();

      // type in #0000FF
      await driver.sendKeys(red);

      // check the value changed
      assert.equal(await driver.find('.test-text-hex').value(), red);

      // press Escape
      await driver.sendKeys(Key.ESCAPE);

      // check the value reverted
      assert.equal(await driver.find('.test-text-hex').value(), pink);

      // press Escape
      await driver.sendKeys(Key.ESCAPE);

      // check the picker is closed
      assert.equal(await driver.find('.test-text-hex').isPresent(), false);

      // check value was reverted to #FF00FF
      await checkCurrentColor(white, pink);

    });

    it('should not change value on server update while typing', async function() {
      // prepare the update form
      await setColor(driver.find('.test-text-server-value input'), red);

      // open the picker
      await driver.find('.test-color-select').click();

      // click the hex value
      await driver.find('.test-text-hex').click();

      // start typing '#FF'
      await driver.sendKeys('#FF');

      // check the hex value changed
      assert.equal(await driver.find('.test-text-hex').value(), '#FF');

      // click button to update. We cannot send ctrl+U here, becauses it does cause picker to close
      // here.
      await driver.executeScript('triggerUpdate()');

      // check the value changed
      await checkCurrentColor(white, red);

      // check the hex value did not change (still '#FF')
      assert.equal(await driver.find('.test-text-hex').value(), '#FF');
    });
  });
});

async function setColor(colorInputEl: WebElement, color: string) {
  await driver.executeScript(() => {
    const el = arguments[0];
    el.value = arguments[1];
    const evt = document.createEvent("HTMLEvents");
    evt.initEvent("input", false, true);
    el.dispatchEvent(evt);
  }, colorInputEl, color);
}

async function setOption(colorInputEl: WebElement, value: boolean|undefined) {
  await driver.executeScript(() => {
    const el = arguments[0];
    el.value = arguments[1];
    const evt = document.createEvent("HTMLEvents");
    evt.initEvent("input", false, true);
    el.dispatchEvent(evt);
  }, colorInputEl, optionToString(value));
}

function optionToString(value?: boolean) {
  return value === undefined ? '' : String(value);
}

async function clickBold() {
  await driver.find('.test-font-option-FontBold').click();
}
async function clickItalic() {
  await driver.find('.test-font-option-FontItalic').click();
}
async function clickUnderline() {
  await driver.find('.test-font-option-FontUnderline').click();
}
async function clickStrikethrough() {
  await driver.find('.test-font-option-FontStrikethrough').click();
}
