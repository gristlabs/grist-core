var assert = require('chai').assert;
var rowuid = require('app/client/models/rowuid');

describe('rowuid', function() {
  it('should combine and split tableRefs with rowId', function() {
    function verify(tableRef, rowId) {
      var u = rowuid.combine(tableRef, rowId);
      assert.equal(rowuid.tableRef(u), tableRef);
      assert.equal(rowuid.rowId(u), rowId);
      assert.equal(rowuid.toString(u), tableRef + ":" + rowId);
    }

    // Simple case.
    verify(4, 17);

    // With 0 for one or both of the parts.
    verify(0, 17);
    verify(1, 0);
    verify(0, 0);

    // Test with values close to the upper limits
    verify(rowuid.MAX_TABLES - 1, 17);
    verify(1234, rowuid.MAX_ROWS - 1);
    verify(rowuid.MAX_TABLES - 1, rowuid.MAX_ROWS - 1);
  });
});
