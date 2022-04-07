import {DataRowModel} from "app/client/models/DataRowModel";
import * as DataTableModel from "app/client/models/DataTableModel";
import {DocModel} from 'app/client/models/DocModel';
import {ColumnRec} from "app/client/models/entities/ColumnRec";
import {TableRec} from "app/client/models/entities/TableRec";
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {RowId} from "app/client/models/rowset";
import {LinkConfig} from "app/client/ui/selectBy";
import {ClientQuery, QueryOperation} from "app/common/ActiveDocAPI";
import {isList, isRefListType} from "app/common/gristTypes";
import * as gutil from "app/common/gutil";
import {encodeObject} from 'app/plugin/objtypes';
import {Disposable, toKo} from "grainjs";
import * as  ko from "knockout";
import mapValues = require('lodash/mapValues');
import pickBy = require('lodash/pickBy');
import identity = require('lodash/identity');


/**
 * Returns if the first table is a summary of the second. If both are summary tables, returns true
 * if the second table is a more detailed summary, i.e. has additional group-by columns.
 * @param summary: TableRec for the table to check for being the summary table.
 * @param detail: TableRec for the table to check for being the detailed version.
 * @returns {Boolean} Whether the first argument is a summarized version of the second.
 */
function isSummaryOf(summary: TableRec, detail: TableRec): boolean {
  const summarySource = summary.summarySourceTable();
  if (summarySource === detail.getRowId()) { return true; }
  const detailSource = detail.summarySourceTable();
  return (Boolean(summarySource) &&
    detailSource === summarySource &&
    summary.getRowId() !== detail.getRowId() &&
    gutil.isSubset(summary.summarySourceColRefs(), detail.summarySourceColRefs()));
}

export type FilterColValues = Pick<ClientQuery, "filters" | "operations">;

/**
 * Maintains state useful for linking sections, i.e. auto-filtering and auto-scrolling.
 * Exposes .filterColValues, which is either null or a computed evaluating to a filtering object;
 * and .cursorPos, which is either null or a computed that evaluates to a cursor position.
 * LinkingState must be created with a valid srcSection and tgtSection.
 *
 * There are several modes of linking:
 * (1) If tgtColId is set, tgtSection will be filtered to show rows whose values of target column
 *     are equal to the value of source column in srcSection at the cursor. With byAllShown set, all
 *     values in srcSection are used (rather than only the value in the cursor).
 * (2) If srcSection is a summary of tgtSection, then tgtSection is filtered to show only those
 *     rows that match the row at the cursor of srcSection.
 * (3) If tgtColId is null, tgtSection is scrolled to the rowId determined by the value of the
 *     source column at the cursor in srcSection.
 *
 * @param gristDoc: GristDoc instance, for getting the relevant TableData objects.
 * @param srcSection: RowModel for the section that drives the target section.
 * @param srcColId: Name of the column that drives the target section, or null to use rowId.
 * @param tgtSection: RowModel for the section that's being driven.
 * @param tgtColId: Name of the reference column to auto-filter by, or null to auto-scroll.
 * @param byAllShown: For auto-filter, filter by all values in srcSection rather than only the
 *    value at the cursor. The user can use column filters on srcSection to control what's shown
 *    in the linked tgtSection.
 */
export class LinkingState extends Disposable {
  // If linking affects target section's cursor, this will be a computed for the cursor rowId.
  public readonly cursorPos?: ko.Computed<RowId>;

  // If linking affects filtering, this is a computed for the current filtering state, as a
  // {[colId]: colValues} mapping, with a dependency on srcSection.activeRowId()
  public readonly filterColValues?: ko.Computed<FilterColValues>;

  // Get default values for a new record so that it continues to satisfy the current linking filters
  public readonly getDefaultColValues: () => any;

  private _srcSection: ViewSectionRec;
  private _srcTableModel: DataTableModel;
  private _srcCol: ColumnRec;
  private _srcColId: string | undefined;

