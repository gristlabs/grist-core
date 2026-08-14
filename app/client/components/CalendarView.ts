import BaseView from "app/client/components/BaseView";
import {
  CalendarDates, CalendarRenderer, CalendarSource, EventContext, makeGristDateTime, ReadDates,
  ReadRecord,
} from "app/client/components/CalendarSource";
import {
  CalendarHost, CalendarWrapper, cssCalendarContainer, getCalendarColumns, Perspective, PERSPECTIVES,
} from "app/client/components/CalendarWrapper";
import { GristDoc } from "app/client/components/GristDoc";
import { Delay } from "app/client/lib/Delay";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { FilteredRowSource } from "app/client/models/rowset";
import { basicButton, button, cssButton, cssButtonGroup } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { gristThemeObs } from "app/client/ui2018/theme";
import { CellValue, UserAction } from "app/common/DocActions";
import { isDateOnlyType } from "app/common/gristTypes";
import { RowFilterFunc } from "app/common/RowFilterFunc";
import { WidgetColumnMap } from "app/plugin/CustomSectionAPI";
import { UIRowId } from "app/plugin/GristAPI";
import { decodeObject } from "app/plugin/objtypes";

import { Computed, dom, fromKo, Holder, makeTestId, MultiHolder, styled } from "grainjs";

import type { EventObject, TZDate } from "@toast-ui/calendar";

const t = makeT("CalendarView");
const testId = makeTestId("test-calendar-");

/**
 * CalendarView renders records of the underlying table as events in a Toast UI Calendar, with
 * day/week/month perspectives.
 *
 * This is the Grist half: column mapping, reading rows, writing user actions, cursor linking and
 * the toolbar. The calendar itself lives in CalendarWrapper. The two talk through the CalendarHost
 * methods on this class: CalendarWrapper reports row ids, and this class turns them into Grist
 * actions.
 */
export class CalendarView extends BaseView implements CalendarHost {
  private _calendar: CalendarWrapper | null = null;

  // The date index, rebuilt whenever the mapping or a mapped column's type changes. Held rather
  // than owned outright, because a rebuild replaces it: creating into a Holder disposes the old one
  // and its subscription with it.
  private _indexingSource = Holder.create<CalendarSource>(this);

  // The rows the grid currently shows, filtered out of the index by the visible date range. Lives
  // and dies with _source, which it reads the spans from.
  private _visibleSource = Holder.create<FilteredRowSource>(this);

  private _calendarDom: HTMLElement;
  private _titleDom: HTMLElement;

  private _selectedRecordId: number | null = null;

  private _perspective = Computed.create(this,
    fromKo(this.viewSection.optionsObj.prop("calendarViewPerspective")),
    (_use, view) => (view && PERSPECTIVES.includes(view) ? view : "week"));

  private _resize = this.autoDispose(Delay.untilAnimationFrame(() => this._calendar?.render(), this));

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    // Reuses the custom widget setup: columnsToMap drives the Right Panel mapping UI.
    this.viewSection.columnsToMap(getCalendarColumns());
    this.viewSection.allowSelectBy(true);
    this.onDispose(() => {
      if (this.viewSection.isDisposed()) { return; }
      this.viewSection.columnsToMap(null);
      this.viewSection.allowSelectBy(false);
    });

    // Rows added, removed or edited travel the pipeline _rebuildSource wires up; only what the
    // pipeline cannot carry is watched here. A mapped column's type change (Date <-> DateTime, and
    // so on) is as invalidating as a mapping change, since every span was worked out under the old
    // types, so both rebuild rather than redraw. Mirrors ChartView's per-field type listener.
    const typeSubs = Holder.create<MultiHolder>(this);
    const remap = () => this._rebuildSource();
    this.autoDispose(this.viewSection.mappedColumns.subscribe(() => {
      remap();
      // Replaces the previous batch: creating into the Holder disposes whatever it held.
      const owner = MultiHolder.create(typeSubs);
      for (const col of this._mappedColumnList()) {
        owner.autoDispose(col.type.subscribe(remap));
        owner.autoDispose(col.displayColModel.peek().type.subscribe(remap));
      }
    }));

    this.autoDispose(this._perspective.addListener(view => this._calendar?.changeView(view)));
    // Event colors are CSS-variable strings and re-resolve on their own, so only the calendar
    // chrome theme needs re-applying.
    this.autoDispose(gristThemeObs().addListener(() => this._calendar?.setTheme()));

    this.autoDispose(this.cursor.rowId.subscribe(rowId => this._selectRecord(rowId)));

    this.init().catch(reportError);

    // A stable handle for nbrowser tests, so they need not reach into private fields. Always points
    // at the newest live view (see test/nbrowser/CalendarView.ts).
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
    const calendar = await CalendarWrapper.load(
      this, this._calendarDom, this._titleDom, this._perspective.get());
    if (!calendar) { return; }   // the section was disposed while TUI was loading
    this._calendar = this.autoDispose(calendar);

