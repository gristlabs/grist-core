import {
  alignmentSide, alignmentToJustify, alignmentToTextAlign, toInlineSide, toPhysicalSide,
} from "app/client/lib/direction";

import { assert } from "chai";

describe("direction", function() {
  it("translates between the sides of reading and the sides of the screen", function() {
    assert.equal(toPhysicalSide("start", false), "left");
    assert.equal(toPhysicalSide("end", false), "right");
    assert.equal(toPhysicalSide("start", true), "right");
    assert.equal(toPhysicalSide("end", true), "left");
    for (const rtl of [false, true]) {
      for (const side of ["start", "end"] as const) {
        assert.equal(toInlineSide(toPhysicalSide(side, rtl), rtl), side);
      }
    }
  });

  it("reads a column's alignment as a side of reading", function() {
    assert.equal(alignmentSide("left"), "start");
    assert.equal(alignmentSide("right"), "end");
    assert.equal(alignmentSide("center"), "center");
    // A column without an alignment is at the start, as "left" always was.
    assert.equal(alignmentSide(undefined), "start");
  });

  it("gives styles that follow the direction of their surroundings", function() {
    assert.equal(alignmentToTextAlign("left"), "var(--inline-start-side)");
    assert.equal(alignmentToTextAlign("right"), "var(--inline-end-side)");
    assert.equal(alignmentToTextAlign("center"), "center");
    assert.equal(alignmentToJustify("left"), "flex-start");
    assert.equal(alignmentToJustify("right"), "flex-end");
    assert.equal(alignmentToJustify("center"), "center");
  });
});
