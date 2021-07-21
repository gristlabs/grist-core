import {buildColFilter} from 'app/common/ColumnFilterFunc';
import {RowRecord} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import * as gristTypes from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {buildRowFilter} from 'app/common/RowFilterFunc';
import {SchemaTypes} from 'app/common/schema';
import {SortFunc} from 'app/common/SortFunc';
import {TableData} from 'app/common/TableData';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {docSessionFromRequest} from 'app/server/lib/DocSession';
import {ServerColumnGetters} from 'app/server/lib/ServerColumnGetters';
import * as express from 'express';
import * as _ from 'underscore';

// Helper type for Cell Accessor
type Access = (row: number) => any;

// Helper interface with information about the column
interface ExportColumn {
  id: number;
  colId: string;
  label: string;
  type: string;
  widgetOptions: any;
  parentPos: number;
}
// helper for empty column
const emptyCol: ExportColumn = {
  id: 0,
  colId: '',
  label: '',
  type: '',
  widgetOptions: null,
  parentPos: 0
};
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
}

/**
 * Export parameters that identifies a section, filters, sort order.
 */
export interface ExportParameters {
  tableId: string;
  viewSectionId: number;
  sortOrder: number[];
  filters: Filter[]
}

/**
 * Gets export parameters from a request.
 */
export function parseExportParameters(req: express.Request): ExportParameters {
  const tableId = req.query.tableId;
  const viewSectionId = parseInt(req.query.viewSection, 10);
  const sortOrder = gutil.safeJsonParse(req.query.activeSortSpec, null) as number[];
  const filters: Filter[] = gutil.safeJsonParse(req.query.filters, []) || [];

  return {
    tableId,
    viewSectionId,
    sortOrder,
    filters
  };
}

/**
 * Calculates the file name (without an extension) for exported table.
 * @param activeDoc ActiveDoc
 * @param req Request (with export params)
 */
export function parseExportFileName(activeDoc: ActiveDoc, req: express.Request) {
  const title = req.query.title;
  const tableId = req.query.tableId;
  const docName = title || activeDoc.docName;
  const name = docName +
    (tableId === docName ? '' : '-' + tableId);
  return name;
}

// Makes assertion that value does exists or throws an error
function safe<T>(value: T, msg: string) {
  if (!value) { throw new Error(msg); }
  return value as NonNullable<T>;
}

// Helper to for getting table from docData.
const safeTable = (docData: DocData, name: keyof SchemaTypes) => safe(docData.getTable(name),
  `No table '${name}' in document with id ${docData}`);

// Helper for getting record safe
const safeRecord = (table: TableData, id: number) => safe(table.getRecord(id),
  `No record ${id} in table ${table.tableId}`);

/**
 * Builds export for all raw tables that are in doc.
 * @param activeDoc Active document
 * @param req Request
 */
export async function exportDoc(
  activeDoc: ActiveDoc,
  req: express.Request) {
  const docData = safe(activeDoc.docData, "No docData in active document");
  const tables = safeTable(docData, '_grist_Tables');
  // select raw tables
  const tableIds = tables.filterRowIds({ summarySourceTable: 0 });
  const tableExports = await Promise.all(
    tableIds
      .map(tId => exportTable(activeDoc, tId, req))
  );
  return tableExports;
}

/**
 * Builds export data for section that can be used to produce files in various formats (csv, xlsx).
 */
export async function exportTable(
  activeDoc: ActiveDoc,
  tableId: number,
  req: express.Request): Promise<ExportData> {
  const docData = safe(activeDoc.docData, "No docData in active document");
  const tables = safeTable(docData, '_grist_Tables');
  const table = safeRecord(tables, tableId) as GristTables;
  const tableColumns = (safeTable(docData, '_grist_Tables_column')
    .getRecords() as GristTablesColumn[])
    // remove manual sort column
    .filter(col => col.colId !== gristTypes.MANUALSORT);
  // Produce a column description matching what user will see / expect to export
  const tableColsById = _.indexBy(tableColumns, 'id');
  const columns = tableColumns.map(tc => {
    // remove all columns that don't belong to this table
    if (tc.parentId !== tableId) {
      return emptyCol;
    }
    // remove all helpers
    if (gristTypes.isHiddenCol(tc.colId)) {
      return emptyCol;
    }
    // for reference columns, return display column, and copy settings from visible column
    const displayCol = tableColsById[tc.displayCol || tc.id];
    const colOptions = gutil.safeJsonParse(tc.widgetOptions, {});
    const displayOptions = gutil.safeJsonParse(displayCol.widgetOptions, {});
    const widgetOptions = Object.assign(displayOptions, colOptions);
    return {
      id: displayCol.id,
      colId: displayCol.colId,
      label: tc.label,
      type: displayCol.type,
      widgetOptions,
      parentPos: tc.parentPos
    };
  }).filter(tc => tc !== emptyCol);

  // fetch actual data
  const data = await activeDoc.fetchTable(docSessionFromRequest(req as RequestWithLogin), table.tableId, true);
  const rowIds = data[2];
  const dataByColId = data[3];
  // sort rows
  const getters = new ServerColumnGetters(rowIds, dataByColId, columns);
  // create cell accessors
  const access = columns.map(col => getters.getColGetter(col.id)!);

  let tableName = table.tableId;
  // since tables ids are not very friendly, borrow name from a primary view
  if (table.primaryViewId) {
    const viewId = table.primaryViewId;
    const views = safeTable(docData, '_grist_Views');
    const view = safeRecord(views, viewId) as GristView;
    tableName = view.name;
  }

  return {
    tableName,
    docName: activeDoc.docName,
    rowIds,
    access,
    columns
  };
}

