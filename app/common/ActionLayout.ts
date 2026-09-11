/**
 * Chunkers for action bundles.
 *
 * Splits a (stored, undo) bundle into sub-bundles ("chunks"), each a complete
 * (stored, undo) slice that can be summarized on its own and then composed back
 * together (see ActionSummarizer).
 *
 * There are two entry points. `chunkByOwners` is used when the bundle still
 * carries the engine's own record of which undo each stored action produced: it
 * just groups by that, one chunk per stored action, which is the finest split.
 * `chunkByLattice` is the fallback that reconstructs the grouping when the bundle
 * lacks that record: all history from before ownership was added (immutable, not
 * backfillable), plus bundles assembled without the data engine. The two share
 * `analyzeStored`, so a front calc-flush restore is attributed to its removal the
 * same way regardless of path.
 *
 * Either way, `coalesceRecordChunks` then merges adjacent chunks made only of
 * record actions: splitting exists to separate schema changes, and a run of
 * plain adds, removes and updates is what a single walk always handled.
 *
 * One rule both chunkers follow: placement decides how a name is read. Later
 * chunks' renames rekey earlier chunks during composition, so an undo entry's
 * names mean whatever they meant at its chunk's position. A front calc-flush
 * restore carries PRE-bundle names (it runs last during undo, after every
 * rename is rolled back -- see LabelRenames.original_name in the sandbox), so
 * when it cannot be attributed to its removal it must go in a LEADING chunk,
 * the only position where pre-bundle names read correctly.
 *
 * The rest of this header describes the lattice.
 *
 * Why split at all? A single bundle can carry several schema changes at once:
 * two renames, say, or a column removed and another added under the same name. A
 * single forward/reverse walk over the whole bundle can't tell a name that
 * appeared and vanished mid-bundle from the one that really sits at the boundary,
 * so it picks the wrong answer. Splitting into pieces that each summarize
 * cleanly, then composing, sidesteps that.
 *
 * How it splits: chunking is a least-cost path over a (stored x undo) grid. Each
 * step is one chunk, a rectangle of consecutive stored and undo entries. A chunk
 * is priced by whether its undo entries are the inverses we expect from its
 * forward actions. Every forward action has a known inverse shape, read from the
 * engine's own action handlers (docactions.py), so this is a contract, not a
 * guess (see `expectedInverses`). The price treats the undo as an unordered bag,
 * so a reverse-ordered emission (a formula/data conversion, the one case the
 * engine emits its two undo steps out of order) still costs zero once both steps
 * land in one chunk. Coarsening is therefore not a separate pass: it is just the
 * chunk the search settles on when no finer split works.
 *
 * The step shapes are not a 2 x 2 box but a short fixed list of the spans the
 * engine actually emits (see `EDGE_SHAPES`): a one-to-one action and inverse, a
 * remove that restores both data and schema, an action with no undo, a front
 * restore, and the one two-by-two case, the formula/data conversion. That
 * conversion is the only reordering the engine ever forces, so it is the only
 * wide shape. A fuzz sweep selects exactly these shapes and never a wider one.
 *
 * Cost: the least-cost path is found by best-first search (Dijkstra) over the
 * grid. Edge costs are non-negative, so the search settles points in score order
 * and stops at the far corner having visited only points scoring no worse than
 * the answer. A well-formed bundle pairs up at zero cost along a thin band, so
 * the work is close to linear in the action count; a bundle needing penalties
 * explores only as far as its penalties reach. Edge pricing tests kind, table and
 * columns before rows, on sets computed once per action.
 */

import { DocAction, getColIdsFromDocAction, getRowIdsFromDocAction, isDataAction } from "app/common/DocActions";
import { getSetMapValue } from "app/common/gutil";

export interface LayoutChunk {
  stored: DocAction[];
  undo: DocAction[];
}

/**
 * What chunkByLattice reports about its search, for tests. Only an undo shape
 * the inverse catalogue does not recognize can make the search wander, so the
 * tests hold `settled` to a small multiple of N + M as a check that the
 * catalogue matches what the engine emits.
 */
export interface LatticeStats {
  settled: number;   // grid points settled; about N + M for a well-formed bundle
}

function actKey(t: string, c: string): string { return `${t}/${c}`; }

