import {delay} from 'app/common/delay';
import {MaybePromise} from 'app/plugin/gutil';

/**
 * A helper function that invokes a function until it passes without throwing an error.
 *
 * Notice: unlike `waitForPass` from `gristUtils`, this function doesn't use browser to delay
 * execution, so it's suitable for server-side tests.
 *
 * @param fn Function that throws an error if the condition is not met.
 * @param maxWaitMs Maximum time to wait for the condition to be met.
 * @param stepWaitMs Time to wait between attempts to check the condition.
 */
export async function waitForIt(fn: () => MaybePromise<any>, maxWaitMs: number = 2000,
                                stepWaitMs: number = 1000) {
  const start = Date.now();
  const timePassed = () => Date.now() - start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fn();
      return;
    } catch (e) {
      if (timePassed() > maxWaitMs) {
        throw e;
      }
      await delay(stepWaitMs);
    }
  }
}
