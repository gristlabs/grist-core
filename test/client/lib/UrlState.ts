import * as log from 'app/client/lib/log';
import {HistWindow, UrlState} from 'app/client/lib/UrlState';
import {assert} from 'chai';
import {dom} from 'grainjs';
import {popGlobals, pushGlobals} from 'grainjs/dist/cjs/lib/browserGlobals';
import {JSDOM} from 'jsdom';
import fromPairs = require('lodash/fromPairs');
import * as sinon from 'sinon';

describe('UrlState', function() {
  const sandbox = sinon.createSandbox();
  let mockWindow: HistWindow;

  function pushState(state: any, title: any, href: string) {
    mockWindow.location = new URL(href) as unknown as Location;
  }

  beforeEach(function() {
    mockWindow = {
      location: new URL('http://localhost:8080') as unknown as Location,
      history: {pushState} as History,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
    // These grainjs browserGlobals are needed for using dom() in tests.
    const jsdomDoc = new JSDOM("<!doctype html><html><body></body></html>");
    pushGlobals(jsdomDoc.window);
    sandbox.stub(log, 'debug');
  });

  afterEach(function() {
    popGlobals();
    sandbox.restore();
  });

  interface State {
    [key: string]: string;
  }

  function encodeUrl(state: State, baseLocation: Location | URL): string {
    const url = new URL(baseLocation.href);
    for (const key of Object.keys(state)) { url.searchParams.set(key, state[key]); }
    return url.href;
  }
  function decodeUrl(location: Location | URL): State {
    const url = new URL(location.href);
    return fromPairs(Array.from(url.searchParams.entries()));
  }
  function updateState(prevState: State, newState: State): State {
    return {...prevState, ...newState};
  }
  function needPageLoad(prevState: State, newState: State): boolean {
    return false;
  }
  async function delayPushUrl(prevState: State, newState: State): Promise<void> {
    // no-op
  }

  it('should produce correct results with configProd', async function() {
    mockWindow.location = new URL('https://example.com/?foo=A&bar=B') as unknown as Location;
    const urlState = new UrlState<State>(mockWindow, {encodeUrl, decodeUrl, updateState, needPageLoad, delayPushUrl});
    assert.deepEqual(urlState.state.get(), {foo: 'A', bar: 'B'});

    const link = dom('a', urlState.setLinkUrl({bar: 'C'}));
    assert.equal(link.getAttribute('href'), 'https://example.com/?foo=A&bar=C');

    assert.equal(urlState.makeUrl({bar: "X"}), 'https://example.com/?foo=A&bar=X');
    assert.equal(urlState.makeUrl({foo: 'F', bar: ""}), 'https://example.com/?foo=F&bar=');

    await urlState.pushUrl({bar: 'X'});
    assert.equal(mockWindow.location.href, 'https://example.com/?foo=A&bar=X');
    assert.deepEqual(urlState.state.get(), {foo: 'A', bar: 'X'});
    assert.equal(link.getAttribute('href'), 'https://example.com/?foo=A&bar=C');

    await urlState.pushUrl({foo: 'F', baz: 'T'});
    assert.equal(mockWindow.location.href, 'https://example.com/?foo=F&bar=X&baz=T');
    assert.deepEqual(urlState.state.get(), {foo: 'F', bar: 'X', baz: 'T'});
    assert.equal(link.getAttribute('href'), 'https://example.com/?foo=F&bar=C&baz=T');
  });
});
