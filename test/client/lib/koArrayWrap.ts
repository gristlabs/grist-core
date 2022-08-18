import koArray from 'app/client/lib/koArray';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {assert} from 'chai';
import {Holder} from 'grainjs';
import * as sinon from 'sinon';

function assertResetSingleCall(spy: sinon.SinonSpy, ...args: any[]): void {
  sinon.assert.calledOnce(spy);
  sinon.assert.calledOn(spy, undefined);
  sinon.assert.calledWithExactly(spy, ...args);
  spy.resetHistory();
}

describe('koArrayWrap', function() {
  it('should map splice changes correctly', function() {
    const kArr = koArray([1, 2, 3]);
    const holder = Holder.create(null);
    const gArr = createObsArray(holder, kArr);
    assert.deepEqual(gArr.get(), [1, 2, 3]);

    const spy = sinon.spy();
    gArr.addListener(spy);

    // Push to array.
    kArr.push(4, 5);
    assert.deepEqual(kArr.peek(), [1, 2, 3, 4, 5]);
    assert.deepEqual(gArr.get(), [1, 2, 3, 4, 5]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {deleted: [], start: 3, numAdded: 2});

    // Splice to remove and add.
    kArr.splice(1, 1, 11, 12);
    assert.deepEqual(kArr.peek(), [1, 11, 12, 3, 4, 5]);
    assert.deepEqual(gArr.get(), [1, 11, 12, 3, 4, 5]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 1, numAdded: 2, deleted: [2]});

    // Splice to just remove.
    kArr.splice(2, 2);
    assert.deepEqual(kArr.peek(), [1, 11, 4, 5]);
    assert.deepEqual(gArr.get(), [1, 11, 4, 5]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 2, numAdded: 0, deleted: [12, 3]});

    // Splice to just add.
    kArr.splice(3, 0, 21, 22);
    assert.deepEqual(kArr.peek(), [1, 11, 4, 21, 22, 5]);
    assert.deepEqual(gArr.get(), [1, 11, 4, 21, 22, 5]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 3, numAdded: 2, deleted: []});

    // Splice to make empty.
    kArr.splice(0);
    assert.deepEqual(kArr.peek(), []);
    assert.deepEqual(gArr.get(), []);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 0, numAdded: 0, deleted: [1, 11, 4, 21, 22, 5]});

    // Unshift an empty array.
    kArr.unshift(6, 7);
    assert.deepEqual(kArr.peek(), [6, 7]);
    assert.deepEqual(gArr.get(), [6, 7]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 0, numAdded: 2, deleted: []});
  });

  it('should handle array assignment', function() {
    const kArr = koArray([1, 2, 3]);
    const holder = Holder.create(null);
    const gArr = createObsArray(holder, kArr);
    assert.deepEqual(gArr.get(), [1, 2, 3]);

    const spy = sinon.spy();
    gArr.addListener(spy);

    // Set a new array.
    kArr.assign([-1, -2]);
    assert.deepEqual(kArr.peek(), [-1, -2]);
    assert.deepEqual(gArr.get(), [-1, -2]);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {start: 0, numAdded: 2, deleted: [1, 2, 3]});
  });

  it('should unsubscribe when disposed', function() {
    const kArr = koArray([1, 2, 3]);
    const holder = Holder.create(null);
    const gArr = createObsArray(holder, kArr);
    assert.deepEqual(gArr.get(), [1, 2, 3]);

    const spy = sinon.spy();
    gArr.addListener(spy);

    kArr.push(4);
    assertResetSingleCall(spy, gArr.get(), gArr.get(), {deleted: [], start: 3, numAdded: 1});
    const countSubs = kArr.getObservable().getSubscriptionsCount();

    holder.dispose();
    assert.equal(gArr.isDisposed(), true);
    assert.equal(kArr.getObservable().getSubscriptionsCount(), countSubs - 1);

    kArr.push(5);
    sinon.assert.notCalled(spy);
  });
});
