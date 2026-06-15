import BaseView from "app/client/components/BaseView";
import { GristDoc } from "app/client/components/GristDoc";
import { Delay } from "app/client/lib/Delay";
import { loadToastUICalendar, ToastUICalendarModule } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { reportError } from "app/client/models/errors";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { gristThemeObs } from "app/client/ui2018/theme";
import { CellValue, UserAction } from "app/common/DocActions";
import { capitalize } from "app/common/gutil";
import { ColumnsToMap, WidgetColumnMap } from "app/plugin/CustomSectionAPI";
import { UIRowId } from "app/plugin/GristAPI";
import { decodeObject } from "app/plugin/objtypes";

import { Computed, dom, fromKo, IDisposable, makeTestId, styled } from "grainjs";
import debounce from "lodash/debounce";

import type Calendar from "@toast-ui/calendar";
import type { EventObject, Options, TZDate } from "@toast-ui/calendar";

// TUI's theme types live behind a non-exported DeepPartial<ThemeState>; pull them off Options so
// _calendarTheme is type-checked structurally (typos in deeply-nested keys become compile errors).
type CalendarThemeOption = NonNullable<Options["theme"]>;

const t = makeT("CalendarView");
const testId = makeTestId("test-calendar-");

// The single TUI "calendar" all events belong to.
const CALENDAR_NAME = "standardCalendar";

type Perspective = "day" | "week" | "month";
const PERSPECTIVES: Perspective[] = ["day", "week", "month"];

const SECONDS_PER_DAY = 24 * 60 * 60;

// Max gap (ms) between two clickEvent fires on the same rowId that we treat as a double-click.
const DBLCLICK_MS = 300;

// Columns the calendar needs the user to map. Mirrors the mapping offered by the
// (now superseded) custom calendar widget, so existing configurations keep working.
export function getCalendarColumns(): ColumnsToMap {
  return [
    {
      name: "startDate",
      title: t("Start Date"),
      optional: false,
      type: "Date,DateTime",
      description: t("starting point of event"),
      allowMultiple: false,
      strictType: true,
    },
    {
      name: "endDate",
      title: t("End Date"),
      optional: true,
      type: "Date,DateTime",
      description: t("ending point of event"),
      allowMultiple: false,
      strictType: true,
    },
    {
      name: "isAllDay",
      title: t("Is All Day"),
      optional: true,
      type: "Bool",
      description: t("is event all day long"),
      strictType: true,
    },
    {
      name: "title",
      title: t("Title"),
      optional: false,
      type: "Text",
      description: t("title of event"),
      allowMultiple: false,
    },
    {
      name: "type",
      title: t("Type"),
      optional: true,
      type: "Choice,ChoiceList",
      description: t("event category and style"),
      allowMultiple: false,
    },
  ];
}

function isZeroTime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

// A flat record built from the mapped columns of a single row.
interface CalendarRecord {
  id: number;
  startDate: Date | null;
  endDate: Date | null;
  isAllDay: boolean | undefined;
  title: string | null;
  type: string;
}

/**
 * CalendarView renders records of the underlying table as events in a Toast UI Calendar, with
 * day/week/month perspectives. It is the native replacement for the bundled custom calendar
 * widget: same column mapping (start/end/title/all-day/type), same timezone and color handling,
 * but rendered directly (no iframe) and writing back through ordinary user actions.
 */
export class CalendarView extends BaseView {
  private _calendar: Calendar | null = null;
  private _tzDate: ToastUICalendarModule["TZDate"] | null = null;

  private _calendarDom: HTMLElement;
  private _titleDom: HTMLElement;

  // All events by Grist rowId; only those in the visible date range are pushed to TUI.
  private _allEvents = new Map<number, EventObject>();
  private _visibleEventIds = new Set<number>();
  private _selectedRecordId: number | null = null;

