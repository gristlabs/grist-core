/**
 * Implements a cache of values computed from the data in a Grist column.
 */
import {TableData} from 'app/client/models/TableData';
import {DocAction} from 'app/common/DocActions';
import {isBulkUpdateRecord, isUpdateRecord} from 'app/common/DocActions';
import {getSetMapValue} from 'app/common/gutil';

export class ColumnCache<T> {
  private _cachedColIndexes = new Map<string, T>();

  constructor(private _tableData: TableData) {
    // Whenever a table action is applied, consider invalidating per-column caches.
    this._tableData.tableActionEmitter.addListener(this._invalidateCache, this);
    this._tableData.dataLoadedEmitter.addListener(this._clearCache, this);
  }

  /**
   * Returns the cached value for the given column, or calculates and caches the value using the
   * provided calc() function.
   */
  public getValue(colId: string, calc: () => T): T {
    return getSetMapValue(this._cachedColIndexes, colId, calc);
  }

  private _invalidateCache(action: DocAction): void {
    if (isUpdateRecord(action) || isBulkUpdateRecord(action)) {
      // If the update only affects existing records, only invalidate affected columns.
      const colValues = action[3];
      for (const colId of Object.keys(colValues)) {
        this._cachedColIndexes.delete(colId);
      }
    } else {
      // For add/delete actions and all schema changes, drop the cache entirely to be on the safe side.
      this._clearCache();
    }
  }

  private _clearCache(): void {
    this._cachedColIndexes.clear();
  }
}
