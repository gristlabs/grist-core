import pidusage from '@gristlabs/pidusage';
import {exitPromise} from 'app/server/lib/serverUtils';
import {Throttle, ThrottleTiming} from 'app/server/lib/Throttle';
import {delay} from 'bluebird';
import {assert} from 'chai';
import {ChildProcess, spawn} from 'child_process';
import * as testUtils from 'test/server/testUtils';

const testTiming: ThrottleTiming = {
  dutyCyclePositiveMs: 20,
  samplePeriodMs: 100,
  targetAveragingPeriodMs: 1000,
  minimumAveragingPeriodMs: 50,
  minimumLogPeriodMs: 10,
  targetRate: 0.25,
  maxThrottle: 10,
  traceNudgeOffset: 5,
};

interface ThrottleTestCase {
  child: ChildProcess;
  throttle: Throttle;
  done: Promise<number|string>;
  cpuHog: boolean;
}

describe('Throttle', function() {
  testUtils.setTmpLogLevel('error');

  // Test with N processes, half very busy, half not busy at all.
  for (const processCount of [2, 10]) {
    it(`throttle looks sane with ${processCount / 2} busy process(es)`, async function() {
      this.timeout(10000);
      const tests: ThrottleTestCase[] = [];
      for (let i = 0; i < processCount; i++) {
        const cpuHog = i % 2 === 0;
        const cmd = cpuHog ? 'while true; do true; done' : 'sleep 10000';
        const child = spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' });
        if (!child.pid) {
          throw new Error('failed to spawn process');
        }

        const done = exitPromise(child);
        const throttle = new Throttle({
          pid: child.pid,
          logMeta: {sandboxPid: child.pid, docId: `case${i}`},
          timing: testTiming
        });
        tests.push({
          child, throttle, done, cpuHog
        });
      }
      await delay(5000);
      for (const test of tests) {
        test.child.kill();
      }
      for (const test of tests) {
        await test.done;
      }
      for (const test of tests) {
        test.throttle.stop();
        const stats = test.throttle.testStats;
        if (!stats) { throw new Error('throttling never ran'); }
        if (test.cpuHog) {
          // Process should have received some cpu time.  Exactly how much depends on
          // the load on the test server, so don't be too fussy.
          assert.isAbove(stats.cpuDuration, 500);
          // Process should not have received an excessive amount of cpu time.
          assert.isBelow(stats.cpuDuration, 2500);
          assert.isAbove(stats.offDuration, 1000);
        } else {
          // Sleep should take almost no cpu.
          assert.isBelow(stats.cpuDuration, 100);
          assert.equal(stats.offDuration, 0);
        }
      }
      // Clear the setInterval that the pidusage module sets up internally.
      await delay(100);  // Wait a little in case an async pidusage call hasn't finished yet.
                         // TODO: fix pidusage upstream to allow graceful shutdown.
      pidusage.clear();
    });
  }
});
