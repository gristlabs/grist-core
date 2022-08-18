import {delay} from 'app/common/delay';
import {RefCountMap} from 'app/common/RefCountMap';
import {assert} from 'chai';
import * as sinon from 'sinon';

function assertResetSingleCall(spy: sinon.SinonSpy, context: any, ...args: any[]): void {
  sinon.assert.calledOnce(spy);
  sinon.assert.calledOn(spy, context);
  sinon.assert.calledWithExactly(spy, ...args);
  spy.resetHistory();
}

describe("RefCountMap", function() {
  it("should dispose items when ref-count returns to 0", function() {
    const create = sinon.stub().callsFake((key) => key.toUpperCase());
    const dispose = sinon.spy();
    const m = new RefCountMap<string, string>({create, dispose, gracePeriodMs: 0});

    const subFoo1 = m.use("foo");
    assert.strictEqual(subFoo1.get(), "FOO");
    assertResetSingleCall(create, null, "foo");

    const subBar1 = m.use("bar");
    assert.strictEqual(subBar1.get(), "BAR");
    assertResetSingleCall(create, null, "bar");

    const subFoo2 = m.use("foo");
    assert.strictEqual(subFoo2.get(), "FOO");
    sinon.assert.notCalled(create);

    // Now dispose one by one.
    subFoo1.dispose();
    sinon.assert.notCalled(dispose);
    subBar1.dispose();
    assertResetSingleCall(dispose, null, "bar", "BAR");

    // An extra subscription increases refCount, so subFoo2.dispose will not yet dispose it.
    const subFoo3 = m.use("foo");
    assert.strictEqual(subFoo3.get(), "FOO");
    sinon.assert.notCalled(create);

    subFoo2.dispose();
    sinon.assert.notCalled(dispose);
    subFoo3.dispose();
    assertResetSingleCall(dispose, null, "foo", "FOO");
  });

  it("should respect the grace period", async function() {
    const create = sinon.stub().callsFake((key) => key.toUpperCase());
    const dispose = sinon.spy();
    const m = new RefCountMap<string, string>({create, dispose, gracePeriodMs: 60});

    const subFoo1 = m.use("foo");
    assert.strictEqual(subFoo1.get(), "FOO");
    assertResetSingleCall(create, null, "foo");

    const subBar1 = m.use("bar");
    assert.strictEqual(subBar1.get(), "BAR");
    assertResetSingleCall(create, null, "bar");

    // Disposal is not immediate, we have some time.
    subFoo1.dispose();
    subBar1.dispose();
    sinon.assert.notCalled(dispose);

    // Wait a bit and add more usage to one of the keys.
    await delay(30);

    const subFoo2 = m.use("foo");
    assert.strictEqual(subFoo2.get(), "FOO");
    sinon.assert.notCalled(create);

    // Grace period hasn't expired yet, so dispose isn't called yet.
    sinon.assert.notCalled(dispose);

    // Now wait for the grace period to end.
    await delay(40);

    // Ensure that bar's disposal has run now, but not foo's.
    assertResetSingleCall(dispose, null, "bar", "BAR");

    // Dispose the second usage, and wait for the full grace period.
    subFoo2.dispose();
    await delay(70);
    assertResetSingleCall(dispose, null, "foo", "FOO");
  });

  it("should dispose immediately on clear", async function() {
    const create = sinon.stub().callsFake((key) => key.toUpperCase());
    const dispose = sinon.spy();
    const m = new RefCountMap<string, string>({create, dispose, gracePeriodMs: 0});
    const subFoo1 = m.use("foo");
    const subBar1 = m.use("bar");
    const subFoo2 = m.use("foo");
    m.dispose();

    assert.equal(dispose.callCount, 2);
    assert.deepEqual(dispose.args, [["foo", "FOO"], ["bar", "BAR"]]);
    dispose.resetHistory();

    // Should be a no-op to dispose subscriptions after RefCountMap is disposed.
    subFoo1.dispose();
    subFoo2.dispose();
    subBar1.dispose();
    sinon.assert.notCalled(dispose);

    // It should not be a matter of gracePeriod, but make sure by waiting a bit.
    await delay(30);
    sinon.assert.notCalled(dispose);
  });

  it("should be safe to purge a key", async function() {
    const create = sinon.stub().callsFake((key) => key.toUpperCase());
    const dispose = sinon.spy();
    const m = new RefCountMap<string, string>({create, dispose, gracePeriodMs: 0});
    const subFoo1 = m.use("foo");
    const subBar1 = m.use("bar");
    const subFoo2 = m.use("foo");

    m.purgeKey("foo");
    assertResetSingleCall(dispose, null, "foo", "FOO");
    m.purgeKey("bar");
    assertResetSingleCall(dispose, null, "bar", "BAR");

    // The tricky case is when a new "foo" key is created after the purge.
    const subFooNew1 = m.use("foo");
    const subBarNew1 = m.use("bar");

    // Should be a no-op to dispose purged subscriptions.
    subFoo1.dispose();
    subFoo2.dispose();
    sinon.assert.notCalled(dispose);

    // A new subscription with the same key should get disposed though.
    subFooNew1.dispose();
    assertResetSingleCall(dispose, null, "foo", "FOO");
    subBarNew1.dispose();
    assertResetSingleCall(dispose, null, "bar", "BAR");

    // Still a no-op to dispose old purged subscriptions.
    subBar1.dispose();
    sinon.assert.notCalled(dispose);

    // Ensure there are no scheduled disposals due to some other bug.
    await delay(30);
    sinon.assert.notCalled(dispose);
  });

  it("should not dispose a re-created key on timeout after purge", async function() {
    const create = sinon.stub().callsFake((key) => key.toUpperCase());
    const dispose = sinon.spy();
    const m = new RefCountMap<string, string>({create, dispose, gracePeriodMs: 60});

    const subFoo1 = m.use("foo");
    subFoo1.dispose();    // This schedules a disposal in 20ms
    m.purgeKey("foo");    // This should purge immediately AND unset the scheduled disposal
    assertResetSingleCall(dispose, null, "foo", "FOO");

    await delay(20);
    const subFoo2 = m.use("foo");   // Should not be affected by the scheduled disposal.
    await delay(100);               // "foo" stays beyond grace period, since it's being used.
    sinon.assert.notCalled(dispose);

    subFoo2.dispose();              // Once disposed, it stays for grace period
    await delay(20);
    sinon.assert.notCalled(dispose);
    await delay(100);               // And gets disposed after it.
    assertResetSingleCall(dispose, null, "foo", "FOO");
  });
});
