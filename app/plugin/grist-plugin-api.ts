// Provide a way to acess grist for iframe, web worker (which runs the main safeBrowser script) and
// unsafeNode. WebView should work the same way as iframe, grist is exposed just the same way and
// necessary api is exposed using preload script. Here we bootstrap from channel capabilities to key
// parts of the grist API.

// For iframe (and webview):
// user will add '<script src="/grist-api.js"></script>' and get a window.grist

// For web worker:
// use will add `self.importScripts('/grist-api.js');`

// For node, user will do something like:
//   const {grist} = require('grist-api');
//   grist.registerFunction();
// In TypeScript:
//   import {grist} from 'grist-api';
//   grist.registerFunction();

// tslint:disable:no-console

import { GristAPI, GristDocAPI, GristView, RPC_GRISTAPI_INTERFACE } from './GristAPI';
import { RowRecord } from './GristData';
import { ImportSource, ImportSourceAPI, InternalImportSourceAPI } from './InternalImportSourceAPI';
import { decodeObject, mapValues } from './objtypes';
import { RenderOptions, RenderTarget } from './RenderOptions';
import { checkers } from './TypeCheckers';

export * from './TypeCheckers';
export * from './FileParserAPI';
export * from './GristAPI';
export * from './GristTable';
export * from './ImportSourceAPI';
export * from './StorageAPI';
export * from './RenderOptions';

import {IRpcLogger, Rpc} from 'grain-rpc';

export const rpc: Rpc = new Rpc({logger: createRpcLogger()});

export const api = rpc.getStub<GristAPI>(RPC_GRISTAPI_INTERFACE, checkers.GristAPI);
export const coreDocApi = rpc.getStub<GristDocAPI>('GristDocAPI@grist', checkers.GristDocAPI);
export const viewApi = rpc.getStub<GristView>('GristView', checkers.GristView);

export const docApi: GristDocAPI & GristView = {
  ...coreDocApi,
  ...viewApi,

  // Change fetchSelectedTable() to decode data by default, replacing e.g. ['D', timestamp] with
  // a moment date. New option `keepEncoded` skips the decoding step.
  async fetchSelectedTable(options: {keepEncoded?: boolean} = {}) {
    const table = await viewApi.fetchSelectedTable();
    return options.keepEncoded ? table :
      mapValues<any[], any[]>(table, (col) => col.map(decodeObject));
  },

  // Change fetchSelectedRecord() to decode data by default, replacing e.g. ['D', timestamp] with
  // a moment date. New option `keepEncoded` skips the decoding step.
  async fetchSelectedRecord(rowId: number, options: {keepEncoded?: boolean} = {}) {
    const rec = await viewApi.fetchSelectedRecord(rowId);
    return options.keepEncoded ? rec :
      mapValues(rec, decodeObject);
  }
};

export const on = rpc.on.bind(rpc);

// For custom widgets, add a handler that will be called whenever the
// row with the cursor changes - either by switching to a different row, or
// by some value within the row potentially changing.  Handler may
// in the future be called with null if the cursor moves away from
// any row.
// TODO: currently this will be called even if the content of a different row
// changes.
export function onRecord(callback: (data: RowRecord | null) => unknown) {
  on('message', async function(msg) {
    if (!msg.tableId || !msg.rowId) { return; }
    const rec = await docApi.fetchSelectedRecord(msg.rowId);
    callback(rec);
  });
}

// For custom widgets, add a handler that will be called whenever the
// selected records change.  Handler will be called with a list of records.
export function onRecords(callback: (data: RowRecord[]) => unknown) {
  on('message', async function(msg) {
    if (!msg.tableId || !msg.dataChange) { return; }
    const data = await docApi.fetchSelectedTable();
    if (!data.id) { return; }
    const rows: RowRecord[] = [];
    for (let i = 0; i < data.id.length; i++) {
      const row: RowRecord = {id: data.id[i]};
      for (const key of Object.keys(data)) {
        row[key] = data[key][i];
      }
      rows.push(row);
    }
    callback(rows);
  });
}

