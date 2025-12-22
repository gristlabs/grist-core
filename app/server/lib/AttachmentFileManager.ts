import {AttachmentTransferStatus, DocAttachmentsLocation} from 'app/common/UserAPI';
import {
  AttachmentFile,
  AttachmentStoreDocInfo,
  DocPoolId,
  getDocPoolIdFromDocInfo,
  IAttachmentStore, loadAttachmentFileIntoMemory,
} from 'app/server/lib/AttachmentStore';
import {AttachmentStoreId, IAttachmentStoreProvider} from 'app/server/lib/AttachmentStoreProvider';
import {checksumFileStream, HashPassthroughStream} from 'app/server/lib/checksumFile';
import {DocStorage, FileInfo} from 'app/server/lib/DocStorage';
import log from 'app/server/lib/log';
import {LogMethods} from 'app/server/lib/LogMethods';
import {MemoryWritableStream} from 'app/server/utils/streams';
import {EventEmitter} from 'events';
import * as stream from 'node:stream';
import {AbortController} from 'node-abort-controller';


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

export class UnknownDocumentPoolError extends Error {
  constructor() {
    super(`Attempted to access external attachments, but the pool id is unknown`);
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
    const storeName = storeId ? `'${storeId}'` : "internal storage";
    super(`Unable to retrieve '${fileId}' from ${storeName} ${reason}`);
    this.storeId = storeId;
    this.fileId = fileId;
    this.cause = causeError;
  }
}

export class MismatchedFileHashError extends Error {
  constructor(fileIdent: string, hash: string) {
    super(`Hash ${hash} is not correct for attachment file '${fileIdent}'`);
  }
}

/**
 * Instantiated on a per-document basis to provide a document with access to its attachments.
 * Handles attachment uploading / fetching, as well as trying to ensure consistency with the local
 * document database, which tracks attachments and where they're stored.
 *
 * This class should prevent the document code from having to worry about accessing the underlying
 * stores.
 *
 * Before modifying this class, it's suggested to understand document pools (described in
 * AttachmentStore.ts), which are used to perform the (eventual) cleanup of the files in external
 * stores.
 *
 * The general design philosophy for this class is:
 * - Avoid data loss at all costs (missing files in stores, or missing file table entries)
 * - Always be in a valid state if possible (e.g no file entries with missing attachments)
 * - Files in stores with no file record pointing to them is acceptable (but not preferable), as
 * they'll eventually be cleaned up when the document pool is deleted.
 *
 */
export class AttachmentFileManager extends EventEmitter {

  public static events = {
    TRANSFER_STARTED: 'transfer-started',
    TRANSFER_COMPLETED: 'transfer-completed',
  };

  // _docPoolId is a critical point for security. Documents with a common pool id can access each others' attachments.
  private readonly _docPoolId: DocPoolId | null;
  private readonly _docName: string;
  private _log = new LogMethods(
    "AttachmentFileManager ",
    (logInfo: AttachmentFileManagerLogInfo) => this._getLogMeta(logInfo),
  );

