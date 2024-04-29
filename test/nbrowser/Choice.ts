import {DocAPI, UserAPI} from 'app/common/UserAPI';
import {assert, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('Choice', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let docId: string;
  let api: UserAPI;
  let docApi: DocAPI;

  before(async () => {
    const session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup, 'Choice');
    api = session.createHomeApi();
    docApi = api.getDocAPI(docId);
  });

  afterEach(() => gu.checkForErrors());

  it('should set cell value to empty string when editor text is blank', async () => {
    // Add a few records to Table1.
    await api.applyUserActions(docId, [
      ['BulkAddRecord', 'Table1', [null, null, null], {}],
    ]);

    // Change column A's type to Choice and check its values default to empty string.
    await api.applyUserActions(docId, [
      ['ModifyColumn', 'Table1', 'A', {
        type: 'Choice',
      }],
    ]);
    assert.deepEqual(await docApi.getRecords('Table1'), [
      {id: 1, fields: {A: '', C: null, B: null}},
      {id: 2, fields: {A: '', C: null, B: null}},
      {id: 3, fields: {A: '', C: null, B: null}},
    ]);

    // Start editing a cell in column A and click away to close the editor.
    await gu.getCell({rowNum: 1, col: 'A'}).click();
    await gu.sendKeys(Key.ENTER);
    await gu.getCell({rowNum: 1, col: 'C'}).click();
    await gu.waitForServer();

    // Check that the values in column A are unchanged.
    assert.deepEqual(await docApi.getRecords('Table1'), [
      {id: 1, fields: {A: '', C: null, B: null}},
      {id: 2, fields: {A: '', C: null, B: null}},
      {id: 3, fields: {A: '', C: null, B: null}},
    ]);
  });
});
