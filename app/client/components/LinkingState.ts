import {DataRowModel} from "app/client/models/DataRowModel";
import DataTableModel from "app/client/models/DataTableModel";
import {DocModel} from 'app/client/models/DocModel';
import {ColumnRec} from "app/client/models/entities/ColumnRec";
import {TableRec} from "app/client/models/entities/TableRec";
import {ViewSectionRec} from "app/client/models/entities/ViewSectionRec";
import {UIRowId} from "app/common/TableData";
import {LinkConfig} from "app/client/ui/selectBy";
import {FilterColValues, QueryOperation} from "app/common/ActiveDocAPI";
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
function isSummaryOf(summary: TableRec, detail: TableRec): boolean {
  const summarySource = summary.summarySourceTable();
  if (summarySource === detail.getRowId()) { return true; }
  const detailSource = detail.summarySourceTable();
  return (Boolean(summarySource) &&
    detailSource === summarySource &&
    summary.getRowId() !== detail.getRowId() &&
    gutil.isSubset(summary.summarySourceColRefs(), detail.summarySourceColRefs()));
}

/**
 * Used to get corresponding columns of tables when one is a summary of the other
 * @param srcGBCol: ColumnRec, must be a groupByColumn
 * @param tgtTable: TableRec to get corresponding column from
 * @returns {ColumnRec} The corresponding column of tgtTable
 */
function summaryGetCorrespondingCol(srcGBCol: ColumnRec, tgtTable: TableRec): ColumnRec{
    if(!isSummaryOf(srcGBCol.table(), tgtTable))
      { throw Error("ERROR in LinkingState summaryGetCorrespondingCol: srcTable must be summary of tgtTable"); }

    if(tgtTable.summarySourceTable() == 0) { //if direct summary
      return srcGBCol.summarySource();
    } else { // else summary->summary, match by colId
      return tgtTable.groupByColumns().filter((tgtCol) => tgtCol.colId() == srcGBCol.colId())[0];
    }
}


//TODO: add a "no link" to this?
type LinkType = "Filter:Summary-Group" |
                "Filter:Col->Col"|
                "Filter:Row->Col"|
                "Summary"|
                "Show-Referenced-Records"|
                "Cursor:Same-Table"|
                "Cursor:Reference"|
                "Error:Invalid";


type FilterState = FilterColValues & {
  filterLabels: {  [colId: string]: string[] };
  colTypes: {[colId: string]: string;}
};

