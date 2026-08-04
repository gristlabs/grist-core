import { CalendarWrapper } from "app/client/components/CalendarWrapper";
import { RowList, RowListener, RowSource } from "app/client/models/rowset";
import { theme } from "app/client/ui2018/cssVars";
import { getReadableColorsCombo } from "app/client/widgets/ChoiceToken";
import { isDateOnlyType } from "app/common/gristTypes";
import { UIRowId } from "app/plugin/GristAPI";

import type { EventObject, TZDate } from "@toast-ui/calendar";

/*
 * The Grist side of the calendar, from a row to a drawn event:
 *
 *  EventRange / buildEvent: what one row means, its span and the TUI event that shows it.
 *  CalendarSource: which rows are events at all, and when each one happens.
 *  CalendarRenderer: which of them belong on the grid right now.
 *
 * Nothing here knows how the calendar looks; that is CalendarWrapper's job.
 */

const SECONDS_PER_DAY = 24 * 60 * 60;

// The id of the single TUI "calendar" that every event belongs to.
export const CALENDAR_NAME = "standardCalendar";

// Shared by every calendar section on the page, so it is never cleared: clearing it when one
// section goes away would break the others.
let _TZDate: ((date: Date) => TZDate) | null = null;

export function setTZDate(make: (date: Date) => TZDate) {
  _TZDate = make;
}

/**
 * Wraps a Date in TUI's TZDate, which adds the timezone helpers a plain Date lacks. Throws when no
 * calendar has loaded yet, rather than returning a wrong date.
 */
export function tzDate(date: Date): TZDate {
  if (!_TZDate) { throw new Error("Toast UI Calendar is not loaded"); }
  return _TZDate(date);
}

/**
 * The date columns of one row. Kept separate from CalendarRecord so the index can read three
 * columns per row instead of five: title and type only matter once an event is drawn.
 */
export interface CalendarDates {
  startDate: Date;
  endDate: Date | null;
  isAllDay: boolean | undefined;
}

/**
 * The rest of one row: what an event needs on top of its span. Read only when an event is drawn.
 * The dates are not here, so there is only one way to reach them (EventRange).
 */
export interface CalendarRecord {
  id: number;
  title: string | null;
  type: string;
}

/**
 * The span an event occupies, after every timezone correction and workaround. Built straight from
 * a row, so nobody can hold a span that was computed some other way.
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

  // True when any part of this span falls inside [fromMs, toMs], both ends included.
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
 * document timezone, and the styling of the "type" column's choices. Rebuilt whenever the mapping
 * or a column type changes, so callers can reuse it across many rows.
 */
export interface EventContext {
  startType: string;
  endType: string;
  docTz: string;
  choiceOptions: Record<string, any>;
}

/**
 * Turns one flat record into a TUI event. Takes the span rather than working it out, so the drawn
 * event and the index that decides whether it is visible cannot disagree.
 */
export function buildEvent(
  record: CalendarRecord, range: EventRange, ctx: EventContext,
): EventObject {
  const { start, end, isAllDay } = range;

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
    // Always Free; Grist does not track whether a person is busy.
    state: "Free" satisfies NonNullable<EventObject["state"]>,
    backgroundColor,
    color,
    borderColor: backgroundColor,
    dragBackgroundColor: theme.hover.toString(),
    // Base colors, so the selection accent can be undone later (CalendarWrapper._paint).
    raw: { backgroundColor, color },
    customStyle: { fontStyle, fontWeight, textDecoration, textWrap: "auto" },
  } as EventObject;
}

/**
 * Shifts a UTC-based JS Date so it displays correctly for the given column type. `pureType` must be
 * a pure type ("Date" or "DateTime"), not a raw one: a stored DateTime type carries its timezone,
 * as in "DateTime:America/New_York", and would not compare equal.
 */
