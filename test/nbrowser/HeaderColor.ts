import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';


describe('HeaderColor', function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async () => {
    // Create a new document
    const mainSession = await gu.session().login();
    await mainSession.tempNewDoc(cleanup, 'HeaderColor');
    // add records
    await gu.enterCell('a');
    await gu.enterCell('b');
    await gu.enterCell('c');
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
  });

  it('should save by clicking away', async function () {
    await gu.getCell('A', 1).click();
    // open color picker
    await gu.openHeaderColorPicker();
    await gu.setFillColor('red');
    await gu.setTextColor('blue');
    // Save by clicking B column
    await gu.getCell('B', 1).click();
    await gu.waitForServer();
    // Make sure the color is saved.
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', 'transparent');
    await gu.assertHeaderTextColor('B', 'black');
    // Make sure it sticks after reload.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', 'transparent');
    await gu.assertHeaderTextColor('B', 'black');
  });

  it('should undo and redo colors when clicked away', async function () {
    await gu.getCell('A', 1).click();
    // open color picker
    await gu.openHeaderColorPicker();
    await gu.setFillColor('red');
    await gu.setTextColor('blue');
    // Save by clicking B column
    await gu.getCell('B', 1).click();
    await gu.waitForServer();
    // Make sure the color is saved.
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', 'transparent');
    await gu.assertHeaderTextColor('B', 'black');
    // Make sure then undoing works.
    await gu.undo();
    await gu.assertHeaderFillColor('A', 'transparent');
    await gu.assertHeaderTextColor('A', 'black');
    await gu.assertHeaderFillColor('B', 'transparent');
    await gu.assertHeaderTextColor('B', 'black');
    await gu.redo();
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', 'transparent');
    await gu.assertHeaderTextColor('B', 'black');
  });


  it('should work correctly on Grid view', async function () {
    const columnHeader = gu.getColumnHeader('C');

    await columnHeader.click();
    // open color picker
    await gu.openHeaderColorPicker();

    // set header colors
    await gu.setColor(driver.find('.test-text-input'), 'rgb(255, 0, 0)');
    await gu.setColor(driver.find('.test-fill-input'), 'rgb(0, 0, 255)');

    // press enter to close color picker
    await driver.sendKeys(Key.ENTER);

    // check header colors
    assert.equal(await columnHeader.getCssValue('color'), 'rgba(255, 0, 0, 1)');
    assert.equal(await columnHeader.getCssValue('background-color'), 'rgba(0, 0, 255, 1)');
  });
});
