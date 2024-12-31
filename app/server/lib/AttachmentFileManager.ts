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
    super(`Unable to retrieve '${fileId}' from ${storeName} ${reason}`);
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

interface AllFileTransfer {
  files: string[],
  targetStoreId: AttachmentStoreId | undefined,
}

interface TransferJob {
  isFinished: boolean,
  promise: Promise<void>
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

  // Maps each file to the store it should end up in after the transfer.
  private _pendingFileTransfers: Map<string, AttachmentStoreId | undefined> = new Map();
  // Needed for status tracking when moving all files to a new store.
  private _activeAllFileTransfer?: AllFileTransfer;
  private _transferJob?: TransferJob;

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

  // File transfers are handled by an async job that goes through all pending files, and one-by-one transfers them
  // from their current store to their target store.
  // This ensures that for a given doc, we never accidentally start several transfers at once and load many files
  // into memory simultaneously (e.g. a badly written script spamming API calls).
  // It allows any new transfers to overwrite any scheduled transfers. This provides a well-defined behaviour
  // where the latest scheduled transfer happens, instead of the last transfer to finish "winning".
  //
  public async startTransferringAllFilesToOtherStore(newStoreId: AttachmentStoreId | undefined): Promise<void> {
    // Take a "snapshot" of the files we want to transfer, and schedule those files for transfer.
    // It's probable that the underlying database will change during this process.
    // As a consequence, after this process completes, some files may still be in their original store.
    // Simple approaches to solve this (e.g transferring files until everything in the DB shows as
    // being in the new store) risk livelock issues, such as if two transfers somehow end up running simultaneously.
    // This "snapshot" approach has few guarantees about final state, but is extremely unlikely to result in any severe
    // problems.
    const filesToTransfer = (await this._docStorage.listAllFiles()).filter(file => file.storageId != newStoreId);
    const fileIdents = filesToTransfer.map(file => file.ident);

    for(const fileIdent of fileIdents) {
      this.startTransferringFileToOtherStore(fileIdent, newStoreId);
    }

    this._activeAllFileTransfer = {
      files: filesToTransfer.map(file => file.ident),
      targetStoreId: newStoreId,
    };
  }

  public startTransferringFileToOtherStore(fileIdent: string, newStoreId: AttachmentStoreId | undefined) {
    this._pendingFileTransfers.set(fileIdent, newStoreId);
    this._runTransferJob();
  }

  // Generally avoid calling this directly, instead use other methods to schedule and run the transfer job.
  // If a file with a matching identifier already exists in the new store, no transfer will happen,
  // as the default _addFileToX behaviour is to avoid re-uploading files.
  public async transferFileToOtherStore(fileIdent: string, newStoreId: AttachmentStoreId | undefined): Promise<void> {
    this._log.info({ fileIdent, storeId: newStoreId }, `transferring file to new store`);
    const fileMetadata = await this._docStorage.getFileInfo(fileIdent, false);
    // This check runs before the file is retrieved as an optimisation to avoid loading files into memory unnecessarily.
    if (!fileMetadata || fileMetadata.storageId == newStoreId) {
      return;
    }
    // It's possible that the record has changed between the original metadata check and here. However, the worst
    // case is we transfer a file that's already been transferred, so no need to re-check.
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
      this._log.warn({ fileIdent, storeId: newStoreId }, `unable to transfer file to unavailable store`);
      throw new StoreNotAvailableError(newStoreId);
    }
    // Store should error if the upload fails in any way.
    await this._storeFileInAttachmentStore(newStore, fileIdent, file.data);

    // Don't remove the file from the previous store, in case we need to roll back to an earlier snapshot.
    // Internal storage is the exception (and is automatically erased), as that's included in snapshots.
  }

  public allTransfersCompleted(): Promise<void> {
    if (this._transferJob) {
      return this._transferJob.promise;
    }
    return Promise.resolve();
  }

  public isAllFileTransferCompleted(): boolean {
    if (!this._activeAllFileTransfer) {
      return true;
    }

    for (const fileIdent of this._activeAllFileTransfer.files) {
      if (this._pendingFileTransfers.has(fileIdent)) {
        return false;
      }
    }

    return true;
  }

  private _runTransferJob(): TransferJob {
    if (this._transferJob && !this._transferJob.isFinished) {
      return this._transferJob;
    }
    const transferPromise = this._performPendingTransfers();
    const newTransferJob: TransferJob = {
      isFinished: false,
      promise: transferPromise,
    };

    newTransferJob.promise.finally(() => newTransferJob.isFinished = true);

    this._transferJob = newTransferJob;

    return newTransferJob;
  }

  private async _performPendingTransfers() {
    while (this._pendingFileTransfers.size > 0) {
      // Map.entries() will always return the most recent key/value from the map, even after a long async delay
      // Meaning we can safely iterate here and know the transfer is up to date.
      for (const [fileIdent, targetStoreId] of this._pendingFileTransfers.entries()) {
        // TODO - catch errors
        try {
          await this.transferFileToOtherStore(fileIdent, targetStoreId);
        } catch(e) {
          this._log.warn({ fileIdent, storeId: targetStoreId }, `transfer failed: ${e.message}`);
        }
        finally {
          this._pendingFileTransfers.delete(fileIdent);
        }
      }
    }
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

      // Only exit early in the file exists in the store, otherwise we should allow users to fix any missing files
      // by proceeding to the normal upload logic.
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
