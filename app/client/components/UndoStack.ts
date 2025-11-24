import {GristDoc} from 'app/client/components/GristDoc';
import * as dispose from 'app/client/lib/dispose';
import {MinimalActionGroup} from 'app/common/ActionGroup';
import {PromiseChain, setDefault} from 'app/common/gutil';
import {CursorPos} from 'app/plugin/GristAPI';
import {fromKo, Observable} from 'grainjs';
import * as ko from 'knockout';
import sortBy = require('lodash/sortBy');

export interface ActionGroupWithCursorPos extends MinimalActionGroup {
  cursorPos?: CursorPos;
  // For operations not done by the server, we supply a function to
  // handle them.
  op?: (ag: MinimalActionGroup, isUndo: boolean) => Promise<void>;
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
  public isDisabled: Observable<boolean>;
  public undoDisabledObs: ko.Observable<boolean>;
  public redoDisabledObs: ko.Observable<boolean>;
  private _gristDoc: GristDoc;
  private _stack: ActionGroupWithCursorPos[];
  private _pointer: number;
  private _linkMap: Map<number, ActionGroupWithCursorPos[]>;

  // Chain of promises which send undo actions to the server. This delays the execution of the
  // next action until the current one has been received and moved the pointer index.
  private _undoChain = new PromiseChain<void>();

  public create(log: MinimalActionGroup[], options: {gristDoc: GristDoc}) {
    this._gristDoc = options.gristDoc;

    this.isDisabled = Observable.create(this, false);

    // TODO: _stack and _linkMap grow without bound within a single session.
    // The top of the stack is stack.length - 1. The pointer points above the most
    // recently applied (not undone) action.
    this._stack = [];
    this._pointer = 0;

    // Map leading from actionNums to the action groups which link to them.
    this._linkMap = new Map();

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
  public pushAction(ag: MinimalActionGroup): void {
    if (!ag.fromSelf) {
      return;
    }
    const otherIndex = ag.otherId ?
      this._stack.findIndex(a => a.actionNum === ag.otherId) : -1;

    if (ag.linkId) {
      // Link action. Add the action to the linkMap, but not to any stacks.
      setDefault(this._linkMap, ag.linkId, []).push(ag);
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
  public async sendUndoAction(): Promise<void> {
    if (this.isDisabled.get()) { return; }

    return this._undoChain.add(() => this._sendAction(true));
  }

  // Send a redo action. This should be called when the user presses 'redo'.
  public async sendRedoAction(): Promise<void> {
    if (this.isDisabled.get()) { return; }

    return this._undoChain.add(() => this._sendAction(false));
  }

  public enable(): void {
    this.isDisabled.set(false);
  }

  public disable(): void {
    this.isDisabled.set(true);
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
      this._gristDoc.moveToCursorPos(ag.cursorPos, ag).catch(() => { /* do nothing */ });
      if (actionGroups.length === 1 && actionGroups[0].op) {
        // this is an internal operation, rather than one done by the server,
        // so we can't ask the server to undo it.
        await actionGroups[0].op(actionGroups[0], isUndo);
      } else {
        await this._gristDoc.docComm.applyUserActionsById(
          actionGroups.map(a => a.actionNum),
          actionGroups.map(a => a.actionHash),
          isUndo,
          { otherId: ag.actionNum });
      }
      this._gristDoc.moveToCursorPos(ag.cursorPos, ag).catch(() => { /* do nothing */ });
    } catch (err) {
      err.message = `Failed to apply ${isUndo ? 'undo' : 'redo'} action: ${err.message}`;
      throw err;
    }
  }

  /**
   * Find all actionGroups in the bundle that starts with the given action group.
   */
  private _findActionBundle(ag: ActionGroupWithCursorPos) {
    const prevNums = new Set();
    const actionGroups = [];
    const queue = [ag];
    // Follow references through the linkMap adding items to the array bundle.
    while (queue.length) {
      ag = queue.pop()!;
      // Checking that actions are only accessed once prevents an infinite circular loop.
      if (prevNums.has(ag.actionNum)) {
        break;
      }
      actionGroups.push(ag);
      prevNums.add(ag.actionNum);
      queue.push(...this._linkMap.get(ag.actionNum) || []);
    }
    return sortBy(actionGroups, group => group.actionNum);
  }
}