/** Per-action facts the chunkers need, computed once so pricing an edge never rebuilds a set. */
interface ActionInfo {
  kind: string;
  table: string;
  rows: number[];        // rows a record action touches; empty for a schema action
  rowSet: Set<number>;
  cols: string[];        // columns a record action carries values for; empty otherwise
  colSet: Set<string>;
  name?: string;         // a schema action's target: the column id, or RenameTable's new name
  name2?: string;        // RenameColumn's new column id
}

function infoOf(a: DocAction): ActionInfo {
  // The `isDataAction` guard is essential: without it a schema action's payload
  // (a colInfo object, or a name string) would be misread as columns, and its
  // non-row positions as rows.
  const data = isDataAction(a);
  const rows = data ? getRowIdsFromDocAction(a) : [];
  const cols = data ? (getColIdsFromDocAction(a) ?? []) : [];
  const name = !data && typeof a[2] === "string" ? a[2] : undefined;
  const name2 = !data && typeof a[3] === "string" ? a[3] : undefined;
  return { kind: a[0], table: a[1], rows, rowSet: new Set(rows), cols, colSet: new Set(cols), name, name2 };
}

// Is every row of `sub` among the rows of `sup`? An update's undo restores a
// subset of the rows the forward touched -- exactly the rows that had a prior
// value. So a recompute over all rows pairs with a restore over only the
// pre-existing rows, and a partial no-op bulk pairs with a restore over only the
// rows that actually changed. Equality is the common special case.
function rowsSubset(sub: ActionInfo, sup: ActionInfo): boolean {
  if (sub.rowSet.size > sup.rowSet.size) { return false; }
  for (const r of sub.rows) { if (!sup.rowSet.has(r)) { return false; } }
  return true;
}
// Order-blind set equality of rows (for matching an inverse against its forward).
function rowsSame(a: ActionInfo, b: ActionInfo): boolean {
  return a.rowSet.size === b.rowSet.size && rowsSubset(a, b);
}
// Order-blind set equality of columns.
function colsSame(a: ActionInfo, b: ActionInfo): boolean {
  if (a.colSet.size !== b.colSet.size) { return false; }
  for (const c of a.cols) { if (!b.colSet.has(c)) { return false; } }
  return true;
}
// True if `a` is a record action with the given verb, single or bulk
// (`recordKind(a, "Remove")` matches RemoveRecord and BulkRemoveRecord).
function recordKind(a: ActionInfo, verb: "Add" | "Remove" | "Update"): boolean {
  return a.kind === `${verb}Record` || a.kind === `Bulk${verb}Record`;
}

// Lattice chunker (the model is in the file header above). The objective is a
// lexicographic score (see `compareScore` below). Every edge cost is local: it
// reads only its own two slices plus a precomputed defunct index.

/**
 * A path's score, smallest wins, compared as a lexicographic tuple. Tiers, most
 * significant first:
 *   1. shape:   stranded live-slot undos. Discarding one loses information, so
 *               this is minimized first.
 *   2. missing: required inverses with no matching undo.
 *   3. orphan:  earlier-bundle orphans (a restore no forward here touches).
 *   4. zeros:   optional steps left unpaired. A coarsening that pairs an
 *               otherwise-stranded undo across a crossing reduces this, while a
 *               genuine no-op step cannot be paired, so minimizing it below the
 *               validity tiers coarsens exactly the crossings.
 *   5. merged:  stored actions merged into a wider chunk (one per action beyond
 *               the first in each chunk), where fewer is better: the finest
 *               valid split. Every path covers the same N stored actions, so
 *               minimizing this is the same as maximizing the chunk count.
 * Explicit tiers, not weighted sums, so no number of lower-tier penalties can
 * ever outweigh one penalty of a more significant tier. Every tier is a
 * non-negative sum over edges, which is what lets the search be best-first.
 */
interface Score { shape: number; missing: number; orphan: number; zeros: number; merged: number; }
const ZERO_SCORE: Score = { shape: 0, missing: 0, orphan: 0, zeros: 0, merged: 0 };
function compareScore(a: Score, b: Score): number {
  return (a.shape - b.shape) || (a.missing - b.missing) || (a.orphan - b.orphan) ||
    (a.zeros - b.zeros) || (a.merged - b.merged);
}

