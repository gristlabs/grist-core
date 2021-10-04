/*  Helper file to separate ActiveDoc import functions and convert them to TypeScript. */

import * as path from 'path';
import * as _ from 'underscore';

import {ApplyUAResult, DataSourceTransformed, ImportOptions, ImportResult, ImportTableResult,
        MergeOptions, MergeOptionsMap, MergeStrategy, TransformColumn, TransformRule,
        TransformRuleMap} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {BulkColValues, CellValue, fromTableDataAction, TableRecordValue} from 'app/common/DocActions';
import * as gutil from 'app/common/gutil';
import {ParseFileResult, ParseOptions} from 'app/plugin/FileParserAPI';
import {GristTable} from 'app/plugin/GristTable';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DocSession, OptDocSession} from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import {globalUploadSet, moveUpload, UploadInfo} from 'app/server/lib/uploads';
import {buildComparisonQuery} from 'app/server/lib/ExpandedQuery';

const IMPORT_TRANSFORM_COLUMN_PREFIX = 'gristHelper_Import_';

/*
 * AddTableRetValue contains return value of user actions 'AddTable'
*/
interface AddTableRetValue {
  table_id: string;
  id: number;
  columns: string[];
  views: object[];
}

interface ReferenceDescription {
  // the table index
  tableIndex: number;
  // the column index
  colIndex: number;
  // the id of the table which is referenced
  refTableId: string;
}

interface FileImportOptions {
  // Suggested name of the import file. It is sometimes used as a suggested table name, e.g. for csv imports.
  originalFilename: string;
  // Containing parseOptions as serialized JSON to pass to the import plugin.
  parseOptions: ParseOptions;
  // Map of table names to their merge options.
  mergeOptionsMap: MergeOptionsMap;
  // Flag to indicate whether table is temporary and hidden or regular.
  isHidden: boolean;
  // Index of original dataSource corresponding to current imported file.
  uploadFileIndex: number;
  // Map of table names to their transform rules.
  transformRuleMap: TransformRuleMap;
}

export class ActiveDocImport {
  constructor(private _activeDoc: ActiveDoc) {}
  /**
   * Imports files, removes previously created temporary hidden tables and creates the new ones
   */
  public async importFiles(docSession: DocSession, dataSource: DataSourceTransformed,
                           parseOptions: ParseOptions, prevTableIds: string[]): Promise<ImportResult> {
    this._activeDoc.startBundleUserActions(docSession);
    await this._removeHiddenTables(docSession, prevTableIds);
    const userId = docSession.authorizer.getUserId();
    const accessId = this._activeDoc.makeAccessId(userId);
    const uploadInfo: UploadInfo = globalUploadSet.getUploadInfo(dataSource.uploadId, accessId);
    return this._importFiles(docSession, uploadInfo, dataSource.transforms, {parseOptions}, true);
  }

  /**
   * Finishes import files, removes temporary hidden tables, temporary uploaded files and creates
   * the new tables
   */
  public async finishImportFiles(docSession: DocSession, dataSource: DataSourceTransformed,
                                 prevTableIds: string[], importOptions: ImportOptions): Promise<ImportResult> {
    this._activeDoc.startBundleUserActions(docSession);
    try {
      await this._removeHiddenTables(docSession, prevTableIds);
      const userId = docSession.authorizer.getUserId();
      const accessId = this._activeDoc.makeAccessId(userId);
      const uploadInfo: UploadInfo = globalUploadSet.getUploadInfo(dataSource.uploadId, accessId);
      const importResult = await this._importFiles(docSession, uploadInfo, dataSource.transforms,
                                                   importOptions, false);
      await globalUploadSet.cleanup(dataSource.uploadId);
      return importResult;
    } finally {
      this._activeDoc.stopBundleUserActions(docSession);
    }
  }

