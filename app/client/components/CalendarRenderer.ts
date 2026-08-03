import {
  buildEvent, CalendarRecord, EventContext, EventRange,
} from "app/client/components/CalendarEvents";
import { CalendarExt } from "app/client/components/CalendarExt";
import { CalendarSource } from "app/client/components/CalendarSource";
import { RowList, RowListener, RowSource } from "app/client/models/rowset";

import type { EventObject } from "@toast-ui/calendar";

/** Reads the mapped columns that are not dates: everything an event needs besides its span. */
export type ReadRecord = (rowId: number) => CalendarRecord;

/**
 * Above this many removals at once, clear the grid and draw it again instead of deleting one by one.
 *
 * Deleting is ~1.6ms per event and drawing a batch is one call, so the crossover sits far below this
 * figure. It is set well above the size of an ordinary edit (a handful of rows leaving the range)
 * and well below a view change on a busy table, so the two paths keep their obvious cases.
 */
const BULK_REMOVE_THRESHOLD = 50;

/**
 * Draws the rows it is given, and nothing else.
 *
 * The last link of the row pipeline. It listens to the filtered set of visible rows, so its work is
 * bounded by what fits on the grid rather than by the size of the table: one edited cell arrives
 * here as one row and leaves as one TUI call, whether the table holds ten rows or two hundred
 * thousand.
 *
 * This is the only place an EventObject is made, and none are kept. TUI holds the drawn events and
 * the index holds the spans, so there is no third copy that could fall behind.
 */
export class CalendarRenderer extends RowListener {
  // Set while a full redraw already drew the new contents, so the 'add' that follows the 'remove'
  // in the same filter change is not drawn a second time. See _redrawAll.
  private _drewEverything = false;

  constructor(
    private _cal: CalendarExt,
    private _source: CalendarSource,
    private _visible: RowSource,
    private _readRecord: ReadRecord,
    private _ctx: EventContext,
  ) {
    super();
  }

  // Both checks should always pass, and neither is worth removing. A row with no span never gets
  // this far, because CalendarSource drops it; and the phantom "new" row is added further down the
  // chain than the point we tap. They are what the pipeline's own types promise, no more.
  public onAddRows(rows: RowList) {
    if (this._drewEverything) { this._drewEverything = false; return; }
    this._draw(rows);
  }

  public onUpdateRows(rows: RowList) {
    for (const rowId of rows) {
      const range = this._source.getRange(rowId);
      if (typeof rowId === "number" && range) { this._cal.updateEvent(rowId, this._build(rowId, range)); }
    }
  }

  /**
   * Takes events off the grid, either one by one or by redrawing the lot.
   *
   * Removing one event costs a full TUI state clone and layout pass (Immer `produce` ->
   * `removeFromMatrix` -> `setState`), so the price is per event and not per change: clearing a
   * month of a busy table measured ~1.6ms x 9651 events = 15s. Drawing, by contrast, is batched, so
   * a whole month goes on in a single call for ~200ms. Past a few hundred removals it is therefore
   * cheaper to throw the grid away and draw the new contents in one go.
   */
  public onRemoveRows(rows: RowList) {
    const rowIds = [...rows].filter((rowId): rowId is number => typeof rowId === "number");
    if (rowIds.length > BULK_REMOVE_THRESHOLD) {
      this._redrawAll();
    } else {
      this._drewEverything = false;
      for (const rowId of rowIds) { this._cal.deleteEvent(rowId); }
    }
  }

  /**
   * Wipes the grid and draws everything that belongs on it now.
   *
   * Safe to call from `onRemoveRows` because FilteredRowSource settles its membership before it
   * emits anything: by the time 'remove' arrives, `_visible` already lists the rows that are about
   * to be announced as 'add'. So this draws them here, and the 'add' that follows is skipped.
   */
  private _redrawAll() {
    this._cal.clearEvents();
    this._draw(this._visible.getAllRows());
    // Only a filter change emits 'remove' and then 'add'. A plain deletion emits 'remove' alone, so
    // the flag would linger and swallow the next unrelated 'add' if it were not cleared there too.
    this._drewEverything = true;
  }

  private _draw(rows: RowList) {
    const events: EventObject[] = [];
    for (const rowId of rows) {
      const range = this._source.getRange(rowId);
      if (typeof rowId === "number" && range) { events.push(this._build(rowId, range)); }
    }
    // One call for the batch, so TUI re-renders once however many events entered the view.
    if (events.length) { this._cal.createEvents(events); }
  }

  private _build(rowId: number, range: EventRange): EventObject {
    return buildEvent(this._readRecord(rowId), range, this._ctx);
  }
}
