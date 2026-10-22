import { ColumnGetter, ColumnGetters } from "app/common/ColumnGetters";
import { SortFunc, typedCompare } from "app/common/SortFunc";
import { Sort } from "app/common/SortSpec";

import { format } from "util";

import { assert } from "chai";

describe("SortFunc", function() {
  it("should be transitive for values of different types", function() {
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

  it("should be a total order, including for unexpected values", function() {
    // Cells may hold values that native comparisons mishandle: NaN is unequal to everything, and
    // objects such as Uint8Array get coerced to primitives.
    const values = [
      -10, 0, 2, 10.5, NaN, Infinity, -Infinity,
      null, {}, new Date(1), new Date(2), new Uint8Array([1]), new Uint8Array([2]),
      ["a"], ["b", 1], [null], [NaN],
      "", "10.5", "a", true, false, undefined as any,
    ];
    const cmp = typedCompare;
    for (const a of values) {
      for (const b of values) {
        assert.equal(cmp(a, b), -cmp(b, a), `Expected antisymmetry for ${format(a)}, ${format(b)}`);
        for (const c of values) {
          if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
            assert.isTrue(cmp(a, c) <= 0, `Expected ${format(a)} <= ${format(b)} <= ${format(c)}`);
          }
        }
      }
    }
  });

  it("should order Date objects by time", function() {
    // Dates are not expected in cell values, but typedCompare should be usable for other values too.
    assert.equal(typedCompare(new Date(1), new Date(2)), -1);
    assert.equal(typedCompare(new Date(2), new Date(1)), 1);
    assert.equal(typedCompare(new Date(1), new Date(1)), 0);
  });

  it("typedCompare should treat empty values as equal", function() {
    assert.equal(typedCompare(null, null), 0);
    assert.equal(typedCompare("", ""), 0);
  });

  describe("compare", function() {
    // Sorts the values of a single column, using rowIds 1, 2, ... for its rows.
    function sortRows(values: any[], colSpec: Sort.ColSpec): any[] {
      const getters: ColumnGetters = {
        getColGetter(): ColumnGetter { return rowId => values[rowId - 1]; },
        getManualSortGetter() { return null; },
      };
      const sortFunc = new SortFunc(getters);
      sortFunc.updateSpec([colSpec]);
      // Convert array indices into more realistic rowIds (which normally can't be 0).
      const rowIds = values.map((_, index) => index + 1);
      return rowIds.sort((rowId1, rowId2) => sortFunc.compare(rowId1, rowId2))
        .map(rowId => values[rowId - 1]);
    }

    // In a Date column values are numbers and empty values are nulls, which sort after numbers by
    // default. In a Text column empty values are "", which sort before other text.
    const dates = [300, null, 100, 200];      // Number and dates are represented the same way.
    const texts = ["c", "", "a", "b"];

    it("should sort empty values first or last, as told", function() {
      assert.deepEqual(sortRows(dates, "1:emptyFirst"), [null, 100, 200, 300]);
      assert.deepEqual(sortRows(dates, "1:emptyLast"), [100, 200, 300, null]);
      assert.deepEqual(sortRows(texts, "1:emptyFirst"), ["", "a", "b", "c"]);
      assert.deepEqual(sortRows(texts, "1:emptyLast"), ["a", "b", "c", ""]);
    });

    it("should leave empty values where their type puts them without an option", function() {
      // This ensures the order without any options is unchanged from what it's always been.
      assert.deepEqual(sortRows(dates, 1), [100, 200, 300, null]);
      assert.deepEqual(sortRows(texts, 1), ["", "a", "b", "c"]);
    });

    it("should reverse the whole order when sorting descending", function() {
      for (const values of [dates, texts]) {
        for (const spec of ["1", "1:emptyFirst", "1:emptyLast"]) {
          const ascending = sortRows(values, spec);
          assert.deepEqual(sortRows(values, `-${spec}`), ascending.slice().reverse(),
            `Expected descending to reverse ascending for ${format(values)} with "${spec}"`);
        }
      }
    });

    it("should offer four orderings for any column", function() {
      for (const values of [dates, texts]) {
        const orderings = ["1:emptyFirst", "1:emptyLast", "-1:emptyFirst", "-1:emptyLast"]
          .map(colSpec => JSON.stringify(sortRows(values, colSpec)));
        assert.equal(new Set(orderings).size, 4, `Expected distinct orderings for ${format(values)}`);
      }
    });
  });
});