  /**
   * Cancels import files, removes temporary hidden tables and temporary uploaded files
   *
   * @param {ActiveDoc} activeDoc: Instance of ActiveDoc.
   * @param {DataSourceTransformed} dataSource: an array of DataSource
   * @param {Array<String>} prevTableIds: Array of tableIds as received from previous `importFiles`
   *  call when re-importing with changed `parseOptions`.
   * @returns {Promise} Promise that's resolved when all actions are applied successfully.
   */
  public async cancelImportFiles(docSession: DocSession,
                                 dataSource: DataSourceTransformed,
                                 prevTableIds: string[]): Promise<void> {
    await this._removeHiddenTables(docSession, prevTableIds);
    this._activeDoc.stopBundleUserActions(docSession);
    await globalUploadSet.cleanup(dataSource.uploadId);
  }

  /**
   * Import the given upload as new tables in one step. This does not give the user a chance to
   * modify parse options or transforms. The caller is responsible for cleaning up the upload.
   */
  public async oneStepImport(docSession: OptDocSession, uploadInfo: UploadInfo): Promise<ImportResult> {
    this._activeDoc.startBundleUserActions(docSession);
    try {
      return this._importFiles(docSession, uploadInfo, [], {}, false);
    } finally {
      this._activeDoc.stopBundleUserActions(docSession);
    }
  }

  /**
   * Imports all files as new tables, using the given transform rules and import options.
   * The isHidden flag indicates whether to create temporary hidden tables, or final ones.
   */
  private async _importFiles(docSession: OptDocSession, upload: UploadInfo, transforms: TransformRuleMap[],
                             {parseOptions = {}, mergeOptionMaps = []}: ImportOptions,
                             isHidden: boolean): Promise<ImportResult> {

    // Check that upload size is within the configured limits.
    const limit = (Number(process.env.GRIST_MAX_UPLOAD_IMPORT_MB) * 1024 * 1024) || Infinity;
    const totalSize = upload.files.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > limit) {
      throw new ApiError(`Imported files must not exceed ${gutil.byteString(limit)}`, 413);
    }

    // The upload must be within the plugin-accessible directory. Once moved, subsequent calls to
    // moveUpload() will return without having to do anything.
    await moveUpload(upload, this._activeDoc.docPluginManager.tmpDir());

