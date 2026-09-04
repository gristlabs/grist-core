/**
 * Property test for chunking + concatenation, with the engine as its own ground
 * truth at two granularities:
 *   - Mode A (reference): apply each user action as its own bundle,
 *     summarize each, and concatenate. One action per bundle is the
 *     finest granularity the engine produces, so it needs no chunking
 *     judgement -- this is the trusted answer.
 *   - Mode B (under test): apply the same sequence as one bundle, and
 *     summarize it (which chunks then concatenates). The bundle carries the
 *     engine's per-undo ownership, so this goes through chunkByOwners; each
 *     bundle is also summarized via chunkByLattice and the two are required to
 *     agree (see summarizeBundle), so both chunkers are under test at once.
 *
 * If chunking and concatenation are correct, Mode B == Mode A for every
 * sequence. We also check that concatenation is associative over the
 * per-action summaries (grouping must not matter).
 *
 * Runs are random (seeded). Tune via env: FUZZ_RUNS, FUZZ_SEED.
 */

import { getEnvContent } from "app/common/ActionBundle";
import { ActionSummaryOptions, canonicalizeSummary, concatenateSummaries, concatenateSummaryPair,
  summarizeStoredAndUndo } from "app/common/ActionSummarizer";
import { ActionSummary, TableDelta } from "app/common/ActionSummary";
import { DocAction, UserAction } from "app/common/DocActions";
import { CellDelta } from "app/common/TabularDiff";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { createDocTools } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";
import { assert } from "test/server/testUtils";

// One scenario's raw engine output at the two granularities the oracle compares:
// each action as its own bundle (Mode A) and the whole sequence as one (Mode B).
// `undoOwner` is the engine's per-undo ownership (see ActionBundle), carried
// through so the summarizer takes its chunkByOwners path -- the whole oracle thus
// runs over the owner-driven chunking, and `summarizeBundle` cross-checks it
// against the lattice.
interface RawBundle {
  stored: DocAction[];
  undo: DocAction[];
  undoOwner?: (number | null)[];
}

