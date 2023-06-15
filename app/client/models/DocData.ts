/**
 * DocData maintains all underlying data for a Grist document, knows how to load it,
 * subscribes to actions which change it, and forwards those actions to individual tables.
 * It also provides the interface to apply actions to data.
 */

import {DocComm} from 'app/client/components/DocComm';
import {MetaTableData, TableData} from 'app/client/models/TableData';
import {ApplyUAOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {CellValue, getTableId, isDataAction, TableDataAction, UserAction} from 'app/common/DocActions';
import {DocData as BaseDocData} from 'app/common/DocData';
import {SchemaTypes} from 'app/common/schema';
import {ColTypeMap} from 'app/common/TableData';
import * as bluebird from 'bluebird';
import {Emitter} from 'grainjs';
import defaults = require('lodash/defaults');

const gristNotify = (window as any).gristNotify;

export class DocData extends BaseDocData {
  public readonly sendActionsEmitter = new Emitter();
  public readonly sendActionsDoneEmitter = new Emitter();

  private _bundlesPending: number = 0;          // How many bundles are currently pending.
  private _lastBundlePromise?: Promise<void>;   // Promise for completion of the last pending bundle.
  private _triggerBundleFinalize?: () => void;  // When a bundle is pending, trigger its finalize() callback.

  // When a bundle is pending and actions should be checked, the callback to check them.
  private _shouldIncludeInBundle?: (actions: UserAction[]) => boolean;

  private _nextDesc: string|null = null;        // The description for the next incoming action.
  private _lastActionNum: number|null = null;   // ActionNum of the last action in the current bundle, or null.
  private _bundleSender: BundleSender;

  private _virtualTablesFunc: Map<string, Constructor<TableData>>;

  /**
   * Constructor for DocData.
   * @param {Object} docComm: A map of server methods available on this document.
   * @param {Object} metaTableData: A map from tableId to table data, presented as an action,
   *      equivalent to BulkAddRecord, i.e. ["TableData", tableId, rowIds, columnValues].
   */
  constructor(public readonly docComm: DocComm, metaTableData: {[tableId: string]: TableDataAction}) {
    super((tableId) => docComm.fetchTable(tableId), metaTableData);
    this._bundleSender = new BundleSender(this.docComm);
    this._virtualTablesFunc = new Map();
  }

  public createTableData(tableId: string, tableData: TableDataAction|null, colTypes: ColTypeMap): TableData {
    const Cons = this._virtualTablesFunc?.get(tableId) || TableData;
    return new Cons(this, tableId, tableData, colTypes);
  }

  // Version of inherited getTable() which returns the enhance TableData type.
  public getTable(tableId: string): TableData|undefined {
    return super.getTable(tableId) as TableData;
  }

  // Version of inherited getMetaTable() which returns the enhanced TableData type.
  public getMetaTable<TableId extends keyof SchemaTypes>(tableId: TableId): MetaTableData<TableId> {
    return super.getMetaTable(tableId) as any;
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
  public startBundlingActions<T>(options: BundlingOptions<T>): BundlingInfo<T> {
    if (this._bundlesPending >= 2) {
      // We don't expect a full-blown queue of bundles or actions at any point. If a bundle is
      // pending, a new bundle should immediately finalize it. Here we refuse to queue up more
      // actions than that. (This could crop up in theory while disconnected, but is hard to
      // trigger to test.)
      throw new Error('Too many actions already pending');
    }
    this._bundlesPending++;

    // Promise to allow waiting for the result of prepare() callback before it's even called.
    let prepareResolve!: (value: T|Promise<T>) => void;
    const preparePromise = new Promise<T>(resolve => { prepareResolve = resolve; });

    // Manually-triggered promise for when finalize() should be called. It's triggered by user,
    // and when an unrelated action or a new bundle is started.
    let triggerFinalize!: () => void;
    const triggerFinalizePromise = new Promise<void>(resolve => { triggerFinalize = resolve; });

    const doBundleActions = async () => {
      if (this._lastBundlePromise) {
        this._triggerBundleFinalize?.();
        await this._lastBundlePromise;
      }
      try {
        this._nextDesc = options.description;
        this._lastActionNum = null;
        this._triggerBundleFinalize = triggerFinalize;
        prepareResolve(options.prepare());
        this._shouldIncludeInBundle = options.shouldIncludeInBundle;

        // If finalize is triggered, we must wait for preparePromise to fulfill before proceeding.
        await Promise.all([triggerFinalizePromise, preparePromise]);

        // Unset _shouldIncludeInBundle so that actions sent by finalize() are included in the
        // bundle. If they were checked and incorrectly failed the check, we'd have a deadlock.
        // TODO The downside is that when sending multiple unrelated actions quickly, the first
        // can trigger finalize, and subsequent ones can get bundled in while finalize() is
        // running. This changes the order of actions and may create problems (e.g. with undo).
        this._shouldIncludeInBundle = undefined;
        await options.finalize();
      } finally {
        // In all cases, reset the bundle-specific values we set above
        this._shouldIncludeInBundle = undefined;
        this._triggerBundleFinalize = undefined;
        this._bundlesPending--;
        if (this._bundlesPending === 0) {
          this._lastBundlePromise = undefined;
        }
      }
    };

    const completionPromise = this._lastBundlePromise = doBundleActions();
    return {preparePromise, triggerFinalize, completionPromise};
  }

  // Execute a callback that may send multiple actions, and bundle those actions together. The
  // callback may return a promise, in which case bundleActions() will wait for it to resolve.
  // If nestInActiveBundle is true, and there is an active bundle, then simply calls callback()
  // without starting a new bundle.
  public async bundleActions<T>(desc: string|null, callback: () => T|Promise<T>,
                                options: {nestInActiveBundle?: boolean} = {}): Promise<T> {
    if (options.nestInActiveBundle && this._bundlesPending) {
      return await callback();
    }
    const bundlingInfo = this.startBundlingActions<T>({
      description: desc,
      shouldIncludeInBundle: () => true,
      prepare: callback,
      finalize: async () => undefined,
    });
    try {
      return await bundlingInfo.preparePromise;
    } finally {
      bundlingInfo.triggerFinalize();
      await bundlingInfo.completionPromise;
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
    return bluebird.Promise.resolve(this._sendActionsImpl(actions, optDesc)) as unknown as Promise<any[]>;
  }

  /**
   * Sends a single action to the server to be applied. Calls this.sendActions to manage the
   * optional bundle.
   * @param {String} optDesc: Optional description of the actions to be shown in the log.
   */
  public sendAction(action: UserAction, optDesc?: string): Promise<any> {
    return this.sendActions([action], optDesc).then((retValues) => retValues[0]);
  }

  public registerVirtualTable(tableId: string, Cons: typeof TableData) {
    this._virtualTablesFunc.set(tableId, Cons);
  }

  // See documentation of sendActions().
  private async _sendActionsImpl(actions: UserAction[], optDesc?: string): Promise<any[]> {
    const tableName = String(actions[0]?.[1]);
    if (this._virtualTablesFunc?.has(tableName)) {
      // Actions applying to virtual tables are handled directly by their TableData instance.
      for (const action of actions) {
        if (!isDataAction(action)) {
          throw new Error('virtual table received an action it cannot handle');
        }
        if (getTableId(action) !== tableName) {
          throw new Error('virtual table actions mixed with other actions');
        }
      }
      const tableActions = actions.map(a => [a[0], ...a.slice(2)]);
      // The type on sendTableActions seems kind of misleading, and
      // only working because UserAction is defined weakly. The first
      // thing the method does is splice back in the table names...
      return this.getTable(tableName)!.sendTableActions(tableActions, optDesc);
    }
    const eventData = {actions};
    this.sendActionsEmitter.emit(eventData);
    const options = { desc: optDesc };
    if (this._shouldIncludeInBundle && !this._shouldIncludeInBundle(actions)) {
      this._triggerBundleFinalize?.();
      await this._lastBundlePromise;
    }
    if (this._bundlesPending) {
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


/**
 * Options to startBundlingAction().
 */
export interface BundlingOptions<T = unknown> {
  // Description of the action bundle.
  description: string|null;

  // Checker for whether an action belongs in the current bundle. If not, finalize() will be
  // called immediately. Note that this checker is NOT applied for actions sent from prepare()
  // or finalize() callbacks, only those in between.
  shouldIncludeInBundle: (actions: UserAction[]) => boolean;

  // Callback to start this action bundle.
  prepare: () => T|Promise<T>;

  // Callback to finalize this action bundle.
  finalize: () => Promise<void>;
}

/**
 * Result of startBundlingActions(), to allow waiting for prepare() to complete, and to trigger
 * finalize() manually, and to wait for the full bundle to complete.
 */
export interface BundlingInfo<T = unknown> {
  // Promise for when the prepare() has completed. Note that sometimes it's delayed until the
  // previous bundle has been finalized.
  preparePromise: Promise<T>;

  // Ask DocData to call the finalize callback immediately.
  triggerFinalize: () => void;

  // Promise for when the bundle has been finalized.
  completionPromise: Promise<void>;
}

type Constructor<T> = new (...args: any[]) => T;
