import { joinKeySegments } from "app/server/lib/ExternalStorage";
import { MinIOExternalStorage } from "app/server/lib/MinIOExternalStorage";
import * as fse from "fs-extra";
import * as stream from "node:stream";
import * as path from "path";

export type DocPoolId = string;
type FileId = string;


// Minimum required info from a document
// Compatible with Document entity for ease of use
export interface AttachmentStoreDocInfo {
  id: string;
  trunkId: string | null | undefined;
}


/**
 * Gets the correct pool id for a given document, given the document's id and trunk id.
 * Avoids other areas of the codebase having to understand how documents are mapped to pools.
 * This is a key security point - documents which share a pool can access each others' attachments.
 * Therefore documents with different security domains (e.g from different teams) need to be sure not to share
 * a pool.
 * @param {string} docId - Document's ID
 * @param {string | null} trunkId - Document's Trunk ID (if it's a fork)
 * @returns {string} - ID of the pool the attachments will be stored in.
 */
export function getDocPoolIdFromDocInfo(docInfo: AttachmentStoreDocInfo): string {
  return docInfo.trunkId ?? docInfo.id;
}

/**
 * Provides access to external storage, specifically for storing attachments.
 *
 * Attachments are stored in a "Document Pool", which is used to manage the attachments' lifecycle.
 * Typically a document's trunk id should be used for this if available, or the document's id if it isn't.
 *
 * This is a general-purpose interface that should abstract over many different storage providers,
 * so shouldn't have methods which rely on one the features of one specific provider.
 *
 * This is distinct from `ExternalStorage`, in that it's more generic and doesn't support versioning.
 */
export interface IAttachmentStore {
  readonly id: string;

  // Check if attachment exists in the store.
  exists(docPoolId: DocPoolId, fileId: FileId): Promise<boolean>;

  // Upload attachment to the store.
  upload(docPoolId: DocPoolId, fileId: FileId, fileData: Buffer): Promise<void>;

  // Download attachment to an in-memory buffer
  download(docPoolId: DocPoolId, fileId: FileId): Promise<Buffer>;

  // Remove attachments for all documents in the given document pool.
  removePool(docPoolId: DocPoolId): Promise<void>;

  // Close the storage object.
  close(): Promise<void>;
}

export class AttachmentStoreCreationError extends Error {
  constructor(storeBackend: string, storeId: string, context?: string) {
    const formattedContext = context ? `: ${context}` : "";
    super(`Unable to create ${storeBackend} store '${storeId}'` + formattedContext);
  }
}

// TODO - Can make this generic if *Stream methods become part of an interface.
// TODO - Put this into another file.
export class MinIOAttachmentStore implements IAttachmentStore {
  constructor(
    public id: string,
    private _storage: MinIOExternalStorage,
    private _prefixParts: string[]
  ) {

  }

  public exists(docPoolId: string, fileId: string): Promise<boolean> {
    return this._storage.exists(this._getKey(docPoolId, fileId));
  }

  public async upload(docPoolId: string, fileId: string, fileData: Buffer): Promise<void> {
    await this._storage.uploadStream(this._getKey(docPoolId, fileId), stream.Readable.from(fileData));
  }

  public async download(docPoolId: string, fileId: string): Promise<Buffer> {
    // Need to read a stream into a buffer - this is a bit dirty, but does the job.
    const chunks: Buffer[] = [];
    let buffer: Buffer | undefined = undefined;
    const readStream = new stream.PassThrough();
    const readComplete = new Promise<void>((resolve, reject) => {
      readStream.on("data", (data) => chunks.push(data));
      readStream.on("end", () => { buffer = Buffer.concat(chunks); resolve(); });
      readStream.on("error", (err) => { reject(err); });
    });
    await this._storage.downloadStream(this._getKey(docPoolId, fileId), readStream);
    // Shouldn't need to wait for PassThrough stream to finish, but doing it in case it somehow finishes later than
    // downloadStream resolves.
    await readComplete;

    // If an error happens, it's thrown by the above `await`. This should safely be a buffer.
    return buffer!;
  }

  public async removePool(docPoolId: string): Promise<void> {
    await this._storage.removeAllWithPrefix(this._getPoolPrefix(docPoolId));
  }

  public async close(): Promise<void> {
    await this._storage.close();
  }

  private _getPoolPrefix(docPoolId: string): string {
    return joinKeySegments([...this._prefixParts, docPoolId]);
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

  public async upload(docPoolId: DocPoolId, fileId: FileId, fileData: Buffer): Promise<void> {
    const filePath = this._createPath(docPoolId, fileId);
    await fse.ensureDir(path.dirname(filePath));
    await fse.writeFile(filePath, fileData);
  }

  public async download(docPoolId: DocPoolId, fileId: FileId): Promise<Buffer> {
    return fse.readFile(this._createPath(docPoolId, fileId));
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
