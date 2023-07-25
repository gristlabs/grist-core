import {DataRowModel} from "app/client/models/DataRowModel";
import DataTableModel from "app/client/models/DataTableModel";
import {DocModel} from 'app/client/models/DocModel';
import {ColumnRec} from "app/client/models/entities/ColumnRec";
import {TableRec} from "app/client/models/entities/TableRec";
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {UIRowId} from "app/common/TableData";
import {LinkConfig} from "app/client/ui/selectBy";
import {ClientQuery, QueryOperation} from "app/common/ActiveDocAPI";
import {isList, isListType, isRefListType} from "app/common/gristTypes";
import * as gutil from "app/common/gutil";
import {encodeObject} from 'app/plugin/objtypes';
import {Disposable, toKo} from "grainjs";
import * as  ko from "knockout";
import _ from "lodash";
import mapValues = require('lodash/mapValues');
import pickBy = require('lodash/pickBy');


/**
 * Returns if the first table is a summary of the second. If both are summary tables, returns true
 * if the second table is a more detailed summary, i.e. has additional group-by columns.
 * @param summary: TableRec for the table to check for being the summary table.
 * @param detail: TableRec for the table to check for being the detailed version.
 * @returns {Boolean} Whether the first argument is a summarized version of the second.
 */
//TODO JV: exported to use in buildViewSectionDom, ultimately the functionality should be pushed back
//         into this file I think and the export can be removed
export function isSummaryOf(summary: TableRec, detail: TableRec): boolean {
  const summarySource = summary.summarySourceTable();
  if (summarySource === detail.getRowId()) { return true; }
  const detailSource = detail.summarySourceTable();
  return (Boolean(summarySource) &&
    detailSource === summarySource &&
    summary.getRowId() !== detail.getRowId() &&
    gutil.isSubset(summary.summarySourceColRefs(), detail.summarySourceColRefs()));
}

export type FilterColValues = Pick<ClientQuery, "filters" | "operations"> & {
  filterLabels: {
    [colId: string]: string[]
  };
  colTypes: {[colId: string]: string;}
};

export const EmptyFilterColValues = {filters: {}, filterLabels: {}, operations: {}, colTypes: {}};

/**
 * Maintains state useful for linking sections, i.e. auto-filtering and auto-scrolling.
 * Exposes .filterColValues, which is either null or a computed evaluating to a filtering object;
 * and .cursorPos, which is either null or a computed that evaluates to a cursor position.
 * LinkingState must be created with a valid srcSection and tgtSection.
 *
 * There are several modes of linking:
 * (1) If tgtColId is set, tgtSection will be filtered to show rows whose values of target column
 *     are equal to the value of source column in srcSection at the cursor.
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

 */
export class LinkingState extends Disposable {
  // If linking affects target section's cursor, this will be a computed for the cursor rowId.
  public readonly cursorPos?: ko.Computed<UIRowId>;

  // If linking affects filtering, this is a computed for the current filtering state, as a
  // {[colId]: colValues, [colId]: operations} mapping, with a dependency on srcSection.activeRowId()
  public readonly filterColValues?: ko.Computed<FilterColValues>;

  // Get default values for a new record so that it continues to satisfy the current linking filters
  public readonly getDefaultColValues: () => any;

  private _docModel: DocModel;
  private _srcSection: ViewSectionRec;
  private _srcTableModel: DataTableModel;
  //private _srcCol: ColumnRec;
  private _srcColId: string | undefined;
  //private _tgtCol: ColumnRec;
  //private _tgtColId: string | undefined;