  // Maps file identifiers to their desired store. This may be the same as their current store,
  // in which case nothing will happen. Map ensures new requests override older pending transfers.
  private _pendingFileTransfers: Map<string, AttachmentStoreId | undefined> = new Map();
  private _successes: number = 0;
  private _failures: number = 0;
  private _transferJob?: TransferJob;
  private _loopAbortController: AbortController = new AbortController();
  private _loopAbort = this._loopAbortController?.signal as globalThis.AbortSignal;

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
    private _assertInternalStorageAvailable?: (extraBytes: number) => Promise<void>,
  ) {
    super();
    this._docName = _docStorage.docName;
    this._docPoolId = _docInfo ? getDocPoolIdFromDocInfo(_docInfo) : null;
  }

  public async shutdown(): Promise<void> {
    if (this._loopAbort.aborted) {
      throw new Error("shutdown already in progress");
    }
    this._pendingFileTransfers.clear();
    this._successes = 0;
    this._failures = 0;
    this._loopAbortController.abort();
    await this._transferJob?.catch(reason => this._log.error({}, `Error during shutdown: ${reason}`));
  }

  // This attempts to add the attachment to the given store.
  // If the file already exists in another store, it doesn't take any action.
  // Therefore, there isn't a guarantee that the file exists in the given store, even if this method doesn't error.
  public async addFile(
    storeId: AttachmentStoreId | undefined,
    fileExtension: string,
    fileData: Buffer,
  ): Promise<AddFileResult> {
    const fileIdent = await this._getFileIdentifier(fileExtension, stream.Readable.from(fileData));
    return this._addFile(storeId, fileIdent, fileData);
  }

  /**
   * Adds an attachment file to storage, if that attachment is known about but not currently
   * available (as determined by `AttachmentFileManager.isFileAvailable`).
   * This most frequently occurs when a document is (re)uploaded, meaning it has a new docPoolId
   * and no copies of the attachment files.
   *
   * The file is restored to the store it was originally stored in, if that store is available.
   * Otherwise, `defaultStoreId` is used.
   *
   * @param {string} fileIdent - Attachment file to attempt to restore.
   * @param {stream.Readable} fileData - Contents of the file.
   * @param {AttachmentStoreId | undefined} defaultStoreId - Store to use if the file's original store is unavailable.
   * @returns {Promise<boolean>} - True if the file was added, false otherwise.
   */
  public async addMissingFileData(
    fileIdent: string,
    fileData: stream.Readable,
    defaultStoreId: AttachmentStoreId | undefined,
  ): Promise<boolean> {
    const fileMetadata = await this._docStorage.getFileInfoNoData(fileIdent);
    if (!fileMetadata) { return false; }
    if (await this._isFileAvailable(fileMetadata)) { return false; }

    // Try to use the store the file was originally uploaded to, if it's available.
    const originalStoreId = fileMetadata.storageId;
    const originalStoreStillExists =
      !!originalStoreId && this._getStoreProvider().listAllStoreIds().includes(originalStoreId);
    const destinationStoreId = originalStoreStillExists ? originalStoreId : defaultStoreId;
    const destinationStore = destinationStoreId && await this._getStore(destinationStoreId) || undefined;

    // Error if the file should be added to an external store, but the store isn't available for some reason.
    if (destinationStoreId && !destinationStore) {
      throw new StoreNotAvailableError(destinationStoreId);
    }

    // Internal storage is handled separately, as it needs the file as a Buffer in memory.
    // External storage can avoid loading it into memory, as it's all stream APIs.
    if (destinationStore) {
      const hashStream = new HashPassthroughStream();
      // To avoid loading this into memory, we hash the file as it's uploaded, and delete it
      // if the hash isn't correct.
      fileData.pipe(hashStream);
      await this._storeFileInAttachmentStore(destinationStore, fileIdent, hashStream);
      await stream.promises.finished(hashStream);
      const fileHash = hashStream.getDigest();
      if (!fileIdent.startsWith(fileHash)) {
        await destinationStore.delete(this._getDocPoolId(), fileIdent);
        throw new MismatchedFileHashError(fileIdent, fileHash);
      }
    }
    else {
      const hashStream = new HashPassthroughStream();
      const bufferStream = new MemoryWritableStream();
      await stream.promises.pipeline(fileData, hashStream, bufferStream);
      const buffer = bufferStream.getBuffer();
      const fileHash = hashStream.getDigest();
      if (!fileIdent.startsWith(fileHash)) {
        throw new MismatchedFileHashError(fileIdent, fileHash);
      }
      await this._storeFileInLocalStorage(fileIdent, buffer);
    }

    return true;
  }

  public async getFileData(fileIdent: string): Promise<Buffer> {
    const file = await this.getFile(fileIdent);
    return (await loadAttachmentFileIntoMemory(file)).contents;
  }

  public async getFile(fileIdent: string): Promise<AttachmentFile> {
    return (await this._getFileInfo(fileIdent)).file;
  }

  /**
   * Checks if the contents of an attachment are accessible.
   * Internal attachments are always considered accessible.
   * External attachments are accessible if the store is configured and contains the file.
   * @param {string} fileIdent
   * @returns {Promise<boolean>}
   */
  public async isFileAvailable(fileIdent: string): Promise<boolean> {
    const fileInfo = await this._docStorage.getFileInfoNoData(fileIdent);
    return this._isFileAvailable(fileInfo);
  }

  public async locationSummary(): Promise<DocAttachmentsLocation> {
    const files = await this._docStorage.listAllFiles();
    if (files.length == 0) {
      return "none";
    }
    const hasInternal = files.some(file => !file.storageId);
    const hasExternal = files.some(file => file.storageId);
    if (hasInternal && hasExternal) {
      return "mixed";
    }
    if (hasExternal) {
      return "external";
    }
    return "internal";
  }

  public async startTransferringAllFilesToOtherStore(newStoreId: AttachmentStoreId | undefined): Promise<void> {
    if (this._loopAbort.aborted) {
      throw new Error("AttachmentFileManager was shut down");
    }
    this._successes = 0;
    this._failures = 0;
    // Take a "snapshot" of the files we want to transfer, and schedule those files for transfer.
    // It's possibly that other code will modify the file statuses / list during this process.
    // As a consequence, after this process completes, some files may still be in their original
    // store. Simple approaches to solve this (e.g transferring files until everything in the DB
    // shows as being in the new store) risk livelock issues, such as if two transfers somehow end
    // up running simultaneously. This "snapshot" approach has few guarantees about final state,
    // but is extremely unlikely to result in any severe problems.
    const allFiles = await this._docStorage.listAllFiles();
    const filesToTransfer = allFiles.filter(file => (file.storageId ?? undefined) !== newStoreId);

    if (filesToTransfer.length === 0) {
      return;
    }

    const fileIdents = filesToTransfer.map(file => file.ident);
    for (const fileIdent of fileIdents) {
      this.startTransferringFileToOtherStore(fileIdent, newStoreId);
    }
  }

  // File transfers are handled by an async job that goes through all pending files, and one-by-one
  // transfers them from their current store to their target store. This ensures that for a given
  // doc, we never accidentally start several transfers at once and load many files into memory
  // simultaneously (e.g. a badly written script spamming API calls). It allows any new transfers
  // to overwrite any scheduled transfers. This provides a well-defined behaviour where the latest
  // scheduled transfer happens, instead of the last transfer to finish "winning".
  public startTransferringFileToOtherStore(fileIdent: string, newStoreId: AttachmentStoreId | undefined) {
    this._pendingFileTransfers.set(fileIdent, newStoreId);
    this._runTransferJob();
  }

  // Generally avoid calling this directly, instead use other methods to schedule and run the
  // transfer job. If a file with a matching identifier already exists in the new store, no
  // transfer will happen, as the default _addFileToX behaviour is to avoid re-uploading files.
  public async transferFileToOtherStore(fileIdent: string, newStoreId: AttachmentStoreId | undefined): Promise<void> {
    this._log.info({fileIdent, storeId: newStoreId}, `transferring file to new store`);
    const fileMetadata = await this._docStorage.getFileInfoNoData(fileIdent);
    // This check runs before the file is retrieved as an optimisation to avoid loading files into
    // memory unnecessarily.
    if (!fileMetadata || (fileMetadata.storageId ?? undefined) === newStoreId) {
      return;
    }
    // It's possible that the record has changed between the original metadata check and here.
    // However, the worst case is we transfer a file that's already been transferred, so no need to
    // re-check.
    // Streaming isn't an option here, as SQLite only supports buffers (meaning we need to keep at
    // least 1 full copy of the file in memory during transfers).
    const fileInfo = await this._getFileInfo(fileIdent);
    // Cache this to avoid undefined warnings everywhere we use `dataInMemory`.
    const fileInMemory = await loadAttachmentFileIntoMemory(fileInfo.file);

    if (!await validateFileChecksum(fileIdent, fileInMemory.contents)) {
      throw new AttachmentRetrievalError(
        fileInfo.storageId, fileInfo.ident, "checksum verification failed for retrieved file",
      );
    }
    if (!newStoreId) {
      await this._storeFileInLocalStorage(fileIdent, fileInMemory.contents);
      return;
    }
    const newStore = await this._getStore(newStoreId);
    if (!newStore) {
      this._log.warn({
        fileIdent,
        storeId: newStoreId,
      }, `unable to transfer file to unavailable store`);
      throw new StoreNotAvailableError(newStoreId);
    }
    // Store should error if the upload fails in any way.
    await this._storeFileInAttachmentStore(newStore, fileIdent, stream.Readable.from(fileInMemory.contents));

    // Don't remove the file from the previous store, in case we need to roll back to an earlier
    // snapshot.
    // Internal storage is the exception (and is automatically erased), as that's included in
    // snapshots.
  }

  public async allTransfersCompleted(): Promise<void> {
    if (this._transferJob) {
      await this._transferJob;
    }
  }

  public transferStatus() {
    return {
      pendingTransferCount: this._pendingFileTransfers.size,
      isRunning: this._transferJob !== undefined,
      successes: this._successes,
      failures: this._failures,
    };
  }

  private _runTransferJob() {
    if (this._transferJob) {
      return;
    }
    this._transferJob = this._performPendingTransfers();

    this._transferJob.catch(err => this._log.error({}, `Error during transfer: ${err}`));

    void this._transferJob.finally(() => {
      this._transferJob = undefined;
    });
  }

  private async _performPendingTransfers() {
    try {
      await this._notifyAboutStart();
      while (this._pendingFileTransfers.size > 0 && !this._loopAbort.aborted) {
        // Map.entries() will always return the most recent key/value from the map, even after a long async delay
        // Meaning we can safely iterate here and know the transfer is up to date.
        for (const [fileIdent, targetStoreId] of this._pendingFileTransfers.entries()) {
          try {
            await this.transferFileToOtherStore(fileIdent, targetStoreId);
            // This is exposed just for testing, to allow for a delay between transfers.
            // One of the test is refreshing the tab to see if the transfer is still running.
            if (process.env.GRIST_TEST_TRANSFER_DELAY) {
              await new Promise(resolve => setTimeout(resolve, Number(process.env.GRIST_TEST_TRANSFER_DELAY)));
            }
            this._successes++;
          }
          catch (e) {
            this._failures++;
            this._log.warn({fileIdent, storeId: targetStoreId}, `transfer failed: ${e.message}`);
          }
          finally {
            // If a transfer request comes in mid-transfer, it will need re-running.
            if (this._pendingFileTransfers.get(fileIdent) === targetStoreId) {
              this._pendingFileTransfers.delete(fileIdent);
            }
          }
        }
      }
    }
    finally {
      if (!this._loopAbort.aborted) {
        await this._docStorage.requestVacuum();
        await this._notifyAboutEnd();
      }
    }
  }

  /**
   * Sends a notification that a transfer has started.
   * Note: We calculate arguments ourselves as the status object is not yet available, as
   * it is calculated from the promise (if it is set or not).
   */
  private async _notifyAboutStart() {
    this.emit(AttachmentFileManager.events.TRANSFER_STARTED, {
      locationSummary: await this.locationSummary(),
      status: {pendingTransferCount: this._pendingFileTransfers.size, isRunning: true},
    } as AttachmentTransferStatus);
  }

  /**
   * Sends a notification that a transfer has end.
   * Note: We calculate arguments ourselves as the status object is not yet available, as
   * it is calculated from the promise (if it is set or not).
   */
  private async _notifyAboutEnd() {
    this.emit(AttachmentFileManager.events.TRANSFER_COMPLETED, {
      locationSummary: await this.locationSummary(),
      status: {pendingTransferCount: this._pendingFileTransfers.size, isRunning: false},
    } as AttachmentTransferStatus);
  }

  private async _isFileAvailable(fileInfo?: FileInfo | null): Promise<boolean> {
    if (!fileInfo) { return false; }
    // Local files are always available
    if (fileInfo.storageId === null) { return true; }
    const store = await this._storeProvider?.getStore(fileInfo.storageId);
    if (!store) { return false; }
    return await store.exists(this._getDocPoolId(), fileInfo.ident);
  }

  private async _addFileToLocalStorage(
    fileIdent: string,
    fileData: Buffer,
  ): Promise<AddFileResult> {
    this._log.info({
      fileIdent,
    }, `adding file to document storage`);

    const fileInfoNoData = await this._docStorage.getFileInfoNoData(fileIdent);
    const fileExists = fileInfoNoData !== null;

    if (fileExists) {
      const isFileInLocalStorage = fileInfoNoData.storageId === null;
      // File is already stored in a different store, the 'add file' operation shouldn't change that.
      // One way this could happen, is if the store has changed and no migration has happened.
      if (!isFileInLocalStorage) {
        return {
          fileIdent,
          isNewFile: false,
        };
      }
    }

    // A race condition can occur here, if the file's database record is modified between the
    // `getFileInfoNoData` call earlier in this function and now.
    // Any changes made after that point will be overwritten below.
    // However, the database will always end up referencing a valid file, and the pool-based file
    // deletion guarantees any files in external storage will be cleaned up eventually.

    await this._storeFileInLocalStorage(fileIdent, fileData);

    return {
      fileIdent,
      isNewFile: !fileExists,
    };
  }

  private async _addFileToExternalStorage(
    destStoreId: AttachmentStoreId,
    fileIdent: string,
    fileData: stream.Readable,
  ): Promise<AddFileResult> {
    this._log.info({
      fileIdent,
      storeId: destStoreId,
    }, `adding file to external storage`);

    const destStore = await this._getStore(destStoreId);

    if (!destStore) {
      this._log.warn({ fileIdent, storeId: destStoreId }, "tried to fetch attachment from an unavailable store");
      throw new StoreNotAvailableError(destStoreId);
    }

    const fileInfoNoData = await this._docStorage.getFileInfoNoData(fileIdent);
    const fileExists = fileInfoNoData !== null;

    if (fileExists) {
      const isFileInTargetStore = destStoreId === fileInfoNoData.storageId;
      // File is already stored in a different store, the 'add file' operation shouldn't change that.
      // One way this could happen, is if the store has changed and no migration has happened.
      if (!isFileInTargetStore) {
        return {
          fileIdent,
          isNewFile: false,
        };
      }

      // Only exit early in the file exists in the store, otherwise we should allow users to fix
      // any missing files by proceeding to the normal upload logic.
      const fileAlreadyExistsInStore = await destStore.exists(this._getDocPoolId(), fileIdent);
      if (fileAlreadyExistsInStore) {
        return {
          fileIdent,
          isNewFile: false,
        };
      }
    }

    // A race condition can occur here, if the file's database record is modified between the
    // `getFileInfoNoData` call earlier in this function and now.
    // Any changes made after that point will be overwritten below.
    // However, the database will always end up referencing a valid file, and the pool-based file
    // deletion guarantees any files in external storage will be cleaned up eventually.

    await this._storeFileInAttachmentStore(destStore, fileIdent, fileData);

    return {
      fileIdent,
      isNewFile: !fileExists,
    };
  }

  private async _addFile(
    destStoreId: AttachmentStoreId | undefined,
    fileIdent: string,
    fileData: Buffer,
  ): Promise<AddFileResult> {
    if (destStoreId === undefined) {
      return this._addFileToLocalStorage(fileIdent, fileData);
    }
    return this._addFileToExternalStorage(destStoreId, fileIdent, stream.Readable.from(fileData));
  }

  private async _getFileInfo(fileIdent: string): Promise<AttachmentFileInfo> {
    const fileInfo = await this._docStorage.getFileInfo(fileIdent);
    if (!fileInfo) {
      this._log.error({ fileIdent }, "cannot find file metadata in document");
      throw new MissingAttachmentError(fileIdent);
    }
    this._log.debug(
      { fileIdent, storeId: fileInfo.storageId },
      `fetching attachment from ${fileInfo.storageId ? "external" : "document "} storage`,
    );
    if (!fileInfo.storageId) {
      return {
        ident: fileIdent,
        storageId: null,
        file: {
          metadata: {
            size: fileInfo.data.length,
          },
          contentStream: stream.Readable.from(fileInfo.data),
          contents: fileInfo.data,
        },
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
      file: await this._getFileDataFromAttachmentStore(store, fileIdent),
    };
  }

  private _getStoreProvider(): IAttachmentStoreProvider {
    if (!this._storeProvider) {
      throw new StoresNotConfiguredError();
    }
    return this._storeProvider;
  }

  private async _getStore(storeId: AttachmentStoreId): Promise<IAttachmentStore | null> {
    return this._getStoreProvider().getStore(storeId);
  }

  private _getDocPoolId(): string {
    if (!this._docPoolId) {
      throw new UnknownDocumentPoolError();
    }
    return this._docPoolId;
  }

  private async _getFileIdentifier(fileExtension: string, fileData: stream.Readable): Promise<string> {
    const checksum = await checksumFileStream(fileData);
    return `${checksum}${fileExtension}`;
  }

  // Uploads the file to local storage, overwriting the current DB record for the file.
  private async _storeFileInLocalStorage(fileIdent: string, fileData: Buffer): Promise<AddFileResult> {
    // Insert (or overwrite) the entry for this file in the document database.
    await this._assertInternalStorageAvailable?.(fileData.byteLength);
    const isNewFile = await this._docStorage.attachOrUpdateFile(fileIdent, fileData, undefined);

    return {
      fileIdent,
      isNewFile,
    };
  }

  // Uploads the file to an attachment store, overwriting the current DB record for the file if successful.
  private async _storeFileInAttachmentStore(
    store: IAttachmentStore, fileIdent: string, fileData: stream.Readable,
  ): Promise<void> {

    // The underlying store should guarantee the file exists if this method doesn't error,
    // so no extra validation is needed here.
    await store.upload(this._getDocPoolId(), fileIdent, fileData);

    // Insert (or overwrite) the entry for this file in the document database.
    await this._docStorage.attachOrUpdateFile(fileIdent, undefined, store.id);
  }

  private async _getFileDataFromAttachmentStore(store: IAttachmentStore, fileIdent: string): Promise<AttachmentFile> {
    try {
      return await store.download(this._getDocPoolId(), fileIdent);
    }
    catch(e) {
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
  return fileIdent.startsWith(await checksumFileStream(stream.Readable.from(fileData)));
}

interface AttachmentFileManagerLogInfo {
  fileIdent?: string;
  storeId?: string | null;
}

interface AttachmentFileInfo {
  ident: string;
  storageId: string | null;
  file: AttachmentFile;
}

type TransferJob = Promise<void>;
