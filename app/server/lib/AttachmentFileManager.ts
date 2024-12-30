import {
  AttachmentStoreDocInfo,
  DocPoolId,
  getDocPoolIdFromDocInfo,
  IAttachmentStore
} from 'app/server/lib/AttachmentStore';
import {AttachmentStoreId, IAttachmentStoreProvider} from 'app/server/lib/AttachmentStoreProvider';
import {checksumFileStream} from 'app/server/lib/checksumFile';
import {DocStorage} from 'app/server/lib/DocStorage';
import log from 'app/server/lib/log';
import {LogMethods} from 'app/server/lib/LogMethods';
import {MemoryWritableStream} from 'app/server/utils/MemoryWritableStream';
import {Readable} from 'node:stream';

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
  public readonly storeId: AttachmentStoreId | null;
  public readonly fileId: string;

  constructor(storeId: AttachmentStoreId | null, fileId: string, cause?: any) {
    const causeError = cause instanceof Error ? cause : undefined;
    const reason = (causeError ? causeError.message : cause) ?? "";
    const storeName = storeId? `'${storeId}'` : "internal storage";
    super(`Unable to retrieve '${fileId}' from ${storeName}${reason}`);
    this.storeId = storeId;
    this.fileId = fileId;
    this.cause = causeError;
  }
}

interface AttachmentFileManagerLogInfo {
  fileIdent?: string;
  storeId?: string | null;
}

interface AttachmentFileInfo {
  ident: string,
  storageId: string | null,
  data: Buffer,
}

