import { assert, driver } from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import { setupTestSuite } from 'test/nbrowser/testUtils';

function getDescriptionInput() {
  return driver.find('.test-right-panel .test-column-description')
}

describe('DescriptionColumn', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  it('should support basic edition', async () => {

    const mainSession = await gu.session().teamSite.login();
    const api = mainSession.createHomeApi();
    const docId = await mainSession.tempNewDoc(cleanup, 'FormulaCounts', { load: true });

    // Make a column and add a description
    await api.applyUserActions(docId, [
      [ 'ModifyColumn', 'Table1', 'C', {
        type: 'Text',
        description: 'This is the column description \nI am in two lines'
      } ],
    ]);
    await driver.find('.test-right-opener').click();
    await gu.getCell({ rowNum: 1, col: 'C' }).click();
    await driver.find('.test-right-tab-field').click();

    assert.equal(await getDescriptionInput().value(), 'This is the column description \nI am in two lines');

    await getDescriptionInput().click()

    // Remove the description
    await api.applyUserActions(docId, [
      [ 'ModifyColumn', 'Table1', 'C', {
        description: ''
      } ],
    ]);

    assert.equal(await getDescriptionInput().value(), '');
  })
})