// ---- seeded PRNG (mulberry32) ----
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function() {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
function pick<T>(rng: Rng, arr: T[]): T { return arr[Math.floor(rng() * arr.length)]; }
function pickInt(rng: Rng, lo: number, hi: number): number { return lo + Math.floor(rng() * (hi - lo + 1)); }

// A varied cell value, biased to include the "hard" values: the empty string
// and 0 (column defaults the engine omits), SQL NULL (a value distinct from
// absence), booleans and numbers (type-mixing), and otherwise a near-unique
// string. Exercises default omission, the [null]-vs-absent distinction, and
// type coercion.
function randomValue(rng: Rng, tag: string): any {
  const r = rng();
  if (r < 0.08) { return ""; }                  // empty string (Text default)
  if (r < 0.16) {                                // encoded list (ChoiceList-style)
    return r < 0.12 ? ["L"] :                       // empty list (the list default)
      ["L", String(pickInt(rng, 1, 9)), pickInt(rng, 1, 9)];
  }
  if (r < 0.22) { return null; }                // SQL NULL (a value, not absence)
  if (r < 0.30) { return 0; }                   // numeric default
  if (r < 0.38) { return pickInt(rng, 1, 9); }  // small number
  if (r < 0.44) { return rng() < 0.5; }         // boolean
  if (r < 0.50) { return String(pickInt(rng, 0, 9)); } // string digit: "0" vs 0 type collision
  return `${tag}${pickInt(rng, 1, 99999)}`;     // near-unique string
}

// Constant / id-based formulas that never break under renames or removals.
const FORMULAS = ["0", "''", "1+1", "$id", "$id*2"];

// ---- a model of the doc, so we only generate valid actions ----
//
// The model deliberately RECYCLES names and rowIds: a removed/renamed-away
// table or column name returns to a pool, as does a removed rowId, and later
// actions draw from those pools with probability REUSE_P. This is what forces
// the naming-identity-change and rowId-recycle shapes that monotonic counters
// would never produce, the exact case chunking exists to handle.
interface TableModel {
  cols: string[]; rows: number[]; nextRow: number; freedRows: number[];
  formulaCols: Set<string>;   // columns currently holding a formula (no stored data)
}

// The population is always adversarial -- there is no mild mode. We drop the
// plain-edit filler that summarizes cleanly and concentrate the operations
// that have actually produced bugs: renames, name/row recycling, formula<->
// data conversions, and type changes, over several wide tables with list-
// encoded values and aggressive name reuse, so the hard interactions stack.
const REUSE_P = 0.85;   // high reuse -> recycle tangles bite hardest

class DocModel {
  public tables = new Map<string, TableModel>();
  public nextTable = 1;
  public nextCol = 1;
  public freedTables: string[] = [];   // table names removed/renamed-away, free to reuse
  public freedCols: string[] = [];     // column names removed/renamed-away, free to reuse

  // Draw a table name: sometimes reuse a freed (and not-currently-live) name,
  // forcing remove-then-readd of the same slot; else mint a fresh one.
  public drawTableName(rng: Rng): string {
    const free = this.freedTables.filter(n => !this.tables.has(n));
    if (free.length && rng() < REUSE_P) {
      const n = pick(rng, free);
      this.freedTables = this.freedTables.filter(x => x !== n);
      return n;
    }
    return `T${this.nextTable++}`;
  }

  // Draw a column name not in `exclude`: reuse a freed one (same-table column
  // ids must stay distinct, so the caller passes the live set), else fresh.
  public drawColName(rng: Rng, exclude: Set<string>): string {
    const free = this.freedCols.filter(n => !exclude.has(n));
    if (free.length && rng() < REUSE_P) {
      const n = pick(rng, free);
      this.freedCols = this.freedCols.filter(x => x !== n);
      return n;
    }
    return `c${this.nextCol++}`;
  }

  // Draw a rowId for a table: reuse a freed (removed) rowId, else fresh.
  public drawRowId(rng: Rng, tm: TableModel): number {
    const live = new Set(tm.rows);
    const free = tm.freedRows.filter(r => !live.has(r));
    if (free.length && rng() < REUSE_P) {
      const r = pick(rng, free);
      tm.freedRows = tm.freedRows.filter(x => x !== r);
      return r;
    }
    return tm.nextRow++;
  }

  public freeTableName(id: string) { this.freedTables.push(id); }
  public freeColName(c: string) { this.freedCols.push(c); }

  public addTable(rng: Rng): { id: string; cols: string[] } {
    const id = this.drawTableName(rng);
    const used = new Set<string>();
    const cols: string[] = [];
    const nCols = pickInt(rng, 2, 4);   // wider tables = more churn surface
    for (let i = 0; i < nCols; i++) { const c = this.drawColName(rng, used); used.add(c); cols.push(c); }
    this.tables.set(id, { cols: [...cols], rows: [], nextRow: 1, freedRows: [], formulaCols: new Set() });
    return { id, cols };
  }
}

// Build the random setup as concrete user actions plus a seeded model.
function randomSetup(rng: Rng): { setup: UserAction[]; model: DocModel } {
  const model = new DocModel();
  const setup: UserAction[] = [];
  const nTables = pickInt(rng, 2, 3);
  for (let t = 0; t < nTables; t++) {
    const { id, cols } = model.addTable(rng);
    setup.push(["AddTable", id, cols.map(c => ({ id: c }))]);
    const tm = model.tables.get(id)!;
    const nRows = pickInt(rng, 3, 5);
    for (let r = 0; r < nRows; r++) {
      const rowId = tm.nextRow++;
      tm.rows.push(rowId);
      const values: { [c: string]: any } = {};
      for (const c of tm.cols) { values[c] = randomValue(rng, `v${rowId}_${c}_`); }
      setup.push(["AddRecord", id, rowId, values]);
    }
  }
  return { setup, model };
}

// One random *valid* action against the current model; mutates the model
// to reflect the action so the rest of the sequence stays valid. Returns
// undefined if no valid action of the chosen kind is available.
function randomAction(rng: Rng, model: DocModel): UserAction | undefined {
  const tableIds = [...model.tables.keys()];
  if (tableIds.length === 0) { return undefined; }
  // Values are only ever set for data columns; setting a value on a formula
  // column would convert it (a separate, deliberately-generated trick).
  const dataCols = (t: TableModel) => t.cols.filter(c => !t.formulaCols.has(c));
  // Black-hat weighting: bias hard toward the operations that proved hardest --
  // column remove/rename/recompose (recycle sources & sinks), table renames
  // (which strand calc-flush restores under the post-rename name), and
  // formula/type conversions (reversed-undo). Plain updates are de-emphasized.
  // No plain-edit padding. Just enough update/add to create restorable data
  // and recycle rowIds; everything else is the hard schema churn -- recycled
  // column and table names, renames into freed names, formula<->data
  // conversions (reversed undo), and type changes.
  const kinds = ["removeCol", "removeCol", "addCol", "addFormulaCol",
    "renameCol", "renameCol", "renameCol",
    "removeTable", "addTable",
    "renameTable", "renameTable", "renameTable", "renameTable",
    "modifyColType", "modifyColType",
    "toggleFormula", "toggleFormula",
    "convertFormulaToData", "convertFormulaToData", "convertFormulaToData",
    "remove", "bulkRemove", "add", "bulkAdd", "update"];
  const kind = pick(rng, kinds);
  const tid = pick(rng, tableIds);
  const tm = model.tables.get(tid)!;

  switch (kind) {
    case "update": {
      const cols = dataCols(tm);
      if (tm.rows.length === 0 || cols.length === 0) { return undefined; }
      const row = pick(rng, tm.rows);
      const col = pick(rng, cols);
      return ["UpdateRecord", tid, row, { [col]: randomValue(rng, `u${row}_${col}_`) }];
    }
    case "add": {
      if (tm.cols.length === 0) { return undefined; }
      const rowId = model.drawRowId(rng, tm);
      tm.rows.push(rowId);
      const values: { [c: string]: any } = {};
      for (const c of dataCols(tm)) { values[c] = randomValue(rng, `a${rowId}_${c}_`); }
      return ["AddRecord", tid, rowId, values];
    }
    case "remove": {
      if (tm.rows.length === 0) { return undefined; }
      const row = pick(rng, tm.rows);
      tm.rows = tm.rows.filter(r => r !== row);
      tm.freedRows.push(row);
      return ["RemoveRecord", tid, row];
    }
    case "addCol": {
      const col = model.drawColName(rng, new Set(tm.cols));
      tm.cols.push(col);
      return ["AddColumn", tid, col, {}];
    }
    case "removeCol": {
      if (tm.cols.length <= 1) { return undefined; }
      const col = pick(rng, tm.cols);
      tm.cols = tm.cols.filter(c => c !== col);
      tm.formulaCols.delete(col);
      model.freeColName(col);
      return ["RemoveColumn", tid, col];
    }
    case "renameCol": {
      if (tm.cols.length === 0) { return undefined; }
      const col = pick(rng, tm.cols);
      const newCol = model.drawColName(rng, new Set(tm.cols));
      tm.cols = tm.cols.map(c => c === col ? newCol : c);
      if (tm.formulaCols.delete(col)) { tm.formulaCols.add(newCol); }
      model.freeColName(col);
      return ["RenameColumn", tid, col, newCol];
    }
    case "addTable": {
      const { id, cols } = model.addTable(rng);
      return ["AddTable", id, cols.map(c => ({ id: c }))];
    }
    case "removeTable": {
      if (model.tables.size <= 1) { return undefined; }
      model.tables.delete(tid);
      model.freeTableName(tid);
      for (const c of tm.cols) { model.freeColName(c); }
      return ["RemoveTable", tid];
    }
    case "renameTable": {
      const newId = model.drawTableName(rng);
      if (newId === tid) { return undefined; }
      model.tables.set(newId, tm);
      model.tables.delete(tid);
      model.freeTableName(tid);
      return ["RenameTable", tid, newId];
    }
    case "bulkAdd": {
      if (tm.cols.length === 0) { return undefined; }
      const n = pickInt(rng, 2, 4);
      const ids: number[] = [];
      for (let i = 0; i < n; i++) { const id = model.drawRowId(rng, tm); ids.push(id); tm.rows.push(id); }
      const values: { [c: string]: any[] } = {};
      for (const c of dataCols(tm)) { values[c] = ids.map(id => randomValue(rng, `b${id}_${c}_`)); }
      return ["BulkAddRecord", tid, ids, values];
    }
    case "bulkRemove": {
      if (tm.rows.length < 2) { return undefined; }
      const n = Math.min(pickInt(rng, 2, 3), tm.rows.length);
      const ids = tm.rows.slice(0, n);
      tm.rows = tm.rows.slice(n);
      for (const r of ids) { tm.freedRows.push(r); }
      return ["BulkRemoveRecord", tid, ids];
    }
    case "addFormulaCol": {
      // A real formula column: no stored data, recomputed on every row change
      // (exercises calc-flush, front-stray undos, the newly-created-no-undo case).
      const col = model.drawColName(rng, new Set(tm.cols));
      tm.cols.push(col);
      tm.formulaCols.add(col);
      return ["AddColumn", tid, col, { isFormula: true, formula: pick(rng, FORMULAS) }];
    }
    case "modifyColType": {
      // Type change on a data column -- forces a type/data cascade and a
      // conversion of the stored values.
      const cols = dataCols(tm);
      if (cols.length === 0) { return undefined; }
      const col = pick(rng, cols);
      return ["ModifyColumn", tid, col, { type: pick(rng, ["Text", "Numeric", "Int", "Bool", "Any"]) }];
    }
    case "toggleFormula": {
      // Turn a data column into a formula column (it loses its stored data).
      const cols = dataCols(tm);
      if (cols.length === 0) { return undefined; }
      const col = pick(rng, cols);
      tm.formulaCols.add(col);
      return ["ModifyColumn", tid, col, { isFormula: true, formula: pick(rng, FORMULAS) }];
    }
    case "convertFormulaToData": {
      // Turn a formula column into a data column the way Grist actually does it:
      // ModifyColumn with isFormula:false and an empty formula freezes the
      // formula's current values as stored data (the reversed-undo / null-vs-value
      // case). Writing a literal to one cell does not convert a non-empty formula
      // column -- the engine rejects that with "Can't save value to formula
      // column" -- so the conversion must go through ModifyColumn.
      if (tm.formulaCols.size === 0) { return undefined; }
      const col = pick(rng, [...tm.formulaCols]);
      tm.formulaCols.delete(col);
      return ["ModifyColumn", tid, col, { isFormula: false, formula: "" }];
    }
  }
  return undefined;
}

function randomSequence(rng: Rng, model: DocModel): UserAction[] {
  const len = pickInt(rng, 8, 20);
  const out: UserAction[] = [];
  for (let i = 0; i < len && out.length < len; i++) {
    const a = randomAction(rng, model);
    if (a) { out.push(a); }
  }
  return out;
}

// Canonicalize for order-insensitive comparison (object keys sorted).
function canon(v: any): any {
  if (v === null || typeof v !== "object") { return v; }
  if (Array.isArray(v)) { return v.map(canon); }
  const out: any = {};
  for (const k of Object.keys(v).sort()) { out[k] = canon(v[k]); }
  return out;
}
function eq(a: ActionSummary, b: ActionSummary): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
// Lenient comparison accepting only negligible default-at-a-removed-boundary
// differences (the engine's default-value omission); a real value mismatch
// still fails. The softening is relative to the other side (see softenSummary):
// a default value is dropped only where the other summary records nothing there,
// so two different present values -- even two distinct type-defaults like "" and
// 0 -- never collapse together and a corrupted value stays visible.
function eqSoft(a: ActionSummary, b: ActionSummary): boolean {
  return eq(softenSummary(a, b), softenSummary(b, a));
}

// "Don't sweat the small stuff" filter.
//
// The engine omits a column's value from a removed row's (or removed column's)
// restore when that value is the column type's default (null for Any, "" for
// Text, 0 for Numeric/Int, false for Bool). So the combined bundle never carries
// such a cell, while a per-action concat may record it from an earlier explicit
// write. The difference is exactly one default value at a boundary where the
// cell is going away anyway -- it carries no recoverable information and does
// not affect endpoint reconstruction. `softenSummary` drops such a default cell
// side, but only where the other summary records nothing there ("absent"). This
// is deliberately relative: nulling defaults on each side independently would
// also equate two different present defaults (e.g. "" with 0), masking a
// corrupted value. By only dropping a default opposite an absent side, a real
// value difference -- including a different default, or a non-default the engine
// would never omit -- stays visible.
function isDefaultScalar(side: CellDelta[0]): boolean {
  if (!Array.isArray(side) || side.length !== 1) { return false; }
  const v = side[0];
  return v === null || v === "" || v === 0 || v === false;
}

// A side counts as "absent" on the other summary if that cell is missing
// entirely or records null on this side, so a default here lines up with nothing
// there.
function softenTableDelta(td: TableDelta, otherTd?: TableDelta): TableDelta {
  const addSet = new Set(td.addRows);
  const remSet = new Set(td.removeRows);
  const removedRows = new Set(td.removeRows.filter(r => !addSet.has(r)));
  const addedRows = new Set(td.addRows.filter(r => !remSet.has(r)));
  const recycledRows = new Set(td.addRows.filter(r => remSet.has(r)));
  const addedCols = new Set(td.columnRenames.filter(([pre]) => pre === null).map(([, post]) => post));
  const columnDeltas: { [colId: string]: { [rowId: number]: CellDelta } } = {};
  for (const [colId, cd] of Object.entries(td.columnDeltas)) {
    const defunctCol = colId.startsWith("-");
    const addedCol = addedCols.has(colId);
    const otherCd = otherTd?.columnDeltas[colId];
    const kept: { [rowId: number]: CellDelta } = {};
    for (const [rowId, cell] of Object.entries(cd)) {
      const r = Number(rowId);
      const recycled = recycledRows.has(r);
      const otherCell = otherCd?.[r];
      const otherPreAbsent = (otherCell?.[0] ?? null) === null;
      const otherPostAbsent = (otherCell?.[1] ?? null) === null;
      let [pre, post] = cell;
      // Drop a default value at an existence boundary -- what the engine omits --
      // but only where the other summary records nothing there, so it lines up
      // with an absence rather than overwriting a different value the other side
      // carries. A non-default value is never touched (losing it would be real).
      if ((defunctCol || removedRows.has(r) || recycled) && isDefaultScalar(pre) && otherPreAbsent) {
        pre = null;
      }
      if ((addedCol || addedRows.has(r) || recycled) && isDefaultScalar(post) && otherPostAbsent) {
        post = null;
      }
      if (pre === null && post === null) { continue; }   // vacuous after normalizing
      kept[r] = [pre, post];
    }
    if (Object.keys(kept).length > 0) { columnDeltas[colId] = kept; }
  }
  // updateRows is derived from cells, so after dropping negligible cells we must
  // re-derive it: a row whose only cell was a default-at-a-boundary is no longer
  // "really updated", and a lingering updateRows entry would read as a difference.
  const updateRows = [...new Set(
    Object.values(columnDeltas).flatMap(cd => Object.keys(cd).map(Number)))]
    .filter(r => !addSet.has(r) && !remSet.has(r)).sort((a, b) => a - b);
  return { ...td, columnDeltas, updateRows };
}

/**
 * Drop negligible default-at-a-boundary cells for lenient comparison, relative to
 * `other`: a default side is dropped only where `other` records nothing there.
 */
function softenSummary(sum: ActionSummary, other: ActionSummary): ActionSummary {
  const tableDeltas: { [tableId: string]: TableDelta } = {};
  for (const [tableId, td] of Object.entries(sum.tableDeltas)) {
    tableDeltas[tableId] = softenTableDelta(td, other.tableDeltas[tableId]);
  }
  return { ...sum, tableDeltas };
}

// A canonical snapshot of every user table's data (rows, columns, computed
// values) plus each column's type/isFormula. Used to enforce the oracle's
// same-final-state precondition: per-action and combined modes must reach the
// SAME final document state, or comparing their summaries is meaningless. Type
// changes especially can in principle make the two modes diverge; such
// scenarios are skipped. The engine's formula->data type guess is batch-
// sensitive, and that divergence is invisible in row data when the table ends
// with no surviving rows -- so we fold column type/isFormula into the snapshot,
// keyed by table+colId, to let the precondition skip those scenarios too.
async function docSnapshot(doc: ActiveDoc, session: any): Promise<string> {
  const tables = (await doc.fetchTable(session, "_grist_Tables", true)).tableData as any;
  const tableIds: string[] = (tables[3].tableId || []).filter((t: any) => typeof t === "string");
  const out: { [t: string]: any } = {};
  for (const t of [...tableIds].sort()) {
    out[t] = canon((await doc.fetchTable(session, t, true)).tableData);
  }
  // Column type/isFormula, keyed by table+colId, so a metadata-only divergence
  // (no surviving rows to expose it) still trips the same-final-state gate.
  const refToTableId: { [ref: number]: string } = {};
  tables[2].forEach((ref: number, i: number) => { refToTableId[ref] = tables[3].tableId[i]; });
  const colData = (await doc.fetchTable(session, "_grist_Tables_column", true)).tableData as any;
  const cols = colData[3];
  const colMeta: { [key: string]: any } = {};
  colData[2].forEach((_ref: number, i: number) => {
    const tbl = refToTableId[cols.parentId[i]];
    if (tbl && tableIds.includes(tbl)) {
      colMeta[`${tbl}.${cols.colId[i]}`] = [cols.type[i], cols.isFormula[i]];
    }
  });
  out.__colMeta__ = canon(colMeta);
  return JSON.stringify(out);
}

// A second precondition: the bundle's own undo must round-trip. Some bundles
// (e.g. a column made into a formula, removed, and its table renamed in one
// batch) emit an undo the engine itself cannot apply -- it throws, or leaves
// the wrong state (a known engine bug). A summary
// derives the pre-state from the undo, so when the undo is invalid there is no
// well-defined transition to check; such scenarios are skipped. `doc` is left
// mutated (the undo is applied), so the caller must be done with it.
async function undoRoundTrips(doc: ActiveDoc, session: any,
  before: string, undo: any[]): Promise<boolean> {
  try {
    await doc.applyUserActions(session, [["ApplyUndoActions", undo]]);
    return (await docSnapshot(doc, session)) === before;
  } catch (e) {
    return false;
  }
}

// Disable bulk truncation so per-action and combined paths summarize
// comparably (a batched bulk would otherwise be sampled differently
// than many small per-action bulks -- a spurious diff).
const SUMMARY_OPTS = { maximumInlineRows: null };

// Summarize a raw bundle the way production does -- using the engine's per-undo
// ownership when present (the chunkByOwners path). When ownership is present,
// also summarize via the lattice (ignoreUndoGrouping) and assert the two paths
// agree, so every scenario the oracle checks doubles as a check that the engine's
// recorded grouping matches the one the lattice infers. Returns the owner-path
// summary, which the oracle then compares against the per-action reference.
function summarizeBundle(b: RawBundle, opts: ActionSummaryOptions = SUMMARY_OPTS): ActionSummary {
  const byOwners = summarizeStoredAndUndo(b.stored, b.undo, opts, b.undoOwner);
  if (b.undoOwner !== undefined) {
    const byLattice = summarizeStoredAndUndo(b.stored, b.undo, { ...opts, ignoreUndoGrouping: true });
    assert.isTrue(eqSoft(byOwners, byLattice),
      `owner-driven and lattice chunking disagree on the same bundle\n` +
      `stored=${JSON.stringify(b.stored)}\nundo=${JSON.stringify(b.undo)}\n` +
      `undoOwner=${JSON.stringify(b.undoOwner)}\n` +
      `byOwners=${JSON.stringify(byOwners)}\nbyLattice=${JSON.stringify(byLattice)}`);
  }
  return byOwners;
}

// Drive the engine through one scenario and return the raw (stored, undo)
// bundles at both granularities the oracle compares: each action as its own
// bundle (Mode A) and the whole sequence as one bundle (Mode B). Returns null
// when a precondition makes the comparison meaningless -- an empty sequence,
// the two modes reaching different final states, or a bundle whose undo the
// engine cannot replay -- or when a generated action turns out invalid.
async function runScenario(doc: ActiveDoc, session: any,
  setup: UserAction[], actions: UserAction[]):
Promise<{ perAction: RawBundle[]; combined: RawBundle } | null> {
  if (actions.length === 0) { return null; }
  try {
    // The caller supplies an empty doc, reused across scenarios so the engine
    // boots once. One doc also serves both modes: run Mode B (the whole sequence
    // as one bundle) first, then undo back to the post-setup state (the undo
    // round-trip check doubles as the reset), then run Mode A (each action as
    // its own bundle). A second doc would only re-apply the same setup.
    await doc.applyUserActions(session, setup);
    const beforeActions = await docSnapshot(doc, session);

    // Mode B: the whole sequence as one bundle.
    await doc.applyUserActions(session, actions);
    const cb = (await doc.getRecentActionsDirect(1))[0];
    const combined: RawBundle =
      { stored: getEnvContent(cb.stored), undo: cb.undo, undoOwner: cb.undoOwner };
    const afterCombined = await docSnapshot(doc, session);

    // The bundle's undo must round-trip to the pre-state, else there is no
    // well-defined transition to summarize. This also restores the post-setup
    // state for Mode A.
    if (!await undoRoundTrips(doc, session, beforeActions, cb.undo)) { return null; }

    // Mode A: each action as its own bundle, from the same post-setup state.
    const perAction: RawBundle[] = [];
    for (const a of actions) {
      await doc.applyUserActions(session, [a]);
      const b = (await doc.getRecentActionsDirect(1))[0];
      perAction.push({ stored: getEnvContent(b.stored), undo: b.undo, undoOwner: b.undoOwner });
    }
    // Both modes must reach the same final state, else comparing summaries is
    // meaningless.
    if (await docSnapshot(doc, session) !== afterCombined) { return null; }
    return { perAction, combined };
  } catch (err) {
    return null;   // an occasional invalid generated action
  }
}

// The chunk+concat oracle, run on a doc already set up: applying `edits` as one
// bundle (Mode B) must summarize to the same thing as applying each edit on its
// own and composing (Mode A), and the combined undo must round-trip. Returns the
// combined summary so a caller can add its own checks. Used by the cascade and
// import tests below.
async function assertConsistent(doc: ActiveDoc, session: any,
  edits: UserAction[], opts: ActionSummaryOptions = SUMMARY_OPTS): Promise<ActionSummary> {
  const before = await docSnapshot(doc, session);
  await doc.applyUserActions(session, edits);
  const cb = (await doc.getRecentActionsDirect(1))[0];
  const combined = summarizeBundle(
    { stored: getEnvContent(cb.stored), undo: cb.undo, undoOwner: cb.undoOwner }, opts);
  const afterCombined = await docSnapshot(doc, session);
  assert.isTrue(await undoRoundTrips(doc, session, before, cb.undo),
    "the combined bundle's undo must round-trip");
  const perAction: ActionSummary[] = [];
  for (const a of edits) {
    await doc.applyUserActions(session, [a]);
    const b = (await doc.getRecentActionsDirect(1))[0];
    perAction.push(summarizeBundle(
      { stored: getEnvContent(b.stored), undo: b.undo, undoOwner: b.undoOwner }, opts));
  }
  assert.strictEqual(await docSnapshot(doc, session), afterCombined,
    "both modes must reach the same final state");
  const reference = concatenateSummaries(perAction);
  assert.isTrue(eqSoft(combined, reference),
    `combined-bundle summary disagrees with per-action reference\n` +
    `combined=${JSON.stringify(combined)}\nreference=${JSON.stringify(reference)}`);
  return combined;
}

describe("ActionSummary fuzz: chunk + concat consistency", function() {
  this.timeout(600000);
  testUtils.setTmpLogLevel("error");
  const docTools = createDocTools();

  const N_RUNS = parseInt(process.env.FUZZ_RUNS || "20", 10);
  // Sweep several seeds by default. Different trajectories hit different
  // recycle/rename/conversion tangles, so seed diversity buys more coverage than
  // depth on one seed -- this is what the retired cached corpora gave, now drawn
  // fresh on every run. Kept modest on purpose: this is a supplementary net (the
  // unit suite pins every known case), so each build samples a slice and coverage
  // accumulates across builds. Raise FUZZ_RUNS for a deeper local sweep, or pin a
  // single seed with FUZZ_SEED to reproduce a failure.
  const SEEDS = process.env.FUZZ_SEED ? [parseInt(process.env.FUZZ_SEED, 10)] : [1, 2, 3];

  it(`combined == per-action, and concat associative (${N_RUNS} runs x ${SEEDS.length} seed(s))`,
    async function() {
      const session = docTools.createFakeSession();
      // Booting the data engine dominates the per-scenario cost, so boot once:
      // reuse a single doc and reset it (remove every user table) between
      // scenarios. The generated tables have no cross-table references, so the
      // removals are order-independent. Validated to give the same checked and
      // skipped counts as a fresh doc per scenario, so the reset leaves nothing
      // that affects the oracle.
      let doc = await docTools.createDoc("fuzz.grist");
      let k = 0;
      const resetDoc = async () => {
        const meta = (await doc.fetchTable(session, "_grist_Tables", true)).tableData as any;
        const ids: string[] = (meta[3].tableId || []).filter((t: any) => typeof t === "string");
        if (ids.length) { await doc.applyUserActions(session, ids.map(t => ["RemoveTable", t])); }
      };

      let checked = 0;
      let skipped = 0;
      for (const seed of SEEDS) {
        const rng = mulberry32(seed);
        for (let run = 0; run < N_RUNS; run++, k++) {
          const { setup, model } = randomSetup(rng);
          const actions = randomSequence(rng, model);
          // Start each scenario from an empty doc. runScenario already skips a
          // generated bundle that errors in the engine; if such a bundle left
          // the doc unusable, resetDoc throws here, so replace the doc rather
          // than let one bad draw abort the rest of the sweep.
          try { await resetDoc(); } catch (e) { doc = await docTools.createDoc(`fuzz-${k}.grist`); }
          const sc = await runScenario(doc, session, setup, actions);
          if (!sc) { skipped++; continue; }

          const perAction = sc.perAction.map(b => summarizeBundle(b));
          const combined = summarizeBundle(sc.combined);
          const reference = concatenateSummaries(perAction);
          assert.isTrue(eqSoft(combined, reference),
            `seed ${seed} run ${run}: combined-bundle summary disagrees with ` +
            `per-action reference.\nactions=${JSON.stringify(actions)}\n` +
            `combined=${JSON.stringify(combined)}\nreference=${JSON.stringify(reference)}`);

          // Associativity: a left-fold and a right-fold of the per-action
          // summaries must agree (grouping must not matter).
          if (perAction.length >= 2) {
            let rightFold = perAction[perAction.length - 1];
            for (let i = perAction.length - 2; i >= 0; i--) {
              rightFold = concatenateSummaryPair(perAction[i], rightFold);
            }
            assert.isTrue(eqSoft(reference, canonicalizeSummary(rightFold)),
              `seed ${seed} run ${run}: concat not associative.\n` +
              `actions=${JSON.stringify(actions)}\n` +
              `leftFold=${JSON.stringify(reference)}\nrightFold=${JSON.stringify(rightFold)}`);
          }
          checked++;
        }
      }
      console.log(`fuzz: ${checked} scenarios checked, ${skipped} skipped ` +
        `(${N_RUNS} runs x seeds ${SEEDS.join(",")})`);
      assert.isAbove(checked, 0, "no scenarios were checked");
    });
});

describe("ActionSummary: feature scenarios", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("error");
  const docTools = createDocTools();
  const session = docTools.createFakeSession();

  // Find a row id in a metadata table by matching a column (and optionally a
  // second one), e.g. the tableRef of "Src" or the colRef of "Cat" under it.
  const refOf = (meta: any, col: string, value: any, also?: [string, any]): number => {
    const rowIds: number[] = meta[2];
    const vals: any[] = meta[3][col];
    const alsoVals: any[] | undefined = also && meta[3][also[0]];
    for (let i = 0; i < rowIds.length; i++) {
      if (vals[i] === value && (!also || alsoVals![i] === also[1])) { return rowIds[i]; }
    }
    throw new Error(`ref not found: ${col}=${value}`);
  };

  describe("computed-table cascades", function() {
    // A doc with table Src grouped into a summary by Cat. Src also has a formula
    // column, so a source edit recomputes both the formula column and the summary
    // aggregates. Seed groups: a={1,2}, b={3}, c={4}.
    const makeSummaryDoc = async (name: string): Promise<ActiveDoc> => {
      const doc = await docTools.createDoc(name);
      await doc.applyUserActions(session, [
        ["AddTable", "Src", [
          { id: "Cat", type: "Text" },
          { id: "Amt", type: "Numeric" },
          { id: "Dbl", type: "Numeric", isFormula: true, formula: "$Amt * 2" },
        ]],
        ["BulkAddRecord", "Src", [1, 2, 3, 4], { Cat: ["a", "a", "b", "c"], Amt: [10, 20, 30, 40] }],
      ]);
      const tables = (await doc.fetchTable(session, "_grist_Tables", true)).tableData as any;
      const cols = (await doc.fetchTable(session, "_grist_Tables_column", true)).tableData as any;
      const srcRef = refOf(tables, "tableId", "Src");
      const catRef = refOf(cols, "colId", "Cat", ["parentId", srcRef]);
      await doc.applyUserActions(session, [["CreateViewSection", srcRef, 0, "record", [catRef], null]]);
      return doc;
    };

    // A doc with People and a Tasks table that References People and carries a
    // cross-table formula ($Owner.Name). Editing People recomputes that formula in
    // Tasks, a cross-table cascade with calc-flush restores, the same family as a
    // summary table's aggregates.
    const makeRefDoc = async (name: string): Promise<ActiveDoc> => {
      const doc = await docTools.createDoc(name);
      await doc.applyUserActions(session, [
        ["AddTable", "People", [{ id: "Name", type: "Text" }]],
        ["BulkAddRecord", "People", [1, 2], { Name: ["Alice", "Bob"] }],
        ["AddTable", "Tasks", [
          { id: "Title", type: "Text" },
          { id: "Owner", type: "Ref:People" },
          { id: "OwnerName", type: "Any", isFormula: true, formula: "$Owner.Name" },
        ]],
        ["BulkAddRecord", "Tasks", [1, 2, 3], { Title: ["t1", "t2", "t3"], Owner: [1, 1, 2] }],
      ]);
      return doc;
    };

    // The bug this exercises: a removed group's recomputed aggregates (formula
    // columns) were dropped, because their calc-flush restores scattered into
    // chunks past the removal. A new group appears, a surviving group's aggregates
    // recompute, and a group is removed, all in one bundle.
    it("keeps a removed group's aggregates, with a formula column in the mix", async function() {
      const doc = await makeSummaryDoc("summary1.grist");
      const combined = await assertConsistent(doc, session, [
        ["AddRecord", "Src", 5, { Cat: "d", Amt: 100 }],   // a new group "d" appears
        ["UpdateRecord", "Src", 1, { Amt: 15 }],           // group "a" sum and Dbl recompute
        ["BulkRemoveRecord", "Src", [3]],                  // last "b" row gone, group removed
      ]);
      // Sanity: the cascade happened, so the test is not vacuous. The summary table
      // is a table other than Src that the edits never named.
      assert.isNotEmpty(Object.keys(combined.tableDeltas).filter(t => t !== "Src"),
        "the summary table should appear in the combined summary");
    });

    // Several groups removed in one bundle: their summary rows are restored
    // together, which exercises the all-rows-defunct branch of the front-restore
    // attribution (a BulkUpdateRecord over more than one removed row).
    it("keeps the aggregates of several groups removed at once", async function() {
      const doc = await makeSummaryDoc("summary2.grist");
      await assertConsistent(doc, session, [
        ["UpdateRecord", "Src", 1, { Amt: 25 }],   // group "a" aggregates recompute
        ["BulkRemoveRecord", "Src", [3, 4]],       // groups "b" and "c" both vanish
      ]);
    });

    // A cross-table Ref cascade: editing People recomputes OwnerName across the
    // Tasks that reference it, a referenced Person is removed (its dependents
    // recompute), and a Task is removed (its own formula value must survive). The
    // removed-row front-restore handling should generalize here from summary tables.
    it("keeps formula values across a cross-table Ref cascade", async function() {
      const doc = await makeRefDoc("refs.grist");
      const combined = await assertConsistent(doc, session, [
        ["UpdateRecord", "People", 1, { Name: "Alice2" }],  // Tasks 1,2 OwnerName recompute
        ["RemoveRecord", "People", 2],                       // Task 3's $Owner.Name recomputes
        ["RemoveRecord", "Tasks", 3],                        // a Task removed; its formula restore
      ]);
      assert.isNotEmpty(Object.keys(combined.tableDeltas),
        "the cascade should touch at least one table");
    });

    // Two SEPARATE remove stored actions in one bundle, both on Src with its Dbl
    // formula column. The engine accumulates the whole bundle's summary and emits
    // ONE front BulkUpdateRecord restoring Dbl for rows 1 and 2 together -- a
    // restore spanning two distinct removals. restoreOwner attributes that whole
    // entry to the first row's owner, so this checks a restore whose rows do not
    // all belong to one removal still composes correctly (the all-rows-defunct
    // single-owner assumption).
    it("composes when two separate removes share one merged front restore", async function() {
      const doc = await makeSummaryDoc("summary3.grist");
      await assertConsistent(doc, session, [
        ["RemoveRecord", "Src", 1],
        ["RemoveRecord", "Src", 2],
      ]);
    });
  });

  describe("imports", function() {
    // A table loaded with data, the way an import lands it before any edits.
    const makeDataDoc = async (name: string): Promise<ActiveDoc> => {
      const doc = await docTools.createDoc(name);
      await doc.applyUserActions(session, [
        ["AddTable", "Data", [{ id: "A", type: "Text" }, { id: "B", type: "Text" }]],
        ["BulkAddRecord", "Data", [1, 2, 3], { A: ["a1", "a2", "a3"], B: ["10", "20", "30"] }],
      ]);
      return doc;
    };

    // Imports lean on ReplaceTableData, which the fuzzer never generates. It wipes
    // a table and re-adds, so even a row that keeps its id reads as recycled rather
    // than updated. Here a replace lands new data (rows 1 and 2 kept with new
    // values, row 3 dropped, row 4 added) and a type guess converts column B, the
    // shape an import finalize produces, in one bundle.
    it("ReplaceTableData composes with a type guess", async function() {
      const doc = await makeDataDoc("import1.grist");
      await assertConsistent(doc, session, [
        ["ReplaceTableData", "Data", [1, 2, 4],
          { A: ["a1", "a2x", "a4"], B: ["10", "25", "40"] }],
        ["ModifyColumn", "Data", "B", { type: "Numeric" }],   // a type guess on imported data
      ]);
    });

    // A replace over the data, then a row removed, stressing the recycle-everything
    // behavior in composition.
    it("a replace then a removal composes", async function() {
      const doc = await makeDataDoc("import2.grist");
      await assertConsistent(doc, session, [
        ["ReplaceTableData", "Data", [1, 2, 3, 4],
          { A: ["b1", "b2", "b3", "b4"], B: ["1", "2", "3", "4"] }],
        ["RemoveRecord", "Data", 2],
      ]);
    });
  });

  describe("tricky shapes", function() {
    const makeFormulaDoc = async (name: string): Promise<ActiveDoc> => {
      const doc = await docTools.createDoc(name);
      await doc.applyUserActions(session, [
        ["AddTable", "T", [{ id: "Amt", type: "Numeric" },
          { id: "Dbl", type: "Numeric", isFormula: true, formula: "$Amt * 2" }]],
        ["BulkAddRecord", "T", [1, 2, 3], { Amt: [10, 20, 30] }],
      ]);
      return doc;
    };

    // A recycled row (removed then re-added under the same id) carries a formula
    // column. The removed-row front-restore fix deliberately excludes recycles, so
    // this confirms a recycle still composes correctly rather than misfiring.
    it("recycles a row that has a formula column", async function() {
      const doc = await makeFormulaDoc("recycle.grist");
      await assertConsistent(doc, session, [
        ["RemoveRecord", "T", 2],
        ["AddRecord", "T", 2, { Amt: 99 }],
        ["UpdateRecord", "T", 1, { Amt: 11 }],
      ]);
    });

    // A column renamed away and back within one bundle, with an edit under the
    // interim name. The net is an identity rename plus a cell change, and the cell
    // must end up keyed under the original name.
    it("renames a column away and back with an update in between", async function() {
      const doc = await docTools.createDoc("renamecycle.grist");
      await doc.applyUserActions(session, [
        ["AddTable", "T", [{ id: "c", type: "Text" }]],
        ["AddRecord", "T", 1, { c: "x" }],
      ]);
      await assertConsistent(doc, session, [
        ["RenameColumn", "T", "c", "d"],
        ["UpdateRecord", "T", 1, { d: "y" }],
        ["RenameColumn", "T", "d", "c"],
      ]);
    });

    // A row updated and then removed in the same bundle, with a formula column.
    // The removed row's recorded pre-state must be the value from before the update.
    it("updates then removes a row with a formula column", async function() {
      const doc = await makeFormulaDoc("updateremove.grist");
      await assertConsistent(doc, session, [
        ["UpdateRecord", "T", 2, { Amt: 77 }],
        ["RemoveRecord", "T", 2],
      ]);
    });

    // A value changed and changed straight back within one bundle nets to nothing,
    // including the formula column it drives. Canonicalization drops the resulting
    // [v, v] cells, so the row is not reported as updated. This pins the intended
    // behavior that a no-op net change does not surface as a change (and so, e.g.,
    // does not fire a webhook); summarize on main left the row in updateRows.
    it("nets out a within-bundle change-then-revert", async function() {
      const doc = await makeFormulaDoc("revert.grist");
      const combined = await assertConsistent(doc, session, [
        ["UpdateRecord", "T", 1, { Amt: 999 }],   // Amt and its Dbl formula change
        ["UpdateRecord", "T", 1, { Amt: 10 }],     // ...and revert to the seeded value
      ]);
      const d = combined.tableDeltas.T;
      assert.isTrue(
        !d || (d.updateRows.length === 0 && Object.keys(d.columnDeltas).length === 0),
        "a change-then-revert must net to no recorded change");
    });
  });

  describe("truncation (mayBeIncomplete)", function() {
    const LIMIT: ActionSummaryOptions = { maximumInlineRows: 5 };   // bulks over 5 rows truncate
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);

    // A table with more rows than the limit, so a bulk over it truncates and sets
    // mayBeIncomplete. Bulk actions keep the same shape in both oracle modes, so
    // the deterministic sampling matches and the comparison stays meaningful (the
    // doc's final state is unaffected by truncation, so the precondition holds).
    const makeBulkDoc = async (name: string): Promise<ActiveDoc> => {
      const doc = await docTools.createDoc(name);
      await doc.applyUserActions(session, [
        ["AddTable", "T", [{ id: "A", type: "Text" }]],
        ["BulkAddRecord", "T", ids, { A: ids.map(i => `v${i}`) }],
      ]);
      return doc;
    };

    it("a truncated bulk update then a bulk remove of sampled rows", async function() {
      const doc = await makeBulkDoc("trunc1.grist");
      await assertConsistent(doc, session, [
        ["BulkUpdateRecord", "T", ids, { A: ids.map(i => `w${i}`) }],
        ["BulkRemoveRecord", "T", [1, 2]],
      ], LIMIT);
    });

    it("a truncated bulk update then a remove of a non-sampled row", async function() {
      const doc = await makeBulkDoc("trunc2.grist");
      await assertConsistent(doc, session, [
        ["BulkUpdateRecord", "T", ids, { A: ids.map(i => `w${i}`) }],
        ["RemoveRecord", "T", 7],   // row 7 is dropped by truncation, not in the sample
      ], LIMIT);
    });

    it("a truncated bulk add then a bulk remove of a subset", async function() {
      const doc = await makeBulkDoc("trunc3.grist");
      const newIds = Array.from({ length: 12 }, (_, i) => i + 101);
      await assertConsistent(doc, session, [
        ["BulkAddRecord", "T", newIds, { A: newIds.map(i => `a${i}`) }],
        ["BulkRemoveRecord", "T", [103, 107, 110]],
      ], LIMIT);
    });

    it("a bulk remove then a bulk add reusing ids (recycle at scale)", async function() {
      const doc = await makeBulkDoc("trunc4.grist");
      await assertConsistent(doc, session, [
        ["BulkRemoveRecord", "T", ids],
        ["BulkAddRecord", "T", ids, { A: ids.map(i => `r${i}`) }],
      ], LIMIT);
    });

    // Truncation combined with a column rename: the truncated update's sampled
    // cells must re-key onto the new column name. A rename has no recompute, so
    // both oracle modes sample the same rows and the comparison stays meaningful.
    it("a truncated bulk update then a column rename", async function() {
      const doc = await makeBulkDoc("trunc5.grist");
      await assertConsistent(doc, session, [
        ["BulkUpdateRecord", "T", ids, { A: ids.map(i => `w${i}`) }],
        ["RenameColumn", "T", "A", "B"],
      ], LIMIT);
    });

    // Truncation combined with a rename AND a removal of sampled rows, so the
    // incomplete delta is re-keyed and then has some posts nulled.
    it("a truncated bulk update then a rename then a remove", async function() {
      const doc = await makeBulkDoc("trunc6.grist");
      await assertConsistent(doc, session, [
        ["BulkUpdateRecord", "T", ids, { A: ids.map(i => `w${i}`) }],
        ["RenameColumn", "T", "A", "B"],
        ["BulkRemoveRecord", "T", [1, 2]],
      ], LIMIT);
    });

    // Note on a case deliberately not tested here: a truncated bulk update on a
    // *formula* table. The formula's calc-flush adds a second set of cells that the
    // combined and per-action paths sample differently, so the two summaries
    // disagree on which formula values are known versus "?". That is a precision
    // difference within the mayBeIncomplete contract, not value corruption (neither
    // side reports a wrong concrete value), so the two-mode oracle cannot judge it.
    // It is the same sampling slack that makes the live fuzzer disable truncation.
  });

  // Confirms the engine actually ships per-undo ownership, that it survives the
  // round-trip through the action history (where getRecentActionsDirect reads
  // it), and that it lines up with what the lattice infers -- so the oracle above
  // is genuinely exercising the owner-driven path, not silently falling back.
  describe("engine-provided undo ownership", function() {
    it("ships a well-formed undoOwner that drives chunkByOwners", async function() {
      const doc = await docTools.createDoc("ownership.grist");
      await doc.applyUserActions(session, [
        ["AddTable", "T", [{ id: "Amt", type: "Numeric" },
          { id: "Dbl", type: "Numeric", isFormula: true, formula: "$Amt * 2" }]],
        ["BulkAddRecord", "T", [1, 2, 3], { Amt: [10, 20, 30] }],
      ]);
      // A bundle mixing a formula->data conversion (the crossed-undo case), a
      // record update that recomputes the formula column, and a removal whose
      // formula value is restored at the front -- the shapes ownership matters for.
      await doc.applyUserActions(session, [
        ["ModifyColumn", "T", "Dbl", { isFormula: false, formula: "" }],
        ["UpdateRecord", "T", 1, { Amt: 15 }],
        ["RemoveRecord", "T", 2],
      ]);
      const cb = (await doc.getRecentActionsDirect(1))[0];

      // Present, parallel to undo, and not vacuous: a real bundle has owned undos.
      assert.isDefined(cb.undoOwner, "the bundle should carry undoOwner");
      assert.strictEqual(cb.undoOwner!.length, cb.undo.length,
        "undoOwner must be parallel to undo");
      const owners = cb.undoOwner!;
      assert.isAbove(owners.filter(o => o !== null).length, 0,
        "at least one undo should name a concrete owner");
      // Every concrete owner indexes a real stored action.
      const nStored = getEnvContent(cb.stored).length;
      for (const o of owners) {
        if (o !== null) { assert.isTrue(o >= 0 && o < nStored, `owner ${o} out of range`); }
      }

      // The owner-driven summary matches the lattice's on the same bundle, and
      // both match the per-action reference.
      const stored = getEnvContent(cb.stored);
      const byOwners = summarizeStoredAndUndo(stored, cb.undo, SUMMARY_OPTS, owners);
      const byLattice = summarizeStoredAndUndo(stored, cb.undo,
        { ...SUMMARY_OPTS, ignoreUndoGrouping: true });
      assert.isTrue(eqSoft(byOwners, byLattice),
        "owner-driven and lattice summaries must agree");
    });
  });
});