/**
 * An expected inverse slot contributed by one forward action. `test` is the
 * shape predicate (kind, table, target; rows subset for updates); `tier`
 * says how to price the slot when no undo entry matches it: a `required`
 * inverse is always emitted (missing one is suspicious), a `zero` inverse
 * may legitimately be empty (no-op update, absent-row remove), and a
 * `routed` inverse is emitted but may land in the front pre-segment rather
 * than this chunk (a formula column's data restore).
 */
type SlotTier = "required" | "zero" | "routed";
interface Slot { tier: SlotTier; test: (g: ActionInfo) => boolean; }
const req = (test: Slot["test"]): Slot => ({ tier: "required", test });
const zero = (test: Slot["test"]): Slot => ({ tier: "zero", test });
const routed = (test: Slot["test"]): Slot => ({ tier: "routed", test });

/**
 * The inverse(s) we expect from a single forward action (the catalogue read
 * from the engine, per the file header). Predicates ignore cell values, so they
 * are local, and test the cheap parts (kind, table, columns) before rows.
 * ModifyColumn deliberately tests only kind+table+col (not which property
 * changed): the conversion's two ModifyColumns on one column are interchangeable
 * for closure, which is exactly why their reversed undo costs nothing inside one
 * chunk.
 */
function expectedInverses(s: DocAction, si: ActionInfo): Slot[] {
  const k = s[0];
  const t = s[1];
  switch (k) {
    case "AddRecord": case "BulkAddRecord":
      return [req(g => recordKind(g, "Remove") && g.table === t && rowsSame(g, si))];
    case "RemoveRecord": case "BulkRemoveRecord":
      return [zero(g => recordKind(g, "Add") && g.table === t && rowsSubset(g, si))];
    case "UpdateRecord": case "BulkUpdateRecord":
      return [zero(g => recordKind(g, "Update") && g.table === t && colsSame(g, si) && rowsSubset(g, si))];
    case "AddColumn":
      return [req(g => g.kind === "RemoveColumn" && g.table === t && g.name === s[2])];
    case "RemoveColumn":
      return [
        req(g => g.kind === "AddColumn" && g.table === t && g.name === s[2]),
        routed(g => recordKind(g, "Update") && g.table === t && g.colSet.has(s[2])),
      ];
    case "RenameColumn":
      return [req(g => g.kind === "RenameColumn" && g.table === t && g.name === s[3] && g.name2 === s[2])];
    case "ModifyColumn":
      return [zero(g => g.kind === "ModifyColumn" && g.table === t && g.name === s[2])];
    case "AddTable":
      return [req(g => g.kind === "RemoveTable" && g.table === t)];
    case "RemoveTable":
      return [
        req(g => g.kind === "AddTable" && g.table === t),
        routed(g => recordKind(g, "Add") && g.table === t),
      ];
    case "RenameTable":
      return [req(g => g.kind === "RenameTable" && g.table === s[2] && g.name === s[1])];
    case "ReplaceTableData":
      // Always emitted, even when the table was empty (docactions.ReplaceTableData
      // appends the old data unconditionally).
      return [req(g => g.kind === "ReplaceTableData" && g.table === t)];
  }
  // Any other kind (including action kinds outside the DocAction union, such as
  // the engine's internal calc/empty actions, which do flow through here at
  // runtime) has no expected inverse. This open fallthrough is deliberate: an
  // exhaustiveness guard over DocAction would mis-handle those runtime kinds.
  return [];
}

/**
 * What the stored side of a bundle tells us about its undo entries: who owns a
 * front calc-flush restore, and whether an undo is an earlier-bundle orphan.
 * Shared by both chunkers so the owner-driven path attributes front restores
 * exactly as the lattice does.
 */
interface StoredAnalysis {
  // The defunct-remove stored that owns a front restore entry, or undefined.
  restoreOwner: (g: ActionInfo) => number | undefined;
  // A genuine earlier-bundle orphan: a restore whose slot no forward here touches.
  isGhost: (g: ActionInfo) => boolean;
}

