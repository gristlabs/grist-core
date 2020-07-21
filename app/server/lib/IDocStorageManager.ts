import {DocEntry} from 'app/common/DocListAPI';
import {DocReplacementOptions} from 'app/common/UserAPI';
import {OptDocSession} from 'app/server/lib/DocSession';
import {DocSnapshots} from 'app/server/lib/DocSnapshots';

export interface IDocStorageManager {
  getPath(docName: string): string;
  getSampleDocPath(sampleDocName: string): string|null;
  getCanonicalDocName(altDocName: string): Promise<string>;

  // This method must not be called for the same docName twice in parallel.
  // In the current implementation, it is called in the context of an
  // AsyncCreate[docName].
  prepareLocalDoc(docName: string, docSession: OptDocSession): Promise<boolean>;

  listDocs(): Promise<DocEntry[]>;
  deleteDoc(docName: string, deletePermanently?: boolean): Promise<void>;
  renameDoc(oldName: string, newName: string): Promise<void>;
  makeBackup(docName: string, backupTag: string): Promise<string>;
  showItemInFolder(docName: string): Promise<void>;
  closeStorage(): Promise<void>;
  closeDocument(docName: string): Promise<void>;
  markAsChanged(docName: string): void;  // document needs a backup (edits, migrations, etc)
  markAsEdited(docName: string): void;   // document was edited by a user

  testReopenStorage(): void;                // restart storage during tests
  addToStorage(docName: string): void;      // add a new local document to storage
  prepareToCloseStorage(): void;            // speed up sync with remote store
  getCopy(docName: string): Promise<string>;  // get an immutable copy of a document

  flushDoc(docName: string): Promise<void>; // flush a document to persistent storage

  getSnapshots(docName: string): Promise<DocSnapshots>;
  replace(docName: string, options: DocReplacementOptions): Promise<void>;
}
