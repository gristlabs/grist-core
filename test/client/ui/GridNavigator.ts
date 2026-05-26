import { clamp, isAtBoundary, moveInGrid } from "app/client/ui/GridNavigator";

import { assert } from "chai";

describe("GridNavigator", function() {
  const bounds = { numCols: 5, numRows: 10 };

  describe("moveInGrid", function() {
    it("should move by delta within bounds", function() {
      const result = moveInGrid({ col: 2, row: 3 }, 1, 1, bounds);
      assert.deepEqual(result, { col: 3, row: 4 });
    });

    it("should clamp to right boundary", function() {
      const result = moveInGrid({ col: 4, row: 0 }, 1, 0, bounds);
      assert.deepEqual(result, { col: 4, row: 0 });
    });

    it("should clamp to left boundary", function() {
      const result = moveInGrid({ col: 0, row: 5 }, -1, 0, bounds);
      assert.deepEqual(result, { col: 0, row: 5 });
    });

    it("should clamp to top boundary", function() {
      const result = moveInGrid({ col: 2, row: 0 }, 0, -1, bounds);
      assert.deepEqual(result, { col: 2, row: 0 });
    });

    it("should clamp to bottom boundary", function() {
      const result = moveInGrid({ col: 2, row: 9 }, 0, 1, bounds);
      assert.deepEqual(result, { col: 2, row: 9 });
    });

    it("should handle diagonal movement", function() {
      const result = moveInGrid({ col: 0, row: 0 }, -1, -1, bounds);
      assert.deepEqual(result, { col: 0, row: 0 });
    });

    it("should handle large deltas", function() {
      const result = moveInGrid({ col: 2, row: 5 }, 100, -100, bounds);
      assert.deepEqual(result, { col: 4, row: 0 });
    });
  });

  describe("isAtBoundary", function() {
    it("should detect left boundary", function() {
      assert.isTrue(isAtBoundary({ col: 0, row: 5 }, "left", bounds));
      assert.isFalse(isAtBoundary({ col: 1, row: 5 }, "left", bounds));
    });

    it("should detect right boundary", function() {
      assert.isTrue(isAtBoundary({ col: 4, row: 5 }, "right", bounds));
      assert.isFalse(isAtBoundary({ col: 3, row: 5 }, "right", bounds));
    });

    it("should detect top boundary", function() {
      assert.isTrue(isAtBoundary({ col: 2, row: 0 }, "up", bounds));
      assert.isFalse(isAtBoundary({ col: 2, row: 1 }, "up", bounds));
    });

    it("should detect bottom boundary", function() {
      assert.isTrue(isAtBoundary({ col: 2, row: 9 }, "down", bounds));
      assert.isFalse(isAtBoundary({ col: 2, row: 8 }, "down", bounds));
    });
  });

  describe("clamp", function() {
    it("should return value when within range", function() {
      assert.equal(clamp(5, 0, 10), 5);
    });

    it("should return min when below range", function() {
      assert.equal(clamp(-3, 0, 10), 0);
    });

    it("should return max when above range", function() {
      assert.equal(clamp(15, 0, 10), 10);
    });

    it("should handle min === max", function() {
      assert.equal(clamp(5, 3, 3), 3);
    });
  });
});