function analyzeStored(stored: DocAction[], infos: ActionInfo[]): StoredAnalysis {
  const N = stored.length;
  // Defunct-slot index plus the set of slots any forward action touches.
  const removeColIdx = new Map<string, number>();
  const addColIdx = new Map<string, number>();
  const removeTblIdx = new Map<string, number>();
  const addTblIdx = new Map<string, number>();
  const removeRowIdx = new Map<string, Map<number, number>>();   // table -> rowId -> removal stored idx
  const addRowIdx = new Map<string, Map<number, number>>();      // table -> rowId -> add stored idx
  const liveCols = new Set<string>();
  const touchedTables = new Set<string>();
  // Names touched by any in-bundle rename. The indexes below use stored-action
  // names, a front restore uses pre-bundle names, so a lookup on a renamed name
  // can miss or, worse, match the removal of a different entity that took over
  // the name; such restores go unattributed, to a leading chunk. Column names
  // taint globally: over-vetoing is safe, leading is sound for any restore.
  const renamedTables = new Set<string>();
  const renamedCols = new Set<string>();
  // Name-keyed removal indexes keep the FIRST removal: a front restore names
  // the pre-bundle entity, which only the first removal can have removed. A
  // later removal of the same name (a remove/re-add recycle) removes a
  // different, in-bundle entity; matching the restore to it would file the
  // original's values under an entity whose add+remove annihilate in
  // composition. (Row removals stay last-write: rowIds are stable identifiers,
  // and recycled rows keep per-entity cells, so either write order composes
  // the same.)
  const setFirst = (m: Map<string, number>, k: string, v: number) => { if (!m.has(k)) { m.set(k, v); } };
  for (let i = 0; i < N; i++) {
    const s = stored[i];
    const t = s[1];
    touchedTables.add(t);
    // A column kind names its slot key once, for both its index and liveCols.
    switch (s[0]) {
      case "RemoveColumn": setFirst(removeColIdx, actKey(t, s[2]), i); liveCols.add(actKey(t, s[2])); break;
      case "AddColumn": addColIdx.set(actKey(t, s[2]), i); liveCols.add(actKey(t, s[2])); break;
      case "ModifyColumn": liveCols.add(actKey(t, s[2])); break;
      case "RenameColumn":
        liveCols.add(actKey(t, s[2]));
        renamedCols.add(s[2]); renamedCols.add(s[3]);
        break;
      case "RemoveTable": setFirst(removeTblIdx, t, i); break;
      case "AddTable": addTblIdx.set(t, i); break;
      case "RenameTable": renamedTables.add(t); renamedTables.add(s[2]); break;
      case "RemoveRecord": case "BulkRemoveRecord":
        for (const r of infos[i].rows) { getSetMapValue(removeRowIdx, t, () => new Map()).set(r, i); } break;
      case "AddRecord": case "BulkAddRecord":
        for (const r of infos[i].rows) { getSetMapValue(addRowIdx, t, () => new Map()).set(r, i); } break;
    }
    for (const c of infos[i].cols) { liveCols.add(actKey(t, c)); }
  }
  // Defunct = removed in this bundle, with any add coming before the removal
  // (a name re-added after it belongs to a new entity). One rule, three lookups.
  const isDefunct = (remove?: number, add?: number): boolean =>
    remove !== undefined && (add === undefined || add < remove);
  const isColDefunct = (t: string, c: string): boolean =>
    isDefunct(removeColIdx.get(actKey(t, c)), addColIdx.get(actKey(t, c)));
  const isTblDefunct = (t: string): boolean =>
    isDefunct(removeTblIdx.get(t), addTblIdx.get(t));
  // A defunct row's formula columns recompute to nothing on removal, and the
  // engine restores their prior values through calc-flush front entries, just
  // like a defunct column's data.
  const isRowDefunct = (t: string, r: number): boolean =>
    isDefunct(removeRowIdx.get(t)?.get(r), addRowIdx.get(t)?.get(r));

  // The defunct-remove stored that owns a front restore entry, or undefined.
  // A front restore can belong to a removed column, a removed table, or a
  // removed row whose formula columns were flushed (the row case keeps a
  // removed summary row's aggregates from being stranded after its removal in a
  // later chunk, where composition could no longer fold them in).
  const restoreOwner = (g: ActionInfo): number | undefined => {
    if (renamedTables.has(g.table) || g.cols.some(c => renamedCols.has(c))) { return undefined; }
    if (recordKind(g, "Update")) {
      for (const c of g.cols) {
        if (isColDefunct(g.table, c)) { return removeColIdx.get(actKey(g.table, c)); }
      }
      if (g.rows.length > 0 && g.rows.every(r => isRowDefunct(g.table, r))) {
        // The engine folds the whole bundle's calc-flush into one restore, so
        // this entry's rows can belong to several distinct removals (two separate
        // RemoveRecords on one table merge here). We return the first row's owner.
        // That only chooses which chunk the restore joins, which is safe either
        // way. The restore is prepended ahead of every removal in the bundle, so a
        // row whose removal lands in a later chunk sees the restore there as a
        // retained [v, v] cell, and that removal composes it into the correct
        // [v, null]. See the "two separate removes share one merged front restore"
        // fuzz scenario.
        return removeRowIdx.get(g.table)!.get(g.rows[0]);
      }
    }
    if (isTblDefunct(g.table)) { return removeTblIdx.get(g.table); }
    return undefined;
  };

  // A genuine earlier-bundle orphan: a restore whose slot no forward in
  // this bundle touches.
  const isGhost = (g: ActionInfo): boolean => {
    if (recordKind(g, "Update")) {
      if (g.cols.length > 0 && g.cols.every(c => !liveCols.has(actKey(g.table, c)))) { return true; }
    }
    return !touchedTables.has(g.table);
  };

  return { restoreOwner, isGhost };
}

