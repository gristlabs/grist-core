/**
 * This file defines the interface for the grist api exposed to SafeBrowser plugins. Grist supports
 * various ways to require it to cover various scenarios. If writing the main safeBrowser module
 * (the one referenced by the components.safeBrowser key of the manifest) use
 * `self.importScript('grist');`, if writing a view include the script in the html `<script src="grist"></script>`
 *
 *
 * Example usage (let's assume that Grist let's plugin contributes to a Foo API defined as follow ):
 *
 * interface Foo {
 *   foo(name: string): Promise<string>;
 * }
 *
 * > main.ts:
 * class MyFoo {
 *   public foo(name: string): Promise<string> {
 *     return new Promise<string>( async resolve => {
 *       grist.rpc.onMessage( e => {
 *         resolve(e.data + name);
 *       });
 *       grist.ready();
 *       await grist.api.render('view1.html', 'fullscreen');
 *     });
 *   }
 * }
 * grist.rpc.registerImpl<Foo>('grist', new MyFoo()); // can add 3rd arg with type information
 *
 * > view1.html includes:
 * grist.api.render('static/view2.html', 'fullscreen').then( view => {
 *   grist.rpc.onMessage(e => grist.rpc.postMessageForward("main.ts", e.data));
 * });
 *
 * > view2.html includes:
 * grist.rpc.postMessage('view1.html', 'foo ');
 *
 */

import {RenderOptions, RenderTarget} from './RenderOptions';

// This is the row ID used in the client, but it's helpful to have available in some common code
// as well, which is why it's declared here. Note that for data actions and stored data,
// 'new' is not used.
/**
 * Represents the id of a row in a table. The value of the `id` column. Might be a number or 'new' value for a new row.
 */
export type UIRowId = number | 'new';

/**
 * Represents the position of an active cursor on a page.
 */
export interface CursorPos {
  /**
   * The rowId (value of the `id` column) of the current cursor position, or 'new' if the cursor is on a new row.
   */
  rowId?: UIRowId;
  /**
   * The index of the current row in the current view.
   */
  rowIndex?: number;
  /**
   * The index of the selected field in the current view.
   */
  fieldIndex?: number;
  /**
   * The id of a section that this cursor is in. Ignored when setting a cursor position for a particular view.
   */
  sectionId?: number;
  /**
   * When in a linked section, CursorPos may include which rows in the controlling sections are
   * selected: the rowId in the linking-source section, in _that_ section's linking source, etc.
   */
  linkingRowIds?: UIRowId[];
}

export type ComponentKind = "safeBrowser" | "safePython" | "unsafeNode";

export const RPC_GRISTAPI_INTERFACE = '_grist_api';

export interface GristAPI {
  /**
   * Render the file at `path` into the `target` location in Grist. `path` must be relative to the
   * root of the plugin's directory and point to an html that is contained within the plugin's
   * directory. `target` is a predefined location of the Grist UI, it could be `fullscreen` or
   * identifier for an inline target. Grist provides inline target identifiers in certain call
   * plugins. E.g. ImportSourceAPI.getImportSource is given a target identifier to allow rende UI
   * inline in the import dialog. Returns the procId which can be used to dispose the view.
   */
  render(path: string, target: RenderTarget, options?: RenderOptions): Promise<number>;

  /**
   * Dispose the process with id procId. If the process was embedded into the UI, removes the
   * corresponding element from the view.
   */
  dispose(procId: number): Promise<void>;

  // Subscribes to actions for `tableId`. Actions of all subscribed tables are send as rpc's
  // message.
  // TODO: document format of messages that can be listened on `rpc.onMessage(...);`
  subscribe(tableId: string): Promise<void>;

  // Unsubscribe from actions for `tableId`.
  unsubscribe(tableId: string): Promise<void>;

}

/**
 * Allows getting information from and interacting with the Grist document to which a plugin or widget is attached.
 */
export interface GristDocAPI {
  /**
   * Returns an identifier for the document.
   */
  getDocName(): Promise<string>;

  /**
   * Returns a sorted list of table IDs.
   */
  listTables(): Promise<string[]>;

