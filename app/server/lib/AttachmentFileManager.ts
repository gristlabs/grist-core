import { DocStorage } from "app/server/lib/DocStorage";
import { checksumFileStream } from "app/server/lib/checksumFile";
import { Readable } from "node:stream";
import {
  DocPoolId, IAttachmentStore
} from "app/server/lib/AttachmentStore";
import {
  AttachmentStoreId,
  IAttachmentStoreProvider
} from "app/server/lib/AttachmentStoreProvider";

export interface IAttachmentFileManager {
  addFile(storeId: AttachmentStoreId, fileExtension: string, fileData: Buffer): Promise<AddFileResult>;
  getFileData(fileIdent: string): Promise<Buffer | null>;
}

export interface AddFileResult {
  fileIdent: string;
  isNewFile: boolean;
}

export class StoresNotConfiguredError extends Error {
  constructor() {
    super('Attempted to access a file store, but AttachmentFileManager was initialised without store access');
  }
}

export class StoreNotAvailableError extends Error {
  public readonly storeId: AttachmentStoreId;

  constructor(storeId: AttachmentStoreId) {
    super(`Store '${storeId}' is not a valid and available store`);
    this.storeId = storeId;
  }
}

// Minimum required info from a document
// Compatible with Document entity for ease of use
interface DocInfo {
  id: string;
  trunkId: string | null | undefined;
}

/**
 * Provides management of a specific document's attachments.
 */
export class AttachmentFileManager implements IAttachmentFileManager {
  private readonly _docPoolId: DocPoolId | null;

  /**
   * @param _docStorage - Storage of this manager's document.
   * @param _storeProvider - Allows instantiating of stores. Should be provided except in test scenarios.
   * @param _docInfo - The document this manager is for. Should be provided except in test scenarios.
   */
  constructor(
    private _docStorage: DocStorage,
    // TODO - Pull these into a "StoreAccess" module-private type
    private _storeProvider: IAttachmentStoreProvider | undefined,
    _docInfo: DocInfo | undefined,
  ) {
    this._docPoolId = _docInfo?.trunkId ?? _docInfo?.id ?? null;
  }

  public async addFile(
    storeId: AttachmentStoreId | undefined,
    fileExtension: string,
    fileData: Buffer
  ): Promise<AddFileResult> {
    const fileIdent = await this._getFileIdentifier(fileExtension, Readable.from(fileData));
    if (storeId === undefined) {
      return this._addFileToLocalStorage(fileIdent, fileData);
    }
    const store = await this._getStore(storeId);
    if (!store) {
      throw new StoreNotAvailableError(storeId);
    }
    return this._addFileToAttachmentStore(store, fileIdent, fileData);
  }

  public async getFileData(fileIdent: string): Promise<Buffer | null> {
    const fileInfo = await this._docStorage.getFileInfo(fileIdent);
    if (!fileInfo) { return null; }
    if (!fileInfo.storageId) {
      return fileInfo.data;
    }
    const store = await this._getStore(fileInfo.storageId);
    if (!store) {
      throw new StoreNotAvailableError(fileInfo.storageId);
    }
    return this._getFileDataFromAttachmentStore(store, fileIdent);
  }

  private async _addFileToLocalStorage(fileIdent: string, fileData: Buffer): Promise<AddFileResult> {
    const isNewFile = await this._docStorage.findOrAttachFile(fileIdent, fileData);

    return {
      fileIdent,
      isNewFile,
    };
  }

  private async _getStore(storeId: AttachmentStoreId): Promise<IAttachmentStore | null> {
    if (!this._storeProvider) {
      throw new StoresNotConfiguredError();
    }
    return this._storeProvider.getStore(storeId);
  }

  private _getDocPoolId(): string {
    if (!this._docPoolId) {
      throw new StoresNotConfiguredError();
    }
    return this._docPoolId;
  }

  private async _getFileIdentifier(fileExtension: string, fileData: Readable): Promise<string> {
    const checksum = await checksumFileStream(fileData);
    return `${checksum}${fileExtension}`;
  }

  private async _addFileToAttachmentStore(store: IAttachmentStore, fileIdent: string, fileData: Buffer): Promise<AddFileResult> {
    const isNewFile = await this._docStorage.findOrAttachFile(fileIdent, undefined, store.id);

    // Verify the file exists in the store. This allows for a second attempt to correct a failed upload.
    const existsInRemoteStorage = !isNewFile && await store.exists(this._getDocPoolId(), fileIdent);

    if (!isNewFile && existsInRemoteStorage) {
      return {
        fileIdent,
        isNewFile: false,
      };
    }

    // Possible issue if this upload fails - we have the file tracked in the document, but not available in the store.
    // TODO - Decide if we keep an entry in SQLite after an upload error or not. Probably not?
    await store.upload(this._getDocPoolId(), fileIdent, fileData);

    // TODO - Confirm in doc storage that it's successfully uploaded? Need to decide how to handle a failed upload.
    return {
      fileIdent,
      isNewFile,
    };
  }

  private async _getFileDataFromAttachmentStore(store: IAttachmentStore, fileIdent: string): Promise<Buffer> {
    return await store.download(this._getDocPoolId(), fileIdent);
  }
}
