import {GristDoc} from "app/client/components/GristDoc";
import {DataRowModel} from "app/client/models/DataRowModel";
import {TableRec} from "app/client/models/entities/TableRec";
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {LinkConfig} from "app/client/ui/selectBy";
import {ClientQuery, QueryOperation} from "app/common/ActiveDocAPI";
import {isRefListType} from "app/common/gristTypes";
import * as gutil from "app/common/gutil";
import {Disposable} from "grainjs";
import * as  ko from "knockout";
import * as  _ from "underscore";


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

type FilterColValues = Pick<ClientQuery, "filters" | "operations">;

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
  public readonly cursorPos: ko.Computed<number> | null;
  public readonly filterColValues: ko.Computed<FilterColValues> | null;
  private _srcSection: ViewSectionRec;

  constructor(gristDoc: GristDoc, linkConfig: LinkConfig) {
    super();
    const {srcSection, srcColId, tgtSection, tgtCol, tgtColId} = linkConfig;
    this._srcSection = srcSection;

    const srcTableModel = gristDoc.getTableModel(srcSection.table().tableId());
    const srcTableData = srcTableModel.tableData;

    // Function from srcRowId (i.e. srcSection.activeRowId()) to the source value. It is used for
    // filtering or for cursor positioning, depending on the setting of tgtCol.
    const srcValueFunc = srcColId ? srcTableData.getRowPropFunc(srcColId)! : _.identity;

    // If linking affects target section's cursor, this will be a computed for the cursor rowId.
    this.cursorPos = null;

    // If linking affects filtering, this is a computed for the current filtering state, as a
    // {[colId]: colValues} mapping, with a dependency on srcSection.activeRowId(). Otherwise, null.
    this.filterColValues = null;

    // A computed that evaluates to a filter function to use, or null if not filtering. If
    // filtering, depends on srcSection.activeRowId().
    if (tgtColId) {
      const operations = {[tgtColId]: isRefListType(tgtCol.type()) ? 'intersects' : 'in' as QueryOperation};
      if (srcColId) {
        const srcRowModel = this.autoDispose(srcTableModel.createFloatingRowModel()) as DataRowModel;
        const srcCell = srcRowModel.cells[srcColId];
        // If no srcCell, linking is broken; do nothing. This shouldn't happen, but may happen
        // transiently while the separate linking-related observables get updated.
        if (srcCell) {
          this.filterColValues = this.autoDispose(ko.computed(() => {
            const srcRowId = srcSection.activeRowId();
            srcRowModel.assign(srcRowId);
            return {filters: {[tgtColId]: [srcCell()]}, operations} as FilterColValues;
          }));
        }
      } else {
        this.filterColValues = this.autoDispose(ko.computed(() => {
          const srcRowId = srcSection.activeRowId();
          return {filters: {[tgtColId]: [srcRowId]}, operations} as FilterColValues;
        }));
      }
    } else if (isSummaryOf(srcSection.table(), tgtSection.table())) {
      // We filter summary tables when a summary section is linked to a more detailed one without
      // specifying src or target column. The filtering is on the shared group-by column (i.e. all
      // those in the srcSection).
      // TODO: This approach doesn't help cursor-linking (the other direction). If we have the
      // inverse of summary-table's 'group' column, we could implement both, and more efficiently.
      const isDirectSummary = srcSection.table().summarySourceTable() === tgtSection.table().getRowId();
      this.filterColValues = this.autoDispose(ko.computed(() => {
        const result: FilterColValues = {filters: {}, operations: {}};
        const srcRowId = srcSection.activeRowId();
        for (const c of srcSection.table().groupByColumns()) {
          const col = c.summarySource();
          const colId = col.colId();
          const srcValue = srcTableData.getValue(srcRowId as number, colId);
          result.filters[colId] = [srcValue];
          if (isDirectSummary) {
            const tgtColType = col.type();
            if (tgtColType === 'ChoiceList' || tgtColType.startsWith('RefList:')) {
              result.operations![colId] = 'intersects';
            }
          }
        }
        return result;
      }));
    } else if (isSummaryOf(tgtSection.table(), srcSection.table())) {
      // TODO: We should move the cursor, but don't currently it for summaries. For that, we need a
      // column or map representing the inverse of summary table's "group" column.
    } else {
      this.cursorPos = this.autoDispose(ko.computed(() =>
        srcValueFunc(
          srcSection.activeRowId() as number
        ) as number
      ));
    }
  }

  /**
   * Returns a boolean indicating whether editing should be disabled in the destination section.
   */
  public disableEditing(): boolean {
    return Boolean(this.filterColValues) && this._srcSection.activeRowId() === 'new';
  }
}
