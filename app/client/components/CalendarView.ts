import BaseView from "app/client/components/BaseView";
import {
  CalendarExt, CalendarHost, CalendarRecord, cssCalendarContainer, getCalendarColumns, Perspective,
  PERSPECTIVES,
} from "app/client/components/CalendarExt";
import { GristDoc } from "app/client/components/GristDoc";
import { Delay } from "app/client/lib/Delay";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { basicButton, button, cssButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { gristThemeObs } from "app/client/ui2018/theme";
import { CellValue, UserAction } from "app/common/DocActions";
import { isDateOnlyType } from "app/common/gristTypes";
import { WidgetColumnMap } from "app/plugin/CustomSectionAPI";
import { UIRowId } from "app/plugin/GristAPI";
import { decodeObject } from "app/plugin/objtypes";

import { Computed, dom, fromKo, Holder, makeTestId, MultiHolder, styled } from "grainjs";
import debounce from "lodash/debounce";

import type { EventObject, TZDate } from "@toast-ui/calendar";

const t = makeT("CalendarView");
const testId = makeTestId("test-calendar-");

/**
 * CalendarView renders records of the underlying table as events in a Toast UI Calendar, with
 * day/week/month perspectives.
 *
 * This is the Grist half: column mapping, reading rows, writing user actions, cursor linking and
 * the toolbar. The calendar itself lives in CalendarExt, which holds what we kept from the bundled
 * "calendar" custom widget (grist-widget repo, calendar/page.js). The two talk through the
 * CalendarHost methods on this class: CalendarExt reports row ids, and this class turns them
 * into Grist actions.
 *
 * Almost nothing here comes from the widget. The widget ran in an iframe and reached Grist through
 * the plugin API (grist.onRecords, mapColumnNames, getTable().create/update/destroy). It also had a
 * ColTypesFetcher class that read _grist_Tables_column by hand, because the API could not tell it
 * the column types. Here we read the view section directly, so types, display columns and choice
 * options are all available at once. The few ported parts say so where they appear.
 */
export class CalendarView extends BaseView implements CalendarHost {
  private _calendar: CalendarExt | null = null;

  private _calendarDom: HTMLElement;
  private _titleDom: HTMLElement;

  // All events by Grist rowId, rebuilt by _updateView and handed to CalendarExt to render.
  private _allEvents = new Map<number, EventObject>();
  private _selectedRecordId: number | null = null;

  private _perspective = Computed.create(this,
    fromKo(this.viewSection.optionsObj.prop("calendarViewPerspective")),
    (_use, view) => (view && PERSPECTIVES.includes(view) ? view : "week"));

  private _update = debounce(() => this._updateView(), 0);
  private _resize = this.autoDispose(Delay.untilAnimationFrame(() => this._calendar?.render(), this));

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    // First build the dom that will be added to the dom. For now it will be empty, just elements
    // we will bind data to it a moment later.
    this.viewPane = this._buildDom();
    this.onDispose(() => {
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    // Now configure the section reusing some of the custom widget setup.
    this.viewSection.columnsToMap(getCalendarColumns()); // this will be used in the Right Panel for setup.
    this.viewSection.allowSelectBy(true); // Allow select by default, reusing custom widget api for that. 
    this.onDispose(() => {
      if (this.viewSection.isDisposed()) { return; }
      // Tidy up things we changed, probably not needed, but to be clean.
      this.viewSection.columnsToMap(null);
      this.viewSection.allowSelectBy(false);
    });

    // Re-render events when data, mapping, perspective or theme change.
    this.listenTo(this.sortedRows, "rowNotify", this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));

    // Re-render when the mapping changes _or_ when one of the mapped columns' types changes
    // (Text -> Numeric, Date <-> DateTime, etc.). Mirrors ChartView's per-field type listener.
    // The widget gave up on this ("no good way to know when a column's type is changed").
    const typeSubs = Holder.create<MultiHolder>(this);
    this.autoDispose(this.viewSection.mappedColumns.subscribe(() => {
      this._update();
      // Replaces the previous batch: creating into the Holder disposes whatever it held.
      const owner = MultiHolder.create(typeSubs);
      for (const col of this._mappedColumnList()) {
        owner.autoDispose(col.type.subscribe(this._update));
        owner.autoDispose(col.displayColModel.peek().type.subscribe(this._update));
      }
    }));

    this.autoDispose(this._perspective.addListener(view => this._calendar?.changeView(view)));
    // Event colors are set to CSS-variable strings, so they re-resolve on theme change with no
    // data rebuild; we only need to re-apply the calendar chrome theme.
    this.autoDispose(gristThemeObs().addListener(() => this._calendar?.setTheme()));

    // Reflect the table cursor onto the calendar (selection + navigation).
    this.autoDispose(this.cursor.rowId.subscribe(rowId => this._selectRecord(rowId)));

    this.init().catch(reportError);

    // A small, stable handle for nbrowser tests, so they do not have to reach into private fields.
    // It always points at the newest live view, and we clear it on dispose. Only tests read it,
    // through window.gristCalendarView (see test/nbrowser/CalendarView.ts).
    (window as any).gristCalendarView = this._testHook();
    this.onDispose(() => {
      if ((window as any).gristCalendarView?._view === this) {
        delete (window as any).gristCalendarView;
      }
    });
  }

  /**
   * The async part of the constructor. The Toast UI module is loaded on demand, so the calendar
   * cannot exist yet when the constructor returns. The constructor starts this and does not wait
   * for it; everything that needs a live calendar checks `this._calendar` first.
   */
  public async init() {
    const calendar = await CalendarExt.load(
      this, this._calendarDom, this._titleDom, this._perspective.get());
    if (!calendar) { return; }   // the section was disposed while TUI was loading
    this._calendar = this.autoDispose(calendar);

    // disableEditing is a ko.computed that depends on linking state (BaseView.ts), so it can flip
    // after init when the section becomes a link target. Mirror its current value onto TUI so
    // drag-to-edit and drag-to-create follow the read-only flag.
    this.autoDispose(this.disableEditing.subscribe(() => calendar.setReadOnly(this.isReadOnly())));
    // The TUI constructor already opened `defaultView` (this._perspective), so no changeView here;
    // _updateView renders the events and title.
    this._updateView();
    // Apply the current cursor now that the calendar and its events exist: the cursor subscription
    // only fires on later changes, so an event the cursor already sits on (e.g. reopening a view
    // with a set cursor) wouldn't be highlighted until the cursor next moved.
    this._selectRecord(this.cursor.rowId.peek());
  }

  public onResize() {
    this._resize();
  }

  // CalendarHost: CalendarExt calls this and the on* methods when the user acts on the grid. It
  // passes row ids and dates, and turning those into Grist actions is this class's job.
  public isReadOnly(): boolean {
    return this.gristDoc.isReadonly.get() || this.disableEditing.peek();
  }

  // Move the grid cursor (and active section) to a row, so clicking an event lights up its row.
  public onSelect(rowId: number) {
    this.gristDoc.viewModel.activeSectionId(this.viewSection.getRowId());
    this.setCursorPos({ rowId });
  }

  // Opens Grist's Record Card for a specific rowId, independent of the grid cursor. We can't reuse
  // BaseView.viewSelectedRecordAsCard here: on create the new row isn't in sortedRows yet (rowNotify
  // is async) so the cursor-derived rowId is stale, and a calendar section has no view fields for the
  // colRef it reads. The card only needs rowId + the record-card sectionId (see GristDoc), so push
  // that url hash directly.
  //
  // Same idea as the calendar widget's dblclick handler (page.js), but no shared code: the widget
  // ran `grist.commandApi.run('viewAsCard')` after moving the cursor. In-app there is no command
  // API to call, so we push the record-card url hash ourselves.
  public onOpen(rowId: number) {
    if (this.isRecordCardDisabled()) { return; }
    const sectionId = this.viewSection.tableRecordCard().id();
    urlState().pushUrl({ hash: { rowId, sectionId, recordCard: true } }, { replace: true }).catch(reportError);
  }

  public async onCreate(start: TZDate, end: TZDate, isAllDay: boolean): Promise<number | null> {
    return this._upsert(null, { start, end, isAllday: isAllDay } as Partial<EventObject>);
  }

  public onUpdate(rowId: number, changes: Partial<EventObject>) {
    this._upsert(rowId, changes).catch(reportError);
  }

  public onDelete(rowId: number) {
    if (this.isReadOnly() || !rowId) { return; }
    this.deleteRows([rowId])?.catch(reportError);
  }

  public onNavigate() {
    this._refreshSelectedRecord();
  }

  protected onTableLoaded() {
    super.onTableLoaded();
    this._update();
  }

  // The currently-selected event's row, so BaseView's deleteRecords command (bound to the Delete
  // key while the section has focus) removes it. BaseView.selectedRows() returns [] by default,
  // which is why Delete does nothing on a calendar until we point it at the selected event.
  protected selectedRows(): number[] {
    return this._selectedRecordId ? [this._selectedRecordId] : [];
  }

  private _mapping(): WidgetColumnMap {
    return this.viewSection.mappedColumns() || {};
  }

  private _col(value: string | string[] | null | undefined): ColumnRec | null {
    const colId = Array.isArray(value) ? value[0] : value;
    if (!colId) { return null; }
    return this.viewSection.columns.peek().find(c => c.colId.peek() === colId) || null;
  }

  // Resolves one mapped column into everything a rebuild needs from it. Returns null when the
  // column isn't mapped, so callers can treat "unmapped" and "missing" the same way.
  private _field(key: string): Field | null {
    const col = this._col(this._mapping()[key]);
    if (!col) { return null; }
    const display = col.displayColModel.peek();
    return {
      colId: col.colId.peek(),
      type: col.pureType.peek(),
      displayType: display.pureType.peek(),
      widgetOptions: display.widgetOptionsJson.peek(),
      get: this.tableModel.tableData.getRowPropFunc(display.colId.peek()),
    };
  }

  // All ColumnRecs currently referenced by the calendar's mapping (deduplicated). Used to wire
  // type-change subscriptions, since the calendar's rendering depends on each column's pureType.
  private _mappedColumnList(): ColumnRec[] {
    const cols = Object.values(this._mapping())
      .map(value => this._col(value))
      .filter((c): c is ColumnRec => c !== null);
    return Array.from(new Set(cols));
  }

  private _updateView() {
    const cal = this._calendar;
    if (this.isDisposed() || !cal) { return; }
    this._allEvents = this._buildEvents(cal);
    cal.setEvents(this._allEvents);
    cal.updateTitle();
    this._refreshSelectedRecord();
  }

  /**
   * Reads every row through the current mapping and returns the events by rowId. Empty when the two
   * required columns (start date and title) are not both mapped.
   *
   * The widget's equivalent (page.js updateCalendar) received already-mapped flat records from the
   * plugin API and awaited its ColTypesFetcher for types. Here we resolve the columns ourselves,
   * read values through per-column getters (getRowPropFunc, the approach ChartView uses) and build
   * synchronously.
   */
  private _buildEvents(cal: CalendarExt): Map<number, EventObject> {
    const start = this._field("startDate");
    const title = this._field("title");
    if (!start || !title) {
      cal.setAllDayOnly(false);
      return new Map();
    }
    const end = this._field("endDate");
    const allDay = this._field("isAllDay");
    const type = this._field("type");

    // Resolve column types, choice styling and the doc timezone once, not per row.
    const startType = start.displayType;
    const endType = end?.displayType || startType;
    const choiceOptions = type?.widgetOptions?.choiceOptions || {};
    const docTz = this._docTimeZone();

    // When both mapped date columns are date-only (no time-of-day), every event is all-day, so drop
    // the empty hour grid in Day/Week and show just the event list. Same condition that forces
    // isAllday per row in _buildEvent, so the two stay in step.
    cal.setAllDayOnly(isDateOnlyType(startType) && isDateOnlyType(endType));

    const events = new Map<number, EventObject>();
    for (const rowId of this.sortedRows.getKoArray().peek() as number[]) {
      if (typeof rowId !== "number") { continue; }
      const startDate = numToDate(start.get(rowId));
      // A row needs a start date to be placed on the grid. Rows without one can't be shown, so we
      // skip them. (If a row has a start but no title yet, e.g. just created by a drag before the
      // user fills in the Record Card, we still show it with a placeholder so it doesn't vanish.)
      if (!startDate) { continue; }
      const record: CalendarRecord = {
        id: rowId,
        startDate,
        endDate: end ? numToDate(end.get(rowId)) : null,
        isAllDay: allDay ? Boolean(allDay.get(rowId)) : undefined,
        title: asText(title.get(rowId)) ?? t("New Event"),
        type: type ? asChoice(type.get(rowId)) : "",
      };
      events.set(rowId, cal.buildEvent(record, startType, endType, choiceOptions, docTz));
    }
    return events;
  }

  private _docTimeZone(): string {
    return this.gristDoc.docInfo.timezone.peek();
  }

  // On the create path (rowId === null) returns the new row's id, so the caller can open the
  // Record Card on it; returns null on the update path or when nothing was written.
  private async _upsert(rowId: number | null, tui: Partial<EventObject>): Promise<number | null> {
    const cal = this._calendar;
    if (this.isReadOnly() || !cal) { return null; }
    const start = this._field("startDate");
    const end = this._field("endDate");
    const allDay = this._field("isAllDay");
    const title = this._field("title");
    const docTz = this._docTimeZone();
    // Dates are written in the real column's type, not the display column's: a Ref start date is
    // stored as the reference, while _buildEvents reads it through the visible column.
    const toGrist = (date: unknown, f: Field) => cal.makeGristDateTime(date as TZDate, f.type, docTz);

    const fields: Record<string, CellValue> = {};
    const identity = (v: unknown, _f: Field) => v as CellValue;
    const set = (field: typeof start, value: typeof tui.start, convert = identity) => {
      if (field && value !== undefined) { fields[field.colId] = convert(value, field); }
    };
    set(start, tui.start, toGrist);
    set(end, tui.end, toGrist);
    set(allDay, tui.isAllday);
    set(title, tui.title, v => (v as string) || t("New Event"));
    if (Object.keys(fields).length === 0) { return null; }

    try {
      if (rowId) {
        await this.sendTableAction(["UpdateRecord", rowId, fields] as UserAction);
      } else {
        const newRowId = await this.sendTableAction(["AddRecord", null, fields] as UserAction);
        // setCursorPos calls _selectRecord with a rowId that is not in _allEvents yet, because
        // rowNotify arrives later. _selectedRecordId just remembers the row for now, and the next
        // _updateView (started by rowNotify) draws the highlight in _refreshSelectedRecord.
        // The cursor moves to the new row before we return, so the caller can open the Record Card.
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

  private _selectRecord(rowId: UIRowId | null) {
    const cal = this._calendar;
    if (!cal) { return; }
    const next = typeof rowId === "number" ? rowId : null;
    if (next === this._selectedRecordId) { return; }

    // Always clear the previous highlight, even when there's no incoming event to highlight
    // (e.g. cursor moved off any mapped row, or to a row whose date columns are blank).
    if (this._selectedRecordId) { cal.setHighlight(this._selectedRecordId, false); }
    this._selectedRecordId = next;
    if (next === null) { return; }

    const event = this._allEvents.get(next);
    if (!event) { return; }

    cal.setDate(event.start as TZDate);
    cal.updateUIAfterNavigation();
  }

  private _refreshSelectedRecord() {
    if (this._selectedRecordId) { this._calendar?.setHighlight(this._selectedRecordId, true); }
  }

  private _setPerspective(view: Perspective) {
    // Persist the choice; this flows back through _perspective (toolbar active state) and its
    // listener (changeView), since setAndSave updates the underlying option synchronously.
    this.viewSection.optionsObj.prop("calendarViewPerspective").setAndSave(view).catch(reportError);
  }

  // Builds the toolbar and the container the calendar draws into.
  //
  // The widget's toolbar was hand-written HTML in index.html (Bootstrap buttons, radio inputs, and
  // a selectRadioButton() helper to keep their checked state right). Here it is grainjs, and the
  // active perspective is bound to the _perspective observable, so nothing needs syncing by hand.
  private _buildDom() {
    // Build all field-bound nodes into locals first, then compose; easier to grep for the
    // _titleDom / _calendarDom assignments than spotting them inline in a tree literal.
    this._titleDom = cssCalendarTitle(testId("title"));
    this._calendarDom = cssCalendarContainer(testId("widget"));
    const navGroup = cssNavGroup(
      basicButton(icon("ArrowLeft"),
        dom.on("click", () => this._calendar?.go("prev")), testId("prev")),
      basicButton(t("Today"), dom.on("click", () => this._calendar?.go("today")), testId("today")),
      basicButton(icon("ArrowRight"),
        dom.on("click", () => this._calendar?.go("next")), testId("next")),
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
      cssToolbar(navGroup, this._titleDom, perspectiveGroup),
      cssCalendarBody(
        this._calendarDom,
      ),
    );
  }

  // Test hook, not used by the view itself.
  //
  // Gives nbrowser tests one stable place to read the calendar state, instead of reaching into
  // private fields that a refactor would rename. Written to window.gristCalendarView by the
  // constructor and cleared on dispose. See test/nbrowser/CalendarView.ts.
  private _testHook() {
    // TZDate carries a timezone tag, so .local() gives back the original moment before .toDate().
    const getMs = (x: any) =>
      !x ? null : (x.toDate ? x.local().toDate().getTime() : new Date(x).getTime());
    const serialize = (ev?: EventObject) => !ev ? null : {
      title: ev.title, startMs: getMs(ev.start), endMs: getMs(ev.end), isAllDay: Boolean(ev.isAllday),
    };
    return {
      _view: this,
      getEventByRowId: (rowId: number) => serialize(this._allEvents.get(rowId)),
      getEventByTitle: (title: string) => serialize(
        [...this._allEvents.values()].find(e => e.title === title)),
      getSelectedRecordId: () => this._selectedRecordId,
      getViewName: () => this._calendar?.getViewName(),
      getCalendarDate: () => this._calendar?.getDate().toDate().toDateString(),
      setDate: (date: Date) => {
        if (!this._calendar) { return; }
        this._calendar.setDate(this._calendar.tzDate(date));
        this._calendar.updateUIAfterNavigation();
      },
    };
  }
}

/**
 * One mapped column, resolved for a single rebuild. `colId` and `type` describe the column we write
 * back to; `displayType`, `widgetOptions` and `get` read through its display column, so a Reference
 * surfaces its visible value (e.g. an event title) instead of the foreign row id. For non-Ref
 * columns the two are the same column. Mirrors ChartView's use of `displayColModel`.
 *
 * `get` is a per-column getter (getRowPropFunc), so reading a row is a plain array access rather
 * than a getValue() map lookup, again as ChartView does it.
 */
interface Field {
  colId: string;
  type: string;
  displayType: string;
  widgetOptions: any;
  get: (rowId: number) => CellValue | undefined;
}

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

// Localized label for a perspective toolbar button. A switch with literal t(...) keys (rather than
// t(capitalize(view))) so the i18n string extractor can find "Day"/"Week"/"Month".
function perspectiveLabel(view: Perspective): string {
  switch (view) {
    case "day": return t("Day");
    case "week": return t("Week");
    case "month": return t("Month");
  }
}

const cssCalendarView = styled("div", `
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: ${theme.mainPanelBg};
  color: ${theme.text};
`);

// Shared sizing for every toolbar button (nav arrows/today + the Day/Week/Month toggle), so an
// icon button and a text button render at the same height. Matches Grist's small-control sizing
// (base cssButton is padding 4px + 1px border + mediumFontSize line-box, i.e. ~28px).
const cssToolbarButtons = `
  & > .${cssButton.className} {
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`;

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
  ${cssToolbarButtons}
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
  ${cssToolbarButtons}
  & > .${cssButton.className}:not(:first-child) {
    margin-left: -1px;
  }
  & > .${cssButton.className}:hover,
  & > .${cssButton.className}-primary {
    position: relative;
    z-index: 1;
  }
`);

// The title takes the leftover space and truncates rather than forcing the toolbar wider.
const cssCalendarTitle = styled("div", `
  font-weight: 600;
  font-size: 15px;
  flex: 1 1 auto;
  min-width: 40px;
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