    const importResult: ImportResult = {options: parseOptions, tables: []};
    for (const [index, file] of upload.files.entries()) {
      // If we have a better guess for the file's extension, replace it in origName, to ensure
      // that DocPluginManager has access to it to guess the best parser type.
      let origName: string = file.origName;
      if (file.ext) {
        origName = path.basename(origName, path.extname(origName)) + file.ext;
      }
      const res = await this._importFileAsNewTable(docSession, file.absPath, {
        parseOptions,
        mergeOptionsMap: mergeOptionMaps[index] || {},
        isHidden,
        originalFilename: origName,
        uploadFileIndex: index,
        transformRuleMap: transforms[index] || {}
      });
      if (index === 0) {
        // Returned parse options from the first file should be used for all files in one upload.
        importResult.options = parseOptions = res.options;
      }
      importResult.tables.push(...res.tables);
    }
    return importResult;
  }

  /**
   * Imports the data stored at tmpPath.
   *
   * Currently it starts a python parser (that relies on the messytables library) as a child process
   * outside the sandbox, and supports xls(x), csv, txt, and perhaps some other formats. It may
   * result in the import of multiple tables, in case of e.g. Excel formats.
   * @param {OptDocSession} docSession: Session instance to use for importing.
   * @param {String} tmpPath: The path from of the original file.
   * @param {FileImportOptions} importOptions: File import options.
   * @returns {Promise<ImportResult>} with `options` property containing parseOptions as serialized JSON as adjusted
   * or guessed by the plugin, and `tables`, which is which is a list of objects with information about
   * tables, such as `hiddenTableId`, `uploadFileIndex`, `origTableName`, `transformSectionRef`, `destTableId`.
   */
  private async _importFileAsNewTable(docSession: OptDocSession, tmpPath: string,
                                      importOptions: FileImportOptions): Promise<ImportResult> {
    const {originalFilename, parseOptions, mergeOptionsMap, isHidden, uploadFileIndex,
           transformRuleMap} = importOptions;
    log.info("ActiveDoc._importFileAsNewTable(%s, %s)", tmpPath, originalFilename);
    const optionsAndData: ParseFileResult =
      await this._activeDoc.docPluginManager.parseFile(tmpPath, originalFilename, parseOptions);
    const options = optionsAndData.parseOptions;

    const parsedTables = optionsAndData.tables;
    const references = this._encodeReferenceAsInt(parsedTables);

    const tables: ImportTableResult[] = [];
    const fixedColumnIdsByTable: { [tableId: string]: string[]; } = {};

    for (const table of parsedTables) {
      const ext = path.extname(originalFilename);
      const basename = path.basename(originalFilename, ext).trim();
      const hiddenTableName = 'GristHidden_import';
      const origTableName = table.table_name ? table.table_name : '';
      const transformRule = transformRuleMap && transformRuleMap.hasOwnProperty(origTableName) ?
        transformRuleMap[origTableName] : null;
      const result: ApplyUAResult = await this._activeDoc.applyUserActions(docSession,
        [["AddTable", hiddenTableName, table.column_metadata]]);
      const retValue: AddTableRetValue = result.retValues[0];
      const hiddenTableId = retValue.table_id;    // The sanitized version of the table name.
      const hiddenTableColIds = retValue.columns;      // The sanitized names of the columns.

      // The table_data received from importFile is an array of columns of data, rather than a
      // dictionary, so that it doesn't depend on column names. We instead construct the
      // dictionary once we receive the sanitized column names from AddTable.
      const dataLength = table.table_data[0] ? table.table_data[0].length : 0;
      log.info("Importing table %s, %s rows, from %s", hiddenTableId, dataLength, table.table_name);

      const rowIdColumn = _.range(1, dataLength + 1);
      const columnValues = _.object(hiddenTableColIds, table.table_data);
      const destTableId = transformRule ? transformRule.destTableId : null;
      const ruleCanBeApplied = (transformRule != null) &&
                               _.difference(transformRule.sourceCols, hiddenTableColIds).length === 0;
      await this._activeDoc.applyUserActions(docSession,
        [["ReplaceTableData", hiddenTableId, rowIdColumn, columnValues]]);

      // data parsed and put into hiddenTableId
      // For preview_table (isHidden) do GenImporterView to make views and formulas and cols
      // For final import, call _transformAndFinishImport, which imports file using a transform rule (or blank)

      let createdTableId: string;
      let transformSectionRef: number = -1; // TODO: we only have this if we genImporterView, is it necessary?

      if (isHidden) {
        // Generate formula columns, view sections, etc
        const results: ApplyUAResult = await this._activeDoc.applyUserActions(docSession,
          [['GenImporterView', hiddenTableId, destTableId, ruleCanBeApplied ? transformRule : null]]);

        transformSectionRef = results.retValues[0];
        createdTableId = hiddenTableId;

      } else {
        // Do final import
        const mergeOptions = mergeOptionsMap[origTableName] ?? null;
        const intoNewTable: boolean = destTableId ? false : true;
        const destTable = destTableId || table.table_name || basename;
        createdTableId = await this._transformAndFinishImport(docSession, hiddenTableId, destTable,
          intoNewTable, ruleCanBeApplied ? transformRule : null, mergeOptions);
      }

      fixedColumnIdsByTable[createdTableId] = hiddenTableColIds;

      tables.push({
        hiddenTableId: createdTableId, // TODO: rename thing?
        uploadFileIndex,
        origTableName,
        transformSectionRef, // TODO: this shouldnt always be needed, and we only get it if genimporttransform
        destTableId
      });
    }

    await this._fixReferences(docSession, parsedTables, tables, fixedColumnIdsByTable, references, isHidden);

    return ({options, tables});
  }

  /**
   * Imports records from `hiddenTableId` into `destTableId`, transforming the column
   * values from `hiddenTableId` according to the `transformRule`. Finalizes import when done.
   *
   * If `mergeOptions` is present, records from `hiddenTableId` will be "merged" into `destTableId`
   * according to a set of merge columns. Records from both tables that have equal values for all
   * merge columns are treated as the same record, and will be updated in `destTableId` according
   * to the strategy specified in `mergeOptions`.
   *
   * @param {string} hiddenTableId Source table containing records to be imported.
   * @param {string} destTableId Destination table that will be updated.
   * @param {boolean} intoNewTable True if import destination is a new table.
   * @param {TransformRule|null} transformRule Rules for transforming source columns using formulas
   * before merging/importing takes place.
   * @param {MergeOptions|null} mergeOptions Options for how to merge matching records between
   * the source and destination table.
   * @returns {string} The table id of the new or updated destination table.
   */
  private async _transformAndFinishImport(docSession: OptDocSession,
                                          hiddenTableId: string, destTableId: string,
                                          intoNewTable: boolean, transformRule: TransformRule|null,
                                          mergeOptions: MergeOptions|null): Promise<string> {
    log.info("ActiveDocImport._transformAndFinishImport(%s, %s, %s, %s, %s)",
      hiddenTableId, destTableId, intoNewTable, transformRule, mergeOptions);
    const srcCols = await this._activeDoc.getTableCols(docSession, hiddenTableId);

    // Use a default transform rule if one was not provided by the client.
    if (!transformRule) {
      const transformDest = intoNewTable ? null : destTableId;
      transformRule = await this._makeDefaultTransformRule(docSession, srcCols, transformDest);
    }

    // Transform rules from client may have prefixed column ids, so we need to strip them.
    stripPrefixes(transformRule);

    if (intoNewTable) {
      // Transform rules for new tables don't have filled in destination column ids.
      const result = await this._activeDoc.applyUserActions(docSession, [['FillTransformRuleColIds', transformRule]]);
      transformRule = result.retValues[0] as TransformRule;
    } else if (transformRule.destCols.some(c => c.colId === null)) {
      throw new Error('Column ids in transform rule must be filled when importing into an existing table');
    }

    await this._activeDoc.applyUserActions(docSession,
      [['MakeImportTransformColumns', hiddenTableId, transformRule, false]]);

    if (!intoNewTable && mergeOptions && mergeOptions.mergeCols.length > 0) {
      await this._mergeAndFinishImport(docSession, hiddenTableId, destTableId, transformRule, mergeOptions);
      return destTableId;
    }

    const hiddenTableData = fromTableDataAction(await this._activeDoc.fetchTable(docSession, hiddenTableId, true));
    const columnData: BulkColValues = {};

    const srcColIds = srcCols.map(c => c.id as string);
    const destCols = transformRule.destCols;
    for (const destCol of destCols) {
      const formula = destCol.formula.trim();
      if (!formula) { continue; }

      const srcColId = formula.startsWith('$') && srcColIds.includes(formula.slice(1)) ?
        formula.slice(1) : IMPORT_TRANSFORM_COLUMN_PREFIX + destCol.colId;

      columnData[destCol.colId!] = hiddenTableData[srcColId];
    }

    // We no longer need the temporary import table, so remove it.
    await this._activeDoc.applyUserActions(docSession, [['RemoveTable', hiddenTableId]]);

    // If destination is a new table, we need to create it.
    if (intoNewTable) {
      const colSpecs = destCols.map(({type, colId: id, label}) => ({type, id, label}));
      const newTable = await this._activeDoc.applyUserActions(docSession, [['AddTable', destTableId, colSpecs]]);
      destTableId = newTable.retValues[0].table_id;
    }

    await this._activeDoc.applyUserActions(docSession,
        [['BulkAddRecord', destTableId, gutil.arrayRepeat(hiddenTableData.id.length, null), columnData]]);

    return destTableId;
  }

  /**
   * Returns a default TransformRule using column definitions from `destTableId`. If `destTableId`
   * is null (in the case when the import destination is a new table), the `srcCols` are used instead.
   *
   * @param {TableRecordValue[]} srcCols Source column definitions.
   * @param {string|null} destTableId The destination table id. If null, the destination is assumed
   * to be a new table, and `srcCols` are used to build the transform rule.
   * @returns {Promise<TransformRule>} The constructed transform rule.
   */
  private async _makeDefaultTransformRule(docSession: OptDocSession, srcCols: TableRecordValue[],
                                          destTableId: string|null): Promise<TransformRule> {
    const targetCols = destTableId ? await this._activeDoc.getTableCols(docSession, destTableId) : srcCols;
    const destCols: TransformColumn[] = [];
    const srcColIds = srcCols.map(c => c.id as string);

    for (const {id, fields} of targetCols) {
      if (fields.isFormula === true || fields.formula !== '') { continue; }

      destCols.push({
        colId: destTableId ? id as string : null,
        label: fields.label as string,
        type: fields.type as string,
        formula: srcColIds.includes(id as string) ? `$${id}` :  ''
      });
    }

    return {
      destTableId,
      destCols,
      sourceCols: srcColIds
    };
  }

  /**
   * This function removes temporary hidden tables which were created during the import process
   *
   * @param {Array[String]} hiddenTableIds: Array of hidden table ids
   * @returns {Promise} Promise that's resolved when all actions are applied successfully.
   */
  private async _removeHiddenTables(docSession: DocSession, hiddenTableIds: string[]) {
    if (hiddenTableIds.length !== 0) {
      await this._activeDoc.applyUserActions(docSession, hiddenTableIds.map(t => ['RemoveTable', t]));
    }
  }

  /**
   * The methods changes every column of references into a column of integers in `parsedTables`. It
   * returns `parsedTable` and a list of descriptors of all columns of references.
   */
  private _encodeReferenceAsInt(parsedTables: GristTable[]): ReferenceDescription[] {
    const references = [];
    for (const [tableIndex, parsedTable] of parsedTables.entries()) {
      for (const [colIndex, col] of parsedTable.column_metadata.entries()) {
        const refTableId = gutil.removePrefix(col.type, "Ref:");
        if (refTableId) {
          references.push({refTableId, colIndex, tableIndex});
          col.type = 'Int';
        }
      }
    }
    return references;
  }

  /**
   * This function fix references that are broken by the change of table id.
   */
  private async _fixReferences(docSession: OptDocSession,
                               parsedTables: GristTable[],
                               tables: ImportTableResult[],
                               fixedColumnIds: { [tableId: string]: string[]; },
                               references: ReferenceDescription[],
                               isHidden: boolean) {

    // collect all new table ids
    const tablesByOrigName = _.indexBy(tables, 'origTableName');

    //  gather all of the user actions
    let userActions: any[] = references.map( ref => {
      const fixedTableId = tables[ref.tableIndex].hiddenTableId;
      return [
        'ModifyColumn',
        fixedTableId,
        fixedColumnIds[fixedTableId][ref.colIndex],
        { type: `Ref:${tablesByOrigName[ref.refTableId].hiddenTableId}` }
      ];
    });

    if (isHidden) {
      userActions = userActions.concat(userActions.map(([, tableId, columnId, colInfo]) => [
        'ModifyColumn', tableId, IMPORT_TRANSFORM_COLUMN_PREFIX + columnId, colInfo ]));
    }

    // apply user actions
    if (userActions.length) {
      await this._activeDoc.applyUserActions(docSession, userActions);
    }

  }

  /**
   * Merges matching records from `hiddenTableId` into `destTableId`, and finalizes import.
   *
   * @param {string} hiddenTableId Source table containing records to be imported.
   * @param {string} destTableId Destination table that will be updated.
   * @param {TransformRule} transformRule Rules for transforming source columns using formulas
   * before merging/importing takes place.
   * @param {MergeOptions} mergeOptions Options for how to merge matching records between
   * the source and destination table.
   */
  private async _mergeAndFinishImport(docSession: OptDocSession, hiddenTableId: string, destTableId: string,
                                      transformRule: TransformRule, mergeOptions: MergeOptions): Promise<void> {
    // Prepare a set of column pairs (source and destination) for selecting and joining.
    const selectColumns: [string, string][] = [];
    const joinColumns: [string, string][] = [];

    for (const destCol of transformRule.destCols) {
      const destColId = destCol.colId as string;

      const formula = destCol.formula.trim();
      const srcColId = formula.startsWith('$') && transformRule.sourceCols.includes(formula.slice(1)) ?
        formula.slice(1) : IMPORT_TRANSFORM_COLUMN_PREFIX + destCol.colId;

      selectColumns.push([srcColId, destColId]);

      if (mergeOptions.mergeCols.includes(destColId)) {
        joinColumns.push([srcColId, destColId]);
      }
    }

    const selectColumnsMap = new Map(selectColumns);
    const joinColumnsMap = new Map(joinColumns);

    // Construct and execute a SQL query that will tell us the differences between source and destination.
    const query = buildComparisonQuery(hiddenTableId, destTableId, selectColumnsMap, joinColumnsMap);
    const result = await this._activeDoc.docStorage.fetchQuery(query);
    const decodedResult = this._activeDoc.docStorage.decodeMarshalledDataFromTables(result);

    // Initialize containers for new and updated records in the expected formats.
    const newRecords: BulkColValues = {};
    let numNewRecords = 0;
    const updatedRecords: BulkColValues = {};
    const updatedRecordIds: number[] = [];

    const destColIds = [...selectColumnsMap.values()];
    for (const id of destColIds) {
      newRecords[id] = [];
      updatedRecords[id] = [];
    }

    // Retrieve the function used to reconcile differences between source and destination.
    const merge = getMergeFunction(mergeOptions.mergeStrategy);

    const srcColIds = [...selectColumnsMap.keys()];
    const numResultRows = decodedResult[hiddenTableId + '.id'].length;
    for (let i = 0; i < numResultRows; i++) {
      if (decodedResult[destTableId + '.id'][i] === null) {
        // No match in destination table found for source row, so it must be a new record.
        for (const srcColId of srcColIds) {
          const matchingDestColId = selectColumnsMap.get(srcColId);
          newRecords[matchingDestColId!].push(decodedResult[`${hiddenTableId}.${srcColId}`][i]);
        }
        numNewRecords++;
      } else {
        // Otherwise, a match was found between source and destination tables, so we merge their columns.
        for (const srcColId of srcColIds) {
          const matchingDestColId = selectColumnsMap.get(srcColId);
          const srcVal = decodedResult[`${hiddenTableId}.${srcColId}`][i];
          const destVal = decodedResult[`${destTableId}.${matchingDestColId}`][i];
          updatedRecords[matchingDestColId!].push(merge(srcVal, destVal));
        }
        updatedRecordIds.push(decodedResult[destTableId + '.id'][i] as number);
      }
    }

    // We no longer need the temporary import table, so remove it.
    await this._activeDoc.applyUserActions(docSession, [['RemoveTable', hiddenTableId]]);

    if (updatedRecordIds.length > 0) {
      await this._activeDoc.applyUserActions(docSession,
        [['BulkUpdateRecord', destTableId, updatedRecordIds, updatedRecords]]);
    }

    if (numNewRecords > 0) {
      await this._activeDoc.applyUserActions(docSession,
        [['BulkAddRecord', destTableId, gutil.arrayRepeat(numNewRecords, null), newRecords]]);
    }
  }
}

