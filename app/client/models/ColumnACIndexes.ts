/**
 * Implements a cache of ACIndex objects for columns in Grist table.
 *
 * The getColACIndex() function returns the corresponding ACIndex, building it if needed and
 * caching for subsequent calls. Any change to the column or a value in it invalidates the cache.
 *
 * It is available as tableData.columnACIndexes.
 *
 * It is currently used for auto-complete in the ReferenceEditor widget.
 */
import {ACIndex, ACIndexImpl} from 'app/client/lib/ACIndex';
import {UserError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {DocAction} from 'app/common/DocActions';
import {isBulkUpdateRecord, isUpdateRecord} from 'app/common/DocActions';
import {getSetMapValue, localeCompare, nativeCompare} from 'app/common/gutil';
import {BaseFormatter} from 'app/common/ValueFormatter';

export interface ICellItem {
  rowId: number|'new';
  text: string;           // Formatted cell text.
  cleanText: string;      // Trimmed lowercase text for searching.
}


export class ColumnACIndexes {
  private _cachedColIndexes = new Map<string, ACIndex<ICellItem>>();

  constructor(private _tableData: TableData) {
    // Whenever a table action is applied, consider invalidating per-column caches.
    this._tableData.tableActionEmitter.addListener(this._invalidateCache, this);
    this._tableData.dataLoadedEmitter.addListener(this._clearCache, this);
  }

  /**
   * Returns the column index for the given column, using a cached one if available.
   * The formatter should be created using field.createVisibleColFormatter(). It's assumed that
   * getColACIndex() is called for the same column with the the same formatter.
   */
  public getColACIndex(colId: string, formatter: BaseFormatter): ACIndex<ICellItem> {
    return getSetMapValue(this._cachedColIndexes, colId, () => this._buildColACIndex(colId, formatter));
  }

  private _buildColACIndex(colId: string, formatter: BaseFormatter): ACIndex<ICellItem> {
    const rowIds = this._tableData.getRowIds();
    const valColumn = this._tableData.getColValues(colId);
    if (!valColumn) {
      throw new UserError(`Invalid column ${this._tableData.tableId}.${colId}`);
    }
    const items: ICellItem[] = valColumn.map((val, i) => {
      const rowId = rowIds[i];
      const text = formatter.formatAny(val);
      const cleanText = text.trim().toLowerCase();
      return {rowId, text, cleanText};
    });
    items.sort(itemCompare);
    return new ACIndexImpl(items);
  }

  private _invalidateCache(action: DocAction): void {
    if (isUpdateRecord(action) || isBulkUpdateRecord(action)) {
      // If the update only affects existing records, only invalidate affected columns.
      const colValues = action[3];
      for (const colId of Object.keys(colValues)) {
        this._cachedColIndexes.delete(colId);
      }
    } else {
      // For add/delete actions and all schema changes, drop the cache entirelly to be on the safe side.
      this._clearCache();
    }
  }

  private _clearCache(): void {
    this._cachedColIndexes.clear();
  }
}

function itemCompare(a: ICellItem, b: ICellItem) {
  return localeCompare(a.cleanText, b.cleanText) ||
    localeCompare(a.text, b.text) ||
    nativeCompare(a.rowId, b.rowId);
}
