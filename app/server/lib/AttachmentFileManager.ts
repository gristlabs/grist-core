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
import { LogMethods } from "app/server/lib/LogMethods";
import { MemoryWritableStream } from "app/server/utils/MemoryWritableStream";
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

export class MissingAttachmentError extends Error {
  public readonly fileIdent: string;

  constructor(fileIdent: string) {
    super(`Attachment file '${fileIdent}' could not be found in this document`);
    this.fileIdent = fileIdent;
  }
}

export class AttachmentRetrievalError extends Error {
  public readonly storeId: AttachmentStoreId;
  public readonly fileId: string;

  constructor(storeId: AttachmentStoreId, fileId: string, cause?: any) {
    const causeError = cause instanceof Error ? cause : undefined;
    const causeDescriptor = causeError ? `: ${cause.message}` : '';
    super(`Unable to retrieve '${fileId}' from '${storeId}'${causeDescriptor}`);
    this.storeId = storeId;
    this.fileId = fileId;
    this.cause = causeError;
  }
}


interface AttachmentFileManagerLogInfo {
  fileIdent?: string;
  storeId?: string | null;
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
  private _log = new LogMethods(
    "AttachmentFileManager ",
    (logInfo: AttachmentFileManagerLogInfo) => this._getLogMeta(logInfo)
  );

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
    return this._addFile(storeId, fileIdent, fileData);
  }

  public async _addFile(
    storeId: AttachmentStoreId | undefined,
    fileIdent: string,
    fileData: Buffer
  ): Promise<AddFileResult> {
    this._log.info({ fileIdent, storeId }, `adding file to ${storeId ? "external" : "document"} storage`);
    if (storeId === undefined) {
      return this._addFileToLocalStorage(fileIdent, fileData);
    }
    const store = await this._getStore(storeId);
    if (!store) {
      this._log.info({ fileIdent, storeId }, "tried to fetch attachment from an unavailable store");
      throw new StoreNotAvailableError(storeId);
    }
    return this._addFileToAttachmentStore(store, fileIdent, fileData);
  }

  public async getFileData(fileIdent: string): Promise<Buffer> {
    const fileInfo = await this._docStorage.getFileInfo(fileIdent);
    if (!fileInfo) {
      this._log.error({ fileIdent }, "cannot find file metadata in document");
      throw new MissingAttachmentError(fileIdent);
    }
    this._log.debug(
      { fileIdent, storeId: fileInfo.storageId },
      `fetching attachment from ${fileInfo.storageId ? "external" : "document "} storage`
    );
    if (!fileInfo.storageId) {
      return fileInfo.data;
    }
    const store = await this._getStore(fileInfo.storageId);
    if (!store) {
      this._log.warn({ fileIdent, storeId: fileInfo.storageId }, `unable to retrieve file, store is unavailable`);
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

  private async _addFileToAttachmentStore(
    store: IAttachmentStore, fileIdent: string, fileData: Buffer
  ): Promise<AddFileResult> {
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
    await store.upload(this._getDocPoolId(), fileIdent, Readable.from(fileData));

    // TODO - Confirm in doc storage that it's successfully uploaded? Need to decide how to handle a failed upload.
    return {
      fileIdent,
      isNewFile,
    };
  }

  private async _getFileDataFromAttachmentStore(store: IAttachmentStore, fileIdent: string): Promise<Buffer> {
    try {
      const outputStream = new MemoryWritableStream();
      await store.download(this._getDocPoolId(), fileIdent, outputStream);
      return outputStream.getBuffer();
    } catch(e) {
      throw new AttachmentRetrievalError(store.id, fileIdent, e);
    }
  }

  private _getLogMeta(logInfo?: AttachmentFileManagerLogInfo): log.ILogMeta {
    return {
      docName: this._docName,
      docPoolId: this._docPoolId,
      ...logInfo,
    };
  }
}
