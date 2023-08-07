import { assert, driver, Key } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

const defaultHeaderBackgroundColor = '#f7f7f7';

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
    await gu.assertHeaderFillColor('B', defaultHeaderBackgroundColor);
    await gu.assertHeaderTextColor('B', 'black');
    // Make sure it sticks after reload.
    await driver.navigate().refresh();
    await gu.waitForDocToLoad();
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', defaultHeaderBackgroundColor);
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
    await gu.assertHeaderFillColor('B', defaultHeaderBackgroundColor);
    await gu.assertHeaderTextColor('B', 'black');
    // Make sure then undoing works.
    await gu.undo();
    await gu.assertHeaderFillColor('A', defaultHeaderBackgroundColor);
    await gu.assertHeaderTextColor('A', 'black');
    await gu.assertHeaderFillColor('B', defaultHeaderBackgroundColor);
    await gu.assertHeaderTextColor('B', 'black');
    await gu.redo();
    await gu.assertHeaderFillColor('A', 'red');
    await gu.assertHeaderTextColor('A', 'blue');
    await gu.assertHeaderFillColor('B', defaultHeaderBackgroundColor);
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

  it('should not exist in Detail view', async function () {
    // Color the A column in Grid View
    const columnHeader = gu.getColumnHeader('A');
    await columnHeader.click();
    await gu.openHeaderColorPicker();
    await gu.setColor(driver.find('.test-text-input'), 'rgb(255, 0, 0)');
    await driver.sendKeys(Key.ENTER);

    // Add a card list widget of Table1
    await gu.addNewSection(/Card List/, /Table1/);

    // check header colors
    const detailHeader = await driver.findContent('.g_record_detail_label', gu.exactMatch('A'));
    assert.equal(await detailHeader.getCssValue('color'), 'rgba(146, 146, 153, 1)');

    // There is no header color picker
    assert.isFalse(await driver.find('.test-header-color-select .test-color-select').isPresent());

  });
});
