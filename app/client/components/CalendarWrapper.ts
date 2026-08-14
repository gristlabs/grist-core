import { CALENDAR_NAME, CalendarDate, setTZDate } from "app/client/components/CalendarSource";
import { loadToastUICalendar, ToastUICalendarModule } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { theme } from "app/client/ui2018/cssVars";
import { ColumnsToMap } from "app/plugin/CustomSectionAPI";

import { Disposable, makeTestId, styled } from "grainjs";

import type Calendar from "@toast-ui/calendar";
import type { EventObject, Options, TZDate } from "@toast-ui/calendar";

const t = makeT("CalendarWrapper");
// Same prefix CalendarView uses, so tests reach the whole widget through one namespace.
const testId = makeTestId("test-calendar-");

export type Perspective = "day" | "week" | "month";
export const PERSPECTIVES: Perspective[] = ["day", "week", "month"];

/**
 * What CalendarWrapper asks Grist to do. The calendar knows only row ids and dates. Everything that
 * needs a document (is this editable, where is the cursor, write this row) goes through here.
 * CalendarView implements it.
 */
export interface CalendarHost extends Disposable {
  // True when the section can't be edited (readonly doc, or a link target).
  isReadOnly(): boolean;
  onSelect(rowId: number): void;
  // Double-click on an event: open its Record Card.
  onOpen(rowId: number): void;
  // Drag over an empty range: create a row, and return its id (or null).
  onCreate(start: TZDate, end: TZDate, isAllDay: boolean): Promise<number | null>;
  // Drag or resize of an event: write the changed fields back.
  onUpdate(rowId: number, changes: Partial<EventObject>): void;
  onDelete(rowId: number): void;
  // The grid now shows a different date range, so the host can draw what belongs in it.
  onNavigate(): void;
}

/**
 * The Toast UI Calendar, wrapped. Holds the TUI theme, the selection accent, navigation and the
 * timezone helpers, all carried over from the old bundled calendar widget (grist-widget repo,
 * calendar/page.js). It knows nothing about Grist and only reports row ids back through
 * CalendarHost.
 *
 * It draws what it is told to draw and never decides what belongs on the grid; that is worked out
 * on the Grist side, where the dates live (see CalendarRenderer). Column mapping, reading rows,
 * writing user actions and cursor linking live in CalendarView, which owns an instance of this.
 *
 * Dropped from the old widget: TUI's form and detail popups with their key handling, the i18next
 * translation code, and a `mouseup` fix for stuck drags that relied on TUI v1 internals.
 */
export class CalendarWrapper extends Disposable {
  /**
   * Loads the TUI module (imports.js keeps one copy) and builds the calendar inside `container`.
   * Returns null if the host was disposed while the module was still loading. Named `load` rather
   * than `create` because grainjs Disposable already has a static `create` with another signature.
   */
  public static async load(
    host: CalendarHost, container: HTMLElement, titleDom: HTMLElement, perspective: Perspective,
  ): Promise<CalendarWrapper | null> {
    const { Calendar: Ctor, TZDate: TZDateCtor } = await loadToastUICalendar();
    setTZDate((date: CalendarDate) => new TZDateCtor(date) as unknown as TZDate);
    if (host.isDisposed()) { return null; }
    return new CalendarWrapper(Ctor, TZDateCtor, container, titleDom, host, perspective);
  }

  private _calendar: Calendar;

  // The row drawn with the selection accent, if any. TUI has no idea of a selected event and
  // redrawing one would drop the accent, so every draw puts it back from here.
  private _selectedId: number | null = null;

  // Our own labels for the drag selection, one per selected column, reused between frames. They
  // live on document.body, and _syncSelectionOverlay keeps them in place.
  private _selectionLabels: HTMLElement[] = [];

  // Hour-label format and grid start day follow the browser locale.
  private _timeFormat: TimeFormat = getLocaleTimeFormat();
  private _weekStart: WeekStart = getLocaleWeekStart();
  // The last all-day-only value we sent to TUI, so we only call setOptions when it really changes.
  private _appliedAllDayOnly: boolean | null = null;

