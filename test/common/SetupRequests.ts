/**
 * Unit tests for the pure setup-requests helpers. The endpoints and concurrency are covered
 * by the server-side tests.
 */
import { SetupRequests } from "app/common/Config";
import {
  addSetupRequest,
  clearSetupRequestsStep,
  summarizeSetupRequests,
} from "app/common/SetupRequests";

import { assert } from "chai";

const at = "2026-06-10T00:00:00.000Z";

describe("SetupRequests", function() {
  describe("addSetupRequest", function() {
    it("adds requesters without mutating the previous value", function() {
      const prev: SetupRequests = { steps: {} };
      const next = addSetupRequest(prev, 7,
        { step: "email", features: ["invites"] },
        { email: "a@example.com", at });
      assert.deepEqual(prev, { steps: {} });
      assert.deepEqual(next, {
        steps: { email: { requesters: { 7: { email: "a@example.com", at, features: ["invites"] } } } },
      });
    });

    it("upserts a repeat request: unions features, keeps or replaces the reason", function() {
      let value = addSetupRequest(null, 7,
        { step: "email", features: ["invites"], reason: "old" },
        { email: "a@example.com", at });
      value = addSetupRequest(value, 7,
        { step: "email", features: ["notifications"] },
        { email: "a@example.com", at: "2026-06-11T00:00:00.000Z" });
      let entry = value.steps.email!.requesters[7]!;
      assert.deepEqual(entry.features, ["invites", "notifications"]);
      assert.equal(entry.reason, "old");
      assert.equal(entry.at, "2026-06-11T00:00:00.000Z");

      value = addSetupRequest(value, 7,
        { step: "email", features: [], reason: "new" },
        { email: "a@example.com", at });
      entry = value.steps.email!.requesters[7]!;
      assert.equal(entry.reason, "new");
    });
  });

  describe("summarizeSetupRequests", function() {
    it("censors down to counts and the user's own participation", function() {
      let value = addSetupRequest(null, 1,
        { step: "full-grist", features: ["automations"], reason: "secret detail" },
        { email: "a@example.com", name: "Anne", at });
      value = addSetupRequest(value, 2,
        { step: "full-grist", features: [] },
        { email: "b@example.com", at });
      assert.deepEqual(summarizeSetupRequests(value, 1),
        { steps: { "full-grist": { count: 2, requestedByMe: true } } });
      assert.deepEqual(summarizeSetupRequests(value, 3),
        { steps: { "full-grist": { count: 2, requestedByMe: false } } });
      assert.deepEqual(summarizeSetupRequests(null, 1), { steps: {} });
    });

    it("skips cleared steps", function() {
      const value = addSetupRequest(null, 1,
        { step: "ai", features: [] }, { email: "a@example.com", at });
      const cleared = clearSetupRequestsStep(value, "ai");
      assert.deepEqual(summarizeSetupRequests(cleared, 1), { steps: {} });
      // Clearing did not touch the original.
      assert.deepEqual(summarizeSetupRequests(value, 1),
        { steps: { ai: { count: 1, requestedByMe: true } } });
    });
  });
});
