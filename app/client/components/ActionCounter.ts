import * as dispose from 'app/client/lib/dispose';
import { DocData } from 'app/client/models/DocData';
import { MinimalActionGroup } from 'app/common/ActionGroup';
import { DocState } from 'app/common/DocState';
import { Observable } from 'grainjs';

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
  public count: Observable<number|'...'>;
  public countFromMark: Observable<number|'...'>;

  private _counted: Set<number>;
  private _countAt: Map<number, number>;
  private _actionNumList: Array<number>;
  private _count: number;
  private _actionNumMark: number|null;
  private _countOffset: number;

  public create(log: MinimalActionGroup[], docData: DocData) {
    this.count = Observable.create(this, 0);
    this.countFromMark = Observable.create(this, 0);
    this._counted = new Set();
    this._actionNumList = [];
    this._countAt = new Map();
    this._count = 0;
    this._actionNumMark = null;
    this._countOffset = 0;
    const docSettings = docData.docSettings();
    const state = docSettings.baseAction;
    if (!state) { return; }
    let base: number = 0;
    for (let i = 0; i < log.length; i++) {
      const action = log[log.length - i - 1];
      if (action.actionNum === state.n &&
          action.actionHash === state.h) {
        base = log.length - i;
        break;
      }
    }
    // Now scan forward to count
    for (let i = base; i < log.length; i++) {
      const action = log[i];
      this.pushAction(action);
    }
  }

  public setMark(state?: DocState) {
    this._actionNumMark = state?.n ?? null;
    this._countOffset = - (this._countAt.get(this._actionNumMark ?? -1) ?? 0);
    this._setCount();
  }

  public pushAction(action: MinimalActionGroup) {
    if (action.isUndo) {
      if (this._counted.has(action.otherId)) {
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

  private _truncated(value: number): number|'...' {
    return (value > MAX_COUNT) ? '...' : value;
  }
}
