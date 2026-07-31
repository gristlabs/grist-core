import { loadToastUICalendar, ToastUICalendarModule } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { theme } from "app/client/ui2018/cssVars";
import { getReadableColorsCombo } from "app/client/widgets/ChoiceToken";
import { isDateLikeType, isDateOnlyType } from "app/common/gristTypes";
import { ColumnsToMap } from "app/plugin/CustomSectionAPI";

import { Disposable, styled } from "grainjs";

import type Calendar from "@toast-ui/calendar";
import type { EventObject, Options, TZDate } from "@toast-ui/calendar";

const t = makeT("CalendarExt");

// TUI does not export the type of its theme object (it hides it behind DeepPartial<ThemeState>),
// so we take it from Options instead. This way a typo in a nested key becomes a compile error.
type CalendarThemeOption = NonNullable<Options["theme"]>;

// The single TUI "calendar" all events belong to.
const CALENDAR_NAME = "standardCalendar";

/** One row of the table, with the mapped columns already read out of it. */
export interface CalendarRecord {
  id: number;
  startDate: Date | null;
  endDate: Date | null;
  isAllDay: boolean | undefined;
  title: string | null;
  type: string;
}

export type Perspective = "day" | "week" | "month";
export const PERSPECTIVES: Perspective[] = ["day", "week", "month"];

type TimeFormat = "12h" | "24h";
type WeekStart = "sun" | "mon";

const HOURS_PER_DAY = 24;

/**
 * What CalendarExt asks Grist to do. The calendar knows only row ids and dates. Everything that
 * needs a document (is this editable, where is the cursor, write this row) goes through here.
 * CalendarView implements it.
 */
export interface CalendarHost extends Disposable {
  /** True when the section can't be edited (readonly doc, or a link target). */
  isReadOnly(): boolean;
  /** The user clicked an event: move the Grist cursor to its row. */
  onSelect(rowId: number): void;
  /** The user double-clicked an event: open its Record Card. */
  onOpen(rowId: number): void;
  /** The user dragged an empty range: create a row, and return its id (or null). */
  onCreate(start: TZDate, end: TZDate, isAllDay: boolean): Promise<number | null>;
  /** The user dragged or resized an event: write the changed fields back. */
  onUpdate(rowId: number, changes: Partial<EventObject>): void;
  /** The user deleted an event. */
  onDelete(rowId: number): void;
  /** The visible range changed, so the host can draw its selection highlight again. */
  onNavigate(): void;
}

/**
 * The Toast UI Calendar, wrapped.
 *
 * This holds what we kept from the old bundled calendar widget (grist-widget repo,
 * calendar/page.js): the TUI theme, drawing events for the visible date range, the selection
 * highlight, navigation, and the timezone helpers. It knows nothing about Grist. It only reports
 * row ids back through CalendarHost.
 *
 * The Grist side (column mapping, reading rows, writing user actions, cursor linking) lives in
 * CalendarView, which owns an instance of this class.
 *
 * We did not keep: TUI's form and detail popups with their key handling, the i18next translation
 * code, and a `mouseup` fix for stuck drags that used TUI v1 internals that v2 removed.
 */
export class CalendarExt extends Disposable {
  /**
   * Loads the TUI module (imports.js keeps one copy) and builds the calendar inside `container`.
   * Returns null if the host was disposed while the module was still loading.
   *
   * It is called `load`, not `create`, because grainjs Disposable already has a static `create`
   * with a different signature, and a subclass is not allowed to replace it.
   */
  public static async load(
    host: CalendarHost, container: HTMLElement, titleDom: HTMLElement, perspective: Perspective,
  ): Promise<CalendarExt | null> {
    const { Calendar: Ctor, TZDate: TZDateCtor } = await loadToastUICalendar();
    if (host.isDisposed()) { return null; }
    return new CalendarExt(Ctor, TZDateCtor, container, titleDom, host, perspective);
  }

  private _calendar: Calendar;

  // Every event, by Grist rowId. We only send TUI the ones inside the visible date range.
  // CalendarView replaces this whole map through setEvents when the rows change.
  private _events = new Map<number, EventObject>();
  private _visibleEventIds = new Set<number>();

  // Our own labels for the drag selection, one per selected column. We keep and reuse the nodes
  // between frames. They live on document.body, and _syncSelectionOverlay keeps them in place.
  private _selectionLabels: HTMLElement[] = [];

