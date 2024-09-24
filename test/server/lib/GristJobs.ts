import { delay } from 'app/common/delay';
import { GristBullMQJobs, GristJobs } from 'app/server/lib/GristJobs';
import { assert } from 'chai';

describe('GristJobs', function() {
  this.timeout(20000);

  // Clean up any jobs left over from previous round of tests.
  beforeEach(async function() {
    const jobs = new GristBullMQJobs();
    const q = jobs.queue();
    await q.stop({obliterate: true});
  });

  it('can run immediate jobs', async function() {
    const jobs: GristJobs = new GristBullMQJobs();
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
    const jobs: GristJobs = new GristBullMQJobs();
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
    const jobs: GristJobs = new GristBullMQJobs();
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

  it('can pick up jobs again', async function() {
    // this test is only appropriate if we have an external queue.
    if (!process.env.REDIS_URL) { this.skip(); }
    const jobs1: GristJobs = new GristBullMQJobs();
    const q = jobs1.queue();
    try {
      let ct = 0;
      q.handleName('add', async (job) => {
        ct += job.data.delta;
      });
      q.handleDefault(async () => {});
      await q.add('add', {delta: 1}, {delay: 250});
      await q.add('add', {delta: 1}, {delay: 1000});
      await delay(500);
      assert.equal(ct, 1);
      await jobs1.stop();
      const jobs2: GristJobs = new GristBullMQJobs();
      const q2 = jobs2.queue();
      try {
        q2.handleName('add', async (job) => {
          ct += job.data.delta * 2;
        });
        q2.handleDefault(async () => {});
        await delay(1000);
        assert.equal(ct, 3);
      } finally {
        await jobs2.stop({obliterate: true});
      }
    } finally {
      await jobs1.stop({obliterate: true});
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
