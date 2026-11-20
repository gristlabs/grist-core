import { mirrorPlacement } from "app/client/lib/popupDirection";

import { assert } from "chai";

describe("popupDirection", function() {
  it("leaves every placement as written in a left-to-right interface", function() {
    for (const placement of ["bottom-start", "bottom-end", "right", "left-start", "top", "auto"]) {
      assert.equal(mirrorPlacement(placement, false), placement);
    }
  });

  it("swaps the sides and the alignments in a right-to-left interface", function() {
    assert.equal(mirrorPlacement("bottom-start", true), "bottom-end");
    assert.equal(mirrorPlacement("bottom-end", true), "bottom-start");
    assert.equal(mirrorPlacement("top-start", true), "top-end");
    assert.equal(mirrorPlacement("right", true), "left");
    assert.equal(mirrorPlacement("left", true), "right");
  });

  it("keeps what does not name a side", function() {
    // Beside the reference, start and end are its top and its bottom.
    assert.equal(mirrorPlacement("right-start", true), "left-start");
    assert.equal(mirrorPlacement("left-end", true), "right-end");
    assert.equal(mirrorPlacement("bottom", true), "bottom");
    assert.equal(mirrorPlacement("top", true), "top");
    assert.equal(mirrorPlacement("auto", true), "auto");
  });
});
