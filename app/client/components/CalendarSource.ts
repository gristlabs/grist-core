import { CalendarDates, EventContext, EventRange } from "app/client/components/CalendarEvents";
import { RowList, RowListener, RowSource } from "app/client/models/rowset";
import { UIRowId } from "app/plugin/GristAPI";

/** Reads the mapped date columns of one row. Returns null when the row has no start date. */
export type ReadDates = (rowId: number) => CalendarDates | null;

/**
 * Keeps the span of every event, so that deciding what is visible costs a number comparison
 * instead of a re-read.
 *
 * Sits in the row pipeline between the view's own rowSource and whatever draws the calendar. Two
 * jobs:
 *
 * - **Index.** Each row that has a start date gets an EventRange, worked out once. Without this,
 *   every navigation would redo the timezone arithmetic for every row in the table.
 * - **Membership.** Rows with no start date are not events, and never reach anything downstream.
 *   A row that gains or loses its date arrives below as a plain add or remove, so nothing further
 *   down has to know that a date can be missing.
 *
 * Rebuild it when the mapping or a mapped column's type changes: both the reader and the context
 * become stale, and every span has to be worked out again. `subscribeTo` replays the current rows
 * as adds by itself, so a rebuild needs no separate seeding step.
 */
export class CalendarSource extends RowListener implements RowSource {
  private _ranges = new Map<number, EventRange>();

  constructor(private _readDates: ReadDates, private _ctx: EventContext) {
    super();
  }

  public getAllRows(): RowList {
    return this._ranges.keys();
  }

  public getNumRows(): number {
    return this._ranges.size;
  }

  /** The span of one event, or undefined when the row is not an event. */
  public getRange(rowId: UIRowId): EventRange | undefined {
    return typeof rowId === "number" ? this._ranges.get(rowId) : undefined;
  }

  /** True when any part of the row's span falls inside the given window. */
  public isInRange(rowId: UIRowId, fromMs: number, toMs: number): boolean {
    return this.getRange(rowId)?.overlaps(fromMs, toMs) ?? false;
  }

  public onAddRows(rows: RowList) {
    const added: UIRowId[] = [];
    for (const rowId of rows) {
      if (this._store(rowId)) { added.push(rowId); }
    }
    if (added.length) { this.trigger("rowChange", "add", added); }
  }

  public onRemoveRows(rows: RowList) {
    const removed: UIRowId[] = [];
    for (const rowId of rows) {
      if (typeof rowId === "number" && this._ranges.delete(rowId)) { removed.push(rowId); }
    }
    if (removed.length) { this.trigger("rowChange", "remove", removed); }
  }

  /**
   * Re-reads the changed rows and reports what it means downstream.
   *
   * A value change can move a row in or out of being an event, so this compares membership before
   * and after and splits the rows into adds, removes and plain updates — the same shape
   * BaseFilteredRowSource produces, so listeners can treat both alike.
   */
  public onUpdateRows(rows: RowList) {
    const added: UIRowId[] = [];
    const removed: UIRowId[] = [];
    const updated: UIRowId[] = [];
    for (const rowId of rows) {
      if (typeof rowId !== "number") { continue; }
      const was = this._ranges.has(rowId);
      const is = this._store(rowId);
      if (is && was) {
        updated.push(rowId);
      } else if (is) {
        added.push(rowId);
      } else if (was) {
        this._ranges.delete(rowId);
        removed.push(rowId);
      }
    }
    if (removed.length) { this.trigger("rowChange", "remove", removed); }
    if (updated.length) { this.trigger("rowChange", "update", updated); }
    if (added.length) { this.trigger("rowChange", "add", added); }
  }

  /** Works out and stores one row's span. Returns false when the row is not an event. */
  private _store(rowId: UIRowId): boolean {
    if (typeof rowId !== "number") { return false; }
    const dates = this._readDates(rowId);
    if (!dates) { return false; }
    this._ranges.set(rowId, new EventRange(dates, this._ctx));
    return true;
  }
}
