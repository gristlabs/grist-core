import { AppSettings } from 'app/server/lib/AppSettings';
import { EnvironmentSnapshot } from '../testUtils';

import { assert } from 'chai';

describe('AppSettings', () => {
  let appSettings: AppSettings;
  let env: EnvironmentSnapshot;
  beforeEach(() => {
    appSettings = new AppSettings('test');
    env = new EnvironmentSnapshot();
  });

  afterEach(() => {
    env.restore();
  });

  describe('for integers', () => {
    function testIntMethod(method: 'readInt' | 'requireInt') {
      it('should throw an error if the value is less than the minimum', () => {
        process.env.TEST = '4';
        assert.throws(() => {
          appSettings[method]({ envVar: 'TEST', minValue: 5 });
        }, 'value 4 is less than minimum 5');
      });

      it('should throw an error if the value is greater than the maximum', () => {
        process.env.TEST = '6';
        assert.throws(() => {
          appSettings[method]({ envVar: 'TEST', maxValue: 5 });
        }, 'value 6 is greater than maximum 5');
      });

      it('should throw if the value is NaN', () => {
        process.env.TEST = 'not a number';
        assert.throws(() => appSettings[method]({ envVar: 'TEST' }), 'not a number does not look like a number');
      });

      it('should throw if the default value is not finite', () => {
        assert.throws(
          () => appSettings[method]({ envVar: 'TEST', defaultValue: Infinity }),
          'Infinity does not look like a number'
        );
      });

      it('should throw if the default value is not within the range', () => {
        assert.throws(
          () => appSettings[method]({
            envVar: 'TEST',
            defaultValue: 6,
            minValue: 7,
            maxValue: 9,
          }),
          'value 6 is less than minimum 7'
        );
      });

      it('should return the default value if it is within the range', () => {
        const result = appSettings[method]({
          envVar: 'TEST',
          defaultValue: 5,
          minValue: 5,
          maxValue: 12
        });
        assert.strictEqual(result, 5);
      });

      it('should return the value if it is within the range', () => {
        process.env.TEST = '5';
        assert.strictEqual(appSettings[method]({ envVar: 'TEST', minValue: 5 }), 5);
      });

      it('should return the integer value of a float', () => {
        process.env.TEST = '5.9';
        assert.strictEqual(appSettings[method]({ envVar: 'TEST' }), 5);
      });
    }

    describe('readInt()', () => {
      testIntMethod('readInt');

      it('should return undefined when no value nor default value is passed', () => {
        const result = appSettings.readInt({ envVar: 'TEST', maxValue: 5 });
        assert.isUndefined(result);
      });
    });

    describe('requireInt()', () => {
      testIntMethod('requireInt');

      it('should throw if env variable is not set and no default value is passed', () => {
        assert.throws(() => appSettings.requireInt({ envVar: 'TEST' }), 'missing environment variable: TEST');
      });
    });
  });
});
