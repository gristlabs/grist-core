import * as bluebird from 'bluebird';

/**
 * Wait some time for a check to pass.  Allow a pause between checks.
 */
export async function waitForIt(check: () => Promise<void>|void, maxWaitMs: number,
                                stepWaitMs: number = 1000) {
  const start = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (e) {
      if (Date.now() - start > maxWaitMs) { throw e; }
    }
    await bluebird.delay(stepWaitMs);
  }
}
