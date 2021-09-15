/*  Helper file to separate ActiveDoc import functions and convert them to TypeScript. */

import * as path from 'path';
import * as _ from 'underscore';

import {DataSourceTransformed, ImportOptions, ImportResult, ImportTableResult, MergeOptions,
        TransformRuleMap} from 'app/common/ActiveDocAPI';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import * as gutil from 'app/common/gutil';
import {ParseFileResult, ParseOptions} from 'app/plugin/FileParserAPI';
import {GristTable} from 'app/plugin/GristTable';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DocSession, OptDocSession} from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import {globalUploadSet, moveUpload, UploadInfo} from 'app/server/lib/uploads';


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
  // Options for determining how matched fields between source and destination tables should be merged.
  mergeOptions: MergeOptions|null;
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
                             {parseOptions = {}, mergeOptions = []}: ImportOptions,
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
        mergeOptions: mergeOptions[index] || null,
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
    const {originalFilename, parseOptions, mergeOptions, isHidden, uploadFileIndex,
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
      // For final import, call TransformAndFinishImport, which imports file using a transform rule (or blank)

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
        const intoNewTable: boolean = destTableId ? false : true;
        const destTable = destTableId || table.table_name || basename;
        const tableId = await this._activeDoc.applyUserActions(docSession,
          [['TransformAndFinishImport',
          hiddenTableId, destTable, intoNewTable,
          ruleCanBeApplied ? transformRule : null, mergeOptions]]);

        createdTableId = tableId.retValues[0]; // this is garbage for now I think?

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
        'ModifyColumn', tableId, 'gristHelper_Import_' + columnId, colInfo ]));
    }

    // apply user actions
    if (userActions.length) {
      await this._activeDoc.applyUserActions(docSession, userActions);
    }

  }
}
