import {
  AttachmentStoreDocInfo,
  DocPoolId,
  getDocPoolIdFromDocInfo,
  IAttachmentStore
} from "app/server/lib/AttachmentStore";
import { AttachmentStoreId, IAttachmentStoreProvider } from "app/server/lib/AttachmentStoreProvider";
import { checksumFileStream } from "app/server/lib/checksumFile";
import { DocStorage } from "app/server/lib/DocStorage";
import log from "app/server/lib/log";
import { Readable } from "node:stream";

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
    super('Attempted to access a file store, but AttachmentFileManager was initialized without store access');
  }
}

export class StoreNotAvailableError extends Error {
  public readonly storeId: AttachmentStoreId;

  constructor(storeId: AttachmentStoreId) {
    super(`Store '${storeId}' is not a valid and available store`);
    this.storeId = storeId;
  }
}

/**
 * Instantiated on a per-document to basis to provide a document with access to its attachments.
 * Handles attachment uploading / fetching, as well as trying to ensure consistency with the local document database,
 * which tracks attachments and where they're stored.
 *
 * This class should prevent the document code from having to worry about accessing the underlying stores.
 */
export class AttachmentFileManager implements IAttachmentFileManager {
  // _docPoolId is a critical point for security. Documents with a common pool id can access each others' attachments.
  private readonly _docPoolId: DocPoolId | null;
  private readonly _docName: string;

  /**
   * @param _docStorage - Storage of this manager's document.
   * @param _storeProvider - Allows instantiating of stores. Should be provided except in test scenarios.
   * @param _docInfo - The document this manager is for. Should be provided except in test scenarios.
   */
  constructor(
    private _docStorage: DocStorage,
    private _storeProvider: IAttachmentStoreProvider | undefined,
    _docInfo: AttachmentStoreDocInfo | undefined,
  ) {
    this._docName = _docStorage.docName;
    this._docPoolId = _docInfo ? getDocPoolIdFromDocInfo(_docInfo) : null;
  }

  public async addFile(
    storeId: AttachmentStoreId | undefined,
    fileExtension: string,
    fileData: Buffer
  ): Promise<AddFileResult> {
    const fileIdent = await this._getFileIdentifier(fileExtension, Readable.from(fileData));
    if (storeId === undefined) {
      log.info(`AttachmentFileManager adding ${fileIdent} to local document storage in '${this._docName}'`);
      return this._addFileToLocalStorage(fileIdent, fileData);
    }
    const store = await this._getStore(storeId);
    if (!store) {
      throw new StoreNotAvailableError(storeId);
    }
    log.info(`AttachmentFileManager adding ${fileIdent} to attachment store '${store?.id}', pool ${this._docPoolId}`);
    return this._addFileToAttachmentStore(store, fileIdent, fileData);
  }

  public async getFileData(fileIdent: string): Promise<Buffer | null> {
    const fileInfo = await this._docStorage.getFileInfo(fileIdent);
    if (!fileInfo) {
      log.info(`AttachmentFileManager file ${fileIdent} does not exist in doc '${this._docName}'`);
      return null;
    }
    if (!fileInfo.storageId) {
      log.info(`AttachmentFileManager retrieving ${fileIdent} from document storage in ${this._docName}`);
      return fileInfo.data;
    }
    const store = await this._getStore(fileInfo.storageId);
    if (!store) {
      throw new StoreNotAvailableError(fileInfo.storageId);
    }
    log.info(
      `AttachmentFileManager retrieving ${fileIdent} from attachment store '${store?.id}', pool ${this._docPoolId}`
    );
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
