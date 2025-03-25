import { DocStorage, FileInfo } from "app/server/lib/DocStorage";
import {
  AttachmentFileManager,
  AttachmentRetrievalError,
  StoreNotAvailableError,
  UnknownDocumentPoolError
} from "app/server/lib/AttachmentFileManager";
import {
  AttachmentFile,
  getDocPoolIdFromDocInfo,
  IAttachmentStore
} from "app/server/lib/AttachmentStore";
import {
  AttachmentStoreProvider,
  IAttachmentStoreConfig,
  IAttachmentStoreProvider,
} from "app/server/lib/AttachmentStoreProvider";
import { makeTestingFilesystemStoreConfig } from "test/server/lib/FilesystemAttachmentStore";
import {waitForIt} from 'test/server/wait';
import { assert } from "chai";
import * as stream from "node:stream";
import * as sinon from "sinon";

// Minimum features of doc storage that are needed to make AttachmentFileManager work.
type IMinimalDocStorage = Pick<DocStorage,
  'docName' | 'getFileInfo' | 'getFileInfoNoData' | 'attachFileIfNew' | 'attachOrUpdateFile'
  | 'listAllFiles' | 'requestVacuum'
>

// Implements the minimal functionality needed for the AttachmentFileManager to work.
class DocStorageFake implements IMinimalDocStorage {
  private _files: { [key: string]: FileInfo  } = {};

  constructor(public docName: string) {
  }

  public async requestVacuum(): Promise<boolean> {
    return true;
  }

  public async listAllFiles(): Promise<FileInfo[]> {
    const fileInfoPromises = Object.keys(this._files).map(key => this.getFileInfo(key));
    const fileInfo = await Promise.all(fileInfoPromises);

    const isFileInfo = (item: FileInfo | null): item is FileInfo => item !== null;

    return fileInfo.filter(isFileInfo);
  }

  public async getFileInfo(fileIdent: string): Promise<FileInfo | null> {
    return this._files[fileIdent] ?? null;
  }

  public async getFileInfoNoData(fileIdent: string): Promise<FileInfo | null> {
    return this.getFileInfo(fileIdent);
  }

  // Needs to match the semantics of DocStorage's implementation.
  public async attachFileIfNew(
    fileIdent: string, fileData: Buffer | undefined, storageId?: string | undefined
  ): Promise<boolean> {
    if (fileIdent in this._files) {
      return false;
    }
    this._setFileRecord(fileIdent, fileData, storageId);
    return true;
  }

  public async attachOrUpdateFile(
    fileIdent: string, fileData: Buffer | undefined, storageId?: string | undefined
  ): Promise<boolean> {
    const exists = fileIdent in this._files;
    this._setFileRecord(fileIdent, fileData, storageId);
    return !exists;
  }

  private _setFileRecord(fileIdent: string, fileData: Buffer | undefined, storageId?: string | undefined) {
    this._files[fileIdent] = {
      ident: fileIdent,
      data: fileData ?? Buffer.alloc(0),
      storageId: storageId ?? null,
    };
  }
}

const defaultTestDocName = "1234";
const defaultTestFileContent = "Some content";
const defaultTestFileBuffer = Buffer.from(defaultTestFileContent);

function createDocStorageFake(docName: string): DocStorage {
  return new DocStorageFake(docName) as unknown as DocStorage;
}

interface TestAttachmentStore extends IAttachmentStore {
  uploads(): number;
  finish(): void;
}


/** Creates a fake storage provider that doesn't finish the upload */
export async function makeTestingControlledStore(
  name: string = "unfinished"
): Promise<IAttachmentStoreConfig> {
  let resolve: () => void;
  const createProm = () => new Promise<void>((_resolve) => { resolve = _resolve; });
  let promise = createProm();
  let uploads = 0;
  const neverStore = {
    id: name,
    async exists() { return false; },
    async upload() {
      uploads++;
      // Every time file is uploaded, we create a new promise that can be resolved to finish the upload.
      resolve();
      promise = createProm();
      return promise;
    },
    async download(): Promise<AttachmentFile> {
      return {
        metadata: { size: 0 },
        contentStream: stream.Readable.from([]),
      };
    },
    async delete() { return; },
    async removePool() { return; },
    async close() { return; },
    finish() { resolve(); },
    uploads() { return uploads; },
  };
  return {
    label: name,
    spec: {
      name: "unfinished",
      create: async () => {
        return neverStore;
      }
    },
  };
}

