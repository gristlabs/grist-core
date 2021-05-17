import {CursorPos} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import * as dispose from 'app/client/lib/dispose';
import {ActionGroup} from 'app/common/ActionGroup';
import {PromiseChain} from 'app/common/gutil';
import {fromKo, Observable} from 'grainjs';
import * as ko from 'knockout';

export interface ActionGroupWithCursorPos extends ActionGroup {
  cursorPos?: CursorPos;
}

// Provides observables indicating disabled state for undo/redo.
export interface IUndoState {
  isUndoDisabled: Observable<boolean>;
  isRedoDisabled: Observable<boolean>;
}

/**
 * Maintains the stack of actions which can be undone and redone, and maintains the
 * position in this stack. Undo and redo actions are generated and sent to the server here.
 */
export class UndoStack extends dispose.Disposable {

  public undoDisabledObs: ko.Observable<boolean>;
  public redoDisabledObs: ko.Observable<boolean>;
  private _gristDoc: GristDoc;
  private _stack: ActionGroupWithCursorPos[];
  private _pointer: number;
  private _linkMap: {[actionNum: number]: ActionGroup};

  // Chain of promises which send undo actions to the server. This delays the execution of the
  // next action until the current one has been received and moved the pointer index.
  private _undoChain = new PromiseChain<void>();

  public create(log: ActionGroup[], options: {gristDoc: GristDoc}) {
    this._gristDoc = options.gristDoc;

    // TODO: _stack and _linkMap grow without bound within a single session.
    // The top of the stack is stack.length - 1. The pointer points above the most
    // recently applied (not undone) action.
    this._stack = [];
    this._pointer = 0;

    // Map leading from actionNums to the action groups which link to them.
    this._linkMap = {};

    // Observables for when there is nothing to undo/redo.
    this.undoDisabledObs = ko.observable(true);
    this.redoDisabledObs = ko.observable(true);

    // Set the history nav interface in the DocPageModel to properly enable/disabled undo/redo.
    if (this._gristDoc.docPageModel) {
      this._gristDoc.docPageModel.undoState.set({
        isUndoDisabled: fromKo(this.undoDisabledObs),
        isRedoDisabled: fromKo(this.redoDisabledObs)
      });
    }

    // Initialize the stack from the log of recent actions from the server.
    log.forEach(ag => { this.pushAction(ag); });
  }

  /**
   * Should only be given own actions. Pays attention to actionNum, otherId, linkId, and
   * uses those to adjust undo index.
   */
  public pushAction(ag: ActionGroup): void {
    if (!ag.fromSelf) {
      return;
    }
    const otherIndex = ag.otherId ?
      this._stack.findIndex(a => a.actionNum === ag.otherId) : -1;

    if (ag.linkId) {
      // Link action. Add the action to the linkMap, but not to any stacks.
      this._linkMap[ag.linkId] = ag;
    } else if (otherIndex > -1) {
      // Undo/redo action from the current session.
      this._pointer = ag.isUndo ? otherIndex : otherIndex + 1;
    } else {
      // Either a normal action from the current session, or an undo/redo which
      // applies to a non-recent action. Bury all undone actions.
      if (!this.redoDisabledObs()) {
        this._stack.splice(this._pointer);
      }
      // Reset pointer and add to the stack (if not an undo action).
      if (!ag.otherId) {
        this._stack.push(ag);
      }
      this._pointer = this._stack.length;
    }
    this.undoDisabledObs(this._pointer <= 0);
    this.redoDisabledObs(this._pointer >= this._stack.length);
  }

  // Send an undo action. This should be called when the user presses 'undo'.
  public sendUndoAction(): Promise<void> {
    return this._undoChain.add(() => this._sendAction(true));
  }

  // Send a redo action. This should be called when the user presses 'redo'.
  public sendRedoAction(): Promise<void> {
    return this._undoChain.add(() => this._sendAction(false));
  }

  private async _sendAction(isUndo: boolean): Promise<void> {
    // Pick the action group to undo or redo.
    const ag = this._stack[isUndo ? this._pointer - 1 : this._pointer];
    if (!ag) { return; }

    try {
      // Get all actions in the bundle that starts at the current index. Typically, an array with a
      // single action group is returned.
      const actionGroups = this._findActionBundle(ag);
      // When we undo/redo, jump to the place where this action occurred, to bring the user to the
      // context where the change was originally made. We jump first immediately to feel more
      // responsive, then again when the action is done. The second jump matters more for most
      // changes, but the first is the important one when Undoing an AddRecord.
      this._gristDoc.moveToCursorPos(ag.cursorPos, ag).catch(() => {/* do nothing */})
      await this._gristDoc.docComm.applyUserActionsById(
        actionGroups.map(a => a.actionNum),
        actionGroups.map(a => a.actionHash),
        isUndo,
        { otherId: ag.actionNum });
      this._gristDoc.moveToCursorPos(ag.cursorPos, ag).catch(() => {/* do nothing */})
    } catch (err) {
      err.message = `Failed to apply ${isUndo ? 'undo' : 'redo'} action: ${err.message}`;
      throw err;
    }
  }

  /**
   * Find all actionGroups in the bundle that starts with the given action group.
   */
  private _findActionBundle(ag: ActionGroup) {
    const prevNums = new Set();
    const actionGroups = [];
    // Follow references through the linkMap adding items to the array bundle.
    while (ag && !prevNums.has(ag.actionNum)) {
      // Checking that actions are only accessed once prevents an infinite circular loop.
      actionGroups.push(ag);
      prevNums.add(ag.actionNum);
      ag = this._linkMap[ag.actionNum];
    }
    return actionGroups;
  }
}
