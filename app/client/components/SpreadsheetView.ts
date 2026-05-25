import BaseView from "app/client/components/BaseView";
import * as commands from "app/client/components/commands";
import { GristDoc } from "app/client/components/GristDoc";
import { viewCommands } from "app/client/components/RegionFocusSwitcher";
import { formatRawCellValue, indexToLetter } from "app/client/lib/cellUtils";
import { DataRowModel } from "app/client/models/DataRowModel";
import { ViewSectionRec } from "app/client/models/entities/ViewSectionRec";
import { reportError } from "app/client/models/errors";
import { CELL_PADDING } from "app/client/ui/gridConstants";
import {
  cellBaseCss, colHeaderCss, cornerCellCss, cursorHighlightCss, rowHeaderCss,
} from "app/client/ui/gridStyles";
import { testId, theme } from "app/client/ui2018/cssVars";
import { BuildEditorOptions } from "app/client/widgets/FieldBuilder";
import { UIRowId } from "app/plugin/GristAPI";

import { dom, Observable, styled } from "grainjs";

/**
 * SpreadsheetView renders a fixed-size grid (e.g. 18x30) backed by a single Grist record
 * where each visual cell corresponds to a physical column named by cell address (A1, B1, ...).
 *
 * It extends BaseView and keeps BaseView.cursor.fieldIndex in sync with the visual grid
 * so the right-side panel (column config) updates correctly.
 */
