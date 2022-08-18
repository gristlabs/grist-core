import {typedCompare} from 'app/common/SortFunc';
import {assert} from 'chai';
import {format} from 'util';

describe('SortFunc', function() {
  it('should be transitive for values of different types', function() {
    const values = [
      -10, 0, 2, 10.5,
      null,
      ["a"], ["b"], ["b", 1], ["b", 1, 2], ["b", 1, "10"], ["c"],
      "10.5", "2", "a",
      undefined as any,
    ];

    // Check that sorting works as expected (the values above are already sorted).
    const sorted = values.slice(0);
    sorted.sort(typedCompare);
    assert.deepEqual(sorted, values);

    // Check comparisons between each possible pair of values above.
    for (let i = 0; i < values.length; i++) {
      assert.equal(typedCompare(values[i], values[i]), 0, `Expected ${format(values[i])} == ${format(values[i])}`);
      for (let j = i + 1; j < values.length; j++) {
        assert.equal(typedCompare(values[i], values[j]), -1, `Expected ${format(values[i])} < ${format(values[j])}`);
        assert.equal(typedCompare(values[j], values[i]), 1, `Expected ${format(values[j])} > ${format(values[i])}`);
      }
    }
  });
});
