/**
 * Tests for query parameter handling (sort, limit, filter).
 * These tests verify the applyQueryParameters function.
 *
 * These are unit tests that don't require server setup.
 */

import { applyQueryParameters } from "app/server/lib/DocApi";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("DocApiQueryParameters", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  function makeExample() {
    return {
      id: [1, 2, 3, 7, 8, 9],
      color: ["red", "yellow", "white", "blue", "black", "purple"],
      spin: ["up", "up", "down", "down", "up", "up"],
    };
  }

  it("supports ascending sort", async function() {
    assert.deepEqual(applyQueryParameters(makeExample(), { sort: ["color"] }, null), {
      id: [8, 7, 9, 1, 3, 2],
      color: ["black", "blue", "purple", "red", "white", "yellow"],
      spin: ["up", "down", "up", "up", "down", "up"],
    });
  });

  it("supports descending sort", async function() {
    assert.deepEqual(applyQueryParameters(makeExample(), { sort: ["-id"] }, null), {
      id: [9, 8, 7, 3, 2, 1],
      color: ["purple", "black", "blue", "white", "yellow", "red"],
      spin: ["up", "up", "down", "down", "up", "up"],
    });
  });

  it("supports multi-key sort", async function() {
    assert.deepEqual(applyQueryParameters(makeExample(), { sort: ["-spin", "color"] }, null), {
      id: [8, 9, 1, 2, 7, 3],
      color: ["black", "purple", "red", "yellow", "blue", "white"],
      spin: ["up", "up", "up", "up", "down", "down"],
    });
  });

  it("does not freak out sorting mixed data", async function() {
    const example = {
      id: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      mixed: ["red", "green", "white", 2.5, 1, null, ["zing", 3] as any, 5, "blue"],
    };
    assert.deepEqual(applyQueryParameters(example, { sort: ["mixed"] }, null), {
      mixed: [1, 2.5, 5, null, ["zing", 3] as any, "blue", "green", "red", "white"],
      id: [5, 4, 8, 6, 7, 9, 2, 1, 3],
    });
  });

  it("supports limit", async function() {
    assert.deepEqual(applyQueryParameters(makeExample(), { limit: 1 }),
      { id: [1], color: ["red"], spin: ["up"] });
  });

  it("supports sort and limit", async function() {
    assert.deepEqual(applyQueryParameters(makeExample(), { sort: ["-color"], limit: 2 }, null),
      { id: [2, 3], color: ["yellow", "white"], spin: ["up", "down"] });
  });
});
