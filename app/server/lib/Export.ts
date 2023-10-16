import {FilterColValues} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {buildColFilter} from 'app/common/ColumnFilterFunc';
import {TableDataAction, TableDataActionSet} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {DocumentSettings} from 'app/common/DocumentSettings';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {nativeCompare} from 'app/common/gutil';
import {isTableCensored} from 'app/common/isHiddenTable';
import {buildRowFilter, getLinkingFilterFunc} from 'app/common/RowFilterFunc';
import {schema, SchemaTypes} from 'app/common/schema';
import {SortFunc} from 'app/common/SortFunc';
import {Sort} from 'app/common/SortSpec';
import {MetaRowRecord, MetaTableData} from 'app/common/TableData';
import {BaseFormatter, createFullFormatterFromDocData} from 'app/common/ValueFormatter';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {docSessionFromRequest} from 'app/server/lib/DocSession';
import {optIntegerParam, optJsonParam, optStringParam, stringParam} from 'app/server/lib/requestUtils';
import {ServerColumnGetters} from 'app/server/lib/ServerColumnGetters';
import * as express from 'express';
import * as _ from 'underscore';

// Helper type for Cell Accessor
type Access = (row: number) => any;

// Interface to document data used from an exporter worker thread (workerExporter.ts). Note that
// parameters and returned values are plain data that can be passed over a MessagePort.
export interface ActiveDocSource {
  getDocName(): Promise<string>;
  fetchMetaTables(): Promise<TableDataActionSet>;
  fetchTable(tableId: string): Promise<TableDataAction>;
}

// Implementation of ActiveDocSource using an ActiveDoc directly.
export class ActiveDocSourceDirect implements ActiveDocSource {
  private _req: RequestWithLogin;

  constructor(private _activeDoc: ActiveDoc, req: express.Request) {
    this._req = req as RequestWithLogin;
  }

  public async getDocName() { return this._activeDoc.docName; }
  public fetchMetaTables() { return this._activeDoc.fetchMetaTables(docSessionFromRequest(this._req)); }
  public async fetchTable(tableId: string) {
    const {tableData} = await this._activeDoc.fetchTable(docSessionFromRequest(this._req), tableId, true);
    return tableData;
  }
}

// Helper interface with information about the column
export interface ExportColumn {
  id: number;
  colId: string;
  label: string;
  type: string;
  formatter: BaseFormatter;
  parentPos: number;
  description: string;
}

/**
 * Bare data that is exported - used to convert to various formats.
 */
export interface ExportData {
  /**
   * Table name or table id.
   */
  tableName: string;
  /**
   * Document name.
   */
  docName: string;
  /**
   * Row ids (filtered and sorted).
   */
  rowIds: number[];
  /**
   * Accessor for value in a column.
   */
  access: Access[];
  /**
   * Columns information (primary used for formatting).
   */
  columns: ExportColumn[];
  /**
   * Document settings
   */
  docSettings: DocumentSettings;
}

export type ExportHeader = 'colId' | 'label';

/**
 * Export parameters that identifies a section, filters, sort order.
 */
export interface ExportParameters {
  tableId: string;          // Value of '' is an instruction to export all tables.
  viewSectionId?: number;
  sortOrder?: number[];
  filters?: Filter[];
  linkingFilter?: FilterColValues;
  header?: ExportHeader;
}

/**
 * Options parameters for CSV and XLSX export functions.
 */
export interface DownloadOptions extends ExportParameters {
  filename: string;
}

/**
 * Gets export parameters from a request.
 */
export function parseExportParameters(req: express.Request): ExportParameters {
  const tableId = stringParam(req.query.tableId, 'tableId');
  const viewSectionId = optIntegerParam(req.query.viewSection, 'viewSection');
  const sortOrder = optJsonParam(req.query.activeSortSpec, []) as number[];
  const filters: Filter[] = optJsonParam(req.query.filters, []);
  const linkingFilter: FilterColValues = optJsonParam(req.query.linkingFilter, null);
  const header = optStringParam(req.query.header, 'header', {allowed: ['label', 'colId']}) as ExportHeader | undefined;

  return {
    tableId,
    viewSectionId,
    sortOrder,
    filters,
    linkingFilter,
    header,
  };
}

// Helper for getting filtered metadata tables.
async function getMetaTables(activeDocSource: ActiveDocSource): Promise<TableDataActionSet> {
  return safe(await activeDocSource.fetchMetaTables(), "No metadata available in active document");
}

// Makes assertion that value does exist or throws an error
function safe<T>(value: T, msg: string) {
  if (!value) { throw new ApiError(msg, 404); }
  return value as NonNullable<T>;
}

// Helper for getting table from filtered metadata.
function safeTable<TableId extends keyof SchemaTypes>(metaTables: TableDataActionSet, tableId: TableId) {
  const table = safe(metaTables[tableId], `No table '${tableId}' in document`);
  const colTypes = safe(schema[tableId], `No table '${tableId}' in document schema`);
  return new MetaTableData<TableId>(tableId, table, colTypes);
}

