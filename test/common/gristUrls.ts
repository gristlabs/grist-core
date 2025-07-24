import {
  commonUrls, decodeUrl, getCommonUrls, getHostType, getSlugIfNeeded, IGristUrlState, parseFirstUrlPart
} from 'app/common/gristUrls';
import {assert} from 'chai';
import Sinon from 'sinon';
import * as testUtils from 'test/server/testUtils';

describe('gristUrls', function() {
  let sandbox: Sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = Sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

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

    it('should detect API URLs', function() {
      assertUrlDecode(
        'http://localhost/o/docs/api/docs',
        {api: true},
      );

      assertUrlDecode(
        'http://public.getgrist.com/api/docs',
        {api: true},
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
      sandbox.define(process.env, 'APP_DOC_INTERNAL_URL', 'https://doc-worker-123.internal/path');
      assert.equal(getHostType('doc-worker-123.internal', defaultOptions), 'native');
      assert.equal(getHostType('doc-worker-123.internal:8080', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-124.internal', defaultOptions), 'custom');

      sandbox.restore();
      sandbox.define(process.env, 'APP_DOC_INTERNAL_URL', 'https://doc-worker-123.internal:8080/path');
      assert.equal(getHostType('doc-worker-123.internal:8080', defaultOptions), 'native');
      assert.equal(getHostType('doc-worker-123.internal', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-124.internal:8080', defaultOptions), 'custom');
      assert.equal(getHostType('doc-worker-123.internal:8079', defaultOptions), 'custom');
    });
  });

  describe('getSlugIfNeeded', function() {
    it('should only return a slug when a valid urlId is used', function() {
      assert.strictEqual(getSlugIfNeeded({id: '1234567890abcdef', urlId: '1234567890ab', name: 'Foo'}), 'Foo');
      // urlId too short
      assert.strictEqual(getSlugIfNeeded({id: '1234567890abcdef', urlId: '12345678', name: 'Foo'}), undefined);
      // urlId doesn't match docId
      assert.strictEqual(getSlugIfNeeded({id: '1234567890abcdef', urlId: '1234567890ac', name: 'Foo'}), undefined);
      // no urlId
      assert.strictEqual(getSlugIfNeeded({id: '1234567890abcdef', urlId: '', name: 'Foo'}), undefined);
      assert.strictEqual(getSlugIfNeeded({id: '1234567890abcdef', urlId: null, name: 'Foo'}), undefined);
    });

    it('should leave only alphamerics after replacing reasonable unicode chars', function() {
      const id = '1234567890abcdef', urlId = '1234567890ab';
      // This is mainly a test of the `slugify` library we now use. What matters isn't the
      // specific result, but that the result is reasonable.
      assert.strictEqual(getSlugIfNeeded({id, urlId, name: 'Foo'}), 'Foo');
      assert.strictEqual(getSlugIfNeeded({id, urlId, name: "Hélène's résumé"}), 'Helenes-resume');
      assert.strictEqual(getSlugIfNeeded({id, urlId, name: "Привіт, Їжак!"}), 'Privit-Yizhak');
      assert.strictEqual(getSlugIfNeeded({id, urlId, name: "S&P500 is ~$4,894.16"}), 'SandP500-is-dollar489416');
    });
  });

  describe('getCommonUrls', function () {
    it('should return the default URLs', function () {
      const commonUrls = getCommonUrls();
      assert.isObject(commonUrls);
      assert.equal(commonUrls.help, "https://support.getgrist.com");
    });

    describe("with GRIST_CUSTOM_COMMON_URLS env var set", function () {
      it('should return the values set by the GRIST_CUSTOM_COMMON_URLS env var', function () {
        const customHelpCenterUrl = "http://custom.helpcenter";
        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          `{"help": "${customHelpCenterUrl}"}`);
        const commonUrls = getCommonUrls();
        assert.isObject(commonUrls);
        assert.equal(commonUrls.help, customHelpCenterUrl);
        assert.equal(commonUrls.helpAccessRules, "https://support.getgrist.com/access-rules");
      });

      it('should omit keys that are missing from the default commonUrls object', function () {
        const nonExistingKey = 'iDontExist';
        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          `{"${nonExistingKey}": "foo", "help": "https://getgrist.com"}`);
        const commonUrls = getCommonUrls();
        assert.isObject(commonUrls);
        assert.property(commonUrls, "help");
        assert.notProperty(commonUrls, nonExistingKey);
      });

      it('should ignore keys that are not string', function () {
        const regularKey = 'help';
        const numberKey = 'helpAccessRules';
        const objectKey = 'helpAssistant';
        const arrayKey = 'helpAssistantDataUse';
        const nullKey = 'helpFormulaAssistantDataUse';
        const originalUrls = getCommonUrls();

        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          JSON.stringify({
            [regularKey]: "https://getgrist.com",
            [numberKey]: 42,
            [objectKey]: {"key": "value"},
            [arrayKey]: ["foo"],
            [nullKey]: null,
          })
        );
        const overwrittenUrls = getCommonUrls();
        assert.isObject(overwrittenUrls);
        assert.equal(overwrittenUrls.help, "https://getgrist.com");
        for (const key of [numberKey, objectKey, arrayKey, nullKey]) {
          const typedKey = key as unknown as keyof typeof commonUrls;
          assert.equal(overwrittenUrls[typedKey], originalUrls[typedKey]);
        }
      });

      it("should raise an error when the JSON-parsed value of GRIST_CUSTOM_COMMON_URLS is not an object", function () {
        sandbox.define(process.env, "GRIST_CUSTOM_COMMON_URLS", "42");
        assert.throws(getCommonUrls, /Unexpected/);
        sandbox.restore();
        sandbox.define(process.env, "GRIST_CUSTOM_COMMON_URLS", "null");
        assert.throws(getCommonUrls, /Unexpected/);
      });
    });

    describe("client-side when customized by the admin", function () {
      it("should read the admin-defined values gristConfig", function () {
        sandbox.define(globalThis, 'window', {
          gristConfig: {
            adminDefinedUrls: JSON.stringify({
              help: "https://getgrist.com"
            })
          },
          // Fake location to make isClient() believe the code is executed client-side.
          location: {
            hostname: 'getgrist.com'
          },
        });
        const commonUrls = getCommonUrls();
        assert.isObject(commonUrls);
        assert.equal(commonUrls.help, "https://getgrist.com");
        assert.equal(commonUrls.helpAccessRules, "https://support.getgrist.com/access-rules");
      });
    });
  });
});
