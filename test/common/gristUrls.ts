import {parseFirstUrlPart} from 'app/common/gristUrls';
import {assert} from 'chai';

describe('gristUrls', function() {

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
