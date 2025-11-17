/**
 *
 * An implementation of daff (tabular diff tool) to apply changes.
 * Incomplete and naive.
 *
 */

import { TableDelta } from 'app/common/ActionSummary';
import { PatchItem, PatchLog } from 'app/common/ActiveDocAPI';
import { UserAction } from 'app/common/DocActions';
import { DocStateComparisonDetails } from 'app/common/DocState';
import { MetaRowRecord, MetaTableData } from 'app/common/TableData';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { OptDocSession } from 'app/server/lib/DocSession';

export class Patch {
  private _otherId: number|undefined;
  private _linkId: number|undefined;
  private _columnsByTableIdAndColId: Record<string, Record<string, MetaRowRecord<'_grist_Tables_column'>>> = {};
  private _columns: MetaTableData<'_grist_Tables_column'>;
  private _tables: MetaTableData<'_grist_Tables'>;

  public constructor(private _activeDoc: ActiveDoc, private _docSession: OptDocSession) {
    // Prepare information about columns for easy access. Perhaps this is overkill
    // since most proposals will be small?
    const columns = this._activeDoc.docData?.getMetaTable('_grist_Tables_column');
    const tables = this._activeDoc.docData?.getMetaTable('_grist_Tables');
    if (!columns || !tables) {
      // Should never happen.
      throw new Error('Attempt to patch before document is initialized');
    }
    this._columns = columns;
    this._tables = tables;
  }

  /**
   * Apply the given comparison as a patch. Return a list of notes.
   * The returned list is currently haphazard, for debugging purposes only.
   */
  public async applyChanges(details: DocStateComparisonDetails): Promise<PatchLog> {
    const changes: PatchItem[] = [];
    try {
      const summary = details.leftChanges;

      // Throw an error if there are structural changes. We'll be able
      // to handle those! But not yet.
      if (summary.tableRenames.length > 0) {
        throw new Error('table-level changes cannot be handled yet');
      }
      for (const [, delta] of Object.entries(summary.tableDeltas)) {
        if (delta.columnRenames.length > 0) {
          throw new Error('column-level changes cannot be handled yet');
        }
      }

      for (const [tableId, delta] of Object.entries(summary.tableDeltas)) {
        // Ignore metadata for now.
        if (tableId.startsWith('_grist_')) { continue; }
        if (delta.removeRows.length > 0) {
          changes.push(...await this._removeRows(tableId, delta));
        }
        if (delta.addRows.length > 0) {
          changes.push(...await this._addRows(tableId, delta));
        }
        if (delta.updateRows.length > 0) {
          changes.push(...await this._updateRows(tableId, delta));
        }
      }
    } catch (e) {
      changes.push({
        msg: String(e),
        fail: true,
      });
    }
    const applied = changes.some(change => !change.fail);
    return {changes, applied};
  }

  private async _updateRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const addedRows = new Set(delta.addRows);
    // Rows marked as added and updated, we handle with just adding.
    const rows = delta.updateRows.filter(r => !addedRows.has(r));
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          continue;
        }
        const pre = cellDelta[0]?.[0];
        const post = cellDelta[1]?.[0];
        changes.push(await this._changeCell(delta, tableId, row, colId, pre, post));
      }
    }
    return changes;
  }

  private async _addRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const rows = delta.addRows;
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      const rec: Record<string, any> = {};
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          continue;
        }
        rec[colId] = cellDelta[1]?.[0];
      }
      changes.push(await this._doAdd(delta, tableId, row, rec));
    }
    return changes;
  }

  private async _removeRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const rows = delta.removeRows;
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      const rec: Record<string, any> = {};
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          continue;
        }
        rec[colId] = cellDelta[0]?.[0];
      }
      changes.push(await this._doRemove(delta, tableId, row, rec));
    }
    return changes;
  }

  private async _applyUserActions(actions: UserAction[]) {
    const result = await this._activeDoc.applyUserActions(
      this._docSession, actions, {
        otherId: this._otherId,
        linkId: this._linkId,
      }
    );
    if (!this._otherId) {
      this._otherId = result.actionNum;
    }
    this._linkId = result.actionNum;
  }

  private async _doAdd(delta: TableDelta, tableId: string,
                       rowId: number, rec: Record<string, any>): Promise<PatchItem> {
    if ('manualSort' in rec) {
      delete rec.manualSort;
    }
    for (const colId of Object.keys(rec)) {
      if (this._isFormula(tableId, colId)) {
        delete rec[colId];
      }
    }
    await this._applyUserActions([
      ['AddRecord', tableId, null, rec],
    ]);
    return {
      msg: 'added a record',
    };
  }

  private async _doRemove(delta: TableDelta, tableId: string, rowId: number,
                          rec: Record<string, any>): Promise<PatchItem> {
    await this._applyUserActions([
      ['RemoveRecord', tableId, rowId],
    ]);
    return {
      msg: 'removed a record',
    };
  }

  private async _changeCell(delta: TableDelta, tableId: string, rowId: number, colId: string,
                            pre: any, post: any): Promise<PatchItem> {
    if (this._isFormula(tableId, colId)) {
      return {
        msg: 'skipped formula cell',
      };
    }
    await this._applyUserActions([
      ['UpdateRecord', tableId, rowId, { [colId]: post }],
    ]);
    return {
      msg: 'updated a cell',
    };
  }

  private _isFormula(tableId: string, colId: string): boolean {
    const prop = this._getTableColumn(tableId, colId);
    // Careful, isFormula set, with a blank formula, means
    // an empty column.
    return Boolean(prop.isFormula) && Boolean(prop.formula);
  }

  private _getTableColumn(tableId: string, colId: string) {
    const column = this._getTableColumns(tableId)[colId];
    if (!column) {
      throw new Error(`column not found: ${colId}`);
    }
    return column;
  }

  private _getTableColumns(tableId: string) {
    if (this._columnsByTableIdAndColId[tableId]) {
      return this._columnsByTableIdAndColId[tableId];
    }
    const table = this._tables.findRecord('tableId', tableId);
    if (!table) {
      throw new Error(`table not found: ${tableId}`);
    }
    const columns = this._columns.getRecords().filter(rec => rec.parentId === table.id);
    this._columnsByTableIdAndColId[tableId] = Object.fromEntries(columns.map(rec => [String(rec.colId), rec]));
    return this._columnsByTableIdAndColId[tableId];
  }
}
