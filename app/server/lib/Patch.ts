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

  public async applyChanges(details: DocStateComparisonDetails): Promise<PatchLog> {
    const changes: PatchItem[] = [];
    try {
      const summary = details.leftChanges;
      if (summary.tableRenames.length > 0) {
        throw new Error('table-level changes cannot be handled yet');
      }
      for (const [, delta] of Object.entries(summary.tableDeltas)) {
        if (delta.columnRenames.length > 0) {
          throw new Error('column-level changes cannot be handled yet');
        }
      }
      for (const [tableId, delta] of Object.entries(summary.tableDeltas)) {
        if (tableId.startsWith('_grist_')) {
          continue;
        }
        if (delta.columnRenames.length > 0) {
          changes.push({
            msg: 'column renames ignored',
          });
        }
        if (delta.removeRows.length > 0) {
          changes.push(...await this.removeRows(tableId, delta));
        }
        if (delta.updateRows.length > 0) {
          changes.push(...await this.updateRows(tableId, delta));
        }
        if (delta.addRows.length > 0) {
          changes.push(...await this.addRows(tableId, delta));
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

  public async change(delta: TableDelta, tableId: string, rowId: number, colId: string,
                      pre: any, post: any): Promise<PatchItem> {
    await this.applyUserActions([
      ['UpdateRecord', tableId, rowId, { [colId]: post }],
    ]);
    // delta.accepted ||= {};
    // delta.accepted.updateRows ||= [];
    // delta.accepted.updateRows.push(rowId);
    return {
      msg: 'did an update',
    };
  }

  public async applyUserActions(actions: UserAction[]) {
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

  public async doAdd(delta: TableDelta, tableId: string, rowId: number, rec: Record<string, any>): Promise<PatchItem> {
    if (rec.manualSort) {
      delete rec.manualSort;
    }
    await this.applyUserActions([
      ['AddRecord', tableId, null, rec],
    ]);
    // delta.accepted ||= {};
    // delta.accepted.addRows ||= [];
    // delta.accepted.addRows.push(rowId);
    return {
      msg: 'did an add',
    };
  }

  public async doRemove(delta: TableDelta, tableId: string, rowId: number,
                        rec: Record<string, any>): Promise<PatchItem> {
    await this.applyUserActions([
      ['RemoveRecord', tableId, rowId],
    ]);
    //delta.accepted ||= {};
    //delta.accepted.removeRows ||= [];
    //delta.accepted.removeRows.push(rowId);
    return {
      msg: 'did a remove',
    };
  }

  public async updateRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const rows = remaining(delta.updateRows, undefined); //, delta.accepted?.updateRows);
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
        changes.push(await this.change(delta, tableId, row, colId, pre, post));
      }
    }
    return changes;
  }

  public async addRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const rows = remaining(delta.addRows, undefined); //delta.accepted?.addRows);
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
      changes.push(await this.doAdd(delta, tableId, row, rec));
    }
    return changes;
  }

  public async removeRows(tableId: string, delta: TableDelta): Promise<PatchItem[]> {
    const changes: PatchItem[] = [];
    const rows = remaining(delta.removeRows, undefined); //delta.accepted?.removeRows);
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
      changes.push(await this.doRemove(delta, tableId, row, rec));
    }
    return changes;
  }
}


function remaining(proposed: number[], accepted: number[]|undefined): number[] {
  const a = new Set(accepted);
  return proposed.filter(n => !a.has(n));
}