/**
 * Chunk a bundle using the engine's own per-undo ownership instead of inferring
 * it. `owners[k]` is the index into `stored` of the action that produced
 * `undo[k]`, or null for a front calc-flush restore (which we attribute to its
 * owning removal exactly as the lattice does). Each stored action becomes its
 * own chunk carrying the undo entries it owns -- the finest split, which is what
 * the lattice searches for but here is known outright. Front restores join their
 * removal's chunk; one that cannot be safely matched goes to a leading
 * stored=[] chunk (see the file header). Ownership only comes from the current
 * engine, so an unowned undo here is always a front restore, never a legacy
 * orphan.
 *
 * Preconditions (the caller checks `owners.length === undo.length`): owner
 * indices are in range. Undo order within each chunk is preserved by walking
 * `undo` in order.
 */
export function chunkByOwners(stored: DocAction[], undo: DocAction[],
  owners: readonly (number | null)[]): LayoutChunk[] {
  const { restoreOwner } = analyzeStored(stored, stored.map(infoOf));
  const ownedUndo: number[][] = stored.map(() => []);
  const orphans: number[] = [];
  for (let k = 0; k < undo.length; k++) {
    const declared = owners[k];
    // A declared owner must index a real stored action. Otherwise (a front calc-flush
    // restore, or a defensively-ignored out-of-range owner) attribute it the way the lattice does.
    const owner = (typeof declared === "number" && declared >= 0 && declared < stored.length) ?
      declared :
      restoreOwner(infoOf(undo[k])) ?? null;
    (owner === null ? orphans : ownedUndo[owner]).push(k);
  }
  const chunks: LayoutChunk[] = stored.map((s, i) => ({ stored: [s], undo: ownedUndo[i].map(k => undo[k]) }));
  // Leading: pre-bundle names are legible only ahead of every stored action.
  if (orphans.length > 0) { chunks.unshift({ stored: [], undo: orphans.map(k => undo[k]) }); }
  return chunks;
}

// A grid point reached by the search: best score so far, the edge that reached
// it, and whether it has been popped with its final score.
interface Node { score: Score; fromI: number; fromJ: number; settled: boolean; }

// A grid point at the score it was pushed with; stale by pop time if the point
// was improved since, and then skipped.
interface HeapEntry { key: number; i: number; j: number; score: Score; }

// Best score first, then lowest (i, j), so the search is deterministic.
function compareEntries(a: HeapEntry, b: HeapEntry): number {
  return compareScore(a.score, b.score) || (a.i - b.i) || (a.j - b.j);
}

class MinHeap {
  private _items: HeapEntry[] = [];
  public get size() { return this._items.length; }
  public push(e: HeapEntry) {
    const items = this._items;
    items.push(e);
    let k = items.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (compareEntries(items[k], items[parent]) >= 0) { break; }
      [items[k], items[parent]] = [items[parent], items[k]];
      k = parent;
    }
  }

  public pop(): HeapEntry {
    const items = this._items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < items.length && compareEntries(items[l], items[m]) < 0) { m = l; }
        if (r < items.length && compareEntries(items[r], items[m]) < 0) { m = r; }
        if (m === k) { break; }
        [items[k], items[m]] = [items[m], items[k]];
        k = m;
      }
    }
    return top;
  }
}

