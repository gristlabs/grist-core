import {UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {CellValue, fromTableDataAction, TableColValues, toTableDataAction} from 'app/common/DocActions';
import {GristObjCode} from 'app/plugin/GristData';
import axios from 'axios';
import fetch from 'node-fetch';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import {GristClient, openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

describe('UserAttributes', function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel('error');

  let server: TestServer;
  let serverUrl: string;
  let wsId: number;

  let owner: UserAPI;
  const testDisplayEmail = 'Charon@gEtGrIsT.com';
  const testLowerEmail = 'charon@getgrist.com';
  const clients: GristClient[] = [];

  beforeEach(async function() {
    server = new TestServer(this);
    serverUrl = await server.start(['home', 'docs']);
    owner = await server.createHomeApi('Chimpy', 'nasa', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
    // Give the test user some access.
    await owner.updateWorkspacePermissions(wsId, {
      users: { [testLowerEmail]: 'editors' }
    });
  });

  afterEach(async function() {
    for (const cli of clients) {
      await cli.send("closeDoc", 0);
      await cli.close();
    }
    await server.stop();
  });

  it('access rules matches email to user-attributes case-insensitively', async function() {
    // Log in with a simulated provider giving a non-lowercase capitalization.
    const cookie = await server.getCookieLogin('nasa', {email: testDisplayEmail, name: 'Chimpy'});
    const resp = await axios.get(`${serverUrl}/o/nasa/api/profile/user`, cookie);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.email, testDisplayEmail);
    assert.equal(resp.data.loginEmail, testLowerEmail);

    const docId = await owner.newDoc({name: 'UserAttributes1'}, wsId);

    // The document we set up has two tables and a bunch of rules:
    // 'People' table, with EmailAddress column, is the user-attribute table.
    // 'Projects' table is what we use to test access. It has a Ref:People column and Email. We
    // have several rules, each determining access to one of the TagX columns. We verify access
    // by checking which cells in the TagX columns show up as censored.
    const peopleData = toTableDataAction('People', tableToColValues([
      ['id', 'EmailAddress'],
      [1,    'alice@example.com'],
      [2,    testLowerEmail],
    ]));
    const projectsData = toTableDataAction('Projects', tableToColValues([
      ['id', 'Person', 'Email',             'TagByRef', 'TagByEmail', 'TagByEmailLower' ],
      [1,    1,        'alice@example.com', 'ok',       'ok',         'ok'              ],
      [2,    2,        testLowerEmail,      'ok',       'ok',         'ok',             ],
      [3,    2,        testDisplayEmail,    'ok',       'ok',         'ok'              ],
    ]));
    await owner.applyUserActions(docId, [
      ['AddTable', 'People', [
        {id: 'EmailAddress'}
      ]],
      ['AddTable', 'Projects', [
        {id: 'Person', type: 'Ref:People'},
        {id: 'Email'},
        {id: 'TagByRef'},
        {id: 'TagByEmail'},
        {id: 'TagByEmailLower'},
      ]],
      ['BulkAddRecord', 'People', peopleData[2], peopleData[3]],
      ['BulkAddRecord', 'Projects', projectsData[2], projectsData[3]],
      ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
      ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Projects', colIds: 'TagByRef'}],
      ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Projects', colIds: 'TagByEmail'}],
      ['AddRecord', '_grist_ACLResources', -4, {tableId: 'Projects', colIds: 'TagByEmailLower'}],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -1, userAttributes: JSON.stringify({
          name: 'Person',
          tableId: 'People',
          charId: 'Email',
          lookupColId: 'EmailAddress',
        })
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -2,   // TagByRef
        aclFormula: 'rec.Person != user.Person.id',
        permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -3,   // TagByEmail
        aclFormula: 'rec.Email != user.Email',
        permissionsText: 'none',
      }],
      ['AddRecord', '_grist_ACLRules', null, {
        resource: -4,   // TagByEmailLower
        aclFormula: 'rec.Email != user.Email.lower()',
        permissionsText: 'none',
      }],
    ]);

    const Cens: CellValue = [GristObjCode.Censored];
    const expectedFixApi = tableToColValues([
      ['id', 'Person', 'Email',               'TagByRef', 'TagByEmail', 'TagByEmailLower'],
      [1,    1,        'alice@example.com',   Cens,       Cens,         Cens,            ],
      [2,    2,        'charon@getgrist.com', 'ok',       'ok',         'ok',            ],
      [3,    2,        'Charon@gEtGrIsT.com', 'ok',       Cens,         Cens,             ],
    ]);
    const expectedFixWs = tableToColValues([
      ['id', 'Person', 'Email',               'TagByRef', 'TagByEmail', 'TagByEmailLower'],
      [1,    1,        'alice@example.com',   Cens,       Cens,         Cens,            ],
      [2,    2,        'charon@getgrist.com', 'ok',       Cens,         'ok',            ],
      [3,    2,        'Charon@gEtGrIsT.com', 'ok',       'ok',         Cens,            ],
    ]);

    async function testExpected() {
      const userApi = new UserAPIImpl(`${serverUrl}/o/nasa`, {
        fetch: fetch as any,
        headers: {Cookie: cookie.headers.Cookie},
        newFormData: () => new FormData() as any,
      });
      const actualDataApi = await userApi.getDocAPI(docId).getRows('Projects');
      delete actualDataApi.manualSort;
      assert.deepEqual(actualDataApi, expectedFixApi);

      const client = await openClient(server.server, testDisplayEmail, 'nasa');
      await client.openDocOnConnect(docId);
      clients.push(client);
      const actualDataWs = fromTableDataAction((await client.send('fetchTable', 0, 'Projects')).data);
      delete actualDataWs.manualSort;
      assert.deepEqual(actualDataWs, expectedFixWs);
    }

    await testExpected();

    // Now change the user-attribute table to use the non-lowercase email version. It shouldn't
    // affect the matching in the user-attribute table, so we expect unchanged results.
    await owner.applyUserActions(docId, [
      ['UpdateRecord', 'People', 2, {EmailAddress: testDisplayEmail}],
    ]);
    await testExpected();
  });
});

/**
 * Tables an array of rows, each an array of CellValues, with the first row containing column
 * headers, including the "id" column. Returns a TableColValues object, mapping each column ID to
 * an array of values for that column.
 */
function tableToColValues(rowData: CellValue[][]): TableColValues {
  const colIds = rowData[0];
  const rows = rowData.slice(1);
  return Object.fromEntries(colIds.map((colId, i) => [colId, rows.map(r => r[i])]));
}