// Helper for getting record safely: it throws if the record is missing.
function safeRecord<TableId extends keyof SchemaTypes>(table: MetaTableData<TableId>, id: number) {
  return safe(table.getRecord(id), `No record ${id} in table ${table.tableId}`);
}

// Check that tableRef points to an uncensored table, or throw otherwise.
function checkTableAccess(tables: MetaTableData<"_grist_Tables">, tableRef: number): void {
  if (isTableCensored(tables, tableRef)) {
    throw new ApiError(`Cannot find or access table`, 404);
  }
}

/**
 * Builds export for all raw tables that are in doc.
 */
export async function doExportDoc(
  activeDocSource: ActiveDocSource,
  handleTable: (data: ExportData) => Promise<void>,
): Promise<void> {
  const metaTables = await getMetaTables(activeDocSource);
  const tables = safeTable(metaTables, '_grist_Tables');
  // select raw tables
  const tableRefs = tables.filterRowIds({ summarySourceTable: 0 });
  for (const tableRef of tableRefs) {
    if (!isTableCensored(tables, tableRef)) {    // Omit censored tables
      const data = await doExportTable(activeDocSource, {metaTables, tableRef});
      await handleTable(data);
    }
  }
}

/**
 * Builds export data for section that can be used to produce files in various formats (csv, xlsx).
 */
export async function exportTable(
  activeDoc: ActiveDoc,
  tableRef: number,
  req: express.Request,
  {metaTables}: {metaTables?: TableDataActionSet} = {},
): Promise<ExportData> {
  return doExportTable(new ActiveDocSourceDirect(activeDoc, req), {metaTables, tableRef});
}

export async function doExportTable(
  activeDocSource: ActiveDocSource,
  options: {metaTables?: TableDataActionSet, tableRef?: number, tableId?: string},
) {
  const metaTables = options.metaTables || await getMetaTables(activeDocSource);
  const docData = new DocData((tableId) => { throw new Error("Unexpected DocData fetch"); }, metaTables);
  const tables = safeTable(metaTables, '_grist_Tables');
  const metaColumns = safeTable(metaTables, '_grist_Tables_column');

  let tableRef: number;
  if (options.tableRef) {
    tableRef = options.tableRef;
  } else {
    if (!options.tableId) { throw new Error('doExportTable: tableRef or tableId must be given'); }
    tableRef = tables.findRow('tableId', options.tableId);
    if (tableRef === 0) {
      throw new ApiError(`Table ${options.tableId} not found.`, 404);
    }
  }

  checkTableAccess(tables, tableRef);
  const table = safeRecord(tables, tableRef);

  // Select only columns that belong to this table.
  const tableColumns = metaColumns.filterRecords({parentId: tableRef})
    // sort by parentPos and id, which should be the same order as in raw data
    .sort((c1, c2) => nativeCompare(c1.parentPos, c2.parentPos) || nativeCompare(c1.id, c2.id));

  // Produce a column description matching what user will see / expect to export
  const columns: ExportColumn[] = tableColumns
  .filter(tc => !gristTypes.isHiddenCol(tc.colId))    // Exclude helpers
  .map<ExportColumn>(tc => {
    // for reference columns, return display column, and copy settings from visible column
    const displayCol = metaColumns.getRecord(tc.displayCol) || tc;
    return {
      id: displayCol.id,
      colId: displayCol.colId,
      label: tc.label,
      type: tc.type,
      formatter: createFullFormatterFromDocData(docData, tc.id),
      parentPos: tc.parentPos,
      description: tc.description,
    };
  });

  // fetch actual data
  const tableData = await activeDocSource.fetchTable(table.tableId);
  const rowIds = tableData[2];
  const dataByColId = tableData[3];
  // sort rows
  const getters = new ServerColumnGetters(rowIds, dataByColId, columns);
  // create cell accessors
  const access = columns.map(col => getters.getColGetter(col.id)!);

  let tableName = table.tableId;
  // since tables ids are not very friendly, borrow name from a primary view
  if (table.primaryViewId) {
    const viewId = table.primaryViewId;
    const views = safeTable(metaTables, '_grist_Views');
    const view = safeRecord(views, viewId);
    tableName = view.name;
  }

  const docInfo = safeRecord(safeTable(metaTables, '_grist_DocInfo'), 1);
  const docSettings = gutil.safeJsonParse(docInfo.documentSettings, {});
  const exportData: ExportData = {
    tableName,
    docName: await activeDocSource.getDocName(),
    rowIds,
    access,
    columns,
    docSettings
  };
  return exportData;
}

/**
 * Builds export data for section that can be used to produce files in various formats (csv, xlsx).
 */
export async function exportSection(
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortSpec: Sort.SortSpec | null,
  filters: Filter[] | null,
  linkingFilter: FilterColValues | null = null,
  req: express.Request,
  {metaTables}: {metaTables?: TableDataActionSet} = {},
): Promise<ExportData> {
  return doExportSection(new ActiveDocSourceDirect(activeDoc, req), viewSectionId, sortSpec,
    filters, linkingFilter, {metaTables});
}

