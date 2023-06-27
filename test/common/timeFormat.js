var assert = require('assert');
var {timeFormat} = require('app/common/timeFormat');

describe('timeFormat', function() {

  var date = new Date(2014, 3, 4, 22, 28, 16, 123);

  it("should format date", function() {
    assert.equal(timeFormat("Y", date), "20140404");
    assert.equal(timeFormat("D", date), "2014-04-04");
  });

  it("should format time", function() {
    assert.equal(timeFormat("T", date), "22:28:16");
    assert.equal(timeFormat("T + M", date), "22:28:16 + 123");
  });

  it("should format date and time", function() {
    assert.equal(timeFormat("A", date), "2014-04-04 22:28:16.123");
  });
});
