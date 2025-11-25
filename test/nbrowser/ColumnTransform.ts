import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';
import {assert, driver, Key} from 'mocha-webdriver';


describe('ColumnTransform', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().login();
    await session.tempNewDoc(cleanup, 'Transform');
  });

  it('should disable changing name of a column during transformation', async function() {
    await gu.sendActions([
      ['AddRecord', 'Table1', null, {A: 'Test'}],
    ]);
    await gu.selectColumn('A');
    await gu.openColumnPanel();

    await gu.setType('Numeric', {
      apply: false,
    });

    // Now try to change the column name using the UI.
    await gu.openColumnMenu('A');
    await gu.findOpenMenu();

    // The 'Rename' option should be disabled.
    assert.isTrue(await driver.findContentWait('li', /Rename column/, 1000).matches('.disabled'));
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();

    // Try to rename using shortcut (cmd+M on Mac, ctrl+M otherwise).
    await gu.sendKeys(Key.chord(await gu.modKey(), 'm'));
    await driver.sleep(50);
    // Menu should not be opened, we can't rename column during transformation.
    assert.isFalse(await driver.find('.test-column-title-popup').isPresent());

    // Try to rename by dbl click on column header.
    await gu.dbClick(gu.getColumnHeader('A'));
    await driver.sleep(50);
    // Inline editor should not appear.
    assert.isFalse(await driver.find('.test-column-title-popup').isPresent());

    // Cancel the transformation.
    await driver.find('.test-type-transform-cancel').click();
    await gu.waitForServer();

    // Now renaming should be possible.
    await gu.selectColumn('A');
    await gu.sendKeys(Key.chord(await gu.modKey(), 'm'));
    await driver.sleep(50);
    assert.isTrue(await driver.find('.test-column-title-popup').isPresent());
    await gu.sendKeys(Key.ESCAPE);
    await driver.sleep(50);
    assert.isFalse(await driver.find('.test-column-title-popup').isPresent());
  });
});
