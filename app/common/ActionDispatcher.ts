import mapValues = require('lodash/mapValues');
import {BulkColValues, ColInfo, ColInfoWithId, ColValues, DocAction} from "./DocActions";

// TODO this replaces modelUtil's ActionDispatcher and bulkActionExpand. Those should be removed.

/**
 * Helper class which provides a `dispatchAction` method that dispatches DocActions received from
 * the server to methods `this.on{ActionType}`, e.g. `this.onUpdateRecord`.
 *
 * Implementation methods `on*` are called with the action as the first argument, and with
 * the action arguments as additional method arguments, for convenience.
 *
 * Methods for bulk actions may be implemented directly, or will iterate through each record in
 * the action, and call the single-record methods for each one.
 */
export abstract class ActionDispatcher {
  public dispatchAction(action: DocAction): void {
    // In node 6 testing, this switch is 5+ times faster than looking up "on"+action[0].
    const a: any[] = action;
    switch (action[0]) {
      case "AddRecord":        return this.onAddRecord       (action, a[1], a[2], a[3]);
      case "UpdateRecord":     return this.onUpdateRecord    (action, a[1], a[2], a[3]);
      case "RemoveRecord":     return this.onRemoveRecord    (action, a[1], a[2]);
      case "BulkAddRecord":    return this.onBulkAddRecord   (action, a[1], a[2], a[3]);
      case "BulkUpdateRecord": return this.onBulkUpdateRecord(action, a[1], a[2], a[3]);
      case "BulkRemoveRecord": return this.onBulkRemoveRecord(action, a[1], a[2]);
      case "ReplaceTableData": return this.onReplaceTableData(action, a[1], a[2], a[3]);
      case "AddColumn":        return this.onAddColumn       (action, a[1], a[2], a[3]);
      case "RemoveColumn":     return this.onRemoveColumn    (action, a[1], a[2]);
      case "RenameColumn":     return this.onRenameColumn    (action, a[1], a[2], a[3]);
      case "ModifyColumn":     return this.onModifyColumn    (action, a[1], a[2], a[3]);
      case "AddTable":         return this.onAddTable        (action, a[1], a[2]);
      case "RemoveTable":      return this.onRemoveTable     (action, a[1]);
      case "RenameTable":      return this.onRenameTable     (action, a[1], a[2]);
      default: throw new Error(`Received unknown action ${action[0]}`);
    }
  }

  protected abstract onAddRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void;
  protected abstract onUpdateRecord(action: DocAction, tableId: string, rowId: number, colValues: ColValues): void;
  protected abstract onRemoveRecord(action: DocAction, tableId: string, rowId: number): void;

  // If not overridden, these will make multiple calls to single-record action methods.
  protected onBulkAddRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {
    for (let i = 0; i < rowIds.length; i++) {
      this.onAddRecord(action, tableId, rowIds[i], mapValues(colValues, (values) => values[i]));
    }
  }
  protected onBulkUpdateRecord(action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void {
    for (let i = 0; i < rowIds.length; i++) {
      this.onUpdateRecord(action, tableId, rowIds[i], mapValues(colValues, (values) => values[i]));
    }
  }
  protected onBulkRemoveRecord(action: DocAction, tableId: string, rowIds: number[]) {
    for (const r of rowIds) {
      this.onRemoveRecord(action, tableId, r);
    }
  }

  protected abstract onReplaceTableData(
    action: DocAction, tableId: string, rowIds: number[], colValues: BulkColValues): void;

  protected abstract onAddColumn(action: DocAction, tableId: string, colId: string, colInfo: ColInfo): void;
  protected abstract onRemoveColumn(action: DocAction, tableId: string, colId: string): void;
  protected abstract onRenameColumn(action: DocAction, tableId: string, oldColId: string, newColId: string): void;
  protected abstract onModifyColumn(action: DocAction, tableId: string, colId: string, colInfo: ColInfo): void;

  protected abstract onAddTable(action: DocAction, tableId: string, columns: ColInfoWithId[]): void;
  protected abstract onRemoveTable(action: DocAction, tableId: string): void;
  protected abstract onRenameTable(action: DocAction, oldTableId: string, newTableId: string): void;
}
