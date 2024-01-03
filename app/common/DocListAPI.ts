import {MinimalActionGroup} from 'app/common/ActionGroup';
import {TableDataAction} from 'app/common/DocActions';
import {FilteredDocUsageSummary} from 'app/common/DocUsage';
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
 * A collection of options for opening documents on behalf of
 * a user in special circumstances we have accumulated. This is
 * specifically for the Grist front end, when setting up a websocket
 * connection to a doc worker willing to serve a document. Remember
 * that the front end is untrusted and any information it passes should
 * be treated as user input.
 */
export interface OpenDocOptions {
  /**
   * Users may now access a single specific document (with a given docId)
   * using distinct keys for which different access rules apply. When opening
   * a document, the ID used in the URL may now be passed along so
   * that the back-end can grant appropriate access.
   */
  originalUrlId?: string;

  /**
   * Access to a document by a user may be voluntarily limited to
   * read-only, or to trigger forking on edits.
   */
  openMode?: OpenDocMode;

  /**
   * Access to a document may be modulated by URL parameters.
   * These parameters become an attribute of the user, for
   * access control.
   */
  linkParameters?: Record<string, string>;
}

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
  log: MinimalActionGroup[];
  recoveryMode?: boolean;
  userOverride?: UserOverride;
  docUsage?: FilteredDocUsageSummary;
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
  openDoc(userDocName: string, options?: OpenDocOptions): Promise<OpenLocalDocResult>;
}
