import { delay } from 'app/common/delay';
import { GristJobs } from 'app/server/lib/GristJobs';
import { assert } from 'chai';

describe('GristJobs', function() {
  this.timeout(20000);

  it('can run immediate jobs', async function() {
    const jobs = new GristJobs();
    const q = jobs.queue();
    try {
      let ct = 0;
      let defaultCt = 0;
      q.handleName('add', async (job) => {
        ct += job.data.delta;
      });
      q.handleDefault(async (job) => {
        defaultCt++;
      });
      await q.add('add', {delta: 2});
      await waitToPass(async () => {
        assert.equal(ct, 2);
        assert.equal(defaultCt, 0);
      });
      await q.add('add', {delta: 3});
      await waitToPass(async () => {
        assert.equal(ct, 5);
        assert.equal(defaultCt, 0);
      });
      await q.add('badd', {delta: 4});
      await waitToPass(async () => {
        assert.equal(ct, 5);
        assert.equal(defaultCt, 1);
      });
    } finally {
      await jobs.stop({obliterate: true});
    }
  });

  it('can run delayed jobs', async function() {
    const jobs = new GristJobs();
    const q = jobs.queue();
    try {
      let ct = 0;
      let defaultCt = 0;
      q.handleName('add', async (job) => {
        ct += job.data.delta;
      });
      q.handleDefault(async () => {
        defaultCt++;
      });
      await q.add('add', {delta: 2}, {delay: 500});
      assert.equal(ct, 0);
      assert.equal(defaultCt, 0);
      // We need to wait long enough to see the effect.
      await delay(100);
      assert.equal(ct, 0);
      assert.equal(defaultCt, 0);
      await delay(900);
      assert.equal(ct, 2);
      assert.equal(defaultCt, 0);
    } finally {
      await jobs.stop({obliterate: true});
    }
  });

  it('can run repeated jobs', async function() {
    const jobs = new GristJobs();
    const q = jobs.queue();
    try {
      let ct = 0;
      let defaultCt = 0;
      q.handleName('add', async (job) => {
        ct += job.data.delta;
      });
      q.handleDefault(async () => {
        defaultCt++;
      });
      await q.add('add', {delta: 2}, {repeat: {every: 250}});
      await q.add('badd', {delta: 2}, {repeat: {every: 100}});
      assert.equal(ct, 0);
      assert.equal(defaultCt, 0);
      await delay(1000);
      // allow for a lot of slop on CI
      assert.isAtLeast(ct, 8 - 4);
      assert.isAtMost(ct, 8 + 4);
      assert.isAtLeast(defaultCt, 10 - 3);
      assert.isAtMost(defaultCt, 10 + 3);
    } finally {
      await jobs.stop({obliterate: true});
    }
  });
});

async function waitToPass(fn: () => Promise<void>,
                          maxWaitMs: number = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await fn();
      return true;
    } catch (e) {
      // continue after a small delay.
      await delay(10);
    }
  }
  await fn();
  return true;
}
