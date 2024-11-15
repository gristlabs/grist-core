import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';
import {UserAPIImpl} from 'app/common/UserAPI';
import chai, {assert} from 'chai';
import Excel from 'exceljs';
import * as sinon from 'sinon';

describe("ExportsAccessRules", function() {
  this.timeout(60000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');
  let owner: UserAPIImpl;
  let editor: UserAPIImpl;
  let wsId: number;

  // Increase truncateThreshold for chai assertion diffs for this test, so that deepEqual failures
  // are reported more usefully.
  const sandbox = sinon.createSandbox();
  before(() => { sandbox.stub(chai.config, 'truncateThreshold').value(1000); });
  after(() => { sandbox.restore(); });

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'ExportsAccessRules', domain: 'exports-access-rules'});
    owner = await home.createHomeApi('chimpy', 'exports-access-rules', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        'kiwi@getgrist.com': 'owners',
        'charon@getgrist.com': 'editors',
      }
    });
    editor = await home.createHomeApi('charon', 'exports-access-rules', true);
  });

  after(async function() {
    const messages = await testUtils.captureLog('error', async () => {
      const api = await home.createHomeApi('chimpy', 'docs');
      await api.deleteOrg('exports-access-rules');
      await home.stop();
    });
    assert.deepEqual(messages, []);
  });

  async function createSampleTables(docId: string) {
    // Add tables that are fully or partially hidden from Editors.
    await owner.applyUserActions(docId, [
      ['AddTable', 'Public', [{id: 'ColPublic1'}]],
      ['AddTable', 'Private', [{id: 'ColPrivate1'}]],
      ['AddTable', 'Partial', [{id: 'ColPartialShow'}, {id: 'ColPartialHide'}, {id: 'ColPartialMaybe'}]],
      ['RemoveTable', 'Table1'],
      ['AddRecord', 'Public', null, {ColPublic1: 10}],
      ['AddRecord', 'Private', null, {ColPrivate1: 20}],
      ['AddRecord', 'Partial', null, {ColPartialShow: 'show1', ColPartialHide: 'hide1', ColPartialMaybe: 'maybe1'}],
      ['AddRecord', 'Partial', null, {ColPartialShow: 'show2', ColPartialHide: 'hide2', ColPartialMaybe: 'maybe2'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Private', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Partial', colIds: 'ColPartialHide'}],
      ['AddRecord', '_grist_ACLResources', -4, {tableId: 'Partial', colIds: 'ColPartialMaybe'}],
      // Negative IDs refer to rowIds used in the same action bundle.
      ['AddRecord', '_grist_ACLRules', null, {
        // Deny non-owners access to table Private.
        resource: -2, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        // Deny non-owners access to column Partial.ColPartialHide
        resource: -3, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        // Deny non-owners access to rowIds <= 1 in column Partial.ColPartialMaybe.
        resource: -4, aclFormula: 'user.Access != "owners" and rec.id <= 1', permissionsText: 'none',
      }],
    ]);

    // Add a table to be summarized, and deny access to it.
    const summarizedTableRef = (await owner.applyUserActions(docId, [
      ['AddTable', 'ToSummarize', [{id: 'SCol1'}, {id: 'SCol2', type: 'Numeric'}]],
      ['AddRecord', 'ToSummarize', null, {SCol1: 'a', SCol2: 100}],
      ['AddRecord', 'ToSummarize', null, {SCol1: 'a', SCol2: 200}],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: 'ToSummarize', colIds: '*'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, aclFormula: 'user.Access != "owners"', permissionsText: 'none',
      }],
    ])).retValues[0].id;

    // Add a summary of table 'ToSummarize', grouped by 'SCol1'. This table is not denied.
    const colRef = (await owner.getDocAPI(docId).getRecords('_grist_Tables_column',
      {filters: {parentId: [summarizedTableRef], colId: ['SCol1']}}))[0].id;
    await owner.applyUserActions(docId, [
      ['CreateViewSection', summarizedTableRef, 0, 'record', [colRef], null]
    ]);
  }

  it('respects access rules for CSV exports', async function() {
    const docId = await owner.newDoc({name: 'doc'}, wsId);
    await createSampleTables(docId);

    // Some sections get created automatically. Find their IDs.
    const tables = await owner.getDocAPI(docId).getRecords('_grist_Tables');
    const tableRefToTableId = new Map(tables.map(t => [t.id, t.fields.tableId]));
    const viewSections = await owner.getDocAPI(docId).getRecords('_grist_Views_section');
    const tableIdToSection = new Map(viewSections.map(vs =>
      [tableRefToTableId.get(vs.fields.tableRef as number), vs.id]));

    async function getCSV(user: UserAPIImpl, tableId: string): Promise<string> {
      const url = user.getDocAPI(docId).getDownloadCsvUrl({
        viewSection: tableIdToSection.get(tableId) as number,
        tableId,
      });
      // BaseAPI.request method is private, but so handy here, that we'll use it anyway.
      const resp = await (user as any).request(url, {timeout: 1000});
      return (await resp.text()).trim();
    }

    // Owner and editor can CSV-export Public table in full.
    assert.deepEqual(await getCSV(owner, 'Public'), 'ColPublic1\n10');
    assert.deepEqual(await getCSV(editor, 'Public'), 'ColPublic1\n10');

    // Only owner can CSV-export Private table.
    assert.deepEqual(await getCSV(owner, 'Private'), 'ColPrivate1\n20');
    await assert.isRejected(getCSV(editor, 'Private'),
      /Request.*failed with status 404.*Cannot find or access table/);

    // The partial table is full visible to the Owner, partially to Editor.
    assert.deepEqual(await getCSV(owner, 'Partial'),
      'ColPartialShow,ColPartialHide,ColPartialMaybe\n' +
      'show1,hide1,maybe1\n' +
      'show2,hide2,maybe2'
    );
    assert.deepEqual(await getCSV(editor, 'Partial'),
      'ColPartialShow,ColPartialMaybe\n' +
      'show1,CENSORED\n' +
      'show2,maybe2'
    );

    // The table ToSummarize is visible only to owner.
    assert.deepEqual(await getCSV(owner, 'ToSummarize'), 'SCol1,SCol2\na,100\na,200');
    await assert.isRejected(getCSV(editor, 'ToSummarize'),
      /Request.*failed with status 404.*Cannot find or access table/);

    // It's summary table is visible only to both owner and editor.
    assert.deepEqual(await getCSV(owner, 'ToSummarize_summary_SCol1'), 'SCol1,count,SCol2\na,2,300');
    assert.deepEqual(await getCSV(editor, 'ToSummarize_summary_SCol1'), 'SCol1,count,SCol2\na,2,300');
  });

  it('respects access rules for XLSX exports', async function() {
    const docId = await owner.newDoc({name: 'doc'}, wsId);
    await createSampleTables(docId);

    async function getXlsx(user: UserAPIImpl): Promise<any> {
      const url = user.getDocAPI(docId).getDownloadXlsxUrl();
      // BaseAPI.request method is private, but so handy here, that we'll use it anyway.
      const resp = await (user as any).request(url, {timeout: 5000});
      const workbook = new Excel.Workbook();
      await workbook.xlsx.read(resp.body);
      const output: {[name: string]: string} = {};
      for (const ws of workbook.worksheets) {
        output[ws.name] = (await workbook.csv.writeBuffer({sheetName: ws.name})).toString();
      }
      return output;
    }

    assert.deepEqual(await getXlsx(owner), {
      Public: 'ColPublic1\n10',
      Private: 'ColPrivate1\n20',
      Partial: (
        'ColPartialShow,ColPartialHide,ColPartialMaybe\n' +
        'show1,hide1,maybe1\n' +
        'show2,hide2,maybe2'
      ),
      ToSummarize: (
        'SCol1,SCol2\n' +
        'a,100\n' +
        'a,200'
      ),
      // Summary tables are currently omitted from exports.
    });

    assert.deepEqual(await getXlsx(editor), {
      Public: 'ColPublic1\n10',
      Partial: (
        'ColPartialShow,ColPartialMaybe\n' +
        'show1,CENSORED\n' +
        'show2,maybe2'
      ),
      // ToSummarize table is omitted.
    });
  });
});
