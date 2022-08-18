import {CellValue, TableDataAction} from 'app/common/DocActions';
import {TableData} from 'app/common/TableData';
import {assert} from 'chai';
import {unzip, zipObject} from 'lodash';


describe('TableData', function() {
  const sampleData: TableDataAction = ["TableData", "Foo", [1, 4, 5, 7], {
    city: ['New York', 'Boston', 'Boston', 'Seattle'],
    state: ['NY', 'MA', 'MA', 'WA'],
    amount: [5, 4, "NA", 2],
    bool: [true, true, false, false],
  }];

  // Transpose the given matrix. If empty, it's considered to consist of 0 rows and
  // colArray.length columns, so that the transpose has colArray.length empty rows.
  function transpose<T>(matrix: T[][], colArray: any[]): T[][] {
    return matrix.length > 0 ? unzip(matrix) : colArray.map(c => []);
  }

  function verifyTableData(t: TableData, colIds: string[], data: CellValue[][]): void {
    const idIndex = colIds.indexOf('id');
    assert(idIndex !== -1, "verifyTableData expects 'id' column");
    const rowIds: number[] = data.map(row => row[idIndex]) as number[];
    assert.strictEqual(t.numRecords(), data.length);
    assert.sameMembers(t.getColIds(), colIds);
    assert.deepEqual(t.getSortedRowIds(), rowIds);
    assert.sameMembers(Array.from(t.getRowIds()), rowIds);
    const transposed = transpose(data, colIds);

    // Verify data using .getValue()
    assert.deepEqual(rowIds.map(r => colIds.map(c => t.getValue(r, c))), data);

    // Verify data using getRowPropFunc()
    assert.deepEqual(colIds.map(c => rowIds.map(t.getRowPropFunc(c)!)), transposed);

    // Verify data using getRecord()
    const expRecords = data.map((row, i) => zipObject(colIds, row));
    assert.deepEqual(rowIds.map(r => t.getRecord(r)) as any, expRecords);

    // Verify data using getRecords().
    assert.sameDeepMembers(t.getRecords(), expRecords);

    // Verify data using getColValues().
    const rawOrderedData = t.getRowIds().map(r => data[rowIds.indexOf(r)]);
    const rawOrderedTransposed = transpose(rawOrderedData, colIds);
    assert.deepEqual(colIds.map(c => t.getColValues(c)), rawOrderedTransposed);
  }

  it('should start out empty and support loadData', function() {
    const t = new TableData('Foo', null, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});
    assert.equal(t.tableId, 'Foo');
    assert.isFalse(t.isLoaded);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], []);

    t.loadData(sampleData);
    assert.isTrue(t.isLoaded);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'Boston', 'MA', 4, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);
  });

  it('should start out with data from constructor', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});
    assert.equal(t.tableId, 'Foo');
    assert.isTrue(t.isLoaded);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'Boston', 'MA', 4, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);
  });

  it('should support filterRecords and filterRowIds', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});
    assert.deepEqual(t.filterRecords({state: 'MA'}), [
      {id: 4, city: 'Boston', state: 'MA', amount: 4, bool: true},
      {id: 5, city: 'Boston', state: 'MA', amount: 'NA', bool: false}]);
    assert.deepEqual(t.filterRowIds({state: 'MA'}), [4, 5]);

    // After removing and re-adding a record, indices change, but filter behavior should not.
    // Notice sameDeepMembers() below, rather than deepEqual(), since order is not guaranteed.
    t.dispatchAction(["RemoveRecord", "Foo", 4]);
    t.dispatchAction(["AddRecord", "Foo", 4, {city: 'BOSTON', state: 'MA'}]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'BOSTON', 'MA', 0, false],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);
    assert.deepEqual(t.filterRecords({city: 'BOSTON', amount: 0.0}), [
      {id: 4, city: 'BOSTON', state: 'MA', amount: 0, bool: false}]);
    assert.deepEqual(t.filterRowIds({city: 'BOSTON', amount: 0.0}), [4]);
    assert.sameDeepMembers(t.filterRecords({state: 'MA'}), [
      {id: 4, city: 'BOSTON', state: 'MA', amount: 0, bool: false},
      {id: 5, city: 'Boston', state: 'MA', amount: 'NA', bool: false}]);
    assert.sameDeepMembers(t.filterRowIds({state: 'MA'}), [4, 5]);
    assert.deepEqual(t.filterRecords({city: 'BOSTON', state: 'NY'}), []);
    assert.deepEqual(t.filterRowIds({city: 'BOSTON', state: 'NY'}), []);
    assert.sameDeepMembers(t.filterRecords({}), [
      {id: 1, city: 'New York', state: 'NY', amount: 5, bool: true},
      {id: 4, city: 'BOSTON', state: 'MA', amount: 0, bool: false},
      {id: 5, city: 'Boston', state: 'MA', amount: 'NA', bool: false},
      {id: 7, city: 'Seattle', state: 'WA', amount: 2, bool: false},
    ]);
    assert.sameDeepMembers(t.filterRowIds({}), [1, 4, 5, 7]);
  });

  it('should support findMatchingRow', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});
    assert.equal(t.findMatchingRowId({state: 'MA'}), 4);
    assert.equal(t.findMatchingRowId({state: 'MA', bool: false}), 5);
    assert.equal(t.findMatchingRowId({city: 'Boston', state: 'MA', bool: true}), 4);
    assert.equal(t.findMatchingRowId({city: 'BOSTON', state: 'NY'}), 0);
    assert.equal(t.findMatchingRowId({statex: 'MA'}), 0);
    assert.equal(t.findMatchingRowId({id: 7}), 7);
    assert.equal(t.findMatchingRowId({}), 1);
  });

  it('should allow getRowPropFunc to be used before loadData', function() {
    // This tests a potential bug when getRowPropFunc is saved from before loadData() is called.
    const t = new TableData('Foo', null, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], []);
    assert.isFalse(t.isLoaded);

    const getters = ["id", "city", "state", "amount", "bool"].map(c => t.getRowPropFunc(c)!);
    t.loadData(sampleData);
    assert.isTrue(t.isLoaded);
    assert.deepEqual(t.getSortedRowIds().map(r => getters.map(getter => getter(r))), [
      [1, 'New York', 'NY', 5, true],
      [4, 'Boston', 'MA', 4, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);
  });

  it('should handle Add/RemoveRecord', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});

    t.dispatchAction(["RemoveRecord", "Foo", 4]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);

    t.dispatchAction(["RemoveRecord", "Foo", 7]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [5, 'Boston', 'MA', "NA", false],
    ]);

    t.dispatchAction(["AddRecord", "Foo", 4, {city: 'BOSTON', state: 'MA', amount: 4, bool: true}]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'BOSTON', 'MA', 4, true],
      [5, 'Boston', 'MA', "NA", false],
    ]);

    t.dispatchAction(["BulkAddRecord", "Foo", [8, 9], {
      city: ['X', 'Y'], state: ['XX', 'YY'], amount: [0.1, 0.2], bool: [null, true]
    }]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'BOSTON', 'MA', 4, true],
      [5, 'Boston', 'MA', "NA", false],
      [8, 'X',      'XX', 0.1, null],
      [9, 'Y',      'YY', 0.2, true],
    ]);

    t.dispatchAction(["BulkRemoveRecord", "Foo", [1, 4, 9]]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [5, 'Boston', 'MA', "NA", false],
      [8, 'X',      'XX', 0.1, null],
    ]);
  });

  it('should handle UpdateRecord', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});

    t.dispatchAction(["UpdateRecord", "Foo", 4, {city: 'BOSTON', amount: 0.1}]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true],
      [4, 'BOSTON', 'MA', 0.1, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Seattle', 'WA', 2, false],
    ]);

    t.dispatchAction(["BulkUpdateRecord", "Foo", [1, 7], {
      city: ['X', 'Y'], state: ['XX', 'YY'], amount: [0.1, 0.2], bool: [null, true]
    }]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool"], [
      [1, 'X',      'XX', 0.1, null],
      [4, 'BOSTON', 'MA', 0.1, true],
      [5, 'Boston', 'MA', "NA", false],
      [7, 'Y',      'YY', 0.2, true],
    ]);
  });

  it('should work correctly after AddColumn', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});

    t.dispatchAction(["AddColumn", "Foo", "foo", {type: "Text", isFormula: false, formula: ""}]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool", "foo"], [
      [1, 'New York', 'NY', 5, true,   ""],
      [4, 'Boston', 'MA', 4, true,     ""],
      [5, 'Boston', 'MA', "NA", false, ""],
      [7, 'Seattle', 'WA', 2, false,   ""],
    ]);

    t.dispatchAction(["UpdateRecord", "Foo", 4, {city: 'BOSTON', foo: "hello"}]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool", "foo"], [
      [1, 'New York', 'NY', 5, true,   ""],
      [4, 'BOSTON', 'MA', 4, true,     "hello"],
      [5, 'Boston', 'MA', "NA", false, ""],
      [7, 'Seattle', 'WA', 2, false,   ""],
    ]);
    t.dispatchAction(["AddRecord", "Foo", 8, { city: 'X', state: 'XX' }]);
    verifyTableData(t, ["id", "city", "state", "amount", "bool", "foo"], [
      [1, 'New York', 'NY', 5, true,   ""],
      [4, 'BOSTON', 'MA', 4, true,     "hello"],
      [5, 'Boston', 'MA', "NA", false, ""],
      [7, 'Seattle', 'WA', 2, false,   ""],
      [8, 'X',       'XX', 0, false,   ""],
    ]);
  });

  it('should work correctly after RenameColumn', function() {
    const t = new TableData('Foo', sampleData, {city: 'Text', state: 'Text', amount: 'Numeric', bool: 'Bool'});

    t.dispatchAction(["RenameColumn", "Foo", "city", "ciudad"]);
    verifyTableData(t, ["id", "ciudad", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true   ],
      [4, 'Boston', 'MA', 4, true     ],
      [5, 'Boston', 'MA', "NA", false ],
      [7, 'Seattle', 'WA', 2, false   ],
    ]);

    t.dispatchAction(["UpdateRecord", "Foo", 4, {ciudad: 'BOSTON', state: "XX"}]);
    verifyTableData(t, ["id", "ciudad", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true   ],
      [4, 'BOSTON', 'XX', 4, true     ],
      [5, 'Boston', 'MA', "NA", false ],
      [7, 'Seattle', 'WA', 2, false   ],
    ]);
    t.dispatchAction(["AddRecord", "Foo", 8, { ciudad: 'X', state: 'XX' }]);
    verifyTableData(t, ["id", "ciudad", "state", "amount", "bool"], [
      [1, 'New York', 'NY', 5, true   ],
      [4, 'BOSTON', 'XX', 4, true     ],
      [5, 'Boston', 'MA', "NA", false ],
      [7, 'Seattle', 'WA', 2, false   ],
      [8, 'X',       'XX', 0, false   ],
    ]);
  });
});
