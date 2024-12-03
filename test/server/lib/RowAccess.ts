// import { DocAction } from 'app/common/DocActions';
import { getRelatedRows } from 'app/server/lib/RowAccess';
import { assert } from 'chai';

describe('RowAccess', function() {
  describe('getRelatedRows', function() {
    it('accumulates individual updates and removes', function() {
      assert.deepEqual(getRelatedRows([['UpdateRecord', 'Table1', 1, {X: 1}]]),
                       [ ['Table1', new Set([1])] ]);
      // check sets are compared correctly
      assert.notDeepEqual(getRelatedRows([['UpdateRecord', 'Table1', 1, {X: 1}]]),
                          [ ['Table1', new Set([])] ]);
      assert.deepEqual(getRelatedRows([['UpdateRecord', 'Table1', 1, {X: 1}],
                                       ['AddRecord', 'Table2', 2, {}],
                                       ['RemoveRecord', 'Table3', 3]]),
                       [ ['Table1', new Set([1])],
                         ['Table2', new Set([])],
                         ['Table3', new Set([3])] ]);
    });

    it('accumulates bulk updates and removes', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}]]),
                       [ ['Table1', new Set([1, 2])] ]);
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 10], {}],
                                       ['BulkAddRecord', 'Table2', [2, 20], {}],
                                       ['BulkRemoveRecord', 'Table3', [3, 30]]]),
                       [ ['Table1', new Set([1, 10])],
                         ['Table2', new Set([])],
                         ['Table3', new Set([3, 30])] ]);
    });

    it('accumulates individual and bulk updates and removes', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 10], {}],
                                       ['UpdateRecord', 'Table1', 100, {}],
                                       ['BulkAddRecord', 'Table1', [2, 20], {}],
                                       ['AddRecord', 'Table1', 200, {}],
                                       ['BulkRemoveRecord', 'Table1', [3, 30]],
                                       ['RemoveRecord', 'Table1', 300]]),
                       [ ['Table1', new Set([1, 3, 10, 30, 100, 300])] ]);
    });

    it('discounts rows added within the bundle', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}],
                                       ['AddRecord', 'Table1', 10, {}],
                                       ['BulkAddRecord', 'Table1', [11, 12], {}],
                                       ['UpdateRecord', 'Table1', 10, {}],
                                       ['RemoveRecord', 'Table1', 10],
                                       ['UpdateRecord', 'Table1', 11, {}],
                                       ['BulkRemoveRecord', 'Table1', [12, 30]]]),
                       [ ['Table1', new Set([1, 2, 30])] ]);
    });

    it('discounts replacement rows', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}],
                                       ['ReplaceTableData', 'Table1', [1, 2, 3, 4], {}],
                                       ['BulkUpdateRecord', 'Table1', [2, 3], {}]]),
                       [ ['Table1', new Set([1, 2])] ]);
    });

    it('tolerate table renames', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}],
                                       ['AddRecord', 'Table1', 10, {}],
                                       ['RenameTable', 'Table1', 'Table2'],
                                       ['BulkAddRecord', 'Table1', [11, 12], {}],
                                       ['UpdateRecord', 'Table2', 10, {}],
                                       ['RemoveRecord', 'Table2', 10],
                                       ['UpdateRecord', 'Table2', 11, {}],
                                       ['BulkRemoveRecord', 'Table2', [12, 30]]]),
                       [ ['Table1', new Set([1, 2, 30])] ]);
    });

    it('ignore new tables', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}],
                                       ['AddRecord', 'Table1', 10, {}],
                                       ['AddTable', 'Table2', []],
                                       ['BulkUpdateRecord', 'Table2', [1, 2], {}]]),
                       [ ['Table1', new Set([1, 2])] ]);
    });

    it('keep table names straight', function() {
      assert.deepEqual(getRelatedRows([['BulkUpdateRecord', 'Table1', [1, 2], {}],
                                       ['RenameTable', 'Table1', 'Table3'],
                                       ['RenameTable', 'Table2', 'Table1'],
                                       ['RenameTable', 'Table3', 'Table2'],
                                       ['UpdateRecord', 'Table1', 10, {}],
                                       ['RemoveTable', 'Table1'],
                                       ['AddTable', 'Table1', []],
                                       ['AddRecord', 'Table1', 20, {}]]),
                       [ ['Table1', new Set([1, 2])],
                         ['Table2', new Set([10])] ]);
    });
  });
});