// Helper function that returns true if a given cell is blank (i.e. null or empty).
function isBlank(value: CellValue): boolean {
  return value === null || (typeof value === 'string' && value.trim().length === 0);
}

// Helper function that strips import prefixes from columns in transform rules (if ids are present).
function stripPrefixes({destCols}: TransformRule): void {
  for (const col of destCols) {
    const colId = col.colId;
    if (colId && colId.startsWith(IMPORT_TRANSFORM_COLUMN_PREFIX)) {
      col.colId = colId.slice(IMPORT_TRANSFORM_COLUMN_PREFIX.length);
    }
  }
}

type MergeFunction = (srcVal: CellValue, destVal: CellValue) => CellValue;

/**
 * Returns a function that maps source and destination column values to a single output value.
 *
 * @param {MergeStrategy} mergeStrategy Determines how matching source and destination column values
 * should be reconciled when merging.
 * @returns {MergeFunction} Function that maps column value pairs to a single output value.
 */
function getMergeFunction({type}: MergeStrategy): MergeFunction {
  switch (type) {
    case 'replace-with-nonblank-source':
      return (srcVal, destVal) => isBlank(srcVal) ? destVal : srcVal;
    case 'replace-all-fields':
      return (srcVal, _destVal) => srcVal;
    case 'replace-blank-fields-only':
      return (srcVal, destVal) => isBlank(destVal) ? srcVal : destVal;
    default:
      // Normally, we should never arrive here. If we somehow do, we throw an error.
      throw new Error(`Unknown merge strategy: ${type}`);
  }
}