  /**
   * Returns a complete table of data as {@link GristData.RowRecords | GristData.RowRecords}, including the
   * 'id' column. Do not modify the returned arrays in-place, especially if used
   * directly (not over RPC).
   */
  fetchTable(tableId: string): Promise<any>;
  // TODO: return type is Promise{[colId: string]: CellValue[]}> but cannot be specified
  // because ts-interface-builder does not properly support index-signature.

  /**
   * Applies an array of user actions.
   */
  applyUserActions(actions: any[][], options?: any): Promise<any>;
  // TODO: return type should be Promise<ApplyUAResult>, but this requires importing
  // modules from `app/common` which is not currently supported by the build.

  /**
   * Get a token for out-of-band access to the document.
   */
  getAccessToken(options: AccessTokenOptions): Promise<AccessTokenResult>;
}

/**
 * Options for functions which fetch data from the selected table or record:
 *
 * - {@link onRecords}
 * - {@link onRecord}
 * - {@link fetchSelectedRecord}
 * - {@link fetchSelectedTable}
 * - {@link GristView.fetchSelectedRecord | GristView.fetchSelectedRecord}
 * - {@link GristView.fetchSelectedTable | GristView.fetchSelectedTable}
 *
 * The different methods have different default values for `keepEncoded` and `format`.
 **/
export interface FetchSelectedOptions {
  /**
   * - `true`: the returned data will contain raw {@link GristData.CellValue}'s.
   * - `false`: the values will be decoded, replacing e.g. `['D', timestamp]` with a moment date.
   */
  keepEncoded?: boolean;

  /**
   * - `rows`, the returned data will be an array of objects, one per row, with column names as keys.
   * - `columns`, the returned data will be an object with column names as keys, and arrays of values.
   */
  format?: 'rows' | 'columns';

  /**
   * - `shown` (default): return only columns that are explicitly shown
   *   in the right panel configuration of the widget. This is the only value that doesn't require full access.
   * - `normal`: return all 'normal' columns, regardless of whether the user has shown them.
   * - `all`: also return special invisible columns like `manualSort` and display helper columns.
   */
  includeColumns?: 'shown' | 'normal' | 'all';
}

/**
 * Interface for the data backing a single widget.
 */
export interface GristView {
  /**
   * Like {@link GristDocAPI.fetchTable | GristDocAPI.fetchTable},
   * but gets data for the custom section specifically, if there is any.
   * By default, `options.keepEncoded` is `true` and `format` is `columns`.
   */
  fetchSelectedTable(options?: FetchSelectedOptions): Promise<any>;

  /**
   * Fetches selected record by its `rowId`. By default, `options.keepEncoded` is `true`.
   */
  fetchSelectedRecord(rowId: number, options?: FetchSelectedOptions): Promise<any>;
  // TODO: return type is Promise{[colId: string]: CellValue}> but cannot be specified
  // because ts-interface-builder does not properly support index-signature.

  /**
   * Deprecated now. It was used for filtering selected table by `setSelectedRows` method.
   * Now the preferred way it to use ready message.
   */
  allowSelectBy(): Promise<void>;

  /**
   * Set the list of selected rows to be used against any linked widget.
   */
  setSelectedRows(rowIds: number[]|null): Promise<void>;

  /**
   * Sets the cursor position to a specific row and field. `sectionId` is ignored. Used for widget linking.
   */
  setCursorPos(pos: CursorPos): Promise<void>
}

/**
 * Options when creating access tokens.
 */
export interface AccessTokenOptions {
  /** Restrict use of token to reading only */
  readOnly?: boolean;
}

/**
 * Access token information, including the token string itself, a base URL for
 * API calls for which the access token can be used, and the time-to-live the
 * token was created with.
 */
export interface AccessTokenResult {
  /**
   * The token string, which can currently be provided in an api call as a
   * query parameter called "auth"
   */
  token: string;

  /**
   * The base url of the API for which the token can be used. Currently tokens
   * are associated with a single document, so the base url will be something
   * like `https://..../api/docs/DOCID`
   *
   * Access tokens currently only grant access to endpoints dealing with the
   * internal content of a document (such as tables and cells) and not its
   * metadata (such as the document name or who it is shared with).
   */
  baseUrl: string;

  /**
   * Number of milliseconds the access token will remain valid for
   * after creation. This will be several minutes.
   */
  ttlMsecs: number;
}
