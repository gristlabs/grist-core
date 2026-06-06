import BaseView from "app/client/components/BaseView";
import { GristDoc } from "app/client/components/GristDoc";
import { Delay } from "app/client/lib/Delay";
import { loadToastUICalendar, ToastUICalendarModule } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { basicButton, button, cssButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { linkSelect } from "app/client/ui2018/menus";
import { gristThemeObs } from "app/client/ui2018/theme";
import { getReadableColorsCombo } from "app/client/widgets/ChoiceToken";
import { CellValue, UserAction } from "app/common/DocActions";
import { isDateLikeType, isDateOnlyType } from "app/common/gristTypes";
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

type TimeFormat = "12h" | "24h";
type WeekStart = "sun" | "mon";

const SECONDS_PER_DAY = 24 * 60 * 60;
const HOURS_PER_DAY = 24;

// Columns the calendar needs the user to map. Mirrors the mapping offered by the
// (now superseded) custom calendar widget, so existing configurations keep working.
// TODO(O6): the description strings here ("starting point of event", "is event all day long",
// "event category and style") read awkwardly; polish for a future i18n pass, e.g. "Start of the
// event", "Whether the event lasts all day", "Event category for color/style".
function getCalendarColumns(): ColumnsToMap {
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

function isDateTime(colType: string): boolean { return isDateLikeType(colType) && !isDateOnlyType(colType); }

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

  // Our 12-hour overlay labels for the drag selection (one per selected column), pooled and reused
  // across drag frames. Live on document.body; kept in sync by _syncSelectionOverlay.
  private _selectionLabels: HTMLElement[] = [];

  private _perspective: Computed<Perspective>;
  private _timeFormat: Computed<TimeFormat>;
  private _weekStart: Computed<WeekStart>;
  // Last values pushed to TUI. The optionsObj subscription fires on every option write (incl. the
  // perspective toggle), so we compare against these to re-render only on an actual change.
  private _appliedTimeFormat: TimeFormat | null = null;
  private _appliedWeekStart: WeekStart | null = null;
  private _appliedAllDayOnly: boolean | null = null;
  private _update: () => void;
  private _resize: () => void;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    // Derived from the saved option (defaulting to "week"); drives dom.cls in the toolbar and
    // _changeView via its listener. Persisted by _setPerspective. Must exist before _buildDom().
    this._perspective = Computed.create(this,
      fromKo(this.viewSection.optionsObj.prop("calendarViewPerspective")),
      (_use, view) => (view && PERSPECTIVES.includes(view) ? view : "week"));

    // Read the saved option, falling back to the browser locale when unset. Writable so the toolbar
    // dropdowns persist via setAndSave; the grid updates through the optionsObj subscription below.
    const timeFormatProp = this.viewSection.optionsObj.prop("calendarTimeFormat");
    this._timeFormat = Computed.create(this,
      fromKo(timeFormatProp),
      (_use, fmt) => (fmt === "12h" || fmt === "24h" ? fmt : getLocaleTimeFormat()));
    this._timeFormat.onWrite(val => timeFormatProp.setAndSave(val).catch(reportError));
    const weekStartProp = this.viewSection.optionsObj.prop("calendarWeekStart");
    this._weekStart = Computed.create(this,
      fromKo(weekStartProp),
      (_use, start) => (start === "sun" || start === "mon" ? start : getLocaleWeekStart()));
    this._weekStart.onWrite(val => weekStartProp.setAndSave(val).catch(reportError));

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      this._calendar?.destroy();
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    // Clear on dispose so switching widget type doesn't leave stale mapping / link-source flags behind.
    this.viewSection.columnsToMap(getCalendarColumns());
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
    // Subscribe to the whole optionsObj (fires on the save round-trip) rather than the per-prop
    // computeds, since saveOnly() updates the value only after the round-trip, not optimistically.
    this.autoDispose(this.viewSection.optionsObj.subscribe(() => this._applyCalendarOptions()));
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

  public onResize() {
    this._resize();
  }

  protected onTableLoaded() {
    super.onTableLoaded();
    this._update();
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

  private _serializeEvent(ev?: EventObject) {
    if (!ev) { return null; }
    // TZDate carries a timezone tag; .local() recovers the original instant before .toDate().
    const getMs = (x: unknown) => {
      if (!x) { return null; }
      if (typeof x === "object" && "toDate" in x) {
        return (x as any).local().toDate().getTime();
      }
      if (typeof x === "string") {
        return new Date(x).getTime();
      }
      return null;
    };
    return { title: ev.title, startMs: getMs(ev.start), endMs: getMs(ev.end), isAllDay: Boolean(ev.isAllday) };
  }

  // Setup

  private async _init() {
    const { Calendar: CalendarCtor, TZDate } = await loadToastUICalendar();
    if (this.isDisposed()) { return; }
    this._tzDate = TZDate;

    const isReadOnly = this._isReadOnly();
    const startDayOfWeek = weekStartToIndex(this._weekStart.get());
    this._calendar = new CalendarCtor(this._calendarDom, {
      week: { taskView: false, startDayOfWeek },
      month: { startDayOfWeek },
      usageStatistics: false,   // never phone home to Google Analytics
      defaultView: this._perspective.get(),
      isReadOnly,
      theme: this._calendarTheme(),
      useFormPopup: false,      // we never use TUI's create/edit form; see beforeCreateEvent below
      useDetailPopup: false,    // we open Grist's Record Card on double-click instead
      // Double-click an empty cell to create an event. With useFormPopup off, TUI emits
      // beforeCreateEvent directly (no popup): we add the Grist row for the dragged range and open
      // Grist's Record Card on it. Double-click an existing event also opens the Record Card.
      gridSelection: { enableDblClick: true, enableClick: false },
      template: this._timeTemplates(),
      calendars: [{
        id: CALENDAR_NAME,
        name: t("Personal"),
        backgroundColor: theme.inputReadonlyBorder.toString(),
        borderColor: theme.inputReadonlyBorder.toString(),
      }],
    });

    // Prime as applied; the optionsObj subscription only acts on later changes.
    this._appliedTimeFormat = this._timeFormat.get();
    this._appliedWeekStart = this._weekStart.get();

    this._wireCalendarEvents();
    // disableEditing is a ko.computed that depends on linking state (BaseView.ts), so it can flip
    // after init when the section becomes a link target. Mirror its current value onto TUI so
    // drag-to-edit and drag-to-create follow the read-only flag.
    this.autoDispose(this.disableEditing.subscribe(() => this._applyReadOnly()));
    // The TUI constructor already opened `defaultView` (this._perspective), so no _changeView here;
    // _updateView renders the events and title.
    this._updateView();
    // Apply the current cursor now that the calendar and its events exist: the cursor subscription
    // only fires on later changes, so an event the cursor already sits on (e.g. reopening a view
    // with a set cursor) wouldn't be highlighted until the cursor next moved.
    this._selectRecord(this.cursor.rowId.peek());
  }

  private _applyReadOnly() {
    if (!this._calendar) { return; }
    const isReadOnly = this._isReadOnly();
    this._calendar.setOptions({ isReadOnly });
  }

  // Hour-axis and now-indicator templates, in the widget's 12h/24h format. Extracted so
  // _applyCalendarOptions can re-set them: a bare render() reuses the template refs, so Preact
  // memoizes and the axis keeps its old labels; setOptions({ template }) forces the grid to redraw.
  private _timeTemplates(): NonNullable<Options["template"]> {
    // TUI's axis and now-indicator default to different styles ("03 pm" vs "15:44"); format both
    // with one helper so they agree. The drag-selection label can't be templated, so it's hidden via
    // CSS and redrawn as an overlay in _syncSelectionOverlay to match.
    return {
      timegridDisplayPrimaryTime: ({ time }) => formatHourMinute(time, this._timeFormat.get()),
      timegridNowIndicatorLabel: ({ time }) => formatHourMinute(time, this._timeFormat.get()),
    };
  }

  // Push changed time-format / week-start options onto the live calendar.
  private _applyCalendarOptions() {
    if (!this._calendar) { return; }
    const timeFormat = this._timeFormat.get();
    if (timeFormat !== this._appliedTimeFormat) {
      this._appliedTimeFormat = timeFormat;
      this._calendar.setOptions({ template: this._timeTemplates() });
    }
    const weekStart = this._weekStart.get();
    if (weekStart !== this._appliedWeekStart) {
      this._appliedWeekStart = weekStart;
      const startDayOfWeek = weekStartToIndex(weekStart);
      this._calendar.setOptions({ week: { startDayOfWeek }, month: { startDayOfWeek } });
    }
  }

  // When the mapped columns have no time-of-day, hide the Day/Week hour grid (eventView: ['allday'])
  // so timeless rows read as a task list instead of bars above an empty 24-hour grid.
  private _applyEventView(allDayOnly: boolean) {
    if (!this._calendar || allDayOnly === this._appliedAllDayOnly) { return; }
    this._appliedAllDayOnly = allDayOnly;
    this._calendar.setOptions({ week: { eventView: allDayOnly ? ["allday"] : true } });
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
        dayName: { backgroundColor: "inherit" },
        dayExceptThisMonth: { color: textColor },
        holidayExceptThisMonth: { color: textColor },
      },
    };
  }

  private _wireCalendarEvents() {
    const cal = this._calendar!;

    cal.on("clickEvent", ({ event }) => {
      const rowId = Number(event.id);
      if (!rowId || Number.isNaN(rowId)) { return; }
      this._selectRow(rowId);
    });

    // Double-click opens the Record Card. TUI doesn't emit a double-click event for an event item,
    // and a native double-click only produces a single TUI clickEvent, so we can't synthesize one
    // from two clickEvents. Instead we listen for the native DOM dblclick, which does reach the
    // grid, and resolve the event from the clicked element's data-event-id.
    this._calendarDom.addEventListener("dblclick", (ev) => {
      const eventEl = (ev.target as HTMLElement | null)?.closest("[data-event-id]");
      const rowId = eventEl && Number(eventEl.getAttribute("data-event-id"));
      if (!rowId || Number.isNaN(rowId)) { return; }
      // Double-click landed on an event, not an empty cell: open the Record Card for its row.
      this._selectRow(rowId);
      this._openRecordCardFor(rowId);
    });

    // Drag on empty grid space to create: add the Grist row for the dragged range, then open
    // Grist's Record Card on it (the same editor double-clicking an event opens) so the user fills
    // in the rest. Only the create path opens the card; drag/resize of an existing event doesn't.
    // With the form popup off, TUI fires `selectDateTime` (not `beforeCreateEvent`, which only comes
    // from that popup's Save button) when a grid drag completes; it carries the dragged start/end
    // and all-day flag, which is all we need to seed the new row.
    cal.on("selectDateTime", async ({ start, end, isAllday }) => {
      if (!this._tzDate) { return; }
      // selectDateTime hands back plain Dates; _upsertFromToast -> _makeGristDateTime needs a TZDate
      // (it calls .tz()), so wrap them the same way _assignDate does.
      const startTz = new this._tzDate(start) as unknown as EventObject["start"];
      const endTz = new this._tzDate(end) as unknown as EventObject["end"];
      const rowId = await this._upsertFromToast(null, { start: startTz, end: endTz, isAllday });
      // The AddRecord above is awaited, so the section may have been disposed (and `cal` destroyed)
      // by now; bail before touching the calendar so we don't dispatch into a torn-down store.
      if (this.isDisposed()) { return; }
      cal.clearGridSelections();
      if (rowId) { this._openRecordCardFor(rowId); }
    });
    cal.on("beforeUpdateEvent", ({ event, changes }) =>
      this._upsertFromToast(Number(event.id), changes));
    cal.on("beforeDeleteEvent", event => this._deleteEvent(Number(event.id)));

    // Clear leftover grid selections, mirroring the upstream workaround for nhn/tui.calendar#1300.
    this._calendarDom.addEventListener("mousedown", () => cal.clearGridSelections());
    // TODO(O4): the original custom widget worked around a TUI bug where a too-fast mouseup left
    // a stale drag (it called the v1-only `cancelDrag()`). TUI v2 doesn't expose an equivalent
    // public API; leaving as a known gap rather than risking a wrong fix. Resurrect via a
    // private-API call (and a comment) if QA hits the bug on touch devices.

    // Redraw our 12-hour drag-selection overlay on every grid mutation. The drag-to-select guide
    // label is the one time label TUI builds itself (as raw 24-hour "14:00 - 16:30"), with no
    // template hook, and it re-renders (via Preact) on every drag frame. Rather than fight that
    // reconciliation by editing its text, we hide it (cssCalendarContainer) and draw our own
    // overlay here. characterData is added to the observe options below so we also react when only
    // the label's text changes as the drag extends.
    const observer = new MutationObserver(() => this._maybeSyncSelectionOverlay());
    // childList+subtree catches the selection box appearing/disappearing; characterData catches the
    // label's raw time changing in place as the drag extends (a text-only update wouldn't fire the
    // other two). All three keep _syncSelectionOverlay in step with TUI's own render.
    observer.observe(this._calendarDom, { childList: true, subtree: true, characterData: true });
    // Scrolling the time grid moves TUI's selection box without mutating the DOM, so the mutation
    // observer above wouldn't fire and our fixed-position overlay would drift away from the box.
    // Re-sync on scroll too (capture phase, since the scroll happens on an inner grid element, not
    // on _calendarDom itself).
    const onScroll = () => this._maybeSyncSelectionOverlay();
    this._calendarDom.addEventListener("scroll", onScroll, true);
    this.onDispose(() => {
      observer.disconnect();
      this._calendarDom.removeEventListener("scroll", onScroll, true);
      this._clearSelectionOverlay();
    });
  }

  // Fast gate for the hot callers (mutation observer + scroll): skip the full overlay sync when
  // there's no live selection and no lingering overlay to clean up.
  private _maybeSyncSelectionOverlay() {
    if (!this._calendarDom) { return; }
    const hasSelection = Boolean(this._calendarDom.querySelector(".toastui-calendar-grid-selection"));
    if (!hasSelection && this._selectionLabels.length === 0) { return; }
    this._syncSelectionOverlay();
  }

  // Draws our own 12-hour guide labels over TUI's hidden ones during a drag selection. There is one
  // TUI selection box (`.toastui-calendar-grid-selection`) per selected column; each carries a
  // `.toastui-calendar-grid-selection-label` whose raw text is "HH:MM - HH:MM" (or a bare "HH:MM" on
  // the non-starting columns of a multi-column drag). We reuse a pool of body-level overlay nodes
  // (one per box), position each over its box via getBoundingClientRect, and set its text to the
  // 12-hour form. Idempotent and cheap: it runs on every grid mutation, reuses nodes, and does
  // nothing beyond a rect read + text/style writes. Any surplus pooled nodes (selection shrank or
  // cleared) are removed, so nothing dangles once the selection is gone.
  private _syncSelectionOverlay() {
    if (!this._calendarDom) { return; }
    // One selection box per selected column; its label span sits at the box's top-left, which is
    // where TUI draws the (now hidden) raw label, so we position our overlay at the box's corner.
    // We read the box rect rather than the label's, because the label collapses to a zero-size box
    // once hidden (see cssCalendarContainer) and can't give us a position.
    const boxes = this._calendarDom.querySelectorAll(".toastui-calendar-grid-selection");
    // `used` is a compact running count of overlays we actually placed this frame; boxes with no
    // recognizable time text are skipped without leaving a hole, so the pool stays dense and the
    // trailing splice below prunes exactly the surplus.
    let used = 0;
    for (const box of boxes) {
      const label = box.querySelector(".toastui-calendar-grid-selection-label");
      const text = label && formatSelectionLabel(label.textContent || "", this._timeFormat.get());
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

  // Reading data

  private _updateView() {
    if (this.isDisposed() || !this._calendar) { return; }

    const mapping = this._mapping();
    const startCol = this._col(mapping.startDate);
    const titleCol = this._col(mapping.title);
    // Both required columns must be mapped to show anything.
    if (!startCol || !titleCol) {
      this._allEvents = new Map();
      this._applyEventView(false);
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

    // Resolve column types, choice styling and the doc timezone once, not per row.
    const startType = startDisplay.pureType.peek();
    const endType = endDisplay?.pureType.peek() || startType;
    const choiceOptions = typeDisplay?.widgetOptionsJson.peek()?.choiceOptions || {};
    const docTz = this._docTimeZone();

    // When both mapped date columns are date-only (no time-of-day), every event is all-day, so drop
    // the empty hour grid in Day/Week and show just the event list. Same condition that forces
    // isAllday per row in _buildEvent below, so the two stay in step.
    this._applyEventView(isDateOnlyType(startType) && isDateOnlyType(endType));

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
      // A row needs a start date to be placed on the grid. Rows without one can't be shown, so we
      // skip them. (If a row has a start but no title yet, e.g. just created by a drag before the
      // user fills in the Record Card, we still show it with a placeholder so it doesn't vanish.)
      if (!startDate) { continue; }
      const record: CalendarRecord = {
        id: rowId,
        startDate,
        endDate: getEnd ? numToDate(getEnd(rowId)) : null,
        isAllDay: getAllDay ? Boolean(getAllDay(rowId)) : undefined,
        title: title ?? t("New Event"),
        type: getType ? asChoice(getType(rowId)) : "",
      };
      events.push([rowId, this._buildEvent(record, startType, endType, choiceOptions, docTz)]);
    }

    this._allEvents = new Map(events);
    this._renderVisibleEvents();
    this._updateTitle();
    this._refreshSelectedRecord();
  }

  private _buildEvent(
    record: CalendarRecord, startType: string, endType: string, choiceOptions: Record<string, any>,
    docTz: string,
  ): EventObject {
    const start = this._getAdjustedDate(record.startDate!, startType, docTz);
    let end = record.endDate ? this._getAdjustedDate(record.endDate, endType, docTz) : start;

    // Normalize invalid ranges so the event is still visible.
    if (end < start) { end = start; }

    let isAllday = record.isAllDay;
    if (isDateOnlyType(startType) && isDateOnlyType(endType)) { isAllday = true; }
    // Workaround for midnight zero-length events not showing up.
    if (!isAllday && end.valueOf() === start.valueOf() && isZeroTime(end) && isZeroTime(start)) {
      end = new this._tzDate!(end).addHours(1) as unknown as Date;
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
      // TUI's EventState is "Busy" | "Free"; we treat all Grist rows as Free since we don't
      // track availability semantics. Typed via EventObject["state"] rather than a bare literal
      // so a TUI rename surfaces at compile time.
      state: "Free" satisfies NonNullable<EventObject["state"]>,
      backgroundColor,
      color,
      borderColor: backgroundColor,
      dragBackgroundColor: theme.hover.toString(),
      // Remember base colors so _setHighlight can restore them after a selection.
      raw: { backgroundColor, color },
      customStyle: { fontStyle, fontWeight, textDecoration, textWrap: "auto" },
    } as EventObject;
  }

  // Timezone handling (ported from the calendar widget)

  private _docTimeZone(): string {
    return this.gristDoc.docInfo.timezone.peek();
  }

  /** Shifts a UTC-based JS Date so it displays correctly for the given column type. */
  private _getAdjustedDate(date: Date, colType: string, docTz: string): Date {
    // The `timezone` property exists on TZDate (TUI's wrapper) but not on plain Date; we still
    // call this with both, so probe the field rather than narrowing the parameter type.
    const dateTz = (date as Date & { timezone?: string }).timezone;
    if (docTz && docTz !== dateTz && isDateTime(colType)) {
      return new this._tzDate!(date).tz(docTz) as unknown as Date;
    }
    if (!isDateOnlyType(colType)) { return date; }
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
    if (isDateOnlyType(colType)) {
      const secondsSinceEpoch = unixTime + localOffsetMin * 60;
      return Math.floor(secondsSinceEpoch / SECONDS_PER_DAY) * SECONDS_PER_DAY;
    } else {
      unixTime += (localOffsetMin - docOffsetMin) * 60;
      return unixTime;
    }
  }

  // Writing data

  // On the create path (rowId === null) returns the new row's id, so the caller can open the
  // Record Card on it; returns null on the update path or when nothing was written.
  private async _upsertFromToast(rowId: number | null, tui: Partial<EventObject>): Promise<number | null> {
    if (this._isReadOnly()) { return null; }
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
    if (Object.keys(fields).length === 0) { return null; }

    try {
      if (rowId) {
        await this.sendTableAction(["UpdateRecord", rowId, fields] as UserAction);
      } else {
        const newRowId = await this.sendTableAction(["AddRecord", null, fields] as UserAction);
        // setCursorPos triggers _selectRecord on a rowId whose event isn't in _allEvents yet
        // (rowNotify fires asynchronously). _selectedRecordId acts as a pending pointer; the next
        // _updateView (via rowNotify) reconciles the highlight through _refreshSelectedRecord.
        // The cursor lands on the new row before we return, so the caller can open the Record Card.
        if (newRowId && !this.isDisposed()) {
          this.setCursorPos({ rowId: newRowId });
          return newRowId;
        }
      }
    } catch (err) {
      reportError(err as Error);
    }
    return null;
  }

  private async _deleteEvent(rowId: number) {
    if (this._isReadOnly() || !rowId) { return; }
    try {
      await this.deleteRows([rowId]);
    } catch (err) {
      reportError(err as Error);
    }
  }

  // The currently-selected event's row, so BaseView's deleteRecords command (bound to the Delete
  // key while the section has focus) removes it. BaseView.selectedRows() returns [] by default,
  // which is why Delete does nothing on a calendar until we point it at the selected event.
  protected selectedRows(): number[] {
    return this._selectedRecordId ? [this._selectedRecordId] : [];
  }

  // Move the grid cursor (and active section) to a row, so clicking an event lights up its row.
  private _selectRow(rowId: number) {
    this.gristDoc.viewModel.activeSectionId(this.viewSection.getRowId());
    this.setCursorPos({ rowId });
  }

  // Opens Grist's Record Card for a specific rowId, independent of the grid cursor. We can't reuse
  // BaseView.viewSelectedRecordAsCard here: on create the new row isn't in sortedRows yet (rowNotify
  // is async) so the cursor-derived rowId is stale, and a calendar section has no view fields for the
  // colRef it reads. The card only needs rowId + the record-card sectionId (see GristDoc), so push
  // that url hash directly.
  private _openRecordCardFor(rowId: number) {
    if (this.isRecordCardDisabled()) { return; }
    const sectionId = this.viewSection.tableRecordCard().id();
    urlState().pushUrl({ hash: { rowId, sectionId, recordCard: true } }, { replace: true }).catch(reportError);
  }

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

  // Highlights (or un-highlights) an event with the primary color. The accent is normally the left
  // border, but a single-day month event has none (dot or filled bar), so there we tint the fill.
  // Passing the full color set in one updateEvent is what makes TUI repaint; a lone change does not.
  private _setHighlight(rowId: number, selected: boolean) {
    const cal = this._calendar;
    const event = cal?.getEvent(String(rowId), CALENDAR_NAME);
    if (!cal || !event) { return; }
    const base = event.raw?.backgroundColor ?? theme.inputReadonlyBorder.toString();
    const baseColor = event.raw?.color ?? theme.text.toString();
    const accent = theme.controlPrimaryBg.toString();
    // Which property carries the accent: the fill (backgroundColor) for a single-day month event,
    // else the left border. Start from the base for both so the previous highlight is cleared.
    const useFill = this._isSingleDayInMonthView(event);
    cal.updateEvent(String(rowId), CALENDAR_NAME, {
      borderColor: selected && !useFill ? accent : base,
      backgroundColor: selected && useFill ? accent : base,
      color: baseColor,
    });
  }

  // True when this event occupies a single day in month view. Such events render as a dot (timed) or
  // a filled bar (all-day), neither of which has a border for _setHighlight to accent, so it tints
  // the fill instead. Multi-day month bars (which do have a border) and day/week views are excluded.
  private _isSingleDayInMonthView(event: EventObject): boolean {
    if (this._calendar?.getViewName() !== "month") { return false; }
    const start = (event.start as TZDate).toDate();
    const end = (event.end as TZDate).toDate();
    return start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
  }

  // Navigation & rendering

  /** Adds/updates events in the visible range and removes those that scrolled out of it. */
  private _renderVisibleEvents() {
    const cal = this._calendar;
    if (!cal) { return; }
    const rangeStart = cal.getDateRangeStart().getTime();
    // Copy before calling setHours, which mutates in place. TUI may hand back a reference to its
    // internal range-end, so shifting it would creep the visible window forward each render.
    const rangeEndDate = (cal.getDateRangeEnd()).toDate();
    rangeEndDate.setHours(23, 59, 59, 999);
    const rangeEnd = rangeEndDate.getTime();

    const nowVisible = new Set<number>();
    const toCreate: EventObject[] = [];
    for (const [rowId, event] of this._allEvents) {
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
    this._titleDom.textContent = this._formatTitle();
  }

  // Title shown in the toolbar above the calendar grid.
  // - day view: a full date (e.g. "Wed, 9 Aug 2023").
  // - week view: the visible date range (e.g. "6 - 12 Aug 2023", or "30 Jul - 5 Aug 2023" when
  //   the week straddles a month boundary).
  // - month view: month + year.
  // TUI doesn't expose its own header text, but it does expose getDate / getDateRange* which give
  // us enough to derive these formats consistently.
  private _formatTitle(): string {
    const cal = this._calendar!;
    const view = cal.getViewName();
    const current = cal.getDate().toDate();
    if (view === "day") {
      return current.toLocaleDateString(undefined, {
        weekday: "short", day: "numeric", month: "short", year: "numeric",
      });
    }
    if (view === "week") {
      const start = cal.getDateRangeStart().toDate();
      const end = cal.getDateRangeEnd().toDate();
      const sameYear = start.getFullYear() === end.getFullYear();
      const sameMonth = sameYear && start.getMonth() === end.getMonth();
      const startFmt: Intl.DateTimeFormatOptions = sameMonth ?
        { day: "numeric" } :
        (sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
      const endFmt: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
      return `${start.toLocaleDateString(undefined, startFmt)} - ${end.toLocaleDateString(undefined, endFmt)}`;
    }
    return current.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  // DOM

  private _isReadOnly(): boolean {
    return this.gristDoc.isReadonly.get() || this.disableEditing.peek();
  }

  private _buildDom() {
    // Build all field-bound nodes into locals first, then compose; easier to grep for the
    // _titleDom / _calendarDom assignments than spotting them inline in a tree literal.
    this._titleDom = cssCalendarTitle(testId("title"));
    this._calendarDom = cssCalendarContainer(testId("widget"));
    const navGroup = cssNavGroup(
      basicButton(icon("ArrowLeft"),
        dom.on("click", () => this._go("prev")), testId("prev")),
      basicButton(t("Today"), dom.on("click", () => this._go("today")), testId("today")),
      basicButton(icon("ArrowRight"),
        dom.on("click", () => this._go("next")), testId("next")),
    );
    // Day/Week/Month is a segmented toggle: the standard Grist button group, with the current view
    // shown as a primary button (so it uses the same active/hover colors as every other control).
    const perspectiveGroup = cssPerspectiveGroup(
      ...PERSPECTIVES.map(view =>
        button(
          { primary: use => use(this._perspective) === view },
          perspectiveLabel(view),
          dom.on("click", () => this._setPerspective(view)),
          testId(`perspective-${view}`),
        ),
      ),
    );
    return cssCalendarView(
      testId("container"),
      cssToolbar(navGroup, this._titleDom, this._buildOptionsGroup(), perspectiveGroup),
      cssCalendarBody(
        this._calendarDom,
      ),
    );
  }

  private _buildOptionsGroup() {
    return cssOptionsGroup(
      dom("div", testId("time-format"),
        linkSelect<TimeFormat>(this._timeFormat, [
          { value: "12h", label: t("12-hour") },
          { value: "24h", label: t("24-hour") },
        ]),
      ),
      dom("div", testId("week-start"),
        linkSelect<WeekStart>(this._weekStart, [
          { value: "sun", label: t("Week: Sun") },
          { value: "mon", label: t("Week: Mon") },
        ]),
      ),
    );
  }

}

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

function buildTextDecoration(style: Record<string, any>): string {
  const parts: string[] = [];
  if (style.fontUnderline) { parts.push("underline"); }
  if (style.fontStrikethrough) { parts.push("line-through"); }
  return parts.length ? parts.join(" ") : "none";
}

function asChoice(value: CellValue | undefined): string {
  if (!value) { return ""; }
  const decoded = decodeObject(value);
  return String(Array.isArray(decoded) ? (decoded[0] ?? "") : decoded);
}

// Localized label for a perspective toolbar button. A switch with literal t(...) keys (rather than
// t(capitalize(view))) so the i18n string extractor can find "Day"/"Week"/"Month".
function perspectiveLabel(view: Perspective): string {
  switch (view) {
    case "day": return t("Day");
    case "week": return t("Week");
    case "month": return t("Month");
  }
}

// Hour labels for the axis, now-indicator, and drag-selection overlay, in the widget's 12h ("3:00
// pm") or 24h ("15:00") style. The argument is a TUI TZDate, which exposes getHours()/getMinutes()
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

// TUI's startDayOfWeek index: 0=Sun..6=Sat. We only offer Sunday/Monday in the UI.
function weekStartToIndex(start: WeekStart): number {
  return start === "mon" ? 1 : 0;
}

// The week-start default when the widget option is unset: Monday if the browser locale starts its
// week on Monday, otherwise Sunday. (Intl: 1=Mon..7=Sun; a locale firstDay of 7 means Sunday.)
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

// The time-format default when the widget option is unset: 24h if the browser locale formats an
// afternoon time without an am/pm marker, otherwise 12h.
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

// Styles

const cssCalendarView = styled("div", `
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: ${theme.mainPanelBg};
  color: ${theme.text};
`);

// Shared height for every toolbar button (nav arrows/today + the Day/Week/Month toggle), so an
// icon button and a text button render at the same height. Matches Grist's small-control sizing
// (base cssButton is padding 4px + 1px border + mediumFontSize line-box, i.e. ~28px).
const TOOLBAR_BUTTON_HEIGHT = "28px";

// Single row: nav group and perspective group keep their natural width (flex: none) and are never
// clipped; only the title flexes and truncates under pressure (see cssCalendarTitle). min-width: 0
// lets the toolbar shrink inside the section; overflow-x: auto is the last-resort escape for the
// extreme case where the two button groups alone exceed the section width, so the toolbar scrolls
// internally instead of pushing the whole section sideways.
const cssToolbar = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  min-width: 0;
  overflow-x: auto;
  border-bottom: 1px solid ${theme.tableBodyBorder};
  flex: none;
`);

const cssNavGroup = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  & > .${cssButton.className} {
    height: ${TOOLBAR_BUTTON_HEIGHT};
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`);

// Extends cssButtonGroup (rounded outer corners, zeroed inner corners). We add two things:
// a uniform button height (so text and icon buttons match the nav group), and collapsed borders
// so adjacent buttons share a single 1px seam instead of stacking two. margin-left: -1px on every
// child but the first overlaps its left border onto the previous button's right border; the
// hovered/primary button is raised (position + z-index) so its border paints on top of neighbors.
const cssPerspectiveGroup = styled(cssButtonGroup, `
  align-items: center;
  margin-left: auto;
  flex: none;
  & > .${cssButton.className} {
    height: ${TOOLBAR_BUTTON_HEIGHT};
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  & > .${cssButton.className}:not(:first-child) {
    margin-left: -1px;
  }
  & > .${cssButton.className}:hover,
  & > .${cssButton.className}-primary {
    position: relative;
    z-index: 1;
  }
`);

// The 12h/24h and week-start dropdowns, sitting just left of the Day/Week/Month toggle. flex: none
// so they keep their natural width; the title (flex) absorbs the slack and truncates first.
const cssOptionsGroup = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
  flex: none;
  white-space: nowrap;
`);

// The title takes the leftover space and truncates rather than forcing the toolbar wider.
const cssCalendarTitle = styled("div", `
  font-weight: 600;
  font-size: 15px;
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

// Holds the calendar grid, filling the space below the toolbar.
const cssCalendarBody = styled("div", `
  display: flex;
  flex: 1 1 0;
  min-height: 0;
`);

// The drag-selection guide label is the one time label TUI builds itself (raw 24-hour, e.g.
// "08:00 - 11:00"), with no template hook. We hide it and draw our own 12-hour overlay instead
// (see _syncSelectionOverlay); the alternative of rewriting TUI's text node fights Preact, which
// re-renders the label every drag frame and double-renders (stale + raw) against our edit.
// We must beat TUI's own rule for this label, which is a 3-class selector
// (".toastui-calendar-column .toastui-calendar-grid-selection .toastui-calendar-grid-selection-label")
// AND sets the label color inline via a style prop. So we mirror that selector chain (to win on
// specificity) and hide with visibility, which the inline color can't override and which still keeps
// the box's layout intact so we can hit-test it to position our overlay.
const cssCalendarContainer = styled("div", `
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

// Our own drag-selection guide label, drawn over TUI's hidden one (see cssCalendarContainer). One
// per selected column; positioned fixed via each selection box's getBoundingClientRect, so it needs
// no offset-parent math. We recompute it on every grid mutation and on scroll (see _wireCalendarEvents)
// so it stays over the box. Lives on document.body, outside TUI's Preact-managed container, so Preact
// never reconciles against it. pointer-events:none so it never intercepts the ongoing drag.
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
