/**
 * The Cursor module contains functionality related to the cell with the cursor, i.e. a single
 * currently selected cell.
 */


import BaseView from 'app/client/components/BaseView';
import * as commands from 'app/client/components/commands';
import BaseRowModel from 'app/client/models/BaseRowModel';
import {LazyArrayModel} from 'app/client/models/DataTableModel';
import {CursorPos, UIRowId} from 'app/plugin/GristAPI';
import {Disposable} from 'grainjs';
import * as ko from 'knockout';

function nullAsUndefined<T>(value: T|null|undefined): T|undefined {
  return value == null ? undefined : value;
}

// ================ SequenceNum: used to keep track of cursor edits (lastEditedAt)
// Basically just a global auto-incrementing counter, with some types to make intent more clear
// Cursors are constructed at SequenceNEVER (0). After that, changes to their sequenceNum will go through
// NextSequenceNum(), so they'll have unique, monotonically increasing numbers for their lastEditedAt()
// NOTE: (by the time the page loads they'll already be at nonzero numbers, the never is intended to be transient)
export type SequenceNum = number;
export const SequenceNEVER: SequenceNum = 0; // Cursors will start here
let latestGlobalSequenceNum = SequenceNEVER;
function nextSequenceNum() { // First call to this func should return 1
  latestGlobalSequenceNum++;
  return latestGlobalSequenceNum;
}

// NOTE: If latestGlobalSequenceNum overflows, I think it would stop incrementing because of floating point imprecision
// However, we don't need to worry about overflow because:
//   - Number.MAX_SAFE_INTEGER is 9,007,199,254,740,991 (9 * 10^15)
//   - even at 1000 cursor-edits per second, it would take ~300,000 yrs to overflow
//   - Plus it's client-side, so that's a single continuous 300-millenia-long session, which would be impressive uptime


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

  // lastEditedAt is updated on _properRowId or fieldIndex update (including through setCursorPos)
  // Used to determine which section takes priority for cursorLinking (specifically cycles/bidirectional linking)
  private _lastEditedAt: ko.Observable<SequenceNum>;
  // _silentUpdatesFlag prevents lastEditedAt from being updated, when a change in cursorPos isn't driven by the user.
  // It's used when cursor linking calls setCursorPos, so that linked cursor moves don't trample lastEditedAt.
  // WARNING: the flag approach relies on ko observables being resolved synchronously, may break if changed to grainjs?
  private _silentUpdatesFlag: boolean = false;

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

    this._lastEditedAt = ko.observable(SequenceNEVER);

    // update the section's activeRowId and lastCursorEdit when needed
    this.autoDispose(this._properRowId.subscribe((rowId) => baseView.viewSection.activeRowId(rowId)));
    this.autoDispose(this._lastEditedAt.subscribe((seqNum) => baseView.viewSection.lastCursorEdit(seqNum)));

    // Update the cursor edit time if either the row or column change
    // IMPORTANT: need to subscribe AFTER the properRowId->activeRowId subscription.
    //  (Cursor-linking observables depend on lastCursorEdit, but only peek at activeRowId. Therefore, updating the
    //   edit time triggers a re-read of activeRowId, and swapping the order will read stale values for rowId)
    // NOTE: this may update sequence number twice for a single edit, but this shouldn't cause any issues.
    //       For determining priority, this cursor will become the latest edited whether we call it once or twice.
    //       For updating observables, the double-update might cause cursor-linking observables in LinkingState to
    //       double-update, but it should be transient and get resolved immediately.
    this.autoDispose(this._properRowId.subscribe(() => { this._cursorEdited(); }));
    this.autoDispose(this.fieldIndex.subscribe(() => { this._cursorEdited(); }));

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
   *
   * isFromLink prevents lastEditedAt from being updated, so lastEdit reflects only user-driven edits
   * @param cursorPos: Position as { rowId?, rowIndex?, fieldIndex? }, as from getCursorPos().
   * @param isFromLink: should be set if this is a cascading update from cursor-linking
   */
  public setCursorPos(cursorPos: CursorPos, isFromLink: boolean = false): void {

    try {
      // If updating as a result of links, we want to NOT update lastEditedAt
      if (isFromLink) { this._silentUpdatesFlag = true; }

      if (cursorPos.rowId !== undefined && this.viewData.getRowIndex(cursorPos.rowId) >= 0) {
        this.rowIndex(this.viewData.getRowIndex(cursorPos.rowId));
      } else if (cursorPos.rowIndex !== undefined && cursorPos.rowIndex >= 0) {
        this.rowIndex(cursorPos.rowIndex);
      } else {
        // Write rowIndex to itself to force an update of rowId if needed.
        this.rowIndex(this.rowIndex.peek());
      }

      if (cursorPos.fieldIndex !== undefined) {
        this.fieldIndex(cursorPos.fieldIndex);
      }

      // NOTE: _cursorEdited
      // We primarily update cursorEdited counter from a this._properRowId.subscribe(), since that catches updates
      //   from many sources (setCursorPos, arrowKeys, save/load, filter/sort-changes, etc)
      // However, there's some cases where we user touches a section and properRowId doesn't change. Obvious one is
      //   clicking in a section on the cell the cursor is already on. This doesn't change the cursor position, but it
      //   SHOULD still update cursors to use that section as most up-to-date (user just clicked on a cell!), so we do
      //   it here. (normally is minor issue, but can matter when a section has rows filtered out so cursors desync)
      // Also a more subtle case: when deleting a row with several sections linked together, properRowId can fail to
      //   update. When GridView.deleteRows calls setCursorPos to keep cursor from jumping after delete, the observable
      //   doesn't trigger cursorEdited(), because (I think) _properRowId has already been updated that cycle.
      //   This caused a bug when several viewSections were cursor-linked to each other and a row was deleted
      // NOTE: Calling it explicitly here will cause cursorEdited to be called twice sometimes,
      //   but that shouldn't cause any problems, since we don't care about edit counts, just who was edited latest.
      this._cursorEdited();

    } finally { // Make sure we reset this even on error
      this._silentUpdatesFlag = false;
    }

  }




  public setLive(isLive: boolean): void {
    this._isLive(isLive);
  }

  // Should be called whenever the cursor is updated
  // EXCEPT FOR: when cursor is set by linking
  // this is used to determine which widget/cursor has most recently been touched,
  // and therefore which one should be used to drive linking if there's a conflict
  private _cursorEdited(): void {
    // If updating as a result of links, we want to NOT update lastEdited
    if (!this._silentUpdatesFlag)
      { this._lastEditedAt(nextSequenceNum()); }
  }
}
