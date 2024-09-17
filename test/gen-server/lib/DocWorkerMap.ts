import {DocWorkerMap, getDocWorkerMap} from 'app/gen-server/lib/DocWorkerMap';
import {DocStatus, DocWorkerInfo, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import {FlexServer} from 'app/server/lib/FlexServer';
import {Permit} from 'app/server/lib/Permit';
import {MergedServer} from "app/server/MergedServer";
import {delay, promisifyAll} from 'bluebird';
import {assert, expect} from 'chai';
import {countBy, values} from 'lodash';
import {createClient, RedisClient} from 'redis';
import {TestSession} from 'test/gen-server/apiUtils';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import sinon from 'sinon';
import * as testUtils from 'test/server/testUtils';

promisifyAll(RedisClient.prototype);

describe('DocWorkerMap', function() {

  let cli: RedisClient;

  testUtils.setTmpLogLevel('error');

  before(async function() {
    if (!process.env.TEST_REDIS_URL) { this.skip(); }
    cli = createClient(process.env.TEST_REDIS_URL);
    await cli.flushdbAsync();
  });

  after(async function() {
    if (cli) { await cli.quitAsync(); }
  });

  beforeEach(async function() {
    if (cli) { await cli.delAsync('groups'); }
  });

  afterEach(async function() {
    if (cli) { await cli.flushdbAsync(); }
  });

  it('can assign a worker when available', async function() {
    const workers = new DocWorkerMap([cli]);

    // No assignment without workers available
    await assert.isRejected(workers.assignDocWorker('a-doc'), /no doc workers/);

    // Add a worker
    await workers.addWorker({id: 'worker1', internalUrl: 'internal', publicUrl: 'public'});

    // Still no assignment
    await assert.isRejected(workers.assignDocWorker('a-doc'), /no doc workers/);

    // Make worker available
    await workers.setWorkerAvailability('worker1', true);

    // That worker gets assigned
    const worker = await workers.assignDocWorker('a-doc');
    assert.equal(worker.docWorker.id, 'worker1');

    // That assignment is remembered
    let w = await workers.getDocWorker('a-doc');
    assert.equal(w && w.docWorker.id, 'worker1');

    // Make worker unavailable for assigment
    await workers.setWorkerAvailability('worker1', false);

    // Existing assignment remains
    w = await workers.getDocWorker('a-doc');
    assert.equal(w && w.docWorker.id, 'worker1');

    // Remove worker
    await workers.removeWorker('worker1');

    // Assignment is gone away
    w = await workers.getDocWorker('a-doc');
    assert.equal(w, null);
  });

  it('can release assignments', async function() {
    const workers = new DocWorkerMap([cli]);

    await workers.addWorker({id: 'worker1', internalUrl: 'internal', publicUrl: 'public'});
    await workers.addWorker({id: 'worker2', internalUrl: 'internal', publicUrl: 'public'});

    await workers.setWorkerAvailability('worker1', true);

    let assignment: DocStatus|null = await workers.assignDocWorker('a-doc');
    assert.equal(assignment.docWorker.id, 'worker1');

    await workers.setWorkerAvailability('worker2', true);
    await workers.setWorkerAvailability('worker1', false);

    assignment = await workers.getDocWorker('a-doc');
    assert.equal(assignment!.docWorker.id, 'worker1');

    await workers.releaseAssignment('worker1', 'a-doc');

    assignment = await workers.getDocWorker('a-doc');
    assert.equal(assignment, null);

    assignment = await workers.assignDocWorker('a-doc');
    assert.equal(assignment.docWorker.id, 'worker2');
  });

  it('can assign multiple workers', async function() {
    this.timeout(5000);   // Be more generous than 2s default, since this normally takes over 1s.

    const workers = new DocWorkerMap([cli]);

    // Make some workers available
    const W = 4;
    for (let i = 0; i < W; i++) {
      await workers.addWorker({id: `worker${i}`, internalUrl: 'internal', publicUrl: 'public'});
      await workers.setWorkerAvailability(`worker${i}`, true);
    }

    // Assign some docs
    const N = 100;
    const docs: string[] = [];
    const docWorkers: string[] = [];
    for (let i = 0; i < N; i++) {
      const name = `a-doc-${i}`;
      docs.push(name);
      const w = await workers.assignDocWorker(name);
      docWorkers.push(w.docWorker.id);
    }

    // Check assignment looks plausible (random, so will fail with low prob)
    const counts = countBy(docWorkers);
    // Say over half the workers got assigned
    assert.isAbove(values(counts).length, W / 2);
    // Say no worker got over half the work
    const highs = values(counts).filter((k, v) => v > N / 2);
    assert.equal(highs.length, 0);

    // Check assignments stick
    for (let i = 0; i < N; i++) {
      const name = docs[i];
      const w = await workers.getDocWorker(name);
      assert.equal(w && w.docWorker.id, docWorkers[i]);
    }

    // Check assignments drop out as workers are removed
    let remaining = N;
    for (const w of Object.keys(counts)) {
      await workers.removeWorker(w);
      remaining -= counts[w];
      let ct = 0;
      for (const name of docs) {
        if (null !== await workers.getDocWorker(name)) { ct++; }
      }
      assert.equal(remaining, ct);
    }
    assert.equal(remaining, 0);
  });

  it('can elect workers to groups', async function() {
    this.timeout(5000);

    // Say we want one worker reserved for "blizzard" and two for "funkytown"
    await cli.hmsetAsync('groups', {
      blizzard: 1,
      funkytown: 2,
    });
    for (let i = 0; i < 20; i++) {
      await cli.setAsync(`doc-blizzard${i}-group`, 'blizzard');
      await cli.setAsync(`doc-funkytown${i}-group`, 'funkytown');
    }
    let workers = new DocWorkerMap([cli], 'ver1');
    for (let i = 0; i < 5; i++) {
      await workers.addWorker({id: `worker${i}`, internalUrl: 'internal', publicUrl: 'public'});
      await workers.setWorkerAvailability(`worker${i}`, true);
    }
    let elections = await cli.hgetallAsync('elections-ver1');
    assert.deepEqual(elections, { blizzard: '["worker0"]', funkytown: '["worker1","worker2"]' });
    assert.sameMembers(await cli.smembersAsync('workers-available-blizzard'), ['worker0']);
    assert.sameMembers(await cli.smembersAsync('workers-available-funkytown'), ['worker1', 'worker2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-default'), ['worker3', 'worker4']);
    assert.sameMembers(await cli.smembersAsync('workers-available'),
                       ['worker0', 'worker1', 'worker2', 'worker3', 'worker4']);
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`blizzard${i}`);
      assert.equal(assignment.docWorker.id, 'worker0');
    }
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`funkytown${i}`);
      assert.include(['worker1', 'worker2'], assignment.docWorker.id);
   }
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`random${i}`);
      assert.include(['worker3', 'worker4'], assignment.docWorker.id);
    }

    // suppose worker0 dies, and worker5 is added to replace it
    await workers.removeWorker('worker0');
    await workers.addWorker({id: `worker5`, internalUrl: 'internal', publicUrl: 'public'});
    await workers.setWorkerAvailability('worker5', true);
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`blizzard${i}`);
      assert.equal(assignment.docWorker.id, 'worker5');
    }

    // suppose worker1 dies, and worker6 is added to replace it
    await workers.removeWorker('worker1');
    await workers.addWorker({id: `worker6`, internalUrl: 'internal', publicUrl: 'public'});
    await workers.setWorkerAvailability('worker6', true);
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`funkytown${i}`);
      assert.include(['worker2', 'worker6'], assignment.docWorker.id);
    }

    // suppose we add a new deployment...
    workers = new DocWorkerMap([cli], 'ver2');
    for (let i = 0; i < 5; i++) {
      await workers.addWorker({id: `worker${i}_v2`, internalUrl: 'internal', publicUrl: 'public'});
      await workers.setWorkerAvailability(`worker${i}_v2`, true);
    }
    assert.sameMembers(await cli.smembersAsync('workers-available-blizzard'),
                       ['worker5', 'worker0_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-funkytown'),
                       ['worker2', 'worker6', 'worker1_v2', 'worker2_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-default'),
                       ['worker3', 'worker4', 'worker3_v2', 'worker4_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available'),
                       ['worker2', 'worker3', 'worker4', 'worker5', 'worker6',
                        'worker0_v2', 'worker1_v2', 'worker2_v2', 'worker3_v2', 'worker4_v2']);

    // ...and then remove the old one
    workers = new DocWorkerMap([cli], 'ver1');
    for (let i = 0; i < 7; i++) {
      await workers.removeWorker(`worker${i}`);
    }

    // check everything looks as expected
    workers = new DocWorkerMap([cli], 'ver2');
    elections = await cli.hgetallAsync('elections-ver2');
    assert.deepEqual(elections, { blizzard: '["worker0_v2"]',
                                  funkytown: '["worker1_v2","worker2_v2"]' });
    assert.sameMembers(await cli.smembersAsync('workers-available-blizzard'), ['worker0_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-funkytown'), ['worker1_v2', 'worker2_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-default'), ['worker3_v2', 'worker4_v2']);
    assert.sameMembers(await cli.smembersAsync('workers-available'),
                       ['worker0_v2', 'worker1_v2', 'worker2_v2', 'worker3_v2', 'worker4_v2']);
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`blizzard${i}`);
      assert.equal(assignment.docWorker.id, 'worker0_v2');
    }
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`funkytown${i}`);
      assert.include(['worker1_v2', 'worker2_v2'], assignment.docWorker.id);
   }
    for (let i = 0; i < 20; i++) {
      const assignment = await workers.assignDocWorker(`random${i}`);
      assert.include(['worker3_v2', 'worker4_v2'], assignment.docWorker.id);
    }

    // check everything about previous deployment got cleaned up
    assert.equal(await cli.hgetallAsync('elections-ver1'), null);
  });

  it('can assign workers to groups', async function() {
    this.timeout(5000);
    const workers = new DocWorkerMap([cli], 'ver1');

    // Register a few regular workers.
    for (let i = 0; i < 3; i++) {
      await workers.addWorker({id: `worker${i}`, internalUrl: 'internal', publicUrl: 'public'});
      await workers.setWorkerAvailability(`worker${i}`, true);
    }

    // Register a worker in a special group.
    await workers.addWorker({id: 'worker_secondary', internalUrl: 'internal', publicUrl: 'public',
                             group: 'secondary'});
    await workers.setWorkerAvailability('worker_secondary', true);

    // Check that worker lists look sane.
    assert.sameMembers(await cli.smembersAsync('workers'),
                       ['worker0', 'worker1', 'worker2', 'worker_secondary']);
    assert.sameMembers(await cli.smembersAsync('workers-available'),
                       ['worker0', 'worker1', 'worker2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-default'),
                       ['worker0', 'worker1', 'worker2']);
    assert.sameMembers(await cli.smembersAsync('workers-available-secondary'),
                       ['worker_secondary']);

    // Check that worker-*-group keys are as expected.
    assert.equal(await cli.getAsync('worker-worker_secondary-group'), 'secondary');
    assert.equal(await cli.getAsync('worker-worker0-group'), null);

    // Check that a doc for the special group is assigned to the correct worker.
    await cli.setAsync('doc-funkydoc-group', 'secondary');
    assert.equal((await workers.assignDocWorker('funkydoc')).docWorker.id, 'worker_secondary');

    // Check that other docs don't end up on the special group's worker.
    for (let i = 0; i < 50; i++) {
      assert.match((await workers.assignDocWorker(`normaldoc${i}`)).docWorker.id,
                   /^worker\d$/);
    }
  });

  it('can manage task election nominations', async function() {
    this.timeout(5000);

    const store = new DocWorkerMap([cli]);
    // allocate two tasks
    const task1 = await store.getElection('task1', 1000);
    let task2 = await store.getElection('task2', 1000);
    assert.notEqual(task1, null);
    assert.notEqual(task2, null);
    assert.notEqual(task1, task2);

    // check tasks cannot be immediately reallocated
    assert.equal(await store.getElection('task1', 1000), null);
    assert.equal(await store.getElection('task2', 1000), null);

    // try to remove both tasks with a key that is correct for just one of them.
    await assert.isRejected(store.removeElection('task1', task2!), /could not remove/);
    await store.removeElection('task2', task2!);

    // check task2 is freed up by reallocating it
    task2 = await store.getElection('task2', 3000);
    assert.notEqual(task2, null);

    await delay(1100);

    // task1 should be free now, but not task2
    const task1b = await store.getElection('task1', 1000);
    assert.notEqual(task1b, null);
    assert.notEqual(task1b, task1);
    assert.equal(await store.getElection('task2', 1000), null);
  });

  it('can manage permits', async function() {
    const store = new DocWorkerMap([cli], undefined, {permitMsec: 1000}).getPermitStore('1');

    // Make a doc permit and a workspace permit
    const permit1: Permit = {docId: 'docId1'};
    const key1 = await store.setPermit(permit1);
    assert(key1.startsWith('permit-1-'));
    const permit2: Permit = {workspaceId: 99};
    const key2 = await store.setPermit(permit2);
    assert(key2.startsWith('permit-1-'));
    assert.notEqual(key1, key2);

    // Check we can read the permits back
    assert.deepEqual(await store.getPermit(key1), permit1);
    assert.deepEqual(await store.getPermit(key2), permit2);

    // Check that random permit keys give nothing
    await assert.isRejected(store.getPermit('dud'), /could not be read/);
    assert.equal(await store.getPermit('permit-1-dud'), null);

    // Check that we can remove a permit
    await store.removePermit(key1);
    assert.equal(await store.getPermit(key1), null);
    assert.deepEqual(await store.getPermit(key2), permit2);

    // Check that permits expire
    await delay(1100);
    assert.equal(await store.getPermit(key2), null);

    // make sure permit stores are distinct
    const store2 = new DocWorkerMap([cli], undefined, {permitMsec: 1000}).getPermitStore('2');
    const key3 = await store2.setPermit(permit1);
    assert(key3.startsWith('permit-2-'));
    const fakeKey3 = key3.replace('permit-2-', 'permit-1-');
    assert(fakeKey3.startsWith('permit-1-'));
    assert.equal(await store.getPermit(fakeKey3), null);
    await assert.isRejected(store.getPermit(key3), /could not be read/);
    assert.deepEqual(await store2.getPermit(key3), permit1);
    await assert.isRejected(store2.getPermit(fakeKey3), /could not be read/);
  });

  describe('group assignment', function() {
    let servers: {[key: string]: FlexServer};
    let workers: IDocWorkerMap;
    before(async function() {
      // Create a home server and some workers.
      setUpDB(this);
      await createInitialDb();
      const opts = {logToConsole: false, externalStorage: false};
      // We need to reset some environment variables - we do so
      // naively, so throw if they are already set.
      assert.equal(process.env.REDIS_URL, undefined);
      assert.equal(process.env.GRIST_DOC_WORKER_ID, undefined);
      assert.equal(process.env.GRIST_WORKER_GROUP, undefined);
      process.env.REDIS_URL = process.env.TEST_REDIS_URL;

      // Make home server.
      const homeMergedServer = await MergedServer.create(0, ['home'], opts);
      const home = homeMergedServer.flexServer;
      await homeMergedServer.run();

      // Make a worker, not associated with any group.
      process.env.GRIST_DOC_WORKER_ID = 'worker1';
      const docs1MergedServer = await MergedServer.create(0, ['docs'], opts);
      const docs1 = docs1MergedServer.flexServer;
      await docs1MergedServer.run();

      // Make a worker in "special" group.
      process.env.GRIST_DOC_WORKER_ID = 'worker2';
      process.env.GRIST_WORKER_GROUP = 'special';
      const docs2MergedServer = await MergedServer.create(0, ['docs'], opts);
      const docs2 = docs2MergedServer.flexServer;
      await docs2MergedServer.run();

      // Make two worker in "other" group.
      process.env.GRIST_DOC_WORKER_ID = 'worker3';
      process.env.GRIST_WORKER_GROUP = 'other';
      const docs3MergedServer = await MergedServer.create(0, ['docs'], opts);
      const docs3 = docs3MergedServer.flexServer;
      await docs3MergedServer.run();
      process.env.GRIST_DOC_WORKER_ID = 'worker4';
      process.env.GRIST_WORKER_GROUP = 'other';
      const docs4MergedServer = await MergedServer.create(0, ['docs'], opts);
      const docs4 = docs4MergedServer.flexServer;
      await docs4MergedServer.run();

      servers = {home, docs1, docs2, docs3, docs4};
      workers = getDocWorkerMap();
    });

    after(async function() {
      if (servers) {
        await Promise.all(Object.values(servers).map(server => server.close()));
        await removeConnection();
        delete process.env.REDIS_URL;
        delete process.env.GRIST_DOC_WORKER_ID;
        delete process.env.GRIST_WORKER_GROUP;
        await workers.close();
      }
    });

    it('can reassign documents between groups', async function() {
      this.timeout(15000);

      // Create a test documment.
      const session = new TestSession(servers.home!);
      const api = await session.createHomeApi('chimpy', 'nasa');
      const supportApi = await session.createHomeApi('support', 'docs', true);
      const ws1 = await api.newWorkspace({name: 'ws1'}, 'current');
      const doc1 = await api.newDoc({name: 'doc1'}, ws1);

      // Exercise it.
      await api.getDocAPI(doc1).getRows('Table1');

      // Check it is served by only unspecialized worker.
      assert.equal((await workers.getDocWorker(doc1))?.docWorker.id, 'worker1');

      // Set doc to "special" group.
      await cli.setAsync(`doc-${doc1}-group`, 'special');

      // Check doc gets reassigned to correct worker.
      assert.equal(await (await api.testRequest(`${api.getBaseUrl()}/api/docs/${doc1}/assign`, {
        method: 'POST'
      })).json(), true);
      await api.getDocAPI(doc1).getRows('Table1');
      assert.equal((await workers.getDocWorker(doc1))?.docWorker.id, 'worker2');

      // Set doc to "other" group.
      await cli.setAsync(`doc-${doc1}-group`, 'other');

      // Check doc gets reassigned to one of the correct workers.
      assert.equal(await (await api.testRequest(`${api.getBaseUrl()}/api/docs/${doc1}/assign`, {
        method: 'POST'
      })).json(), true);
      await api.getDocAPI(doc1).getRows('Table1');
      assert.oneOf((await workers.getDocWorker(doc1))?.docWorker.id, ['worker3', 'worker4']);

      // Remove doc from groups.
      await cli.delAsync(`doc-${doc1}-group`);
      assert.equal(await (await api.testRequest(`${api.getBaseUrl()}/api/docs/${doc1}/assign`, {
        method: 'POST'
      })).json(), true);
      await api.getDocAPI(doc1).getRows('Table1');

      // Check doc is again served by only unspecialized worker.
      assert.equal((await workers.getDocWorker(doc1))?.docWorker.id, 'worker1');

      // Check that hitting /assign without a change of group is reported as no-op (false).
      assert.equal(await (await api.testRequest(`${api.getBaseUrl()}/api/docs/${doc1}/assign`, {
        method: 'POST'
      })).json(), false);

      // Check that Chimpy can't use `group` param to update doc group prior to reassignment.
      const urlWithGroup = new URL(`${api.getBaseUrl()}/api/docs/${doc1}/assign`);
      urlWithGroup.searchParams.set('group', 'special');
      assert.equal(await (await api.testRequest(urlWithGroup.toString(), {
        method: 'POST'
      })).json(), false);

      // Check that support user can use `group` param in housekeeping endpoint to update
      // doc group prior to reassignment.
      const housekeepingUrl = new URL(`${api.getBaseUrl()}/api/housekeeping/docs/${doc1}/assign`);
      housekeepingUrl.searchParams.set('group', 'special');
      assert.equal(await (await supportApi.testRequest(housekeepingUrl.toString(), {
        method: 'POST'
      })).json(), true);
      await api.getDocAPI(doc1).getRows('Table1');
      assert.equal((await workers.getDocWorker(doc1))?.docWorker.id, 'worker2');

      // Check that hitting housekeeping endpoint with the same group is reported as no-op (false).
      assert.equal(await (await supportApi.testRequest(housekeepingUrl.toString(), {
        method: 'POST'
      })).json(), false);

      // Check that specifying a blank group reverts back to the unspecialized worker.
      housekeepingUrl.searchParams.set('group', '');
      assert.equal(await (await supportApi.testRequest(housekeepingUrl.toString(), {
        method: 'POST'
      })).json(), true);
      await api.getDocAPI(doc1).getRows('Table1');
      assert.equal((await workers.getDocWorker(doc1))?.docWorker.id, 'worker1');
    });
  });

  describe('isWorkerRegistered', () => {
    const baseWorkerInfo: DocWorkerInfo = {
      id: 'workerId',
      internalUrl: 'internalUrl',
      publicUrl: 'publicUrl',
      group: undefined
    };

    [
      {
        itMsg: 'should check if worker is registered',
        sisMemberAsyncResolves: 1,
        expectedResult: true,
        expectedKey: 'workers-available-default'
      },
      {
        itMsg: 'should check if worker is registered in a certain group',
        sisMemberAsyncResolves: 1,
        group: 'dummygroup',
        expectedResult: true,
        expectedKey: 'workers-available-dummygroup'
      },
      {
        itMsg: 'should return false if worker is not registered',
        sisMemberAsyncResolves: 0,
        expectedResult: false,
        expectedKey: 'workers-available-default'
      }
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        const sismemberAsyncStub = sinon.stub().resolves(ctx.sisMemberAsyncResolves);
        const stubDocWorkerMap = {
          _client: { sismemberAsync: sismemberAsyncStub }
        };
        const result = await DocWorkerMap.prototype.isWorkerRegistered.call(
          stubDocWorkerMap, {...baseWorkerInfo, group: ctx.group }
        );
        expect(result).to.equal(ctx.expectedResult);
        expect(sismemberAsyncStub.calledOnceWith(ctx.expectedKey, baseWorkerInfo.id)).to.equal(true);
      });
    });
  });
});
