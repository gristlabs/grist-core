import { reportError } from 'app/client/models/errors';
import { GristDoc } from 'app/client/components/GristDoc';
import { DocData } from 'app/client/models/DocData';
import { TableData } from 'app/client/models/TableData';
import { concatenateSummaries, summarizeStoredAndUndo } from 'app/common/ActionSummarizer';
import { TableDelta } from 'app/common/ActionSummary';
import { ProcessedAction } from 'app/common/AlternateActions';
import { DisposableWithEvents } from 'app/common/DisposableWithEvents';
import { DocAction, TableDataAction, UserAction } from 'app/common/DocActions';
import { DocDataCache } from 'app/common/DocDataCache';
import { ColTypeMap } from 'app/common/TableData';
import { RowRecord } from 'app/plugin/GristData';
import debounce = require('lodash/debounce');

/**
 * An interface for use while editing a virtual table.
 * This is the interface passed to beforeEdit and afterEdit callbacks.
 * The getRecord method gives access to the record prior to the edit;
 * the getRecordNew method gives access to (an internal copy of)
 * the record after the edit.
 * The same interface is passed in other places, in which case
 * actions and delta are trivial.
 */
export interface IEdit {
  gristDoc: GristDoc,
  actions: ProcessedAction[],  // UserActions plus corresponding DocActions (forward and undo).
  delta: TableDelta,           // A summary of the effect actions would have (or had).

  /**
   * Apply a set of actions. The result is from the store backing the
   * virtual table. Will not trigger beforeEdit or afterEdit callbacks.
   */
  patch(actions: UserAction[]): Promise<ProcessedAction[]>;

  getRecord(rowId: number): RowRecord|undefined;     // A record in the table.
  getRecordNew(rowId: number): RowRecord|undefined;  // A record in the table, after the edit.
  getRowIds(): readonly number[];  // All rowIds in the table.
}

/**
 * Interface with a back-end for a specific virtual table.
 */
export interface IExternalTable {
  name: string;  // the tableId of the virtual table (e.g. GristHidden_WebhookTable)
  initialActions: DocAction[];  // actions to create the table.
  fetchAll(): Promise<TableDataAction>;  // get initial state of the table.
  sync(editor: IEdit): Promise<void>;    // incorporate external changes.
  beforeEdit(editor: IEdit): Promise<void>;  // called prior to committing a change.
  afterEdit(editor: IEdit): Promise<void>;   // called after committing a change.
  afterAnySchemaChange(editor: IEdit): Promise<void>;  // called after any schema change in the document.
}

// A counter to generate unique actionNums for undo actions.
let _counterForUndoActions: number = 1;

/**
 * A flavor of TableData that is backed by external operations and local cache.
 * This lets virtual tables "fit in" to a DocData instance.
 */
export class VirtualTableData extends TableData {

  public gristDoc: GristDoc;
  public ext: IExternalTable;
  public cache: DocDataCache;

  constructor(docData: DocData, tableId: string, tableData: TableDataAction|null, columnTypes: ColTypeMap) {
    super(docData, tableId, tableData, columnTypes);
  }

  public setExt(_ext: IExternalTable) {
    this.ext = _ext;
    this.cache = new DocDataCache(this.ext.initialActions);
  }

  public get name() {
    return this.ext.name;
  }

  public fetchData() {
    return super.fetchData(async () => {
      const data = await this.ext.fetchAll();
      this.cache.docData.getTable(this.name)?.loadData(data);
      return data;
    });
  }

  public async sendTableActions(userActions: UserAction[]): Promise<any[]> {
    const actions = await this._sendTableActionsCore(userActions,
                                                     {isUser: true});
    await this.ext.afterEdit(this._editor(actions));
    return actions.map(action => action.retValues);
  }

  public sync() {
    return this.ext.sync(this._editor());
  }

  public async sendTableAction(action: UserAction): Promise<any> {
    const retValues = await this.sendTableActions([action]);
    return retValues[0];
  }

  public async schemaChange() {
    await this.ext.afterAnySchemaChange(this._editor());
  }