  // How many events each day of Day/Week could not show, keyed as in CalendarRenderer's dayKey.
  // Kept because TUI redraws the headers these are written into; see _paintHiddenCounts.
  private _hiddenPerDay = new Map<string, number>();

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

  // Wraps a Date in TUI's TZDate, which adds the timezone helpers plain Date lacks.
  public tzDate(date: Date): TZDate {
    return new this._tzDateCtor(date) as unknown as TZDate;
  }

  public getViewName(): string { return this._calendar.getViewName(); }

  /**
   * True when the caller should limit how many events it draws per day. Month folds whatever does
   * not fit a cell into its own "+N more" and needs every event, or that number would be wrong.
   * Day and Week have no such fold for timed events and would draw all of them.
   */
  public capsEventsPerDay(): boolean { return this._calendar.getViewName() !== "month"; }

  public getDate(): TZDate { return this._calendar.getDate(); }

  // TUI takes a plain Date here as happily as a TZDate; its typings just name the wider union.
  public setDate(date: Date | TZDate) { this._calendar.setDate(date); }

  /**
   * The date range the grid currently shows, in milliseconds, with both ends included.
   *
   * TUI gives the range as whole days, so the end is stretched to the last millisecond of its day;
   * otherwise an event later in that day would count as out of view. We stretch a copy, because TUI
   * may hand back its own range-end object, and changing that would push the window forward on
   * every call.
   */
  public getVisibleRange(): { fromMs: number; toMs: number } {
    const end = this._calendar.getDateRangeEnd().toDate();
    end.setHours(23, 59, 59, 999);
    return { fromMs: this._calendar.getDateRangeStart().getTime(), toMs: end.getTime() };
  }

  public render() { this._calendar.render(); }

  public setTheme() { this._calendar.setTheme(this._calendarTheme()); }

  public setReadOnly(isReadOnly: boolean) { this._calendar.setOptions({ isReadOnly }); }

  public changeView(view: Perspective) {
    this._calendar.changeView(view);
    this.updateUIAfterNavigation();
  }

  // One method rather than three, because TUI's prev/next/today take no arguments and differ only
  // by name.
  public go(method: "prev" | "next" | "today") {
    this._calendar[method]();
    this.updateUIAfterNavigation();
  }

  public updateUIAfterNavigation() {
    this.updateTitle();
    // The host draws whatever entered the new range, so the accent goes on afterwards. It has to be
    // painted again even for an event that stayed on screen: month view accents a single-day event
    // through its fill, while day and week views use its border.
    this._host.onNavigate();
    this._repaintSelected();
  }

  // When the mapped columns have no time-of-day, hide the Day/Week hour grid (eventView: ['allday'])
  // so timeless rows read as a task list instead of bars above an empty 24-hour grid.
  public setAllDayOnly(allDayOnly: boolean) {
    if (allDayOnly === this._appliedAllDayOnly) { return; }
    this._appliedAllDayOnly = allDayOnly;
    this._calendar.setOptions({ week: { eventView: allDayOnly ? ["allday"] : true } });
  }

  /**
   * Puts events on the grid. One call for a whole batch, so TUI re-renders once rather than once
   * per event. The caller has already narrowed the list to what fits on the grid.
   */
  public createEvents(events: EventObject[]) {
    this._calendar.createEvents(events);
    this._repaintSelected();
  }

  public updateEvent(rowId: number, event: EventObject) {
    this._calendar.updateEvent(String(rowId), CALENDAR_NAME, event);
    this._repaintSelected();
  }

  public deleteEvent(rowId: number) {
    this._calendar.deleteEvent(String(rowId), CALENDAR_NAME);
  }

  public clearEvents() {
    this._calendar.clear();
  }

  // One drawn event, or null when that row is not on the grid right now.
  public getEvent(rowId: number) {
    return this._calendar.getEvent(String(rowId), CALENDAR_NAME);
  }

