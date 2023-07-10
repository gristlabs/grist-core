/**
 * The Cursor module contains functionality related to the cell with the cursor, i.e. a single
 * currently selected cell.
 */


import BaseView from 'app/client/components/BaseView';
import * as commands from 'app/client/components/commands';
import BaseRowModel from 'app/client/models/BaseRowModel';
import {LazyArrayModel} from 'app/client/models/DataTableModel';
import type {UIRowId} from 'app/common/TableData';
import {Disposable} from 'grainjs';
import * as ko from 'knockout';

export interface CursorPos {
  rowId?: UIRowId;
  rowIndex?: number;
  fieldIndex?: number;
  sectionId?: number;
}

function nullAsUndefined<T>(value: T|null|undefined): T|undefined {
  return value == null ? undefined : value;
}

/**
 * Cursor represents the location of the cursor in the viewsection. It is maintained by BaseView,
 * and implements the shared functionality related to the cursor cell.
 * @param {BaseView} baseView: The BaseView object to which this Cursor belongs.
 * @param {Object} optCursorPos: Optional object containing rowId and fieldIndex properties
 *  to which the cursor should be initialized.
 */
export class Cursor extends Disposable {
  /**
   * The commands closely tied to the cursor. They are active when the BaseView containing this
   * Cursor has focus. Some may need to be overridden by particular views.
   */
  public static editorCommands = {
    // The cursor up/down commands may need to be a bit different in non-grid views.
    cursorUp(this: Cursor) { this.rowIndex(this.rowIndex()! - 1); },
    cursorDown(this: Cursor) { this.rowIndex(this.rowIndex()! + 1); },
    cursorLeft(this: Cursor) { this.fieldIndex(this.fieldIndex() - 1); },
    cursorRight(this: Cursor) { this.fieldIndex(this.fieldIndex() + 1); },
    skipUp(this: Cursor) { this.rowIndex(this.rowIndex()! - 5); },
    skipDown(this: Cursor) { this.rowIndex(this.rowIndex()! + 5); },
    pageUp(this: Cursor) { this.rowIndex(this.rowIndex()! - 20); },    // TODO Not really pageUp
    pageDown(this: Cursor) { this.rowIndex(this.rowIndex()! + 20); },  // TODO Not really pageDown
    prevField(this: Cursor) { this.fieldIndex(this.fieldIndex() - 1); },
    nextField(this: Cursor) { this.fieldIndex(this.fieldIndex() + 1); },
    moveToFirstRecord(this: Cursor) { this.rowIndex(0); },
    moveToLastRecord(this: Cursor) { this.rowIndex(Infinity); },
    moveToFirstField(this: Cursor) { this.fieldIndex(0); },
    moveToLastField(this: Cursor) { this.fieldIndex(Infinity); },
  };

  public viewData: LazyArrayModel<BaseRowModel>;
  // observable with current cursor position
  public currentPosition: ko.Computed<CursorPos>;

  public rowIndex: ko.Computed<number|null>;     // May be null when there are no rows.
  public fieldIndex: ko.Observable<number>;

  private _rowId: ko.Observable<UIRowId|null>;     // May be null when there are no rows.

  // The cursor's _rowId property is always fixed across data changes. When isLive is true,
  // the rowIndex of the cursor is recalculated to match _rowId. When false, they will
  // be out of sync.
  private _isLive: ko.Observable<boolean> = ko.observable(true);
  private _sectionId: ko.Computed<number>;

  private _properRowId: ko.Computed<UIRowId|null>;

  constructor(baseView: BaseView, optCursorPos?: CursorPos) {
    super();
    optCursorPos = optCursorPos || {};
    this.viewData = baseView.viewData;

    this._sectionId = this.autoDispose(ko.computed(() => baseView.viewSection.id()));
    this._rowId = ko.observable<UIRowId|null>(optCursorPos.rowId || 0);
    this.rowIndex = this.autoDispose(ko.computed({
      read: () => {
        if (!this._isLive()) { return this.rowIndex.peek(); }
        const rowId = this._rowId();
        return rowId == null ? null : this.viewData.clampIndex(this.viewData.getRowIndexWithSub(rowId));
      },
      write: (index) => {
        const rowIndex = index === null ? null : this.viewData.clampIndex(index);
        this._rowId(rowIndex == null ? null : this.viewData.getRowId(rowIndex));
      },
    }));

    this.fieldIndex = baseView.viewSection.viewFields().makeLiveIndex(optCursorPos.fieldIndex || 0);
    this.autoDispose(commands.createGroup(Cursor.editorCommands, this, baseView.viewSection.hasFocus));

    // RowId might diverge from the one stored in _rowId when the data changes (it is filtered out). So here
    // we will calculate rowId based on rowIndex (so in reverse order), to have a proper value.
    this._properRowId = this.autoDispose(ko.computed(() => {
      const rowIndex = this.rowIndex();
      const rowId = rowIndex === null ? null : this.viewData.getRowId(rowIndex);
      return rowId;
    }));

    // Update the section's activeRowId when the cursor's rowIndex is changed.
    this.autoDispose(this._properRowId.subscribe((rowId) => baseView.viewSection.activeRowId(rowId)));

    // On dispose, save the current cursor position to the section model.
    this.onDispose(() => { baseView.viewSection.lastCursorPos = this.getCursorPos(); });

    // calculate current position
    this.currentPosition = this.autoDispose(ko.computed(() => this._isLive() ? this.getCursorPos() : {}));
  }

  // Returns the cursor position with rowId, rowIndex, and fieldIndex.
  public getCursorPos(): CursorPos {
    return {
      rowId: nullAsUndefined(this._properRowId()),
      rowIndex: nullAsUndefined(this.rowIndex()),
      fieldIndex: this.fieldIndex(),
      sectionId: this._sectionId()
    };
  }

  /**
   * Moves the cursor to the given position. Only moves the row if rowId or rowIndex is valid,
   * preferring rowId.
   * @param cursorPos: Position as { rowId?, rowIndex?, fieldIndex? }, as from getCursorPos().
   */
  public setCursorPos(cursorPos: CursorPos): void {
    if (cursorPos.rowId !== undefined && this.viewData.getRowIndex(cursorPos.rowId) >= 0) {
      this.rowIndex(this.viewData.getRowIndex(cursorPos.rowId) );
    } else if (cursorPos.rowIndex !== undefined && cursorPos.rowIndex >= 0) {
      this.rowIndex(cursorPos.rowIndex);
    } else {
      // Write rowIndex to itself to force an update of rowId if needed.
      this.rowIndex(this.rowIndex.peek());
    }
    if (cursorPos.fieldIndex !== undefined) {
      this.fieldIndex(cursorPos.fieldIndex);
    }
  }

  public setLive(isLive: boolean): void {
    this._isLive(isLive);
  }
}
