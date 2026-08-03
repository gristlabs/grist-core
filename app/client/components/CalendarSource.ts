import { CalendarWrapper } from "app/client/components/CalendarWrapper";
import { RowList, RowListener, RowSource } from "app/client/models/rowset";
import { theme } from "app/client/ui2018/cssVars";
import { getReadableColorsCombo } from "app/client/widgets/ChoiceToken";
import { isDateOnlyType } from "app/common/gristTypes";
import { UIRowId } from "app/plugin/GristAPI";

import type { EventObject, TZDate } from "@toast-ui/calendar";

/*
 * The Grist side of the calendar, from a row to a drawn event.
 *
 * Three steps, in the order the data travels:
 *
 *  1. `EventRange` / `buildEvent` - what one row means: its span, and the TUI event that shows it.
 *  2. `CalendarSource` - the index: which rows are events at all, and when each one happens.
 *  3. `CalendarRenderer` - the drawing: which of them belong on the grid right now.
 *
 * They are together because they are one pipeline over one idea (a row is an event), and splitting
 * them meant three files that could only be read in sequence. Nothing here knows how the calendar
 * looks; that is CalendarWrapper's job.
 */

const SECONDS_PER_DAY = 24 * 60 * 60;

/** The id of the single TUI "calendar" that every event belongs to. */
export const CALENDAR_NAME = "standardCalendar";

// TUI's TZDate constructor. The module that loads Toast UI hands it over through setTZDate; it is
// a load-once cache shared by every calendar section on the page, so it is never cleared — two
// sections share it, and clearing it when one goes away would break the other.
let _TZDate: ((date: Date) => TZDate) | null = null;

/** Called by CalendarWrapper once the Toast UI module has loaded. */
export function setTZDate(make: (date: Date) => TZDate) {
  _TZDate = make;
}

/**
 * Wraps a Date in TUI's TZDate, which adds the timezone helpers a plain Date lacks.
 *
 * Throws when no calendar has loaded yet. Every caller runs after a calendar exists, so this
 * should be unreachable; it throws rather than returning a wrong date so that an ordering mistake
 * shows up as a stack trace.
 */
export function tzDate(date: Date): TZDate {
  if (!_TZDate) { throw new Error("Toast UI Calendar is not loaded"); }
  return _TZDate(date);
}

/**
 * The date columns of one row — everything EventRange needs, and nothing more.
 *
 * Kept separate from CalendarRecord so the index can read three columns per row instead of five:
 * the title and the type only matter once an event is actually drawn.
 *
 * `startDate` is required: a row without one cannot be placed on the grid, and callers drop such
 * rows before building this. That is what lets EventRange be constructed unconditionally.
 */
export interface CalendarDates {
  startDate: Date;
  endDate: Date | null;
  isAllDay: boolean | undefined;
}

/**
 * The rest of one row: what an event needs on top of its span.
 *
 * Read only when an event is really drawn, so a table can be indexed without touching these
 * columns at all. The dates are deliberately not here — they come from EventRange. Two ways to
 * reach the same dates would let the drawn event drift away from the index that decides whether it
 * is visible.
 */
export interface CalendarRecord {
  id: number;
  title: string | null;
  type: string;
}

/**
 * The span an event occupies, after every timezone correction and workaround.
 *
 * Built straight from a row: the corrections are the constructor's job, so nobody can hold a span
 * that was computed some other way. buildEvent takes one of these rather than working the dates out
 * again, which is what keeps the index that decides visibility in step with what actually gets
 * drawn.
 *
 * Ported from the calendar widget (page.js buildCalendarEventObject): the timezone correction, the
 * fix for a range whose end precedes its start, treating date-only columns as all-day, and the
 * workaround for zero-length events at midnight.
 */
export class EventRange {
  public readonly start: Date;
  public readonly end: Date;
  public readonly isAllDay: boolean;

  constructor(record: CalendarDates, ctx: EventContext) {
    const start = adjust(record.startDate, ctx.startType, ctx.docTz);
    let end = record.endDate ? adjust(record.endDate, ctx.endType, ctx.docTz) : start;

    // Normalize invalid ranges so the event is still visible.
    if (end < start) { end = start; }

    let isAllDay = record.isAllDay;
    if (isDateOnlyType(ctx.startType) && isDateOnlyType(ctx.endType)) { isAllDay = true; }
    // Workaround for midnight zero-length events not showing up.
    if (!isAllDay && end.valueOf() === start.valueOf() && isZeroTime(end) && isZeroTime(start)) {
      end = tzDate(end).addHours(1) as unknown as Date;
    }

    this.start = start;
    this.end = end;
    this.isAllDay = Boolean(isAllDay);
  }

