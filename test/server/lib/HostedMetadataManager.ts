import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {HostedMetadataManager} from 'app/server/lib/HostedMetadataManager';
import {delay} from 'bluebird';
import {assert} from 'chai';
import * as sinon from 'sinon';
import {removeConnection} from 'test/gen-server/seed';
import {setTmpLogLevel} from 'test/server/testUtils';

// Note that this is a stubbed test of the HostedMetadataManager and does not test interaction
// with the live DB. We may want to revisit this with the DB running for a complete test.
describe('HostedMetadataManager', function() {

  setTmpLogLevel('info');

  const sandbox = sinon.createSandbox();
  let manager: HostedMetadataManager;
  let updateCount: number = 0;

  before(async function() {
    const dbManager = new HomeDBManager();
    await dbManager.connect();

    // Stub the function that updates the value in the DB.
    sandbox.stub(HostedMetadataManager.prototype, 'setDocsMetadata').callsFake(() => {
      updateCount += 1;
      return Promise.resolve();
    });

    // Set the manager to make a call every 0.5s.
    manager = new HostedMetadataManager(null as any /* not used since we have stub */, 0.5);
  });

  after(async function() {
    await removeConnection();
    sandbox.restore();
  });

  async function scheduleUpdate(docId: string, minimizeDelay?: boolean) {
    manager.scheduleUpdate(docId, {
      updatedAt: new Date().toISOString(),
      usage: {rowCount: {total: 123}, dataSizeBytes: 456, attachmentsSizeBytes: 789},
    }, minimizeDelay);
    await delay(10);
  }

  it('can throttle push calls', async function() {
    this.timeout(3000);

    // Schedule an update and check that it updates the count quickly.
    await scheduleUpdate('Doc1');
    assert.equal(updateCount, 1);

    // Schedule another update and check that it does not occur immediately, since not enough time
    // has passed for another push.
    await scheduleUpdate('Doc2');
    assert.equal(updateCount, 1);
    await delay(501);
    assert.equal(updateCount, 2);

    // Schedule 5 updates for the same doc. The last push should have just occurred, so
    // none of the updates should happen for 0.5s.
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc1');
    assert.equal(updateCount, 2);
    // All 5 updates should occur as a single update.
    await delay(501);
    assert.equal(updateCount, 3);

    // Wait again to zero out any required delays.
    await delay(500);

    // Schedule multiple updates on multiple docs.
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc2');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc3');
    await scheduleUpdate('Doc4');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc2');
    // One of the updates should have happened immediately.
    assert.equal(updateCount, 4);
    // Wait and assert that despite updating multiple docs, all updates happen in a single call.
    await delay(501);
    assert.equal(updateCount, 5);

    // Zero out any required delays for the next test clause.
    await delay(500);
  });

  it('allows minimizing push delay when scheduling updates', async function() {
    updateCount = 0;

    // Schedule an update with minimizeDelay set, and check that it updates the count immediately.
    await scheduleUpdate('Doc1', true);
    assert.equal(updateCount, 1);

    // Schedule another update and check that it does occur immediately, since minimizeDelay is set.
    await scheduleUpdate('Doc2', true);
    assert.equal(updateCount, 2);

    // Schedule multiple updates on multiple docs.
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc2');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc3');
    await scheduleUpdate('Doc4');
    await scheduleUpdate('Doc1');
    await scheduleUpdate('Doc2');

    // None of the updates should have happened yet.
    assert.equal(updateCount, 2);

    // Schedule an update with minimizeDelay set, and check that it updates the count immediately.
    await scheduleUpdate('Doc1', true);
    assert.equal(updateCount, 3);

    // Wait and assert that no further updates occured, since the last push should have flushed all
    // outstanding doc updates.
    await delay(501);
    assert.equal(updateCount, 3);

    // Zero out any required delays for the next test clause.
    await delay(500);
  });

  it('allows calling close to force send pending requests', async function() {
    updateCount = 0;

    // Schedule an update and check that it updates the count immediately.
    await scheduleUpdate('Doc1');
    assert.equal(updateCount, 1);
    // Schedule another update. Call close on the manager and check that the
    // update occurs quickly.
    await scheduleUpdate('Doc2');
    await manager.close();
    // Push is called immediately, but we delay briefly here to allow the async call to return.
    await delay(10);
    assert.equal(updateCount, 2);
  });
});
