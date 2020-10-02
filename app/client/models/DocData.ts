/**
 * DocData maintains all underlying data for a Grist document, knows how to load it,
 * subscribes to actions which change it, and forwards those actions to individual tables.
 * It also provides the interface to apply actions to data.
 */

import {DocComm} from 'app/client/components/DocComm';
import {TableData} from 'app/client/models/TableData';
import {ApplyUAOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {CellValue, TableDataAction, UserAction} from 'app/common/DocActions';
import {DocData as BaseDocData} from 'app/common/DocData';
import {ColTypeMap} from 'app/common/TableData';
import * as bluebird from 'bluebird';
import {Emitter} from 'grainjs';
import defaults = require('lodash/defaults');

const gristNotify = (window as any).gristNotify;

type BundleCallback = (action: UserAction) => boolean;

export class DocData extends BaseDocData {
  public readonly sendActionsEmitter = new Emitter();
  public readonly sendActionsDoneEmitter = new Emitter();

  // Action verification callback to avoid undesired bundling. Also an indicator that actions are
  // currently being bundled.
  private _bundleCallback?: BundleCallback|null = null;

  private _nextDesc: string|null = null;        // The description for the next incoming action.
  private _lastActionNum: number|null = null;   // ActionNum of the last action in the current bundle, or null.
  private _bundleSender: BundleSender;

  /**
   * Constructor for DocData.
   * @param {Object} docComm: A map of server methods availble on this document.
   * @param {Object} metaTableData: A map from tableId to table data, presented as an action,
   *      equivalent to BulkAddRecord, i.e. ["TableData", tableId, rowIds, columnValues].
   */
  constructor(public readonly docComm: DocComm, metaTableData: {[tableId: string]: TableDataAction}) {
    super((tableId) => docComm.fetchTable(tableId), metaTableData);
    this._bundleSender = new BundleSender(this.docComm);
  }

  public createTableData(tableId: string, tableData: TableDataAction|null, colTypes: ColTypeMap): TableData {
    return new TableData(this, tableId, tableData, colTypes);
  }

  // Version of inherited getTable() which returns the enhance TableData type.
  public getTable(tableId: string): TableData|undefined {
    return super.getTable(tableId) as TableData;
  }

  /**
   * Finds up to n most likely target columns for the given values in the document.
   */
  public async findColFromValues(values: any[], n: number, optTableId?: string): Promise<number[]> {
    try {
      return await this.docComm.findColFromValues(values, n, optTableId);
    } catch (e) {
      gristNotify(`Error finding matching columns: ${e.message}`);
      return [];
    }
  }

  /**
   * Returns error message (traceback) for one invalid formula cell.
   */
  public getFormulaError(tableId: string, colId: string, rowId: number): Promise<CellValue> {
    return this.docComm.getFormulaError(tableId, colId, rowId);
  }

  // Sets a bundle to collect all incoming actions. Throws an error if any actions which
  // do not match the verification callback are sent.
  public startBundlingActions(desc: string|null, callback: BundleCallback) {
    this._nextDesc = desc;
    this._lastActionNum = null;
    this._bundleCallback = callback;
  }

  // Ends the active bundle collecting all incoming actions.
  public stopBundlingActions() {
    this._bundleCallback = null;
  }

  // Execute a callback that may send multiple actions, and bundle those actions together. The
  // callback may return a promise, in which case bundleActions() will wait for it to resolve.
  public async bundleActions<T>(desc: string|null, callback: () => T|Promise<T>): Promise<T> {
    this.startBundlingActions(desc, () => true);
    try {
      return await callback();
    } finally {
      this.stopBundlingActions();
    }
  }

  /**
   * Sends actions to the server to be applied.
   * @param {String} optDesc: Optional description of the actions to be shown in the log.
   *
   * sendActions also emits two events:
   * 'sendActions': emitted before the action is sent, with { actions } object as data.
   * 'sendActionsDone': emitted on success, with the same data object.
   *   Note that it allows a handler for 'sendActions' to pass along information to the handler
   *   for the corresponding 'sendActionsDone', by tacking it onto the event data object.
   */
  public sendActions(actions: UserAction[], optDesc?: string): Promise<any[]> {
    // Some old code relies on this promise being a bluebird Promise.
    // TODO Remove bluebird and this cast.
    return bluebird.Promise.resolve(this._sendActionsImpl(actions, optDesc)) as any;
  }

  /**
   * Sends a single action to the server to be applied. Calls this.sendActions to manage the
   * optional bundle.
   * @param {String} optDesc: Optional description of the actions to be shown in the log.
   */
  public sendAction(action: UserAction, optDesc?: string): Promise<any> {
    return this.sendActions([action], optDesc).then((retValues) => retValues[0]);
  }

  // See documentation of sendActions().
  private async _sendActionsImpl(actions: UserAction[], optDesc?: string): Promise<any[]> {
    const eventData = {actions};
    this.sendActionsEmitter.emit(eventData);
    const options = { desc: optDesc };
    const bundleCallback = this._bundleCallback;
    if (bundleCallback) {
      actions.forEach(action => {
        if (!bundleCallback(action)) {
          gristNotify(`Attempted to add invalid action to current bundle: ${action}.`);
        }
      });
      defaults(options, {
        desc: this._nextDesc,
        linkId: this._lastActionNum,
      });
      this._nextDesc = null;
    }
    const result: ApplyUAResult = await this._bundleSender.applyUserActions(actions, options);
    this._lastActionNum = result.actionNum;
    this.sendActionsDoneEmitter.emit(eventData);
    return result.retValues;
  }
}

/**
 * BundleSender helper class collects multiple applyUserActions() calls that happen on the same
 * tick, and sends them to the server all at once.
 */
class BundleSender {
  private _options = {};
  private _actions: UserAction[] = [];
  private _sendPromise?: Promise<ApplyUAResult>;

  constructor(private _docComm: DocComm) {}

  public applyUserActions(actions: UserAction[], options: ApplyUAOptions): Promise<ApplyUAResult> {
    defaults(this._options, options);
    const start = this._actions.length;
    this._actions.push(...actions);
    const end = this._actions.length;
    return this._getSendPromise()
    .then(result => ({
      actionNum: result.actionNum,
      retValues: result.retValues.slice(start, end),
      isModification: result.isModification
    }));
  }

  public _getSendPromise(): Promise<ApplyUAResult> {
    if (!this._sendPromise) {
      // Note that the first Promise.resolve() ensures that the next step (actual send) happens on
      // the next tick. By that time, more actions may have been added to this._actions array.
      this._sendPromise = Promise.resolve()
      .then(() => {
        this._sendPromise = undefined;
        const ret = this._docComm.applyUserActions(this._actions, this._options);
        this._options = {};
        this._actions = [];
        return ret;
      });
    }
    return this._sendPromise;
  }
}
