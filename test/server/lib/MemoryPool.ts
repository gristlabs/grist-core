import {MemoryPool} from 'app/server/lib/MemoryPool';
import {delay} from 'app/common/delay';
import {isLongerThan} from 'app/common/gutil';
import {assert} from 'chai';
import * as sinon from 'sinon';

async function isResolved(promise: Promise<unknown>): Promise<boolean> {
  return !await isLongerThan(promise, 0);
}

async function areResolved(...promises: Promise<unknown>[]): Promise<boolean[]> {
  return Promise.all(promises.map(p => isResolved(p)));
}

function poolInfo(mpool: MemoryPool): {total: number, reserved: number, available: number, awaiters: number} {
  return {
    total: mpool.getTotalSize(),
    reserved: mpool.getReservedSize(),
    available: mpool.getAvailableSize(),
    awaiters: mpool.numWaiting(),
  };
}

describe("MemoryPool", function() {

  afterEach(() => {
    sinon.restore();
  });

  it("should wait for enough space", async function() {
    const mpool = new MemoryPool(1000);
    const spy = sinon.spy();
    let r1: () => void;
    let r2: () => void;
    let r3: () => void;
    let r4: () => void;
    const w1 = new Promise<void>(r => { r1 = r; });
    const w2 = new Promise<void>(r => { r2 = r; });
    const w3 = new Promise<void>(r => { r3 = r; });
    const w4 = new Promise<void>(r => { r4 = r; });
    const p1 = mpool.withReserved(400, () => { spy(1); return w1; });
    const p2 = mpool.withReserved(400, () => { spy(2); return w2; });
    const p3 = mpool.withReserved(400, () => { spy(3); return w3; });
    const p4 = mpool.withReserved(400, () => { spy(4); return w4; });

    // Only two callbacks run initially.
    await delay(10);
    assert.deepEqual(spy.args, [[1], [2]]);

    // Others are waiting for something to finish.
    await delay(50);
    assert.deepEqual(spy.args, [[1], [2]]);

    // Once 2nd task finishes, the next one should run.
    r2!();
    await delay(10);
    assert.deepEqual(spy.args, [[1], [2], [3]]);
    await delay(50);
    assert.deepEqual(spy.args, [[1], [2], [3]]);

    // Once another task finishes, the last one should run.
    r3!();
    await delay(10);
    assert.deepEqual(spy.args, [[1], [2], [3], [4]]);

    // Let all tasks finish.
    r1!();
    r4!();
    await delay(10);
    assert.deepEqual(spy.args, [[1], [2], [3], [4]]);
    await Promise.all([p1, p2, p3, p4]);
  });

  it("should allow adjusting reservation", async function() {
    const mpool = new MemoryPool(1000);
    const res1p = mpool.waitAndReserve(600);
    const res2p = mpool.waitAndReserve(600);

    // Initially only the first reservation can happen.
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 600, available: 400, awaiters: 1});
    assert.deepEqual(await areResolved(res1p, res2p), [true, false]);

    // Once the first reservation is adjusted, the next one should go.
    const res1 = await res1p;
    res1.updateReservation(400);
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 1000, available: 0, awaiters: 0});
    assert.deepEqual(await areResolved(res1p, res2p), [true, true]);

    const res2 = await res2p;

    // Try some more complex combinations.
    const res3p = mpool.waitAndReserve(200);
    const res4p = mpool.waitAndReserve(200);
    const res5p = mpool.waitAndReserve(200);
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 1000, available: 0, awaiters: 3});
    assert.deepEqual(await areResolved(res3p, res4p, res5p), [false, false, false]);

    res1.updateReservation(100);    // 300 units freed.
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 900, available: 100, awaiters: 2});
    assert.deepEqual(await areResolved(res3p, res4p, res5p), [true, false, false]);

    res1.dispose();   // Another 100 freed.
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 1000, available: 0, awaiters: 1});
    assert.deepEqual(await areResolved(res3p, res4p, res5p), [true, true, false]);

    res2.dispose();   // Lots freed.
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 600, available: 400, awaiters: 0});
    assert.deepEqual(await areResolved(res3p, res4p, res5p), [true, true, true]);

    (await res5p).dispose();
    (await res4p).dispose();
    (await res3p).dispose();
    assert.deepEqual(poolInfo(mpool), {total: 1000, reserved: 0, available: 1000, awaiters: 0});
  });
});
