import {DocEntry} from 'app/common/DocListAPI';
import {DocSnapshots} from 'app/common/DocSnapshot';
import {DocReplacementOptions} from 'app/common/UserAPI';

export interface IDocStorageManager {
  getPath(docName: string): string;
  getSampleDocPath(sampleDocName: string): string|null;
  getCanonicalDocName(altDocName: string): Promise<string>;

  // This method must not be called for the same docName twice in parallel.
  // In the current implementation, it is called in the context of an
  // AsyncCreate[docName].
  prepareLocalDoc(docName: string): Promise<boolean>;
  prepareToCreateDoc(docName: string): Promise<void>;
  prepareFork(srcDocName: string, destDocName: string): Promise<void>;

  listDocs(): Promise<DocEntry[]>;
  deleteDoc(docName: string, deletePermanently?: boolean): Promise<void>;
  renameDoc(oldName: string, newName: string): Promise<void>;
  makeBackup(docName: string, backupTag: string): Promise<string>;
  showItemInFolder(docName: string): Promise<void>;
  closeStorage(): Promise<void>;
  closeDocument(docName: string): Promise<void>;
  // Mark document as needing a backup (due to edits, migrations, etc).
  // If reason is set to 'edit' the user-facing timestamp on the document should be updated.
  markAsChanged(docName: string, reason?: 'edit'): void;
  testReopenStorage(): void;                // restart storage during tests
  addToStorage(docName: string): Promise<void>;  // add a new local document to storage
  prepareToCloseStorage(): void;            // speed up sync with remote store
  getCopy(docName: string): Promise<string>;  // get an immutable copy of a document

  flushDoc(docName: string): Promise<void>; // flush a document to persistent storage
  // If skipMetadataCache is set, then any caching of snapshots lists should be skipped.
  // Metadata may not be returned in this case.
  getSnapshots(docName: string, skipMetadataCache?: boolean): Promise<DocSnapshots>;
  removeSnapshots(docName: string, snapshotIds: string[]): Promise<void>;
  replace(docName: string, options: DocReplacementOptions): Promise<void>;
}