// The oracle's lenient comparison must tolerate the engine's default-omission (a
// default value on one side vs absence on the other) WITHOUT masking a genuine
// value difference. Nulling defaults on each side independently would collapse
// two different type-defaults (e.g. "" and 0) at the same boundary into "equal"
// and hide a corrupted recycled-row value, so the softening is done relative to
// the other side instead.
describe("eqSoft (oracle tolerance)", function() {
  // A recycled row (id 5 in both the add and remove lists) carrying one cell for
  // column A, with a given post side.
  const recycledWith = (post: CellDelta[1]): ActionSummary => ({
    tableRenames: [],
    tableDeltas: {
      T: {
        addRows: [5], removeRows: [5], updateRows: [], columnRenames: [],
        columnDeltas: { A: { 5: [["x"], post] } },
      },
    },
  });

  it("tolerates a default value opposite an absent side", function() {
    // The engine may omit a default ("" for Text) where an explicit write
    // recorded it, so these are equivalent and must compare equal.
    assert.isTrue(eqSoft(recycledWith([""]), recycledWith(null)));
  });

  it("does not equate two different defaults at the same boundary", function() {
    // "" and 0 are both type-defaults but are different values; collapsing them
    // would hide a corrupted recycled-row value.
    assert.isFalse(eqSoft(recycledWith([""]), recycledWith([0])));
  });

  it("still flags a non-default value opposite an absence", function() {
    assert.isFalse(eqSoft(recycledWith(["y"]), recycledWith(null)));
  });
});
