import {ActionGroup} from 'app/common/ActionGroup';
import {BulkAddRecord, CellValue, TableDataAction, UserAction} from 'app/common/DocActions';
import {FormulaProperties} from 'app/common/GranularAccessClause';
import {FetchUrlOptions, UploadResult} from 'app/common/uploads';
import {DocStateComparison, PermissionData, UserAccessData} from 'app/common/UserAPI';
import {ParseOptions} from 'app/plugin/FileParserAPI';
import {AccessTokenOptions, AccessTokenResult, UIRowId} from 'app/plugin/GristAPI';
import {IMessage} from 'grain-rpc';

export interface ApplyUAOptions {
  desc?: string;      // Overrides the description of the action.
  otherId?: number;   // For undo/redo; the actionNum of the original action to which it applies.
  linkId?: number;    // For bundled actions, actionNum of the previous action in the bundle.
  parseStrings?: boolean;  // If true, parses string values in some actions based on the column
}

export interface ApplyUAExtendedOptions extends ApplyUAOptions {
  bestEffort?: boolean; // If set, action may be applied in part if it cannot be applied completely.
  fromOwnHistory?: boolean; // If set, action is confirmed to be a redo/undo taken from history, from
                            // an action marked as being by the current user.
  oldestSource?: number;  // If set, gives the timestamp of the oldest source the undo/redo
                          // action was built from, expressed as number of milliseconds
                          // elapsed since January 1, 1970 00:00:00 UTC
  attachment?: boolean;   // If set, allow actions on attachments.
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

// Special values for import destinations; null means "new table", "" means skip table.
// Both special options exposed as consts.
export const NEW_TABLE = null;
export const SKIP_TABLE = "";
export type DestId = string | typeof NEW_TABLE | typeof SKIP_TABLE;

/**
 * How to import data into an existing table or a new one.
 */
export interface TransformRule {
  /**
   * The destination table for the transformed data. If null, the data is imported into a new table.
   */
  destTableId: DestId;
  /**
   * The list of columns to update (existing or new columns).
   */
  destCols: TransformColumn[];
  /**
   * The list of columns to read from the source table (just the headers name).
   */
  sourceCols: string[];
}

/**
 * Existing or new column to update. It is created based on the temporary table that was imported.
 */
export interface TransformColumn {
  /**
   * Label of the column to update. For new table it is the same name as the source column.
   */
  label: string;
  /**
   * Column id to update (null for a new table).
   */
  colId: string|null;
  /**
   * Type of the column (important for new columns).
   */
  type: string;
  /**
   * Formula to apply to the target column.
   */
  formula: string;
  /**
   * Widget options when we need to create a column (copied from the source).
   */
  widgetOptions: string;
}

export interface ImportParseOptions extends ParseOptions {
  delimiter?: string;
  encoding?: string;
}

export interface ImportResult {
  options: ImportParseOptions;
  tables: ImportTableResult[];
}

export interface ImportTableResult {
  hiddenTableId: string;
  uploadFileIndex: number;      // Index into upload.files array, for the file responsible for this table.
  origTableName: string;
  transformSectionRef: number;
  destTableId: string|null;
}

export interface ImportOptions {
  parseOptions?: ImportParseOptions;   // Options for parsing the source file.
  mergeOptionMaps?: MergeOptionsMap[]; // Options for merging fields, indexed by uploadFileIndex.
}

export interface MergeOptionsMap {
  // Map of original GristTable name of imported table to its merge options, if any.
  [origTableName: string]: MergeOptions|undefined;
}

export interface MergeOptions {
  mergeCols: string[];          // Columns to use as merge keys for incremental imports.
  mergeStrategy: MergeStrategy; // Determines how matched records should be merged between 2 tables.
}

export interface MergeStrategy {
  type: 'replace-with-nonblank-source' | 'replace-all-fields' | 'replace-blank-fields-only';
}

/**
 * Represents a query for Grist data. The tableId is required. An empty set of filters indicates
 * the full table. Examples:
 *    {tableId: "Projects", filters: {}}
 *    {tableId: "Employees", filters: {Status: ["Active"], Dept: ["Sales", "HR"]}}
 */
interface BaseQuery {
  tableId: string;
  filters: QueryFilters;
}

/**
 * Query that can only be used on the client side.
 * Allows filtering with more complex operations.
 */
export interface ClientQuery extends BaseQuery {
  operations: {
    [colId: string]: QueryOperation;
  };
}

export type FilterColValues = Pick<ClientQuery, "filters" | "operations">;

/**
 * Query intended to be sent to a server.
 */
export interface ServerQuery extends BaseQuery {
  // Queries to server for onDemand tables will set a limit to avoid bringing down the browser.
  limit?: number;
}

/**
 * Type of the filters option to queries.
 */
export interface QueryFilters {
  // TODO: check if "any" can be replaced with "CellValue".
  [colId: string]: any[];
}

// - in: value should be contained in filters array
// - intersects: value should be a list with some overlap with filters array
// - empty: value should be falsy (e.g. null) or an empty list, filters is ignored
export type QueryOperation = "in" | "intersects" | "empty";

/**
 * Results of fetching a table. Includes the table data you would
 * expect. May now also include attachment metadata referred to in the table
 * data. Attachment data is expressed as a BulkAddRecord, since it is
 * not a complete table, just selected rows. Attachment data is
 * currently included in fetches when (1) granular access control is
 * in effect, and (2) the user is neither an owner nor someone with
 * read access to the entire document, and (3) there is an attachment
 * column in the fetched table. This is exactly what the standard
 * Grist client needs, but in future it might be desirable to give
 * more control over this behavior.
 */
export interface TableFetchResult {
  tableData: TableDataAction;
  attachments?: BulkAddRecord;
}

/**
 * Response from useQuerySet(). A query returns data AND creates a subscription to receive
 * DocActions that affect this data. The querySubId field identifies this subscription, and must
 * be used in a disposeQuerySet() call to unsubscribe.
 */
export interface QueryResult extends TableFetchResult {
  querySubId: number;     // ID of the subscription, to use with disposeQuerySet.
}

/**
 * Result of a fork operation, with newly minted ids.
 * For a document with docId XXXXX and urlId UUUUU, the fork will have a
 * docId of XXXXX~FORKID[~USERID] and a urlId of UUUUU~FORKID[~USERID].
 */
export interface ForkResult {
  forkId: string;
  docId: string;
  urlId: string;
}

/**
 * An extension of PermissionData to cover not just users with whom a document is shared,
 * but also users mentioned in the document (in user attribute tables), and suggested
 * example users. This is for use in the "View As" feature of the access rules page.
 */
export interface PermissionDataWithExtraUsers extends PermissionData {
  attributeTableUsers: UserAccessData[];
  exampleUsers: UserAccessData[];
}

/**
 * Basic metadata about a table returned by `getAclResources()`.
 */
export interface AclTableDescription {
  title: string;  // Raw data widget title
  colIds: string[];  // IDs of all columns in table
  groupByColLabels: string[] | null;  // Labels of groupby columns for summary tables, or null.
}

export interface AclResources {
  tables: {[tableId: string]: AclTableDescription};
  problems: AclRuleProblem[];
}

export interface AclRuleProblem {
  tables?: {
    tableIds: string[],
  };
  columns?: {
    tableId: string,
    colIds: string[],
  };
  userAttributes?: {
    invalidUAColumns: string[],
    names: string[],
  }
  comment: string;
}

export function getTableTitle(table: AclTableDescription): string {
  let {title} = table;
  if (table.groupByColLabels) {
    title += ' ' + summaryGroupByDescription(table.groupByColLabels);
  }
  return title;
}

export function summaryGroupByDescription(groupByColumnLabels: string[]): string {
  return `[${groupByColumnLabels.length ? 'by ' + groupByColumnLabels.join(", ") : "Totals"}]`;
}

//// Types for autocomplete suggestions

// Suggestion may be a string, or a tuple [funcname, argSpec, isGrist], where:
//  - funcname (e.g. "DATEADD") will be auto-completed with "(", AND linked to Grist
//    documentation.
//  - argSpec (e.g. "(start_date, days=0, ...)") is to be shown as autocomplete caption.
//  - isGrist is no longer used
type ISuggestion = string | [string, string, boolean];

// Suggestion paired with an optional example value to show on the right
export type ISuggestionWithValue = [ISuggestion, string | null];

/**
 * Share information from a Grist document.
 */
export interface ShareInfo {
  linkId: string;
  options: string;
}

/**
 * Share information from the Grist home database.
 */
export interface RemoteShareInfo {
  key: string;
}

export interface ActiveDocAPI {
  /**
   * Closes a document, and unsubscribes from its userAction events.
   */
  closeDoc(): Promise<void>;

