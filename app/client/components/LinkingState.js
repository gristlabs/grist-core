const _ = require('underscore');
const ko = require('knockout');
const dispose = require('../lib/dispose');
const gutil = require('app/common/gutil');
const {isRefListType} = require("app/common/gristTypes");

/**
 * Returns if the first table is a summary of the second. If both are summary tables, returns true
 * if the second table is a more detailed summary, i.e. has additional group-by columns.
 * @param {MetaRowModel} summary: RowModel for the table to check for being the summary table.
 * @param {MetaRowModel} detail: RowModel for the table to check for being the detailed version.
 * @returns {Boolean} Whether the first argument is a summarized version of the second.
 */
function isSummaryOf(summary, detail) {
  let summarySource = summary.summarySourceTable();
  if (summarySource === detail.getRowId()) { return true; }
  let detailSource = detail.summarySourceTable();
  return (summarySource &&
    detailSource === summarySource &&
    summary.getRowId() !== detail.getRowId() &&
    gutil.isSubset(summary.summarySourceColRefs(), detail.summarySourceColRefs()));
}


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
function LinkingState(gristDoc, srcSection, srcColId, tgtSection, tgtColId, byAllShown) {
  this._srcSection = srcSection;

  let srcTableModel = gristDoc.getTableModel(srcSection.table().tableId());
  let srcTableData = srcTableModel.tableData;

  // Function from srcRowId (i.e. srcSection.activeRowId()) to the source value. It is used for
  // filtering or for cursor positioning, depending on the setting of tgtCol.
  let srcValueFunc = srcColId ? srcTableData.getRowPropFunc(srcColId) : _.identity;

  // If linking affects target section's cursor, this will be a computed for the cursor rowId.
  this.cursorPos = null;

  // If linking affects filtering, this is a computed for the current filtering state, as a
  // {[colId]: colValues} mapping, with a dependency on srcSection.activeRowId(). Otherwise, null.
  this.filterColValues = null;

  // A computed that evaluates to a filter function to use, or null if not filtering. If
  // filtering, depends on srcSection.activeRowId().
  if (tgtColId) {
    const tgtCol = tgtSection.table().columns().all().find(c => c.colId() === tgtColId);
    const operations = {[tgtColId]: isRefListType(tgtCol.type()) ? 'intersects' : 'in'};
    if (byAllShown) {
      // (This is legacy code that isn't currently reachable)
      // Include all values present in srcSection.
      this.filterColValues = this.autoDispose(ko.computed(() => {
        const srcValues = new Set();
        const viewInstance = srcSection.viewInstance();
        if (viewInstance) {
          for (const srcRowId of viewInstance.sortedRows.getKoArray().all()) {
            if (srcRowId !== 'new') {
              srcValues.add(srcValueFunc(srcRowId));
            }
          }
        }
        return {filters: {[tgtColId]: Array.from(srcValues)}};
      }));
    } else if (srcColId) {
      let srcRowModel = this.autoDispose(srcTableModel.createFloatingRowModel());
      let srcCell = srcRowModel.cells[srcColId];
      // If no srcCell, linking is broken; do nothing. This shouldn't happen, but may happen
      // transiently while the separate linking-related observables get updated.
      if (srcCell) {
        this.filterColValues = this.autoDispose(ko.computed(() => {
          const srcRowId = srcSection.activeRowId();
          srcRowModel.assign(srcRowId);
          return {filters: {[tgtColId]: [srcCell()]}, operations};
        }));
      }
    } else {
      this.filterColValues = this.autoDispose(ko.computed(() => {
        const srcRowId = srcSection.activeRowId();
        return {filters: {[tgtColId]: [srcRowId]}, operations};
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
      const srcRowId = srcSection.activeRowId();
      const filters = {};
      const operations = {};
      for (const c of srcSection.table().groupByColumns()) {
        const col = c.summarySource();
        const colId = col.colId();
        const srcValue = srcTableData.getValue(srcRowId, colId);
        filters[colId] = [srcValue];
        if (isDirectSummary) {
          const tgtColType = col.type();
          if (tgtColType === 'ChoiceList' || tgtColType.startsWith('RefList:')) {
            operations[colId] = 'intersects';
          }
        }
      }
      return {filters, operations};
    }));
  } else if (isSummaryOf(tgtSection.table(), srcSection.table())) {
    // TODO: We should move the cursor, but don't currently it for summaries. For that, we need a
    // column or map representing the inverse of summary table's "group" column.
  } else {
    this.cursorPos = this.autoDispose(ko.computed(() => srcValueFunc(srcSection.activeRowId())));
  }
}
dispose.makeDisposable(LinkingState);

/**
 * Returns a boolean indicating whether editing should be disabled in the destination section.
 */
LinkingState.prototype.disableEditing = function() {
  return this.filterColValues && this._srcSection.activeRowId() === 'new';
};

module.exports = LinkingState;