/**
 * Builds export data for section that can be used to produce files in various formats (csv, xlsx).
 */
export async function exportSection(
  activeDoc: ActiveDoc,
  viewSectionId: number,
  sortOrder: number[] | null,
  filters: Filter[] | null,
  req: express.Request): Promise<ExportData> {

  const docData = safe(activeDoc.docData, "No docData in active document");
  const viewSections = safeTable(docData, '_grist_Views_section');
  const viewSection = safeRecord(viewSections, viewSectionId) as GristViewsSection;
  const tables = safeTable(docData, '_grist_Tables');
  const table = safeRecord(tables, viewSection.tableRef) as GristTables;
  const columns = safeTable(docData, '_grist_Tables_column')
    .filterRecords({ parentId: table.id }) as GristTablesColumn[];
  const viewSectionFields = safeTable(docData, '_grist_Views_section_field');
  const fields = viewSectionFields.filterRecords({ parentId: viewSection.id }) as GristViewsSectionField[];

  const tableColsById = _.indexBy(columns, 'id');

  // Produce a column description matching what user will see / expect to export
  const viewify = (col: GristTablesColumn, field: GristViewsSectionField) => {
    field = field || {};
    const displayCol = tableColsById[field.displayCol || col.displayCol || col.id];
    const colWidgetOptions = gutil.safeJsonParse(col.widgetOptions, {});
    const fieldWidgetOptions = gutil.safeJsonParse(field.widgetOptions, {});
    const filterString = (filters || []).find(x => x.colRef === field.colRef)?.filter || field.filter;
    const filterFunc = buildColFilter(filterString, col.type);
    return {
      id: displayCol.id,
      colId: displayCol.colId,
      label: col.label,
      type: col.type,
      parentPos: col.parentPos,
      filterFunc,
      widgetOptions: Object.assign(colWidgetOptions, fieldWidgetOptions)
    };
  };
  const viewColumns = _.sortBy(fields, 'parentPos').map(
    (field) => viewify(tableColsById[field.colRef], field));

  // The columns named in sort order need to now become display columns
  sortOrder = sortOrder || gutil.safeJsonParse(viewSection.sortColRefs, []);
  const fieldsByColRef = _.indexBy(fields, 'colRef');
  sortOrder = sortOrder!.map((directionalColRef) => {
    const colRef = Math.abs(directionalColRef);
    const col = tableColsById[colRef];
    if (!col) {
      return 0;
    }
    const effectiveColRef = viewify(col, fieldsByColRef[colRef]).id;
    return directionalColRef > 0 ? effectiveColRef : -effectiveColRef;
  });

  // fetch actual data
  const data = await activeDoc.fetchTable(docSessionFromRequest(req as RequestWithLogin), table.tableId, true);
  let rowIds = data[2];
  const dataByColId = data[3];
  // sort rows
  const getters = new ServerColumnGetters(rowIds, dataByColId, columns);
  const sorter = new SortFunc(getters);
  sorter.updateSpec(sortOrder);
  rowIds.sort((a, b) => sorter.compare(a, b));
  // create cell accessors
  const access = viewColumns.map(col => getters.getColGetter(col.id)!);
  // create row filter based on all columns filter
  const rowFilter = viewColumns
    .map((col, c) => buildRowFilter(access[c], col.filterFunc))
    .reduce((prevFilter, curFilter) => (id) => prevFilter(id) && curFilter(id), () => true);
  // filter rows numbers
  rowIds = rowIds.filter(rowFilter);

  return {
    tableName: table.tableId,
    docName: activeDoc.docName,
    rowIds,
    access,
    columns: viewColumns
  };
}

// Type helpers for types used in this export
type RowModel<TName extends keyof SchemaTypes> = RowRecord & {
  [ColId in keyof SchemaTypes[TName]]: SchemaTypes[TName][ColId];
};
type GristViewsSection = RowModel<'_grist_Views_section'>
type GristTables = RowModel<'_grist_Tables'>
type GristViewsSectionField = RowModel<'_grist_Views_section_field'>
type GristTablesColumn = RowModel<'_grist_Tables_column'>
type GristView = RowModel<'_grist_Views'>

// Type for filters passed from the client
export interface Filter { colRef: number, filter: string }
