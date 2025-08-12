import {
  commonUrls as defaultCommonUrls,
  getCommonUrls
} from 'app/server/lib/commonUrls';

import { assert } from 'chai';
import Sinon from 'sinon';

describe('commonUrls', function () {
  let sandbox: Sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = Sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
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

      it('should throw when keys extraneous to the ICommonUrls interface are added', function () {
        const nonExistingKey = 'iDontExist';
        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          `{"${nonExistingKey}": "foo", "help": "https://getgrist.com"}`);
        assert.throws(() => getCommonUrls(), `value.${nonExistingKey} is extraneous`);
      });

      it('should throw when the passed JSON is malformed', function () {
        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS', '{"malformed": 42');
        assert.throws(() => getCommonUrls(), 'The JSON passed to GRIST_CUSTOM_COMMON_URLS is malformed');
      });

      it('should throw when keys has unexpected type', function () {
        const regularValueKey = 'help';
        const numberValueKey = 'helpAccessRules';
        const objectValueKey = 'helpAssistant';
        const arrayValueKey = 'helpAssistantDataUse';
        const nullValueKey = 'helpFormulaAssistantDataUse';

        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          JSON.stringify({
            [regularValueKey]: "https://getgrist.com",
            [numberValueKey]: 42,
            [objectValueKey]: {"key": "value"},
            [arrayValueKey]: ["foo"],
          })
        );
        const buildExpectedErrRegEx = (...keys: string[]) => new RegExp(
          keys.map(key => `value\\.${key}`).join('.*'),
          'ms'
        );
        assert.throws(() => getCommonUrls(), buildExpectedErrRegEx(numberValueKey, objectValueKey, arrayValueKey));
        sandbox.restore();
        sandbox.define(process.env, 'GRIST_CUSTOM_COMMON_URLS',
          JSON.stringify({
            [regularValueKey]: "https://getgrist.com",
            [nullValueKey]: null,
          })
        );
        assert.throws(() => getCommonUrls(), buildExpectedErrRegEx(nullValueKey));
      });

      it("should return the default URLs when the parsed value is not an object", function () {
        sandbox.define(process.env, "GRIST_CUSTOM_COMMON_URLS", "42");
        assert.deepEqual(getCommonUrls(), defaultCommonUrls);
        sandbox.restore();
        sandbox.define(process.env, "GRIST_CUSTOM_COMMON_URLS", "null");
        assert.deepEqual(getCommonUrls(), defaultCommonUrls);
      });
    });
  });
});