function FilterStateToColValues(fs: FilterState) { return _.pick(fs, ['filters', 'operations']); }
export const EmptyFilterState: FilterState = {filters: {}, filterLabels: {}, operations: {}, colTypes: {}};
export const EmptyFilterColValues: FilterColValues = FilterStateToColValues(EmptyFilterState);

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

  // If linking affects filtering, this is a computed for the current filtering state, including user-facing
  // labels for filter values and types of the filtered columns
  // with a dependency on srcSection.activeRowId()
  // Is null if no filtering
  public readonly filterState?: ko.Computed<FilterState>;

  // filterColValues is a subset of the current filterState needed for filtering (subset of ClientQuery)
  // {[colId]: colValues, [colId]: operations} mapping,
  public readonly filterColValues?: ko.Computed<FilterColValues>;

  // Get default values for a new record so that it continues to satisfy the current linking filters
  public readonly getDefaultColValues: () => any;

  //Which case of linking we've got
  public readonly linkTypeDescription: ko.Computed<LinkType>;

  private _docModel: DocModel;
  private _srcSection: ViewSectionRec;
  private _srcTableModel: DataTableModel;
  private _srcColId: string | undefined;

  constructor(docModel: DocModel, linkConfig: LinkConfig) {
    super();
    const {srcSection, srcCol, srcColId, tgtSection, tgtCol, tgtColId} = linkConfig;
    this._docModel = docModel;
    this._srcSection = srcSection;
    this._srcColId = srcColId;
    this._srcTableModel = docModel.dataTables[srcSection.table().tableId()];
    const srcTableData = this._srcTableModel.tableData;

    this.linkTypeDescription = ko.computed((): LinkType => {
      if (srcSection.table().summarySourceTable() && srcColId == "group") {
        return "Filter:Summary-Group"; //implemented as col->col, but special-cased in select-by
      } else if (srcColId && tgtColId) {
        return "Filter:Col->Col";
      } else if (!srcColId && tgtColId) {
        return "Filter:Row->Col";
      } else if (srcColId && !tgtColId) { // Col->Row, i.e. show a ref
        if (isRefListType(srcCol.type())) // TODO: fix this once ref-links are unified, both could be show-ref-rec
          { return "Show-Referenced-Records"; }
        else
          { return "Cursor:Reference"; }
      } else if (!srcColId && !tgtColId) { //Either same-table cursor link OR summary link
        if (isSummaryOf(srcSection.table(), tgtSection.table()))
          { return "Summary"; }
        else
          { return "Cursor:Same-Table"; }
      } else {
        return "Error:Invalid";
      }
    });

    if (tgtColId) { //normal filter link
      if (srcSection.parentKey() === 'custom') {
        this.filterState = this._srcCustomFilter(tgtCol, isRefListType(tgtCol.type()) ? 'intersects' : 'in');
      } else if (srcColId) { //col->col filter
        this.filterState = this._makeFilterObs(srcCol, tgtCol);
      } else { //row->col filter
        this.filterState = this._makeFilterObs(null, tgtCol);
      }
    //} else if (srcColId) {  // "Lookup link"
    } else if (srcColId && isRefListType(srcCol.type())) {  // "Lookup link"
      this.filterState = this._makeFilterObs(srcCol, null);

    } else if (!srcColId && isSummaryOf(srcSection.table(), tgtSection.table())) {
      // !srcCol && !tgtCol && summary => typical summary filter-linking
      // We do summary filtering if no cols specified and summary section is linked to a more detailed summary
      // (or to the summarySource table)

      // source data table could still be loading (this could happen after changing the group by
      // columns of a linked summary table for instance), hence the below listener.
      const _filterState = ko.observable<FilterState>();
      this.filterState = this.autoDispose(ko.computed(() => _filterState()));
      this.autoDispose(srcTableData.dataLoadedEmitter.addListener(_update));

      const self = this;
      _update();
      function _update() {
        if (srcSection.isDisposed() || srcSection.table().groupByColumns().length == 0) {
          //srcSection disposed can happen transiently while loading? (unsure)
          //groupByColumns == [] can happen if we make a summary tab [group by nothing]. (in which case: don't filter)
          _filterState(EmptyFilterState);
          return;
        }

        //Make one filter for each groupBycolumn of srcSection
        const resultFilters: (ko.Computed<FilterState>|undefined)[] = srcSection.table().groupByColumns().map(srcGCol =>
          self._makeFilterObs(srcGCol, summaryGetCorrespondingCol(srcGCol, tgtSection.table()))
        );

        //If any are null, error out
        if(resultFilters.filter((f) => f == undefined).length > 0) {
          console.warn("LINKINGSTATE: some of filters are null", resultFilters);
          _filterState(EmptyFilterState);
          return;
        }

        //Merge them together in a computed
        const resultComputed = self.autoDispose(ko.computed(() => {
          return _.merge({}, ...resultFilters.map(filtObs => filtObs!())) as FilterState;
        }));
        _filterState(resultComputed());
      } // End of update function

    } else if (srcSection.parentKey() === 'custom') {
      this.filterState = this._srcCustomFilter(null, 'in');

      // ================ CURSOR LINKS: =================
    } else { //!tgtCol && !summary-link && (!lookup-link || !reflist),
      //        either same-table cursor-link or non-reflist cursor link
      const srcValueFunc = this._makeValGetter(this._srcSection.table(), this._srcColId); //colVal, or rowId if undef

      if (srcValueFunc) {
        this.cursorPos = this.autoDispose(ko.computed(() =>
          srcValueFunc(srcSection.activeRowId()) as UIRowId
        ));
      }

      if (!srcColId) { // cursor-link: same-record
        // copy getDefaultColValues from the source if possible
        const getDefaultColValues = srcSection.linkingState()?.getDefaultColValues;
        if (getDefaultColValues) {
          this.getDefaultColValues = getDefaultColValues;
        }
      }
    }

    // Extract just the filtering-relevant parts of filterState
    this.filterColValues = (this.filterState) ?
      ko.computed(() => FilterStateToColValues(this.filterState!()))
      : undefined;

    if (!this.getDefaultColValues) {
      this.getDefaultColValues = () => {
        if (!this.filterState) {
          return {};
        }
        const {filters, operations} = this.filterState.peek();
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
    return Boolean(this.filterState) && this._srcSection.activeRowId() === 'new';
  }


  /**
   * Makes a standard filter link (summary tables and cursor links handled separately)
   * treats (srcCol == undefined) as srcColId == "id", same for tgt
   *
   * if srcColId == "id", uses src activeRowId as the selector value (i.e. a ref to that row)
   * else, gets the current value in selectedRow's SrcCol
   *
   * Returns a FilterColValues with a single filter {[tgtColId|"id":string] : (selectorVals:val[])}
   * note: selectorVals is always a list of values: if reflist the leading "L" is trimmed, if single val then [val]
   *
   * If unable to initialize (sometimes happens when things are loading?), returns undefined
   *
   * NOTE: srcColId and tgtColId MUST NOT both be undefined, that implies either cursor linking or summary linking,
   * which this doesn't handle
   *
   * @param srcCol srcCol for the filter, or undefined/the empty column to mean the entire record
   * @param tgtCol tgtCol for the filter, or undefined/the empty column to mean the entire record
   * @private
   */
  private _makeFilterObs(
      srcCol: ColumnRec|null, tgtCol: ColumnRec|null): ko.Computed<FilterState> | undefined {
    const srcColId = srcCol?.colId();
    const tgtColId = tgtCol?.colId();
    console.log(`in makeFilterObs: srcColId=${srcColId || "id" }, tgtColId=${tgtColId || "id" }`);

    //Assert: if both are null then it's a summary filter or same-table cursor-link, neither of which should go here
    if(srcColId == null && tgtColId == null) {
      throw Error("ERROR in _makeFilterObs: srcCol and tgtCol can't both be null");
    }

    //if (srcCol), selectorVal is the value in activeRowId[srcCol].
    //if (!srcCol), then selectorVal is the entire record, so func just returns the rowId, or null if the rowId is "new"
    const selectorValGetter = this._makeValGetter(this._srcSection.table(), srcColId);

    // Figure out display val to show for the selector (if selector is a Ref)
    // - if srcCol is a ref, we display its displayColModel(), which is what is shown in the cell
    // - However, if srcColId == 'id', there is no srcCol.displayColModel.
    //   We also can't use tgtCol.displayColModel, since we're getting values from the source section.
    //   Therefore: The value we want to display is srcRow[tgtCol.visibleColModel.colId]
    //
    // Note: if we've gotten here, tgtCol is guaranteed to be a ref/reflist if srcColId == undefined
    //       (because we ruled out the undef/undef case above)
    // Note: tgtCol.visibleCol.colId can be undefined, iff visibleCol is rowId. makeValGetter handles that implicitly
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

    if (!selectorValGetter || !displayValGetter) {
      console.error("ERROR in _makeFilterObs: couldn't create valGetters for srcSection");
      return undefined;
    }

    //Now, create the actual observable that updates with activeRowId
    return this.autoDispose(ko.computed(() => {

      //Get selector-rowId
      const srcRowId = this._srcSection.activeRowId();
      if (srcRowId === null) {
        console.warn("_makeFilterObs activeRowId is null");
        return EmptyFilterState;
      }

      //Get values from selector row
      const selectorCellVal = selectorValGetter(srcRowId);
      const displayCellVal  = displayValGetter(srcRowId);

      // Coerce values into lists (FilterColValues wants output as a list, even if only 1 val)
      let filterValues: any[];
      let displayValues: any[];
      if(!isSrcRefList) {
        filterValues = [selectorCellVal];
        displayValues = [displayCellVal];

      } else if(isSrcRefList && isList(selectorCellVal)) { //Reflists are: ["L", ref1, ref2, ...], slice off the L
        filterValues = selectorCellVal.slice(1);

        //selectorValue and displayValue might not match up? Shouldn't happen, but let's yell loudly if it does
        if (isList(displayCellVal) && displayCellVal.length == selectorCellVal.length) {
          displayValues = displayCellVal.slice(1);
        } else {
          console.error("Error in LinkingState: displayVal list doesn't match selectorVal list ");
          displayValues = filterValues; //fallback to unformatted values
        }

      } else { //isRefList && !isList(), probably null. Happens with blank reflists, or if cursor on the 'new' row
        filterValues = [];
        displayValues = [];
        if(selectorCellVal != null) { // should be null, but let's warn if it's not
          console.warn("Error in LinkingState.makeFilterObs(), srcVal is reflist but has non-list non-null value");
        }
      }

      //Need to use 'intersects' for ChoiceLists or RefLists
      let operation = (tgtColId && isListType(tgtCol!.type())) ? 'intersects' : 'in';

      // If selectorVal is a blank-cell value, need to change operation for correct behavior with lists
      // Blank selector shouldn't mean "show no records", it should mean "show records where tgt column is also blank"
      if(srcRowId != 'new') { //(EXCEPTION: the add-row, which is when we ACTUALLY want to show no records)

        // If tgtCol is a list (RefList or Choicelist) and selectorVal is null/blank, operation must be 'empty'
        if (tgtCol?.type() == "ChoiceList" && !isSrcRefList && selectorCellVal == "")    { operation = 'empty'; }
        else if (isTgtRefList              && !isSrcRefList && selectorCellVal == 0)     { operation = 'empty'; }
        else if (isTgtRefList              &&  isSrcRefList && filterValues.length == 0) { operation = 'empty'; }
        // other types can have falsey values when non-blank (e.g. for numbers, 0 is a valid value; blank cell is null)
        // However, we don't need to check for those here, since we only care about lists (Reflist or Choicelist)

        // If tgtCol is a single ref, nullness is represented by [0], not by [], so need to create that null explicitly
        else if (!isTgtRefList && isSrcRefList && filterValues.length == 0) {
          filterValues = [0];
          displayValues = [''];
        }

        // NOTES ON CHOICELISTS: they only show up in a few cases.
        // - ChoiceList can only ever appear in links as the tgtcol
        //   (ChoiceLists can only be linked from summ. tables, and summary flattens lists, so srcCol would be 'Choice')
        // - empty choicelist is [""].
      }

      // Run values through formatters (for dates, numerics, Refs with visCol = rowId)
      const filterLabelVals: string[] = displayValues.map(v => displayValFormatter.formatAny(v));

      return {
        filters:      {[tgtColId || "id"]: filterValues},
        filterLabels: {[tgtColId || "id"]: filterLabelVals},
        operations:   {[tgtColId || "id"]: operation},
        colTypes:     {[tgtColId || "id"]: (tgtCol || srcCol)!.type()}
        //at least one of tgt/srcCol is guaranteed to be non-null, and they will have the same type
      } as FilterState;
    }));
  }

  // Value for this.filterColValues based on the values in srcSection.selectedRows
  //"null" for column implies id column
  private _srcCustomFilter(
      column: ColumnRec|null, operation: QueryOperation): ko.Computed<FilterState> | undefined {
    const colId = (column == null || column.colId() == undefined) ? "id" : column.colId();
    return this.autoDispose(ko.computed(() => {
      const values = toKo(ko, this._srcSection.selectedRows)();
      return {
        filters: {[colId]: values},
        filterLabels: {[colId]: values.map(v => v+"")},
        operations: {[colId]: operation},
        colTypes: {[colId]: column?.type() || `Ref:${column?.table().tableId}`}
      } as FilterState; //TODO: fix this once we have cases of customwidget linking to test with
    }));
  }

  // Returns a function (rowId) => cellValue, for the specified table and colId
  // Uses a row model to create a dependency on the cell's value,
  // so changes to the cell value will notify observers
  // An undefined colId means to use the 'id' column, i.e. (rowId)=>rowId
  // returns 'valGetter | null', null meaning an error
  //    valGetter is ( (UIRowID | null) => cellValue | null ), null meaning the "new" row
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

    return (rowId: UIRowId | null) => { // returns cellValue | null
      rowModel.assign(rowId);
      if (rowId === 'new') { return null; } // used to return "new", hopefully the change doesn't come back to haunt us
      return cellObs();
    };
  }
}
