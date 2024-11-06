import {MaybePromise} from 'app/plugin/gutil';

/**
 * Returns a promise that resolves in the given number of milliseconds.
 * (A replica of bluebird.delay using native promises.)
 */
export function delay(msec: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, msec));
}

export async function waitToPass(fn: () => MaybePromise<any>, maxWaitMs: number = 2000) {
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