export function chunkByLattice(stored: DocAction[], undo: DocAction[], testStats?: LatticeStats): LayoutChunk[] {
  const N = stored.length;
  const M = undo.length;
  if (testStats) { testStats.settled = 0; }
  if (M === 0) { return stored.map(s => ({ stored: [s], undo: [] })); }

  const storedInfos = stored.map(infoOf);
  const undoInfos = undo.map(infoOf);

  // The expected inverses of each stored action, computed once.
  const slotsByStored = stored.map((s, i) => expectedInverses(s, storedInfos[i]));

  const { restoreOwner, isGhost } = analyzeStored(stored, storedInfos);

  // Category of an undo entry that matched no expected slot in its chunk. A
  // defunct-slot restore is free ("none") only in the leading front segment,
  // where calc-flush insert(0) prepends it; a defunct entry stranded inside a
  // main chunk is a misplaced real inverse ("shape"), which forces the chunk to
  // widen. A ghost is an earlier-bundle orphan; anything else relates to a live
  // slot and must be placed, so discarding it ("shape") is the worst case.
  const penalize = (g: ActionInfo, leading: boolean): "none" | "orphan" | "shape" => {
    if (leading && restoreOwner(g) !== undefined) { return "none"; }
    return isGhost(g) ? "orphan" : "shape";
  };

  // Closure of the chunk stored[i..i+a) x undo[j..j+b): a minimum-penalty bag
  // alignment between the chunk's undo entries and its expected inverses,
  // returned as the per-edge tiers (shape, missing, orphan, zeros) the search
  // sums. `zeros` counts unmatched optional (may-emit-no-undo) slots: a
  // coarsening that pairs an otherwise-stranded undo across a crossing reduces
  // it, while a genuine no-op step cannot be paired, so minimizing `zeros`
  // coarsens exactly the crossings.
  const closureCost = (i: number, a: number, j: number, b: number):
  { shape: number; missing: number; orphan: number; zeros: number } => {
    const used = new Array<boolean>(b).fill(false);
    // Claim the first unused undo entry this slot matches, if any.
    const take = (test: Slot["test"]): boolean => {
      for (let q = 0; q < b; q++) {
        if (!used[q] && test(undoInfos[j + q])) { used[q] = true; return true; }
      }
      return false;
    };
    let shape = 0, missing = 0, orphan = 0, zeros = 0;
    for (let s = i; s < i + a; s++) {
      for (const slot of slotsByStored[s]) {
        if (take(slot.test)) { continue; }
        // Unmatched: required -> missing; zero -> empty optional step; routed -> free.
        if (slot.tier === "required") {
          missing += 1;
        } else if (slot.tier === "zero") {
          zeros += 1;
        }
      }
    }
    // The leading front segment (no stored opened yet) is where insert(0)
    // calc-flush restores live; only there is a defunct restore free.
    const leading = a === 0 && i === 0;
    for (let q = 0; q < b; q++) {
      if (used[q]) { continue; }
      const p = penalize(undoInfos[j + q], leading);
      if (p === "shape") { shape += 1; } else if (p === "orphan") { orphan += 1; }
    }
    return { shape, missing, orphan, zeros };
  };

  // Best-first search over the grid (see the file header). Each step is one
  // chunk, an edge spanning `a` stored by `b` undo. The edge shapes are exactly
  // the ones the engine emits, listed below rather than swept from a 2 x 2 box:
  //   [1, 1]  one action and its inverse (the common case).
  //   [1, 2]  a non-formula RemoveColumn/RemoveTable: a data restore plus the
  //           schema restore, both at the action's position.
  //   [1, 0]  an action that emits no undo (a no-op update, removing a row that
  //           isn't there).
  //   [0, 1]  a front calc-flush restore, or an earlier-bundle orphan. They sit
  //           ahead of the aligned region and chain one per edge.
  //   [2, 2]  the to-data ModifyColumn 2-swap (sandbox useractions.py
  //           doModifyColumn: pop the ModifyColumn inverse, append the column's
  //           one data-restore BulkUpdateRecord, re-append the inverse). This is
  //           the ONLY case whose two undo steps cross, so it is the only
  //           width-2 edge.
  // A fuzz sweep over the corpus selects exactly these five and never a wider
  // span (see ActionSummaryFuzz). Listing them, rather than allowing every shape
  // up to 2 x 2, makes 2 x 2 visibly the sole reorder, and an undo arriving in
  // an unexpected shape stays unplaced (a `shape` penalty) instead of being
  // quietly absorbed by an over-wide edge.
  const EDGE_SHAPES: readonly [number, number][] = [[1, 1], [1, 2], [1, 0], [0, 1], [2, 2]];
  const W = M + 1;
  const keyOf = (i: number, j: number) => i * W + j;
  const best = new Map<number, Node>();
  const heap = new MinHeap();
  best.set(keyOf(0, 0), { score: ZERO_SCORE, fromI: -1, fromJ: -1, settled: false });
  heap.push({ key: keyOf(0, 0), i: 0, j: 0, score: ZERO_SCORE });
  let settledCount = 0;
  while (heap.size > 0) {
    const { key, i, j, score } = heap.pop();
    const node = best.get(key)!;
    // A stale entry: this point was reached again with a better score since.
    if (node.settled || compareScore(score, node.score) !== 0) { continue; }
    node.settled = true;
    settledCount++;
    if (i === N && j === M) { break; }
    for (const [a, b] of EDGE_SHAPES) {
      if (a > N - i || b > M - j) { continue; }
      const ec = closureCost(i, a, j, b);
      const next: Score = {
        shape: score.shape + ec.shape,
        missing: score.missing + ec.missing,
        orphan: score.orphan + ec.orphan,
        zeros: score.zeros + ec.zeros,
        merged: score.merged + Math.max(0, a - 1),
      };
      const nextKey = keyOf(i + a, j + b);
      const existing = best.get(nextKey);
      if (existing === undefined || compareScore(next, existing.score) < 0) {
        best.set(nextKey, { score: next, fromI: i, fromJ: j, settled: false });
        heap.push({ key: nextKey, i: i + a, j: j + b, score: next });
      }
    }
  }
  // The [1, 0] and [0, 1] shapes make the far corner reachable from anywhere, so
  // the search always settles it before the heap empties.
  if (testStats) { testStats.settled = settledCount; }

  // Backtrack the chosen edges (each is one chunk).
  const edges: { i: number; a: number; j: number; b: number }[] = [];
  let ci = N, cj = M;
  while (ci !== 0 || cj !== 0) {
    const node = best.get(keyOf(ci, cj))!;
    edges.push({ i: node.fromI, a: ci - node.fromI, j: node.fromJ, b: cj - node.fromJ });
    ci = node.fromI; cj = node.fromJ;
  }
  edges.reverse();

  // Front/orphan (a = 0) entries: attribute defunct restores to their owning
  // stored; the rest split by position. In the leading segment (i === 0) an
  // unattributed entry reads as a front restore and goes to a leading chunk;
  // one consumed later is an earlier-bundle orphan and stays trailing. For
  // pre-ownership history the leading reading is a choice; it differs from the
  // old whole-bundle walk only when the entry's own table was renamed
  // in-bundle, which that walk handled no better.
  //
  // Note an asymmetry with the cost model. closureCost prices an owned restore
  // as free only on the leading edge (a === 0 && i === 0), yet this pass
  // attributes owned restores on ANY a === 0 edge. They agree in practice: the
  // engine prepends calc-flush restores to the front of the undo list, so an
  // owned restore only ever sits in the leading segment, and the least-cost path
  // consumes it there (the fuzzer never produces an exception). The attribution
  // itself routes by owner, not by position, so it
  // would stay correct even if a future shape landed a restore off-front. Only
  // the free pricing would be wrong then. That reliance on the engine's
  // front-loading is intentional.
  const ownedFront = new Map<number, number[]>();
  const leadingOrphans: number[] = [];
  const orphans: number[] = [];
  for (const e of edges) {
    if (e.a !== 0) { continue; }
    for (let q = e.j; q < e.j + e.b; q++) {
      const owner = restoreOwner(undoInfos[q]);
      if (owner !== undefined) {
        getSetMapValue(ownedFront, owner, () => []).push(q);
      } else if (e.i === 0) {
        leadingOrphans.push(q);
      } else {
        orphans.push(q);
      }
    }
  }

  const chunks: LayoutChunk[] = [];
  if (leadingOrphans.length > 0) {
    leadingOrphans.sort((x, y) => x - y);
    chunks.push({ stored: [], undo: leadingOrphans.map(idx => undo[idx]) });
  }
  for (const e of edges) {
    if (e.a === 0) { continue; }
    const indices: number[] = [];
    for (let s = e.i; s < e.i + e.a; s++) { indices.push(...(ownedFront.get(s) ?? [])); }
    for (let q = e.j; q < e.j + e.b; q++) { indices.push(q); }
    indices.sort((x, y) => x - y);
    chunks.push({ stored: stored.slice(e.i, e.i + e.a), undo: indices.map(idx => undo[idx]) });
  }
  if (orphans.length > 0) {
    orphans.sort((x, y) => x - y);
    chunks.push({ stored: [], undo: orphans.map(idx => undo[idx]) });
  }
  return chunks;
}

