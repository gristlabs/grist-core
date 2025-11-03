import { TelemetryEvent, TelemetryMetadataByLevel } from 'app/common/Telemetry';
import { Document } from 'app/gen-server/entity/Document';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { Housekeeper } from 'app/gen-server/lib/Housekeeper';
import { Telemetry } from 'app/server/lib/Telemetry';
import { assert } from 'chai';
import * as fse from 'fs-extra';
import moment from 'moment';
import * as sinon from 'sinon';
import { TestServer } from 'test/gen-server/apiUtils';
import { openClient } from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

describe('Housekeeper', function() {
  testUtils.setTmpLogLevel('error');
  this.timeout(60000);

  const org: string = 'testy';
  const sandbox = sinon.createSandbox();
  let home: TestServer;
  let keeper: Housekeeper;

  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = 'ham@getgrist.com';

    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.newOrg({name: org, domain: org});
    keeper = home.server.housekeeper;
    await keeper.stop();
  });

  after(async function() {
    await home.stop();
    sandbox.restore();
    oldEnv.restore();
  });

  async function getDoc(docId: string) {
    const manager = home.dbManager.connection.manager;
    return manager.findOneOrFail(Document, {where: {id: docId}});
  }

  async function getWorkspace(wsId: number) {
    const manager = home.dbManager.connection.manager;
    return manager.findOneOrFail(Workspace, {where: {id: wsId}});
  }


  function daysAgo(days: number): Date {
    return moment().subtract(days, 'days').toDate();
  }

  async function ageDoc(docId: string, days: number) {
    const dbDoc = await getDoc(docId);
    dbDoc.removedAt = daysAgo(days);
    await dbDoc.save();
  }

  async function ageDisabledDoc(docId: string, days: number) {
    const dbDoc = await getDoc(docId);
    dbDoc.disabledAt = daysAgo(days);
    await dbDoc.save();
  }

  async function ageWorkspace(wsId: number, days: number) {
    const dbWorkspace = await getWorkspace(wsId);
    dbWorkspace.removedAt = daysAgo(days);
    await dbWorkspace.save();
  }

  async function ageFork(forkId: string, days: number) {
    const dbFork = await getDoc(forkId);
    dbFork.updatedAt = daysAgo(days);
    await dbFork.save();
  }

  it('can delete old soft-deleted docs and workspaces', async function() {
    // Make four docs in one workspace, two in another.
    const api = await home.createHomeApi('chimpy', org);
    const adminApi = await home.createHomeApi('ham', 'docs', true);
    const ws1 = await api.newWorkspace({name: 'ws1'}, 'current');
    const ws2 = await api.newWorkspace({name: 'ws2'}, 'current');
    const doc11 = await api.newDoc({name: 'doc11'}, ws1);
    const doc12 = await api.newDoc({name: 'doc12'}, ws1);
    const doc13 = await api.newDoc({name: 'doc13'}, ws1);
    const doc14 = await api.newDoc({name: 'doc14'}, ws1);
    const doc15 = await api.newDoc({name: 'doc15'}, ws1);
    const doc21 = await api.newDoc({name: 'doc21'}, ws2);
    const doc22 = await api.newDoc({name: 'doc22'}, ws2);

    // Soft-delete some of the docs, and one workspace.
    await api.softDeleteDoc(doc11);
    await api.softDeleteDoc(doc12);
    await api.softDeleteDoc(doc13);
    await api.softDeleteWorkspace(ws2);
    // Also disable one doc
    await adminApi.disableDoc(doc15);

    // Check that nothing is deleted by housekeeper.
    await keeper.deleteTrash();
    await assert.isFulfilled(getDoc(doc11));
    await assert.isFulfilled(getDoc(doc12));
    await assert.isFulfilled(getDoc(doc13));
    await assert.isFulfilled(getDoc(doc14));
    await assert.isFulfilled(getDoc(doc15));
    await assert.isFulfilled(getDoc(doc21));
    await assert.isFulfilled(getDoc(doc22));
    await assert.isFulfilled(getWorkspace(ws1));
    await assert.isFulfilled(getWorkspace(ws2));

    // Age a doc and workspace somewhat, but not enough to trigger hard-deletion.
    await ageDoc(doc11, 10);
    await ageWorkspace(ws2, 20);
    await keeper.deleteTrash();
    await assert.isFulfilled(getDoc(doc11));
    await assert.isFulfilled(getWorkspace(ws2));

    // Prematurely age two of the soft-deleted docs, and the soft-deleted workspace.
    await ageDoc(doc11, 40);
    await ageDoc(doc12, 40);
    await ageWorkspace(ws2, 40);

    // Make sure that exactly those docs are deleted by housekeeper.
    await keeper.deleteTrash();
    await assert.isRejected(getDoc(doc11));
    await assert.isRejected(getDoc(doc12));
    await assert.isFulfilled(getDoc(doc13));
    await assert.isFulfilled(getDoc(doc14));
    await assert.isRejected(getDoc(doc21));
    await assert.isRejected(getDoc(doc22));
    await assert.isFulfilled(getWorkspace(ws1));
    await assert.isRejected(getWorkspace(ws2));

    // Age disabling time, see doc isn't deleted
    await ageDisabledDoc(doc15, 40);
    await keeper.deleteTrash();
    await assert.isFulfilled(getDoc(doc15));

    // Now age the disabled doc deletion time and check it's deleted
    await ageDoc(doc15, 40);
    await keeper.deleteTrash();
    await assert.isRejected(getDoc(doc15));
  });

  it('enforces exclusivity of housekeeping', async function() {
    const first = keeper.deleteTrashExclusively();
    const second = keeper.deleteTrashExclusively();
    assert.equal(await first, true);
    assert.equal(await second, false);
    assert.equal(await keeper.deleteTrashExclusively(), false);
    await keeper.testClearExclusivity();
    assert.equal(await keeper.deleteTrashExclusively(), true);
  });

  it('can delete old forks', async function() {
    // Make a document with some forks.
    const api = await home.createHomeApi('chimpy', org);
    const ws3 = await api.newWorkspace({name: 'ws3'}, 'current');
    const trunk = await api.newDoc({name: 'trunk'}, ws3);
    const session = await api.getSessionActive();
    const client = await openClient(home.server, session.user.email, session.org?.domain || 'docs');
    await client.openDocOnConnect(trunk);
    const forkResponse1 = await client.send('fork', 0);
    const forkResponse2 = await client.send('fork', 0);
    const forkPath1 = home.server.getStorageManager().getPath(forkResponse1.data.docId);
    const forkPath2 = home.server.getStorageManager().getPath(forkResponse2.data.docId);
    const forkId1 = forkResponse1.data.forkId;
    const forkId2 = forkResponse2.data.forkId;

    // Age the forks somewhat, but not enough to trigger hard-deletion.
    await ageFork(forkId1, 10);
    await ageFork(forkId2, 20);
    await keeper.deleteTrash();
    await assert.isFulfilled(getDoc(forkId1));
    await assert.isFulfilled(getDoc(forkId2));
    assert.equal(await fse.pathExists(forkPath1), true);
    assert.equal(await fse.pathExists(forkPath2), true);

    // Age one of the forks beyond the cleanup threshold.
    await ageFork(forkId2, 40);

    // Make sure that only that fork is deleted by housekeeper.
    await keeper.deleteTrash();
    await assert.isFulfilled(getDoc(forkId1));
    await assert.isRejected(getDoc(forkId2));
    assert.equal(await fse.pathExists(forkPath1), true);
    assert.equal(await fse.pathExists(forkPath2), false);
  });

  it('can log metrics about sites', async function() {
    const logMessages: [TelemetryEvent, TelemetryMetadataByLevel?][] = [];
    sandbox.stub(Telemetry.prototype, 'shouldLogEvent').callsFake((name) => true);
    sandbox.stub(Telemetry.prototype, 'logEvent').callsFake((_, name, meta) => {
      // Skip document usage events that could be arriving in the
      // middle of this test.
      if (name !== 'documentUsage') {
        logMessages.push([name, meta]);
      }
      return Promise.resolve();
    });
    await keeper.logMetrics();
    assert.isNotEmpty(logMessages);
    let [event, meta] = logMessages[0];
    assert.equal(event, 'siteUsage');
    assert.hasAllKeys(meta?.limited, [
      'siteId',
      'siteType',
      'inGoodStanding',
      'numDocs',
      'numWorkspaces',
      'numMembers',
      'lastActivity',
      'earliestDocCreatedAt',
    ]);
    assert.hasAllKeys(meta?.full, [
      'stripePlanId',
    ]);
    [event, meta] = logMessages[logMessages.length - 1];
    assert.equal(event, 'siteMembership');
    assert.hasAllKeys(meta?.limited, [
      'siteId',
      'siteType',
      'numOwners',
      'numEditors',
      'numViewers',
    ]);
    assert.isUndefined(meta?.full);
  });
});
