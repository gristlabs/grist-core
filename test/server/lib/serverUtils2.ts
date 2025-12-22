import { exitPromise, expectedResetDate } from "app/server/lib/serverUtils";
import { spawn } from "child_process";
import { assert } from "test/server/testUtils";

describe("serverUtils2", function() {
  describe("exitPromise", function() {
    it("should resolve to exit code when child process exits", async function() {
      const child = spawn("echo", ["hello", "world"]);
      assert.strictEqual(await exitPromise(child), 0);

      const child2 = spawn("exit 4", [], { shell: true });
      assert.strictEqual(await exitPromise(child2), 4);
    });

    it("should resolve to signal when child process is killed", async function() {
      const child = spawn("sleep", ["1"]);
      child.kill();
      assert.strictEqual(await exitPromise(child), "SIGTERM");

      const child2 = spawn("sleep", ["1"]);
      child2.kill("SIGINT");
      assert.strictEqual(await exitPromise(child2), "SIGINT");
    });

    it("should be rejected when child process can't start", async function() {
      const child = spawn("non-existent-command-83714", ["hello"]);
      await assert.isRejected(exitPromise(child), /ENOENT/);
    });
  });

  describe("period calculations", function() {
    it("should give up for wrong data", function() {
      // Accepts plausible dates.
      assert.isNotNull(test(day(-40), day(-40 + 365))); // NOW somewhere in the second period.

      // Wrong period dates.
      assert.isNull(test(day(360), day(0))); // start after end
      assert.isNull(test(NOW, NOW)); // start equals end

      // Period outside the ~year range.
      assert.isNull(test(day(-365 - 1), day(-1)));
      assert.isNull(test(day(1), day(365 + 1)));
    });

    it("should not calculate reset dates for first subperiod", function() {
      // If now is in the first month (on yearly period), we should have no reset date.
      assert.isNull(test(NOW, day(365))); // started exactly now.
      assert.isNull(test(day(-1), day(365 - 1))); // started yesterday.
      assert.isNull(test(day(-10), day(365 - 10))); // started 10 days ago.
    });

    it("should calculate properly and the start", function() {
      // If period starts 9 days before, we should have null.
      assert.equal(test2("2025-01-01", "2026-01-01"), null);

      // But if the period started month ago, and we are in the second month, we should have a reset date.
      assert.equal(test2("2024-12-09", "2025-12-09"), str("2025-01-09"));
    });

    it("should calculate properly and the end", function() {
      // If period ends tomorrow, we should have a reset date
      assert.equal(test2("2024-01-11", "2025-01-11"), str("2024-12-11"));
      // Same that if the period ends in next month.
      assert.equal(test2("2024-02-11", "2025-02-11"), str("2024-12-11"));
      // And in 4 months.
      assert.equal(test2("2024-05-11", "2025-05-11"), str("2024-12-11"));
    });
  });
});

const D = 24 * 60 * 60 * 1000;
// const M = 30.5 * D;
const NOW = new Date("2025-01-10T00:00:00Z").getTime();
const day = (d: number) => new Date(Math.floor(NOW + d * D)).getTime();
const test = (start: number, end: number) => expectedResetDate(start, end, NOW);
const str = (s: string) => new Date(s + "T00:00:00Z").getTime();
const test2 = (start: string, end: string) => expectedResetDate(str(start), str(end), NOW);
