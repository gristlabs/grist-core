import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';
import { assert, driver, Key, WebElement } from 'mocha-webdriver';

describe('RowMenu', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  async function rightClick(el: WebElement) {
    await driver.withActions((actions) => actions.contextClick(el));
  }

  async function assertRowMenuOpensAndCloses() {
    const firstRow = await gu.getRow(1);
    // make sure that toggle is there
    assert.isTrue(await firstRow.find(".test-row-menu-trigger").isPresent());
    // but is hidden
    assert.isFalse(await firstRow.find(".test-row-menu-trigger").isDisplayed());
    // hover the row
    await firstRow.mouseMove();
    // make sure toggle is visible
    assert.isTrue(await firstRow.find(".test-row-menu-trigger").isDisplayed());
    // make sure that clicking on it opens up the menu
    await firstRow.find(".test-row-menu-trigger").click();
    assert.isTrue(await driver.findWait('.grist-floating-menu', 1000).isDisplayed());
    // close the menu
    await driver.sendKeys(Key.ESCAPE);
    // make sure the menu is closed
    assert.lengthOf(await driver.findAll('.grist-floating-menu'), 0);
  }

  async function assertRowMenuOpensWithRightClick() {
    const firstRow = await gu.getRow(1);
    // make sure right click opens up the menu
    const toggle = await firstRow.find(".test-row-menu-trigger");
    await rightClick(toggle);
    assert.isTrue(await driver.findWait('.grist-floating-menu', 1000).isDisplayed());
    // close the menu by clicking the toggle
    await toggle.click();
    // make sure the menu is closed
    assert.lengthOf(await driver.findAll('.grist-floating-menu'), 0);
  }

  before(async () => {
    const session = await gu.session().login();
    await session.tempDoc(cleanup, "CardView.grist");
  });

  it('should show row toggle', async function() {
    await assertRowMenuOpensAndCloses();
    await assertRowMenuOpensWithRightClick();
  });

  it('should hide row toggle when mouse moves away', async function() {
    const [firstRow, secondRow] = [await gu.getRow(1), await gu.getRow(2)];
    await secondRow.mouseMove();
    assert.isTrue(await firstRow.find(".test-row-menu-trigger").isPresent());
    assert.isFalse(await firstRow.find(".test-row-menu-trigger").isDisplayed());
  });

  it('should support right click anywhere on the row', async function() {
    // rigth click a cell in a row
    await rightClick(await gu.getCell(0, 1));

    // check that the context menu shows
    assert.isTrue(await driver.findWait('.grist-floating-menu', 1000).isDisplayed());

    // send ESC to close the menu
    await driver.sendKeys(Key.ESCAPE);

    // check that the context menu is gone
    assert.isFalse(await driver.find('.grist-floating-menu').isPresent());
  });

  it('can rename headers from the selected line', async function() {
    assert.notEqual(await gu.getColumnHeader({col: 0}).getText(), await gu.getCell(0, 1).getText());
    assert.notEqual(await gu.getColumnHeader({col: 1}).getText(), await gu.getCell(1, 1).getText());
    await (await gu.openRowMenu(1)).findContent('li', /Use as table headers/).click();
    await gu.waitForServer();
    assert.equal(await gu.getColumnHeader({col: 0}).getText(), await gu.getCell(0, 1).getText());
    assert.equal(await gu.getColumnHeader({col: 1}).getText(), await gu.getCell(1, 1).getText());
  });

  it('should work even when no columns are visible', async function() {
    // Previously, a bug would cause an error to be thrown instead.
    await gu.openColumnMenu({col: 0}, 'Hide column');
    // After hiding the first column, the second one will be the new first column.
    await gu.openColumnMenu({col: 0}, 'Hide column');
    await assertRowMenuOpensAndCloses();
    await assertRowMenuOpensWithRightClick();
  });

});
