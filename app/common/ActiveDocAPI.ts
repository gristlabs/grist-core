import {ActionGroup} from 'app/common/ActionGroup';
import {CellValue, TableDataAction, UserAction} from 'app/common/DocActions';
import {FormulaProperties} from 'app/common/GranularAccessClause';
import {UploadResult} from 'app/common/uploads';
import {ParseOptions} from 'app/plugin/FileParserAPI';
import {IMessage} from 'grain-rpc';

export interface ApplyUAOptions {
  desc?: string;      // Overrides the description of the action.
  otherId?: number;   // For undo/redo; the actionNum of the original action to which it applies.
  linkId?: number;    // For bundled actions, actionNum of the previous action in the bundle.
  bestEffort?: boolean; // If set, action may be applied in part if it cannot be applied completely.
}

export interface ApplyUAResult {
  actionNum: number;      // number of the action that got recorded.
  retValues: any[];       // array of return values, one for each of the passed-in user actions.
  isModification: boolean; // true if document was modified.
}

export interface DataSourceTransformed {
  // Identifies the upload, which may include multiple files.
  uploadId: number;

  // For each file in the upload, the transform rules for that file.
  transforms: TransformRuleMap[];
}

export interface TransformRuleMap {
  [origTableName: string]: TransformRule;
}

export interface TransformRule {
  destTableId: string|null;
  destCols: TransformColumn[];
  sourceCols: string[];
}

export interface TransformColumn {
  label: string;
  colId: string|null;
  type: string;
  formula: string;
}

export interface ImportResult {
  options: ParseOptions;
  tables: ImportTableResult[];
}

export interface ImportTableResult {
  hiddenTableId: string;
  uploadFileIndex: number;      // Index into upload.files array, for the file reponsible for this table.
  origTableName: string;
  transformSectionRef: number;
  destTableId: string|null;
}

/**
 * Represents a query for Grist data. The tableId is required. An empty set of filters indicates
 * the full table. Examples:
 *    {tableId: "Projects", filters: {}}
 *    {tableId: "Employees", filters: {Status: ["Active"], Dept: ["Sales", "HR"]}}
 */
interface BaseQuery {
  tableId: string;
  filters: {
    [colId: string]: any[];
  };
}

/**
 * Query that can only be used on the client side.
 * Allows filtering with more complex operations.
 */
export interface ClientQuery extends BaseQuery {
  operations?: {
    [colId: string]: QueryOperation;
  }
}

/**
 * Query intended to be sent to a server.
 */
export interface ServerQuery extends BaseQuery {
  // Queries to server for onDemand tables will set a limit to avoid bringing down the browser.
  limit?: number;
}

export type QueryOperation = "in" | "intersects";

/**
 * Response from useQuerySet(). A query returns data AND creates a subscription to receive
 * DocActions that affect this data. The querySubId field identifies this subscription, and must
 * be used in a disposeQuerySet() call to unsubscribe.
 */
export interface QueryResult {
  querySubId: number;     // ID of the subscription, to use with disposeQuerySet.
  tableData: TableDataAction;
}

/**
 * Result of a fork operation, with newly minted ids.
 * For a document with docId XXXXX and urlId UUUUU, the fork will have a
 * docId of XXXXX~FORKID[~USERID] and a urlId of UUUUU~FORKID[~USERID].
 */
export interface ForkResult {
  docId: string;
  urlId: string;
}

export interface ActiveDocAPI {
  /**
   * Closes a document, and unsubscribes from its userAction events.
   */
  closeDoc(): Promise<void>;

  /**
   * Fetches a particular table from the data engine to return to the client.
   */
  fetchTable(tableId: string): Promise<TableDataAction>;

  /**
   * Fetches the generated Python code for this document. (TODO rename this misnomer.)
   */
  fetchTableSchema(): Promise<string>;

  /**
   * Makes a query (documented elsewhere) and subscribes to it, so that the client receives
   * docActions that affect this query's results. The subscription remains functional even when
   * tables or columns get renamed.
   */
  useQuerySet(query: ServerQuery): Promise<QueryResult>;

