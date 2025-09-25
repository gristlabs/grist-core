import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ProposedChangesPage', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  it('show comparison and functions as expected', async function() {
    const session = await gu.session().teamSite.login();
    // const api = session.createHomeApi();
    await session.tempDoc(cleanup, 'Hello.grist');
    // Open the share menu and click item to work on a copy.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test1');
    await driver.find('.test-tb-share').click();
    await driver.find('.test-work-on-copy').click();
    await gu.waitForServer();
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test2');
    await driver.find('.test-tools-proposals').click();
    await driver.findContentWait('.test-main-content', /Proposed Changes/, 2000);
    await driver.findWait('.action_log_table', 2000);
    assert.lengthOf(await driver.findAll('.action_log_table'), 1);
    assert.equal(
      await driver.find('.action_log_table tr:first-of-type').getText(),
      'A E'
    );
    assert.equal(
      await driver.find('.action_log_table tr:nth-of-type(2)').getText(),
      '→\ntest1test2\nTEST1TEST2'
    );
    assert.equal(await driver.find('.action_log_table button').getText(), '>');
    await driver.find('.action_log_table button').click();
    assert.equal(await driver.find('.action_log_table button').getText(), '<');
    assert.equal(
      await driver.findContentWait('.action_log_table tr:first-of-type', /id/, 2000).getText(),
      'id A B C D E'
    );
    assert.equal(
      await driver.find('.action_log_table tr:nth-of-type(2)').getText(),
      '→ 1\ntest1test2\nTEST1TEST2'
    );
    await driver.find('.test-replace').click();
    const confirmButton = driver.findWait('.test-modal-confirm', 3000);
    assert.equal(await confirmButton.getText(), 'Update');
    await confirmButton.click();

    // check we're no longer on a fork, but still have the change made on the fork.
    await gu.waitForUrl(/^[^~]*$/, 6000);
    await gu.waitForDocToLoad();
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test2');
  });
});