export async function doExportSection(
  activeDocSource: ActiveDocSource,
  viewSectionId: number,
  sortSpec: Sort.SortSpec | null,
  filters: Filter[] | null,
  linkingFilter: FilterColValues | null = null,
  {metaTables}: {metaTables?: TableDataActionSet} = {},
): Promise<ExportData> {
  metaTables = metaTables || await getMetaTables(activeDocSource);
  const docData = new DocData((tableId) => { throw new Error("Unexpected DocData fetch"); }, metaTables);
  const viewSections = safeTable(metaTables, '_grist_Views_section');
  const viewSection = safeRecord(viewSections, viewSectionId);
  safe(viewSection.tableRef, `Cannot find or access table`);
  const tables = safeTable(metaTables, '_grist_Tables');
  checkTableAccess(tables, viewSection.tableRef);
  const table = safeRecord(tables, viewSection.tableRef);
  const metaColumns = safeTable(metaTables, '_grist_Tables_column');
  const columns = metaColumns.filterRecords({parentId: table.id});
  const viewSectionFields = safeTable(metaTables, '_grist_Views_section_field');
  const fields = viewSectionFields.filterRecords({parentId: viewSection.id});
  const savedFilters = safeTable(metaTables, '_grist_Filters')
    .filterRecords({viewSectionRef: viewSection.id});

  const fieldsByColRef = _.indexBy(fields, 'colRef');
  const savedFiltersByColRef = _.indexBy(savedFilters, 'colRef');
  const unsavedFiltersByColRef = _.indexBy(filters ?? [], 'colRef');

  // Produce a column description matching what user will see / expect to export
  const viewify = (col: GristTablesColumn, field?: GristViewsSectionField): ExportColumn => {
    const displayCol = metaColumns.getRecord(field?.displayCol || col.displayCol) || col;
    return {
      id: displayCol.id,
      colId: displayCol.colId,
      label: col.label,
      type: col.type,
      formatter: createFullFormatterFromDocData(docData, col.id, field?.id),
      parentPos: col.parentPos,
      description: col.description,
    };
  };
  const buildFilters = (col: GristTablesColumn, field?: GristViewsSectionField) => {
    const filterString = unsavedFiltersByColRef[col.id]?.filter || savedFiltersByColRef[col.id]?.filter;
    const filterFunc = buildColFilter(filterString, col.type);
    return {
      filterFunc,
      id: col.id,
      colId: col.colId,
      type: col.type,
    };
  };
  const columnsForFilters = columns
    .filter(column => !gristTypes.isHiddenCol(column.colId))
    .map(column => buildFilters(column, fieldsByColRef[column.id]));
  const viewColumns: ExportColumn[] = _.sortBy(fields, 'parentPos')
    .map((field) => viewify(metaColumns.getRecord(field.colRef)!, field));

  // The columns named in sort order need to now become display columns
  sortSpec = sortSpec || gutil.safeJsonParse(viewSection.sortColRefs, []);
  sortSpec = sortSpec!.map((colSpec) => {
    const colRef = Sort.getColRef(colSpec);
    const col = metaColumns.getRecord(colRef);
    if (!col) {
      return 0;
    }
    const effectiveColRef = viewify(col, fieldsByColRef[colRef]).id;
    return Sort.swapColRef(colSpec, effectiveColRef);
  });

  // fetch actual data
  const tableData = await activeDocSource.fetchTable(table.tableId);
  let rowIds = tableData[2];
  const dataByColId = tableData[3];
  // sort rows
  const getters = new ServerColumnGetters(rowIds, dataByColId, columns);
  const sorter = new SortFunc(getters);
  sorter.updateSpec(sortSpec);
  rowIds.sort((a, b) => sorter.compare(a, b));
  // create cell accessors
  const tableAccess = columnsForFilters.map(col => getters.getColGetter(col.id)!);
  // create row filter based on all columns filter
  const rowFilter = columnsForFilters
    .map((col, c) => buildRowFilter(tableAccess[c], col.filterFunc))
    .reduce((prevFilter, curFilter) => (id) => prevFilter(id) && curFilter(id), () => true);
  // filter rows numbers
  rowIds = rowIds.filter(rowFilter);

  if (linkingFilter) {
    rowIds = rowIds.filter(getLinkingFilterFunc(getters, linkingFilter));
  }

  const docInfo = safeRecord(safeTable(metaTables, '_grist_DocInfo'), 1);
  const docSettings = gutil.safeJsonParse(docInfo.documentSettings, {});

  const exportData: ExportData = {
    rowIds,
    docSettings,
    tableName: table.tableId,
    docName: await activeDocSource.getDocName(),
    access: viewColumns.map(col => getters.getColGetter(col.id)!),
    columns: viewColumns
  };
  return exportData;
}

type GristViewsSectionField = MetaRowRecord<'_grist_Views_section_field'>
type GristTablesColumn = MetaRowRecord<'_grist_Tables_column'>

// Type for filters passed from the client
export interface Filter { colRef: number, filter: string }
