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

// A row reduced to what this early calendar iteration shows: a start date and a title.
interface CalendarRow {
  id: number;
  date: Date;
  title: string;
}

/**
 * Native calendar view. This iteration reads the section's rows and renders them as a plain text
 * list (one line per row), mapping the FIRST Date/DateTime column as the start and the FIRST Text
 * column as the title. No config, grid or toolbar yet — those come in later iterations.
 */
export class CalendarView extends BaseView {
  private _rows = Observable.create<CalendarRow[]>(this, []);
  private _update: () => void;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    this._update = () => this._updateRows();

    // Rebuild when data or the column set changes.
    this.listenTo(this.sortedRows, "rowNotify", this._update);
    this.autoDispose(this.sortedRows.getKoArray().subscribe(this._update));
    let typeSubs: IDisposable[] = [];
    this.autoDispose(this.viewSection.columns.subscribe((cols) => {
      this._update();
      typeSubs.forEach(s => s.dispose());
      typeSubs = cols.map(c => c.type.subscribe(this._update));
    }));
    this.onDispose(() => typeSubs.forEach(s => s.dispose()));

    // Stable handle for nbrowser tests, cleared on dispose.
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

  // Picks the first date-like column for the start, and the first Text column for the title.
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
      dom.domComputed(this._rows, (rows) => {
        if (rows.length === 0) {
          return cssPlaceholder(t("Calendar view - work in progress"), testId("placeholder"));
        }
        return cssEventList(
          testId("event-list"),
          dom.forEach(rows as any, (row: CalendarRow) =>
            cssEventItem(
              `${formatDate(row.date)} - ${row.title || t("New Event")}`,
              testId("event"),
            ),
          ),
        );
      }),
    );
  }
}

function numToDate(value: CellValue | undefined): Date | null {
  // 0 is how Grist stores a blank Date/DateTime; treat it as missing.
  return (typeof value === "number" && value && isFinite(value)) ? new Date(value * 1000) : null;
}

function asText(value: CellValue | undefined): string {
  if (value === null || value === undefined) { return ""; }
  return typeof value === "string" ? value : String(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const cssCalendarView = styled("div", `
  height: 100%;
  width: 100%;
  overflow: auto;
  background-color: ${theme.mainPanelBg};
  color: ${theme.text};
`);

const cssPlaceholder = styled("div", `
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${theme.lightText};
  font-size: 15px;
`);

const cssEventList = styled("div", `
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 4px;
`);

const cssEventItem = styled("div", `
  padding: 4px 8px;
  border-radius: 3px;
  background-color: ${theme.inputReadonlyBorder};
`);
