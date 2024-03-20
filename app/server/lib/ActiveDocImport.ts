/*  Helper file to separate ActiveDoc import functions and convert them to TypeScript. */

import * as path from 'path';
import * as _ from 'underscore';

import {ColumnDelta, createEmptyActionSummary} from 'app/common/ActionSummary';
import {ApplyUAResult, DataSourceTransformed, ImportOptions, ImportResult, ImportTableResult,
        MergeOptions, MergeOptionsMap, MergeStrategy, SKIP_TABLE,
        TransformRule,
        TransformRuleMap} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {BulkColValues, CellValue, fromTableDataAction, UserAction} from 'app/common/DocActions';
import {isBlankValue} from 'app/common/gristTypes';
import * as gutil from 'app/common/gutil';
import {localTimestampToUTC} from 'app/common/RelativeDates';
import {DocStateComparison} from 'app/common/UserAPI';
import {guessColInfoForImports} from 'app/common/ValueGuesser';
import {ParseFileResult, ParseOptions} from 'app/plugin/FileParserAPI';
import {GristColumn, GristTable} from 'app/plugin/GristTable';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DocSession, OptDocSession} from 'app/server/lib/DocSession';
import log from 'app/server/lib/log';
import {globalUploadSet, moveUpload, UploadInfo} from 'app/server/lib/uploads';
import {buildComparisonQuery} from 'app/server/lib/ExpandedQuery';
import flatten = require('lodash/flatten');

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

export interface FileImportOptions {
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
   * @param {number} uploadId: Identifier for the temporary uploaded file(s) to clean up.
   * @param {Array<String>} prevTableIds: Array of tableIds as received from previous `importFiles`
   *  call when re-importing with changed `parseOptions`.
   * @returns {Promise} Promise that's resolved when all actions are applied successfully.
   */
  public async cancelImportFiles(docSession: DocSession,
                                 uploadId: number,
                                 prevTableIds: string[]): Promise<void> {
    await this._removeHiddenTables(docSession, prevTableIds);
    this._activeDoc.stopBundleUserActions(docSession);
    await globalUploadSet.cleanup(uploadId);
  }