  constructor(docModel: DocModel, linkConfig: LinkConfig) {
    super();
    const {srcSection, srcCol, srcColId, tgtSection, tgtCol, tgtColId} = linkConfig;
    this._srcSection = srcSection;
    this._srcCol = srcCol;
    this._srcColId = srcColId;
    this._srcTableModel = docModel.dataTables[srcSection.table().tableId()];
    const srcTableData = this._srcTableModel.tableData;

    if (tgtColId) {
      const operation = isRefListType(tgtCol.type()) ? 'intersects' : 'in';
      if (srcSection.parentKey() === 'custom') {
        this.filterColValues = this._srcCustomFilter(tgtColId, operation);
      } else if (srcColId) {
        this.filterColValues = this._srcCellFilter(tgtColId, operation);
      } else {
        this.filterColValues = this._simpleFilter(tgtColId, operation, (rowId => [rowId]));
      }
    } else if (srcColId && isRefListType(srcCol.type())) {
      this.filterColValues = this._srcCellFilter('id', 'in');
    } else if (isSummaryOf(srcSection.table(), tgtSection.table())) {
      // We filter summary tables when a summary section is linked to a more detailed one without
      // specifying src or target column. The filtering is on the shared group-by column (i.e. all
      // those in the srcSection).
      // TODO: This approach doesn't help cursor-linking (the other direction). If we have the
      // inverse of summary-table's 'group' column, we could implement both, and more efficiently.
      const isDirectSummary = srcSection.table().summarySourceTable() === tgtSection.table().getRowId();
      const _filterColValues = ko.observable<FilterColValues>();
      this.filterColValues = this.autoDispose(ko.computed(() => _filterColValues()));

      // source data table could still be loading (this could happen after changing the group by
      // columns of a linked summary table for instance), hence the below listeners.
      this.autoDispose(srcTableData.dataLoadedEmitter.addListener(_update));
      this.autoDispose(srcTableData.tableActionEmitter.addListener(_update));

      _update();
      function _update() {
        const result: FilterColValues = {filters: {}, operations: {}};
        const srcRowId = srcSection.activeRowId();
        for (const c of srcSection.table().groupByColumns()) {
          const col = c.summarySource();
          const colId = col.colId();
          const srcValue = srcTableData.getValue(srcRowId as number, colId);
          result.filters[colId] = [srcValue];
          result.operations[colId] = 'in';
          if (isDirectSummary) {
            const tgtColType = col.type();
            if (tgtColType === 'ChoiceList' || tgtColType.startsWith('RefList:')) {
              result.operations[colId] = 'intersects';
            }
          }
        }
        _filterColValues(result);
      }
    } else if (isSummaryOf(tgtSection.table(), srcSection.table())) {
      // TODO: We should move the cursor, but don't currently it for summaries. For that, we need a
      // column or map representing the inverse of summary table's "group" column.
    } else if (srcSection.parentKey() === 'custom') {
      this.filterColValues = this._srcCustomFilter('id', 'in');
    } else {
      const srcValueFunc = srcColId ? this._makeSrcCellGetter() : identity;
      if (srcValueFunc) {
        this.cursorPos = this.autoDispose(ko.computed(() =>
          srcValueFunc(srcSection.activeRowId()) as RowId
        ));
      }

      if (!srcColId) {
        // This is a same-record link: copy getDefaultColValues from the source if possible
        const getDefaultColValues = srcSection.linkingState()?.getDefaultColValues;
        if (getDefaultColValues) {
          this.getDefaultColValues = getDefaultColValues;
        }
      }
    }

    if (!this.getDefaultColValues) {
      this.getDefaultColValues = () => {
        if (!this.filterColValues) {
          return {};
        }
        const {filters, operations} = this.filterColValues.peek();
        return mapValues(
          pickBy(filters, (value: any[], key: string) => value.length > 0 && key !== "id"),
          (value, key) => operations[key] === "intersects" ? encodeObject(value) : value[0]
        );
      };
    }
  }

  /**
   * Returns a boolean indicating whether editing should be disabled in the destination section.
   */
  public disableEditing(): boolean {
    return Boolean(this.filterColValues) && this._srcSection.activeRowId() === 'new';
  }

  // Value for this.filterColValues filtering based on a single column
  private _simpleFilter(
    colId: string, operation: QueryOperation, valuesFunc: (rowId: RowId|null) => any[]
  ): ko.Computed<FilterColValues> {
    return this.autoDispose(ko.computed(() => {
      const srcRowId = this._srcSection.activeRowId();
      if (srcRowId === null) {
        console.warn("_simpleFilter activeRowId is null");
        return { filters: {}, operations: {}};
      }
      const values = valuesFunc(srcRowId);
      return {filters: {[colId]: values}, operations: {[colId]: operation}} as FilterColValues;
    }));
  }

  // Value for this.filterColValues based on the value in srcCol at the selected row
  private _srcCellFilter(colId: string, operation: QueryOperation): ko.Computed<FilterColValues> | undefined {
    const srcCellGetter = this._makeSrcCellGetter();
    if (srcCellGetter) {
      const isSrcRefList = isRefListType(this._srcCol.type());
      return this._simpleFilter(colId, operation, rowId => {
        const value = srcCellGetter(rowId);
        if (isSrcRefList) {
          if (isList(value)) {
            return value.slice(1);
          } else {
            // The cell value is invalid, so the filter should be empty
            return [];
          }
        } else {
          return [value];
        }
      });
    }
  }

  // Value for this.filterColValues based on the values in srcSection.selectedRows
  private _srcCustomFilter(colId: string, operation: QueryOperation): ko.Computed<FilterColValues> | undefined {
    return this.autoDispose(ko.computed(() => {
      const values = toKo(ko, this._srcSection.selectedRows)();
      return {filters: {[colId]: values}, operations: {[colId]: operation}} as FilterColValues;
    }));
  }

  // Returns a function which returns the value of the cell
  // in srcCol in the selected record of srcSection.
  // Uses a row model to create a dependency on the cell's value,
  // so changes to the cell value will notify observers
  private _makeSrcCellGetter() {
    const srcRowModel = this.autoDispose(this._srcTableModel.createFloatingRowModel()) as DataRowModel;
    const srcCellObs = srcRowModel.cells[this._srcColId!];
    // If no srcCellObs, linking is broken; do nothing. This shouldn't happen, but may happen
    // transiently while the separate linking-related observables get updated.
    if (!srcCellObs) {
      return null;
    }
    return (rowId: RowId | null) => {
      srcRowModel.assign(rowId);
      if (rowId === 'new') {
        return 'new';
      }
      return srcCellObs();
    };
  }
}
