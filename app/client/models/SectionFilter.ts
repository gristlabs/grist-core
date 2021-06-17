import {KoArray} from 'app/client/lib/koArray';
import {ColumnFilter} from 'app/client/models/ColumnFilter';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {RowId} from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';
import {buildColFilter, ColumnFilterFunc} from 'app/common/ColumnFilterFunc';
import {buildRowFilter, RowFilterFunc, RowValueFunc } from 'app/common/RowFilterFunc';
import {Computed, Disposable, MutableObsArray, obsArray, Observable, UseCB} from 'grainjs';

export {ColumnFilterFunc} from 'app/common/ColumnFilterFunc';

interface OpenColumnFilter {
  fieldRef: number;
  colFilter: ColumnFilter;
}

type ColFilterCB = (field: ViewFieldRec, colFilter: ColumnFilterFunc|null) => ColumnFilterFunc|null;

/**
 * SectionFilter represents a collection of column filters in place for a view section. It is created
 * out of `viewFields` and `tableData`, and provides a Computed `sectionFilterFunc` that users can
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

  constructor(public viewFields: ko.Computed<KoArray<ViewFieldRec>>, private _tableData: TableData) {
    super();

    const columnFilterFunc = Computed.create(this, this._openFilterOverride, (use, openFilter) => {
      const openFilterFilterFunc = openFilter && use(openFilter.colFilter.filterFunc);
      function getFilterFunc(field: ViewFieldRec, colFilter: ColumnFilterFunc|null) {
        if (openFilter?.fieldRef === field.getRowId()) {
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
   * Allows to override a single filter for a given fieldRef. Multiple calls to `setFilterOverride` will overwrite
   * previously set values.
   */
  public setFilterOverride(fieldRef: number, colFilter: ColumnFilter) {
    this._openFilterOverride.set(({fieldRef, colFilter}));
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
   * Builds a filter function that combines the filter function of all the fields. You can use
   * `getFilterFunc(field, colFilter)` to customize the filter func for each field. It calls
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
   * fields. You can use `getFilterFunc(field, colFilter)` to customize the filter func for each
   * field. It calls `getFilterFunc` right away
   */
  private _buildPlainFilterFunc(getFilterFunc: ColFilterCB, use: UseCB): RowFilterFunc<RowId> {
    const fields = use(use(this.viewFields).getObservable());
    const funcs: Array<RowFilterFunc<RowId> | null> = fields.map(f => {
      const colFilter = buildColFilter(use(f.activeFilter), use(use(f.column).type));
      const filterFunc = getFilterFunc(f, colFilter);

      const getter = this._tableData.getRowPropFunc(f.colId.peek());

      if (!filterFunc || !getter) { return null; }

      return buildRowFilter(getter as RowValueFunc<RowId>, filterFunc);
    }).filter(f => f !== null); // Filter out columns that don't have a filter

    return (rowId: RowId) => funcs.every(f => Boolean(f && f(rowId)));
  }
}
