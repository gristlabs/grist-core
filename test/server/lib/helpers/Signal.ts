import {delay} from 'bluebird';
import {assert} from 'chai';

/**
 * Helper that creates a promise that can be resolved from outside.
 *
 * @example
 * const methodCalled = signal();
 * setTimeout(() => methodCalled.emit(), 1000);
 * methodCalled.assertNotCalled(); // won't throw as the method hasn't been called yet
 * await methodCalled.wait(); // will wait for the method to be called
 * await methodCalled.wait(); // can be called multiple times
 * methodCalled.reset(); // resets the signal (so that it can be awaited again)
 * setTimeout(() => methodCalled.emit(), 3000);
 * await methodCalled.wait(); // will fail, as we wait only 2 seconds
 */
export function signal() {
  let resolve: null | ((data: any) => void) = null;
  let promise: null | Promise<any> = null;
  let called = false;
  return {
    emit(data: any) {
      if (!resolve) {
        throw new Error("signal.emit() called before signal.reset()");
      }
      called = true;
      resolve(data);
    },
    async wait() {
      if (!promise) {
        throw new Error("signal.wait() called before signal.reset()");
      }
      const proms = Promise.race([
        promise,
        delay(2000).then(() => {
          throw new Error("signal.wait() timed out");
        }),
      ]);
      return await proms;
    },
    async waitAndReset() {
      try {
        return await this.wait();
      } finally {
        this.reset();
      }
    },
    assertNotCalled() {
      assert.isFalse(called);
    },
    reset() {
      called = false;
      promise = new Promise((res) => {
        resolve = res;
      });
    },
  };
}
