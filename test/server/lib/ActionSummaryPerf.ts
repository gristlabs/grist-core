/**
 * Performance guard for summarizing large bundles.
 *
 * The chunk-then-compose design has two places that can go quadratic in the
 * action count, the lattice search and the fold, and the correctness suites use
 * bundles far too small to notice. The shapes here are the ones that hurt: many
 * actions on one table (a formula cascade), many actions across many tables, and
 * a schema-heavy bundle. Each is timed on both paths: with the engine's undo
 * ownership (every bundle written from now on) and without it (all existing
 * history, which the Action Log and the compare endpoint summarize).
 *
 * The bounds are loose, several times a developer machine, so they catch a
 * regression to quadratic behavior rather than measure anything.
 */
import { chunkByLattice, LatticeStats } from "app/common/ActionLayout";
import { summarizeStoredAndUndo } from "app/common/ActionSummarizer";
import { DocAction } from "app/common/DocActions";
import { assert } from "test/server/testUtils";

interface Bundle { stored: DocAction[]; undo: DocAction[]; owners: number[]; }

function rows(n: number) { return Array.from({ length: n }, (_, i) => i + 1); }
function vals(n: number, tag: string) { return Array.from({ length: n }, (_, i) => `${tag}${i}`); }

// A formula cascade: N bulk updates on one table, R rows each, each with its
// own bulk-update inverse.
function recalc(N: number, R: number): Bundle {
  const b: Bundle = { stored: [], undo: [], owners: [] };
  for (let i = 0; i < N; i++) {
    b.stored.push(["BulkUpdateRecord", "T", rows(R), { ["C" + i]: vals(R, "new") }]);
    b.undo.push(["BulkUpdateRecord", "T", rows(R), { ["C" + i]: vals(R, "old") }]);
    b.owners.push(i);
  }
  return b;
}

// A schema-heavy bundle: N column removals on a table of R rows, each restoring
// the column's data and then the column.
function removeCols(N: number, R: number): Bundle {
  const b: Bundle = { stored: [], undo: [], owners: [] };
  for (let i = 0; i < N; i++) {
    b.stored.push(["RemoveColumn", "T", "C" + i]);
    b.undo.push(["BulkUpdateRecord", "T", rows(R), { ["C" + i]: vals(R, "old") }]);
    b.undo.push(["AddColumn", "T", "C" + i, { type: "Text", isFormula: false, formula: "" }]);
    b.owners.push(i, i);
  }
  return b;
}

// Many small updates spread over many tables.
function manyTables(N: number): Bundle {
  const b: Bundle = { stored: [], undo: [], owners: [] };
  for (let i = 0; i < N; i++) {
    const t = "T" + (i % 50);
    b.stored.push(["UpdateRecord", t, i + 1, { A: "new" + i }]);
    b.undo.push(["UpdateRecord", t, i + 1, { A: "old" + i }]);
    b.owners.push(i);
  }
  return b;
}

function timed(fn: () => void): number {
  const start = Date.now();
  fn();
  return Date.now() - start;
}

describe("ActionSummary performance", function() {
  this.timeout(120000);

  const cases: [string, Bundle, number][] = [
    // name, bundle, bound (ms) for each path
    ["500 recalcs of 100 rows on one table", recalc(500, 100), 1500],
    ["200 recalcs of 5000 rows on one table", recalc(200, 5000), 5000],
    ["200 column removals on a 100-row table", removeCols(200, 100), 1500],
    ["2000 updates across 50 tables", manyTables(2000), 1500],
  ];

  for (const [name, bundle, bound] of cases) {
    it(`summarizes ${name} in bounded time`, function() {
      const withOwners = timed(() => summarizeStoredAndUndo(bundle.stored, bundle.undo, undefined, bundle.owners));
      const withoutOwners = timed(() => summarizeStoredAndUndo(bundle.stored, bundle.undo));
      assert.isBelow(withOwners, bound, `with ownership took ${withOwners}ms`);
      assert.isBelow(withoutOwners, bound, `without ownership (lattice) took ${withoutOwners}ms`);
      // The search must stay close to linear on these shapes too (see the fuzz
      // harness for the same bound over the random corpus).
      const stats: LatticeStats = { settled: 0 };
      chunkByLattice(bundle.stored, bundle.undo, stats);
      assert.isAtMost(stats.settled, 4 * (bundle.stored.length + bundle.undo.length + 1),
        `lattice settled ${stats.settled} points`);
    });
  }
});
