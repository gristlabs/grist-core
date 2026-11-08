import { ReferenceRetryState } from "app/server/lib/ReferenceRetryState";

import { assert } from "chai";

describe("ReferenceRetryState", () => {
  it("backs off failures, caps the delay, and allows independent recovery", () => {
    let now = 1_000;
    const state = new ReferenceRetryState(() => now);
    for (const delay of [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      state.failed("broken");
      assert.isFalse(state.ready("broken"));
      assert.isTrue(state.ready("healthy"));
      now += delay - 1;
      assert.isFalse(state.ready("broken"));
      now++;
      assert.isTrue(state.ready("broken"));
    }
    state.failed("broken");
    state.reset("broken");
    assert.isTrue(state.ready("broken"));
    state.failed("broken");
    now += 15_000;
    assert.isTrue(state.ready("broken"));
  });
});
