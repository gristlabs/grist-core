import { assert } from 'chai';
import { getGravatarUrl } from 'app/common/GravatarUtils';

const md5 = require('blueimp-md5');

describe('GravatarUtils', function() {
  describe('getGravatarUrl', function() {
    it('should generate correct Gravatar URL for a standard email', function() {
      const email = 'test@example.com';
      const url = getGravatarUrl(email);
      assert.match(url, /^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{32}\?s=200&d=identicon$/);
      assert.include(url, md5(email.trim().toLowerCase()));
    });

    it('should normalize email (trim and lowercase)', function() {
      const email = '  Test@Example.COM  ';
      const url = getGravatarUrl(email);
      assert.include(url, md5(email.trim().toLowerCase()));
    });

    it('should use default size of 200', function() {
      const email = 'test@example.com';
      const url = getGravatarUrl(email);
      assert.include(url, 's=200');
    });

    it('should accept custom size', function() {
      const email = 'test@example.com';
      const url = getGravatarUrl(email, 100);
      assert.include(url, 's=100');
    });

    it('should handle email with no Gravatar (returns identicon)', function() {
      const email = 'nonexisting@example.com';
      const url = getGravatarUrl(email);
      assert.match(url, /^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{32}\?s=200&d=identicon$/);
      assert.include(url, md5(email.trim().toLowerCase()));
    });

    it('should include identicon fallback', function() {
      const email = 'test@example.com';
      const url = getGravatarUrl(email);
      assert.include(url, 'd=identicon');
    });
  });
});