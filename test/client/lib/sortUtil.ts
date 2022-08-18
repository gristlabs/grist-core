import { Sort } from 'app/common/SortSpec';
import { assert } from 'chai';

const { flipSort: flipColDirection, parseSortColRefs, reorderSortRefs } = Sort;

describe('sortUtil', function () {
  it('should parse column expressions', function () {
    assert.deepEqual(Sort.getColRef(1), 1);
    assert.deepEqual(Sort.getColRef(-1), 1);
    assert.deepEqual(Sort.getColRef('-1'), 1);
    assert.deepEqual(Sort.getColRef('1'), 1);
    assert.deepEqual(Sort.getColRef('1:emptyLast'), 1);
    assert.deepEqual(Sort.getColRef('-1:emptyLast'), 1);
    assert.deepEqual(Sort.getColRef('-1:emptyLast;orderByChoice'), 1);
    assert.deepEqual(Sort.getColRef('1:emptyLast;orderByChoice'), 1);
  });

  it('should support finding', function () {
    assert.equal(Sort.findCol([1, 2, 3], 1), 1);
    assert.equal(Sort.findCol([1, 2, 3], '1'), 1);
    assert.equal(Sort.findCol([1, 2, 3], '-1'), 1);
    assert.equal(Sort.findCol([1, 2, 3], '1'), 1);
    assert.equal(Sort.findCol(['1', 2, 3], 1), '1');
    assert.equal(Sort.findCol(['1:emptyLast', 2, 3], 1), '1:emptyLast');
    assert.equal(Sort.findCol([1, 2, 3], '1:emptyLast'), 1);
    assert.equal(Sort.findCol([1, 2, 3], '-1:emptyLast'), 1);
    assert.isUndefined(Sort.findCol([1, 2, 3], '6'));
    assert.isUndefined(Sort.findCol([1, 2, 3], 6));
    assert.equal(Sort.findColIndex([1, 2, 3], '6'), -1);
    assert.equal(Sort.findColIndex([1, 2, 3], 6), -1);

    assert.isTrue(Sort.contains([1, 2, 3], 1, Sort.ASC));
    assert.isFalse(Sort.contains([-1, 2, 3], 1, Sort.ASC));
    assert.isTrue(Sort.contains([-1, 2, 3], 1, Sort.DESC));
    assert.isTrue(Sort.contains(['1', 2, 3], 1, Sort.ASC));
    assert.isTrue(Sort.contains(['1:emptyLast', 2, 3], 1, Sort.ASC));
    assert.isFalse(Sort.contains(['-1:emptyLast', 2, 3], 1, Sort.ASC));
    assert.isTrue(Sort.contains(['-1:emptyLast', 2, 3], 1, Sort.DESC));

    assert.isTrue(Sort.containsOnly([1], 1, Sort.ASC));
    assert.isTrue(Sort.containsOnly([-1], 1, Sort.DESC));
    assert.isFalse(Sort.containsOnly([1, 2], 1, Sort.ASC));
    assert.isFalse(Sort.containsOnly([2, 1], 1, Sort.ASC));
    assert.isFalse(Sort.containsOnly([2, 1], 1, Sort.DESC));
    assert.isFalse(Sort.containsOnly([-1], 1, Sort.ASC));
    assert.isFalse(Sort.containsOnly([1], 1, Sort.DESC));
    assert.isTrue(Sort.containsOnly(['1:emptyLast'], 1, Sort.ASC));
    assert.isFalse(Sort.containsOnly(['1:emptyLast', 2], 1, Sort.ASC));
    assert.isTrue(Sort.containsOnly(['-1:emptyLast'], 1, Sort.DESC));
    assert.isFalse(Sort.containsOnly(['-1:emptyLast'], 1, Sort.ASC));
    assert.isFalse(Sort.containsOnly(['1:emptyLast'], 1, Sort.DESC));
  });

  it('should support swapping', function () {
    assert.deepEqual(Sort.swapColRef(1, 2), 2);
    assert.deepEqual(Sort.swapColRef(-1, 2), -2);
    assert.deepEqual(Sort.swapColRef('1', 2), 2);
    assert.deepEqual(Sort.swapColRef('-1', 2), -2);
    assert.deepEqual(Sort.swapColRef('-1:emptyLast', 2), '-2:emptyLast');
  });

  it('should create column expressions', function () {
    assert.deepEqual(Sort.setColDirection(2, Sort.ASC), 2);
    assert.deepEqual(Sort.setColDirection(-2, Sort.ASC), 2);
    assert.deepEqual(Sort.setColDirection(-2, Sort.DESC), -2);
    assert.deepEqual(Sort.setColDirection('2', Sort.ASC), 2);
    assert.deepEqual(Sort.setColDirection('-2', Sort.ASC), 2);
    assert.deepEqual(Sort.setColDirection('-2:emptyLast', Sort.ASC), '2:emptyLast');
    assert.deepEqual(Sort.setColDirection('2:emptyLast', Sort.ASC), '2:emptyLast');

    assert.deepEqual(Sort.setColDirection(2, Sort.DESC), -2);
    assert.deepEqual(Sort.setColDirection(-2, Sort.DESC), -2);
    assert.deepEqual(Sort.setColDirection('2', Sort.DESC), -2);
    assert.deepEqual(Sort.setColDirection('-2', Sort.DESC), -2);
    assert.deepEqual(Sort.setColDirection('-2:emptyLast', Sort.DESC), '-2:emptyLast');
    assert.deepEqual(Sort.setColDirection('2:emptyLast', Sort.DESC), '-2:emptyLast');
  });

  const empty = { emptyLast: false, orderByChoice: false, naturalSort: false };

  it('should parse details', function () {
    assert.deepEqual(Sort.specToDetails(2), { colRef: 2, direction: Sort.ASC });
    assert.deepEqual(Sort.specToDetails(-2), { colRef: 2, direction: Sort.DESC });
    assert.deepEqual(Sort.specToDetails('-2:emptyLast'),
      { ...empty, colRef: 2, direction: Sort.DESC, emptyLast: true });
    assert.deepEqual(Sort.specToDetails('-2:emptyLast;orderByChoice'), {
      ...empty,
      colRef: 2,
      direction: Sort.DESC,
      emptyLast: true,
      orderByChoice: true,
    });

    assert.deepEqual(Sort.detailsToSpec({ colRef: 2, direction: Sort.ASC }), 2);
    assert.deepEqual(Sort.detailsToSpec({ colRef: 2, direction: Sort.DESC }), -2);
    assert.deepEqual(Sort.detailsToSpec({ colRef: 2, direction: Sort.ASC, emptyLast: true }), '2:emptyLast');
    assert.deepEqual(Sort.detailsToSpec({ colRef: 2, direction: Sort.DESC, emptyLast: true }), '-2:emptyLast');
    assert.deepEqual(
      Sort.detailsToSpec({ colRef: 1, direction: Sort.DESC, emptyLast: true, orderByChoice: true }),
      '-1:emptyLast;orderByChoice'
    );
  });

  it('should parse names', function () {
    const cols = new Map(Object.entries({ a: 1, id: 0 }));
    assert.deepEqual(Sort.parseNames(['1'], cols), ['1']);
    assert.deepEqual(Sort.parseNames(['0'], cols), ['0']);
    assert.deepEqual(Sort.parseNames(['id'], cols), ['0']);
    assert.deepEqual(Sort.parseNames(['-id'], cols), ['-0']);
    assert.deepEqual(Sort.parseNames(['-1'], cols), ['-1']);
    assert.deepEqual(Sort.parseNames(['a'], cols), ['1']);
    assert.deepEqual(Sort.parseNames(['-a'], cols), ['-1']);
    assert.deepEqual(Sort.parseNames(['a:flag'], cols), ['1:flag']);
    assert.deepEqual(Sort.parseNames(['-a:flag'], cols), ['-1:flag']);
    assert.deepEqual(Sort.parseNames(['-a:flag'], cols), ['-1:flag']);
    assert.throws(() => Sort.parseNames(['-a:flag'], new Map()));
  });

  it('should produce correct results with flipColDirection', function () {
    // Should flip given sortRef.
    // Column direction should not matter
    assert.deepEqual(flipColDirection([1, 2, 3], 3), [1, 2, -3]);
    assert.deepEqual(flipColDirection([1, 2, -3], -3), [1, 2, 3]);
    assert.deepEqual(flipColDirection([1], 1), [-1]);
    assert.deepEqual(flipColDirection([8, -3, 2, 5, -7, -12, 33], -7), [8, -3, 2, 5, 7, -12, 33]);
    assert.deepEqual(flipColDirection([5, 4, 9, -2, -3, -6, -1], 4), [5, -4, 9, -2, -3, -6, -1]);
    assert.deepEqual(flipColDirection([-1, -2, -3], -2), [-1, 2, -3]);

    // Should return original when sortRef not found.
    assert.deepEqual(flipColDirection([1, 2, 3], 4), [1, 2, 3]);
    assert.deepEqual(flipColDirection([], 8), []);
    assert.deepEqual(flipColDirection([1], 4), [1]);
    assert.deepEqual(flipColDirection([-1], 2), [-1]);
  });

  it('should produce correct results with parseSortColRefs', function () {
    // Should parse correctly.
    assert.deepEqual(parseSortColRefs('[1, 2, 3]'), [1, 2, 3]);
    assert.deepEqual(parseSortColRefs('[]'), []);
    assert.deepEqual(parseSortColRefs('[4, 12, -3, -2, -1, 18]'), [4, 12, -3, -2, -1, 18]);

    // Should return empty array on parse failure.
    assert.deepEqual(parseSortColRefs('3]'), []);
    assert.deepEqual(parseSortColRefs('1, 2, 3'), []);
    assert.deepEqual(parseSortColRefs('[12; 16; 18]'), []);
  });

  it('should produce correct results with reorderSortRefs', function () {
    // Should reorder correctly.
    assert.deepEqual(reorderSortRefs([1, 2, 3], 2, 1), [2, 1, 3]);
    assert.deepEqual(reorderSortRefs([12, 2, -4, -5, 6, 8], -4, 8), [12, 2, -5, 6, -4, 8]);
    assert.deepEqual(reorderSortRefs([15, 3, -4, 2, 18], 15, -4), [3, 15, -4, 2, 18]);
    assert.deepEqual(reorderSortRefs([-12, 22, 1, 4], 1, 4), [-12, 22, 1, 4]);
    assert.deepEqual(reorderSortRefs([1, 2, 3], 2, null), [1, 3, 2]);
    assert.deepEqual(reorderSortRefs([4, 3, -2, 5, -8, -9], 3, null), [4, -2, 5, -8, -9, 3]);
    assert.deepEqual(reorderSortRefs([-2, 8, -6, -5, 18], 8, 2), [8, -2, -6, -5, 18]);

    // Should return original array with invalid input.
    assert.deepEqual(reorderSortRefs([1, 2, 3], 2, 4), [1, 2, 3]);
    assert.deepEqual(reorderSortRefs([-5, -4, 6], 3, null), [-5, -4, 6]);
  });

  it('should flip columns', function () {
    assert.deepEqual(Sort.flipCol('1:emptyLast'), '-1:emptyLast');
    assert.deepEqual(Sort.flipCol('-1:emptyLast'), '1:emptyLast');
    assert.deepEqual(Sort.flipCol(2), -2);
    assert.deepEqual(Sort.flipCol(-2), 2);
    assert.deepEqual(Sort.flipSort([-2], 2), [2]);
    assert.deepEqual(Sort.flipSort([2], 2), [-2]);
    assert.deepEqual(Sort.flipSort([2, 1], 2), [-2, 1]);
    assert.deepEqual(Sort.flipSort([-2, -1], 2), [2, -1]);
    assert.deepEqual(Sort.flipSort(['-2:emptyLast', -1], 2), ['2:emptyLast', -1]);
    assert.deepEqual(Sort.flipSort(['2:emptyLast', -1], 2), ['-2:emptyLast', -1]);
    assert.deepEqual(Sort.flipSort(['2:emptyLast', -1], '2'), ['-2:emptyLast', -1]);
    assert.deepEqual(Sort.flipSort(['2:emptyLast', -1], '-2'), ['-2:emptyLast', -1]);
    assert.deepEqual(Sort.flipSort(['2:emptyLast', -1], '-2:emptyLast'), ['-2:emptyLast', -1]);
    assert.deepEqual(Sort.flipSort(['2:emptyLast', -1], '2:emptyLast'), ['-2:emptyLast', -1]);
  });
});