  /**
   * Fetches a particular table from the data engine to return to the client.
   */
  fetchTable(tableId: string): Promise<TableFetchResult>;

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
              parseOptions: ImportParseOptions, prevTableIds: string[]): Promise<ImportResult>;

  /**
   * Finishes import files, creates the new tables, and cleans up temporary hidden tables and uploads.
   */
  finishImportFiles(dataSource: DataSourceTransformed, prevTableIds: string[],
                    options: ImportOptions): Promise<ImportResult>;

  /**
   * Cancels import files, cleans up temporary hidden tables and uploads.
   */
  cancelImportFiles(uploadId: number, prevTableIds: string[]): Promise<void>;

  /**
   * Returns a diff of changes that will be applied to the destination table from `transformRule`
   * if the data from `hiddenTableId` is imported with the specified `mergeOptions`.
   */
  generateImportDiff(hiddenTableId: string, transformRule: TransformRule,
                      mergeOptions: MergeOptions): Promise<DocStateComparison>;

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
  fetchURL(url: string, options?: FetchUrlOptions): Promise<UploadResult>;

  /**
   * Find and return a list of auto-complete suggestions that start with `txt`, when editing a
   * formula in table `tableId` and column `columnId`.
   */
  autocomplete(txt: string, tableId: string, columnId: string, rowId: UIRowId): Promise<ISuggestionWithValue[]>;

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
   * Get a token for out-of-band access to the document.
   */
  getAccessToken(options: AccessTokenOptions): Promise<AccessTokenResult>;

  /**
   * Returns the full set of tableIds, with the list of colIds for each table. This is intended
   * for editing ACLs. It is only available to users who can edit ACLs, and lists all resources
   * regardless of rules that may block access to them.
   */
  getAclResources(): Promise<AclResources>;

  /**
   * Wait for document to finish initializing.
   */
  waitForInitialization(): Promise<void>;

  /**
   * Get users that are worth proposing to "View As" for access control purposes.
   */
  getUsersForViewAs(): Promise<PermissionDataWithExtraUsers>;

  getShare(linkId: string): Promise<RemoteShareInfo>;
}
