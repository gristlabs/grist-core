import {consolidateValues, sortByXValues, splitValuesByIndex} from 'app/client/lib/chartUtil';
import {assert} from 'chai';
import {Datum} from 'plotly.js';

describe('chartUtil', function() {
  describe('sortByXValues', function() {
    function sort(data: Datum[][]) {
      const series = data.map((values) => ({values, label: 'X'}));
      sortByXValues(series);
      return series.map((s) => s.values);
    }
    it('should sort all series according to the first one', function() {
      // Should handle simple and trivial cases.
      assert.deepEqual(sort([]), []);
      assert.deepEqual(sort([[2, 1, 3, 0.5]]), [[0.5, 1, 2, 3]]);
      assert.deepEqual(sort([[], [], [], []]), [[], [], [], []]);

      // All series should be sorted according to the first one.
      assert.deepEqual(sort([[2, 1, 3, 0.5], ["a", "b", "c", "d"], [null, -1.1, "X", ['a'] as any]]),
                            [[0.5, 1, 2, 3], ["d", "b", "a", "c"], [['a'] as any, -1.1, null, "X"]]);

      // If the first one is sorted, there should be no changes.
      assert.deepEqual(sort([["a", "b", "c", "d"], [2, 1, 3, 0.5], [null, -1.1, "X", ['a'] as any]]),
                            [["a", "b", "c", "d"], [2, 1, 3, 0.5], [null, -1.1, "X", ['a'] as any]]);

      // Should cope if the first series contains values of different type.
      assert.deepEqual(sort([[null, -1.1, "X", ['a'] as any], [2, 1, 3, 0.5], ["a", "b", "c", "d"]]),
                            [[-1.1, null, ['a'] as any, "X"], [1, 2, 0.5, 3], ["b", "a", "d", "c"]]);
    });
  });

  describe('splitValuesByIndex', function() {

    it('should work correctly', function() {
      splitValuesByIndex([{label: 'test', values: []}, {label: 'foo', values: []}], 0);
      assert.deepEqual(splitValuesByIndex([
        {label: 'foo', values: [['L', 'foo', 'bar'], ['L', 'baz']] as any},
        {label: 'bar', values: ['santa', 'janus']}
      ], 0), [
        {label: 'foo', values: ['foo', 'bar', 'baz']},
        {label: 'bar', values: ['santa', 'santa', 'janus']}
      ]);

      assert.deepEqual(splitValuesByIndex([
        {label: 'bar', values: ['santa', 'janus']},
        {label: 'foo', values: [['L', 'foo', 'bar'], ['L', 'baz']] as any},
      ], 1), [
        {label: 'bar', values: ['santa', 'santa', 'janus']},
        {label: 'foo', values: ['foo', 'bar', 'baz']},
      ]);
    });
  });

  describe('consolidateValues', function() {
    it('should add missing values', function() {
      assert.deepEqual(
        consolidateValues(
          [
            {values: []},
            {values: []}
          ],
          ['A', 'B']
        ),
        [
          {values: ['A', 'B']},
          {values: [0, 0]},
        ]
      );

      assert.deepEqual(
        consolidateValues(
          [
            {values: ['A']},
            {values: [3]}
          ],
          ['A', 'B']
        ),
        [
          {values: ['A', 'B']},
          {values: [3, 0]},
        ]
      );

      assert.deepEqual(
        consolidateValues(
          [
            {values: ['B']},
            {values: [1]}
          ],
          ['A', 'B']
        ),
        [
          {values: ['A', 'B']},
          {values: [0, 1]},
        ]
      );
    });

    it('should keep redundant value', function() {

      assert.deepEqual(
        consolidateValues(
          [
            {values: ['A', 'A']},
            {values: [1, 2]}
          ],
          ['A', 'B']
        ),
        [
          {values: ['A', 'A', 'B']},
          {values: [1, 2, 0]},
        ]
      );

      assert.deepEqual(
        consolidateValues(
          [
            {values: ['B', 'B']},
            {values: [1, 2]}
          ],
          ['A', 'B']
        ),
        [
          {values: ['A', 'B', 'B']},
          {values: [0, 1, 2]},
        ]
      );
    });

    it('another case', function() {
      assert.deepEqual(
        consolidateValues(
          [
            {values: ['A', 'C']},
            {values: [1, 2]},
          ],
          ['A', 'B', 'C', 'D']
        ),
        [
          {values: ['A', 'B', 'C', 'D']},
          {values: [1, 0, 2, 0]},
        ]
      );
    });
  });
});
