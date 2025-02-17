import {
  ExternalStorage,
  joinKeySegments,
} from 'app/server/lib/ExternalStorage';
import * as fse from 'fs-extra';
import * as stream from 'node:stream';
import * as path from 'path';

export type DocPoolId = string;
type FileId = string;


// Minimum document info needed to know which document pool to use.
// Compatible with Document entity for ease of use
export interface AttachmentStoreDocInfo {
  id: string;
  // We explicitly make this a union type instead of making the attribute optional because the
  // programmer must make a conscious choice to mark it as null or undefined, not merely omit it.
  // Omission could easily result in invalid behaviour.
  trunkId: string | null | undefined;
}

/**
 * Gets the correct pool id for a given document, given the document's id and trunk id.
 *
 * Attachments are stored in a "Document Pool", which is used to manage the attachments' lifecycle.
 * Document pools are shared between snapshots and forks, but not between documents. This provides
 * quick forking and snapshotting (not having to copy attachments), while avoiding more complex
 * systems like reference tracking.
 *
 * Generally, the pool id of a document should be its trunk id if available (because it's a fork),
 * or the document's id (if it isn't a fork).
 *
 * This means that attachments need copying to a new pool when a document is copied.
 * Avoids other areas of the codebase having to understand how documents are mapped to pools.
 *
 * This is a key security measure, as only a specific document and its forks can access its
 * attachments. This helps prevent malicious documents being uploaded, which might attempt to
 * access another user's attachments.
 *
 * Therefore, it is CRITICAL that documents with different security domains (e.g from different
 * teams) do not share a document pool.
 * @param {AttachmentStoreDocInfo} docInfo - Document details needed to calculate the document
 *   pool.
 * @returns {string} - ID of the pool the attachments will be stored in.
 */
export function getDocPoolIdFromDocInfo(docInfo: AttachmentStoreDocInfo): string {
  return docInfo.trunkId ?? docInfo.id;
}

/**
 * Provides access to external storage, specifically for storing attachments. Each store represents
 * a specific location to store attachments, e.g. "/srv/grist/attachments" on the filesystem.
 *
 * This is a general-purpose interface that should abstract over many different storage providers,
 * so shouldn't have methods which rely on one the features of one specific provider.
 *
 * `IAttachmentStore` is distinct from `ExternalStorage` as it's specific to attachments, and can
 * therefore not concern itself with some features ExternalStorage has (e.g versioning). This means
 * it can present a more straightforward interface for components which need to access attachment
 * files.
 *
 * A document pool needs specifying for all store operations, which should be calculated with
 * `getDocPoolIdFromDocInfo` See {@link getDocPoolIdFromDocInfo} for more details.
 */
export interface IAttachmentStore {
  // Universally unique id, such that no two Grist installations should have the same store ids, if
  // they're for different stores. This allows for explicit detection of unavailable stores.
  readonly id: string;

  // Check if attachment exists in the store.
  exists(docPoolId: DocPoolId, fileId: FileId): Promise<boolean>;

  // Upload attachment to the store.
  upload(docPoolId: DocPoolId, fileId: FileId, fileData: stream.Readable): Promise<void>;

  // Download attachment to an in-memory buffer.
  // It's preferable to accept an output stream as a parameter, as it simplifies attachment store
  // implementation and gives them control over local buffering.
  download(docPoolId: DocPoolId, fileId: FileId, outputStream: stream.Writable): Promise<void>;

  // Remove attachment from the store
  delete(docPoolId: DocPoolId, fileId: FileId): Promise<void>;

  // Remove attachments for all documents in the given document pool.
  removePool(docPoolId: DocPoolId): Promise<void>;

  // Close the storage object.
  close(): Promise<void>;
}

export class InvalidAttachmentExternalStorageError extends Error {
  constructor(storeId: string, context?: string) {
    const formattedContext = context ? `: ${context}` : "";
    super(`External Storage for store '${storeId}' is invalid` + formattedContext);
  }
}

export class AttachmentStoreCreationError extends Error {
  constructor(storeBackend: string, storeId: string, context?: string) {
    const formattedContext = context ? `: ${context}` : "";
    super(`Unable to create ${storeBackend} store '${storeId}'` + formattedContext);
  }
}

export interface ExternalStorageSupportingAttachments extends ExternalStorage {
  uploadStream: NonNullable<ExternalStorage['uploadStream']>;
  downloadStream: NonNullable<ExternalStorage['downloadStream']>;
  removeAllWithPrefix: NonNullable<ExternalStorage['removeAllWithPrefix']>;
}

export function storageSupportsAttachments(storage: ExternalStorage): storage is ExternalStorageSupportingAttachments {
  return Boolean(storage.uploadStream && storage.downloadStream && storage.removeAllWithPrefix);
}

export class ExternalStorageAttachmentStore implements IAttachmentStore {
  constructor(
    public id: string,
    private _storage: ExternalStorageSupportingAttachments,
  ) {}

  public exists(docPoolId: string, fileId: string): Promise<boolean> {
    return this._storage.exists(this._getKey(docPoolId, fileId));
  }

  public async upload(docPoolId: string, fileId: string, fileData: stream.Readable): Promise<void> {
    await this._storage.uploadStream(this._getKey(docPoolId, fileId), fileData);
  }

  public async download(docPoolId: string, fileId: string, outputStream: stream.Writable): Promise<void> {
    await this._storage.downloadStream(this._getKey(docPoolId, fileId), outputStream);
  }

  public async delete(docPoolId: string, fileId: string): Promise<void> {
    await this._storage.remove(this._getKey(docPoolId, fileId));
  }

  public async removePool(docPoolId: string): Promise<void> {
    await this._storage.removeAllWithPrefix(this._getPoolPrefix(docPoolId));
  }

  public async close(): Promise<void> {
    await this._storage.close();
  }

  private _getPoolPrefix(docPoolId: string): string {
    return docPoolId;
  }

  private _getKey(docPoolId: string, fileId: string): string {
    return joinKeySegments([this._getPoolPrefix(docPoolId), fileId]);
  }
}

export class FilesystemAttachmentStore implements IAttachmentStore {
  constructor(public readonly id: string, private _rootFolderPath: string) {
  }

  public async exists(docPoolId: DocPoolId, fileId: FileId): Promise<boolean> {
    return fse.pathExists(this._createPath(docPoolId, fileId))
      .catch(() => false);
  }

  public async upload(docPoolId: DocPoolId, fileId: FileId, fileData: stream.Readable): Promise<void> {
    const filePath = this._createPath(docPoolId, fileId);
    await fse.ensureDir(path.dirname(filePath));
    const writeStream = fse.createWriteStream(filePath);
    await stream.promises.pipeline(
      fileData,
      writeStream,
    );
  }

  public async download(docPoolId: DocPoolId, fileId: FileId, output: stream.Writable): Promise<void> {
    await stream.promises.pipeline(
      fse.createReadStream(this._createPath(docPoolId, fileId)),
      output,
    );
  }

  public async delete(docPoolId: string, fileId: string): Promise<void> {
    await fse.remove(this._createPath(docPoolId, fileId));
  }

  public async removePool(docPoolId: DocPoolId): Promise<void> {
    await fse.remove(this._createPath(docPoolId));
  }

  public async close(): Promise<void> {
    // Not needed here, no resources held.
  }

  private _createPath(docPoolId: DocPoolId, fileId: FileId = ""): string {
    return path.join(this._rootFolderPath, docPoolId, fileId);
  }
}
