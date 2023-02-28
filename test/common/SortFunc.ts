import {emptyCompare, typedCompare} from 'app/common/SortFunc';
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

  it('typedCompare should treat empty values as equal', function() {
    assert.equal(typedCompare(null, null), 0);
    assert.equal(typedCompare('', ''), 0);
  });

  describe('emptyCompare', function() {

    it('should work correctly ', function() {
      const comparator = emptyCompare(typedCompare);
      assert.equal(comparator(null, null), 0);
      assert.equal(comparator('', ''), 0);

      assert.equal(comparator(null, 0), 1);
      assert.equal(comparator(null, -1), 1);
      assert.equal(comparator(null, 1), 1);
      assert.equal(comparator(null, 'a'), 1);
      assert.equal(comparator(null, 'z'), 1);

      assert.equal(comparator(0, null), -1);
      assert.equal(comparator(-1, null), -1);
      assert.equal(comparator(1, null), -1);
      assert.equal(comparator('a', null), -1);
      assert.equal(comparator('z', null), -1);
    });

    it('should keep sorting order consistent amongst empty values', function() {
      // values1 and values2 have same values but in different order. Sorting them with emptyCompare
      // function should yield same results.
      const values1 = ['', null, undefined, 2, 3, 4];
      const values2 = [undefined, null, '', 2, 3, 4];
      const comparator = emptyCompare(typedCompare);
      values1.sort(comparator);
      values2.sort(comparator);
      assert.deepEqual(values1, values2);
    });

  });

});