  // Hour-label format and grid start day follow the browser locale.
  private _timeFormat: TimeFormat = getLocaleTimeFormat();
  private _weekStart: WeekStart = getLocaleWeekStart();
  // The last all-day-only value we sent to TUI, so we only call setOptions when it really changes.
  private _appliedAllDayOnly: boolean | null = null;

  private constructor(
    Ctor: ToastUICalendarModule["Calendar"],
    private _tzDateCtor: ToastUICalendarModule["TZDate"],
    private _container: HTMLElement,
    private _titleDom: HTMLElement,
    private _host: CalendarHost,
    perspective: Perspective,
  ) {
    super();
    const startDayOfWeek = weekStartToIndex(this._weekStart);
    this._calendar = new Ctor(this._container, {
      week: { taskView: false, startDayOfWeek },
      month: { startDayOfWeek },
      usageStatistics: false,   // never phone home to Google Analytics
      defaultView: perspective,
      isReadOnly: this._host.isReadOnly(),
      theme: this._calendarTheme(),
      useFormPopup: false,      // we never use TUI's create/edit form; see the selectDateTime handler
      useDetailPopup: false,    // we open Grist's Record Card on double-click instead
      // Double-click an empty cell to create an event. With useFormPopup off, TUI emits
      // selectDateTime directly (no popup): we add the Grist row for the dragged range and open
      // Grist's Record Card on it. Double-click an existing event also opens the Record Card.
      gridSelection: { enableDblClick: true, enableClick: false },
      template: this._timeTemplates(),
      calendars: [{
        id: CALENDAR_NAME,
        // Never shown: we use a single calendar, and TUI's popups (which would display this) are
        // both off. TUI requires the field, so it stays untranslated.
        name: CALENDAR_NAME,
        backgroundColor: theme.inputReadonlyBorder.toString(),
        borderColor: theme.inputReadonlyBorder.toString(),
      }],
    });
    this._wireEvents();
    this.onDispose(() => {
      this._calendar.destroy();
      this._clearSelectionOverlay();
    });
  }

  /** Wraps a Date in TUI's TZDate, which adds the timezone helpers plain Date lacks. */
  public tzDate(date: Date): TZDate {
    return new this._tzDateCtor(date) as unknown as TZDate;
  }

  public getViewName(): string { return this._calendar.getViewName(); }

  public getDate(): TZDate { return this._calendar.getDate(); }

  public setDate(date: TZDate) { this._calendar.setDate(date); }

  public render() { this._calendar.render(); }

  public setTheme() { this._calendar.setTheme(this._calendarTheme()); }

  public setReadOnly(isReadOnly: boolean) { this._calendar.setOptions({ isReadOnly }); }

  public changeView(view: Perspective) {
    this._calendar.changeView(view);
    this.updateUIAfterNavigation();
  }

  // Ported from the calendar widget, which had three almost equal methods (calendarPrevious,
  // calendarNext, calendarToday). Each one called the matching TUI method and then redrew the UI.
  // They are one method here, because TUI's prev/next/today take no arguments and differ by name.
  public go(method: "prev" | "next" | "today") {
    this._calendar[method]();
    this.updateUIAfterNavigation();
  }

  public updateUIAfterNavigation() {
    this.renderVisibleEvents();
    this.updateTitle();
    this._host.onNavigate();
  }

  // When the mapped columns have no time-of-day, hide the Day/Week hour grid (eventView: ['allday'])
  // so timeless rows read as a task list instead of bars above an empty 24-hour grid.
  //
  // New: the widget always showed the hour grid.
  public setAllDayOnly(allDayOnly: boolean) {
    if (allDayOnly === this._appliedAllDayOnly) { return; }
    this._appliedAllDayOnly = allDayOnly;
    this._calendar.setOptions({ week: { eventView: allDayOnly ? ["allday"] : true } });
  }