  /** True when any part of this span falls inside [fromMs, toMs], both ends included. */
  public overlaps(fromMs: number, toMs: number): boolean {
    const start = this.start.getTime();
    const end = this.end.getTime();
    return (start >= fromMs && start <= toMs) ||
      (end >= fromMs && end <= toMs) ||
      (start < fromMs && end > toMs);
  }
}

/**
 * Everything the translation needs besides the row itself: the types of the mapped columns, the
 * document timezone, the styling of the "type" column's choices, and TUI's TZDate wrapper.
 *
 * Rebuilt whenever the mapping or a column type changes, so callers can hold it and reuse it
 * across many rows instead of resolving it per row.
 *
 * TZDate is not in here: it is the same object for the whole page, so it lives at module level.
 */
export interface EventContext {
  startType: string;
  endType: string;
  docTz: string;
  choiceOptions: Record<string, any>;
}

/**
 * Turns one flat record into a TUI event.
 *
 * Takes the span rather than working it out, so the drawn event and the index that decides whether
 * it is visible can never disagree. Callers that keep spans cached (see CalendarSource) pass the
 * cached one straight in.
 *
 * Ported from the calendar widget (page.js buildCalendarEventObject). What changed: the dates now
 * come from EventRange (see there), colors go through getReadableColorsCombo so a choice with a
 * dark fill still gets readable text (the widget used the raw choice colors), `category` follows
 * isAllday instead of always being "time", and the widget's `clean()` call with two spreads is
 * replaced by plain fields.
 */
export function buildEvent(
  record: CalendarRecord, range: EventRange, ctx: EventContext,
): EventObject {
  const { start, end, isAllDay } = range;

  // Apply colors/styling from the choice options of the "type" column, falling back to defaults.
  // getReadableColorsCombo picks a readable text shade when a choice has a custom fill but no
  // custom text color, so events with a dark fill don't render near-invisible text.
  const style = ctx.choiceOptions[record.type] || {};
  const { bg: backgroundColor, fg: color } = getReadableColorsCombo(
    { fillColor: style.fillColor, textColor: style.textColor },
    { bg: theme.inputReadonlyBorder.toString(), fg: theme.text.toString() },
  );
  const fontWeight = style.fontBold ? "800" : "normal";
  const fontStyle = style.fontItalic ? "italic" : "normal";
  const textDecoration = buildTextDecoration(style);

  return {
    id: String(record.id),
    calendarId: CALENDAR_NAME,
    title: record.title!,
    start,
    end,
    isAllday: isAllDay,
    category: isAllDay ? "allday" : "time",
    // TUI's EventState is "Busy" or "Free". We mark every Grist row as Free, because we do not
    // track whether a person is busy. We take the type from EventObject["state"] instead of
    // writing a plain string, so that a rename in TUI becomes a compile error.
    state: "Free" satisfies NonNullable<EventObject["state"]>,
    backgroundColor,
    color,
    borderColor: backgroundColor,
    dragBackgroundColor: theme.hover.toString(),
    // Remember base colors so the selection accent can be undone later (CalendarWrapper._paint).
    raw: { backgroundColor, color },
    customStyle: { fontStyle, fontWeight, textDecoration, textWrap: "auto" },
  } as EventObject;
}

/**
 * Shifts a UTC-based JS Date so it displays correctly for the given column type.
 *
 * `pureType` must be a pure type ("Date" or "DateTime"), not a raw column type: a stored DateTime
 * type carries its timezone, as in "DateTime:America/New_York", and would not compare equal.
 *
 * Ported from the calendar widget (page.js getAdjustedDate), including the DST reasoning. The only
 * change is that the doc timezone comes from the document rather than a URL parameter.
 */
function adjust(date: Date, pureType: string, docTz: string): Date {
  // The `timezone` property exists on TZDate (TUI's wrapper) but not on plain Date; we still
  // call this with both, so probe the field rather than narrowing the parameter type.
  const dateTz = (date as Date & { timezone?: string }).timezone;
  if (docTz && docTz !== dateTz && pureType === "DateTime") {
    return tzDate(date).tz(docTz) as unknown as Date;
  }
  if (!isDateOnlyType(pureType)) { return date; }
  // Like date.tz('UTC'), but accounts for DST differences.
  const ms = date.valueOf() + (date.getTimezoneOffset() * 60000);
  return new Date(ms);
}

/**
 * Converts a calendar date (browser-local TZDate) into the seconds value Grist stores.
 *
 * Ported from the calendar widget (page.js makeGristDateTime). The widget's worked example: if the
 * user is in UTC-5 and the doc is in UTC+2, a picked time of 10:00 must be stored as 03:00, since
 * the doc reads it 7 hours ahead.
 */
