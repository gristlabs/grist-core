import {domAsync} from 'app/client/lib/domAsync';
import {assert} from 'chai';
import {dom} from 'grainjs';
import {G, popGlobals, pushGlobals} from 'grainjs/dist/cjs/lib/browserGlobals';
import {JSDOM} from 'jsdom';
import * as sinon from 'sinon';

describe('domAsync', function() {
  beforeEach(function() {
    // These grainjs browserGlobals are needed for using dom() in tests.
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    pushGlobals(jsdomDoc.window);
  });

  afterEach(function() {
    popGlobals();
  });

  it('should populate DOM once promises resolve', async function() {
    let a: HTMLElement, b: HTMLElement, c: HTMLElement, d: HTMLElement;
    const onError = sinon.spy();
    const r1 = dom('button'), r2 = [dom('img'), dom('input')], r4 = dom('hr');
    const promise1 = Promise.resolve(r1);
    const promise2 = new Promise(r => setTimeout(r, 20)).then(() => r2);
    const promise3 = Promise.reject(new Error("p3"));
    const promise4 = new Promise(r => setTimeout(r, 20)).then(() => r4);

    // A few elements get populated by promises.
    G.document.body.appendChild(dom('div',
      a = dom('span.a1', domAsync(promise1)),
      b = dom('span.a2', domAsync(promise2)),
      c = dom('span.a3', domAsync(promise3, onError)),
      d = dom('span.a2', domAsync(promise4)),
    ));

    // Initially, none of the content is there.
    assert.lengthOf(a.children, 0);
    assert.lengthOf(b.children, 0);
    assert.lengthOf(c.children, 0);
    assert.lengthOf(d.children, 0);

    // Check that content appears as promises get resolved.
    await promise1;
    assert.deepEqual([...a.children], [r1]);

    // Disposing an element will ensure that content does not get added to it.
    dom.domDispose(d);

    // Need to wait for promise2 for its results to appear.
    assert.lengthOf(b.children, 0);
    await promise2;
    assert.deepEqual([...b.children], r2);

    // Promise4's results should not appear because of domDispose.
    await promise4;
    assert.deepEqual([...d.children], []);

    // A rejected promise should not produce content, but call the onError callback.
    await promise3.catch(() => null);
    assert.deepEqual([...c.children], []);
    sinon.assert.calledOnce(onError);
    sinon.assert.calledWithMatch(onError, {message: 'p3'});

    assert.lengthOf(a.children, 1);
    assert.lengthOf(b.children, 2);
    assert.lengthOf(c.children, 0);
    assert.lengthOf(d.children, 0);
  });
});
