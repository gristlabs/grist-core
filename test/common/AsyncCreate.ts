import {AsyncCreate, asyncOnce, mapGetOrSet} from 'app/common/AsyncCreate';
import {assert} from 'chai';
import * as sinon from 'sinon';

describe('AsyncCreate', function() {
  it('should call create func on first use and after failure', async function() {
    const createFunc = sinon.stub();
    const cp = new AsyncCreate(createFunc);
    sinon.assert.notCalled(createFunc);

    const value = {hello: 'world'};
    createFunc.returns(Promise.resolve(value));

    // Check that .get() calls the createFunc and returns the expected value.
    assert.strictEqual(await cp.get(), value);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // Subsequent calls return the cached value.
    assert.strictEqual(await cp.get(), value);
    sinon.assert.notCalled(createFunc);

    // After clearing, .get() calls createFunc again. We'll make this one fail.
    cp.clear();
    createFunc.returns(Promise.reject(new Error('fake-error1')));
    await assert.isRejected(cp.get(), /fake-error1/);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // After failure, subsequent calls try again.
    createFunc.returns(Promise.reject(new Error('fake-error2')));
    await assert.isRejected(cp.get(), /fake-error2/);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // While a createFunc() is pending we do NOT call it again.
    createFunc.returns(Promise.reject(new Error('fake-error3')));
    await Promise.all([
      assert.isRejected(cp.get(), /fake-error3/),
      assert.isRejected(cp.get(), /fake-error3/),
    ]);
    sinon.assert.calledOnce(createFunc);    // Called just once here.
    createFunc.resetHistory();
  });

  it('asyncOnce should call func once and after failure', async function() {
    const createFunc = sinon.stub();
    let onceFunc = asyncOnce(createFunc);
    sinon.assert.notCalled(createFunc);

    const value = {hello: 'world'};
    createFunc.returns(Promise.resolve(value));

    // Check that .get() calls the createFunc and returns the expected value.
    assert.strictEqual(await onceFunc(), value);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // Subsequent calls return the cached value.
    assert.strictEqual(await onceFunc(), value);
    sinon.assert.notCalled(createFunc);

    // Create a new onceFunc. We'll make this one fail.
    onceFunc = asyncOnce(createFunc);
    createFunc.returns(Promise.reject(new Error('fake-error1')));
    await assert.isRejected(onceFunc(), /fake-error1/);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // After failure, subsequent calls try again.
    createFunc.returns(Promise.reject(new Error('fake-error2')));
    await assert.isRejected(onceFunc(), /fake-error2/);
    sinon.assert.calledOnce(createFunc);
    createFunc.resetHistory();

    // While a createFunc() is pending we do NOT call it again.
    createFunc.returns(Promise.reject(new Error('fake-error3')));
    await Promise.all([
      assert.isRejected(onceFunc(), /fake-error3/),
      assert.isRejected(onceFunc(), /fake-error3/),
    ]);
    sinon.assert.calledOnce(createFunc);    // Called just once here.
    createFunc.resetHistory();
  });

  describe("mapGetOrSet", function() {
    it('should call create func on first use and after failure', async function() {
      const createFunc = sinon.stub();
      const amap = new Map<string, any>();

      createFunc.callsFake(async (key: string) => ({myKey: key.toUpperCase()}));

      // Check that mapGetOrSet() calls the createFunc and returns the expected value.
      assert.deepEqual(await mapGetOrSet(amap, "foo", createFunc), {myKey: "FOO"});
      assert.deepEqual(await mapGetOrSet(amap, "bar", createFunc), {myKey: "BAR"});
      sinon.assert.calledTwice(createFunc);
      createFunc.resetHistory();

      // Subsequent calls return the cached value.
      assert.deepEqual(await mapGetOrSet(amap, "foo", createFunc), {myKey: "FOO"});
      assert.deepEqual(await mapGetOrSet(amap, "bar", createFunc), {myKey: "BAR"});
      sinon.assert.notCalled(createFunc);

      // Calls to plain .get() also return the cached value.
      assert.deepEqual(await amap.get("foo"), {myKey: "FOO"});
      assert.deepEqual(await amap.get("bar"), {myKey: "BAR"});
      sinon.assert.notCalled(createFunc);

      // After clearing, .get() returns undefined. (The usual Map behavior.)
      amap.delete("foo");
      assert.strictEqual(await amap.get("foo"), undefined);

      // After clearing, mapGetOrSet() calls createFunc again. We'll make this one fail.
      createFunc.callsFake((key: string) => Promise.reject(new Error('fake-error1-' + key)));
      await assert.isRejected(mapGetOrSet(amap, "foo", createFunc), /fake-error1-foo/);
      assert.strictEqual(await amap.get("foo"), undefined);
      sinon.assert.calledOnce(createFunc);
      createFunc.resetHistory();

      // Other keys should be unaffected.
      assert.deepEqual(await mapGetOrSet(amap, "bar", createFunc), {myKey: "BAR"});
      assert.deepEqual(await amap.get("bar"), {myKey: "BAR"});
      sinon.assert.notCalled(createFunc);

      // After failure, subsequent calls try again.
      createFunc.callsFake((key: string) => Promise.reject(new Error('fake-error2-' + key)));
      await assert.isRejected(mapGetOrSet(amap, "foo", createFunc), /fake-error2-foo/);
      sinon.assert.calledOnce(createFunc);
      createFunc.resetHistory();

      // While a createFunc() is pending we do NOT call it again.
      createFunc.callsFake((key: string) => Promise.reject(new Error('fake-error3-' + key)));
      amap.delete("bar");
      await Promise.all([
        assert.isRejected(mapGetOrSet(amap, "foo", createFunc), /fake-error3-foo/),
        assert.isRejected(mapGetOrSet(amap, "bar", createFunc), /fake-error3-bar/),
        assert.isRejected(mapGetOrSet(amap, "foo", createFunc), /fake-error3-foo/),
        assert.isRejected(mapGetOrSet(amap, "bar", createFunc), /fake-error3-bar/),
      ]);
      sinon.assert.calledTwice(createFunc);    // Called just twice, once for each value.
      createFunc.resetHistory();
    });
  });
});
