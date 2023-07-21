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


  /*

  // Value for this.filterColValues filtering based on a single column
  private _simpleFilter(
    colId: string, operation: QueryOperation, valuesFunc: (rowId: UIRowId|null) => any[]
  ): ko.Computed<FilterColValues> {
    return this.autoDispose(ko.computed(() => {
      const srcRowId = this._srcSection.activeRowId();
      if (srcRowId === null) {
        console.warn("_simpleFilter activeRowId is null");
        return EmptyFilterColValues;
      }
      const values = valuesFunc(srcRowId);
      return {
        filters: {[colId]: values},
        filterLabels: {[colId]: values},
        operations: {[colId]: operation}} as FilterColValues;
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
   */

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
      srcCol: ColumnRec|null, tgtCol: ColumnRec|null, operation: QueryOperation
  ): ko.Computed<FilterColValues> | undefined {
    const srcColId = srcCol == null || srcCol.colId() == undefined ? "id" : srcCol.colId();
    const tgtColId = tgtCol == null || tgtCol.colId() == undefined ? "id" : tgtCol.colId();
    console.log(`in makeFilterObs: srcColId=${srcColId}, tgtColId=${tgtColId}`);


    // Note: Terminology is "filter LHS (tgtcol) to match RHS (srccol / selectorval)"
    //if tgtCol (LHS of filter, "filter: [tgtCol || id]  (=/in/intersects) [selectorVal]")
    //implementation-wise, selectorVal is always a list
    //if LHS (tgtCol) is a single value (id or a non-reflist), then operation "in" works fine for the "=" case, or when selector is empty
    //if LHS (tgtCol) is a reflist

    // Currently: if RHS is a reflist, we just use "intersects"
    // - col <- col (LHS ref, RHS reflist), empty RHS means select nothing (TODO VERIFY)
    // - id <- col (LHS ref (lookup), RHS reflist), empty RHS means select nothing (CORRECT) (TODO VERIFY)
    // - col <- col (reflist reflist), empty RHS means select nothing (incorrect?) (TODO VERIFY)
    // - special case: RHS reflist or choicelist && RHS from summary table && RHS in groupby:
    //      - summary table by a reflist/choicelist splits out each ref/choice into its own row,
    //        effectively turning it into a (LHS reflist, RHS ref) situation
    //        currently handled with explicit check in summary table portion


    // Other cases: RHS ref, LHS reflist
    // - reflist <- ref

    // Solution:
    //  - if selector=[0] && tgtCol is RefList, we change operation to "empty" (note: can't be choicelist, since choicelist would have [""])
    //  - if selector=[""] && tgtCol is ChoiceList, we change operation to "empty" ???
    //  - if selector=[] && tgtCol is Reflist, we change operation to "empty" (WORKS)
    // - if selector=[] && tgtCol is Ref, empty WONT WORK! (since null ref is [0], doesn't intersect []). Need to explicitly and forcibly change [] to [0]

    //CHOICELIST NOTES:
    // - choicelist can only ever be tgtcol (non-ref cols can only be linked if summarizing, and src can only be summary)
    // - empty choice is [""]
    // - single choice (e.g. in summary by choicelist) can be ["0"], but not [0]
    // Note: other datatypes might have falsey values (e.g. for numbers, 0 is a valid value, but blank cell is null)
    // However, we should only check for falsey values when tgtCol is Reflist or Choicelist

    // Weird cases: choicelists?
    //OH NO Turns out attachments are also a list type and you can filter by attachments

    //for empty: if RHS (srcCol) is an empty list (not a null!), we have a few cases:
    //    -if LHS is id, then it's a reflist lookup, we just want "interesects" or "in"
    //    -if LHS is a ref






    //RULE:
    // default: operation = in
    //    if tgtCol && isListType(tgtCol): intersect
    //
    //    if isRefList (tgtCol) && srcValue == [0], operation = empty
    //    if isRefList (tgtCol) && srcValue == [], operation = empty
    //    if isChoiceList (tgtCol) && srcValue == [""]. operation = empty ;    SPECIAL CASE: ONLY WHEN Summary from choicelist: results in  choice -> choicelist
    //    (Attachments? they fall under isReflistType, and act like a reflist to _grist_Attachments)

    //const operation = isRefListType(tgtCol.type()) ? 'intersects' : 'in';

    /*if (isDirectSummary && isListType(c.summarySource().type())) {
            // If the source groupby column is a ChoiceList or RefList, then null or '' in the summary table
            // should match against an empty list in the source table.
            result.operations[colId] = srcValue ? 'intersects' : 'empty';

    }

    */


    //Assert: if both are null then it's a summary filter or same-table cursor-link, neither of which should go here
    if(srcCol == null && tgtCol == null) {
      throw Error("ERROR in _makeFilterObs: srcCol and tgtCol can't both be null");
    }

    //srcCellGetter is rowId => selectorVal
    //if (srcCol), it's the value in that cell.
    //if (!srcCol), it just returns the rowId, or null if the rowId is "new"
    const selectorValGetter = this._makeValGetter(this._srcSection.table(), srcColId);

    // Normally, if srcCol is a ref, we can just take the value from its display column and that will work correctly
    // However, is srcColId == 'id', the value is the whole row. To figure out which field is the label,
    //    we need to use visibleCol field from tgtCol
    // Note: if srcColId == 'id', tgtCol is guaranteed be a ref or reflist column
    // Note: if using visibleCol from tgtCol, visibleCol ColId might be undefined (if visible col is rowId)
    const displayColId = srcColId == "id" ?
        tgtCol!.visibleColModel().colId() || "id"
      : srcCol!.displayColModel().colId();
    const displayValGetter = this._makeValGetter(this._srcSection.table(), displayColId);
    //Note: if src is a reflist, its displayVal will be list of the visibleCol vals,
    // i.e ["L", visVal1, visVal2], but not formatted


    const displayValFormatter = srcColId == "id" ? tgtCol!.visibleColFormatter() : srcCol!.visibleColFormatter();



    const isSrcRefList = srcColId != "id" && isRefListType(srcCol!.type());
    const isTgtRefList = tgtColId != "id" && isRefListType(tgtCol!.type());
    console.log(`makeFilterObs: srcRefList: ${isSrcRefList}; tgtRefList: ${isTgtRefList}`)
    const JV = (window as any).JV;
    JV && console.log(`makeFilterObs: srcCol: ${JV.pCol(srcCol)}; tgtCol: ${JV.pCol(tgtCol)}`)


    if (!selectorValGetter || !displayValGetter) {
      throw Error("ERROR in _makeFilterObs: couldn't create valGetters for srcSection");
      //TODO JV: Error? Shouldn't happen?
      //Originally this case returned undefined, not sure what the error logic was/should be
      //return undefined;
    }

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

      //TODO JV TEMP: I'm rewriting/refactoring the 'operation' logic, let's keep both for now for ease of swapping
      //Need to use interesects for both ChoiceLists, as well as RefLists(which include attachments)
      let newOperation = (tgtCol && isListType(tgtCol.type())) ? 'intersects' : 'in';


      // FilterColValues wants output as a list of 1 or more values to filter by.
      let filterValues: any[];
      let displayValues: any[];
      if(!isSrcRefList) {
        filterValues = [selectorCellVal];
        displayValues = [displayCellVal];

        // If selectorval is null reference and tgt is reflist, we want to match reflists like []
        // Similar behavior happens with a special case of choiceLists:
        //    (NOTE: a "ChoiceList" tgtcol can only happen in  "Summary [by choicelistCol]",
        //     in which case srcCol will be "Choice" type, and its blank val is "")
        if(isTgtRefList && selectorCellVal == 0) {
          newOperation = 'empty';


        } else if (tgtCol && tgtCol.type() == "ChoiceList" && selectorCellVal == "") {
          newOperation = 'empty';
        }
      } else if(isSrcRefList && isList(selectorCellVal)) { //Reflists are: ["L", ref1, ref2, ...], ,must slice off the L
        filterValues = selectorCellVal.slice(1);
        displayValues = isList(displayCellVal) ? displayCellVal.slice(1) : ["ERROR"];
        //TODO JV: when can this error even happen? i.e. it's a reflist but displayval isnt? only if bug?

        if(filterValues.length == 0 && isTgtRefList) { //If selectorVal is blank, and tgtCol is RefList, we need to use empty
          newOperation = 'empty';
        } else if (filterValues.length == 0) { //else, tgtCol is Ref, empty won't work, we need to change selectorVal to [0]
          filterValues = [0];
          displayValues = [''];
        }

      } else { //isRefList && !isList(), invalid cell value/error case, filter should be empty
        console.error("Errorin in LinkingState: makeFilterObs(), srcVal is reflist but has non-list value");
        console.error(selectorCellVal);
        filterValues = [];
        displayValues = [];
      }


      const filterLabelVals: string[] = displayValues.map(v => displayValFormatter.formatAny(v));

      //const values = valuesFunc(srcRowId);
      return {
        filters: {[tgtColId]: filterValues},
        filterLabels: {[tgtColId]: filterLabelVals},
        //operations: {[tgtColId]: operation},
        operations: {[tgtColId]: newOperation}, //TODO JV TEMP
        colTypes: {[tgtColId]: (tgtCol || srcCol)!.type()} //they must have same type, && at least one must be not-null
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
        colTypes: {[colId]: column?.type() || ""} //TODO JV NO REALLY FIX THIS
      } as FilterColValues; //TODO JV: actually fix filterLabels and coltype
    }));
  }

  /*

  // Returns a function which returns the value of the cell
  // in srcCol in the selected record of srcSection.
  // Uses a row model to create a dependency on the cell's value,
  // so changes to the cell value will notify observers
  // if no srcCol, uses 'id' as the srcCol
  private _makeSrcCellGetter() {
    if(this._srcColId == undefined) {
      return (rowId:UIRowId|null) => rowId == "new" ? null : rowId;
    } else {
      return this._makeValGetter(this._srcSection.table(), this._srcColId || 'id')
    }
  }

  */

  /* Like srcCellGetter but more general
     e.g.:
     //row->col, reference in tgtCol, lookup values from table

  */
  //If colId == "id", will return the id unchanged
  private _makeValGetter(table: TableRec, colId: string) {
    if(colId == "id") { //passthrough for id cols
      return (rowId: UIRowId | null) => { return rowId === 'new' ? null : rowId; };
    }

    const tableModel = this._docModel.dataTables[table.tableId()];
    tableModel.tableData.getRowPropFunc(colId);
    const rowModel = this.autoDispose(tableModel.createFloatingRowModel()) as DataRowModel;
    const cellObs = rowModel.cells[colId];
    // If no cellObs, can't make a val getter. This shouldn't happen, but may happen
    // transiently while the separate linking-related observables get updated.
    if (!cellObs) {
      //TODO JV: temporary?
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