  /**
   * Marks one row as the selected one, or none when given null. The accent outlives redraws: any
   * draw paints it again, since drawing replaces the event inside TUI and would otherwise lose it.
   */
  public setSelected(rowId: number | null) {
    if (rowId === this._selectedId) { return; }
    const previous = this._selectedId;
    this._selectedId = rowId;
    if (previous !== null) { this._paint(previous, false); }
    this._repaintSelected();
  }

  /**
   * Says, under each day of Day/Week, how many of its events were left off the grid. Month needs
   * nothing here because TUI writes its own "+N more". Keyed by `dayKey` from CalendarRenderer.
   *
   * Written straight to the DOM rather than through a TUI template, because changing a template
   * means setOptions, which re-renders the whole grid: the cost the cap exists to avoid. The nodes
   * are TUI's, so a redraw wipes these labels, and every redraw calls this again.
   */
  public setHiddenCounts(hiddenPerDay: Map<string, number>) {
    this._hiddenPerDay = hiddenPerDay;
    this._paintHiddenCounts();
  }

  // Title shown in the toolbar above the calendar grid.
  // - day view: a full date (e.g. "Wed, 9 Aug 2023").
  // - week view: the visible date range (e.g. "6 - 12 Aug 2023", or "30 Jul - 5 Aug 2023" when
  //   the week straddles a month boundary).
  // - month view: month + year.
  // TUI doesn't expose its own header text, but it does expose getDate / getDateRange* which give
  // us enough to derive these formats consistently.
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

  // Paints (or unpaints) an event with the primary color. The accent is normally the left border,
  // but a single-day month event has none (dot or filled bar), so there we tint the fill.
  // Passing the full color set in one updateEvent is what makes TUI repaint; a lone change does not.
  // `color` (the text shade) is restored too, so an event keeps readable text after deselection.
  private _paint(rowId: number, selected: boolean) {
    const event = this.getEvent(rowId);
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

  // Paints the accent onto the selected event again. Safe to call after any draw: it does nothing
  // when no row is selected, and nothing when the selected row is not on the grid.
  private _repaintSelected() {
    if (this._selectedId !== null) { this._paint(this._selectedId, true); }
  }

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
      // so wrap them the same way _getAdjustedDate does.
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
    const observer = new MutationObserver(() => {
      this._maybeSyncSelectionOverlay();
      // TUI owns the day headers and redraws them whenever the grid changes, taking our hidden-event
      // counts with them. They are cheap to write and there are at most seven, so put them back on
      // every mutation rather than trying to work out which redraw dropped them.
      this._paintHiddenCounts();
    });
    // childList+subtree catches the selection box appearing/disappearing; characterData catches the
    // label's raw time changing in place as the drag extends (a text-only update wouldn't fire the
    // other two). All three keep _syncSelectionOverlay in step with TUI's own render.
    observer.observe(this._container, { childList: true, subtree: true, characterData: true });
    // Scrolling the time grid moves TUI's selection box without mutating the DOM, so the mutation
    // observer would not fire, and our overlay would drift away from the box. Re-sync on scroll too
    // (capture phase, since the scroll happens on an inner grid element, not on the container).
    const onScroll = () => this._maybeSyncSelectionOverlay();
    this._container.addEventListener("scroll", onScroll, true);
    this.onDispose(() => {
      observer.disconnect();
      this._container.removeEventListener("scroll", onScroll, true);
    });
  }

  // TUI theme, expressed in terms of Grist theme CSS variables so it follows light/dark mode.
  //
  // Uses the typed `theme` object rather than raw "var(--grist-theme-*)" strings, so a renamed
  // variable is a compile error rather than a silently unstyled calendar.
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
  private _timeTemplates(): NonNullable<Options["template"]> {
    return {
      timegridDisplayPrimaryTime: ({ time }) => formatHourMinute(time, this._timeFormat),
      timegridNowIndicatorLabel: ({ time }) => formatHourMinute(time, this._timeFormat),
    };
  }

