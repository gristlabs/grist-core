import * as log from 'app/client/lib/log';
import {HistWindow, UrlState} from 'app/client/lib/UrlState';
import {getLoginUrl, UrlStateImpl} from 'app/client/models/gristUrlState';
import {IGristUrlState} from 'app/common/gristUrls';
import {assert} from 'chai';
import {dom} from 'grainjs';
import {popGlobals, pushGlobals} from 'grainjs/dist/cjs/lib/browserGlobals';
import {JSDOM} from 'jsdom';
import clone = require('lodash/clone');
import merge = require('lodash/merge');
import omit = require('lodash/omit');
import * as sinon from 'sinon';

function assertResetCall(spy: sinon.SinonSpy, ...args: any[]): void {
  sinon.assert.calledOnce(spy);
  sinon.assert.calledWithExactly(spy, ...args);
  spy.resetHistory();
}

describe('gristUrlState', function() {
  let mockWindow: HistWindow;
  // TODO add a test case where org is set, but isSingleOrg is false.
  const prod = new UrlStateImpl({gristConfig: {org: undefined, baseDomain: '.example.com', pathOnly: false}});
  const dev = new UrlStateImpl({gristConfig: {org: undefined, pathOnly: true}});
  const single = new UrlStateImpl({gristConfig: {org: 'mars', singleOrg: 'mars', pathOnly: false}});
  const custom = new UrlStateImpl({gristConfig: {org: 'mars', baseDomain: '.example.com'}});

  function pushState(state: any, title: any, href: string) {
    mockWindow.location = new URL(href) as unknown as Location;
  }

  const sandbox = sinon.createSandbox();

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

  it('should decode state in URLs correctly', function() {
    assert.deepEqual(prod.decodeUrl(new URL('http://localhost:8080')), {});
    assert.deepEqual(prod.decodeUrl(new URL('http://localhost:8080/ws/12')), {ws: 12});
    assert.deepEqual(prod.decodeUrl(new URL('http://localhost:8080/o/foo/ws/12/')), {org: 'foo', ws: 12});
    assert.deepEqual(prod.decodeUrl(new URL('http://localhost:8080/o/foo/doc/bar/p/5')),
      {org: 'foo', doc: 'bar', docPage: 5});

    assert.deepEqual(dev.decodeUrl(new URL('http://localhost:8080')), {});
    assert.deepEqual(dev.decodeUrl(new URL('http://localhost:8080/ws/12')), {ws: 12});
    assert.deepEqual(dev.decodeUrl(new URL('http://localhost:8080/o/foo/ws/12/')), {org: 'foo', ws: 12});
    assert.deepEqual(dev.decodeUrl(new URL('http://localhost:8080/o/foo/doc/bar/p/5')),
      {org: 'foo', doc: 'bar', docPage: 5});

    assert.deepEqual(single.decodeUrl(new URL('http://localhost:8080')), {org: 'mars'});
    assert.deepEqual(single.decodeUrl(new URL('http://localhost:8080/ws/12')), {org: 'mars', ws: 12});
    assert.deepEqual(single.decodeUrl(new URL('http://localhost:8080/o/foo/ws/12/')), {org: 'foo', ws: 12});
    assert.deepEqual(single.decodeUrl(new URL('http://localhost:8080/o/foo/doc/bar/p/5')),
      {org: 'foo', doc: 'bar', docPage: 5});

    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com')), {org: 'bar'});
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com/ws/12/')), {org: 'bar', ws: 12});
    assert.deepEqual(prod.decodeUrl(new URL('https://foo.example.com/o/baz/ws/12')), {org: 'baz', ws: 12});
    assert.deepEqual(prod.decodeUrl(new URL('https://foo.example.com/')), {org: 'foo'});

    assert.deepEqual(dev.decodeUrl(new URL('https://bar.example.com')), {});
    assert.deepEqual(dev.decodeUrl(new URL('https://bar.example.com/ws/12/')), {ws: 12});
    assert.deepEqual(dev.decodeUrl(new URL('https://foo.example.com/o/baz/ws/12')), {org: 'baz', ws: 12});
    assert.deepEqual(dev.decodeUrl(new URL('https://foo.example.com/')), {});

    assert.deepEqual(single.decodeUrl(new URL('https://bar.example.com')), {org: 'mars'});
    assert.deepEqual(single.decodeUrl(new URL('https://bar.example.com/ws/12/')), {org: 'mars', ws: 12});
    assert.deepEqual(single.decodeUrl(new URL('https://foo.example.com/o/baz/ws/12')), {org: 'baz', ws: 12});
    assert.deepEqual(single.decodeUrl(new URL('https://foo.example.com/')), {org: 'mars'});

    // Trash page
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com/p/trash')), {org: 'bar', homePage: 'trash'});

    // Billing routes
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com/o/baz/billing')),
      {org: 'baz', billing: 'billing'});

    // API routes
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com/api/docs/bar')),
      {org: 'bar', doc: 'bar', api: true});
    assert.deepEqual(prod.decodeUrl(new URL('http://localhost:8080/o/baz/api/docs/bar')),
      {org: 'baz', doc: 'bar', api: true});
  });

  it('should decode query strings in URLs correctly', function() {
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com?billingPlan=a')),
      {org: 'bar', params: {billingPlan: 'a'}});
    assert.deepEqual(prod.decodeUrl(new URL('https://foo.example.com/o/baz/ws/12?billingPlan=b')),
      {org: 'baz', ws: 12, params: {billingPlan: 'b'}});
    assert.deepEqual(prod.decodeUrl(new URL('https://bar.example.com/o/foo/doc/bar/p/5?billingPlan=e')),
      {org: 'foo', doc: 'bar', docPage: 5, params: {billingPlan: 'e'}});
  });

  it('should encode state in URLs correctly', function() {

    const localBase = new URL('http://localhost:8080');
    const hostBase = new URL('https://bar.example.com');

    assert.equal(prod.encodeUrl({}, hostBase), 'https://bar.example.com/');
    assert.equal(prod.encodeUrl({org: 'foo'}, hostBase), 'https://foo.example.com/');
    assert.equal(prod.encodeUrl({ws: 12}, hostBase), 'https://bar.example.com/ws/12/');
    assert.equal(prod.encodeUrl({org: 'foo', ws: 12}, hostBase), 'https://foo.example.com/ws/12/');

    assert.equal(dev.encodeUrl({ws: 12}, hostBase), 'https://bar.example.com/ws/12/');
    assert.equal(dev.encodeUrl({org: 'foo', ws: 12}, hostBase), 'https://bar.example.com/o/foo/ws/12/');

    assert.equal(single.encodeUrl({ws: 12}, hostBase), 'https://bar.example.com/ws/12/');
    assert.equal(single.encodeUrl({org: 'foo', ws: 12}, hostBase), 'https://bar.example.com/o/foo/ws/12/');

    assert.equal(prod.encodeUrl({ws: 12}, localBase), 'http://localhost:8080/ws/12/');
    assert.equal(prod.encodeUrl({org: 'foo', ws: 12}, localBase), 'http://localhost:8080/o/foo/ws/12/');
    assert.equal(prod.encodeUrl({org: 'foo', doc: 'bar'}, localBase), 'http://localhost:8080/o/foo/doc/bar');
    assert.equal(prod.encodeUrl({org: 'foo', doc: 'bar', docPage: 2}, localBase),
      'http://localhost:8080/o/foo/doc/bar/p/2');

    assert.equal(dev.encodeUrl({ws: 12}, localBase), 'http://localhost:8080/ws/12/');
    assert.equal(dev.encodeUrl({org: 'foo', ws: 12}, localBase), 'http://localhost:8080/o/foo/ws/12/');
    assert.equal(dev.encodeUrl({org: 'foo', doc: 'bar'}, localBase), 'http://localhost:8080/o/foo/doc/bar');

    assert.equal(single.encodeUrl({ws: 12}, localBase), 'http://localhost:8080/ws/12/');
    assert.equal(single.encodeUrl({org: 'foo', ws: 12}, localBase), 'http://localhost:8080/o/foo/ws/12/');
    assert.equal(single.encodeUrl({org: 'foo', doc: 'bar'}, localBase), 'http://localhost:8080/o/foo/doc/bar');

    // homePage values, including the "Trash" page
    assert.equal(prod.encodeUrl({homePage: 'trash'}, localBase), 'http://localhost:8080/p/trash');
    assert.equal(prod.encodeUrl({homePage: 'all'}, localBase), 'http://localhost:8080/');
    assert.equal(prod.encodeUrl({homePage: 'workspace', ws: 12}, localBase), 'http://localhost:8080/ws/12/');

    // Billing routes
    assert.equal(prod.encodeUrl({org: 'baz', billing: 'billing'}, hostBase),
      'https://baz.example.com/billing');

    // API routes
    assert.equal(prod.encodeUrl({org: 'baz', doc: 'bar', api: true}, hostBase), 'https://baz.example.com/api/docs/bar');
    assert.equal(prod.encodeUrl({org: 'baz', doc: 'bar', api: true}, localBase),
      'http://localhost:8080/o/baz/api/docs/bar');
  });

  it('should encode state in billing URLs correctly', function() {

    const hostBase = new URL('https://bar.example.com');

    assert.equal(prod.encodeUrl({params: {billingPlan: 'a'}}, hostBase),
      'https://bar.example.com/?billingPlan=a');
    assert.equal(prod.encodeUrl({ws: 12, params: {billingPlan: 'b'}}, hostBase),
      'https://bar.example.com/ws/12/?billingPlan=b');
    assert.equal(prod.encodeUrl({org: 'foo', doc: 'bar', docPage: 5, params: {billingPlan: 'e'}}, hostBase),
      'https://foo.example.com/doc/bar/p/5?billingPlan=e');
  });

  describe('custom-domain', function() {
    it('should encode state in URLs correctly', function() {
      const localBase = new URL('http://localhost:8080');
      const hostBase = new URL('https://www.martian.com');

      assert.equal(custom.encodeUrl({}, hostBase), 'https://www.martian.com/');
      assert.equal(custom.encodeUrl({org: 'foo'}, hostBase), 'https://foo.example.com/');
      assert.equal(custom.encodeUrl({ws: 12}, hostBase), 'https://www.martian.com/ws/12/');
      assert.equal(custom.encodeUrl({org: 'foo', ws: 12}, hostBase), 'https://foo.example.com/ws/12/');

      assert.equal(custom.encodeUrl({ws: 12}, localBase), 'http://localhost:8080/ws/12/');
      assert.equal(custom.encodeUrl({org: 'foo', ws: 12}, localBase), 'http://localhost:8080/o/foo/ws/12/');
      assert.equal(custom.encodeUrl({org: 'foo', doc: 'bar'}, localBase), 'http://localhost:8080/o/foo/doc/bar');
      assert.equal(custom.encodeUrl({org: 'foo', doc: 'bar', docPage: 2}, localBase),
        'http://localhost:8080/o/foo/doc/bar/p/2');

      assert.equal(custom.encodeUrl({org: 'baz', billing: 'billing'}, hostBase),
        'https://baz.example.com/billing');
    });

    it('should encode state in billing URLs correctly', function() {
      const hostBase = new URL('https://www.martian.com');

      assert.equal(custom.encodeUrl({params: {billingPlan: 'a'}}, hostBase),
        'https://www.martian.com/?billingPlan=a');
      assert.equal(custom.encodeUrl({ws: 12, params: {billingPlan: 'b'}}, hostBase),
        'https://www.martian.com/ws/12/?billingPlan=b');
      assert.equal(custom.encodeUrl({org: 'foo', doc: 'bar', docPage: 5, params: {billingPlan: 'e'}}, hostBase),
        'https://foo.example.com/doc/bar/p/5?billingPlan=e');
    });
  });


  it('should produce correct results with prod config', async function() {
    mockWindow.location = new URL('https://bar.example.com/ws/10/') as unknown as Location;
    const state = UrlState.create(null, mockWindow, prod);
    const loadPageSpy = sandbox.spy(mockWindow, '_urlStateLoadPage');
    assert.deepEqual(state.state.get(), {org: 'bar', ws: 10});

    const link = dom('a', state.setLinkUrl({ws: 4}));
    assert.equal(link.getAttribute('href'), 'https://bar.example.com/ws/4/');

    assert.equal(state.makeUrl({ws: 4}), 'https://bar.example.com/ws/4/');
    assert.equal(state.makeUrl({ws: undefined}), 'https://bar.example.com/');
    assert.equal(state.makeUrl({org: 'mars'}), 'https://mars.example.com/');
    assert.equal(state.makeUrl({org: 'mars', doc: 'DOC', docPage: 5}), 'https://mars.example.com/doc/DOC/p/5');

    // If we change workspace, that stays on the same page, so no call to loadPageSpy.
    await state.pushUrl({ws: 17});
    sinon.assert.notCalled(loadPageSpy);
    assert.equal(mockWindow.location.href, 'https://bar.example.com/ws/17/');
    assert.deepEqual(state.state.get(), {org: 'bar', ws: 17});
    assert.equal(link.getAttribute('href'), 'https://bar.example.com/ws/4/');

    // Loading a doc loads a new page, for now. TODO: this is expected to change ASAP, in which
    // case loadPageSpy should essentially never get called.
    // To simulate the loadState() on the new page, we call loadState() manually here.
    await state.pushUrl({doc: 'baz'});
    assertResetCall(loadPageSpy, 'https://bar.example.com/doc/baz');
    state.loadState();

    assert.equal(mockWindow.location.href, 'https://bar.example.com/doc/baz');
    assert.deepEqual(state.state.get(), {org: 'bar', doc: 'baz'});
    assert.equal(link.getAttribute('href'), 'https://bar.example.com/ws/4/');

    await state.pushUrl({org: 'foo', ws: 12});
    assertResetCall(loadPageSpy, 'https://foo.example.com/ws/12/');
    state.loadState();

    assert.equal(mockWindow.location.href, 'https://foo.example.com/ws/12/');
    assert.deepEqual(state.state.get(), {org: 'foo', ws: 12});
    assert.equal(state.makeUrl({ws: 4}), 'https://foo.example.com/ws/4/');

    // Check form URLs in prod setup. They are produced on document pages.
    await state.pushUrl({org: 'foo', doc: 'abc'});
    state.loadState();
    assert.equal(
      state.makeUrl({doc: undefined, form: {vsId: 4, shareKey: 'key'}}),
      'https://foo.example.com/forms/key/4'
    );
    assert.equal(
      state.makeUrl({doc: 'abc', form: {vsId: 4}}),
      'https://foo.example.com/doc/abc/f/4'
    );
    assert.equal(
      state.makeUrl({doc: 'abc', slug: '123', form: {vsId: 4}}),
      'https://foo.example.com/abc/123/f/4'
    );
  });

  it('should produce correct results with single-org config', async function() {
    mockWindow.location = new URL('https://example.com/ws/10/') as unknown as Location;
    const state = UrlState.create(null, mockWindow, single);
    const loadPageSpy = sandbox.spy(mockWindow, '_urlStateLoadPage');
    assert.deepEqual(state.state.get(), {org: 'mars', ws: 10});

    const link = dom('a', state.setLinkUrl({ws: 4}));
    assert.equal(link.getAttribute('href'), 'https://example.com/ws/4/');

    assert.equal(state.makeUrl({ws: undefined}), 'https://example.com/');
    assert.equal(state.makeUrl({org: 'AB', doc: 'DOC', docPage: 5}), 'https://example.com/o/AB/doc/DOC/p/5');

    await state.pushUrl({doc: 'baz'});
    assertResetCall(loadPageSpy, 'https://example.com/doc/baz');
    state.loadState();

    assert.equal(mockWindow.location.href, 'https://example.com/doc/baz');
    assert.deepEqual(state.state.get(), {org: 'mars', doc: 'baz'});
    assert.equal(link.getAttribute('href'), 'https://example.com/ws/4/');

    await state.pushUrl({org: 'foo'});
    assertResetCall(loadPageSpy, 'https://example.com/o/foo/');
    state.loadState();

    assert.equal(mockWindow.location.href, 'https://example.com/o/foo/');
    assert.deepEqual(state.state.get(), {org: 'foo'});
    assert.equal(link.getAttribute('href'), 'https://example.com/o/foo/ws/4/');

    // Check form URLs in single org setup from document pages.
    await state.pushUrl({org: 'foo', doc: 'abc'});
    state.loadState();
    assert.equal(
      state.makeUrl({doc: undefined, form: {vsId: 4, shareKey: 'key'}}),
      'https://example.com/o/foo/forms/key/4'
    );
    assert.equal(
      state.makeUrl({doc: 'abc', form: {vsId: 4}}),
      'https://example.com/o/foo/doc/abc/f/4'
    );
    assert.equal(
      state.makeUrl({doc: 'abc', slug: '123', form: {vsId: 4}}),
      'https://example.com/o/foo/abc/123/f/4'
    );
  });

  it('should produce correct results with custom config', async function() {
    mockWindow.location = new URL('https://example.com/ws/10/') as unknown as Location;
    const state = UrlState.create(null, mockWindow, custom);
    const loadPageSpy = sandbox.spy(mockWindow, '_urlStateLoadPage');
    assert.deepEqual(state.state.get(), {org: 'mars', ws: 10});

    const link = dom('a', state.setLinkUrl({ws: 4}));
    assert.equal(link.getAttribute('href'), 'https://example.com/ws/4/');

    assert.equal(state.makeUrl({ws: undefined}), 'https://example.com/');
    assert.equal(state.makeUrl({org: 'ab-cd', doc: 'DOC', docPage: 5}), 'https://ab-cd.example.com/doc/DOC/p/5');

    await state.pushUrl({doc: 'baz'});
    assertResetCall(loadPageSpy, 'https://example.com/doc/baz');
    state.loadState();

    assert.equal(mockWindow.location.href, 'https://example.com/doc/baz');
    assert.deepEqual(state.state.get(), {org: 'mars', doc: 'baz'});
    assert.equal(link.getAttribute('href'), 'https://example.com/ws/4/');

    await state.pushUrl({org: 'foo'});
    assertResetCall(loadPageSpy, 'https://foo.example.com/');
    state.loadState();
    assert.equal(mockWindow.location.href, 'https://foo.example.com/');
    // This test assumes gristConfig doesn't depend on the request, which is no longer the case,
    // so some behavior isn't tested here, and this whole suite is a poor reflection of reality.
  });

  it('should support an update function to pushUrl and makeUrl', async function() {
    mockWindow.location = new URL('https://bar.example.com/doc/DOC/p/5') as unknown as Location;
    const state = UrlState.create(null, mockWindow, prod) as UrlState<IGristUrlState>;
    await state.pushUrl({params: {style: 'singlePage', linkParameters: {foo: 'A', bar: 'B'}}});
    assert.equal(mockWindow.location.href, 'https://bar.example.com/doc/DOC/p/5?style=singlePage&foo_=A&bar_=B');
    state.loadState();  // changing linkParameters requires a page reload
    assert.equal(state.makeUrl((prevState) => merge({}, prevState, {params: {style: 'full'}})),
      'https://bar.example.com/doc/DOC/p/5?style=full&foo_=A&bar_=B');
    assert.equal(state.makeUrl((prevState) => { const s = clone(prevState); delete s.params?.style; return s; }),
      'https://bar.example.com/doc/DOC/p/5?foo_=A&bar_=B');
    assert.equal(state.makeUrl((prevState) =>
      merge(omit(prevState, 'params.style', 'params.linkParameters.foo'),
        {params: {linkParameters: {baz: 'C'}}})),
      'https://bar.example.com/doc/DOC/p/5?bar_=B&baz_=C');
    assert.equal(state.makeUrl((prevState) =>
      merge(omit(prevState, 'params.style'), {docPage: 44, params: {linkParameters: {foo: 'X'}}})),
      'https://bar.example.com/doc/DOC/p/44?foo_=X&bar_=B');
    await state.pushUrl(prevState => omit(prevState, 'params'));
    assert.equal(mockWindow.location.href, 'https://bar.example.com/doc/DOC/p/5');
  });

  describe('login-urls', function() {
    const originalWindow = (global as any).window;

    after(() => {
      (global as any).window = originalWindow;
    });

    function setWindowLocation(href: string) {
      (global as any).window = {location: {href}};
    }

    it('getLoginUrl should return appropriate login urls', function() {
      setWindowLocation('http://localhost:8080');
      assert.equal(getLoginUrl(), 'http://localhost:8080/login?next=%2F');
      setWindowLocation('https://docs.getgrist.com/');
      assert.equal(getLoginUrl(), 'https://docs.getgrist.com/login?next=%2F');
      setWindowLocation('https://foo.getgrist.com?foo=1&bar=2#baz');
      assert.equal(getLoginUrl(), 'https://foo.getgrist.com/login?next=%2F%3Ffoo%3D1%26bar%3D2%23baz');
      setWindowLocation('https://example.com');
      assert.equal(getLoginUrl(), 'https://example.com/login?next=%2F');
    });

    it('getLoginUrl should encode redirect url in next param', function() {
      setWindowLocation('http://localhost:8080/o/docs/foo');
      assert.equal(getLoginUrl(), 'http://localhost:8080/o/docs/login?next=%2Ffoo');
      setWindowLocation('https://docs.getgrist.com/RW25C4HAfG/Test-Document');
      assert.equal(getLoginUrl(), 'https://docs.getgrist.com/login?next=%2FRW25C4HAfG%2FTest-Document');
    });

    it('getLoginUrl should include query params and hashes in next param', function() {
      setWindowLocation('https://foo.getgrist.com/Y5g3gBaX27D/With-Hash/p/1/#a1.s8.r2.c23');
      assert.equal(
        getLoginUrl(),
        'https://foo.getgrist.com/login?next=%2FY5g3gBaX27D%2FWith-Hash%2Fp%2F1%2F%23a1.s8.r2.c23'
      );
      setWindowLocation('https://example.com/rHz46S3F77DF/With-Params?compare=RW25C4HAfG');
      assert.equal(
        getLoginUrl(),
        'https://example.com/login?next=%2FrHz46S3F77DF%2FWith-Params%3Fcompare%3DRW25C4HAfG'
      );
      setWindowLocation('https://example.com/rHz46S3F77DF/With-Params?compare=RW25C4HAfG#a1.s8.r2.c23');
      assert.equal(
        getLoginUrl(),
        'https://example.com/login?next=%2FrHz46S3F77DF%2FWith-Params%3Fcompare%3DRW25C4HAfG%23a1.s8.r2.c23'
      );
    });

    it('getLoginUrl should skip encoding redirect url on signed-out page', function() {
      setWindowLocation('http://localhost:8080/o/docs/signed-out');
      assert.equal(getLoginUrl(), 'http://localhost:8080/o/docs/login?next=%2F');
      setWindowLocation('https://docs.getgrist.com/signed-out');
      assert.equal(getLoginUrl(), 'https://docs.getgrist.com/login?next=%2F');
    });
  });
});
