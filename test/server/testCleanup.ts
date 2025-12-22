export type CleanupFunc = (() => void|Promise<void>);

/**
 * Helper to run cleanup callbacks created in a test case. See setupCleanup() below for usage.
 */
export class Cleanup {
  private _callbacksAfterAll: CleanupFunc[] = [];
  private _callbacksAfterEach: CleanupFunc[] = [];

  public addAfterAll(cleanupFunc: CleanupFunc) {
    this._callbacksAfterAll.push(cleanupFunc);
  }

  public addAfterEach(cleanupFunc: CleanupFunc) {
    this._callbacksAfterEach.push(cleanupFunc);
  }

  public async runCleanup(which: 'all'|'each') {
    const callbacks = which === 'all' ? this._callbacksAfterAll : this._callbacksAfterEach;
    const list = callbacks.splice(0);   // Get a copy of the list AND clear it out.
    for (const f of list) {
      await f();
    }
  }
}

/**
 * Helper to run cleanup callbacks created in the course of running a test.
 * Usage:
 *    const cleanup = setupCleanup();
 *    it("should do stuff", function() {
 *      cleanup.addAfterAll(() => { ...doSomething1()... });
 *      cleanup.addAfterEach(() => { ...doSomething2()... });
 *    });
 *
 * Here, doSomething1() is called at the end of a suite, while doSomething2() is called at the end
 * of the current test case.
 */
export function setupCleanup() {
  const cleanup = new Cleanup();
  after(() => cleanup.runCleanup('all'));
  afterEach(() => cleanup.runCleanup('each'));
  return cleanup;
}
