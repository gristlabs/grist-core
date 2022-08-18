import {localStorageBoolObs, localStorageObs} from 'app/client/lib/localStorageObs';
import {assert} from 'chai';
import {setTmpMochaGlobals} from 'test/client/clientUtil';

describe('localStorageObs', function() {
  setTmpMochaGlobals();

  before(() => typeof localStorage !== 'undefined' ? localStorage.clear() : null);

  it('should persist localStorageObs values', async function() {
    const foo = localStorageObs('localStorageObs-foo');
    const bar = localStorageObs('localStorageObs-bar');
    assert.strictEqual(foo.get(), null);
    foo.set("123");
    bar.set("456");
    assert.strictEqual(foo.get(), "123");
    assert.strictEqual(bar.get(), "456");

    // We can't really reload the window the way that the browser harness for test/client tests
    // works, so just test in the same process with a new instance of these observables.
    const foo2 = localStorageObs('localStorageObs-foo');
    const bar2 = localStorageObs('localStorageObs-bar');
    assert.strictEqual(foo2.get(), "123");
    assert.strictEqual(bar2.get(), "456");
  });

  for (const defl of [false, true]) {
    it(`should support localStorageBoolObs with default of ${defl}`, async function() {
      const prefix = `localStorageBoolObs-${defl}`;
      const foo = localStorageBoolObs(`${prefix}-foo`, defl);
      const bar = localStorageBoolObs(`${prefix}-bar`, defl);
      assert.strictEqual(foo.get(), defl);
      assert.strictEqual(bar.get(), defl);
      foo.set(true);
      bar.set(false);
      assert.strictEqual(foo.get(), true);
      assert.strictEqual(bar.get(), false);
      assert.strictEqual(localStorageBoolObs(`${prefix}-foo`, defl).get(), true);
      assert.strictEqual(localStorageBoolObs(`${prefix}-bar`, defl).get(), false);

      // If created with the opposite default value, it's not very intuitive: if its value matched
      // the previous default value, then now it will be the opposite; if its value were flipped,
      // then now it would stay flipped. So it'll match the new default value in either case.
      assert.strictEqual(localStorageBoolObs(`${prefix}-foo`, !defl).get(), !defl);
      assert.strictEqual(localStorageBoolObs(`${prefix}-bar`, !defl).get(), !defl);
    });
  }
});
