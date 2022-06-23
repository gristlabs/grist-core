import {ColumnFilter} from 'app/client/models/ColumnFilter';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {RowId} from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';
import {buildColFilter, ColumnFilterFunc} from 'app/common/ColumnFilterFunc';
import {buildRowFilter, RowFilterFunc, RowValueFunc } from 'app/common/RowFilterFunc';
import {Computed, Disposable, MutableObsArray, obsArray, Observable, UseCB} from 'grainjs';

export {ColumnFilterFunc} from 'app/common/ColumnFilterFunc';

interface OpenColumnFilter {
  colRef: number;
  colFilter: ColumnFilter;
}

type ColFilterCB = (fieldOrColumn: ViewFieldRec|ColumnRec, colFilter: ColumnFilterFunc|null) => ColumnFilterFunc|null;

/**
 * SectionFilter represents a collection of column filters in place for a view section. It is created
 * out of `filters` (in `viewSection`) and `tableData`, and provides a Computed `sectionFilterFunc` that users can
 * subscribe to in order to update their FilteredRowSource.
 *
 * Additionally, `setFilterOverride()` provides a way to override the current filter for a given colRef,
 * to reflect the changes in an open filter dialog. Also, `addTemporaryRow()` allows to add a rowId
 * that should be present regardless of filters. These rows are removed automatically when an update to the filter
 * results in their being displayed (obviating the need to maintain their rowId explicitly).
 */
export class SectionFilter extends Disposable {
  public readonly sectionFilterFunc: Observable<RowFilterFunc<RowId>>;

  private _openFilterOverride: Observable<OpenColumnFilter|null> = Observable.create(this, null);
  private _tempRows: MutableObsArray<RowId> = obsArray();

  constructor(public viewSection: ViewSectionRec, private _tableData: TableData) {
    super();

    const columnFilterFunc = Computed.create(this, this._openFilterOverride, (use, openFilter) => {
      const openFilterFilterFunc = openFilter && use(openFilter.colFilter.filterFunc);
      function getFilterFunc(fieldOrColumn: ViewFieldRec|ColumnRec, colFilter: ColumnFilterFunc|null) {
        if (openFilter?.colRef === fieldOrColumn.origCol().getRowId()) {
          return openFilterFilterFunc;
        }
        return colFilter;
      }
      return this._buildPlainFilterFunc(getFilterFunc, use);
    });

    this.sectionFilterFunc = Computed.create(this, columnFilterFunc, this._tempRows,
      (_use, filterFunc, tempRows) => this._addRowsToFilter(filterFunc, tempRows));

    // Prune temporary rowIds that are no longer being filtered out.
    this.autoDispose(columnFilterFunc.addListener(f => {
      this._tempRows.set(this._tempRows.get().filter(rowId => !f(rowId)));
    }));
  }

  /**
   * Allows to override a single filter for a given colRef. Multiple calls to `setFilterOverride` will overwrite
   * previously set values.
   */
  public setFilterOverride(colRef: number, colFilter: ColumnFilter) {
    this._openFilterOverride.set(({colRef, colFilter}));
    colFilter.onDispose(() => {
      const override = this._openFilterOverride.get();
      if (override && override.colFilter === colFilter) {
        this._openFilterOverride.set(null);
      }
    });
  }

  public addTemporaryRow(rowId: number) {
    // Only add the rowId if it would otherwise be filtered out
    if (!this.sectionFilterFunc.get()(rowId)) {
      this._tempRows.push(rowId);
    }
  }

  public resetTemporaryRows() {
    this._tempRows.set([]);
  }

  /**
   * Builds a filter function that combines the filter function of all the columns. You can use
   * `getFilterFunc(column, colFilter)` to customize the filter func for each columns. It calls
   * `getFilterFunc` right away. Also, all the rows that were added with `addTemporaryRow()` bypass
   * the filter.
   */
  public buildFilterFunc(getFilterFunc: ColFilterCB, use: UseCB) {
    return this._addRowsToFilter(this._buildPlainFilterFunc(getFilterFunc, use), this._tempRows.get());
  }

  private _addRowsToFilter(filterFunc: RowFilterFunc<RowId>, rows: RowId[]) {
    return (rowId: RowId) => rows.includes(rowId) || (typeof rowId !== 'number') || filterFunc(rowId);
  }

  /**
   * Internal that helps build a filter function that combines the filter function of all
   * columns. You can use `getFilterFunc(column, colFilter)` to customize the filter func for each
   * column. It calls `getFilterFunc` right away.
   */
  private _buildPlainFilterFunc(getFilterFunc: ColFilterCB, use: UseCB): RowFilterFunc<RowId> {
    const filters = use(this.viewSection.filters);
    const funcs: Array<RowFilterFunc<RowId> | null> = filters.map(({filter, fieldOrColumn}) => {
      const colFilter = buildColFilter(use(filter), use(use(fieldOrColumn.origCol).type));
      const filterFunc = getFilterFunc(fieldOrColumn, colFilter);

      const getter = this._tableData.getRowPropFunc(fieldOrColumn.colId.peek());

      if (!filterFunc || !getter) { return null; }

      return buildRowFilter(getter as RowValueFunc<RowId>, filterFunc);
    }).filter(f => f !== null); // Filter out columns that don't have a filter

    return (rowId: RowId) => funcs.every(f => Boolean(f && f(rowId)));
  }
}