const RECORD_KINDS = new Set([
  "AddRecord", "BulkAddRecord", "RemoveRecord", "BulkRemoveRecord", "UpdateRecord", "BulkUpdateRecord",
]);

/**
 * Merge adjacent chunks whose stored actions are all record actions (row adds,
 * removes and updates). Splitting exists to separate schema changes; a run of
 * record actions between them is what a single walk always handled, so keeping
 * it split only multiplies the composition work. A chunk with no stored action
 * is never merged: its position is what makes its names readable. A merged
 * chunk's undo keeps bundle order, taken from `undo`, the bundle's full list.
 *
 * Two limits keep a merged walk equal to the composition of its parts:
 *  - Rows. A row added and then removed within one walk reads as recycled, not
 *    transient, and an add or remove of a row the walk already recorded mixes
 *    two entities' cells. So a run never adds or removes a row it has already
 *    touched, nor touches a row it has already added or removed. Updates of the
 *    same rows, a formula cascade, merge freely.
 *  - Size. An action over `maxInlineRows` (the summarizer's truncation limit,
 *    Infinity for none) is left in its own chunk: the walk samples such an
 *    action, and what the sample covers depends on what shares the walk, so
 *    merging would change the summary, not only how it is computed. That holds
 *    for updates too, as the fuzz truncation scenarios check.
 */