  private _perspective: Computed<Perspective>;
  private _update: () => void;
  private _resize: () => void;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    // Derived from the saved option (defaulting to "week"); drives dom.cls in the toolbar and
    // _changeView via its listener. Persisted by _setPerspective. Must exist before _buildDom().
    this._perspective = Computed.create(this,
      fromKo(this.viewSection.optionsObj.prop("calendarViewPerspective")),
      (_use, view) => (view && PERSPECTIVES.includes(view) ? view : "week"));

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      this._calendar?.destroy();
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    // Advertise the columns we want mapped, so the creator panel shows the mapping UI (the same
    // path used by custom widgets). Clear on dispose so switching widget type doesn't leave a
    // stale mapping request behind.
    this.viewSection.columnsToMap(getCalendarColumns());
    // The calendar still lives under the `custom.*` parentKey for back-compat with saved configs,
    // so LinkNode.ts treats this section like a custom widget and refuses to use it as a link
    // source unless allowSelectBy is true (see app/common/LinkNode.ts). Native views (Grid, Chart,
    // Detail) skip this check entirely, but we have to opt in here. Reset on dispose so a later
    // switch to a different widget type doesn't carry the flag over.
    this.viewSection.allowSelectBy(true);
    this.onDispose(() => {
      if (this.viewSection.isDisposed()) { return; }
      this.viewSection.columnsToMap(null);
      this.viewSection.allowSelectBy(false);
    });

    this._update = debounce(() => this._updateView(), 0);
    this._resize = this.autoDispose(Delay.untilAnimationFrame(() => this._calendar?.render(), this));

