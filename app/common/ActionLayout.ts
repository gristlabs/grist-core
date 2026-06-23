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
 * same way regardless of path. The rest of this header describes the lattice.
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
 * Cost: with N stored actions and M undo actions (M = O(N), a bounded set of
 * inverses per action), the search fills an (N+1) by (M+1) grid at five shapes
 * per cell -- O(N*M) time and space, quadratic in the action count. Edge pricing
 * compares row lists only after a kind/table match, so the largest action's row
 * count R multiplies in only when many bulk actions share a table (worst case
 * O(N*M*R)); otherwise the row work stays linear in the rows touched. N is small
 * in practice, and the chunker runs once per bundle.
 */

import { DocAction, getColIdsFromDocAction, getRowIdsFromDocAction, isDataAction } from "app/common/DocActions";
import { getSetMapValue, isSubset } from "app/common/gutil";

export interface LayoutChunk {
  stored: DocAction[];
  undo: DocAction[];
}

function actKey(t: string, c: string): string { return `${t}/${c}`; }

// Rows / columns a data action touches, as lists; anything else (a schema
// action) touches neither. The `isDataAction` guard is essential: without it
// a schema action's payload (a colInfo object, or a name string) would be
// misread as columns, and its non-row positions as rows.
function rowsOf(a: DocAction): number[] {
  return isDataAction(a) ? getRowIdsFromDocAction(a) : [];
}
function colsOf(a: DocAction): string[] {
  return isDataAction(a) ? (getColIdsFromDocAction(a) ?? []) : [];
}
// Is every element of `sub` present in `sup`? An update's undo restores a subset
// of the rows the forward touched -- exactly the rows that had a prior value. So
// a recompute over all rows pairs with a restore over only the pre-existing rows,
// and a partial no-op bulk pairs with a restore over only the rows that actually
// changed. Equality is the common special case.
function subset<T>(sub: T[], sup: T[]): boolean {
  return isSubset(new Set(sub), new Set(sup));
}
// Order-blind set equality: equal length plus one-way containment (for matching
// an inverse's rows or columns against the forward action's).
function sameSet<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && subset(a, b);
}
// True if `a` is a record action with the given verb, single or bulk
// (`recordKind(a, "Remove")` matches RemoveRecord and BulkRemoveRecord).
function recordKind(a: DocAction, verb: "Add" | "Remove" | "Update"): boolean {
  return a[0] === `${verb}Record` || a[0] === `Bulk${verb}Record`;
}

// Lattice chunker (the model is in the file header above). The objective is a
// lexicographic score (see `betterScore` below). Every edge cost is local: it
// reads only its own two slices plus a precomputed defunct index, so this stays
// a plain Viterbi-shaped DP.

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
 *   5. chunks:  stored-owning chunks, where more is better (finest valid split).
 * Explicit tiers, not weighted sums, so no number of lower-tier penalties can
 * ever outweigh one penalty of a more significant tier.
 */
