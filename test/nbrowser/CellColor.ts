import { assert, driver, Key, WebElement } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';


describe('CellColor', function() {
  this.timeout(20000);
  gu.bigScreen();
  const cleanup = setupTestSuite();
  let doc: string;

  before(async () => {
    // Create a new document
    const mainSession = await gu.session().login();
    doc = await mainSession.tempNewDoc(cleanup, 'CellColor');
    // add records
    await gu.enterCell('a');
    await gu.enterCell('b');
    await gu.enterCell('c');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
  });

  it('should save by clicking away', async function() {
    await gu.getCell('A', 1).click();
    // open color picker
    await gu.openCellColorPicker();
    await gu.setFillColor('red');
    await gu.setTextColor('blue');
    // Save by clicking B column
    await gu.getCell('B', 1).click();
    await gu.waitForServer();
    // Make sure the color is saved.
    await gu.assertCellFillColor('A', 1, 'red');
    await gu.assertCellTextColor('A', 1, 'blue');
    await gu.assertCellFillColor('B', 1, 'transparent');
    await gu.assertCellTextColor('B', 1, 'black');
    // Make sure it sticks after reload.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    await gu.assertCellFillColor('A', 1, 'red');
    await gu.assertCellTextColor('A', 1, 'blue');
    await gu.assertCellFillColor('B', 1, 'transparent');
    await gu.assertCellTextColor('B', 1, 'black');
  });

  it('should undo and redo colors when clicked away', async function() {
    await gu.getCell('A', 1).click();
    // open color picker
    await gu.openCellColorPicker();
    await gu.setFillColor('red');
    await gu.setTextColor('blue');
    // Save by clicking B column
    await gu.getCell('B', 1).click();
    await gu.waitForServer();
    // Make sure the color is saved.
    await gu.assertCellFillColor('A', 1, 'red');
    await gu.assertCellTextColor('A', 1, 'blue');
    await gu.assertCellFillColor('B', 1, 'transparent');
    await gu.assertCellTextColor('B', 1, 'black');
    // Make sure then undoing works.
    await gu.undo();
    await gu.assertCellFillColor('A', 1, 'transparent');
    await gu.assertCellTextColor('A', 1, 'black');
    await gu.assertCellFillColor('B', 1, 'transparent');
    await gu.assertCellTextColor('B', 1, 'black');
    await gu.redo();
    await gu.assertCellFillColor('A', 1, 'red');
    await gu.assertCellTextColor('A', 1, 'blue');
    await gu.assertCellFillColor('B', 1, 'transparent');
    await gu.assertCellTextColor('B', 1, 'black');
  });


  it('should work correctly on Grid view', async function() {
    let clip: WebElement;
    let cell = gu.getCell('A', 1);
    clip = cell.find('.field_clip');

    await cell.click();
    // open color picker
    await gu.openCellColorPicker();

    // set cell colors
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);

    // check cell colors

    // first for the field_clip.
    assert.equal(await clip.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    // now for the whole cell.
    assert.equal(await clip.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');

    // Check background color for the add new row.
    cell = gu.getCell('A', 4);
    clip = cell.find('.field_clip');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');
    assert.equal(await clip.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');
    assert.equal(await clip.findClosest('.record').getCssValue('background-color'), 'rgba(246, 246, 255, 1)');
  });

  it('should work correctly in Detail view', async function() {
    // Add a card list widget of Table1
    await gu.addNewSection(/Card List/, /Table1/);

    // check cell colors
    let cell: WebElement;
    cell = gu.getDetailCell('A', 1).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');

    // check colors of the add new row
    cell = gu.getDetailCell('A', 4).find('.field_clip');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(246, 246, 255, 1)');
  });

  it('should work correctly on Grid view in comparison mode', async function() {

    // First let's add an Hyperlink column
    await gu.getSection('TABLE1').click();
    let cell = await gu.getCell('B', 1).doClick();
    await gu.enterCell('foo');
    await driver.findContent('.test-select-button', /HyperLink/).click();
    await gu.waitForServer();

    // check default color of hyperlink
    cell = await gu.getCell('B', 1).find('.field_clip');
    const ligthGreen = gu.hexToRgb('#16B378');
    assert.equal(await cell.getCssValue('color'), ligthGreen);
    assert.equal(await cell.find('.test-tb-link-icon').getCssValue('background-color'), ligthGreen);
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');

    // Make a fork of the document with a change
    const mainSession = await gu.session().login();
    await mainSession.loadDoc(`/doc/${doc}/m/fork`);

    // Change active section
    await gu.getSection('TABLE1').click();

    // Add new record
    await gu.getCell('A', 1).click();
    await gu.enterCell('e');
    await gu.getCell('A', 4).click();
    await gu.enterCell('f', Key.TAB);
    await gu.enterCell('foo');

    // get the forkid
    const forkId = await gu.getCurrentUrlId();

    // Compare with the original
    await mainSession.loadDoc(`/doc/${doc}?compare=${forkId}`, {skipAlert: true});

    // check that colors for diffing cells are ok
    cell = gu.getCell('A', 1).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');

    // check colors for a normal row
    cell = gu.getCell('A', 2).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');

    // check colors of the added records is ok
    cell = gu.getCell('A', 4).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(175, 255, 175, 1)');
    assert.equal(await cell.findClosest('.record').getCssValue('background-color'), 'rgba(175, 255, 175, 1)');

    // check colors of the hyperlink
    cell = gu.getCell('B', 4).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    assert.equal(await cell.find('.test-tb-link-icon').getCssValue('background-color'), 'rgba(0, 0, 0, 1)');

    // check colors of the add new row
    cell = gu.getCell('A', 5).find('.field_clip');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');
    assert.equal(await cell.findClosest('.record').getCssValue('background-color'), 'rgba(246, 246, 255, 1)');

  });

  it('should work correctly on Detail view in comparison mode', async function() {

    // Change active section
    await gu.getSection('TABLE1 Card List').click();

    let cell: WebElement;
    // check color of diffing cell is are ok
    cell = gu.getDetailCell('A', 1).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 0, 0)');

    // check colors of normal row is set
    cell = gu.getDetailCell('A', 2).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');

    // check colors of the added records is ok
    cell = gu.getDetailCell('A', 4).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(175, 255, 175, 1)');
    assert.equal(await cell.findClosest('.g_record_detail').getCssValue('background-color'), 'rgba(175, 255, 175, 1)');

    // check colors of the add new row
    cell = gu.getDetailCell('A', 5).find('.field_clip');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(246, 246, 255, 1)');
  });

  it('should work for HyperLinkTextbox', async function() {
    // Load original document
    const mainSession = await gu.session().login();
    await mainSession.loadDoc(`/doc/${doc}`);

    // select the grid widget
    await gu.getSection('TABLE1').click();

    // change widget to hyper link
    await driver.findContent('.test-select-button', /HyperLink/).click();
    await gu.waitForServer();
    const cell = gu.getCell('A', 1).find('.field_clip');

    // check cell show hyperlink
    assert.equal(await cell.find('a').isPresent(), true);

    // check color and background are ok
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    assert.equal(await cell.find('.test-tb-link-icon').getCssValue('background-color'), 'rgba(0, 255, 0, 1)');

  });

  it('should work with Attachment type column', async function() {
    // change widget to Attachment
    await gu.setType(/Attachment/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();

    // empty cell
    let cell = await gu.getCell('A', 1).find('.field_clip').doClick();
    await gu.enterCell(Key.DELETE);

    // check cell type
    cell = await gu.getCell('A', 1).find('.field_clip');
    assert.equal(await cell.matches('.test-attachment-widget'), true);

    // open color picker
    await gu.openCellColorPicker();

    // set and check cellColor
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fillColor
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should work with Toggle type column', async function() {
    // change widget to Toggle type
    await gu.setType(/Toggle/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();

    // check cell has changed type
    const cell = await gu.getCell('A', 1).find('.field_clip');
    assert.equal(await cell.find('.widget_checkbox').isPresent(), true);

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should work with DateTime column', async function() {
    // change widget to Date type
    await gu.setType(/Date/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();
    const cell = gu.getCell('A', 1);

    // Empty cell to clear error from converting toggle to date
    await cell.click();
    await driver.sendKeys(Key.DELETE);
    await gu.waitAppFocus(true);

    const clip = cell.find('.field_clip');

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await clip.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await clip.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should work with Reference column', async function() {
    // change widget to Reference type
    await gu.setType(/Reference/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();
    const cell = gu.getCell('A', 1).find('.field_clip');

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      // check color and background are of
      assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should work with Choice type column', async function() {
    // change widget to Choice type
    await gu.setType(/Choice/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();

    // empty cell
    await gu.getCell('A', 1).click();
    await gu.enterCell(Key.DELETE);

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    const cell = await gu.getCell('A', 1).find('.field_clip');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should work well with error cell', async function() {
    // change to numeric type
    await gu.setType(/Numeric/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();

    // enter text
    await gu.getCell('A', 1).click();
    await gu.enterCell('foo');

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    const cell = await gu.getCell('A', 1).find('.field_clip');
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 0, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('background-color'), 'rgba(255, 182, 193, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

  });


  it('should persist when changing cell format', async function() {
    // change to text type
    await gu.setType(/Text/);
    await driver.findWait('.test-type-transform-apply', 1000).click();
    await gu.waitForServer();
    let cell = gu.getCell('A', 1).find('.field_clip');

    // open color picker
    await gu.openCellColorPicker();

    // set and check cell color
    await gu.setColor(driver.find('.test-text-input'), 'rgb(0, 255, 0)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    });

    // set and check fill color
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');
    await gu.waitToPass(async () => {
      assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
    });

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // change format to hyperlink
    await driver.findContent('.test-select-button', /HyperLink/).click();
    await gu.waitForServer();

    // check color is still ok
    cell = gu.getCell('A', 1).find('.field_clip');
    assert.equal(await cell.getCssValue('color'), 'rgba(0, 255, 0, 1)');
    assert.equal(await cell.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
  });

  const toggleDefaultColor = 'rgba(96, 96, 96, 1)';
  const switchDefaultColor = 'rgba(44, 176, 175, 1)';
  const getPickerCurrentTextColor = () => driver.find('.test-text-color-square').getCssValue('background-color');

  it('should handle correctly default text color', async function() {
    // Create new checkbox column
    await driver.find('.mod-add-column').click();
    await driver.find('.test-new-columns-menu-add-new').click();
    await gu.waitForServer();
    await gu.setType(/Toggle/);

    // open the color picker
    await gu.openCellColorPicker();

    // check color preview is correct
    assert.equal(await driver.find('.test-text-hex').value(), 'default');
    assert.equal(await getPickerCurrentTextColor(), toggleDefaultColor);

    // close color picker
    await driver.sendKeys(Key.ENTER);

    // Change widget to Switch
    await driver.find('.test-fbuilder-widget-select').click();
    await driver.findContent('.test-select-row', /Switch/).click();
    await gu.waitForServer();

    // open the color picker
    await gu.openCellColorPicker();

    // check color preview is correct
    assert.equal(await driver.find('.test-text-hex').value(), 'default');
    assert.equal(await getPickerCurrentTextColor(), switchDefaultColor);

    // close picker
    await driver.sendKeys(Key.ESCAPE);
  });

  it('should allow reverting to default text color', async function() {
    // Continuing on the previous test case, change Switch widget from default to an explicit color.
    await gu.openCellColorPicker();
    assert.equal(await driver.find('.test-text-hex').value(), 'default');
    assert.equal(await getPickerCurrentTextColor(), switchDefaultColor);
    await gu.setTextColor('rgb(255, 0, 0)');
    assert.equal(await driver.find('.test-text-hex').value(), '#FF0000');
    assert.equal(await getPickerCurrentTextColor(), 'rgba(255, 0, 0, 1)');
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();

    // Change widget to Toggle
    await driver.find('.test-fbuilder-widget-select').click();
    await driver.findContent('.test-select-row', /CheckBox/).click();
    await gu.waitForServer();

    // Check the saved color applies.
    await gu.openCellColorPicker();
    assert.equal(await driver.find('.test-text-hex').value(), '#FF0000');
    assert.equal(await getPickerCurrentTextColor(), 'rgba(255, 0, 0, 1)');

    // Revert to default; the new widget has a different default.
    await driver.find('.test-text-empty').click();
    assert.equal(await driver.find('.test-text-hex').value(), 'default');
    assert.equal(await getPickerCurrentTextColor(), toggleDefaultColor);
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  });

  it('should not save default color', async function() {
    // This test catch a bug that used to save the default color to server when changing widget format

    // create a new checkbox column
    await driver.find('.mod-add-column').click();
    await driver.find('.test-new-columns-menu-add-new').click();

    await gu.waitForServer();
    await gu.setType(/Toggle/);

    // make sure the view pane is scrolled all the way left
    await gu.sendKeys(Key.ARROW_LEFT);

    // enter 'true'
    await gu.getCell('E', 1).click();
    await gu.enterCell('true');

    // check the color
    const cell = () => gu.getCell('E', 1).find('.field_clip');
    assert.equal(await cell().find('.checkmark_stem').getCssValue('background-color'), gu.hexToRgb('#606060'));

    // open the color picker and press ESC
    await gu.openCellColorPicker();
    await driver.wait(() => driver.find('.test-fill-palette').isPresent(), 3000);
    await driver.sendKeys(Key.ESCAPE);
    await driver.wait(async () => !(await driver.find('.test-fill-palette').isPresent()), 3000);

    // switch format to switch
    await driver.find('.test-fbuilder-widget-select').click();
    await driver.findContent('.test-select-row', /Switch/).click();
    await gu.waitForServer();

    // check the switch's color
    assert.equal(await cell().find('.switch_slider').getCssValue('background-color'), gu.hexToRgb('#2CB0AF'));

  });
});
