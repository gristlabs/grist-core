import * as dispose from "app/client/lib/dispose";
import { DocData } from "app/client/models/DocData";
import { MinimalActionGroup } from "app/common/ActionGroup";
import { DocState } from "app/common/DocState";

import { Computed, Observable } from "grainjs";

const MAX_MEMORY_OF_COUNTED_ACTIONS = 250;
const MAX_COUNT = 20;

/**
 * Counts the number of actions since the "base action"
 * (when the document was created, or forked, or copied).
 * A "mark" can be set, meaning a distinct action against
 * which a separate countFromMark is measured. This is
 * used for the suggestion feature.
 *
 * If the count is large, we give up and just call it
 * 'many'. We need to bear in mind also that action history
 * gets truncated and so may not be complete.
 */
export class ActionCounter extends dispose.Disposable {
  // The full count from the base action.
  public count: Observable<number | "...">;

  // The count from the marked actionNum, if there is one
  // (otherwise is same as `count`).
  public countFromMark: Observable<number | "...">;

  public isUndoBlocked: Observable<boolean>;

  // List of actionNums that we've seen. Gets truncated.
  private _actionNumList: number[];

  // Set of actionNums that contributed to count.
  private _counted: Set<number>;

  // A map from actionNum to the count at that actionNum.
  private _countAt: Map<number, number>;

  // The current count.
  private _count: number;

  // The current marked actionNum, if any.
  private _actionNumMark: number | null;

  // The offset to the count at the marked actionNum, or 0.
  private _countOffset: number;

  public create(log: MinimalActionGroup[], docData: DocData) {
    // Initialize counters and stats.
    this.count = Observable.create(this, 0);
    this.countFromMark = Observable.create(this, 0);
    // If there is a marked actionNum, then block undos beyond it.
    this.isUndoBlocked = Computed.create(
      this,
      this.countFromMark,
      (_, count) => this._actionNumMark ? count <= 0 : false,
    );
    this._counted = new Set();
    this._actionNumList = [];
    this._countAt = new Map();
    this._count = 0;
    this._actionNumMark = null;
    this._countOffset = 0;

    // Get base action if any.
    const docSettings = docData.docSettings();
    const state = docSettings.baseAction;
    if (!state) {
      this._setCount();
      return;
    }

    // Scan log actions for the base action.
    let base: number = 0;
    for (let i = 0; i < log.length; i++) {
      const action = log[log.length - i - 1];
      if (action.actionNum === state.n &&
        action.actionHash === state.h) {
        base = log.length - i;
        break;
      }
    }

    // Either we found the base or not. Now scan forward to count
    // actions. Need to go in this order because of possible
    // undo/redos.
    for (let i = base; i < log.length; i++) {
      const action = log[i];
      this.pushAction(action);
    }
  }

  // This marks a state to use as the reference for countFromMark.
  // Useful for suggestion feature.
  public setMark(state?: DocState) {
    this._actionNumMark = state?.n ?? null;
    this._countOffset = -(this._countAt.get(this._actionNumMark ?? -1) ?? 0);
    this._setCount();
  }

  // Process an action, updating the count.
  public pushAction(action: MinimalActionGroup) {
    if (action.isUndo) {
      if (this._counted.has(action.otherId)) {
        // Undoing an action we counted, so update count.
        this._changeCount(-1);
      }
    } else {
      this._countAction(action);
      this._changeCount(+1);
    }
    this._actionNumList.push(action.actionNum);
    while (this._actionNumList.length > MAX_MEMORY_OF_COUNTED_ACTIONS) {
      const actionNum = this._actionNumList.shift()!;
      this._counted.delete(actionNum);
      this._countAt.delete(actionNum);
    }
    this._countAt.set(action.actionNum, this._count);
  }

  private _countAction(action: MinimalActionGroup) {
    this._counted.add(action.actionNum);
  }

  private _changeCount(delta: number, value?: number) {
    if (value === undefined) {
      value = this._count;
    }
    value += delta;
    this._count = value;
    this._setCount();
  }

  private  _setCount() {
    this.count.set(this._truncated(this._count));
    this.countFromMark.set(this._truncated(this._count + this._countOffset));
  }

  private _truncated(value: number): number | "..." {
    return (value > MAX_COUNT) ? "..." : value;
  }
}
