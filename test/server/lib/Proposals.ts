import {DocAPI, UserAPI} from 'app/common/UserAPI';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import {createTmpDir} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';

describe('Proposals', function() {
  this.timeout(40000);
  let server: TestServer;
  let owner: UserAPI;
  let wsId: number;
  let oldEnv: testUtils.EnvironmentSnapshot;
  let oldLogLevel: testUtils.NestedLogLevel;

  before(async function() {
    oldLogLevel = testUtils.nestLogLevel('error');
    oldEnv = new testUtils.EnvironmentSnapshot();
    const tmpDir = await createTmpDir();
    process.env.GRIST_DATA_DIR = tmpDir;
    server = new TestServer(this);
    await server.start(['home', 'docs']);
    const api = await server.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await server.createHomeApi('chimpy', 'testy', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
  });

  after(async function() {
    const api = await server.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await server.stop();
    oldEnv.restore();
    oldLogLevel.restore();
  });

  async function testApply(options: {
    modifyAfterProposal?: (trunkApi: DocAPI, forkApi: DocAPI) => Promise<void>,
    testAfterApply?: (trunkApi: DocAPI, forkApi: DocAPI) => Promise<void>,
  }) {
    const docId = await owner.newDoc({name: 'doc'}, wsId);
    const docApi = owner.getDocAPI(docId);
    await docApi.addRows('Table1', {
      A: ['x', 'y'],
      B: [100, 200],
    });
    const forkResult = await docApi.fork();
    const forkApi = owner.getDocAPI(forkResult.urlId);
    await forkApi.updateRows('Table1', {
      id: [2],
      A: ['yy'],
    });
    const proposal = await forkApi.makeProposal();
    assert.equal(proposal.shortId, 1);
    assert.equal(proposal.comparison.comparison?.summary, 'left');
    const changes = proposal.comparison.comparison?.details?.leftChanges;
    assert.deepEqual(changes, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [2],
          removeRows: [],
          addRows: [],
          columnDeltas: { A: {2: [["y"], ["yy"]]} },
          columnRenames: [],
        }
      }
    });
    const query = 'select A from Table1 where id = 2';
    assert.deepEqual((await docApi.sql(query)).records, [
      { fields: { A: 'y' } }
    ]);
    assert.deepEqual((await forkApi.sql(query)).records, [
      { fields: { A: 'yy' } }
    ]);
    await options.modifyAfterProposal?.(docApi, forkApi);
    await docApi.applyProposal(proposal.shortId);
    await options.testAfterApply?.(docApi, forkApi);
  }

  it('can make and apply a simple proposal', async function() {
    await testApply({
      async modifyAfterProposal() {},
      async testAfterApply(trunkApi) {
        const query = 'select A from Table1 where id = 2';
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { A: 'yy' } }
        ]);
      },
    });
  });

  it('can apply a proposal after a table rename', async function() {
    await testApply({
      async modifyAfterProposal(trunkApi) {
        await trunkApi.applyUserActions([
          ['RenameTable', 'Table1', 'Table2'],
        ]);
      },
      async testAfterApply(trunkApi) {
        const query = 'select A from Table2 where id = 2';
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { A: 'yy' } }
        ]);
      },
    });
  });

  it('can apply a proposal after a column rename', async function() {
    await testApply({
      async modifyAfterProposal(trunkApi) {
        await trunkApi.applyUserActions([
          ['RenameColumn', 'Table1', 'A', 'AA'],
        ]);
      },
      async testAfterApply(trunkApi) {
        const query = 'select AA from Table1 where id = 2';
        assert.deepEqual((await trunkApi.sql(query)).records, [
          { fields: { AA: 'yy' } }
        ]);
      },
    });
  });

  it('can apply a proposal that includes a formula column', async function() {
    const docId = await owner.newDoc({name: 'doc'}, wsId);
    const docApi = owner.getDocAPI(docId);
    await docApi.addRows('Table1', {
      A: ['x', 'y'],
      B: [100, 200],
    });
    await docApi.applyUserActions([
      // Add a real formula column
      ['AddColumn', 'Table1', 'F', {
        type: 'Text',
        isFormula: true,
        formula: '"quote " + str($A) + " unquote"',
      }],
      // Add an empty column
      ['AddColumn', 'Table1', 'E', {
        type: 'Any',
        isFormula: true,
      }],
    ]);
    const forkResult = await docApi.fork();
    const forkApi = owner.getDocAPI(forkResult.urlId);
    await forkApi.updateRows('Table1', {
      id: [2],
      A: ['yy'],
      E: [20],
    });
    await forkApi.addRows('Table1', {
      A: ['zz'],
    });
    const proposal = await forkApi.makeProposal();
    await docApi.applyProposal(proposal.shortId);
    const query = 'select A, E, F from Table1 where id = 2 or id = 3';
    assert.deepEqual((await docApi.sql(query)).records, [
      { fields: { A: 'yy', E: 20, F: "quote yy unquote" } },
      { fields: { A: 'zz', E: 0,  F: "quote zz unquote" } },
    ]);
  });
});
