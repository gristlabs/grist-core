import { KeyedOps } from "app/common/KeyedOps";

import { delay } from "bluebird";
import { assert } from "chai";
import * as sinon from "sinon";

describe("KeyedOps", function() {
  const delayMs = 300;
  const delayBufferMs = 50;

  let opSpy: sinon.SinonSpy;
  let ops: KeyedOps;

  function createKeyedOps(...[operation, options]: ConstructorParameters<typeof KeyedOps>) {
    opSpy = sinon.spy(operation);
    ops = new KeyedOps(opSpy, options);
  }

  afterEach(async () => {
    if (ops) {
      ops.stopOperations();
      await ops.wait(undefined, { expedite: true });
    }
  });

  it("waits on the natural schedule when not expedited", async function() {
    createKeyedOps(noopAsync, { delayBeforeOperationMs: delayMs });
    ops.addOperation("a");
    const wait = withIsResolved(ops.wait(undefined, { expedite: false }));

    // The configured delay must not be collapsed by the act of waiting.
    await delay(delayMs * 1 / 3);
    assert.equal(opSpy.callCount, 0);
    assert.isFalse(wait.isResolved());

    await delay((delayMs * 2 / 3) + delayBufferMs);
    assert.equal(opSpy.callCount, 1);
    await wait;
    assert.isFalse(ops.hasPendingOperations());
  });

  it("respects the minimum delay between operations when not expedited", async function() {
    createKeyedOps(noopAsync, { delayBeforeOperationMs: 0, minDelayBetweenOperationsMs: delayMs });
    ops.addOperation("a");
    await delay(delayBufferMs);
    assert.equal(opSpy.callCount, 1);

    ops.addOperation("a");
    const wait = withIsResolved(ops.wait(undefined));
    await delay(delayMs * 1 / 3);
    assert.equal(opSpy.callCount, 1);
    assert.isFalse(wait.isResolved());

    await delay(delayMs + delayBufferMs);
    assert.equal(opSpy.callCount, 2);
    await wait;
  });

  it("expedites a delayed operation on request", async function() {
    createKeyedOps(noopAsync, { delayBeforeOperationMs: delayMs });

    ops.addOperation("a");
    const start = Date.now();
    await ops.wait(undefined, { expedite: true });
    assert.isBelow(Date.now() - start, delayBufferMs);
    assert.equal(opSpy.callCount, 1);
  });

  it("keeps waiting for work that arrives during a non-expedited wait", async function() {
    createKeyedOps(noopAsync, { delayBeforeOperationMs: delayMs });
    const logRepeat = sinon.spy();
    ops.addOperation("a");
    const wait = withIsResolved(ops.wait(logRepeat));

    // "b" is scheduled after the wait began, so it is not in the keys the wait first collected.
    await delay(delayMs * 1 / 3);
    ops.addOperation("b");

    await delay(delayMs * 2 / 3 + delayBufferMs);
    assert.equal(opSpy.callCount, 1);
    assert.isFalse(wait.isResolved());

    await delay(delayMs * 1 / 3 + delayBufferMs);
    assert.equal(opSpy.callCount, 2);
    await wait;
    assert.isTrue(logRepeat.called);
  });

  it("waitForOperation follows the schedule and resolves on completion", async function() {
    const deferred = deferredOps();
    createKeyedOps(deferred.run, { delayBeforeOperationMs: delayMs });
    ops.addOperation("a");
    const early = withIsResolved(ops.waitForOperation("a"));

    // Waiting for an operation must not bring it forward.
    await delay(delayMs * 1 / 3);
    assert.equal(opSpy.callCount, 0);
    assert.isFalse(early.isResolved());

    await delay(delayMs * 2 / 3 + delayBufferMs);
    assert.equal(opSpy.callCount, 1);
    // Operation is "running" - won't result until we call deferred.resolve().
    const inFlight = withIsResolved(ops.waitForOperation("a"));
    await delay(delayBufferMs);
    assert.isFalse(early.isResolved());
    assert.isFalse(inFlight.isResolved());

    deferred.resolveFirst();
    await early;
    assert.isFalse(inFlight.isResolved());
    await inFlight;

    // This is unblocked now, as KeyedOps should have nothing running or queued.
    const idle = withIsResolved(ops.waitForOperation("a"));
    await delay(delayBufferMs);
    assert.isTrue(idle.isResolved());
    assert.equal(opSpy.callCount, 1);
    assert.isFalse(ops.hasPendingOperations());
  });

  it("expediteOperationAndWait returns without operating when nothing is pending", async function() {
    createKeyedOps(noopAsync, { delayBeforeOperationMs: delayMs });
    const idle = withIsResolved(ops.expediteOperationAndWait("a"));
    await delay(delayBufferMs);
    assert.isTrue(idle.isResolved());
    assert.equal(opSpy.callCount, 0);
  });
});

async function noopAsync(): Promise<void> {};

// A pending wait is indistinguishable from a slow one unless its state is observable.
function withIsResolved(promise: Promise<unknown>) {
  let resolved = false;
  promise.then(() => { resolved = true; }).catch(() => {});
  return Object.assign(promise, {
    isResolved: () => resolved,
  });
}

// Creates a new promise every time it runs, that can be resolved one at a time.
function deferredOps() {
  const resolutionQueue: (() => void)[] = [];
  return {
    resolveFirst: () => {
      resolutionQueue.shift()?.();
    },
    run: async () => {
      return new Promise<void>((r) => {
        resolutionQueue.push(r);
      });
    },
  };
}
