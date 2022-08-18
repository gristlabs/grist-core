import {getTableTitle} from 'app/common/ActiveDocAPI';
import {assert} from 'chai';

describe('getTableTitle', function() {
  it('should construct correct table titles', async function() {
    function check(groupByColLabels: string[] | null, expected: string) {
      assert.equal(getTableTitle({title: "My Table", groupByColLabels, colIds: []}), expected);
    }

    check(null, "My Table");
    check([], "My Table [Totals]");
    check(["A"], "My Table [by A]");
    check(["A", "B"], "My Table [by A, B]");
  });
});