    // disableEditing is a ko.computed that depends on linking state (BaseView.ts), so it can flip
    // after init when the section becomes a link target. Mirror its current value onto TUI so
    // drag-to-edit and drag-to-create follow the read-only flag.
    this.autoDispose(this.disableEditing.subscribe(() => calendar.setReadOnly(this.isReadOnly())));
    this._rebuildSource();
    // The TUI constructor already opened `defaultView`, so only the title is left to write.
    calendar.updateTitle();
    // The cursor subscription only fires on later changes, so a row the cursor already sits on
    // (reopening a view, say) would not be highlighted until the cursor next moved.
    this._selectRecord(this.cursor.rowId.peek());
  }

  public onResize() {
    this._resize();
  }

  // CalendarHost: CalendarWrapper calls this and the on* methods when the user acts on the grid. It
  // passes row ids and dates, and turning those into Grist actions is this class's job.
  public isReadOnly(): boolean {
    return this.gristDoc.isReadonly.get() || this.disableEditing.peek();
  }

  // Move the grid cursor (and active section) to a row, so clicking an event lights up its row.
  public onSelect(rowId: number) {
    this.gristDoc.viewModel.activeSectionId(this.viewSection.getRowId());
    this.setCursorPos({ rowId });
  }

  // Opens the Record Card for a rowId, independent of the grid cursor. BaseView's
  // viewSelectedRecordAsCard does not fit: on create the new row is not in sortedRows yet (rowNotify
  // is async) so the cursor-derived rowId is stale, and a calendar section has no view fields for
  // the colRef it reads. The card only needs rowId plus the record-card sectionId.
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

  // Points the filter at the range the grid now shows. FilteredRowSource compares membership before
  // and after by itself, so it reports what came into view as add and what left as remove.
  public onNavigate() {
    const source = this._indexingSource.get();
    const visible = this._visibleSource.get();
    if (!source || !visible || !this._calendar) { return; }
    visible.updateFilter(inRange(source, this._calendar));
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

  /**
   * The mapping context: column types, document timezone and choice styling, resolved once rather
   * than per row. Null when a required column is not mapped, which means there is nothing to show.
   */
  private _context(): EventContext | null {
    const start = this._field("startDate");
    if (!start) { return null; }
    const end = this._field("endDate");
    const startType = start.displayType;
    return {
      startType,
      endType: end?.displayType || startType,
      docTz: this._docTimeZone(),
      choiceOptions: this._field("type")?.widgetOptions?.choiceOptions || {},
    };
  }

  /**
   * Builds the whole pipeline that draws the calendar, and points it at the view's rows:
   *
   *     this.rowSource -> CalendarSource -> FilteredRowSource -> CalendarRenderer -> TUI
   *
   * Called from init() and whenever the mapping or a mapped column's type changes, the two things
   * the pipeline cannot carry itself since both invalidate every span in the index. It needs a
   * loaded calendar: spans are worked out with TUI's TZDate, and the first filter needs the range
   * the grid already shows.
   *
   * The chain is built from the far end back and joined to the view's rows on the last line, so
   * the rows arrive once and travel the whole way. subscribeTo replays what is already there.
   */
  private _rebuildSource() {
    // Taken apart from the far end, so the filter is never left reading an index that is already
    // gone. Whatever is drawn was built under the old mapping, so the grid is wiped too.
    this._visibleSource.clear();
    this._indexingSource.clear();
    this._calendar?.clearEvents();

    const ctx = this._context();
    const cal = this._calendar;
    const start = this._field("startDate");
    if (!cal || !ctx || !start) {
      cal?.setAllDayOnly(false);
      return;
    }
    // When both mapped date columns are date-only (no time-of-day), every event is all-day, so drop
    // the empty hour grid in Day/Week and show just the event list. Same condition EventRange uses
    // to force isAllDay on each event, so the two stay in step.
    cal.setAllDayOnly(isDateOnlyType(ctx.startType) && isDateOnlyType(ctx.endType));

    const end = this._field("endDate");
    const allDay = this._field("isAllDay");
    const type = this._field("type");
    const title = this._field("title");
    const readDates: ReadDates = (rowId) => {
      const startDate = numToDate(start.get(rowId));
      if (!startDate) { return null; }
      return {
        startDate,
        endDate: end ? numToDate(end.get(rowId)) : null,
        isAllDay: allDay ? Boolean(allDay.get(rowId)) : undefined,
      } satisfies CalendarDates;
    };
    // A row created by a drag has no title until the user fills in the Record Card, so it gets a
    // placeholder rather than vanishing from the grid. With no title column mapped at all, events
    // show as unlabeled bars instead.
    const readRecord: ReadRecord = rowId => ({
      id: rowId,
      title: title ? (asText(title.get(rowId)) ?? t("New Event")) : "",
      type: type ? asChoice(type.get(rowId)) : "",
    });

    const source = CalendarSource.create(this._indexingSource, readDates, ctx);
    const visible = FilteredRowSource.create(this._visibleSource, inRange(source, cal));
    // The renderer is owned by the set it draws: the two have the same lifetime.
    CalendarRenderer.create(visible, cal, source, visible, readRecord, ctx).subscribeTo(visible);
    visible.subscribeTo(source);
    source.subscribeTo(this.rowSource);
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
    // stored as the reference, while the readers in _rebuildSource go through the visible column.
    const toGrist = (date: unknown, f: Field) => makeGristDateTime(date as TZDate, f.type, docTz);

    const fields: Record<string, CellValue> = {};
    if (start && tui.start !== undefined) { fields[start.colId] = toGrist(tui.start, start); }
    if (end && tui.end !== undefined) { fields[end.colId] = toGrist(tui.end, end); }
    if (allDay && tui.isAllday !== undefined) { fields[allDay.colId] = tui.isAllday as CellValue; }
    if (title && tui.title !== undefined) { fields[title.colId] = tui.title || t("New Event"); }
    if (Object.keys(fields).length === 0) { return null; }

    try {
      if (rowId) {
        await this.sendTableAction(["UpdateRecord", rowId, fields] as UserAction);
      } else {
        const newRowId = await this.sendTableAction(["AddRecord", null, fields] as UserAction);
        // setCursorPos calls _selectRecord for a row the pipeline has not delivered yet, so the new
        // event is not on the grid at that moment. Nothing has to be done about it: CalendarWrapper
        // remembers which row is selected and accents it as soon as the renderer draws it.
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
    this._selectedRecordId = next;
    // CalendarWrapper keeps the accent on this row from now on, including across redraws. So a row that
    // is not drawn yet (one just created by a drag) still lights up once its event appears.
    cal.setSelected(next);
    if (next === null) { return; }

    // Bring the row's day into view. The span comes from the index rather than from a drawn event,
    // so this works for a row that is nowhere near the range the grid currently shows.
    const range = this._indexingSource.get()?.getRange(next);
    if (!range) { return; }
    cal.setDate(range.start);
    cal.updateUIAfterNavigation();
  }

  private _setPerspective(view: Perspective) {
    // Persist the choice; this flows back through _perspective (toolbar active state) and its
    // listener (changeView), since setAndSave updates the underlying option synchronously.
    this.viewSection.optionsObj.prop("calendarViewPerspective").setAndSave(view).catch(reportError);
  }

  // Builds the toolbar and the container the calendar draws into.
  private _buildDom() {
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

  // One stable place for nbrowser tests to read the calendar state, instead of reaching into
  // private fields. See test/nbrowser/CalendarView.ts.
  private _testHook() {
    // TZDate carries a timezone tag, so .local() gives back the original moment before .toDate().
    const getMs = (value: any) =>
      !value ? null : (value.toDate ? value.local().toDate().getTime() : new Date(value).getTime());
    const serialize = (event?: EventObject) => !event ? null : {
      title: event.title, startMs: getMs(event.start), endMs: getMs(event.end),
      isAllDay: Boolean(event.isAllday),
    };
    // Both lookups go through what is really drawn, so an event found here has also reached TUI.
    // An event outside the visible range is not findable, which matches what is on screen.
    const drawn = (rowId: number) => this._calendar?.getEvent(rowId) ?? undefined;
    return {
      _view: this,
      getEventByRowId: (rowId: number) => serialize(drawn(rowId)),
      getEventByTitle: (title: string) => {
        for (const rowId of this._visibleSource.get()?.getAllRows() ?? []) {
          const event = typeof rowId === "number" ? drawn(rowId) : undefined;
          if (event?.title === title) { return serialize(event); }
        }
        return null;
      },
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
 * surfaces its visible value instead of the foreign row id. For non-Ref columns the two are the
 * same column. `get` is a per-column getter, so reading a row is a plain array access. Both mirror
 * ChartView.
 */
interface Field {
  colId: string;
  type: string;
  displayType: string;
  widgetOptions: any;
  get: (rowId: number) => CellValue | undefined;
}

/**
 * Does this row's span touch the visible range? The range is read once, when the filter is made,
 * so every row costs two number comparisons against the index and navigating re-reads nothing.
 * Reaching back into the index is safe because CalendarSource updates it before reporting a change.
 */
function inRange(source: CalendarSource, cal: CalendarWrapper): RowFilterFunc<UIRowId> {
  const { fromMs, toMs } = cal.getVisibleRange();
  return rowId => source.isInRange(rowId, fromMs, toMs);
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

// Only the title flexes and truncates under pressure (see cssCalendarTitle); the button groups keep
// their natural width. overflow-x is the escape hatch for a section too narrow even for those, so
// the toolbar scrolls internally instead of pushing the whole section sideways.
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