const UNFINISHED_STORE = "TEST-INSTALLATION-UUID-unfinished";

async function createFakeAttachmentStoreProvider(): Promise<IAttachmentStoreProvider> {
  return new AttachmentStoreProvider(
    [
      await makeTestingFilesystemStoreConfig("filesystem"),
      await makeTestingFilesystemStoreConfig("filesystem-alt"),
      await makeTestingControlledStore("unfinished"),
    ],
    "TEST-INSTALLATION-UUID"
  );
}

describe("AttachmentFileManager", function() {
  let defaultProvider: IAttachmentStoreProvider;
  let defaultDocStorageFake: DocStorage;
  let defaultManager: AttachmentFileManager;
  let defaultStoreId: string;
  const defaultDocId = "12345";
  const defaultDocInfo = { id: defaultDocId, trunkId: null };

  this.timeout('4s');

  beforeEach(async function() {
    defaultProvider = await createFakeAttachmentStoreProvider();
    defaultDocStorageFake = createDocStorageFake(defaultTestDocName);
    defaultManager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      defaultDocInfo,
    );
    defaultStoreId = defaultProvider.listAllStoreIds()[0];
  });

  async function deleteFileFromStore(docId: string, storeId: string, fileIdent: string,
                                     provider: IAttachmentStoreProvider = defaultProvider) {
    const store = await provider.getStore(storeId);
    assert.isTrue(await store?.exists(docId, fileIdent));
    await store?.delete(docId, fileIdent);
    assert.isFalse(await store?.exists(docId, fileIdent));
  }

  it("should stop the loop when aborted", async function() {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: "Unimportant", trunkId: null  },
    );

    // Add some file.
    await manager.addFile(undefined, ".txt", Buffer.from("first file"));
    await manager.addFile(undefined, ".txt", Buffer.from("second file"));
    await manager.addFile(undefined, ".txt", Buffer.from("third file"));

    // Move this file to a store that never finish uploads.
    await manager.startTransferringAllFilesToOtherStore(defaultProvider.listAllStoreIds()[2]);

    // Make sure we are running.
    assert.isTrue(manager.transferStatus().isRunning);

    // Get the store to test if the upload was called. The store is created only once.
    const store = await defaultProvider.getStore(UNFINISHED_STORE).then((store) => store as TestAttachmentStore);

    // Wait for the first upload to be called.
    await waitForIt(() => assert.equal(store.uploads(),  1));

    // Finish the upload and go to the next one.
    store.finish();

    // Wait for the second one to be called.
    await waitForIt(() => assert.equal(store.uploads(),  2));

    // Now shutdown the manager.
    const shutdownProm = manager.shutdown();

    // Manager will wait for the loop to finish, so allow the second file to be uploaded.
    store.finish();

    // Now manager can finish.
    await shutdownProm;

    // Make sure we are not running.
    assert.isFalse(manager.transferStatus().isRunning);

    // And make sure that the upload was only called twice.
    assert.equal(store.uploads(),  2);
  });

  it("should throw if uses an external store when no document pool id is available", async function () {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      undefined,
    );

    const storeId = defaultProvider.listAllStoreIds()[0];

    await assert.isRejected(manager.addFile(storeId, ".txt", Buffer.alloc(0)), UnknownDocumentPoolError);
  });

  it("should throw if it tries to add a file to an unavailable store", async function () {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: "Unimportant", trunkId: null  },
    );

    await assert.isRejected(manager.addFile("BAD STORE ID", ".txt", Buffer.alloc(0)), StoreNotAvailableError);
  });

  it("should throw if it tries to get a file from an unavailable store", async function() {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: "Unimportant", trunkId: null  },
    );

    const fileId = "123456.png";
    await defaultDocStorageFake.attachFileIfNew(fileId, undefined, "SOME-STORE-ID");

    await assert.isRejected(manager.getFileData(fileId), StoreNotAvailableError);
  });

  it("should add a file to local document storage if no store id is provided", async function() {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: "Unimportant", trunkId: null  },
    );

    const result = await manager.addFile(undefined, ".txt", Buffer.from(defaultTestFileContent));

    // Checking the file is present in the document storage.
    const fileInfo = await defaultDocStorageFake.getFileInfo(result.fileIdent);
    assert.equal(fileInfo?.data.toString(), "Some content");
  });

  it("should add a file to an available attachment store", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const storeId = defaultProvider.listAllStoreIds()[0];
    const result = await manager.addFile(storeId, ".txt", Buffer.from(defaultTestFileContent));

    const store = await defaultProvider.getStore(storeId);
    assert.isTrue(await store!.exists(docId, result.fileIdent), "file does not exist in store");
  });

  describe("isFileAvailable", async function () {
    it("should report a non-existent file as unavailable", async function() {
      assert.isFalse(await defaultManager.isFileAvailable("I don't exist!"), "file should not be available");
    });
    it("should report an internal file as available", async function() {
      const addFileResult = await defaultManager.addFile(undefined, ".txt", defaultTestFileBuffer);
      assert.isTrue(await defaultManager.isFileAvailable(addFileResult.fileIdent));
    });
    it("should report an existing external file as available", async function() {
      const addFileResult = await defaultManager.addFile(defaultStoreId, ".txt", defaultTestFileBuffer);
      assert.isTrue(await defaultManager.isFileAvailable(addFileResult.fileIdent));
    });
    it("should report a missing external file as available", async function() {
      const addFileResult = await defaultManager.addFile(defaultStoreId, ".txt", defaultTestFileBuffer);
      await deleteFileFromStore(defaultDocId, defaultStoreId, addFileResult.fileIdent);
      assert.isFalse(await defaultManager.isFileAvailable(addFileResult.fileIdent));
    });
    it("should report a file from an unavailable store as unavailable", async function() {
      const addFileResult = await defaultManager.addFile(defaultStoreId, ".txt", defaultTestFileBuffer);

      // Same settings as defaultManager, but with no stores.
      const alternateManager = new AttachmentFileManager(
        defaultDocStorageFake,
        new AttachmentStoreProvider([], 'TEST-INSTALLATION-UUID'),
        defaultDocInfo,
      );

      assert(defaultDocStorageFake.getFileInfo(addFileResult.fileIdent), "file info should still exist in storage");
      assert.isFalse(await alternateManager.isFileAvailable(addFileResult.fileIdent));
    });
  });

  describe("adding missing files", async function() {
    let manager: AttachmentFileManager;
    let defaultStoreId: string;

    beforeEach(function() {
      manager = new AttachmentFileManager(
        defaultDocStorageFake,
        defaultProvider,
        defaultDocInfo,
      );
      defaultStoreId = defaultProvider.listAllStoreIds()[0];
    });

    async function addTestFiles() {
      const addToExternalResult = await manager.addFile(defaultStoreId, ".txt", defaultTestFileBuffer);
      const addToInternalResult = await manager.addFile(undefined, ".txt", defaultTestFileBuffer);

      return {
        internal: addToInternalResult,
        external: addToExternalResult,
      };
    }

    async function getManagerWithDifferentStores() {
      const alternateProvider = new AttachmentStoreProvider(
        [await makeTestingFilesystemStoreConfig("new-store")],
        'ANOTHER-INSTALLATION-UUID'
      );

      // Uses the same fake database + doc info, but with different stores.
      const alternateManager = new AttachmentFileManager(
        defaultDocStorageFake,
        alternateProvider,
        defaultDocInfo,
      );

      return {
        provider: alternateProvider,
        manager: alternateManager,
      };
    }


    it("should do nothing if the file exists", async function () {
      const files = await addTestFiles();

      const isExternalFileDataAdded =
        await manager.addMissingFileData(
          files.external.fileIdent, stream.Readable.from(defaultTestFileBuffer), undefined
        );
      assert.isFalse(isExternalFileDataAdded, "external file data should not have been added");

      const isInternalFileDataAdded =
        await manager.addMissingFileData(
          files.internal.fileIdent, stream.Readable.from(defaultTestFileBuffer), undefined
        );
      assert.isFalse(isInternalFileDataAdded, "internal file data should not have been added");
    });

    it("should do nothing if the file doesn't exist", async function () {
      const isExternalFileDataAdded =
        await manager.addMissingFileData("abcde.png", stream.Readable.from(defaultTestFileBuffer), undefined);
      assert.isFalse(isExternalFileDataAdded, "external file data should not have been added");
      assert.isFalse(await manager.isFileAvailable("abcde.png"));

      const isInternalFileDataAdded =
        await manager.addMissingFileData("abcde.png", stream.Readable.from(defaultTestFileBuffer), undefined);
      assert.isFalse(isInternalFileDataAdded, "internal file data should not have been added");
    });

    it("should replace external files if they're missing", async function () {
      const files = await addTestFiles();
      await deleteFileFromStore(defaultDocId, defaultStoreId, files.external.fileIdent);
      assert.isFalse(await manager.isFileAvailable(files.external.fileIdent));

      const otherStoreId = defaultProvider.listAllStoreIds()[1];
      assert.notEqual(otherStoreId, defaultStoreId, "default store should be different for this test");

      const isExternalFileDataAdded =
        await manager.addMissingFileData(
          files.external.fileIdent, stream.Readable.from(defaultTestFileBuffer), otherStoreId
        );
      assert.isTrue(isExternalFileDataAdded, "external file data should have been added");
      assert.isTrue(await manager.isFileAvailable(files.external.fileIdent));
      const fileDetails = await defaultDocStorageFake.getFileInfo(files.external.fileIdent);
      assert.equal(fileDetails?.storageId, defaultStoreId, "file should be restored to original store");
    });

    it("should replace external files in the given store, if the original isn't available", async function () {
      const files = await addTestFiles();

      const { manager: altManager, provider: altProvider } = await getManagerWithDifferentStores();

      const newStoreId = altProvider.getStoreIdFromLabel("new-store");
      const isExternalFileDataAdded = await altManager.addMissingFileData(
        files.external.fileIdent,
        stream.Readable.from(defaultTestFileBuffer),
        newStoreId,
      );
      assert.isTrue(isExternalFileDataAdded, "external file data should have been added");
      assert.isTrue(await altManager.isFileAvailable(files.external.fileIdent));
    });

    it("shouldn't add files if their content is wrong", async function () {
      const files = await addTestFiles();

      const { manager: altManager, provider: altProvider } = await getManagerWithDifferentStores();

      const newStoreId = altProvider.getStoreIdFromLabel("new-store");
      const assertAddFailsWithHashError = async (storeIdToCheck: string | undefined) => {
        await assert.isRejected(altManager.addMissingFileData(
          files.external.fileIdent,
          stream.Readable.from(Buffer.from("THIS IS WRONG")),
          storeIdToCheck,
        ), /Hash.*is not correct/);
        assert.isFalse(await altManager.isFileAvailable(files.external.fileIdent));
      };

      // Need to check adding file to external storage, and internal storage, as they have
      // different hashing approaches.
      await assertAddFailsWithHashError(newStoreId);
      await assertAddFailsWithHashError(undefined);
    });

    it("should throw if neither store is available", async function () {
      const files = await addTestFiles();

      const { manager: altManager } = await getManagerWithDifferentStores();

      const newStoreId = "Mysterious missing store!";
      await assert.isRejected(altManager.addMissingFileData(
        files.external.fileIdent,
        stream.Readable.from(Buffer.from("THIS IS WRONG")),
        newStoreId,
      ), "not a valid and available store");
      assert.isFalse(await altManager.isFileAvailable(files.external.fileIdent));
    });
  });

  it("shouldn't do anything when trying to add an existing attachment to a new store", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const allStoreIds = defaultProvider.listAllStoreIds();
    const result1 = await manager.addFile(allStoreIds[0], ".txt", Buffer.from(defaultTestFileContent));
    const store1 = await defaultProvider.getStore(allStoreIds[0]);
    assert.isTrue(await store1!.exists(docId, result1.fileIdent), "file does not exist in store");

    const result2 = await manager.addFile(allStoreIds[1], ".txt", Buffer.from(defaultTestFileContent));
    const store2 = await defaultProvider.getStore(allStoreIds[1]);
    // File shouldn't exist in the new store
    assert.isFalse(await store2!.exists(docId, result2.fileIdent));

    const fileInfo = await defaultDocStorageFake.getFileInfo(result2.fileIdent);
    assert.equal(fileInfo?.storageId, allStoreIds[0], "file record should not refer to the new store");
  });

  it("should get a file from local storage", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const result = await manager.addFile(undefined, ".txt", Buffer.from(defaultTestFileContent));
    const fileData = await manager.getFileData(result.fileIdent);

    assert.equal(fileData?.toString(), defaultTestFileContent, "downloaded file contents do not match original file");
  });

  it("should get a file from an attachment store", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const storeIds = defaultProvider.listAllStoreIds();
    const result = await manager.addFile(storeIds[0], ".txt", Buffer.from(defaultTestFileContent));
    const fileData = await manager.getFileData(result.fileIdent);
    const fileInfo = await defaultDocStorageFake.getFileInfo(result.fileIdent);
    assert.equal(fileInfo?.storageId, storeIds[0]);
    // Ideally this should be null, but the current fake returns an empty buffer.
    assert.equal(fileInfo?.data.length, 0);
    assert.equal(fileData?.toString(), defaultTestFileContent, "downloaded file contents do not match original file");
  });

  it("should detect existing files and not upload them", async function () {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const storeId = defaultProvider.listAllStoreIds()[0];
    const addFile = () => manager.addFile(storeId, ".txt", Buffer.from(defaultTestFileContent));

    const addFileResult1 = await addFile();
    assert.isTrue(addFileResult1.isNewFile);

    // Makes the store's upload method throw an error, so we can detect if it gets called.
    const originalGetStore = defaultProvider.getStore.bind(defaultProvider);
    sinon.replace(defaultProvider, 'getStore', sinon.fake(
      async function(...args: Parameters<IAttachmentStoreProvider['getStore']>) {
        const store = (await originalGetStore(...args))!;
        sinon.replace(store, 'upload', () => { throw new Error("Upload should never be called"); });
        return store;
      }
    ));

    const addFileResult2 = await addFile();
    assert.isFalse(addFileResult2.isNewFile);
  });

  it("should check if an existing file is in the attachment store, and re-upload them if not", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const storeId = defaultProvider.listAllStoreIds()[0];
    const store = (await defaultProvider.getStore(storeId))!;
    const addFile = () => manager.addFile(storeId, ".txt", Buffer.from(defaultTestFileContent));

    const addFileResult = await addFile();
    // This might be overkill, but it works.
    await store.removePool(docId);

    await assert.isRejected(manager.getFileData(addFileResult.fileIdent), AttachmentRetrievalError);

    await addFile();

    const fileData = await manager.getFileData(addFileResult.fileIdent);
    assert(fileData);
    assert.equal(fileData.toString(), defaultTestFileContent);
  });

  async function testStoreTransfer(sourceStore?: string, destStore?: string) {
    const docInfo = { id: "12345", trunkId: null  };
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      docInfo,
    );

    const fileAddResult = await manager.addFile(sourceStore, ".txt", Buffer.from(defaultTestFileContent));
    manager.startTransferringFileToOtherStore(fileAddResult.fileIdent, destStore);

    await manager.allTransfersCompleted();

    if (!destStore) {
      await defaultDocStorageFake.getFileInfo(fileAddResult.fileIdent);
      assert.equal(
        (await defaultDocStorageFake.getFileInfo(fileAddResult.fileIdent))?.data?.toString(),
        defaultTestFileContent,
      );
      return;
    }

    const store = (await defaultProvider.getStore(destStore))!;

    assert(
      await store.exists(getDocPoolIdFromDocInfo(docInfo), fileAddResult.fileIdent),
      "file does not exist in new store"
    );
  }

  it("can transfer a file from internal to external storage", async function() {
    await testStoreTransfer(undefined, defaultProvider.listAllStoreIds()[0]);
  });

  it("can transfer a file from external to internal storage", async function() {
    await testStoreTransfer(defaultProvider.listAllStoreIds()[0], undefined);
  });

  it("can transfer a file from external to a different external storage", async function() {
    await testStoreTransfer(defaultProvider.listAllStoreIds()[0], defaultProvider.listAllStoreIds()[1]);
  });

  it("throws an error if the downloaded file is corrupted", async function() {
    const docInfo = { id: "12345", trunkId: null  };
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      docInfo,
    );

    const sourceStoreId = defaultProvider.listAllStoreIds()[0];
    const fileAddResult = await manager.addFile(sourceStoreId, ".txt", Buffer.from(defaultTestFileContent));

    const sourceStore = await defaultProvider.getStore(defaultProvider.listAllStoreIds()[0]);
    const badData = stream.Readable.from(Buffer.from("I am corrupted"));
    await sourceStore?.upload(getDocPoolIdFromDocInfo(docInfo), fileAddResult.fileIdent, badData);

    const transferPromise =
      manager.transferFileToOtherStore(fileAddResult.fileIdent, defaultProvider.listAllStoreIds()[1]);
    await assert.isRejected(transferPromise, AttachmentRetrievalError, "checksum verification failed");
  });

  it("transfers all files in the background", async function() {
    const docInfo = { id: "12345", trunkId: null  };
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      docInfo,
    );

    const allStoreIds = defaultProvider.listAllStoreIds();
    const sourceStoreId = allStoreIds[0];
    const fileAddResult1 = await manager.addFile(sourceStoreId, ".txt", Buffer.from("A"));
    const fileAddResult2 = await manager.addFile(sourceStoreId, ".txt", Buffer.from("B"));
    const fileAddResult3 = await manager.addFile(sourceStoreId, ".txt", Buffer.from("C"));

    await manager.startTransferringAllFilesToOtherStore(allStoreIds[1]);
    assert.isTrue(manager.transferStatus().isRunning);
    await manager.allTransfersCompleted();
    assert.isFalse(manager.transferStatus().isRunning);


    const destStore = (await defaultProvider.getStore(allStoreIds[1]))!;
    const poolId = getDocPoolIdFromDocInfo(docInfo);
    assert.isTrue(await destStore.exists(poolId, fileAddResult1.fileIdent));
    assert.isTrue(await destStore.exists(poolId, fileAddResult2.fileIdent));
    assert.isTrue(await destStore.exists(poolId, fileAddResult3.fileIdent));
  });

  it("uses the most recent transfer destination", async function() {
    const docInfo = { id: "12345", trunkId: null  };
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      docInfo,
    );

    const allStoreIds = defaultProvider.listAllStoreIds();
    const fileAddResult1 = await manager.addFile(allStoreIds[0], ".txt", Buffer.from("A"));

    manager.startTransferringFileToOtherStore(fileAddResult1.fileIdent, allStoreIds[1]);
    manager.startTransferringFileToOtherStore(fileAddResult1.fileIdent, allStoreIds[0]);
    manager.startTransferringFileToOtherStore(fileAddResult1.fileIdent, allStoreIds[1]);
    manager.startTransferringFileToOtherStore(fileAddResult1.fileIdent, allStoreIds[0]);
    await manager.allTransfersCompleted();

    const fileInfo = await defaultDocStorageFake.getFileInfo(fileAddResult1.fileIdent);
    assert.equal(fileInfo?.storageId, allStoreIds[0], "the file should be in the original store");
    // We can't assert on if the files exists in the store, as it might be transferred from A to B and back to A,
    // and so exist in both stores.
  });
});
