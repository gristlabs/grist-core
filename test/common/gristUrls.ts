import {decodeUrl, getHostType, IGristUrlState, parseFirstUrlPart} from 'app/common/gristUrls';
import {assert} from 'chai';
import * as testUtils from 'test/server/testUtils';

describe('gristUrls', function() {

  function assertUrlDecode(url: string, expected: Partial<IGristUrlState>) {
    const actual = decodeUrl({}, new URL(url));

    for (const property in expected) {
      const expectedValue = expected[property as keyof IGristUrlState];
      const actualValue = actual[property as keyof IGristUrlState];

      assert.deepEqual(actualValue, expectedValue);
    }
  }

  describe('encodeUrl', function() {
    it('should detect theme appearance override', function() {
      assertUrlDecode(
        'http://localhost/?themeAppearance=light',
        {params: {themeAppearance: 'light'}},
      );

      assertUrlDecode(
        'http://localhost/?themeAppearance=dark',
        {params: {themeAppearance: 'dark'}},
      );
    });

    it('should detect theme sync with os override', function() {
      assertUrlDecode(
        'http://localhost/?themeSyncWithOs=true',
        {params: {themeSyncWithOs: true}},
      );
    });

    it('should detect theme name override', function() {
      assertUrlDecode(
        'http://localhost/?themeName=GristLight',
        {params: {themeName: 'GristLight'}},
      );

      assertUrlDecode(
        'http://localhost/?themeName=GristDark',
        {params: {themeName: 'GristDark'}},
      );
    });
  });

  describe('parseFirstUrlPart', function() {
    it('should strip out matching tag', function() {
      assert.deepEqual(parseFirstUrlPart('o', '/o/foo/bar?x#y'), {value: 'foo', path: '/bar?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/o/foo?x#y'), {value: 'foo', path: '/?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/o/foo#y'), {value: 'foo', path: '/#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/o/foo'), {value: 'foo', path: '/'});
    });

    it('should pass unchanged non-matching path or tag', function() {
      assert.deepEqual(parseFirstUrlPart('xxx', '/o/foo/bar?x#y'), {path: '/o/foo/bar?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/O/foo/bar?x#y'), {path: '/O/foo/bar?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/bar?x#y'), {path: '/bar?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/o/?x#y'), {path: '/o/?x#y'});
      assert.deepEqual(parseFirstUrlPart('o', '/#y'), {path: '/#y'});
      assert.deepEqual(parseFirstUrlPart('o', ''), {path: ''});
    });
  });

  describe('getHostType', function() {
    const defaultOptions = {
      baseDomain: 'getgrist.com',
      pluginUrl: 'https://plugin.getgrist.com',
    };

    let oldEnv: testUtils.EnvironmentSnapshot;

    beforeEach(function () {
      oldEnv = new testUtils.EnvironmentSnapshot();
    });

    afterEach(function () {
      oldEnv.restore();
    });

    it('should interpret localhost as "native"', function() {
      assert.equal(getHostType('localhost', defaultOptions), 'native');
      assert.equal(getHostType('localhost:8080', defaultOptions), 'native');
    });

    it('should interpret base domain as "native"', function() {
      assert.equal(getHostType('getgrist.com', defaultOptions), 'native');
      assert.equal(getHostType('www.getgrist.com', defaultOptions), 'native');
      assert.equal(getHostType('foo.getgrist.com', defaultOptions), 'native');
      assert.equal(getHostType('foo.getgrist.com:8080', defaultOptions), 'native');
    });

    it('should interpret plugin domain as "plugin"', function() {
      assert.equal(getHostType('plugin.getgrist.com', defaultOptions), 'plugin');
      assert.equal(getHostType('PLUGIN.getgrist.com', { pluginUrl: 'https://pLuGin.getgrist.com' }), 'plugin');
    });

    it('should interpret other domains as "custom"', function() {
      assert.equal(getHostType('foo.com', defaultOptions), 'custom');
      assert.equal(getHostType('foo.bar.com', defaultOptions), 'custom');
    });

    it('should interpret doc internal url as "native"', function() {
      process.env.APP_DOC_INTERNAL_URL = 'https://doc-worker-123.internal/path';
      assert.equal(getHostType('doc-worker-123.internal', defaultOptions), 'native');
      assert.equal(getHostType('doc-worker-123.internal:8080', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-124.internal', defaultOptions), 'custom');

      process.env.APP_DOC_INTERNAL_URL = 'https://doc-worker-123.internal:8080/path';
      assert.equal(getHostType('doc-worker-123.internal:8080', defaultOptions), 'native');
      assert.equal(getHostType('doc-worker-123.internal', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-124.internal:8080', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-123.internal:8079', defaultOptions), 'custom');
    });
  });
});
