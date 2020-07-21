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

export type ComponentKind = "safeBrowser" | "safePython" | "unsafeNode";

export const RPC_GRISTAPI_INTERFACE = '_grist_api';

export interface GristAPI {
  /**
   * Render the file at `path` into the `target` location in Grist. `path` must be relative to the
   * root of the plugin's directory and point to an html that is contained within the plugin's
   * directory. `target` is a predifined location of the Grist UI, it could be `fullscreen` or
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
 * GristDocAPI interface is implemented by Grist, and allows getting information from and
 * interacting with the Grist document to which a plugin is attached.
 */
export interface GristDocAPI {
  // Returns the docName that identifies the document.
  getDocName(): Promise<string>;

  // Returns a sorted list of table IDs.
  listTables(): Promise<string[]>;

  // Returns a complete table of data in the format {colId: [values]}, including the 'id' column.
  // Do not modify the returned arrays in-place, especially if used directly (not over RPC).
  // TODO: return type is Promise{[colId: string]: CellValue[]}> but cannot be specified because
  // ts-interface-builder does not properly support index-signature.
  fetchTable(tableId: string): Promise<any>;

  // Applies an array of user actions.
  // todo: return type should be Promise<ApplyUAResult>, but this requires importing modules from
  // `app/common` which is not currently supported by the build.
  applyUserActions(actions: any[][]): Promise<any>;
}

export interface GristView {
  // Like fetchTable, but gets data for the custom section specifically, if there is any.
  // TODO: return type is Promise{[colId: string]: CellValue[]}> but cannot be specified because
  // ts-interface-builder does not properly support index-signature.
  fetchSelectedTable(): Promise<any>;
}
