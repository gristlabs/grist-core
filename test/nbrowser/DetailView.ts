import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {cleanupExtraWindows, server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('DetailView', function() {
  this.timeout(20000);
  cleanupExtraWindows();
  const cleanup = setupTestSuite();

  // Before create new document.
  before(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempNewDoc(cleanup);

    await gu.sendActions([
      ['AddRecord', 'Table1', null, {A: 'some text', B: server.getHost()}],
    ]);
    await gu.addNewSection('Card', 'Table1');
  });

  it('opens cell for editing when clicked', async () => {
    const fieldA = await gu.getDetailCell('A', 1);

    // Make sure the cell is not in edit mode.
    assert.equal(await fieldA.getText(), 'some text');
    assert.equal(await driver.find('.test-widget-text-editor').isPresent(), false);

    // Now click on the cell and make sure it is in edit mode.
    await fieldA.click(); // first is to select it
    await fieldA.click(); // second is to edit it
    assert.equal(await driver.find('.test-widget-text-editor').isPresent(), true);
    await gu.checkTextEditor('some text');
  });

  it('does not opens cell for editing when clicked on link', async () => {
    const fieldB = await gu.getDetailCell('B', 1);

    // First select the cell.
    await fieldB.click();
    // Now click on the link and make sure it is not in edit mode.
    await fieldB.find(".test-tb-link-icon").click();

    assert.equal(await fieldB.getText(), server.getHost());
    await driver.sleep(100); // This click is ignored, so wait for a bit.
    assert.equal(await driver.find('.test-widget-text-editor').isPresent(), false);
  });
});