/**
 * Calling `addImporter(...)` adds a safeBrowser importer. It is a short-hand for forwarding calls
 * to an `ImportSourceAPI` implementation registered in the file at `path`. It takes care of
 * creating the stub, registering an implementation that renders the file, forward the call and
 * dispose the view properly. If `mode` is `'inline'` embeds the view in the import modal, ohterwise
 * renders fullscreen.
 *
 * Notes: it assumes that file at `path` registers an `ImportSourceAPI` implementation under
 * `name`. Calling `addImporter(...)` from another component than a `safeBrowser` component is not
 * currently supported.
 *
 */
export async function addImporter(name: string, path: string, mode: 'fullscreen' | 'inline', options?: RenderOptions) {
  // checker is omitterd for implementation because call was alredy checked by grist.
  rpc.registerImpl<InternalImportSourceAPI>(name, {
    async getImportSource(target: RenderTarget): Promise<ImportSource|undefined> {
      const procId = await api.render(path, mode === 'inline' ? target : 'fullscreen', options);
      try {
        // stubName for the interface `name` at forward destination `path`
        const stubName = `${name}@${path}`;
        // checker is omitted in stub because call will be checked just after in grist.
        return await rpc.getStub<ImportSourceAPI>(stubName).getImportSource();
      } finally {
        await api.dispose(procId);
      }
    }
  });
}

/**
 * Declare that a component is prepared to receive messages from the outside world.
 * Grist will not attempt to communicate with it until this method is called.
 */
export function ready(): void {
  rpc.processIncoming();
  void rpc.sendReadyMessage();
}

function getPluginPath(location: Location) {
  return location.pathname.replace(/^\/plugins\//, '');
}

if (typeof window !== 'undefined') {
  // Window or iframe.
  const preloadWindow: any = window;
  if (preloadWindow.isRunningUnderElectron) {
    rpc.setSendMessage(msg => preloadWindow.sendToHost(msg));
    preloadWindow.onGristMessage((data: any) => rpc.receiveMessage(data));
  } else {
    rpc.setSendMessage(msg => window.parent.postMessage(msg, "*"));
    window.onmessage = (e: MessageEvent) => rpc.receiveMessage(e.data);
  }

  // Allow outer Grist application to trigger printing. This is similar to using
  // iframe.contentWindow.print(), but that call does not work cross-domain.
  rpc.registerFunc("print", () => window.print());

} else if (typeof process === 'undefined') {
  // Web worker. We can't really bring in the types for WebWorker (available with --lib flag)
  // without conflicting with a regular window, so use just use `self as any` here.
  self.onmessage = (e: MessageEvent) => rpc.receiveMessage(e.data);
  rpc.setSendMessage((mssg: any) => (self as any).postMessage(mssg));
} else if (typeof process.send !== 'undefined') {
  // Forked ChildProcess of node or electron.
  // sendMessage callback returns void 0 because rpc process.send returns a boolean and rpc
  // expecting void|Promise interprets truthy values as Promise which cause failure.
  rpc.setSendMessage((data) => { process.send!(data); });
  process.on('message', (data: any) => rpc.receiveMessage(data));
  process.on('disconnect', () => { process.exit(0); });
} else {
  // Not a recognized environment, perhaps plain nodejs run independently of Grist, or tests
  // running under mocha. For now, we only provide a disfunctional implementation. It allows
  // plugins to call methods like registerFunction() without failing, so that plugin code may be
  // imported, but the methods don't do anything useful.
  rpc.setSendMessage((data) => { return; });
}

function createRpcLogger(): IRpcLogger {
  let prefix: string;
  if (typeof window !== 'undefined') {
    prefix = `PLUGIN VIEW ${getPluginPath(window.location)}:`;
  } else if (typeof process === 'undefined') {
    prefix = `PLUGIN VIEW ${getPluginPath(self.location)}:`;
  } else if (typeof process.send !== 'undefined') {
    prefix = `PLUGIN NODE ${process.env.GRIST_PLUGIN_PATH || "<unset-plugin-id>"}:`;
  } else {
    return {};
  }
  return {
    info(msg: string) { console.log("%s %s", prefix, msg); },
    warn(msg: string) { console.warn("%s %s", prefix, msg); },
  };
}
