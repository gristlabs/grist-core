/**
 *
 * A really bad tiny implementation of daff (tabular diff tool) to apply changes.
 * Very incomplete and naive and bad.
 *
 */

import { TableDelta } from 'app/common/ActionSummary';
import { PatchItem, PatchLog } from 'app/common/ActiveDocAPI';
import { UserAction } from 'app/common/DocActions';
import { DocStateComparisonDetails } from 'app/common/DocState';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { OptDocSession } from 'app/server/lib/DocSession';

export class Patch {
  private _otherId: number|undefined;
  private _linkId: number|undefined;

  public constructor(public gristDoc: ActiveDoc, public docSession: OptDocSession) {}

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
        if (delta.updateRows.length > 0) {
          changes.push(...await this._updateRows(tableId, delta));
        }
        if (delta.addRows.length > 0) {
          changes.push(...await this._addRows(tableId, delta));
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
    const rows = delta.updateRows;
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
    const result = await this.gristDoc.applyUserActions(
      this.docSession, actions, {
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
    await this._applyUserActions([
      ['UpdateRecord', tableId, rowId, { [colId]: post }],
    ]);
    return {
      msg: 'updated a cell',
    };
  }
}
