import {KoArray} from 'app/client/lib/koArray';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {RowId} from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';
import {Computed, Disposable, MutableObsArray, obsArray, Observable} from 'grainjs';
import {ColumnFilter} from './ColumnFilter';
import {buildRowFilter, RowFilterFunc, RowValueFunc } from "app/common/RowFilterFunc";
import {buildColFilter} from "app/common/ColumnFilterFunc";

interface OpenColumnFilter {
  fieldRef: number;
  colFilter: ColumnFilter;
}

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

  constructor(viewFields: ko.Computed<KoArray<ViewFieldRec>>, tableData: TableData) {
    super();

    const columnFilterFunc = Computed.create(this, this._openFilterOverride, (use, openFilter) => {
      const fields = use(use(viewFields).getObservable());
      const funcs: Array<RowFilterFunc<RowId> | null> = fields.map(f => {
        const filterFunc = (openFilter && openFilter.fieldRef === f.getRowId()) ?
          use(openFilter.colFilter.filterFunc) :
          buildColFilter(use(f.activeFilter));

        const getter = tableData.getRowPropFunc(use(f.colId));

        if (!filterFunc || !getter) { return null; }

        return buildRowFilter(getter as RowValueFunc<RowId>, filterFunc);
      })
      .filter(f => f !== null); // Filter out columns that don't have a filter

      return (rowId: RowId) => funcs.every(f => Boolean(f && f(rowId)));
    });

    this.sectionFilterFunc = Computed.create(this, columnFilterFunc, this._tempRows,
      (_use, filterFunc, tempRows) => {
      return (rowId: RowId) => tempRows.includes(rowId) || (typeof rowId !== 'number') || filterFunc(rowId);
    });

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
}