  // True when this event occupies a single day in month view. Such events render as a dot (timed) or
  // a filled bar (all-day), neither of which has a border for _paint to accent, so it tints
  // the fill instead. Multi-day month bars (which do have a border) and day/week views are excluded.
  private _isSingleDayInMonthView(event: EventObject): boolean {
    if (this._calendar.getViewName() !== "month") { return false; }
    const start = (event.start as TZDate).toDate();
    const end = (event.end as TZDate).toDate();
    return start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
  }

  // Called both when the counts change and from the container's MutationObserver, since these nodes
  // live inside markup Preact owns and any redraw takes them away.
  private _paintHiddenCounts() {
    const headers = this._container.querySelectorAll(".toastui-calendar-day-name-item");
    if (!headers.length) { return; }
    // TUI renders the day headers in the order of the visible range, so the nth header is the nth
    // day. Reading the date off the DOM would mean parsing its text, which varies by locale.
    const start = this._calendar.getDateRangeStart().toDate();
    headers.forEach((header, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      const hidden = this._hiddenPerDay.get(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
      const existing = header.querySelector(`.${cssHiddenCount.className}`);
      const text = hidden ? t("+{{count}} more", { count: hidden }) : "";
      // Rewrite only on a real change: this runs from a MutationObserver, and touching the DOM
      // unconditionally would trigger it again on every pass.
      if (!hidden) {
        existing?.remove();
      } else if (!existing) {
        header.appendChild(cssHiddenCount(text, testId("hidden-count")));
      } else if (existing.textContent !== text) {
        existing.textContent = text;
      }
    });
  }

  // Fast gate for the hot callers (mutation observer + scroll): skip the full overlay sync when
  // there's no live selection and no lingering overlay to clean up.
  private _maybeSyncSelectionOverlay() {
    const hasSelection = Boolean(this._container.querySelector(".toastui-calendar-grid-selection"));
    if (!hasSelection && this._selectionLabels.length === 0) { return; }
    this._syncSelectionOverlay();
  }

  // Draws our own guide labels on top of TUI's hidden ones while the user drags. TUI makes one
  // selection box (`.toastui-calendar-grid-selection`) per selected column, each holding a label
  // with plain text like "HH:MM - HH:MM". We keep a pool of label nodes on document.body, put each
  // over its box, and write the time in the user's local format. Safe to call as often as needed.
  private _syncSelectionOverlay() {
    // Measure the box, not the label: once the label is hidden its size becomes zero (see
    // cssCalendarContainer). The label sits in the box's top-left corner, where ours goes too.
    const boxes = this._container.querySelectorAll(".toastui-calendar-grid-selection");
    // Counts the labels really placed this time, skipping unrecognised boxes without leaving a
    // gap, so the splice below removes exactly the extra nodes.
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

// The columns the user has to map, as shown in the creator panel.
//
// The five `name` keys must stay exactly as the old calendar widget had them, because documents
// saved with that widget refer to them by name.
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

// Helpers

// TUI does not export the type of its theme object (it hides it behind DeepPartial<ThemeState>),
// so we take it from Options instead. This way a typo in a nested key becomes a compile error.
type CalendarThemeOption = NonNullable<Options["theme"]>;

type TimeFormat = "12h" | "24h";
type WeekStart = "sun" | "mon";

const HOURS_PER_DAY = 24;

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

// How many events a Day/Week column could not show, tucked into the bottom of the day header.
//
// Positioned out of the flow on purpose: TUI gives the header panel a fixed inline height and lets
// it scroll, so a label that took up room would push the day name into a scrollable overflow rather
// than appear beside it. The header itself is `position: relative`, so this anchors to it.
// See setHiddenCounts.
const cssHiddenCount = styled("div", `
  position: absolute;
  right: 4px;
  bottom: 1px;
  font-size: 10px;
  font-weight: 400;
  line-height: 12px;
  pointer-events: none;
  color: ${theme.lightText};
`);

// Our own drag guide label, drawn on top of TUI's hidden one (see cssCalendarContainer). There is
// one per selected column. It uses `position: fixed` with the box's own screen position, so we do
// not have to work out any parent offsets. It lives on document.body, outside the container that
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
