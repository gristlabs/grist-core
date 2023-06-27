var assert = require('assert');
var CircularArray = require('app/common/CircularArray');

describe("CircularArray", function() {
  it("should lose old items", function() {
    var c = new CircularArray(5);
    assert.equal(c.maxLength, 5);
    assert.equal(c.length, 0);
    c.push("a");
    assert.equal(c.get(0), "a");
    c.push("b");
    c.push("c");
    assert.equal(c.length, 3);
    assert.equal(c.get(2), "c");
    assert.deepEqual(c.getArray(), ["a", "b", "c"]);
    c.push("d");
    c.push("e");
    assert.equal(c.length, 5);
    assert.equal(c.get(4), "e");
    assert.deepEqual(c.getArray(), ["a", "b", "c", "d", "e"]);
    c.push("f");
    assert.equal(c.length, 5);
    assert.equal(c.get(0), "b");
    assert.equal(c.get(4), "f");
    assert.deepEqual(c.getArray(), ["b", "c", "d", "e", "f"]);
    c.push("g");
    c.push("h");
    c.push("i");
    c.push("j");
    assert.equal(c.length, 5);
    assert.equal(c.get(0), "f");
    assert.equal(c.get(4), "j");
    assert.deepEqual(c.getArray(), ["f", "g", "h", "i", "j"]);
    assert.equal(c.maxLength, 5);
  });
});
