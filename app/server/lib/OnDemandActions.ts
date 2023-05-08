import {AlternateActions, AlternateStorage} from 'app/common/AlternateActions';
import {DocData} from 'app/common/DocData';
import {TableData} from 'app/common/TableData';
import {IndexColumns} from 'app/server/lib/DocStorage';

export type {ProcessedAction} from 'app/common/AlternateActions';
export type OnDemandStorage = AlternateStorage;

/**
 * Handle converting UserActions to DocActions for onDemand tables.
 */
export class OnDemandActions extends AlternateActions {

  private _tablesMeta: TableData = this._docData.getMetaTable('_grist_Tables');
  private _columnsMeta: TableData = this._docData.getMetaTable('_grist_Tables_column');

  constructor(_storage: OnDemandStorage, private _docData: DocData,
              private _forceOnDemand: boolean = false) {
    super(_storage);
  }

  // TODO: Ideally a faster data structure like an index by tableId would be used to decide whether
  // the table is onDemand.
  public isOnDemand(tableId: string): boolean {
    if (this._forceOnDemand) { return true; }
    const tableRef = this._tablesMeta.findRow('tableId', tableId);
    // OnDemand tables must have a record in the _grist_Tables metadata table.
    return tableRef ? Boolean(this._tablesMeta.getValue(tableRef, 'onDemand')) : false;
  }

  public usesAlternateStorage(tableId: string): boolean {
    return this.isOnDemand(tableId);
  }

  /**
   * Compute the indexes we would like to have, given the current schema.
   */
  public getDesiredIndexes(): IndexColumns[] {
    const desiredIndexes: IndexColumns[] = [];
    for (const c of this._columnsMeta.getRecords()) {
      const t = this._tablesMeta.getRecord(c.parentId as number);
      if (t && t.onDemand && c.type && (c.type as string).startsWith('Ref:')) {
        desiredIndexes.push({tableId: t.tableId as string, colId: c.colId as string});
      }
    }
    return desiredIndexes;
  }
}
