import {decodeUrl, IGristUrlState, parseFirstUrlPart} from 'app/common/gristUrls';
import {assert} from 'chai';

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
});
