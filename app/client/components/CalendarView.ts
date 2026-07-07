import BaseView from "app/client/components/BaseView";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, ViewSectionRec } from "app/client/models/DocModel";
import { theme } from "app/client/ui2018/cssVars";
import { CellValue } from "app/common/DocActions";
import { isDateLikeType } from "app/common/gristTypes";

import { dom, IDisposable, makeTestId, Observable, styled } from "grainjs";

const t = makeT("CalendarView");
const testId = makeTestId("test-calendar-");

// TODO(iter4+): the first day of the week is hardcoded to Monday for now; it will come from the
// user's locale in a later iteration.
const FIRST_DAY_OF_WEEK = 1; // 0 = Sunday, 1 = Monday.
const DAYS_PER_WEEK = 7;
const WEEKS_IN_GRID = 6;

// A row reduced to what this iteration shows: a start date and a title.
interface CalendarRow {
  id: number;
  date: Date;
  title: string;
}

// One cell of the month grid.
interface MonthCell {
  date: Date;          // this cell's day, at local midnight
  isOtherMonth: boolean;
  isToday: boolean;
}

/**
 * Native calendar view. This iteration renders a month grid (6x7) and places each row as an event
 * bar in the cell matching its start date. Only single-day placement, no timezones, no config,
 * no toolbar yet — those come in later iterations. The visible month is the one containing today.
 */
export class CalendarView extends BaseView {
  private _rows = Observable.create<CalendarRow[]>(this, []);
  // The month currently shown, anchored to its first day. Fixed to "today" until nav lands (iter 4).
  private _anchor = Observable.create<Date>(this, firstOfMonth(today()));
  private _update: () => void;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    this._update = () => this._updateRows();

    this.listenTo(this.sortedRows, "rowNotify", this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));
    let typeSubs: IDisposable[] = [];
    this.autoDispose(this.viewSection.columns.subscribe((cols) => {
      this._update();
      typeSubs.forEach(s => s.dispose());
      typeSubs = cols.map(c => c.type.subscribe(this._update));
    }));
    this.onDispose(() => typeSubs.forEach(s => s.dispose()));

    (window as any).gristCalendarView = { _view: this, getRows: () => this._rows.get() };
    this.onDispose(() => {
      if ((window as any).gristCalendarView?._view === this) {
        delete (window as any).gristCalendarView;
      }
    });
  }

  protected onTableLoaded() {
    super.onTableLoaded();
    this._update();
  }

  private _autoColumns(): { startCol: ColumnRec | null, titleCol: ColumnRec | null } {
    const cols = this.viewSection.columns.peek().filter(c => !c.isHiddenCol.peek());
    const startCol = cols.find(c => isDateLikeType(c.pureType.peek())) || null;
    const titleCol = cols.find(c => c.pureType.peek() === "Text") || null;
    return { startCol, titleCol };
  }

  private _updateRows() {
    if (this.isDisposed()) { return; }
    const { startCol, titleCol } = this._autoColumns();
    if (!startCol || !titleCol) {
      this._rows.set([]);
      return;
    }
    const data = this.tableModel.tableData;
    const getStart = data.getRowPropFunc(startCol.colId.peek());
    const getTitle = data.getRowPropFunc(titleCol.colId.peek());

    const rowIds = this.sortedRows.getKoArray().peek() as number[];
    const rows: CalendarRow[] = [];
    for (const rowId of rowIds) {
      if (typeof rowId !== "number") { continue; }
      const date = numToDate(getStart(rowId));
      if (!date) { continue; }
      rows.push({ id: rowId, date, title: asText(getTitle(rowId)) });
    }
    this._rows.set(rows);
  }

  private _buildDom() {
    return cssCalendarView(
      testId("container"),
      cssWeekdayHeader(
        ...weekdayLabels().map(label => cssWeekdayName(label)),
      ),
      cssMonthGrid(
        testId("month"),
        dom.domComputed((use) => monthCells(use(this._anchor)), (cells) =>
          cells.map(cell => this._buildCell(cell)),
        ),
      ),
    );
  }

  private _buildCell(cell: MonthCell) {
    return cssDayCell(
      cssDayCell.cls("-other-month", cell.isOtherMonth),
      cssDayCell.cls("-today", cell.isToday),
      testId("day"),
      cssDayNumber(String(cell.date.getDate())),
      dom.domComputed((use) => use(this._rows).filter(r => sameDay(r.date, cell.date)), (events) =>
        events.map(ev =>
          cssEvent(ev.title || t("New Event"), testId("event"), dom.data("rowId", ev.id)),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Month layout (local time)

// The 42 cells (6 weeks) of the month containing `anchor`, starting on FIRST_DAY_OF_WEEK.
function monthCells(anchor: Date): MonthCell[] {
  const first = firstOfMonth(anchor);
  // Days to step back so the grid starts on FIRST_DAY_OF_WEEK.
  const lead = (first.getDay() - FIRST_DAY_OF_WEEK + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const start = addDays(first, -lead);
  const now = today();
  const cells: MonthCell[] = [];
  for (let i = 0; i < WEEKS_IN_GRID * DAYS_PER_WEEK; i++) {
    const date = addDays(start, i);
    cells.push({
      date,
      isOtherMonth: date.getMonth() !== first.getMonth(),
      isToday: sameDay(date, now),
    });
  }
  return cells;
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Localized weekday short names, ordered from FIRST_DAY_OF_WEEK.
function weekdayLabels(): string[] {
  const labels: string[] = [];
  // 2023-01-01 was a Sunday; offset to reach FIRST_DAY_OF_WEEK, then walk 7 days.
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const d = new Date(2023, 0, 1 + FIRST_DAY_OF_WEEK + i);
    labels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Cell value helpers

function numToDate(value: CellValue | undefined): Date | null {
  return (typeof value === "number" && value && isFinite(value)) ? new Date(value * 1000) : null;
}

function asText(value: CellValue | undefined): string {
  if (value === null || value === undefined) { return ""; }
  return typeof value === "string" ? value : String(value);
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

const cssWeekdayHeader = styled("div", `
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: none;
  border-bottom: 1px solid ${theme.tableBodyBorder};
`);

const cssWeekdayName = styled("div", `
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  color: ${theme.lightText};
  text-align: left;
`);

const cssMonthGrid = styled("div", `
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: 1fr;
  flex: 1 1 0;
  min-height: 0;
`);

const cssDayCell = styled("div", `
  border-right: 1px solid ${theme.tableBodyBorder};
  border-bottom: 1px solid ${theme.tableBodyBorder};
  padding: 2px 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  &-other-month {
    background-color: ${theme.pageBg};
    color: ${theme.lightText};
  }
`);

const cssDayNumber = styled("div", `
  font-size: 12px;
  text-align: right;
  padding: 0 2px;
  .${cssDayCell.className}-today & {
    color: ${theme.controlPrimaryFg};
    background-color: ${theme.controlPrimaryBg};
    border-radius: 50%;
    width: 20px;
    height: 20px;
    line-height: 20px;
    text-align: center;
    align-self: flex-end;
  }
`);

const cssEvent = styled("div", `
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background-color: ${theme.inputReadonlyBorder};
  color: ${theme.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
`);