  private _editor(actions: ProcessedAction[] = []): IEdit {
    const summary = concatenateSummaries(
      actions
        .map(action => summarizeStoredAndUndo(action.stored, action.undo)));
    const delta = summary.tableDeltas[this.name];
    return {
      actions,
      delta,
      gristDoc: this.gristDoc,
      getRecord: rowId => this.getRecord(rowId),
      getRecordNew: rowId => this.getRecord(rowId),
      getRowIds: () => this.getRowIds(),
      patch: userActions => this._sendTableActionsCore(userActions, {
        hasTableIds: true,
        isUser: false,
      })
    };
  }

  private async _sendTableActionsCore(userActions: UserAction[], options: {
    isUser: boolean,
    isUndo?: boolean,
    hasTableIds?: boolean,
    actionNum?: any,
  }): Promise<ProcessedAction[]> {
    const {isUndo, isUser, hasTableIds} = options;
    if (!hasTableIds) {
      userActions.forEach((action) => action.splice(1, 0, this.tableId));
    }
    const actions = await this.cache.sendTableActions(userActions);
    if (isUser) {
      const newTable = await this.cache.docData.requireTable(this.name);
      try {
        await this.ext.beforeEdit({
          ...this._editor(actions),
          getRecordNew: rowId => newTable.getRecord(rowId),
        });
      } catch (e) {
        actions.reverse();
        for (const action of actions) {
          await this.cache.sendTableActions(action.undo);
        }
        throw e;
      }
    }

    for (const action of actions) {
      for (const docAction of action.stored) {
        this.docData.receiveAction(docAction);
        this.cache.docData.receiveAction(docAction);
        if (isUser) {
          const code = `ext-${this.name}-${_counterForUndoActions}`;
          _counterForUndoActions++;
          this.gristDoc.getUndoStack().pushAction({
            actionNum: code,
            actionHash: 'hash',
            fromSelf: true,
            otherId: options.actionNum || 0,
            linkId: 0,
            rowIdHint: 0,
            isUndo,
            action,
            op: this._doUndo.bind(this),
          } as any);
        }
      }
    }
    return actions;
  }


  private async _doUndo(actionGroup: {
    action: ProcessedAction,
    actionNum: number|string,
  }, isUndo: boolean) {
    await this._sendTableActionsCore(
      isUndo ? actionGroup.action.undo : actionGroup.action.stored,
      {
        isUndo,
        isUser: true,
        actionNum: actionGroup.actionNum,
        hasTableIds: true,
      });
  }
}

/**
 * Everything needed to run a virtual table. Contains a tableData instance.
 * Subscribes to schema changes. Offers a debouncing lazySync method that
 * will attempt to synchronize the virtual table with the external source
 * one second after last call (or at most 2 seconds after the first
 * call).
 */
export class VirtualTable {
  public lazySync = debounce(this.sync, 1000, {
    maxWait: 2000,
    trailing: true,
  });
  public tableData: VirtualTableData;

  public constructor(private _owner: DisposableWithEvents,
                     _gristDoc: GristDoc,
                     _ext: IExternalTable) {
    if (!_gristDoc.docModel.docData.getTable(_ext.name)) {

      // register the virtual table
      _gristDoc.docModel.docData.registerVirtualTable(_ext.name, VirtualTableData);

      // then process initial actions
      for (const action of _ext.initialActions) {
        _gristDoc.docData.receiveAction(action);
      }

      // pass in gristDoc and external interface
      this.tableData = _gristDoc.docModel.docData.getTable(_ext.name)! as VirtualTableData;
      //this.tableData.docApi = this.docApi;
      this.tableData.gristDoc = _gristDoc;
      this.tableData.setExt(_ext);

      // subscribe to schema changes
      this.tableData.schemaChange().catch(e => reportError(e));
      _owner.listenTo(_gristDoc, 'schemaUpdateAction', () => this.tableData.schemaChange());
    } else {
      this.tableData = _gristDoc.docModel.docData.getTable(_ext.name)! as VirtualTableData;
    }
    // debounce is typed as returning a promise, but doesn't appear to actually do so?
    Promise.resolve(this.lazySync()).catch(e => reportError(e));
  }

  public async sync() {
    if (this._owner.isDisposed()) {
      return;
    }
    await this.tableData.sync();
  }
}
