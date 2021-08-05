import {ActionGroup} from 'app/common/ActionGroup';
import {TableDataAction} from 'app/common/DocActions';
import {Role} from 'app/common/roles';
import {StringUnion} from 'app/common/StringUnion';
import {FullUser} from 'app/common/UserAPI';

// Possible flavors of items in a list of documents.
export type DocEntryTag = ''|'sample'|'invite'|'shared';

export const OpenDocMode = StringUnion(
  'default',  // open doc with user's maximal access level
  'view',     // open doc limited to view access (if user has at least that level of access)
  'fork',     // as for 'view', but suggest a fork on any attempt to edit - the client will
              // enable the editing UI experience and trigger a fork on any edit.
);
export type OpenDocMode = typeof OpenDocMode.type;

/**
 * Represents an entry in the DocList.
 */
export interface DocEntry {
  docId?: string;       // Set for shared docs and invites
  name: string;
  mtime?: Date;
  size?: number;
  tag: DocEntryTag;
  senderName?: string;
  senderEmail?: string;
}

export interface DocCreationInfo {
  id: string;
  title: string;
}

/**
 * This documents the members of the structure returned when a local
 * grist document is opened.
 */
export interface OpenLocalDocResult {
  docFD: number;
  clientId: string;  // the docFD is meaningful only in the context of this session
  doc: {[tableId: string]: TableDataAction};
  log: ActionGroup[];
  recoveryMode?: boolean;
  userOverride?: UserOverride;
}

export interface UserOverride {
  user: FullUser|null;
  access: Role|null;
}

export interface DocListAPI {
  /**
   * Returns a all known Grist documents and document invites to show in the doc list.
   */
  getDocList(): Promise<{docs: DocEntry[], docInvites: DocEntry[]}>;

  /**
   * Creates a new document, fetches it, and adds a table to it. Returns its name.
   */
  createNewDoc(): Promise<string>;

  /**
   * Makes a copy of the given sample doc. Returns the name of the new document.
   */
  importSampleDoc(sampleDocName: string): Promise<string>;

  /**
   * Processes an upload, containing possibly multiple files, to create a single new document, and
   * returns the new document's name.
   */
  importDoc(uploadId: number): Promise<string>;

  /**
   * Deletes a Grist document. Returns the name of the deleted document. If `deletePermanently` is
   * true, the doc is deleted permanently rather than just moved to the trash.
   */
  deleteDoc(docName: string, deletePermanently: boolean): Promise<string>;

  /**
   * Renames a document.
   */
  renameDoc(oldName: string, newName: string): Promise<void>;

  /**
   * Opens a document, loads it, subscribes to its userAction events, and returns its metadata.
   */
  openDoc(userDocName: string, openMode?: OpenDocMode,
          linkParameters?: Record<string, string>): Promise<OpenLocalDocResult>;
}