  /**
   * Returns a diff of changes that will be applied to the destination table from `transformRule`
   * if the data from `hiddenTableId` is imported with the specified `mergeOptions`.
   *
   * The diff is returned as a `DocStateComparison` of the same doc, with the `rightChanges`
   * containing the updated cell values. Old values are pulled from the destination record (if
   * a match was found), and new values are the result of merging in the new cell values with
   * the merge strategy from `mergeOptions`.
   *
   * No distinction is currently made for added records vs. updated existing records; instead,
   * we treat added records as an updated record in `hiddenTableId` where all the column
   * values changed from blank to the original column values from `hiddenTableId`.
   *
   * @param {string} hiddenTableId Source table.
   * @param {TransformRule} transformRule Transform rule for the original source columns.
   * The destination table id is populated in the rule.
   * @param {MergeOptions} mergeOptions Merge options for how to match source rows
   * with destination records, and how to merge their column values.
   * @returns {Promise<DocStateComparison>} Comparison data for the changes that will occur if
   * `hiddenTableId` is merged into the destination table from `transformRule`.
   */
  public async generateImportDiff(hiddenTableId: string, {destCols, destTableId}: TransformRule,
                                  {mergeCols, mergeStrategy}: MergeOptions): Promise<DocStateComparison> {
    // Merge column ids from client have prefixes that need to be stripped.
    mergeCols = stripPrefixes(mergeCols);

    // Get column differences between `hiddenTableId` and `destTableId` for rows that exist in both tables.
    const srcAndDestColIds: [string, string[]][] = destCols.map(c => [c.colId!, stripPrefixes([c.colId!])]);
    const srcToDestColIds = new Map(srcAndDestColIds);
    const comparisonResult = await this._getTableComparison(hiddenTableId, destTableId!, srcToDestColIds, mergeCols);

    // Initialize container for updated column values in the expected format (ColumnDelta).
    const updatedRecords: {[colId: string]: ColumnDelta} = {};
    const updatedRecordIds: number[] = [];
    const srcColIds = srcAndDestColIds.map(([srcColId, _destColId]) => srcColId);
    for (const id of srcColIds) {
      updatedRecords[id] = {};
    }

    // Retrieve the function used to reconcile differences between source and destination.
    const merge = getMergeFunction(mergeStrategy);

    // Destination columns with a blank formula (i.e. skipped columns).
    const skippedColumnIds = new Set(
      stripPrefixes(destCols.filter(c => c.formula.trim() === '').map(c => c.colId!))
    );

    const numResultRows = comparisonResult[hiddenTableId + '.id'].length;
    for (let i = 0; i < numResultRows; i++) {
      const srcRowId = comparisonResult[hiddenTableId + '.id'][i] as number;

      if (comparisonResult[destTableId + '.id'][i] === null) {
        // No match in destination table found for source row, so it must be a new record.
        for (const srcColId of srcColIds) {
          updatedRecords[srcColId][srcRowId] = [[''], [(comparisonResult[`${hiddenTableId}.${srcColId}`][i])]];
        }
      } else {
        // Otherwise, a match was found between source and destination tables.
        for (const srcColId of srcColIds) {
          const matchingDestColId = srcToDestColIds.get(srcColId)![0];
          const srcVal = comparisonResult[`${hiddenTableId}.${srcColId}`][i];
          const destVal = comparisonResult[`${destTableId}.${matchingDestColId}`][i];

          // Exclude unchanged cell values from the comparison.
          if (srcVal === destVal) { continue; }

          const shouldSkip = skippedColumnIds.has(matchingDestColId);
          updatedRecords[srcColId][srcRowId] = [
            [destVal],
            // For skipped columns, always use the destination value.
            [shouldSkip ? destVal : merge(srcVal, destVal)]
          ];
        }
      }

      updatedRecordIds.push(srcRowId);
    }

    return {
      left: {n: 0, h: ''},  // NOTE: left, right, parent, and summary are not used by Importer.
      right: {n: 0, h: ''},
      parent: null,
      summary: 'right',
      details: {
        leftChanges: createEmptyActionSummary(),
        rightChanges: {
          tableRenames: [],
          tableDeltas: {
            [hiddenTableId]: {
              removeRows: [],
              updateRows: updatedRecordIds,
              addRows: [],  // Since deltas are relative to the source table, we can't (yet) use this.
              columnRenames: [],
              columnDeltas: updatedRecords,
            }
          }
        }
      }
    };
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
   * Import data resulting from parsing a file into a new table.
   * In normal circumstances this is only used internally.
   * It's exposed publicly for use by grist-static which doesn't use the plugin system.
   */
  public async importParsedFileAsNewTable(
    docSession: OptDocSession, optionsAndData: ParseFileResult, importOptions: FileImportOptions
  ): Promise<ImportResult> {
    const {originalFilename, mergeOptionsMap, isHidden, uploadFileIndex, transformRuleMap} = importOptions;
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
      const columnMetadata = cleanColumnMetadata(table.column_metadata, table.table_data, this._activeDoc);
      const result: ApplyUAResult = await this._activeDoc.applyUserActions(docSession,
        [["AddTable", hiddenTableName, columnMetadata]]);
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
        // BulkAddRecord rather than ReplaceTableData so that type guessing is applied to Any columns.
        // Don't use parseStrings, only use the strict parsing in ValueGuesser to make the import lossless.
        [["BulkAddRecord", hiddenTableId, rowIdColumn, columnValues]]);

      // data parsed and put into hiddenTableId
      // For preview_table (isHidden) do GenImporterView to make views and formulas and cols
      // For final import, call _transformAndFinishImport, which imports file using a transform rule (or blank)

      let createdTableId: string;
      let transformSectionRef: number = -1; // TODO: we only have this if we genImporterView, is it necessary?

      if (isHidden) {
        // Generate formula columns, view sections, etc
        const results: ApplyUAResult = await this._activeDoc.applyUserActions(docSession,
          [['GenImporterView', hiddenTableId, destTableId, ruleCanBeApplied ? transformRule : null, null]]);

        transformSectionRef = results.retValues[0].viewSectionRef;
        createdTableId = hiddenTableId;

      } else {
        if (destTableId === SKIP_TABLE) {
          await this._activeDoc.applyUserActions(docSession, [['RemoveTable', hiddenTableId]]);
          continue;
        }
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
        transformSectionRef, // TODO: this shouldn't always be needed, and we only get it if genimporttransform
        destTableId
      });
    }

    await this._fixReferences(docSession, tables, fixedColumnIdsByTable, references, isHidden);

    return ({options, tables});
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
    if (!this._activeDoc.docPluginManager) { throw new Error('no plugin manager available'); }
    await moveUpload(upload, this._activeDoc.docPluginManager.tmpDir());

    const importResult: ImportResult = {options: parseOptions, tables: []};
    for (const [index, file] of upload.files.entries()) {
      // If we have a better guess for the file's extension, replace it in origName, to ensure
      // that DocPluginManager has access to it to guess the best parser type.
      let origName: string = file.origName;
      if (file.ext) {
        origName = path.basename(origName, path.extname(origName)) + file.ext;
      }
      const fileParseOptions = {...parseOptions};
      if (file.ext === '.dsv') {
        if (!fileParseOptions.delimiter) {
          fileParseOptions.delimiter = '💩';
        }
        if (!fileParseOptions.encoding) {
          fileParseOptions.encoding = 'utf-8';
        }
      }
      const res = await this._importFileAsNewTable(docSession, file.absPath, {
        parseOptions: fileParseOptions,
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
   * Currently it starts a python parser as a child process
   * outside the sandbox, and supports xlsx, csv, and perhaps some other formats. It may
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
    const {originalFilename, parseOptions} = importOptions;
    log.info("ActiveDoc._importFileAsNewTable(%s, %s)", tmpPath, originalFilename);
    if (!this._activeDoc.docPluginManager) {
      throw new Error('no plugin manager available');
    }
    const optionsAndData: ParseFileResult =
      await this._activeDoc.docPluginManager.parseFile(tmpPath, originalFilename, parseOptions);
    return this.importParsedFileAsNewTable(docSession, optionsAndData, importOptions);
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
  private async _transformAndFinishImport(
    docSession: OptDocSession,
    hiddenTableId: string, destTableId: string,
    intoNewTable: boolean, transformRule: TransformRule|null,
    mergeOptions: MergeOptions|null
  ): Promise<string> {
    log.info("ActiveDocImport._transformAndFinishImport(%s, %s, %s, %s, %s)",
      hiddenTableId, destTableId, intoNewTable, transformRule, mergeOptions);

    const transformDestTableId = intoNewTable ? null : destTableId;
    const result = await this._activeDoc.applyUserActions(docSession, [[
      'GenImporterView', hiddenTableId, transformDestTableId, transformRule,
      {createViewSection: false, genAll: false, refsAsInts: true},
    ]]);
    transformRule = result.retValues[0].transformRule as TransformRule;

    if (!intoNewTable && mergeOptions && mergeOptions.mergeCols.length > 0) {
      await this._mergeAndFinishImport(docSession, hiddenTableId, destTableId, transformRule, mergeOptions);
      return destTableId;
    }

    const hiddenTableData = fromTableDataAction(await this._activeDoc.fetchTable(docSession, hiddenTableId, true));
    const columnData: BulkColValues = {};

    const srcCols = await this._activeDoc.getTableCols(docSession, hiddenTableId);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const srcColIds = srcCols.map(c => c.id as string);

    // Only include destination columns that weren't skipped.
    const destCols = transformRule.destCols.filter(c => c.formula.trim() !== '');
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
      const colSpecs = destCols.map(({type, colId: id, label, widgetOptions}) => ({type, id, label, widgetOptions}));
      const newTable = await this._activeDoc.applyUserActions(docSession, [['AddTable', destTableId, colSpecs]]);
      destTableId = newTable.retValues[0].table_id;
    }

    await this._activeDoc.applyUserActions(docSession,
      [['BulkAddRecord', destTableId, gutil.arrayRepeat(hiddenTableData.id.length, null), columnData]],
      // Don't use parseStrings for new tables to make the import lossless.
      {parseStrings: !intoNewTable});

    return destTableId;
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
                                      {destCols, sourceCols}: TransformRule,
                                      {mergeCols, mergeStrategy}: MergeOptions): Promise<void> {
    // Merge column ids from client have prefixes that need to be stripped.
    mergeCols = stripPrefixes(mergeCols);

    // Get column differences between `hiddenTableId` and `destTableId` for rows that exist in both tables.
    const srcAndDestColIds: [string, string][] = destCols.map(destCol => {
      const formula = destCol.formula.trim();
      const srcColId = formula.startsWith('$') && sourceCols.includes(formula.slice(1)) ?
        formula.slice(1) : IMPORT_TRANSFORM_COLUMN_PREFIX + destCol.colId;
      return [srcColId, destCol.colId!];
    });
    const srcToDestColIds: Map<string, string[]> = new Map();
    srcAndDestColIds.forEach(([srcColId, destColId]) => {
      if (!srcToDestColIds.has(srcColId)) {
        srcToDestColIds.set(srcColId, [destColId]);
      } else {
        srcToDestColIds.get(srcColId)!.push(destColId);
      }
    });
    const comparisonResult = await this._getTableComparison(hiddenTableId, destTableId, srcToDestColIds, mergeCols);

    // Initialize containers for new and updated records in the expected formats.
    const newRecords: BulkColValues = {};
    let numNewRecords = 0;
    const updatedRecords: BulkColValues = {};
    const updatedRecordIds: number[] = [];

    // Destination columns with a blank formula (i.e. skipped columns).
    const skippedColumnIds = new Set(
      stripPrefixes(destCols.filter(c => c.formula.trim() === '').map(c => c.colId!))
    );

    // Remove all skipped columns from the map.
    srcToDestColIds.forEach((destColIds, srcColId) => {
      srcToDestColIds.set(srcColId, destColIds.filter(id => !skippedColumnIds.has(id)));
    });

    const destColIds = flatten([...srcToDestColIds.values()]);
    for (const id of destColIds) {
      newRecords[id] = [];
      updatedRecords[id] = [];
    }

    // Retrieve the function used to reconcile differences between source and destination.
    const merge = getMergeFunction(mergeStrategy);

    const srcColIds = [...srcToDestColIds.keys()];
    const numResultRows = comparisonResult[hiddenTableId + '.id'].length;
    for (let i = 0; i < numResultRows; i++) {
      if (comparisonResult[destTableId + '.id'][i] === null) {
        // No match in destination table found for source row, so it must be a new record.
        for (const srcColId of srcColIds) {
          const matchingDestColIds = srcToDestColIds.get(srcColId);
          matchingDestColIds!.forEach(id => {
            newRecords[id].push(comparisonResult[`${hiddenTableId}.${srcColId}`][i]);
          });
        }
        numNewRecords++;
      } else {
        // Otherwise, a match was found between source and destination tables, so we merge their columns.
        for (const srcColId of srcColIds) {
          const matchingDestColIds = srcToDestColIds.get(srcColId);
          const srcVal = comparisonResult[`${hiddenTableId}.${srcColId}`][i];
          matchingDestColIds!.forEach(id => {
            const destVal = comparisonResult[`${destTableId}.${id}`][i];
            updatedRecords[id].push(merge(srcVal, destVal));
          });
        }
        updatedRecordIds.push(comparisonResult[destTableId + '.id'][i] as number);
      }
    }

    // We no longer need the temporary import table, so remove it.
    const actions: UserAction[] = [['RemoveTable', hiddenTableId]];

    if (updatedRecordIds.length > 0) {
      actions.push(['BulkUpdateRecord', destTableId, updatedRecordIds, updatedRecords]);
    }

    if (numNewRecords > 0) {
      actions.push(['BulkAddRecord', destTableId, gutil.arrayRepeat(numNewRecords, null), newRecords]);
    }

    await this._activeDoc.applyUserActions(docSession, actions, {parseStrings: true});
  }

  /**
   * Builds and executes a SQL query that compares common columns from `hiddenTableId`
   * and `destTableId`, returning matched rows that contain differences between both tables.
   *
   * The `mergeCols` parameter defines how rows from both tables are matched; we consider
   * rows whose columns values for all columns in `mergeCols` to be the same record in both
   * tables.
   *
   * @param {string} hiddenTableId Source table.
   * @param {string} destTableId Destination table.
   * @param {Map<string, string[]>} srcToDestColIds Map of source to one or more destination column ids
   * to include in the comparison results.
   * @param {string[]} mergeCols List of (destination) column ids to use for matching.
   * @returns {Promise<BulkColValues} Decoded column values from both tables that were matched, and had differences.
   */
  private async _getTableComparison(hiddenTableId: string, destTableId: string, srcToDestColIds: Map<string, string[]>,
                                    mergeCols: string[]): Promise<BulkColValues> {
    const mergeColIds = new Set(mergeCols);
    const destToSrcMergeColIds = new Map();
    srcToDestColIds.forEach((destColIds, srcColId) => {
      const maybeMergeColId = destColIds.find(colId => mergeColIds.has(colId));
      if (maybeMergeColId !== undefined) {
        destToSrcMergeColIds.set(maybeMergeColId, srcColId);
      }
    });

    const query = buildComparisonQuery(hiddenTableId, destTableId, srcToDestColIds, destToSrcMergeColIds);
    const result = await this._activeDoc.docStorage.fetchQuery(query);
    return this._activeDoc.docStorage.decodeMarshalledDataFromTables(result);
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
   * Changes every column of references into a column of integers in `parsedTables`. It
   * returns a list of descriptors of all columns of references.
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
}

// Helper function that returns new `colIds` with import prefixes stripped.
function stripPrefixes(colIds: string[]): string[] {
  return colIds.map(id => id.startsWith(IMPORT_TRANSFORM_COLUMN_PREFIX) ?
    id.slice(IMPORT_TRANSFORM_COLUMN_PREFIX.length) : id);
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
    case 'replace-with-nonblank-source': {
      return (srcVal, destVal) => isBlankValue(srcVal) ? destVal : srcVal;
    }
    case 'replace-all-fields': {
      return (srcVal, _destVal) => srcVal;
    }
    case 'replace-blank-fields-only': {
      return (srcVal, destVal) => isBlankValue(destVal) ? srcVal : destVal;
    }
    default: {
      // Normally, we should never arrive here. If we somehow do, throw an error.
      const unknownStrategyType: never = type;
      throw new Error(`Unknown merge strategy: ${unknownStrategyType}`);
    }
  }
}

/**
 * Tweak the column metadata used in the AddTable action.
 * If `columns` is populated with non-blank column ids, adds labels to all
 * columns using the values set for the column ids.
 * For columns of type Any, guess the type and parse data according to it, or mark as empty
 * formula columns when they should be empty.
 * For columns of type DateTime, add the document timezone to the type.
 */
function cleanColumnMetadata(columns: GristColumn[], tableData: unknown[][], activeDoc: ActiveDoc) {
  return columns.map((c, index) => {
    const newCol: any = {...c};
    if (c.id) {
      newCol.label = c.id;
    }
    if (c.type === "Any") {
      // If import logic left it to us to decide on column type, then use our guessing logic to
      // pick a suitable type and widgetOptions, and to convert values to it.
      const origValues = tableData[index] as CellValue[];
      const {values, colMetadata} = guessColInfoForImports(origValues, activeDoc.docData!);
      tableData[index] = values;
      if (colMetadata) {
        Object.assign(newCol, colMetadata);
      }
    }
    const timezone = activeDoc.docData!.docInfo().timezone;
    if (c.type === "DateTime" && timezone) {
      newCol.type = `DateTime:${timezone}`;
      for (const [i, localTimestamp] of tableData[index].entries()) {
        if (typeof localTimestamp !== 'number') { continue; }

        tableData[index][i] = localTimestampToUTC(localTimestamp, timezone);
      }
    }
    return newCol;
  });
}