export function coalesceRecordChunks(chunks: LayoutChunk[], undo: DocAction[],
  maxInlineRows: number = Infinity): LayoutChunk[] {
  const position = new Map<DocAction, number>();
  undo.forEach((u, k) => position.set(u, k));
  const isUpdate = (a: DocAction) => a[0] === "UpdateRecord" || a[0] === "BulkUpdateRecord";
  const small = (a: DocAction) => !isDataAction(a) || getRowIdsFromDocAction(a).length <= maxInlineRows;
  // Per table, rows the current run has touched, and rows it has added or removed.
  let touched = new Map<string, Set<number>>();
  let churned = new Map<string, Set<number>>();
  const conflicts = (chunk: LayoutChunk): boolean => {
    for (const a of chunk.stored) {
      if (!isDataAction(a)) { continue; }
      const churn = !isUpdate(a);
      for (const r of getRowIdsFromDocAction(a)) {
        if (churned.get(a[1])?.has(r) || (churn && touched.get(a[1])?.has(r))) { return true; }
      }
    }
    return false;
  };
  const note = (chunk: LayoutChunk) => {
    for (const a of chunk.stored) {
      if (!isDataAction(a)) { continue; }
      const rows = getRowIdsFromDocAction(a);
      const t = getSetMapValue(touched, a[1], () => new Set<number>());
      for (const r of rows) { t.add(r); }
      if (!isUpdate(a)) {
        const c = getSetMapValue(churned, a[1], () => new Set<number>());
        for (const r of rows) { c.add(r); }
      }
    }
  };
  const out: LayoutChunk[] = [];
  const merged = new Set<LayoutChunk>();
  let run: LayoutChunk | null = null;
  for (const chunk of chunks) {
    const mergeable = chunk.stored.length > 0 && chunk.stored.every(s => RECORD_KINDS.has(s[0])) &&
      chunk.stored.every(small) && chunk.undo.every(small);
    if (mergeable && run && !conflicts(chunk)) {
      run.stored.push(...chunk.stored);
      run.undo.push(...chunk.undo);
      merged.add(run);
      note(chunk);
      continue;
    }
    touched = new Map(); churned = new Map();
    run = mergeable ? { stored: [...chunk.stored], undo: [...chunk.undo] } : null;
    if (run) { note(chunk); }
    out.push(run ?? chunk);
  }
  for (const chunk of merged) {
    chunk.undo.sort((x, y) => (position.get(x) ?? 0) - (position.get(y) ?? 0));
  }
  return out;
}
