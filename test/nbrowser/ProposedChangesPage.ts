import {assert, driver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('ProposedChangesPage', function() {
  this.timeout(60000);
  const cleanup = setupTestSuite();

  it('show comparison and functions as expected', async function() {
    // Load a test document.
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, 'Hello.grist');

    // Put something known in the first cell.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test1');

    // Work on a copy.
    await driver.find('.test-tb-share').click();
    await driver.find('.test-work-on-copy').click();
    await gu.waitForServer();

    // Change the content of the first cell.
    await gu.getCell('A', 1).click();
    await gu.waitAppFocus();
    await gu.enterCell('test2');

    await driver.find('.test-tools-proposals').click();
    await driver.findContentWait('.test-main-content', /Propose Changes/, 2000);
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
    assert.match(await driver.find('.test-proposals-propose').getText(), /Propose/);
    await driver.find('.test-proposals-propose').click();
    await driver.findContentWait('.test-proposals-status', /Proposed/, 2000);
    assert.match(await driver.find('.test-proposals-propose').getText(), /Update/);
    await driver.findWait('.test-proposals-retract', 2000).click();
    await driver.findContentWait('.test-proposals-status', /Retracted/, 2000);
    assert.match(await driver.find('.test-proposals-propose').getText(), /Propose/);
    await driver.find('.test-proposals-propose').click();
    await driver.findContentWait('.test-proposals-status', /Proposed/, 2000);

    await driver.findContentWait('span', /original document/, 2000).click();

    assert.match(
      await driver.findContentWait('.test-proposals-header', /# 1/, 2000).getText(),
      /Proposed/
    );

    assert.lengthOf(await driver.findAll('.test-proposals-header'), 1);

    await driver.findContent('span.action_log_cell_add', /test2/).click();

    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test1');
    await driver.navigate().back();

    await driver.findWait('.test-proposals-apply', 2000).click();
    await gu.waitForServer();
    await driver.findContent('span.action_log_cell_add', /test2/).click();
    await driver.findContentWait('.test-widget-title-text', /TABLE1/, 2000);
    assert.equal(await gu.getCell({rowNum: 1, col: 0}).getText(), 'test2');

    // There's a formula column error, can't write to it.
    // Need to deal with this (and other column types) earlier...
  });
});
