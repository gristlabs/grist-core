import { theme } from "app/client/ui2018/cssVars";
import { getReadableColorsCombo } from "app/client/widgets/ChoiceToken";
import { isDateOnlyType } from "app/common/gristTypes";

import type { EventObject, TZDate } from "@toast-ui/calendar";

const SECONDS_PER_DAY = 24 * 60 * 60;

/** The id of the single TUI "calendar" that every event belongs to. */
export const CALENDAR_NAME = "standardCalendar";

// TUI's TZDate constructor. The module that loads Toast UI hands it over through setTZDate; it is
// a load-once cache shared by every calendar section on the page, so it is never cleared — two
// sections share it, and clearing it when one goes away would break the other.
let _TZDate: ((date: Date) => TZDate) | null = null;

/** Called by CalendarExt once the Toast UI module has loaded. */
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
    // Remember base colors so the selection accent can be undone later (CalendarExt._paint).
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