export class SpreadsheetView extends BaseView {
  private _numCols: number;
  private _numRows: number;
  private _colLetters: string[];
  private _curCol: Observable<number>;
  private _curRow: Observable<number>;
  private _isEditing: Observable<boolean>;
  private _cellElements = new Map<string, HTMLElement>();
  private _editInput: HTMLInputElement | null = null;
  private _lastMousedownTime: number = 0;

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel, { addNewRow: false });

    this._numCols = 18;
    this._numRows = 30;

    this._colLetters = [];
    for (let i = 0; i < this._numCols; i++) {
      this._colLetters.push(indexToLetter(i));
    }

    this._curCol = Observable.create(this, 0);
    this._curRow = Observable.create(this, 0);
    this._isEditing = Observable.create(this, false);

    // Sync cursor.rowIndex to 0 (single record) and fieldIndex to the visual cell
    this.cursor.rowIndex(0);
    this._syncCursorFieldIndex();

    const navCommands = {
      cursorUp: () => this._moveBy(0, -1),
      cursorDown: () => this._moveBy(0, 1),
      cursorLeft: () => this._moveBy(-1, 0),
      cursorRight: () => this._moveBy(1, 0),
      nextField: () => this._moveBy(1, 0),
      prevField: () => this._moveBy(-1, 0),
      editField: () => this._startEditing(),
      input: (_init?: string) => this._startEditing(_init),
    };
    this.autoDispose(commands.createGroup(
      viewCommands(navCommands, this), this, this.viewSection.hasFocus));

    this.viewPane = this._buildDom();
    this._listenToData();
  }

  public onTableLoaded() {
    super.onTableLoaded();
    this._refreshAllCells();
  }

  public onResize() {
    // nothing needed
  }

  public scrollToCursor(_sync?: boolean) {
    return Promise.resolve();
  }

  public activateEditorAtCursor(options: BuildEditorOptions = {}): void {
    const col = this._curCol.get();
    const row = this._curRow.get();
    const cellEl = this._cellElements.get(`${col},${row}`);
    if (!cellEl) { return; }

    const rowId = this.viewData.getRowId(this.cursor.rowIndex()!);
    this.editRowModel.assign(rowId);
    const builder = this.activeFieldBuilder();
    builder.setCellElem(this.editRowModel, cellEl);

    // In SpreadsheetView, data columns should behave like "empty columns" when "=" is typed,
    // so that the FormulaEditor opens instead of the regular text editor.
    // FieldEditor checks column.isEmpty() which requires isFormula=true && formula="".
    if (options.init?.startsWith("=")) {
      const column = builder.field.column();
      if (!column.isFormula() && !column.isEmpty()) {
        column.isFormula(true);
        column.formula("");
      }
    }

    super.activateEditorAtCursor(options);
  }

  protected getRenderedRowModel(rowId: UIRowId): DataRowModel | undefined {
    this.editRowModel.assign(rowId);
    return this.editRowModel;
  }

  /**
   * Maps visual (col, row) to the fieldIndex in viewSection.viewFields().
   * Columns are created in row-major order: all cols for row 1, then row 2, etc.
   */
  private _toFieldIndex(col: number, row: number): number {
    return row * this._numCols + col;
  }

  private _syncCursorFieldIndex() {
    const fi = this._toFieldIndex(this._curCol.get(), this._curRow.get());
    this.cursor.fieldIndex(fi);
  }

  private _cellColId(col: number, row: number): string {
    return this._colLetters[col] + (row + 1);
  }

  private _getCellValue(col: number, row: number): any {
    const tableData = this.tableModel.tableData;
    const colId = this._cellColId(col, row);
    const rowIds = tableData.getRowIds();
    if (rowIds.length === 0) { return null; }
    return tableData.getValue(rowIds[0], colId);
  }

  private _refreshAllCells() {
    for (let r = 0; r < this._numRows; r++) {
      for (let c = 0; c < this._numCols; c++) {
        this._refreshCell(c, r);
      }
    }
  }

  private _refreshCell(col: number, row: number) {
    if (this._isEditing.get() && col === this._curCol.get() && row === this._curRow.get()) {
      return;
    }
    const key = `${col},${row}`;
    const el = this._cellElements.get(key);
    if (el) {
      el.textContent = formatRawCellValue(this._getCellValue(col, row));
    }
  }

  private _listenToData() {
    this.listenTo(this.tableModel.tableData, "rowChange", () => this._refreshAllCells());
    this.listenTo(this.tableModel.tableData, "rowNotify", () => this._refreshAllCells());
    this.listenTo(this.tableModel, "rowModelNotify", () => this._refreshAllCells());
    const emitter = this.tableModel.tableData.tableActionEmitter;
    this.autoDispose(emitter.addListener(() => this._refreshAllCells()));
    const loadEmitter = this.tableModel.tableData.dataLoadedEmitter;
    this.autoDispose(loadEmitter.addListener(() => this._refreshAllCells()));
  }

  private _selectCell(col: number, row: number) {
    // When a Grist formula editor is open, clicking a cell should insert a $colId
    // reference into the formula (matching GridView behaviour) instead of navigating.
    const activeEditor = this.gristDoc.activeEditor.get();
    if (activeEditor) {
      const fieldIndex = this._toFieldIndex(col, row);
      const field = this.viewSection.viewFields().at(fieldIndex);
      const rowModel = this.moveEditRowToCursor();
      commands.allCommands.setCursor.run(rowModel, field);
      return;
    }

    if (this._isEditing.get()) {
      this._commitEdit();
    }
    this._curCol.set(col);
    this._curRow.set(row);
    this._syncCursorFieldIndex();
    this._updateCursorClass();
  }

  private _moveBy(dc: number, dr: number) {
    if (this._isEditing.get()) {
      this._commitEdit();
    }
    const newCol = Math.max(0, Math.min(this._numCols - 1, this._curCol.get() + dc));
    const newRow = Math.max(0, Math.min(this._numRows - 1, this._curRow.get() + dr));
    this._curCol.set(newCol);
    this._curRow.set(newRow);
    this._syncCursorFieldIndex();
    this._updateCursorClass();
    this._scrollIntoView(newCol, newRow);
  }

  private _scrollIntoView(col: number, row: number) {
    const key = `${col},${row}`;
    const el = this._cellElements.get(key);
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  private _updateCursorClass() {
    const c = this._curCol.get();
    const r = this._curRow.get();
    this._cellElements.forEach((el, key) => {
      const [cc, rr] = key.split(",").map(Number);
      el.classList.toggle("selected_cursor", cc === c && rr === r);
    });
  }

  private _startEditing(init?: string) {
    if (this._isEditing.get()) { return; }

    // For formula editing (starts with "="), delegate to Grist's built-in editor system
    if (init?.startsWith("=")) {
      this.activateEditorAtCursor({ init });
      return;
    }

    const col = this._curCol.get();
    const row = this._curRow.get();
    const key = `${col},${row}`;
    const cellEl = this._cellElements.get(key);
    if (!cellEl) { return; }

    // Check if the current column already has a formula -- if so, use Grist's editor
    const fieldIndex = this._toFieldIndex(col, row);
    const field = this.viewSection.viewFields().at(fieldIndex);
    if (field) {
      const colRec = field.column();
      if (colRec.isFormula()) {
        this.activateEditorAtCursor(init !== undefined ? { init } : {});
        return;
      }
    }

    const currentValue = this._getCellValue(col, row);
    const startText = init !== undefined ? init : formatRawCellValue(currentValue);

    this._isEditing.set(true);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "spreadsheet_edit_input";
    input.value = startText;
    input.setAttribute("data-testid", "spreadsheet-editor");

    input.addEventListener("keydown", (ev) => {
      // If user types "=" as first char, switch to formula editor
      if (ev.key === "=" && input.value === "" && input.selectionStart === 0) {
        ev.preventDefault();
        this._cancelEdit();
        this.activateEditorAtCursor({ init: "=" });
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        this._commitEdit();
        this._moveBy(0, 1);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this._cancelEdit();
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        this._commitEdit();
        this._moveBy(ev.shiftKey ? -1 : 1, 0);
      }
    });

    input.addEventListener("mousedown", ev => ev.stopPropagation());

    cellEl.textContent = "";
    cellEl.appendChild(input);
    this._editInput = input;
    input.focus();
    if (init !== undefined) {
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      input.select();
    }
  }

  private _commitEdit() {
    if (!this._isEditing.get()) { return; }

    const col = this._curCol.get();
    const row = this._curRow.get();
    const colId = this._cellColId(col, row);
    const value = this._editInput?.value ?? "";

    this._isEditing.set(false);
    this._editInput = null;

    const tableData = this.tableModel.tableData;
    const rowIds = tableData.getRowIds();
    if (rowIds.length === 0) { return; }
    const rowId = rowIds[0];

    if (value === "") {
      this.gristDoc.docData.sendAction(
        ["UpdateRecord", tableData.tableId, rowId, { [colId]: null }],
      ).then(() => this._refreshCell(col, row)).catch(reportError);
    } else {
      let parsed: any = value;
      const num = Number(value);
      if (!isNaN(num)) {
        parsed = num;
      }
      this.gristDoc.docData.sendAction(
        ["UpdateRecord", tableData.tableId, rowId, { [colId]: parsed }],
      ).then(() => this._refreshCell(col, row)).catch(reportError);
    }

    this._refreshCell(col, row);
  }

  private _cancelEdit() {
    if (!this._isEditing.get()) { return; }
    this._isEditing.set(false);
    this._editInput = null;
    this._refreshCell(this._curCol.get(), this._curRow.get());
  }

  private _buildDom(): HTMLElement {
    return cssSpreadsheetPane(
      testId("spreadsheet-view"),
      cssSpreadsheetScroll(
        cssSpreadsheetTable(
          dom.on("mousedown", () => {
            this.viewSection.hasFocus(true);
          }),
          dom("thead",
            dom("tr",
              cssCornerCell(""),
              ...this._colLetters.map(letter =>
                cssColHeader(letter, testId(`col-header-${letter}`)),
              ),
            ),
          ),
          dom("tbody",
            ...Array.from({ length: this._numRows }, (_, ri) =>
              dom("tr",
                cssRowHeader(String(ri + 1), testId(`row-header-${ri + 1}`)),
                ...Array.from({ length: this._numCols }, (_, ci) => {
                  const colId = this._cellColId(ci, ri);
                  return cssCell(
                    testId(`cell-${colId}`),
                    dom.on("mousedown", (ev) => {
                      ev.stopPropagation();
                      this.viewSection.hasFocus(true);
                      // When a formula editor is active, every click should insert
                      // a cell reference — never start editing or navigate away.
                      if (this.gristDoc.activeEditor.get()) {
                        this._selectCell(ci, ri);
                        return;
                      }
                      const isAlreadySelected =
                        ci === this._curCol.get() && ri === this._curRow.get();
                      const now = Date.now();
                      const isDblClick = isAlreadySelected &&
                        now - this._lastMousedownTime < 400;
                      this._lastMousedownTime = now;
                      if (isDblClick) {
                        this._startEditing();
                      } else {
                        this._selectCell(ci, ri);
                      }
                    }),
                    (el: HTMLElement) => {
                      this._cellElements.set(`${ci},${ri}`, el);
                    },
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

const cssSpreadsheetPane = styled("div", `
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  overflow: hidden;
  font-family: var(--grist-font-family, sans-serif);
  font-size: 13px;
  background: ${theme.mainPanelBg};
`);

const cssSpreadsheetScroll = styled("div", `
  flex: 1 1 0;
  overflow: auto;
`);

const cssSpreadsheetTable = styled("table", `
  border-collapse: collapse;
  table-layout: fixed;
`);

const cssCornerCell = styled("th", `
  ${cornerCellCss}
`);

const cssColHeader = styled("th", `
  ${colHeaderCss}
`);

const cssRowHeader = styled("td", `
  ${rowHeaderCss}
`);

const cssCell = styled("td", `
  ${cellBaseCss}
  cursor: cell;

  &.selected_cursor {
    ${cursorHighlightCss}
  }

  & .spreadsheet_edit_input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    outline: none;
    padding: 0 ${CELL_PADDING}px;
    font: inherit;
    color: inherit;
    background: ${theme.cellBg};
    z-index: 2;
    box-sizing: border-box;
  }
`);
