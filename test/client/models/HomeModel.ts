import {getTimeFromNow} from 'app/client/models/HomeModel';
import {assert} from 'chai';
import moment from 'moment';

describe("HomeModel", function() {
  describe("getTimeFromNow", function() {
    it("should give good summary of time that just passed", function() {
      const t = moment().subtract(10, 's');
      assert.equal(getTimeFromNow(t.toISOString()), 'a few seconds ago');
    });

    it("should gloss over times slightly in future", function() {
      const t = moment().add(2, 's');
      assert.equal(getTimeFromNow(t.toISOString()), 'a few seconds ago');
    });

    it("should not gloss over times further in future", function() {
      const t = moment().add(2, 'minutes');
      assert.equal(getTimeFromNow(t.toISOString()), 'in 2 minutes');
    });
});
});