/**
 * Instantiated on a per-document basis to provide a document with access to its attachments.
 * Handles attachment uploading / fetching, as well as trying to ensure consistency with the local
 * document database, which tracks attachments and where they're stored.
 *
 * This class should prevent the document code from having to worry about accessing the underlying stores.
 *
 * Before modifying this class, it's suggested to understand document pools (described in AttachmentStore.ts), which
 * are used to perform the (eventual) cleanup of the files in external stores.
 *
 * The general design philosophy for this class is:
 * - Avoid data loss at all costs (missing files in stores, or missing file table entries)
 * - Always be in a valid state if possible (e.g no file entries with missing attachments)
 * - Files in stores with no file record pointing to them is acceptable (but not preferable), as they'll eventually be
 *   cleaned up when the document pool is deleted.
 *
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
   * @param _storeProvider - Allows instantiating of stores. Should be provided except in test
   *   scenarios.
   * @param _docInfo - The document this manager is for. Should be provided except in test
   *   scenarios.
   */
  constructor(
    private _docStorage: DocStorage,
    private _storeProvider: IAttachmentStoreProvider | undefined,
    _docInfo: AttachmentStoreDocInfo | undefined,
  ) {
    this._docName = _docStorage.docName;
    this._docPoolId = _docInfo ? getDocPoolIdFromDocInfo(_docInfo) : null;
  }

  // This attempts to add the attachment to the given store.
  // If the file already exists in another store, it doesn't take any action.
  // Therefore, there isn't a guarantee that the file exists in the given store, even if this method doesn't error.
  public async addFile(
    storeId: AttachmentStoreId | undefined,
    fileExtension: string,
    fileData: Buffer
  ): Promise<AddFileResult> {
    const fileIdent = await this._getFileIdentifier(fileExtension, Readable.from(fileData));
    return this._addFile(storeId, fileIdent, fileData);
  }


  public async getFileData(fileIdent: string): Promise<Buffer> {
    return (await this._getFile(fileIdent)).data;
  }

  // Transfers a file from its current store to a new store, deleting it in the old store once the transfer
  // is completed.
  // If a file with a matching identifier already exists in the new store, no transfer will happen and the source
  // file will be deleted, as the default _addFileToX behaviour is to avoid re-uploading files.
  public async transferFileToOtherStore(fileIdent: string, newStoreId: AttachmentStoreId | undefined): Promise<void> {
    this._log.info({ fileIdent, storeId: newStoreId }, `transferring file to new store`);
    // Streaming isn't an option here, as SQLite only supports buffers, so we have at least one copy in memory.
    const file = await this._getFile(fileIdent);
    if (!await validateFileChecksum(fileIdent, file.data)) {
      throw new AttachmentRetrievalError(file.storageId, file.ident, "checksum verification failed for retrieved file");
    }
    if (!newStoreId) {
      await this._storeFileInLocalStorage(fileIdent, file.data);
      return;
    }
    const newStore = await this._getStore(newStoreId);
    if (!newStore) {
      this._log.warn({ fileIdent, storeId: newStoreId }, `Unable to transfer file to unavailable store`);
      throw new StoreNotAvailableError(newStoreId);
    }
    // Store should error if the upload fails in any way.
    await this._storeFileInAttachmentStore(newStore, fileIdent, file.data);

    // Don't remove the file from the previous store, in case we need to roll back to an earlier snapshot.
    // Internal storage is the exception, as that's included in snapshots.
  }

  private async _addFile(
    storeId: AttachmentStoreId | undefined,
    fileIdent: string,
    fileData: Buffer
  ): Promise<AddFileResult> {
    this._log.info({ fileIdent, storeId }, `adding file to ${storeId ? "external" : "document"} storage`);

    const store = storeId !== undefined ? await this._getStore(storeId) : null;

    if (storeId !== undefined && !store) {
      this._log.warn({ fileIdent, storeId }, "tried to fetch attachment from an unavailable store");
      throw new StoreNotAvailableError(storeId);
    }

    const fileInfoNoData = await this._docStorage.getFileInfo(fileIdent, false);
    const fileExists = fileInfoNoData != null;

    if (fileExists) {
      const isFileInTargetStore = fileInfoNoData.storageId ?
        fileInfoNoData.storageId === storeId : storeId === undefined;

      // File is already stored in a different store (e.g because store has changed and no migration has happened).
      if (!isFileInTargetStore) {
        return {
          fileIdent,
          isNewFile: false,
        };
      }

      // Validate the file exists in the store, and exit if it does. It doesn't exist, we can proceed with the upload,
      // allowing users to fix any missing files by re-uploading.
      if (store) {
        const existsInStore = await store.exists(this._getDocPoolId(), fileIdent);
        if (existsInStore) {
          return {
            fileIdent,
            isNewFile: false,
          };
        }
      }
    }

    // There's a possible race condition if anything changed the record between the initial checks in this
    // method, and the database being updated below - any changes will be overwritten.
    // However, the database will always end up referencing a valid file, and the pool-based file deletion guarantees
    // any files in external storage will be cleaned up eventually.

    if (store) {
      await this._storeFileInAttachmentStore(store, fileIdent, fileData);
    } else {
      await this._storeFileInLocalStorage(fileIdent, fileData);
    }

    return {
      fileIdent,
      isNewFile: !fileExists,
    };
  }


  private async _getFile(fileIdent: string): Promise<AttachmentFileInfo> {
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
      return {
        ident: fileIdent,
        storageId: null,
        data: fileInfo.data,
      };
    }
    const store = await this._getStore(fileInfo.storageId);
    if (!store) {
      this._log.warn({ fileIdent, storeId: fileInfo.storageId }, `unable to retrieve file, store is unavailable`);
      throw new StoreNotAvailableError(fileInfo.storageId);
    }
    return {
      ident: fileIdent,
      storageId: store.id,
      data: await this._getFileDataFromAttachmentStore(store, fileIdent),
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

  // Uploads the file to local storage, overwriting the current DB record for the file.
  private async _storeFileInLocalStorage(fileIdent: string, fileData: Buffer): Promise<AddFileResult> {
    // Insert (or overwrite) the entry for this file in the document database.
    const isNewFile = await this._docStorage.findOrAttachFile(fileIdent, fileData, undefined, true);

    return {
      fileIdent,
      isNewFile,
    };
  }

  // Uploads the file to an attachment store, overwriting the current DB record for the file if successful.
  private async _storeFileInAttachmentStore(
    store: IAttachmentStore, fileIdent: string, fileData: Buffer
  ): Promise<string> {
    // The underlying store should guarantee the file exists if this method doesn't error, so no extra validation is
    // needed here.
    await store.upload(this._getDocPoolId(), fileIdent, Readable.from(fileData));

    // Insert (or overwrite) the entry for this file in the document database.
    await this._docStorage.findOrAttachFile(fileIdent, undefined, store.id, true);

    return fileIdent;
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

async function validateFileChecksum(fileIdent: string, fileData: Buffer): Promise<boolean> {
  return fileIdent.startsWith(await checksumFileStream(Readable.from(fileData)));
}
