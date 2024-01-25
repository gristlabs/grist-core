import {ColumnFilter} from 'app/client/models/ColumnFilter';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {TableData} from 'app/client/models/TableData';
import {buildColFilter, ColumnFilterFunc} from 'app/common/ColumnFilterFunc';
import {buildRowFilter, RowFilterFunc, RowValueFunc } from 'app/common/RowFilterFunc';
import {UIRowId} from 'app/plugin/GristAPI';
import {Computed, Disposable, Observable, UseCB} from 'grainjs';

export type {ColumnFilterFunc};

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
 * to reflect the changes in an open filter dialog.
 */
export class SectionFilter extends Disposable {
  public readonly sectionFilterFunc: Observable<RowFilterFunc<UIRowId>>;

  private _openFilterOverride: Observable<OpenColumnFilter|null> = Observable.create(this, null);

  constructor(public viewSection: ViewSectionRec, private _tableData: TableData) {
    super();

    this.sectionFilterFunc = Computed.create(this, this._openFilterOverride, (use, openFilter) => {
      const openFilterFilterFunc = openFilter && use(openFilter.colFilter.filterFunc);
      function getFilterFunc(fieldOrColumn: ViewFieldRec|ColumnRec, colFilter: ColumnFilterFunc|null) {
        if (openFilter?.colRef === fieldOrColumn.origCol().getRowId()) {
          return openFilterFilterFunc;
        }
        return colFilter;
      }
      return this.buildFilterFunc(getFilterFunc, use);
    });
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

  /**
   * Builds a filter function that combines the filter function of all the columns. You can use
   * `getFilterFunc(column, colFilter)` to customize the filter func for each column. It calls
   * `getFilterFunc` right away.
   */
  public buildFilterFunc(getFilterFunc: ColFilterCB, use: UseCB) {
    const filters = use(this.viewSection.filters);
    const funcs: Array<RowFilterFunc<UIRowId> | null> = filters.map(({filter, fieldOrColumn}) => {
      const colFilter = buildColFilter(use(filter), use(use(fieldOrColumn.origCol).type));
      const filterFunc = getFilterFunc(fieldOrColumn, colFilter);

      const getter = this._tableData.getRowPropFunc(fieldOrColumn.colId.peek());

      if (!filterFunc || !getter) { return null; }

      return buildRowFilter(getter as RowValueFunc<UIRowId>, filterFunc);
    }).filter(f => f !== null); // Filter out columns that don't have a filter

    return (rowId: UIRowId) => rowId === 'new' || funcs.every(f => Boolean(f && f(rowId)));
  }
}
