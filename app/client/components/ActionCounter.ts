import * as dispose from 'app/client/lib/dispose';
import { DocData } from 'app/client/models/DocData';
import { MinimalActionGroup } from 'app/common/ActionGroup';
import { DocState } from 'app/common/DocState';
import { Observable } from 'grainjs';

const MAX_MEMORY_OF_COUNTED_ACTIONS = 250;
const MAX_COUNT = 20;

/**
 * Counts the number of actions since the "base action",
 * if there is one.
 */
export class ActionCounter extends dispose.Disposable {
  public count: Observable<number|'many'>;
  public countFromMark: Observable<number|'many'>;
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
    console.log("DBASE", state);
    if (!state) { return; }
    let base: number = 0;
    for (let i = 0; i < log.length; i++) {
      const action = log[log.length - i - 1];
      console.log('looking at', action);
      if (action.actionNum === state.n &&
          action.actionHash === state.h) {
        console.log("YAY FOUND");
        base = log.length - i;
        break;
      }
    }
    // Now scan forward to count
    for (let i = base; i < log.length; i++) {
      const action = log[i];
      this.pushAction(action);
    }
    //this.count.set(ct);
    //this._setCount(ct);
    console.log(this._actionNumList);
  }

  public setMark(state?: DocState) {
    this._actionNumMark = state?.n ?? null;
    this._countOffset = - (this._countAt.get(this._actionNumMark ?? -1) ?? 0);
    this.countFromMark.set(this._count + this._countOffset);
    console.log("SETMARK", this._count + this._countOffset);
  }

  public pushAction(action: MinimalActionGroup) {
    console.log(action);
    if (action.isUndo) {
      if (this._counted.has(action.otherId)) {
        this._setCount(-1);
      }
    } else {
      this._countAction(action);
      this._setCount(+1);
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

  private _setCount(delta: number, value?: number) {
    if (value === undefined) {
      value = this._count;
    }
    value += delta;
    if (value > MAX_COUNT && this.count.get() !== 'many') {
      console.log("-- MANY COUNT IS", value);
      this.count.set('many');
      return;
    }
    console.log("-- COUNT IS", value, value + this._countOffset);
    this._count = value;
    this.count.set(value);
    this.countFromMark.set(value + this._countOffset);
  }
}
