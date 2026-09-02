import { concatenateSummaries, summarizeStoredAndUndo } from "app/common/ActionSummarizer";
import { BulkAddRecord } from "app/common/DocActions";

import { assert } from "chai";

describe("ActionSummarizer", function() {
  // Summaries are keyed by table, column, and row ids taken from untrusted actions. Those
  // ids are arbitrary strings (row ids are typed number[] but can be strings at runtime),
  // so ids that also name properties on Object.prototype (e.g. __proto__, constructor)
  // must be handled as plain data. Object.fromEntries keeps column ids as own keys (a
  // "__proto__" literal key would set the prototype instead).
  const proto = () => Object.getOwnPropertyNames(Object.prototype);

  function summarize(action: BulkAddRecord) {
    return summarizeStoredAndUndo([action], []);
  }

  it("handles column ids that match built-in property names", function() {
    const before = proto();
    const summary = summarize(["BulkAddRecord", "T", [1, 2], Object.fromEntries([
      ["Name", ["a", "b"]],
      ["__proto__", ["c", "d"]],
      ["constructor", ["e", "f"]],
    ])]);
    assert.includeMembers(Object.keys(summary.tableDeltas.T.columnDeltas),
      ["Name", "__proto__", "constructor"]);
    assert.deepEqual(proto(), before);  // nothing written onto Object.prototype
  });

  it("handles row ids that match built-in property names", function() {
    const before = proto();
    // Row ids are typed number[] but untrusted input can make them arbitrary strings.
    const rowIds = ["__proto__", "constructor"] as unknown as number[];
    const summary = summarize(["BulkAddRecord", "T", rowIds, { Name: ["a", "b"] }]);
    assert.includeMembers(Object.keys(summary.tableDeltas.T.columnDeltas.Name),
      ["__proto__", "constructor"]);
    assert.deepEqual(proto(), before);
  });

  it("handles table ids that match built-in property names", function() {
    const before = proto();
    const summary = summarize(["BulkAddRecord", "__proto__", [1, 2], { Name: ["a", "b"] }]);
    assert.include(Object.keys(summary.tableDeltas), "__proto__");
    assert.deepEqual(proto(), before);
  });

  it("merges summaries with such ids", function() {
    const mk = () => summarize(["BulkAddRecord", "T", [1], Object.fromEntries([
      ["Name", ["a"]],
      ["__proto__", ["b"]],
    ])]);
    const before = proto();
    const merged = concatenateSummaries([mk(), mk()]);
    assert.includeMembers(Object.keys(merged.tableDeltas.T.columnDeltas), ["Name", "__proto__"]);
    assert.deepEqual(proto(), before);
  });
});
