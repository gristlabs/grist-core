/**
 * DocModel describes the observable models for all document data, including the built-in tables
 * (aka metatables), which are used in the Grist application itself (e.g. to render views).
 *
 * Since all data is structured as tables, we have several levels of models:
 * (1) DocModel maintains all tables
 * (2) MetaTableModel maintains data for a built-in table.
 * (3) DataTableModel maintains data for a user-defined table.
 * (4) RowModels (defined in {Data,Meta}TableModel.js) maintains data for one record in a table.
 *     For built-in tables, the records are defined in this module, below.
 */
import {KoArray} from 'app/client/lib/koArray';
import {KoSaveableObservable} from 'app/client/models/modelUtil';

import * as ko from 'knockout';
import memoize from 'lodash/memoize';

import * as koArray from 'app/client/lib/koArray';
import * as koUtil from 'app/client/lib/koUtil';
import DataTableModel from 'app/client/models/DataTableModel';
import {DocData} from 'app/client/models/DocData';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import MetaRowModel from 'app/client/models/MetaRowModel';
import MetaTableModel from 'app/client/models/MetaTableModel';
import * as rowset from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';
import {isHiddenTable, isSummaryTable} from 'app/common/isHiddenTable';
import {canEdit} from 'app/common/roles';
import {RowFilterFunc} from 'app/common/RowFilterFunc';
import {schema, SchemaTypes} from 'app/common/schema';
import {ACLRuleRec, createACLRuleRec} from 'app/client/models/entities/ACLRuleRec';
import {ColumnRec, createColumnRec} from 'app/client/models/entities/ColumnRec';
import {createDocInfoRec, DocInfoRec} from 'app/client/models/entities/DocInfoRec';
import {createFilterRec, FilterRec} from 'app/client/models/entities/FilterRec';
import {createPageRec, PageRec} from 'app/client/models/entities/PageRec';
import {createShareRec, ShareRec} from 'app/client/models/entities/ShareRec';
import {createTabBarRec, TabBarRec} from 'app/client/models/entities/TabBarRec';
import {createTableRec, TableRec} from 'app/client/models/entities/TableRec';
import {createValidationRec, ValidationRec} from 'app/client/models/entities/ValidationRec';
import {createViewFieldRec, ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {createViewRec, ViewRec} from 'app/client/models/entities/ViewRec';
import {createViewSectionRec, ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {CellRec, createCellRec} from 'app/client/models/entities/CellRec';
import {RefListValue} from 'app/common/gristTypes';
import {decodeObject} from 'app/plugin/objtypes';
import {toKo} from 'grainjs';
import {UIRowId} from 'app/plugin/GristAPI';

// Re-export all the entity types available. The recommended usage is like this:
//    import {ColumnRec, ViewFieldRec} from 'app/client/models/DocModel';
export type {ColumnRec, DocInfoRec, FilterRec, PageRec, TabBarRec, TableRec, ValidationRec,
  ViewFieldRec, ViewRec, ViewSectionRec, CellRec};

/**
 * Creates the type for a MetaRowModel containing a KoSaveableObservable for each field listed in
 * the auto-generated app/common/schema.ts. It represents the metadata record in the database.
 * Particular DocModel entities derive from this, and add other helpful computed values.
 */
export type IRowModel<TName extends keyof SchemaTypes> = MetaRowModel<TName> & {
  [ColId in keyof SchemaTypes[TName]]: KoSaveableObservable<SchemaTypes[TName][ColId]>;
};


/**
 * Returns an observable for an observable array of records from the given table.
 *
 * @param {RowModel} rowModel: RowModel that owns this recordSet.
 * @param {TableModel} tableModel: The model for the table to return records from.
 * @param {String} groupByField: The name of the field in the other table by which to group. The
 *    returned observable arrays will be for the group matching the value of rowModel.id().
 * @param {String} [options.sortBy]: Keep the returned array sorted by this key. If omitted, the
 *    returned array will be sorted by rowId.
 */
export function recordSet<TRow extends MetaRowModel>(
  rowModel: MetaRowModel, tableModel: MetaTableModel<TRow>, groupByField: string, options?: {sortBy: string}
): ko.Computed<KoArray<TRow>> {

  const opts = {groupBy: groupByField, sortBy: 'id', ...options};
  return koUtil.computedAutoDispose(
    () => tableModel.createRowGroupModel(rowModel.id() || 0, opts),
    null, { pure: true });
}


/**
 * Returns an observable for a record from another table, selected using the passed-in observable
 * for a rowId. If rowId is invalid, returns the row model for the fake empty record.
 * @param {TableModel} tableModel: The model for the table to return a record from.
 * @param {ko.observable} rowIdObs: An observable for the row id to look up.
 */
export function refRecord<TRow extends MetaRowModel>(
  tableModel: MetaTableModel<TRow>, rowIdObs: ko.Observable<number>|ko.Computed<number>
): ko.Computed<TRow> {
  // Pass 'true' to getRowModel() to depend on the row version.
  return ko.pureComputed(() => tableModel.getRowModel(rowIdObs() || 0, true));
}


/**
 * Returns an observable with a list of records from another table, selected using RefList column.
 * @param {TableModel} tableModel: The model for the table to return a record from.
 * @param {ko.observable} rowsIdObs: An observable with a RefList value.
 */
export function refListRecords<TRow extends MetaRowModel>(
  tableModel: MetaTableModel<TRow>, rowsIdObs: ko.Observable<RefListValue>|ko.Computed<RefListValue>
) {
  return ko.pureComputed(() => {
    const ids = decodeObject(rowsIdObs()) as number[]|null;
    if (!Array.isArray(ids)) {
      return [];
    }
    return ids.map(id => tableModel.getRowModel(id, true));
  });
}

// Use an alias for brevity.
type MTM<RowModel extends MetaRowModel> = MetaTableModel<RowModel>;

export class DocModel {
  // MTM is a shorthand for MetaTableModel below, to keep each item to one line.
  public docInfo: MTM<DocInfoRec> = this._metaTableModel("_grist_DocInfo", createDocInfoRec);
  public tables: MTM<TableRec> = this._metaTableModel("_grist_Tables", createTableRec);
  public columns: MTM<ColumnRec> = this._metaTableModel("_grist_Tables_column", createColumnRec);
  public views: MTM<ViewRec> = this._metaTableModel("_grist_Views", createViewRec);
  public viewSections: MTM<ViewSectionRec> = this._metaTableModel("_grist_Views_section", createViewSectionRec);
  public viewFields: MTM<ViewFieldRec> = this._metaTableModel("_grist_Views_section_field", createViewFieldRec);
  public tabBar: MTM<TabBarRec> = this._metaTableModel("_grist_TabBar", createTabBarRec);
  public validations: MTM<ValidationRec> = this._metaTableModel("_grist_Validations", createValidationRec);
  public pages: MTM<PageRec> = this._metaTableModel("_grist_Pages", createPageRec);
  public shares: MTM<ShareRec> = this._metaTableModel("_grist_Shares", createShareRec);
  public rules: MTM<ACLRuleRec> = this._metaTableModel("_grist_ACLRules", createACLRuleRec);
  public filters: MTM<FilterRec> = this._metaTableModel("_grist_Filters", createFilterRec);
  public cells: MTM<CellRec> = this._metaTableModel("_grist_Cells", createCellRec);

  public docInfoRow: DocInfoRec;

  public allTables: KoArray<TableRec>;
  public visibleTables: KoArray<TableRec>;
  public rawDataTables: KoArray<TableRec>;
  public rawSummaryTables: KoArray<TableRec>;

  public allTableIds: KoArray<string>;
  public visibleTableIds: KoArray<string>;

  // A mapping from tableId to DataTableModel for user-defined tables.
  public dataTables: {[tableId: string]: DataTableModel} = {};

  // Another map, this one mapping tableRef (rowId) to DataTableModel.
  public dataTablesByRef = new Map<number, DataTableModel>();

  public allTabs: KoArray<TabBarRec> = this.tabBar.createAllRowsModel('tabPos');

  public allPages: ko.Computed<PageRec[]>;
  /** Pages that are shown in the menu. These can include censored pages if they have children. */
  public menuPages: ko.Computed<PageRec[]>;
  // Excludes pages hidden by ACL rules or other reasons (e.g. doc-tour)
  public visibleDocPages: ko.Computed<PageRec[]>;

  // Flag for tracking whether document is in formula-editing mode
  public editingFormula: ko.Observable<boolean> = ko.observable(false);

  // If the doc has a docTour. Used also to enable the UI button to restart the tour.
  public readonly hasDocTour: ko.Computed<boolean>;

  public readonly isTutorial: ko.Computed<boolean>;

  // TODO This is a temporary solution until we expose creation of doc-tours to users. This flag
  // is initialized once on page load. If set, then the tour page (if any) will be visible.
  public showDocTourTable: boolean = (urlState().state.get().docPage === 'GristDocTour');

  // Whether the GristDocTutorial table should be shown. Initialized once on page load.
  public showDocTutorialTable: boolean =
    // We skip subscribing to the observables below since they normally shouldn't change during
    // this object's lifetime. If that changes, this should be made into a computed observable.
    !this._docPageModel.isTutorialFork.get() ||
    canEdit(this._docPageModel.currentDoc.get()?.trunkAccess ?? null);

  // List of all the metadata tables.
  private _metaTables: Array<MetaTableModel<any>>;

  constructor(public readonly docData: DocData, private readonly _docPageModel: DocPageModel) {
    // For all the metadata tables, load their data (and create the RowModels).
    for (const model of this._metaTables) {
      model.loadData();
    }

    this.docInfoRow = this.docInfo.getRowModel(1);

    // An observable array of all tables, sorted by tableId, with no exclusions.
    this.allTables = this._createAllTablesArray();

    // An observable array of user-visible tables, sorted by tableId, excluding summary tables.
    // This is a publicly exposed member.
    this.visibleTables = this._createVisibleTablesArray();

    // Observable arrays of raw data and summary tables, sorted by tableId.
    this.rawDataTables = this._createRawDataTablesArray();
    this.rawSummaryTables = this._createRawSummaryTablesArray();

    // An observable array of all tableIds. A shortcut mapped from allTables.
    const allTableIds = ko.computed(() => this.allTables.all().map(t => t.tableId()));
    this.allTableIds = koArray.syncedKoArray(allTableIds);

    // An observable array of user-visible tableIds. A shortcut mapped from visibleTables.
    const visibleTableIds = ko.computed(() => this.visibleTables.all().map(t => t.tableId()));
    this.visibleTableIds = koArray.syncedKoArray(visibleTableIds);

    // Create an observable array of RowModels for all the data tables. We'll trigger
    // onAddTable/onRemoveTable in response to this array's splice events below.
    const allTableMetaRows = this.tables.createAllRowsModel('id');

    // For a new table, we get AddTable action followed by metadata actions to add a table record
    // (which triggers this subscribeForEach) and to add all the column records. So we have to keep
    // in mind that metadata for columns isn't available yet.
    allTableMetaRows.subscribeForEach({
      add: r => this._onAddTable(r),
      remove: r => this._onRemoveTable(r),
    });

    // Get a list of only the visible pages.
    const allPages = this.pages.createAllRowsModel('pagePos');
    this.allPages = ko.computed(() => allPages.all());
    this.menuPages = ko.computed(() => {
      const pagesToShow = this.allPages().filter(p => !p.isSpecial()).sort((a, b) => a.pagePos() - b.pagePos());
      // Helper to find all children of a page.
      const children = memoize((page: PageRec) => {
        const following = pagesToShow.slice(pagesToShow.indexOf(page) + 1);
        const firstOutside = following.findIndex(p => p.indentation() <= page.indentation());
        return firstOutside >= 0 ? following.slice(0, firstOutside) : following;
      });
      // Helper to test if the page is hidden and all its children are hidden.
      // In that case, we won't show it at all.
      const hide = memoize((page: PageRec): boolean => page.isCensored() && children(page).every(p => hide(p)));
      return pagesToShow.filter(p => !hide(p));
    });
    this.visibleDocPages = ko.computed(() => this.allPages().filter(p => !p.isHidden()));

    this.hasDocTour = ko.computed(() => this.visibleTableIds.all().includes('GristDocTour'));

    this.isTutorial = ko.computed(() =>
      toKo(ko, this._docPageModel.isTutorialFork)()
      && this.allTableIds.all().includes('GristDocTutorial'));
  }

  public getTableModel(tableId: string) {
    return this.dataTables[tableId];
  }

  private _metaTableModel<TName extends keyof SchemaTypes, TRow extends IRowModel<TName>>(
    tableId: TName,
    rowConstructor: (this: TRow, docModel: DocModel) => void,
  ): MetaTableModel<TRow> {
    const fields = Object.keys(schema[tableId]);
    const model = new MetaTableModel<TRow>(this, this.docData.getTable(tableId)!, fields, rowConstructor);
    // To keep _metaTables private member listed after public ones, initialize it on first use.
    if (!this._metaTables) { this._metaTables = []; }
    this._metaTables.push(model);
    return model;
  }

  private _onAddTable(tableMetaRow: TableRec) {
    let tid = tableMetaRow.tableId();
    const dtm = new DataTableModel(this, this.docData.getTable(tid)!, tableMetaRow);
    this.dataTables[tid] = dtm;
    this.dataTablesByRef.set(tableMetaRow.getRowId(), dtm);

    // Subscribe to tableMetaRow.tableId() to handle table renames.
    tableMetaRow.tableId.subscribe(newTableId => {
      this.dataTables[newTableId] = this.dataTables[tid];
      delete this.dataTables[tid];
      tid = newTableId;
    });
  }

  private _onRemoveTable(tableMetaRow: TableRec) {
    const tid = tableMetaRow.tableId();
    this.dataTables[tid].dispose();
    delete this.dataTables[tid];
    this.dataTablesByRef.delete(tableMetaRow.getRowId());
  }

  /**
   * Returns an observable array of all tables, sorted by tableId.
   */
  private _createAllTablesArray(): KoArray<TableRec> {
    return createTablesArray(this.tables);
  }

  /**
   * Returns an observable array of user tables, sorted by tableId, and excluding hidden/summary
   * tables.
   */
  private _createVisibleTablesArray(): KoArray<TableRec> {
    return createTablesArray(this.tables, r =>
      !isHiddenTable(this.tables.tableData, r) &&
      !isVirtualTable(this.tables.tableData, r) &&
      (!isTutorialTable(this.tables.tableData, r) || this.showDocTutorialTable)
    );
  }

  /**
   * Returns an observable array of raw data tables, sorted by tableId, and excluding summary
   * tables.
   */
  private _createRawDataTablesArray(): KoArray<TableRec> {
    return createTablesArray(this.tables, r =>
      !isSummaryTable(this.tables.tableData, r) &&
      (!isTutorialTable(this.tables.tableData, r) || this.showDocTutorialTable)
    );
  }

  /**
   * Returns an observable array of raw summary tables, sorted by tableId.
   */
  private _createRawSummaryTablesArray(): KoArray<TableRec> {
    return createTablesArray(this.tables, r => isSummaryTable(this.tables.tableData, r));
  }
}

/**
 * Creates an observable array of tables, sorted by tableId.
 *
 * An optional `filterFunc` may be specified to filter tables.
 */
function createTablesArray(
  tablesModel: MetaTableModel<TableRec>,
  filterFunc: RowFilterFunc<UIRowId> = (_row) => true
) {
  const rowSource = new rowset.FilteredRowSource(filterFunc);
  rowSource.subscribeTo(tablesModel);
  // Create an observable RowModel array based on this rowSource, sorted by tableId.
  return tablesModel._createRowSetModel(rowSource, 'tableId');
}

/**
 * Return whether a table (identified by the rowId of its metadata record) is
 * the special GristDocTutorial table.
 */
function isTutorialTable(tablesData: TableData, tableRef: UIRowId): boolean {
  return tablesData.getValue(tableRef, 'tableId') === 'GristDocTutorial';
}

/**
 * Check whether a table is virtual - currently that is done
 * by having a string rowId rather than the expected integer.
 */
function isVirtualTable(tablesData: TableData, tableRef: UIRowId): boolean {
  return typeof(tableRef) === 'string';
}
