import * as path from "path";
import * as fse from "fs-extra";

export type DocPoolId = string;
type FileId = string;


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
