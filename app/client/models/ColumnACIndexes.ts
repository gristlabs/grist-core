/**
 * Implements a cache of ACIndex objects for columns in Grist table.
 *
 * The getColACIndex() function returns the corresponding ACIndex, building it if needed and
 * caching for subsequent calls. Any change to the column or a value in it invalidates the cache.
 *
 * It is available as tableData.columnACIndexes.
 *
 * It is currently used for auto-complete in the ReferenceEditor and ReferenceListEditor widgets.
 */
import {ACIndex, ACIndexImpl, normalizeText} from 'app/client/lib/ACIndex';
import {ColumnCache} from 'app/client/models/ColumnCache';
import {UserError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {localeCompare, nativeCompare} from 'app/common/gutil';
import {BaseFormatter} from 'app/common/ValueFormatter';

export interface ICellItem {
  rowId: number|'new';
  text: string;           // Formatted cell text.
  cleanText: string;      // Trimmed lowercase text for searching.
}


export class ColumnACIndexes {
  private _columnCache = new ColumnCache<ACIndex<ICellItem>>(this._tableData);

  constructor(private _tableData: TableData) {}

  /**
   * Returns the column index for the given column, using a cached one if available.
   * The formatter should be created using field.visibleColFormatter(). It's assumed that
   * getColACIndex() is called for the same column with the the same formatter.
   */
  public getColACIndex(colId: string, formatter: BaseFormatter): ACIndex<ICellItem> {
    return this._columnCache.getValue(colId, () => this._buildColACIndex(colId, formatter));
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
      const cleanText = normalizeText(text);
      return {rowId, text, cleanText};
    });
    items.sort(itemCompare);
    return new ACIndexImpl(items);
  }
}

function itemCompare(a: ICellItem, b: ICellItem) {
  return localeCompare(a.cleanText, b.cleanText) ||
    localeCompare(a.text, b.text) ||
    nativeCompare(a.rowId, b.rowId);
}