    // Re-render events when data, mapping, perspective or theme change.
    this.listenTo(this.sortedRows, "rowNotify", this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));

    // Re-render when the mapping changes _or_ when one of the mapped columns' types changes
    // (Text -> Numeric, Date <-> DateTime, etc.). Mirrors ChartView's per-field type listener.
    let typeSubs: IDisposable[] = [];
    this.autoDispose(this.viewSection.mappedColumns.subscribe(() => {
      this._update();
      typeSubs.forEach(s => s.dispose());
      typeSubs = this._mappedColumnList().flatMap(col => [
        col.type.subscribe(this._update),
        col.displayColModel.peek().type.subscribe(this._update),
      ]);
    }));
    this.onDispose(() => typeSubs.forEach(s => s.dispose()));

    this.autoDispose(this._perspective.addListener(view => this._changeView(view)));
    // Event colors are set to CSS-variable strings, so they re-resolve on theme change with no
    // data rebuild; we only need to re-apply the calendar chrome theme.
    this.autoDispose(gristThemeObs().addListener(() => {
      this._calendar?.setTheme(this._calendarTheme());
    }));

    // Reflect the table cursor onto the calendar (selection + navigation).
    this.autoDispose(this.cursor.rowId.subscribe(rowId => this._selectRecord(rowId)));

    this._init().catch(reportError);

    // Stable handle for nbrowser tests, so they don't have to walk into private fields. Updated
    // to point at the most-recently-created live view, cleared on dispose. Production never
    // reads it; tests do via window.gristCalendarView (see test/nbrowser/CalendarView.ts).
    (window as any).gristCalendarView = this._testHook();
    this.onDispose(() => {
      if ((window as any).gristCalendarView?._view === this) {
        delete (window as any).gristCalendarView;
      }
    });
  }

  private _testHook() {
    return {
      _view: this,
      getEventByRowId: (rowId: number) => this._serializeEvent(this._allEvents.get(rowId)),
      getEventByTitle: (title: string) => this._serializeEvent(
        [...this._allEvents.values()].find(e => e.title === title)),
      getSelectedRecordId: () => this._selectedRecordId,
      getViewName: () => this._calendar?.getViewName(),
      getCalendarDate: () => this._calendar?.getDate().toDate().toDateString(),
    };
  }

  private _serializeEvent(ev: EventObject | undefined) {
    if (!ev) { return null; }
    // TZDate carries a timezone tag; .local() recovers the original instant before .toDate().
    const ms = (x: any) => !x ? null : (x.toDate ? x.local().toDate().getTime() : new Date(x).getTime());
    return { title: ev.title, startMs: ms(ev.start), endMs: ms(ev.end), isAllDay: Boolean(ev.isAllday) };
  }

  public onResize() {
    this._resize();
  }

  protected onTableLoaded() {
    super.onTableLoaded();
    this._update();
  }

  // ---------------------------------------------------------------------------
  // Setup

  private async _init() {
    const { Calendar: CalendarCtor, TZDate } = await loadToastUICalendar();
    if (this.isDisposed()) { return; }
    this._tzDate = TZDate;

    const isReadOnly = this._isReadOnly();
    this._calendar = new CalendarCtor(this._calendarDom, {
      week: { taskView: false, startDayOfWeek: getFirstDayOfWeek() },
      month: { startDayOfWeek: getFirstDayOfWeek() },
      usageStatistics: false,   // never phone home to Google Analytics
      defaultView: this._perspective.get(),
      isReadOnly,
      theme: this._calendarTheme(),
      useFormPopup: !isReadOnly,
      useDetailPopup: false,    // we open Grist's Record Card on double-click instead
      gridSelection: { enableDblClick: true, enableClick: false },
      calendars: [{
        id: CALENDAR_NAME,
        name: "Personal",
        backgroundColor: theme.inputReadonlyBorder.toString(),
        borderColor: theme.inputReadonlyBorder.toString(),
      }],
    });

    this._wireCalendarEvents();
    // disableEditing is a ko.computed that depends on linking state (BaseView.ts), so it can flip
    // after init when the section becomes a link target. Mirror its current value onto TUI so the
    // form popup and drag-to-edit follow the read-only flag.
    this.autoDispose(this.disableEditing.subscribe(() => this._applyReadOnly()));
    this._changeView(this._perspective.get());
    this._updateView();
  }

  private _applyReadOnly() {
    if (!this._calendar) { return; }
    const isReadOnly = this._isReadOnly();
    this._calendar.setOptions({ isReadOnly, useFormPopup: !isReadOnly });
  }

  // TUI theme, expressed in terms of Grist theme CSS variables so it follows light/dark mode.
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
        dayName: { borderLeft: border, backgroundColor: "inherit" },
        dayExceptThisMonth: { color: textColor },
        holidayExceptThisMonth: { color: textColor },
      },
    };
  }

  private _wireCalendarEvents() {
    const cal = this._calendar!;

    // TUI doesn't emit a dedicated double-click event for an event item, so we synthesize one:
    // two clickEvent fires on the same rowId within DBLCLICK_MS open the Record Card. The first
    // click already moves the cursor (and selects the row), so the second click sees the cursor
    // already on it and goes straight to viewSelectedRecordAsCard.
    // The handler parameter types are inferred via TUI's ExternalEventTypes (see eventBus.d.ts),
    // so we get EventObject/UpdatedEventInfo/etc. for free with no explicit annotations.
    let lastClickId: number | null = null;
    let lastClickAt = 0;
    cal.on("clickEvent", ({ event }) => {
      const rowId = Number(event.id);
      if (!rowId || Number.isNaN(rowId)) { return; }
      this.gristDoc.viewModel.activeSectionId(this.viewSection.getRowId());
      this.setCursorPos({ rowId });
      const now = Date.now();
      if (lastClickId === rowId && (now - lastClickAt) < DBLCLICK_MS) {
        this.viewSelectedRecordAsCard();
        lastClickId = null;
      } else {
        lastClickId = rowId;
        lastClickAt = now;
      }
    });

    // Creation, drag/resize and form edits.
    cal.on("beforeCreateEvent", (eventData) => this._upsertFromToast(null, eventData));
    cal.on("beforeUpdateEvent", ({ event, changes }) =>
      this._upsertFromToast(Number(event.id), changes));
    cal.on("beforeDeleteEvent", (event) => this._deleteEvent(Number(event.id)));

    // Clear leftover grid selections, mirroring the upstream workaround for nhn/tui.calendar#1300.
    this._calendarDom.addEventListener("mousedown", () => cal.clearGridSelections());

    // Enter confirms the event-edit form popup (TUI doesn't submit it on Enter by itself).
    this._calendarDom.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") { return; }
      const confirm = this._calendarDom.querySelector("button.toastui-calendar-popup-confirm");
      if (confirm) { ev.preventDefault(); (confirm as HTMLElement).click(); }
    });
  }

  // ---------------------------------------------------------------------------
  // Column mapping

  private _mapping(): WidgetColumnMap {
    return this.viewSection.mappedColumns() || {};
  }

  private _col(value: string | string[] | null | undefined): ColumnRec | null {
    const colId = Array.isArray(value) ? value[0] : value;
    if (!colId) { return null; }
    return this.viewSection.columns.peek().find(c => c.colId.peek() === colId) || null;
  }

  // The column whose value should be read for display. For a Reference column this resolves to
  // the visible column on the referenced table; for plain columns it returns the column itself.
  // Mirrors ChartView's use of `displayColModel` (see ChartView.ts) so we behave consistently.
  private _displayCol(col: ColumnRec | null): ColumnRec | null {
    return col ? col.displayColModel.peek() : null;
  }

  // All ColumnRecs currently referenced by the calendar's mapping (deduplicated). Used to wire
  // type-change subscriptions, since the calendar's rendering depends on each column's pureType.
  private _mappedColumnList(): ColumnRec[] {
    const mapping = this._mapping();
    const cols = ["startDate", "endDate", "isAllDay", "title", "type"]
      .map(key => this._col(mapping[key]))
      .filter((c): c is ColumnRec => c !== null);
    return Array.from(new Set(cols));
  }

  // ---------------------------------------------------------------------------
  // Reading data

  private _updateView() {
    if (this.isDisposed() || !this._calendar) { return; }

    const mapping = this._mapping();
    const startCol = this._col(mapping.startDate);
    const titleCol = this._col(mapping.title);
    // Both required columns must be mapped to show anything.
    if (!startCol || !titleCol) {
      this._allEvents = new Map();
      this._renderVisibleEvents();
      this._updateTitle();
      return;
    }
    const endCol = this._col(mapping.endDate);
    const allDayCol = this._col(mapping.isAllDay);
    const typeCol = this._col(mapping.type);

    // Read values via the display column so that Reference columns surface their visible value
    // (e.g. an event title) instead of the foreign row id. For non-Ref columns this is a no-op.
    const startDisplay = this._displayCol(startCol)!;
    const endDisplay = this._displayCol(endCol);
    const titleDisplay = this._displayCol(titleCol)!;
    const allDayDisplay = this._displayCol(allDayCol);
    const typeDisplay = this._displayCol(typeCol);

    // Resolve column types and choice styling once, not per row.
    const startType = startDisplay.pureType.peek();
    const endType = endDisplay?.pureType.peek() || startType;
    const choiceOptions = typeDisplay?.widgetOptionsJson.peek()?.choiceOptions || {};

    // Build one getter per mapped column; per-row access is then a plain array read
    // rather than a getValue() map lookup (same approach as ChartView).
    const data = this.tableModel.tableData;
    const getStart = data.getRowPropFunc(startDisplay.colId.peek());
    const getTitle = data.getRowPropFunc(titleDisplay.colId.peek());
    const getEnd = endDisplay && data.getRowPropFunc(endDisplay.colId.peek());
    const getAllDay = allDayDisplay && data.getRowPropFunc(allDayDisplay.colId.peek());
    const getType = typeDisplay && data.getRowPropFunc(typeDisplay.colId.peek());

    const rowIds = this.sortedRows.getKoArray().peek() as number[];
    const events: [number, EventObject][] = [];
    for (const rowId of rowIds) {
      if (typeof rowId !== "number") { continue; }
      const startDate = numToDate(getStart(rowId));
      const title = asText(getTitle(rowId));
      if (!startDate || title === null) { continue; }
      const record: CalendarRecord = {
        id: rowId,
        startDate,
        endDate: getEnd ? numToDate(getEnd(rowId)) : null,
        isAllDay: getAllDay ? Boolean(getAllDay(rowId)) : undefined,
        title,
        type: getType ? asChoice(getType(rowId)) : "",
      };
      events.push([rowId, this._buildEvent(record, startType, endType, choiceOptions)]);
    }

    this._allEvents = new Map(events);
    this._renderVisibleEvents();
    this._updateTitle();
    this._refreshSelectedRecord();
  }

  private _buildEvent(
    record: CalendarRecord, startType: string, endType: string, choiceOptions: Record<string, any>,
  ): EventObject {
    const start = this._getAdjustedDate(record.startDate!, startType);
    let end = record.endDate ? this._getAdjustedDate(record.endDate, endType) : start;

    // Normalize invalid ranges so the event is still visible.
    if (end < start) { end = start; }

    let isAllday = record.isAllDay;
    if (startType === "Date" && endType === "Date") { isAllday = true; }
    // Workaround for midnight zero-length events not showing up.
    if (!isAllday && end.valueOf() === start.valueOf() && isZeroTime(end) && isZeroTime(start)) {
      end = new this._tzDate!(end).addHours(1) as unknown as Date;
    }

    // Apply colors/styling from the choice options of the "type" column, falling back to defaults.
    const style = choiceOptions[record.type] || {};
    const backgroundColor = style.fillColor ?? theme.inputReadonlyBorder.toString();
    const color = style.textColor ?? theme.text.toString();
    const fontWeight = style.fontBold ? "800" : "normal";
    const fontStyle = style.fontItalic ? "italic" : "normal";
    let textDecoration = style.fontUnderline ? "underline" : "none";
    if (style.fontStrikethrough) {
      textDecoration = textDecoration === "underline" ? "line-through underline" : "line-through";
    }

    return {
      id: String(record.id),
      calendarId: CALENDAR_NAME,
      title: record.title!,
      start,
      end,
      isAllday,
      category: isAllday ? "allday" : "time",
      state: "Free",
      backgroundColor,
      color,
      borderColor: backgroundColor,
      dragBackgroundColor: theme.hover.toString(),
      // Remember the base background so _setHighlight can restore it after a selection.
      raw: { backgroundColor },
      customStyle: { fontStyle, fontWeight, textDecoration, textWrap: "auto" },
    } as EventObject;
  }

  // ---------------------------------------------------------------------------
  // Timezone handling (ported from the calendar widget)

  private _docTimeZone(): string {
    return this.gristDoc.docInfo.timezone.peek();
  }

  /** Shifts a UTC-based JS Date so it displays correctly for the given column type. */
  private _getAdjustedDate(date: Date, colType: string): Date {
    const docTz = this._docTimeZone();
    // The `timezone` property exists on TZDate (TUI's wrapper) but not on plain Date — we still
    // call this with both, so probe the field rather than narrowing the parameter type.
    const dateTz = (date as Date & { timezone?: string }).timezone;
    if (docTz && docTz !== dateTz && colType.startsWith("DateTime")) {
      return new this._tzDate!(date).tz(docTz) as unknown as Date;
    }
    if (colType !== "Date") { return date; }
    // Like date.tz('UTC'), but accounts for DST differences.
    const ms = date.valueOf() + (date.getTimezoneOffset() * 60000);
    return new Date(ms);
  }

  /** Converts a calendar date (browser-local TZDate) into the seconds value Grist stores. */
  private _makeGristDateTime(tzDate: TZDate, colType: string): number {
    let unixTime = Math.floor(tzDate.valueOf() / 1000);
    const localOffsetMin = -tzDate.getTimezoneOffset();
    const docTz = this._docTimeZone();
    const docOffsetMin = !docTz ? localOffsetMin : tzDate.tz(docTz).getTimezoneOffset();
    if (colType === "Date") {
      const secondsSinceEpoch = unixTime + localOffsetMin * 60;
      return Math.floor(secondsSinceEpoch / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    } else {
      unixTime += (localOffsetMin - docOffsetMin) * 60;
      return unixTime;
    }
  }

  // ---------------------------------------------------------------------------
  // Writing data

  private async _upsertFromToast(rowId: number | null, tui: Partial<EventObject>) {
    if (this._isReadOnly()) { return; }
    const mapping = this._mapping();
    const startCol = this._col(mapping.startDate);
    const endCol = this._col(mapping.endDate);
    const allDayCol = this._col(mapping.isAllDay);
    const titleCol = this._col(mapping.title);

    const fields: Record<string, CellValue> = {};
    if (tui.start !== undefined && startCol) {
      fields[startCol.colId.peek()] = this._makeGristDateTime(tui.start as TZDate, startCol.pureType.peek());
    }
    if (tui.end !== undefined && endCol) {
      fields[endCol.colId.peek()] = this._makeGristDateTime(tui.end as TZDate, endCol.pureType.peek());
    }
    if (tui.isAllday !== undefined && allDayCol) {
      fields[allDayCol.colId.peek()] = tui.isAllday;
    }
    if (tui.title !== undefined && titleCol) {
      fields[titleCol.colId.peek()] = tui.title || t("New Event");
    }
    if (Object.keys(fields).length === 0) { return; }

    try {
      if (rowId) {
        await this.sendTableAction(["UpdateRecord", rowId, fields] as UserAction);
      } else {
        const newRowId = await this.sendTableAction(["AddRecord", null, fields] as UserAction);
        // setCursorPos triggers _selectRecord on a rowId whose event isn't in _allEvents yet
        // (rowNotify fires asynchronously). _selectedRecordId acts as a pending pointer; the next
        // _updateView (via rowNotify) reconciles the highlight through _refreshSelectedRecord.
        if (newRowId && !this.isDisposed()) { this.setCursorPos({ rowId: newRowId }); }
      }
    } catch (err) {
      reportError(err as Error);
    }
  }

  private async _deleteEvent(rowId: number) {
    if (this._isReadOnly() || !rowId) { return; }
    try {
      await this.deleteRows([rowId]);
    } catch (err) {
      reportError(err as Error);
    }
  }

  // ---------------------------------------------------------------------------
  // Selection / cursor linking

  private _selectRecord(rowId: UIRowId | null) {
    if (!this._calendar) { return; }
    const next = typeof rowId === "number" ? rowId : null;
    if (next === this._selectedRecordId) { return; }

    // Always clear the previous highlight, even when there's no incoming event to highlight
    // (e.g. cursor moved off any mapped row, or to a row whose date columns are blank).
    if (this._selectedRecordId) { this._setHighlight(this._selectedRecordId, false); }
    this._selectedRecordId = next;
    if (next === null) { return; }

    const event = this._allEvents.get(next);
    if (!event) { return; }

    this._calendar.setDate(event.start as TZDate);
    this._updateUIAfterNavigation();
  }

  private _refreshSelectedRecord() {
    if (this._selectedRecordId) { this._setHighlight(this._selectedRecordId, true); }
  }

  // Highlights (or un-highlights) an event by resetting it to its base color and, when selected,
  // overriding the border (or background, for month-view bars) with the accent color.
  private _setHighlight(rowId: number, selected: boolean) {
    const cal = this._calendar;
    const event = cal?.getEvent(String(rowId), CALENDAR_NAME);
    if (!cal || !event) { return; }
    const base = event.raw?.backgroundColor ?? theme.inputReadonlyBorder.toString();
    const part = this._isBarInMonthView(event) ? "backgroundColor" : "borderColor";
    cal.updateEvent(String(rowId), CALENDAR_NAME, {
      borderColor: base,
      backgroundColor: base,
      ...(selected ? { [part]: theme.controlPrimaryFg.toString() } : {}),
    });
  }

  private _isBarInMonthView(event: EventObject): boolean {
    if (this._calendar?.getViewName() !== "month") { return false; }
    const start = (event.start as TZDate).toDate();
    const end = (event.end as TZDate).toDate();
    const isMultiDay = start.getDate() !== end.getDate() ||
      start.getMonth() !== end.getMonth() ||
      start.getFullYear() !== end.getFullYear();
    return !isMultiDay;
  }

  // ---------------------------------------------------------------------------
  // Navigation & rendering

  /** Adds/updates events in the visible range and removes those that scrolled out of it. */
  private _renderVisibleEvents() {
    const cal = this._calendar;
    if (!cal) { return; }
    const rangeStart = cal.getDateRangeStart().getTime();
    // Copy before calling setHours, which mutates in place. TUI may hand back a reference to its
    // internal range-end, so shifting it would creep the visible window forward each render.
    const rangeEndDate = (cal.getDateRangeEnd() as TZDate).toDate();
    rangeEndDate.setHours(23, 59, 59, 999);
    const rangeEnd = rangeEndDate.getTime();

    const nowVisible = new Set<number>();
    for (const [rowId, event] of this._allEvents) {
      const startMs = (event.start as TZDate).getTime();
      const endMs = (event.end as TZDate).getTime();
      const inRange = (startMs >= rangeStart && startMs <= rangeEnd) ||
        (endMs >= rangeStart && endMs <= rangeEnd) ||
        (startMs < rangeStart && endMs > rangeEnd);
      if (!inRange) { continue; }
      if (cal.getEvent(String(rowId), CALENDAR_NAME)) {
        cal.updateEvent(String(rowId), CALENDAR_NAME, event);
      } else {
        cal.createEvents([event]);
      }
      nowVisible.add(rowId);
    }
    for (const rowId of this._visibleEventIds) {
      if (!nowVisible.has(rowId)) { cal.deleteEvent(String(rowId), CALENDAR_NAME); }
    }
    this._visibleEventIds = nowVisible;
  }

  private _changeView(view: Perspective) {
    this._calendar?.changeView(view);
    this._updateUIAfterNavigation();
  }

  private _go(method: "prev" | "next" | "today") {
    this._calendar?.[method]();
    this._updateUIAfterNavigation();
  }

  private _setPerspective(view: Perspective) {
    // Persist the choice; this flows back through _perspective (toolbar active state) and its
    // listener (_changeView), since setAndSave updates the underlying option synchronously.
    this.viewSection.optionsObj.prop("calendarViewPerspective").setAndSave(view).catch(reportError);
  }

  private _updateUIAfterNavigation() {
    this._renderVisibleEvents();
    this._updateTitle();
    this._refreshSelectedRecord();
  }

  private _updateTitle() {
    if (!this._calendar || !this._titleDom) { return; }
    this._titleDom.textContent = this._calendar.getDate().toDate()
      .toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  // ---------------------------------------------------------------------------
  // DOM

  private _isReadOnly(): boolean {
    return this.gristDoc.isReadonly.get() || this.disableEditing.peek();
  }

  private _buildDom() {
    return cssCalendarView(
      testId("container"),
      cssToolbar(
        cssNavGroup(
          cssNavButton(icon("Dropdown"), dom.style("transform", "rotate(90deg)"),
            dom.on("click", () => this._go("prev")), testId("prev")),
          cssNavButton(t("Today"), dom.on("click", () => this._go("today")), testId("today")),
          cssNavButton(icon("Dropdown"), dom.style("transform", "rotate(-90deg)"),
            dom.on("click", () => this._go("next")), testId("next")),
        ),
        this._titleDom = cssCalendarTitle(testId("title")),
        cssPerspectiveGroup(
          ...PERSPECTIVES.map(view =>
            cssNavButton(
              t(capitalize(view)),
              cssNavButton.cls("-active", use => use(this._perspective) === view),
              dom.on("click", () => this._setPerspective(view)),
              testId(`perspective-${view}`),
            ),
          ),
        ),
      ),
      this._calendarDom = cssCalendarContainer(testId("widget")),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers

function numToDate(value: CellValue | undefined): Date | null {
  // 0 is how Grist stores a blank Date/DateTime; treat it as missing rather than 1970-01-01.
  // Matches ChartView's dateGetter, which excludes zero for the same reason.
  return (typeof value === "number" && value && isFinite(value)) ? new Date(value * 1000) : null;
}

function asText(value: CellValue | undefined): string | null {
  if (value === null || value === undefined || value === "") { return null; }
  return typeof value === "string" ? value : String(value);
}

function asChoice(value: CellValue | undefined): string {
  if (!value) { return ""; }
  const decoded = decodeObject(value);
  return String(Array.isArray(decoded) ? (decoded[0] ?? "") : decoded);
}

// TUI: 0=Sun..6=Sat; Intl: 1=Mon..7=Sun.
function getFirstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(navigator.language || "en");
    const weekInfo = (locale as any).getWeekInfo?.() ?? (locale as any).weekInfo;
    if (weekInfo?.firstDay !== undefined) {
      return weekInfo.firstDay === 7 ? 0 : weekInfo.firstDay;
    }
  } catch (e) {
    // Intl.Locale week info not supported by this browser.
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Styles

const cssCalendarView = styled("div", `
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: ${theme.mainPanelBg};
  color: ${theme.text};
`);

const cssToolbar = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  border-bottom: 1px solid ${theme.tableBodyBorder};
  flex: none;
`);

const cssNavGroup = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
`);

const cssPerspectiveGroup = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
`);

const cssCalendarTitle = styled("div", `
  font-weight: 600;
  font-size: 15px;
  min-width: 160px;
  text-align: center;
`);

const cssNavButton = styled("div", `
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 3px;
  user-select: none;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover {
    background-color: ${theme.hover};
  }
  &-active {
    background-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
  }
`);

const cssCalendarContainer = styled("div", `
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
`);