function adjust(date: Date, pureType: string, docTz: string): Date {
  // `timezone` exists on TZDate but not on plain Date, and we call this with both.
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
 * Converts a calendar date (browser-local TZDate) into the seconds value Grist stores. If the user
 * is in UTC-5 and the doc is in UTC+2, a picked time of 10:00 is stored as 03:00.
 */
export function makeGristDateTime(date: TZDate, pureType: string, docTz: string): number {
  let unixTime = Math.floor(date.valueOf() / 1000);
  // getTimezoneOffset has the opposite sign to what a tz-tagged TZDate returns.
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

function isZeroTime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

function buildTextDecoration(style: Record<string, any>): string {
  const parts: string[] = [];
  if (style.fontUnderline) { parts.push("underline"); }
  if (style.fontStrikethrough) { parts.push("line-through"); }
  return parts.length ? parts.join(" ") : "none";
}

// Reads the mapped date columns of one row. Returns null when the row has no start date.
export type ReadDates = (rowId: number) => CalendarDates | null;

/**
 * Keeps the span of every event, so that deciding what is visible costs a number comparison
 * instead of a re-read. Each row with a start date gets an EventRange, worked out once; rows
 * without one are not events and never reach anything downstream.
 *
 * Rebuild it when the mapping or a mapped column's type changes, since every span becomes stale.
 * `subscribeTo` replays the current rows as adds, so a rebuild needs no separate seeding step.
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

  // The span of one event, or undefined when the row is not an event.
  public getRange(rowId: UIRowId): EventRange | undefined {
    return typeof rowId === "number" ? this._ranges.get(rowId) : undefined;
  }

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
   * A value change can move a row in or out of being an event, so this compares membership before
   * and after, and splits the rows into adds, removes and plain updates. That is the same shape
   * BaseFilteredRowSource produces, so listeners can treat both alike.
   */
  public onUpdateRows(rows: RowList) {
    const added: UIRowId[] = [];
    const removed: UIRowId[] = [];
    const updated: UIRowId[] = [];
    for (const rowId of rows) {
      if (typeof rowId !== "number") { continue; }
      const wasEvent = this._ranges.has(rowId);
      const isEvent = this._store(rowId);
      if (isEvent && wasEvent) {
        updated.push(rowId);
      } else if (isEvent) {
        added.push(rowId);
      } else if (wasEvent) {
        this._ranges.delete(rowId);
        removed.push(rowId);
      }
    }
    if (removed.length) { this.trigger("rowChange", "remove", removed); }
    if (updated.length) { this.trigger("rowChange", "update", updated); }
    if (added.length) { this.trigger("rowChange", "add", added); }
  }

  // Works out and stores one row's span. Returns false when the row is not an event.
  private _store(rowId: UIRowId): boolean {
    if (typeof rowId !== "number") { return false; }
    const dates = this._readDates(rowId);
    if (!dates) { return false; }
    this._ranges.set(rowId, new EventRange(dates, this._ctx));
    return true;
  }
}

// Reads the mapped columns that are not dates: everything an event needs besides its span.
export type ReadRecord = (rowId: number) => CalendarRecord;

// Above this many removals at once, clear the grid and draw it again instead of deleting one by
// one. Deleting costs ~1.6ms per event while drawing a batch is a single call.
const BULK_REMOVE_THRESHOLD = 50;

/**
 * How many events Day and Week draw per day before the rest are left off the grid. Month needs no
 * cap: TUI stacks what fits in a cell and folds the rest into its own "+N more" counter. Day and
 * Week have no equivalent for timed events, and a day of 270 events is both unreadable and slow to
 * draw. The number is closer to what a day can legibly hold than to what is fast.
 */
const MAX_EVENTS_PER_DAY = 20;

/**
 * Draws the rows it is given, and nothing else. It listens to the filtered set of visible rows, so
 * its work is bounded by what fits on the grid rather than by the size of the table. This is the
 * only place an EventObject is made, and none are kept.
 */
export class CalendarRenderer extends RowListener {
  // The rows currently on the grid. A filter change reports its removals and its additions as two
  // separate passes, so a redraw during the first pass cannot see the second; remembering what was
  // drawn lets the next pass compare instead of guess.
  private _drawn = new Set<number>();

  constructor(
    private _cal: CalendarWrapper,
    private _source: CalendarSource,
    private _visible: RowSource,
    private _readRecord: ReadRecord,
    private _ctx: EventContext,
  ) {
    super();
  }

  public onAddRows(rows: RowList) {
    // Skip anything a previous redraw already put on the grid, so the 'add' that follows a bulk
    // removal costs nothing when it brings no news.
    const fresh = [...rows].filter((rowId): rowId is number =>
      typeof rowId === "number" && !this._drawn.has(rowId));
    if (!fresh.length) { return; }
    // With a cap in force a new event can displace one already drawn, or fall behind the cap
    // itself, so what belongs on the grid is a property of the whole day and not of the new row.
    if (this._cal.capsEventsPerDay()) { this._redrawAll(); } else { this._drawRows(fresh); }
  }

  // Updates arrive whenever any cell changes, including columns the calendar does not read, and
  // redrawing costs a TUI state clone per event. Skip the call when the grid would look the same.
  public onUpdateRows(rows: RowList) {
    for (const rowId of rows) {
      const range = this._source.getRange(rowId);
      if (typeof rowId !== "number" || !range) { continue; }
      const event = this._build(rowId, range);
      if (sameEvent(this._cal.getEvent(rowId), event)) { continue; }
      this._cal.updateEvent(rowId, event);
      this._drawn.add(rowId);
    }
  }

  /**
   * Removing one event costs a full TUI state clone and layout pass (Immer `produce` ->
   * `removeFromMatrix` -> `setState`), so the price is per event and not per change: clearing a
   * month of a busy table measured ~1.6ms x 9651 events. Drawing is batched, so past a few dozen
   * removals it is cheaper to throw the grid away and draw the new contents in one go.
   */
  public onRemoveRows(rows: RowList) {
    const rowIds = [...rows].filter((rowId): rowId is number => typeof rowId === "number");
    if (rowIds.length > BULK_REMOVE_THRESHOLD) {
      this._redrawAll();
    } else {
      for (const rowId of rowIds) {
        this._cal.deleteEvent(rowId);
        this._drawn.delete(rowId);
      }
    }
  }

  private _redrawAll() {
    this._cal.clearEvents();
    this._drawn.clear();
    this._drawRows(this._visible.getAllRows());
  }

  private _drawRows(rows: RowList) {
    const { events, hiddenPerDay } = this._selectEvents(rows);
    // One call for the batch, so TUI re-renders once however many events entered the view.
    if (events.length) { this._cal.createEvents(events); }
    for (const event of events) { this._drawn.add(Number(event.id)); }
    this._cal.setHiddenCounts(hiddenPerDay);
  }

  /**
   * The events to draw, with Day and Week capped at MAX_EVENTS_PER_DAY per day. Ordered by start
   * time first, so a capped day keeps its earliest events rather than whichever row ids came
   * first. What was left off is counted per day, so the caller can report it without holding it.
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

/**
 * True when a drawn event already shows what we are about to draw. Colors are compared through
 * `raw`, which keeps the event's own colors before any selection accent (see CalendarWrapper._paint).
 * Reading backgroundColor directly would make a selected event look changed on every update.
 */
function sameEvent(drawn: EventObject, next: EventObject): boolean {
  if (!drawn) { return false; }
  return drawn.title === next.title &&
    toMs(drawn.start) === toMs(next.start) &&
    toMs(drawn.end) === toMs(next.end) &&
    Boolean(drawn.isAllday) === Boolean(next.isAllday) &&
    drawn.raw?.backgroundColor === next.raw?.backgroundColor &&
    drawn.raw?.color === next.raw?.color &&
    drawn.customStyle?.fontWeight === next.customStyle?.fontWeight &&
    drawn.customStyle?.fontStyle === next.customStyle?.fontStyle &&
    drawn.customStyle?.textDecoration === next.customStyle?.textDecoration;
}

// TUI stores dates as TZDate once drawn, but we build them as plain Date; compare instants.
function toMs(date: unknown): number {
  return (date as Date | null)?.valueOf() ?? NaN;
}

// Groups events by the day they start on, in local time, which is what the grid uses.
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