interface Score { shape: number; missing: number; orphan: number; zeros: number; chunks: number; }
interface Node { score: Score; fromI: number; fromJ: number; }
function betterScore(a: Score, b: Score): boolean {
  if (a.shape !== b.shape) { return a.shape < b.shape; }
  if (a.missing !== b.missing) { return a.missing < b.missing; }
  if (a.orphan !== b.orphan) { return a.orphan < b.orphan; }
  if (a.zeros !== b.zeros) { return a.zeros < b.zeros; }
  return a.chunks > b.chunks;
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
interface Slot { tier: SlotTier; test: (g: DocAction) => boolean; }
const req = (test: Slot["test"]): Slot => ({ tier: "required", test });
const zero = (test: Slot["test"]): Slot => ({ tier: "zero", test });
const routed = (test: Slot["test"]): Slot => ({ tier: "routed", test });

/**
 * The inverse(s) we expect from a single forward action (the catalogue read
 * from the engine, per the file header). Predicates ignore cell values, so they
 * are local. ModifyColumn deliberately tests only kind+table+col (not which
 * property changed): the conversion's two ModifyColumns on one column are
 * interchangeable for closure, which is exactly why their reversed undo
 * costs nothing inside one chunk.
 */
function expectedInverses(s: DocAction): Slot[] {
  const k = s[0];
  const t = s[1];
  switch (k) {
    case "AddRecord": case "BulkAddRecord":
      return [req(g => recordKind(g, "Remove") && g[1] === t && sameSet(rowsOf(g), rowsOf(s)))];
    case "RemoveRecord": case "BulkRemoveRecord":
      return [zero(g => recordKind(g, "Add") && g[1] === t && subset(rowsOf(g), rowsOf(s)))];
    case "UpdateRecord": case "BulkUpdateRecord":
      return [zero(g => recordKind(g, "Update") && g[1] === t &&
        subset(rowsOf(g), rowsOf(s)) && sameSet(colsOf(g), colsOf(s)))];
    case "AddColumn":
      return [req(g => g[0] === "RemoveColumn" && g[1] === t && g[2] === s[2])];
    case "RemoveColumn":
      return [
        req(g => g[0] === "AddColumn" && g[1] === t && g[2] === s[2]),
        routed(g => recordKind(g, "Update") && g[1] === t && colsOf(g).includes(s[2])),
      ];
    case "RenameColumn":
      return [req(g => g[0] === "RenameColumn" && g[1] === t && g[2] === s[3] && g[3] === s[2])];
    case "ModifyColumn":
      return [zero(g => g[0] === "ModifyColumn" && g[1] === t && g[2] === s[2])];
    case "AddTable":
      return [req(g => g[0] === "RemoveTable" && g[1] === t)];
    case "RemoveTable":
      return [
        req(g => g[0] === "AddTable" && g[1] === t),
        routed(g => recordKind(g, "Add") && g[1] === t),
      ];
    case "RenameTable":
      return [req(g => g[0] === "RenameTable" && g[1] === s[2] && g[2] === s[1])];
    case "ReplaceTableData":
      return [zero(g => g[0] === "ReplaceTableData" && g[1] === t)];
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
  restoreOwner: (g: DocAction) => number | undefined;
  // A genuine earlier-bundle orphan: a restore whose slot no forward here touches.
  isGhost: (g: DocAction) => boolean;
}

function analyzeStored(stored: DocAction[]): StoredAnalysis {
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
  for (let i = 0; i < N; i++) {
    const s = stored[i];
    const t = s[1];
    touchedTables.add(t);
    // A column kind names its slot key once, for both its index and liveCols.
    switch (s[0]) {
      case "RemoveColumn": removeColIdx.set(actKey(t, s[2]), i); liveCols.add(actKey(t, s[2])); break;
      case "AddColumn": addColIdx.set(actKey(t, s[2]), i); liveCols.add(actKey(t, s[2])); break;
      case "ModifyColumn": case "RenameColumn": liveCols.add(actKey(t, s[2])); break;
      case "RemoveTable": removeTblIdx.set(t, i); break;
      case "AddTable": addTblIdx.set(t, i); break;
      case "RemoveRecord": case "BulkRemoveRecord":
        for (const r of rowsOf(s)) { getSetMapValue(removeRowIdx, t, () => new Map()).set(r, i); } break;
      case "AddRecord": case "BulkAddRecord":
        for (const r of rowsOf(s)) { getSetMapValue(addRowIdx, t, () => new Map()).set(r, i); } break;
    }
    for (const c of colsOf(s)) { liveCols.add(actKey(t, c)); }
  }
  // Defunct = removed in this bundle and not re-added before that removal (so
  // not a recycle). One rule, three lookups.
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
  const restoreOwner = (g: DocAction): number | undefined => {
    if (recordKind(g, "Update")) {
      for (const c of colsOf(g)) {
        if (isColDefunct(g[1], c)) { return removeColIdx.get(actKey(g[1], c)); }
      }
      const rows = rowsOf(g);
      if (rows.length > 0 && rows.every(r => isRowDefunct(g[1], r))) {
        // The engine folds the whole bundle's calc-flush into one restore, so
        // this entry's rows can belong to several distinct removals (two separate
        // RemoveRecords on one table merge here). We return the first row's owner.
        // That only chooses which chunk the restore joins, which is safe either
        // way. The restore is prepended ahead of every removal in the bundle, so a
        // row whose removal lands in a later chunk sees the restore there as a
        // retained [v, v] cell, and that removal composes it into the correct
        // [v, null]. See the "two separate removes share one merged front restore"
        // fuzz scenario.
        return removeRowIdx.get(g[1])!.get(rows[0]);
      }
    }
    if (isTblDefunct(g[1])) { return removeTblIdx.get(g[1]); }
    return undefined;
  };

  // A genuine earlier-bundle orphan: a restore whose slot no forward in
  // this bundle touches.
  const isGhost = (g: DocAction): boolean => {
    if (recordKind(g, "Update")) {
      const cols = colsOf(g);
      if (cols.length > 0 && cols.every(c => !liveCols.has(actKey(g[1], c)))) { return true; }
    }
    return !touchedTables.has(g[1]);
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
 * removal's chunk; an unattributable undo (a recorded-history orphan with no
 * owner) falls into a trailing stored=[] chunk, as in the lattice.
 *
 * Preconditions (the caller checks `owners.length === undo.length`): owner
 * indices are in range. Undo order within each chunk is preserved by walking
 * `undo` in order.
 */
export function chunkByOwners(stored: DocAction[], undo: DocAction[],
  owners: readonly (number | null)[]): LayoutChunk[] {
  const { restoreOwner } = analyzeStored(stored);
  const ownedUndo: number[][] = stored.map(() => []);
  const orphans: number[] = [];
  for (let k = 0; k < undo.length; k++) {
    const declared = owners[k];
    // A declared owner must index a real stored action. Otherwise (a front calc-flush
    // restore, or a recorded-history orphan with no owner) attribute it the way the lattice does.
    const owner = (typeof declared === "number" && declared >= 0 && declared < stored.length) ?
      declared :
      restoreOwner(undo[k]) ?? null;
    (owner === null ? orphans : ownedUndo[owner]).push(k);
  }
  const chunks: LayoutChunk[] = stored.map((s, i) => ({ stored: [s], undo: ownedUndo[i].map(k => undo[k]) }));
  if (orphans.length > 0) { chunks.push({ stored: [], undo: orphans.map(k => undo[k]) }); }
  return chunks;
}

export function chunkByLattice(stored: DocAction[], undo: DocAction[]): LayoutChunk[] {
  const N = stored.length;
  const M = undo.length;
  if (M === 0) { return stored.map(s => ({ stored: [s], undo: [] })); }

  // The expected inverses of each stored action, computed once: the DP asks for
  // them on every edge, but they depend only on the action.
  const slotsByStored = stored.map(expectedInverses);

  const { restoreOwner, isGhost } = analyzeStored(stored);

  // Category of an undo entry that matched no expected slot in its chunk. A
  // defunct-slot restore is free ("none") only in the leading front segment,
  // where calc-flush insert(0) prepends it; a defunct entry stranded inside a
  // main chunk is a misplaced real inverse ("shape"), which forces the chunk to
  // widen. A ghost is an earlier-bundle orphan; anything else relates to a live
  // slot and must be placed, so discarding it ("shape") is the worst case.
  const penalize = (g: DocAction, leading: boolean): "none" | "orphan" | "shape" => {
    if (leading && restoreOwner(g) !== undefined) { return "none"; }
    return isGhost(g) ? "orphan" : "shape";
  };

  // Closure of the chunk stored[i..i+a) x undo[j..j+b): a minimum-penalty bag
  // alignment between the chunk's undo entries and its expected inverses,
  // returned as the per-edge tiers (shape, missing, orphan, zeros) the DP sums.
  // `zeros` counts unmatched optional (may-emit-no-undo) slots: a coarsening
  // that pairs an otherwise-stranded undo across a crossing reduces it, while a
  // genuine no-op step cannot be paired, so minimizing `zeros` coarsens exactly
  // the crossings.
  const closureCost = (i: number, a: number, j: number, b: number):
  { shape: number; missing: number; orphan: number; zeros: number } => {
    const slots = slotsByStored.slice(i, i + a).flat();
    const used = new Array<boolean>(b).fill(false);
    // Claim the first unused undo entry this slot matches, if any.
    const take = (test: Slot["test"]): boolean => {
      for (let q = 0; q < b; q++) {
        if (!used[q] && test(undo[j + q])) { used[q] = true; return true; }
      }
      return false;
    };
    let shape = 0, missing = 0, orphan = 0, zeros = 0;
    for (const slot of slots) {
      if (take(slot.test)) { continue; }
      // Unmatched: required -> missing; zero -> empty optional step; routed -> free.
      if (slot.tier === "required") {
        missing += 1;
      } else if (slot.tier === "zero") {
        zeros += 1;
      }
    }
    // The leading front segment (no stored opened yet) is where insert(0)
    // calc-flush restores live; only there is a defunct restore free.
    const leading = a === 0 && i === 0;
    for (let q = 0; q < b; q++) {
      if (used[q]) { continue; }
      const p = penalize(undo[j + q], leading);
      if (p === "shape") { shape += 1; } else if (p === "orphan") { orphan += 1; }
    }
    return { shape, missing, orphan, zeros };
  };

  // Lexicographic DP over the grid: (cost, zeros, -chunks). Each step is one
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
  // best[i][j] is the optimal path reaching grid point (i, j), or null if
  // unreached. Each step the DP takes covers one chunk (an edge of the grid).
  const best: (Node | null)[][] =
    Array.from({ length: N + 1 }, () => new Array<Node | null>(M + 1).fill(null));
  best[0][0] = { score: { shape: 0, missing: 0, orphan: 0, zeros: 0, chunks: 0 }, fromI: -1, fromJ: -1 };
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const cur = best[i][j];
      if (cur === null) { continue; }
      for (const [a, b] of EDGE_SHAPES) {
        if (a > N - i || b > M - j) { continue; }
        const ec = closureCost(i, a, j, b);
        const score: Score = {
          shape: cur.score.shape + ec.shape,
          missing: cur.score.missing + ec.missing,
          orphan: cur.score.orphan + ec.orphan,
          zeros: cur.score.zeros + ec.zeros,
          chunks: cur.score.chunks + (a >= 1 ? 1 : 0),
        };
        const ti = i + a, tj = j + b;
        const existing = best[ti][tj];
        if (existing === null || betterScore(score, existing.score)) {
          best[ti][tj] = { score, fromI: i, fromJ: j };
        }
      }
    }
  }

  // Backtrack the chosen edges (each is one chunk).
  const edges: { i: number; a: number; j: number; b: number }[] = [];
  let ci = N, cj = M;
  while (ci !== 0 || cj !== 0) {
    const node = best[ci][cj]!;
    edges.push({ i: node.fromI, a: ci - node.fromI, j: node.fromJ, b: cj - node.fromJ });
    ci = node.fromI; cj = node.fromJ;
  }
  edges.reverse();

  // Front/orphan (a = 0) entries: attribute defunct restores to their owning
  // stored (the front restores described in the file header); the rest are
  // genuine orphans collected into a trailing chunk.
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
  const orphans: number[] = [];
  for (const e of edges) {
    if (e.a !== 0) { continue; }
    for (let q = e.j; q < e.j + e.b; q++) {
      const owner = restoreOwner(undo[q]);
      if (owner === undefined) { orphans.push(q); } else {
        getSetMapValue(ownedFront, owner, () => []).push(q);
      }
    }
  }

  const chunks: LayoutChunk[] = [];
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
