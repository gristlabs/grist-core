import { delay } from "app/common/delay";
import { createGristJobs, GristJobs } from "app/server/lib/GristJobs";
import { EnvironmentSnapshot } from "test/server/testUtils";
import { waitForIt } from "test/server/wait";

import { assert } from "chai";

describe("GristJobs", function() {
  this.timeout(20000);

  // Clean up any jobs left over from previous round of tests,
  // if external queues are in use (Redis).
  beforeEach(async function() {
    const jobs = createGristJobs();
    const q = jobs.queue();
    await q.stop({ obliterate: true });
    await jobs.stop();
  });

  describe("with redis", function() {
    before(async function() {
      if (!process.env.REDIS_URL && !process.env.TEST_REDIS_URL) { this.skip(); }
    });
    runSuite();
  });

  describe("without redis", function() {
    let oldEnv: EnvironmentSnapshot;
    before(async function() {
      oldEnv = new EnvironmentSnapshot();
      delete process.env.REDIS_URL;
      delete process.env.TEST_REDIS_URL;
    });
    after(async function() {
      oldEnv.restore();
    });
    runSuite();
  });

  function runSuite() {
    it("can run immediate jobs", async function() {
      const jobs: GristJobs = createGristJobs();
      const q = jobs.queue();
      try {
        let ct = 0;
        let defaultCt = 0;
        q.handleName("add", async (job) => {
          ct += job.data.delta;
        });
        q.handleDefault(async (job) => {
          defaultCt++;
        });
        await q.add("add", { delta: 2 });
        await waitForIt(async () => {
          assert.equal(ct, 2);
          assert.equal(defaultCt, 0);
        }, 2000, 10);
        await q.add("add", { delta: 3 });
        await waitForIt(async () => {
          assert.equal(ct, 5);
          assert.equal(defaultCt, 0);
        }, 2000, 10);
        await q.add("badd", { delta: 4 });
        await waitForIt(async () => {
          assert.equal(ct, 5);
          assert.equal(defaultCt, 1);
        }, 2000, 10);
      } finally {
        await jobs.stop({ obliterate: true });
      }
    });

    it("can run delayed jobs", async function() {
      const jobs: GristJobs = createGristJobs();
      const q = jobs.queue();
      try {
        let ct = 0;
        let defaultCt = 0;
        q.handleName("add", async (job) => {
          ct += job.data.delta;
        });
        q.handleDefault(async () => {
          defaultCt++;
        });
        await q.add("add", { delta: 2 }, { delay: 500 });
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
        await jobs.stop({ obliterate: true });
      }
    });

    it("can run repeated jobs", async function() {
      const jobs: GristJobs = createGristJobs();
      const q = jobs.queue();
      try {
        let ct = 0;
        let defaultCt = 0;
        const times: number[] = [];
        const defaultTimes: number[] = [];
        q.handleName("add", async (job) => {
          ct += job.data.delta;
          times.push(Date.now());
        });
        q.handleDefault(async () => {
          defaultCt++;
          defaultTimes.push(Date.now());
        });
        await q.add("add", { delta: 2 }, { repeat: { every: 250 } });
        await q.add("badd", { delta: 2 }, { repeat: { every: 100 } });
        assert.equal(ct, 0);
        assert.equal(defaultCt, 0);
        // Don't count how many ticks fit in a fixed sleep. With Redis the next repeat is only
        // scheduled once the worker picks up the previous one, so on a loaded machine the count
        // drifts down and the test flakes. Wait for a few ticks and time them instead.
        await waitForIt(async () => {
          assert.isAtLeast(times.length, 4);
          assert.isAtLeast(defaultTimes.length, 4);
        }, 10000, 20);
        // Check the average interval, not each gap. BullMQ pins iterations to an absolute time
        // grid and the worker polls for them, so a single gap swings by ±50ms either way while
        // the average stays on the requested interval.
        const meanGap = (ts: number[]) => (ts[3] - ts[0]) / 3;
        assert.closeTo(meanGap(times), 250, 60, `add: ${times}`);
        assert.closeTo(meanGap(defaultTimes), 100, 50, `badd: ${defaultTimes}`);
        // Named jobs went to the named handler, unnamed ones to the default handler.
        assert.isAtLeast(ct, 4 * 2);
        assert.isAtLeast(defaultCt, 4);
      } finally {
        await jobs.stop({ obliterate: true });
      }
    });

    it("can pick up jobs again", async function() {
      // this test is only appropriate if we have an external queue.
      if (!process.env.REDIS_URL &&
        !process.env.TEST_REDIS_URL) { this.skip(); }
      const jobs1: GristJobs = createGristJobs();
      const q = jobs1.queue();
      try {
        let ct = 0;
        q.handleName("add", async (job) => {
          ct += job.data.delta;
        });
        q.handleDefault(async () => {});
        await q.add("add", { delta: 1 }, { delay: 250 });
        await q.add("add", { delta: 1 }, { delay: 1000 });
        await delay(500);
        assert.equal(ct, 1);
        await jobs1.stop();
        const jobs2: GristJobs = createGristJobs();
        const q2 = jobs2.queue();
        try {
          q2.handleName("add", async (job) => {
            ct += job.data.delta * 2;
          });
          q2.handleDefault(async () => {});
          await delay(1000);
          assert.equal(ct, 3);
        } finally {
          await jobs2.stop({ obliterate: true });
        }
      } finally {
        await jobs1.stop({ obliterate: true });
      }
    });
  }
});