  constructor(docModel: DocModel, linkConfig: LinkConfig) {
    super();
    const {srcSection, srcCol, srcColId, tgtSection, tgtCol, tgtColId} = linkConfig;
    this._docModel = docModel;
    this._srcSection = srcSection;
    //this._srcCol = srcCol;
    this._srcColId = srcColId;
    //this._tgtCol = tgtCol;
    //this._tgtColId = tgtColId;
    this._srcTableModel = docModel.dataTables[srcSection.table().tableId()];
    const srcTableData = this._srcTableModel.tableData;

    if (tgtColId) { //normal filter link
      const operation = isRefListType(tgtCol.type()) ? 'intersects' : 'in';
      if (srcSection.parentKey() === 'custom') {
        this.filterColValues = this._srcCustomFilter(tgtCol, operation);
      } else if (srcColId) { //col->col filter
        this.filterColValues = this._makeFilterObs(srcCol, tgtCol, operation);
      } else { //row->col filter
        this.filterColValues = this._makeFilterObs(null, tgtCol, operation);
      }
    } else if (srcColId) {  // "Lookup link"
    //} else if (srcColId && isRefListType(srcCol.type())) {  // "Lookup link"
      //TODO JV: this make lookups filter if reflist, but if ref then goes to a different case (cursor-link)
      //         Can change this back by removing "isReflistType" from the if
      this.filterColValues = this._makeFilterObs(srcCol, null, 'in');
    } else if (!srcColId && isSummaryOf(srcSection.table(), tgtSection.table())) {
      // row->row && summary, i.e. typical summary filter-linking

      // We filter summary tables when a summary section is linked to a more detailed one without
      // specifying src or target column.
      // We make a filter for each column in the srcSection's groupByColumns

      // source data table could still be loading (this could happen after changing the group by
      // columns of a linked summary table for instance), hence the below listener.
      const _filterColValues = ko.observable<FilterColValues>();
      this.filterColValues = this.autoDispose(ko.computed(() => _filterColValues()));
      this.autoDispose(srcTableData.dataLoadedEmitter.addListener(_update));

      const self = this;
      _update();
      function _update() {
        if (srcSection.isDisposed())
          { return EmptyFilterColValues; }

        //Make one filter for each groupBycolumn
        const resultFilters: ko.Computed<FilterColValues>[] = srcSection.table().groupByColumns().map(col =>
          self._makeFilterObs(col, col.summarySource(),  null)!
          //NOTE: '!' is because _makeFilterObs can return undefined in some error cases. What does this mean?
          //TODO JV: Think about error case. Can we ignore this? should console.warn about this? do we need to handle it?
        );


        //Merge them together in a computed
        const resultComputed = self.autoDispose(ko.computed(() => {
          return _.merge({}, ...resultFilters.map(filtObs => filtObs())) as FilterColValues;
        }));
        console.log("LINKINGSTATE: Assigned filter  " + JSON.stringify(resultComputed())); //TODO JV: TEMP DEBUG
        _filterColValues(resultComputed());
      }
    } else if (srcSection.parentKey() === 'custom') {
      this.filterColValues = this._srcCustomFilter(null, 'in');
    } else { //!tgtCol && !summary-link && (!lookup-link || !reflist),
      //        either same-table cursor-link or non-reflist cursor link
      const srcValueFunc = this._makeValGetter(this._srcSection.table(), this._srcColId || 'id');
      if (srcValueFunc) {
        this.cursorPos = this.autoDispose(ko.computed(() =>
          srcValueFunc(srcSection.activeRowId()) as UIRowId
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


  /**
   * Makes a standard filter link (summary tables and cursor links handled separately)
   *
   * treats (srcCol == undefined) as srcColId == "id", same for tgt
   *
   * if srcColId == "id", uses the currently selected rowId as the selector value
   * else, gets the current value of srcCol in the selected row
   *
   * returns a FilterColValues with a single filter {[tgtColId] : (selectorVals:val[])}
   * note: selectorVals is always a list of values: if reflist the leading "L" is trimmed
   *
   * If unable to initialize, returns undefined
   *
   * NOTE: srcColId and tgtColId MUST NOT both be "id"
   *
   * @param srcColId
   * @param tgtColId
   * @param operation
   * @private
   */
  private _makeFilterObs(
      srcCol: ColumnRec|null, tgtCol: ColumnRec|null, operation: QueryOperation | null
  ): ko.Computed<FilterColValues> | undefined {
    const srcColId = srcCol?.colId();
    const tgtColId = tgtCol?.colId();
    console.log(`in makeFilterObs: srcColId=${srcColId || "id" }, tgtColId=${tgtColId || "id" }`);


    // Note: Terminology is "filter LHS (tgtcol) to match RHS (srccol / selectorval)"
    //if tgtCol (LHS of filter, "filter: [tgtCol || id]  (=/in/intersects) [selectorVal]")
    //implementation-wise, selectorVal is always a list
    //if LHS (tgtCol) is a single value (id or a non-reflist), then operation "in" works fine for the "=" case, or when selector is empty
    //if LHS (tgtCol) is a reflist


    //Assert: if both are null then it's a summary filter or same-table cursor-link, neither of which should go here
    if(srcColId == null && tgtColId == null) {
      throw Error("ERROR in _makeFilterObs: srcCol and tgtCol can't both be null");
    }

    //srcCellGetter is rowId => selectorVal
    //if (srcCol), it's the value in that cell.
    //if (!srcCol), it just returns the rowId, or null if the rowId is "new"
    const selectorValGetter = this._makeValGetter(this._srcSection.table(), srcColId);

    // What's the display value we should use to represent the selectorVal? (relevant for Reference values)
    // if srcCol is a ref, we display its displayColModel(), which is what is shown in the cell
    // However, if srcColId == 'id', there is no srcCol.displayColModel.
    // We also can't use tgtCol.displayColModel, since we're getting values from the source section.
    // The value we want to display therefore is srcRow[tgtCol.visibleColModel.colId]
    //
    // Note: when srcColId == 'id', tgtCol is guaranteed be a ref or reflist column (for this func)
    // Note: if using visibleCol from tgtCol, visibleCol.colId can be undefined (if visible col is rowId)
    const displayColId = srcColId ?
        srcCol!.displayColModel().colId() :
        tgtCol!.visibleColModel().colId();
    const displayValGetter = this._makeValGetter(this._srcSection.table(), displayColId);
    //Note: if src is a reflist, its displayVal will be a list of the visibleCol vals,
    // i.e ["L", visVal1, visVal2], but they won't be formatter()-ed

    //Grab the formatter (for numerics, dates, etc)
    const displayValFormatter = srcColId ? srcCol!.visibleColFormatter() : tgtCol!.visibleColFormatter();


    const isSrcRefList = srcColId && isRefListType(srcCol!.type());
    const isTgtRefList = tgtColId && isRefListType(tgtCol!.type());
    console.log(`makeFilterObs: srcRefList: ${isSrcRefList}; tgtRefList: ${isTgtRefList}`)
    const JV = (window as any).JV;
    JV && console.log(`makeFilterObs: srcCol: ${JV.pCol(srcCol)}; tgtCol: ${JV.pCol(tgtCol)}`)


    if (!selectorValGetter || !displayValGetter) {
      throw Error("ERROR in _makeFilterObs: couldn't create valGetters for srcSection");
      //TODO JV: Error? Shouldn't happen?
      //Originally this case returned undefined, not sure what the error logic was/should be
      //return undefined;
    }

    //Now, we've set up all the stuff independent of rowId.
    //Time to create the actual observable that updates with activeRowId
    return this.autoDispose(ko.computed(() => {

      //Get selector-rowId
      const srcRowId = this._srcSection.activeRowId();
      if (srcRowId === null) {
        console.warn("_makeFilterObs activeRowId is null");
        return EmptyFilterColValues;
      }

      //Get appropriate value from selected row
      const selectorCellVal = selectorValGetter(srcRowId);
      const displayCellVal  = displayValGetter(srcRowId);


      // FilterColValues wants output as a list of 1 or more values to filter by.
      let filterValues: any[];
      let displayValues: any[];
      if(!isSrcRefList) {
        filterValues = [selectorCellVal];
        displayValues = [displayCellVal];

      } else if(isSrcRefList && isList(selectorCellVal)) { //Reflists are: ["L", ref1, ref2, ...], ,must slice off the L
        filterValues = selectorCellVal.slice(1);

        //selectorValue and displayValue might not match up? shouldn't happen but let's yell about it loudly if it crops up
        if (!isList(displayCellVal) || displayCellVal.length != selectorCellVal.length) {
          console.error("Error in LinkingState: displayVal list doesn't match selectorVal list ")
          displayValues = filterValues; //fallback to unformatted values for error
        } else {
          displayValues = displayCellVal.slice(1);
        }

      } else { //isRefList && !isList(), invalid cell value, happens with null reflists, cursor on the 'new' row
        if(selectorCellVal != null) { // Just to make sure there's no other weird cases
          console.warn("Error in LinkingState.makeFilterObs(), srcVal is reflist but has non-list non-null value");
        }
        filterValues = [];
        displayValues = [];
      }


      //Need to use intersects for both ChoiceLists and RefLists
      let newOperation = (tgtColId && isListType(tgtCol!.type())) ? 'intersects' : 'in';

      // Operation needs to change to handle empty selectorVal correctly
      // Blank selector shouldn't mean "show no records", it should mean "show records where that column is also blank"
      if(srcRowId != 'new') { //Don't do any of this on the add-row, that's when we ACTUALLY want to show no records

        // NOTE: choicelist can only ever be in tgtcol (can only be linked from summary table, but summary flattens lists)
        // NOTE: empty choicelist is [""].
        // Note: other types can have falsey values too (e.g. for numbers, 0 is a valid value, but blank cell is null)
        // However, we only check for falsey values when tgtCol is Reflist or Choicelist, so we won't see other types

        // If tgtCol is a list (RefList or Choicelist) and selectorVal is null/blank, operation must be 'empty'
        if (tgtCol?.type() == "ChoiceList" && !isSrcRefList && selectorCellVal == "")    { newOperation = 'empty'; }
        else if (isTgtRefList              && !isSrcRefList && selectorCellVal == 0)     { newOperation = 'empty'; }
        else if (isTgtRefList              &&  isSrcRefList && filterValues.length == 0) { newOperation = 'empty'; }

        // If tgtCol is a single ref, nullness is represented by [0], not by [], so we need to create that null explicitly
        else if (!isTgtRefList && isSrcRefList && filterValues.length == 0) {
          filterValues = [0];
          displayValues = [''];
        }
      }

      const filterLabelVals: string[] = displayValues.map(v => displayValFormatter.formatAny(v));

      //const values = valuesFunc(srcRowId);
      return {
        filters:      {[tgtColId || "id"]: filterValues},
        filterLabels: {[tgtColId || "id"]: filterLabelVals},
        //operations: {[tgtColId || "id"]: operation},
        operations:   {[tgtColId || "id"]: newOperation}, //TODO JV TEMP
        colTypes:     {[tgtColId || "id"]: (tgtCol || srcCol)!.type()} //they must have same type, && at least one must be not-null
      } as FilterColValues;
    }));
  }

  // Value for this.filterColValues based on the values in srcSection.selectedRows
  //"null" for column implies id column
  private _srcCustomFilter(
      column: ColumnRec|null, operation: QueryOperation): ko.Computed<FilterColValues> | undefined {
    const colId = column == null || column.colId() == undefined ? "id" : column.colId();
    return this.autoDispose(ko.computed(() => {
      const values = toKo(ko, this._srcSection.selectedRows)();
      return {
        filters: {[colId]: values},
        filterLabels: {[colId]: values.map(v => v+"")},
        operations: {[colId]: operation},
        colTypes: {[colId]: column?.type() || `Ref:${column?.table().tableId}`} //TODO JV NO REALLY FIX THIS
      } as FilterColValues; //TODO JV: actually fix filterLabels and coltype
    }));
  }


  // Returns a function (rowId) => cellValue, for the specifified table and colId
  // Uses a row model to create a dependency on the cell's value,
  // so changes to the cell value will notify observers
  // An undefined colId means to use the 'id' column, i.e. just return the rowId
  private _makeValGetter(table: TableRec, colId: string | undefined) {
    if(colId == undefined) { //passthrough for id cols
      return (rowId: UIRowId | null) => { return rowId === 'new' ? null : rowId; };
    }

    const tableModel = this._docModel.dataTables[table.tableId()];
    tableModel.tableData.getRowPropFunc(colId);
    const rowModel = this.autoDispose(tableModel.createFloatingRowModel()) as DataRowModel;
    const cellObs = rowModel.cells[colId];
    // If no cellObs, can't make a val getter. This shouldn't happen, but may happen
    // transiently while the separate linking-related observables get updated.
    if (!cellObs) {
      console.warn(`Issue in LinkingState._makeValGetter(${table.tableId()},${colId}): cellObs is nullish`);
      return null;
    }

    return (rowId: UIRowId | null) => {
      rowModel.assign(rowId);
      if (rowId === 'new') {
        return null;
        //   return 'new';
        // TODO JV: the old one returned 'new', but I don't think that's used anywhere, and null makes more sense?
      }

      return cellObs();
    };
  }
}
