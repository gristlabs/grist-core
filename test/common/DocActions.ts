import {fromTableDataAction, TableDataAction, toTableDataAction} from 'app/common/DocActions';
import {assert} from 'chai';

describe('DocActions', function() {

  it('should convert correctly with toTableDataAction', () => {
    const colValues = {id: [2, 4, 6], foo: ["a", "b", "c"], bar: [false, "y", null]};

    assert.deepEqual(toTableDataAction("Hello", colValues),
      ['TableData', "Hello", [2, 4, 6],
        { foo: ["a", "b", "c"], bar: [false, "y", null] }]);

    // Make sure colValues that was passed-in didn't get changed.
    assert.deepEqual(colValues,
      {id: [2, 4, 6], foo: ["a", "b", "c"], bar: [false, "y", null]});

    assert.deepEqual(toTableDataAction("Foo", {id: []}), ['TableData', "Foo", [], {}]);
  });

  it('should convert correctly with fromTableDataAction', () => {
    const tableData: TableDataAction = ['TableData', "Hello", [2, 4, 6],
      { foo: ["a", "b", "c"], bar: [false, "y", null] }];

    assert.deepEqual(fromTableDataAction(tableData),
      {id: [2, 4, 6], foo: ["a", "b", "c"], bar: [false, "y", null]});

    // Make sure tableData itself is unchanged.
    assert.deepEqual(tableData, ['TableData', "Hello", [2, 4, 6],
      { foo: ["a", "b", "c"], bar: [false, "y", null] }]);

    assert.deepEqual(fromTableDataAction(['TableData', "Foo", [], {}]), {id: []});
  });
});
