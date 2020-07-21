/**
 * API definitions for ImportSource plugins.
 */

import { GristTable } from './GristTable';

export interface ImportSourceAPI {
  /**
   * Returns a promise that resolves to an `ImportSource` which is then passed for import to the
   * import modal dialog. `undefined` interrupts the workflow and prevent the modal from showing up,
   * but not an empty list of `ImportSourceItem`. Which is a valid import source and is used in
   * cases where only options are to be sent to an `ImportProcessAPI` implementation.
   */
  getImportSource(): Promise<ImportSource|undefined>;
}

export interface ImportProcessorAPI {
  processImport(source: ImportSource): Promise<GristTable[]>;
}

export interface FileContent {
  content: any;
  name: string;
}

export interface FileListItem {
  kind: "fileList";
  // TODO: there're might be a better way to send file content. In particular for electron where
  // file will then be send from client to server where it shouldn't be really. An idea could be to
  // expose something similar to `client/lib/upload.ts` to let plugins create upload entries, and
  // then send only uploads ids over the rpc.
  files: FileContent[];
}

export interface URL {
  kind: "url";
  url: string;
}

export interface ImportSource {
  item: FileListItem | URL;

  /**
   * The options are only passed within this plugin, nothing else needs to know how they are
   * serialized. Using JSON.stringify/JSON.parse is a simple approach.
   */
  options?: string|Buffer;

  /**
   * The short description that shows in the import dialog after source have been selected.
   */
  description?: string;
}
