const assert = require('chai').assert;
const {shortDesc} = require('app/server/lib/shortDesc');
const _ = require('underscore');

describe("shortDesc", function() {
  it("should produce human-friendly output", function() {
    assert.equal(shortDesc(new Array(101).join("abcd ")),
      "'" + new Array(17).join("abcd ") + "... (500 length)'");
    assert.equal(shortDesc(_.range(1000)),
      "[0, 1, 2, 3, 4, ... (1000 items)]");
    assert.equal(shortDesc({a: 123, b: { c: ["d"] }}),
      "{a: 123, b: {c: ['d']}}");
    assert.equal(shortDesc(Uint8Array.from([84, 101, 120, 116])),
      "b'Text'");
    assert.equal(shortDesc(Uint8Array.from([0, 101, 189, 116])),
      "b'?e?t'");
  });

  it("should respect passed-in limits", function() {
    assert.equal(shortDesc([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "abcdefghij",
      {1:1, 2:2, 3:3, 4:4, 5:5, 6:6},
      Uint8Array.from(_.range(30, 35).concat(_.range(125, 135)))
    ], {
      maxArrayLength: 7,
      maxStringLength: 7,
      maxObjectKeys: 3,
      maxBufferLength: 12
    }), "[[1, 2, 3, 4, 5, 6, 7, ... (10 items)], " +
        "'abcdefg... (10 length)', " +
        "{1: 1, 2: 2, 3: 3, ... (6 keys)}, " +
        "b'?? !\"}~?????... (15 length)']"
    );
  });
});