export function makeGristDateTime(date: TZDate, pureType: string, docTz: string): number {
  let unixTime = Math.floor(date.valueOf() / 1000);
  // NOTE: getTimezoneOffset has the opposite sign to what a tz-tagged TZDate returns.
  const localOffsetMin = -date.getTimezoneOffset();
  const docOffsetMin = !docTz ? localOffsetMin : date.tz(docTz).getTimezoneOffset();
  if (isDateOnlyType(pureType)) {
    const secondsSinceEpoch = unixTime + localOffsetMin * 60;
    return Math.floor(secondsSinceEpoch / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  } else {
    unixTime += (localOffsetMin - docOffsetMin) * 60;
    return unixTime;
  }
}

// Ported word for word from the calendar widget (page.js isZeroTime).
function isZeroTime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

function buildTextDecoration(style: Record<string, any>): string {
  const parts: string[] = [];
  if (style.fontUnderline) { parts.push("underline"); }
  if (style.fontStrikethrough) { parts.push("line-through"); }
  return parts.length ? parts.join(" ") : "none";
}

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
 * How many events Day and Week draw per day before the rest are left off the grid.
 *
 * Month needs no such cap: TUI stacks what fits in a cell and folds the rest into its own "+N more"
 * counter. Day and Week have no equivalent for timed events, so without a cap they draw every one,
 * which is both unreadable (a day of 270 events is 270 slivers a pixel wide) and slow: 140 events
 * draw in 64ms where 1912 take about 2s.
 *
 * The number is deliberately near what a day can legibly hold rather than what is fast, since past
 * that point extra events cost time to produce a picture nobody can read.
 */
const MAX_EVENTS_PER_DAY = 20;

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
    private _cal: CalendarWrapper,
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
    // A bulk removal has just drawn the new contents, and this is the matching 'add' of the same
    // filter change, so there is nothing left to draw.
    if (this._drewEverything) { this._drewEverything = false; return; }
    // With a cap in force a new event can displace one already drawn, or fall behind the cap
    // itself, so which events belong on the grid is a property of the whole day rather than of the
    // row that arrived. Month has no cap and can therefore keep drawing just what came in.
    if (this._cal.capsEventsPerDay()) { this._redrawAll(false); } else { this._drawRows(rows); }
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
      this._redrawAll(true);
    } else {
      this._drewEverything = false;
      for (const rowId of rowIds) { this._cal.deleteEvent(rowId); }
    }
  }

  /**
   * Wipes the grid and draws everything that belongs on it now.
   *
   * Safe to call while rows are being announced because FilteredRowSource settles its membership
   * before it emits anything: by the time a change arrives, `_visible` already lists what the grid
   * should end up showing.
   *
   * `expectAdd` says whether an 'add' for the same change is still to come, which is true only of a
   * bulk removal — a filter change emits 'remove' and then 'add'. Set from anywhere else the flag
   * would linger and swallow the next unrelated 'add'.
   */
  private _redrawAll(expectAdd: boolean) {
    this._cal.clearEvents();
    this._drawRows(this._visible.getAllRows());
    this._drewEverything = expectAdd;
  }

  private _drawRows(rows: RowList) {
    const { events, hiddenPerDay } = this._selectEvents(rows);
    // One call for the batch, so TUI re-renders once however many events entered the view.
    if (events.length) { this._cal.createEvents(events); }
    this._cal.setHiddenCounts(hiddenPerDay);
  }

  /**
   * The events to draw, with Day and Week capped at MAX_EVENTS_PER_DAY per day.
   *
   * Ordered by start time first, so a capped day keeps its earliest events rather than whichever
   * row ids happened to come first. The count of what was left off is reported per day, so the
   * caller can say how many are hidden without the grid having to hold them.
   */
  private _selectEvents(rows: RowList): { events: EventObject[]; hiddenPerDay: Map<string, number> } {
    const hiddenPerDay = new Map<string, number>();
    const spans: { rowId: number; range: EventRange }[] = [];
    for (const rowId of rows) {
      const range = this._source.getRange(rowId);
      if (typeof rowId === "number" && range) { spans.push({ rowId, range }); }
    }
    if (!this._cal.capsEventsPerDay()) {
      return { events: spans.map(s => this._build(s.rowId, s.range)), hiddenPerDay };
    }

    spans.sort((a, b) => a.range.start.getTime() - b.range.start.getTime());
    const shownPerDay = new Map<string, number>();
    const events: EventObject[] = [];
    for (const { rowId, range } of spans) {
      const day = dayKey(range.start);
      const shown = shownPerDay.get(day) ?? 0;
      if (shown < MAX_EVENTS_PER_DAY) {
        shownPerDay.set(day, shown + 1);
        events.push(this._build(rowId, range));
      } else {
        hiddenPerDay.set(day, (hiddenPerDay.get(day) ?? 0) + 1);
      }
    }
    return { events, hiddenPerDay };
  }

  private _build(rowId: number, range: EventRange): EventObject {
    return buildEvent(this._readRecord(rowId), range, this._ctx);
  }
}

/** Groups events by the day they start on. Local time, which is the grid's own reckoning. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