  /**
   * Removes the subscription to a Query, identified by QueryResult.querySubId, so that the
   * client stops receiving docActions relevant only to that query.
   */
  disposeQuerySet(querySubId: number): Promise<void>;

  /**
   * Applies an array of user actions to the document.
   */
  applyUserActions(actions: UserAction[], options?: ApplyUAOptions): Promise<ApplyUAResult>;

  /**
   * A variant of applyUserActions where actions are passed in by ids (actionNum, actionHash)
   * rather than by value.
   */
  applyUserActionsById(actionNums: number[], actionHashes: string[],
                       undo: boolean, options?: ApplyUAOptions): Promise<ApplyUAResult>;

  /**
   * Imports files, removes previously created temporary hidden tables and creates the new ones.
   */
  importFiles(dataSource: DataSourceTransformed,
              parseOptions: ParseOptions, prevTableIds: string[]): Promise<ImportResult>;

  /**
   * Finishes import files, creates the new tables, and cleans up temporary hidden tables and uploads.
   */
  finishImportFiles(dataSource: DataSourceTransformed,
                    parseOptions: ParseOptions, prevTableIds: string[]): Promise<ImportResult>;

  /**
   * Cancels import files, cleans up temporary hidden tables and uploads.
   */
  cancelImportFiles(dataSource: DataSourceTransformed, prevTableIds: string[]): Promise<void>;

  /**
   * Saves attachments from a given upload and creates an entry for them in the database. It
   * returns the list of rowIds for the rows created in the _grist_Attachments table.
   */
  addAttachments(uploadId: number): Promise<number[]>;

  /**
   * Returns up to n columns in the document, or a specific table, which contain the given values.
   * Columns are returned ordered from best to worst based on an estimate for number of matches.
   */
  findColFromValues(values: any[], n: number, optTableId?: string): Promise<number[]>;

  /**
   * Returns cell value with an error message (traceback) for one invalid formula cell.
   */
  getFormulaError(tableId: string, colId: string, rowId: number): Promise<CellValue>;

  /**
   * Fetch content at a url.
   */
  fetchURL(url: string): Promise<UploadResult>;

  /**
   * Find and return a list of auto-complete suggestions that start with `txt`, when editing a
   * formula in table `tableId` and column `columnId`.
   */
  autocomplete(txt: string, tableId: string, columnId: string): Promise<string[]>;

  /**
   * Removes the current instance from the doc.
   */
  removeInstanceFromDoc(): Promise<void>;

  /**
   * Get recent actions in ActionGroup format with summaries included.
   */
  getActionSummaries(): Promise<ActionGroup[]>;

  /**
   *  Initiates user actions bandling for undo.
   */
  startBundleUserActions(): Promise<void>;

  /**
   *  Stopes user actions bandling for undo.
   */
  stopBundleUserActions(): Promise<void>;

  /**
   * Forward a grain-rpc message to a given plugin.
   */
  forwardPluginRpc(pluginId: string, msg: IMessage): Promise<any>;

  /**
   * Reload documents plugins.
   */
  reloadPlugins(): Promise<void>;

  /**
   * Immediately close the document and data engine, to be reloaded from scratch, and cause all
   * browser clients to reopen it.
   */
  reloadDoc(): Promise<void>;

  /**
   * Prepare a fork of the document, and return the id(s) of the fork.
   */
  fork(): Promise<ForkResult>;

  /**
   * Check if an ACL formula is valid. If not, will throw an error with an explanation.
   */
  checkAclFormula(text: string): Promise<FormulaProperties>;

  /**
   * Returns the full set of tableIds, with the list of colIds for each table. This is intended
   * for editing ACLs. It is only available to users who can edit ACLs, and lists all resources
   * regardless of rules that may block access to them.
   */
  getAclResources(): Promise<{[tableId: string]: string[]}>;
}