  /**
   * Turns one flat record into a TUI event.
   *
   * Ported from the calendar widget (page.js buildCalendarEventObject): adjusting the dates, fixing
   * a range where the end is before the start, treating Date columns as all-day, and the fix for
   * zero-length events at midnight. What changed: colors go through getReadableColorsCombo, so a
   * choice with a dark fill still gets readable text (the widget used the raw choice colors),
   * `category` now follows isAllday instead of always being "time", and the widget's `clean()` call
   * with two spreads is replaced by plain fields.
   */
  public buildEvent(
    record: CalendarRecord, startType: string, endType: string, choiceOptions: Record<string, any>,
    docTz: string,
  ): EventObject {
    const start = this.getAdjustedDate(record.startDate!, startType, docTz);
    let end = record.endDate ? this.getAdjustedDate(record.endDate, endType, docTz) : start;

    // Normalize invalid ranges so the event is still visible.
    if (end < start) { end = start; }

    let isAllday = record.isAllDay;
    if (isDateOnlyType(startType) && isDateOnlyType(endType)) { isAllday = true; }
    // Workaround for midnight zero-length events not showing up.
    if (!isAllday && end.valueOf() === start.valueOf() && isZeroTime(end) && isZeroTime(start)) {
      end = this.tzDate(end).addHours(1) as unknown as Date;
    }

    // Apply colors/styling from the choice options of the "type" column, falling back to defaults.
    // getReadableColorsCombo picks a readable text shade when a choice has a custom fill but no
    // custom text color, so events with a dark fill don't render near-invisible text.
    const style = choiceOptions[record.type] || {};
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
      isAllday,
      category: isAllday ? "allday" : "time",
      // TUI's EventState is "Busy" or "Free". We mark every Grist row as Free, because we do not
      // track whether a person is busy. We take the type from EventObject["state"] instead of
      // writing a plain string, so that a rename in TUI becomes a compile error.
      state: "Free" satisfies NonNullable<EventObject["state"]>,
      backgroundColor,
      color,
      borderColor: backgroundColor,
      dragBackgroundColor: theme.hover.toString(),
      // Remember base colors so setHighlight can restore them after a selection.
      raw: { backgroundColor, color },
      customStyle: { fontStyle, fontWeight, textDecoration, textWrap: "auto" },
    } as EventObject;
  }

  /**
   * Replaces the full set of events, then draws the ones in view. Call this after the rows or the
   * column mapping change.
   */
  public setEvents(events: Map<number, EventObject>) {
    this._events = events;
    this.renderVisibleEvents();
  }

  /**
   * Adds or updates the events that fall in the visible range, and removes the ones that scrolled
   * out of it. Uses the set given by the last setEvents call.
   *
   * Ported from the calendar widget (page.js renderVisibleEvents). Two changes: we add events in
   * one batched createEvents call instead of one call each, and we track what is on screen with
   * _visibleEventIds instead of asking TUI (getEvent) about every event. The widget's
   * `setHours(23, 99, 99, 999)` (the minutes and seconds are out of range) becomes 23:59:59.999,
   * and we apply it to a copy, because TUI may return a reference to its own range end.
   */
  public renderVisibleEvents() {
    const cal = this._calendar;
    const rangeStart = cal.getDateRangeStart().getTime();
    // Copy the date first, because setHours changes it in place. TUI may give us its own range-end
    // object, so changing it would move the visible window forward a bit on every render.
    const rangeEndDate = (cal.getDateRangeEnd()).toDate();
    rangeEndDate.setHours(23, 59, 59, 999);
    const rangeEnd = rangeEndDate.getTime();

    const nowVisible = new Set<number>();
    const toCreate: EventObject[] = [];
    for (const [rowId, event] of this._events) {
      const startMs = (event.start as TZDate).getTime();
      const endMs = (event.end as TZDate).getTime();
      const inRange = (startMs >= rangeStart && startMs <= rangeEnd) ||
        (endMs >= rangeStart && endMs <= rangeEnd) ||
        (startMs < rangeStart && endMs > rangeEnd);
      if (!inRange) { continue; }
      if (this._visibleEventIds.has(rowId)) {
        cal.updateEvent(String(rowId), CALENDAR_NAME, event);
      } else {
        toCreate.push(event);
      }
      nowVisible.add(rowId);
    }
    if (toCreate.length) { cal.createEvents(toCreate); }
    for (const rowId of this._visibleEventIds) {
      if (!nowVisible.has(rowId)) { cal.deleteEvent(String(rowId), CALENDAR_NAME); }
    }
    this._visibleEventIds = nowVisible;
  }

  // Highlights (or un-highlights) an event with the primary color. The accent is normally the left
  // border, but a single-day month event has none (dot or filled bar), so there we tint the fill.
  // Passing the full color set in one updateEvent is what makes TUI repaint; a lone change does not.
  //
  // Ported from the calendar widget (page.js _highlightEvent + _clearHighlightEvent), merged into
  // one method with a `selected` flag since the two bodies only differed in which color they wrote.
  // We also restore `color` (the text shade), which the widget never did, so an event keeps readable
  // text after being deselected.
  public setHighlight(rowId: number, selected: boolean) {
    const event = this._getEvent(rowId);
    if (!event) { return; }
    const base = event.raw?.backgroundColor ?? theme.inputReadonlyBorder.toString();
    const baseColor = event.raw?.color ?? theme.text.toString();
    const accent = theme.controlPrimaryBg.toString();
    // Which property carries the accent: the fill (backgroundColor) for a single-day month event,
    // else the left border. Start from the base for both so the previous highlight is cleared.
    const useFill = this._isSingleDayInMonthView(event);
    this._calendar.updateEvent(String(rowId), CALENDAR_NAME, {
      borderColor: selected && !useFill ? accent : base,
      backgroundColor: selected && useFill ? accent : base,
      color: baseColor,
    });
  }

  /**
   * Shifts a UTC-based JS Date so it displays correctly for the given column type.
   *
   * Ported from the calendar widget (page.js getAdjustedDate), including the DST reasoning. The
   * only change is that the doc timezone is passed in rather than read from a URL parameter.
   */
  public getAdjustedDate(date: Date, colType: string, docTz: string): Date {
    // The `timezone` property exists on TZDate (TUI's wrapper) but not on plain Date; we still
    // call this with both, so probe the field rather than narrowing the parameter type.
    const dateTz = (date as Date & { timezone?: string }).timezone;
    if (docTz && docTz !== dateTz && isDateTime(colType)) {
      return this.tzDate(date).tz(docTz) as unknown as Date;
    }
    if (!isDateOnlyType(colType)) { return date; }
    // Like date.tz('UTC'), but accounts for DST differences.
    const ms = date.valueOf() + (date.getTimezoneOffset() * 60000);
    return new Date(ms);
  }

  /**
   * Converts a calendar date (browser-local TZDate) into the seconds value Grist stores.
   *
   * Ported from the calendar widget (page.js makeGristDateTime). The widget's worked example: if
   * the user is in UTC-5 and the doc is in UTC+2, a picked time of 10:00 must be stored as 03:00,
   * since the doc reads it 7 hours ahead.
   */
  public makeGristDateTime(date: TZDate, colType: string, docTz: string): number {
    let unixTime = Math.floor(date.valueOf() / 1000);
    // NOTE: getTimezoneOffset has the opposite sign to what a tz-tagged TZDate returns.
    const localOffsetMin = -date.getTimezoneOffset();
    const docOffsetMin = !docTz ? localOffsetMin : date.tz(docTz).getTimezoneOffset();
    if (isDateOnlyType(colType)) {
      const secondsSinceEpoch = unixTime + localOffsetMin * 60;
      return Math.floor(secondsSinceEpoch / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    } else {
      unixTime += (localOffsetMin - docOffsetMin) * 60;
      return unixTime;
    }
  }

  // Title shown in the toolbar above the calendar grid.
  // - day view: a full date (e.g. "Wed, 9 Aug 2023").
  // - week view: the visible date range (e.g. "6 - 12 Aug 2023", or "30 Jul - 5 Aug 2023" when
  //   the week straddles a month boundary).
  // - month view: month + year.
  // TUI doesn't expose its own header text, but it does expose getDate / getDateRange* which give
  // us enough to derive these formats consistently.
  //
  // New. The widget's getMonthName() always showed "month year" regardless of perspective, so its
  // day and week views were both labelled e.g. "August 2023".
  public updateTitle() {
    const cal = this._calendar;
    const view = cal.getViewName();
    const current = cal.getDate().toDate();
    let title: string;
    if (view === "day") {
      title = current.toLocaleDateString(undefined, {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
      });
    } else if (view === "week") {
      const start = cal.getDateRangeStart().toDate();
      const end = cal.getDateRangeEnd().toDate();
      const sameYear = start.getFullYear() === end.getFullYear();
      const sameMonth = sameYear && start.getMonth() === end.getMonth();
      const startFmt: Intl.DateTimeFormatOptions = sameMonth ?
        { day: "numeric" } :
        (sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
      const endFmt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
      title = `${start.toLocaleDateString(undefined, startFmt)} - ${end.toLocaleDateString(undefined, endFmt)}`;
    } else {
      title = current.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    this._titleDom.textContent = title;
  }

  // Partly ported. The clickEvent / beforeUpdateEvent / beforeDeleteEvent handlers and the
  // mousedown clearGridSelections fix come from the calendar widget. The dblclick handler is
  // rewritten: the widget listened on `document` and used TUI's internal getEventModel, while we
  // listen on our own container and read data-event-id. The selectDateTime path that creates rows,
  // and the selection overlay, are both new. The widget created events with TUI's form popup,
  // which we turned off.
  private _wireEvents() {
    const cal = this._calendar;

    cal.on("clickEvent", ({ event }) => {
      const rowId = Number(event.id);
      if (!rowId || Number.isNaN(rowId)) { return; }
      this._host.onSelect(rowId);
    });

    // Double-click opens the Record Card. TUI doesn't emit a double-click event for an event item,
    // and a native double-click only produces a single TUI clickEvent, so we can't synthesize one
    // from two clickEvents. Instead we listen for the native DOM dblclick, which does reach the
    // grid, and resolve the event from the clicked element's data-event-id.
    this._container.addEventListener("dblclick", (ev) => {
      const eventEl = (ev.target as HTMLElement | null)?.closest("[data-event-id]");
      const rowId = eventEl && Number(eventEl.getAttribute("data-event-id"));
      if (!rowId || Number.isNaN(rowId)) { return; }
      // Double-click landed on an event, not an empty cell: open the Record Card for its row.
      this._host.onSelect(rowId);
      this._host.onOpen(rowId);
    });

    // Drag on empty grid space to create: add the Grist row for the dragged range, then open
    // Grist's Record Card on it (the same editor double-clicking an event opens) so the user fills
    // in the rest. Only the create path opens the card; drag/resize of an existing event doesn't.
    // With the form popup off, TUI fires `selectDateTime` (not `beforeCreateEvent`, which only comes
    // from that popup's Save button) when a grid drag completes; it carries the dragged start/end
    // and all-day flag, which is all we need to seed the new row.
    cal.on("selectDateTime", async ({ start, end, isAllday }) => {
      // selectDateTime hands back plain Dates; makeGristDateTime needs a TZDate (it calls .tz()),
      // so wrap them the same way getAdjustedDate does.
      const rowId = await this._host.onCreate(this.tzDate(start), this.tzDate(end), isAllday);
      // We waited for AddRecord, so the section may be disposed (and `cal` destroyed) by now.
      // Stop here before we touch the calendar, so we don't call into a store that is already gone.
      if (this.isDisposed()) { return; }
      cal.clearGridSelections();
      if (rowId) { this._host.onOpen(rowId); }
    });
    cal.on("beforeUpdateEvent", ({ event, changes }) =>
      this._host.onUpdate(Number(event.id), changes));
    cal.on("beforeDeleteEvent", event => this._host.onDelete(Number(event.id)));

    // Clear leftover grid selections, mirroring the upstream workaround for nhn/tui.calendar#1300.
    // The old widget also called v1's `cancelDrag()` for a bug where a too-fast mouseup left a drag
    // stuck. TUI v2 removed that method and exposes no drag state at all, so there is nothing to
    // call; this mousedown handler is the whole workaround now. If a stuck drag ever shows up
    // (most likely on touch), it needs reporting upstream rather than a reach into TUI's internals.
    this._container.addEventListener("mousedown", () => cal.clearGridSelections());

    // Redraw our drag-selection overlay whenever the grid changes. The drag guide label is the only
    // time label that TUI builds by itself (as plain 24-hour text, "14:00 - 16:30"), and it offers
    // no template for it. Preact draws that label again on every frame of the drag, so editing its
    // text does not work: Preact would just overwrite it. Instead we hide the label
    // (see cssCalendarContainer) and draw our own here. We also watch characterData, so we
    // react when only the label text changes while the drag grows.
    const observer = new MutationObserver(() => this._maybeSyncSelectionOverlay());
    // childList+subtree catches the selection box appearing/disappearing; characterData catches the
    // label's raw time changing in place as the drag extends (a text-only update wouldn't fire the
    // other two). All three keep _syncSelectionOverlay in step with TUI's own render.
    observer.observe(this._container, { childList: true, subtree: true, characterData: true });
    // Scrolling the time grid moves TUI's selection box without mutating the DOM, so the mutation
    // mutation observer would not fire, and our overlay would drift away from the box.
    // Re-sync on scroll too (capture phase, since the scroll happens on an inner grid element, not
    // on the container itself).
    const onScroll = () => this._maybeSyncSelectionOverlay();
    this._container.addEventListener("scroll", onScroll, true);
    this.onDispose(() => {
      observer.disconnect();
      this._container.removeEventListener("scroll", onScroll, true);
    });
  }

  private _getEvent(rowId: number) {
    return this._calendar.getEvent(String(rowId), CALENDAR_NAME);
  }

  // TUI theme, expressed in terms of Grist theme CSS variables so it follows light/dark mode.
  //
  // Ported from the calendar widget (page.js _calendarTheme), minus the keys it set that we don't
  // need (panelResizer, the nowIndicator past/bullet/today trio, month dayName borderLeft). The
  // widget wrote raw "var(--grist-theme-*)" strings; we use the typed `theme` object instead, so a
  // renamed variable is a compile error rather than a silently unstyled calendar.
  private _calendarTheme(): CalendarThemeOption {
    const border = `1px solid ${theme.tableBodyBorder}`;
    const textColor = theme.text.toString();
    return {
      common: {
        backgroundColor: theme.mainPanelBg.toString(),
        border,
        holiday: { color: textColor },
        saturday: { color: textColor },
        dayName: { color: textColor },
        today: { color: textColor },
        gridSelection: {
          backgroundColor: theme.selection.toString(),
          border: `1px solid ${theme.selection}`,
        },
      },
      week: {
        dayName: { borderTop: border, borderBottom: border },
        timeGrid: { borderRight: border },
        timeGridLeft: { borderRight: border },
        dayGrid: { borderRight: border },
        dayGridLeft: { borderRight: border },
        timeGridHourLine: { borderBottom: border },
        nowIndicatorLabel: { color: theme.accentText.toString() },
        pastTime: { color: textColor },
        futureTime: { color: textColor },
        today: { color: textColor, backgroundColor: "inherit" },
      },
      month: {
        dayName: { backgroundColor: "inherit" },
        dayExceptThisMonth: { color: textColor },
        holidayExceptThisMonth: { color: textColor },
      },
    };
  }

  // Hour-axis and now-indicator templates, in the locale's 12h/24h format. TUI's axis and
  // now-indicator default to different styles ("03 pm" vs "15:44"); format both with one helper so
  // they agree. The drag-selection label can't be templated, so it's hidden via CSS and redrawn as
  // an overlay in _syncSelectionOverlay to match.
  //
  // New. The widget templated a different set (event titles, popup buttons, day names) and forced
  // 24-hour time by subclassing tui.TimePicker in its index.html; it never touched these two.
  private _timeTemplates(): NonNullable<Options["template"]> {
    return {
      timegridDisplayPrimaryTime: ({ time }) => formatHourMinute(time, this._timeFormat),
      timegridNowIndicatorLabel: ({ time }) => formatHourMinute(time, this._timeFormat),
    };
  }

  // True when this event occupies a single day in month view. Such events render as a dot (timed) or
  // a filled bar (all-day), neither of which has a border for setHighlight to accent, so it tints
  // the fill instead. Multi-day month bars (which do have a border) and day/week views are excluded.
  //
  // Ported from the calendar widget (page.js _isMultidayInMonthViewEvent). Renamed: the widget's
  // name said "multiday" but the body returned true for *single*-day events (it negated
  // isEventMultiDay), so the name contradicted the behavior. Same logic, honest name.
  private _isSingleDayInMonthView(event: EventObject): boolean {
    if (this._calendar.getViewName() !== "month") { return false; }
    const start = (event.start as TZDate).toDate();
    const end = (event.end as TZDate).toDate();
    return start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
  }

  // Drag-selection overlay: new, no widget equivalent.
  //
  // The widget left TUI's drag guide label alone (its screen.css only recolored it), so it always
  // showed raw 24-hour text. We format hour labels to the browser locale, and this label is the one
  // TUI builds itself with no template hook, so it gets hidden and redrawn here to match the rest of
  // the grid.

  // Fast gate for the hot callers (mutation observer + scroll): skip the full overlay sync when
  // there's no live selection and no lingering overlay to clean up.
  private _maybeSyncSelectionOverlay() {
    const hasSelection = Boolean(this._container.querySelector(".toastui-calendar-grid-selection"));
    if (!hasSelection && this._selectionLabels.length === 0) { return; }
    this._syncSelectionOverlay();
  }

  // Draws our own guide labels on top of TUI's hidden ones while the user drags.
  //
  // TUI makes one selection box (`.toastui-calendar-grid-selection`) per selected column. Each box
  // holds a `.toastui-calendar-grid-selection-label` with plain text like "HH:MM - HH:MM", or just
  // "HH:MM" on the later columns of a drag across several days. We keep a small pool of label nodes
  // on document.body, put each one over its box, and write the time in the user's local format.
  //
  // This is safe to call as often as we like: it only reads positions and writes text and styles,
  // and it reuses the nodes it already made. If the selection gets smaller or goes away, the extra
  // nodes are removed, so nothing is left behind.
  private _syncSelectionOverlay() {
    // We measure the box, not the label. Once the label is hidden its size becomes zero
    // (see cssCalendarContainer), so it cannot tell us where to draw. The label sits in the top-left
    // corner of the box, which is where we put our own label too.
    const boxes = this._container.querySelectorAll(".toastui-calendar-grid-selection");
    // `used` counts the labels we really placed this time. We skip any box whose text we don't
    // recognise, without leaving a gap, so the splice call removes exactly the extra nodes.
    let used = 0;
    for (const box of boxes) {
      const label = box.querySelector(".toastui-calendar-grid-selection-label");
      const text = label && formatSelectionLabel(label.textContent || "", this._timeFormat);
      if (!text) { continue; }
      const rect = box.getBoundingClientRect();
      const overlay = this._selectionLabels[used] ||
        (this._selectionLabels[used] = document.body.appendChild(cssSelectionLabel()));
      overlay.textContent = text;
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      used++;
    }
    // Fewer overlays than last frame (selection shrank or cleared): drop the extra nodes.
    if (this._selectionLabels.length > used) {
      this._selectionLabels.splice(used).forEach(el => el.remove());
    }
  }

  private _clearSelectionOverlay() {
    this._selectionLabels.forEach(el => el.remove());
    this._selectionLabels = [];
  }
}

const SECONDS_PER_DAY = 24 * 60 * 60;

function isDateTime(colType: string): boolean { return isDateLikeType(colType) && !isDateOnlyType(colType); }

// The columns the user has to map, as shown in the creator panel.
//
// Ported from the calendar widget (page.js getGristOptions). The five `name` keys must stay exactly
// as the widget had them, because documents saved with that widget refer to them by name. The
// titles and descriptions only appear in the panel, so we word those ourselves.
export function getCalendarColumns(): ColumnsToMap {
  return [
    {
      name: "startDate",
      title: t("Start Date"),
      optional: false,
      type: "Date,DateTime",
      description: t("When the event starts."),
      allowMultiple: false,
      strictType: true,
    },
    {
      name: "endDate",
      title: t("End Date"),
      optional: true,
      type: "Date,DateTime",
      description: t("When the event ends. If empty, the event lasts as long as its start."),
      allowMultiple: false,
      strictType: true,
    },
    {
      name: "isAllDay",
      title: t("Is All Day"),
      optional: true,
      type: "Bool",
      description: t("Whether the event lasts all day."),
      strictType: true,
    },
    {
      name: "title",
      title: t("Title"),
      optional: false,
      type: "Text",
      description: t("The label shown on the event."),
      allowMultiple: false,
    },
    {
      name: "type",
      title: t("Type"),
      optional: true,
      type: "Choice,ChoiceList",
      description: t("Groups events by category. Each choice uses its own color and style."),
      allowMultiple: false,
    },
  ];
}

function buildTextDecoration(style: Record<string, any>): string {
  const parts: string[] = [];
  if (style.fontUnderline) { parts.push("underline"); }
  if (style.fontStrikethrough) { parts.push("line-through"); }
  return parts.length ? parts.join(" ") : "none";
}

// Ported word for word from the calendar widget (page.js isZeroTime).
function isZeroTime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

// Hour labels for the axis, now-indicator, and drag-selection overlay, in 12h ("3:00 pm") or 24h
// ("15:00") style. The argument is a TUI TZDate, which exposes getHours()/getMinutes()
// like a Date (the same accessors TUI's own format tokens use), so reading local wall-clock time
// here is correct.
function formatHourMinute(
  time: { getHours(): number; getMinutes(): number },
  format: TimeFormat,
): string {
  // TUI labels the end of the last grid row as "24:00" (see formatSelectionLabel), so getHours()
  // can be 24 here; treat it as midnight rather than letting 24 % 12 fall through to noon.
  const hours = time.getHours() % HOURS_PER_DAY;
  const mm = String(time.getMinutes()).padStart(2, "0");
  if (format === "24h") {
    return `${String(hours).padStart(2, "0")}:${mm}`;
  }
  const period = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${mm} ${period}`;
}

// Converts the raw text of a TUI drag-selection guide label into the same hour style used everywhere
// else on the grid. The raw text is "HH:MM - HH:MM" (a range) or a bare "HH:MM" (the non-starting
// columns of a multi-column drag). Returns null for anything that isn't one of those shapes, so the
// overlay simply skips it rather than showing garbage. Reuses formatHourMinute by wrapping each
// side's hours/minutes so it reads like a time.
function formatSelectionLabel(text: string, format: TimeFormat): string | null {
  const at = (h: string, m: string) =>
    formatHourMinute({ getHours: () => Number(h), getMinutes: () => Number(m) }, format);
  const range = /^(\d{1,2}):(\d{2}) - (\d{1,2}):(\d{2})$/.exec(text);
  if (range) { return `${at(range[1], range[2])} - ${at(range[3], range[4])}`; }
  const single = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (single) { return at(single[1], single[2]); }
  return null;
}

// TUI's startDayOfWeek index: 0=Sun..6=Sat. We only distinguish Sunday/Monday.
function weekStartToIndex(start: WeekStart): number {
  return start === "mon" ? 1 : 0;
}

// The week start: Monday if the browser locale starts its week on Monday, otherwise Sunday.
// (Intl: 1=Mon..7=Sun; a locale firstDay of 7 means Sunday.)
function getLocaleWeekStart(): WeekStart {
  try {
    const locale = new Intl.Locale(navigator.language || "en");
    const weekInfo = (locale as any).getWeekInfo?.() ?? (locale as any).weekInfo;
    if (weekInfo?.firstDay !== undefined) {
      return weekInfo.firstDay === 1 ? "mon" : "sun";
    }
  } catch (e) {
    // Intl.Locale week info not supported by this browser.
  }
  return "sun";
}

// The time format: 24h if the browser locale formats an afternoon time without an am/pm marker,
// otherwise 12h.
function getLocaleTimeFormat(): TimeFormat {
  try {
    const parts = new Intl.DateTimeFormat(navigator.language || undefined, { hour: "numeric" })
      .formatToParts(new Date(2020, 0, 1, 13, 0));
    const hasDayPeriod = parts.some(p => p.type === "dayPeriod");
    return hasDayPeriod ? "12h" : "24h";
  } catch (e) {
    // Intl.DateTimeFormat unavailable or threw; fall back to 12h.
  }
  return "12h";
}

// The drag guide label is the only time label TUI builds by itself (plain 24-hour text, like
// "08:00 - 11:00"), and it gives us no template for it. So we hide it here and draw our own label in
// the local time format instead (see _syncSelectionOverlay). Editing TUI's text node does not work,
// because Preact draws the label again on every frame of the drag.
//
// TUI's own rule for this label uses three classes
// (".toastui-calendar-column .toastui-calendar-grid-selection .toastui-calendar-grid-selection-label")
// and also sets the label color inline. So we repeat the same three classes, to make our rule at
// least as strong, and hide the label with `visibility`. An inline color cannot undo `visibility`,
// and the label keeps its size, which we need in order to find where to draw our own label.
export const cssCalendarContainer = styled("div", `
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  & .toastui-calendar-column .toastui-calendar-grid-selection .toastui-calendar-grid-selection-label {
    visibility: hidden;
  }
  & .toastui-calendar-day-names.toastui-calendar-month {
    padding-left: 0;
    padding-right: 0;
  }
  & .toastui-calendar-day-name-item:not(:first-child) {
    border-left: 1px solid ${theme.tableBodyBorder};
  }
  & .toastui-calendar-grid-cell-date .toastui-calendar-weekday-grid-date.toastui-calendar-weekday-grid-date-decorator {
    background-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
  }
`);

// Our own drag guide label, drawn on top of TUI's hidden one (see cssCalendarContainer). There is
// one per selected column. It uses `position: fixed` with the box's own screen position, so we do
// not have to work out any parent offsets. We place it again on every grid change and on scroll
// (see _wireEvents), so it follows the box. It lives on document.body, outside the container that
// Preact manages, so Preact never removes it. `pointer-events: none` keeps it out of the drag.
const cssSelectionLabel = styled("div", `
  position: fixed;
  z-index: 10;
  pointer-events: none;
  padding: 0 3px;
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
  color: ${theme.accentText};
`);
