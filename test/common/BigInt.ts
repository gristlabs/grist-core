import {BigInt} from 'app/common/BigInt';
import {assert} from 'chai';
import {times} from 'lodash';

describe('BigInt', function() {
  it('should represent and convert various numbers correctly', function() {
    assert.strictEqual(new BigInt(16, [0xF, 0xA], +1).toString(16), "af");
    assert.strictEqual(new BigInt(16, [0xA, 0xF], -1).toString(16), "-fa");
    assert.strictEqual(new BigInt(16, [0xF, 0xF], +1).toString(10), "255");
    assert.strictEqual(new BigInt(16, [0xF, 0xF], -1).toString(10), "-255");

    assert.strictEqual(new BigInt(10, times(20, () => 5), 1).toString(10), "55555555555555555555");
    assert.strictEqual(new BigInt(100, times(20, () => 5), 1).toString(10),
      "505050505050505050505050505050505050505");
    assert.strictEqual(new BigInt(1000, times(20, () => 5), 1).toString(10),
      "5005005005005005005005005005005005005005005005005005005005");

    assert.strictEqual(new BigInt(0x10000, [0xABCD, 0x1234, 0xF0F0, 0x5678], -1).toString(16),
      "-5678f0f01234abcd");
  });
});
