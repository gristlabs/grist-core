import { DocStorage, FileInfo } from "app/server/lib/DocStorage";
import {
  AttachmentFileManager, AttachmentRetrievalError,
  StoreNotAvailableError,
  StoresNotConfiguredError
} from "app/server/lib/AttachmentFileManager";
import { AttachmentStoreProvider, IAttachmentStoreProvider } from "app/server/lib/AttachmentStoreProvider";
import { makeTestingFilesystemStoreSpec } from "./FilesystemAttachmentStore";
import { assert } from "chai";
import * as sinon from "sinon";

// Minimum features of doc storage that are needed to make AttachmentFileManager work.
type IMinimalDocStorage = Pick<DocStorage, 'docName' | 'getFileInfo' | 'findOrAttachFile'>

// Implements the minimal functionality needed for the AttachmentFileManager to work.
class DocStorageFake implements IMinimalDocStorage {
  private _files: { [key: string]: FileInfo  } = {};

  constructor(public docName: string) {
  }

  public async getFileInfo(fileIdent: string): Promise<FileInfo | null> {
    return this._files[fileIdent] ?? null;
  }

  // Return value is true if the file was newly added.
  public async findOrAttachFile(
    fileIdent: string, fileData: Buffer | undefined, storageId?: string | undefined
  ): Promise<boolean> {
    if (fileIdent in this._files) {
      return false;
    }
    this._files[fileIdent] = {
      ident: fileIdent,
      data: fileData ?? Buffer.alloc(0),
      storageId: storageId ?? null,
    };
    return true;
  }
}

const defaultTestDocName = "1234";
const defaultTestFileContent = "Some content";

function createDocStorageFake(docName: string): DocStorage {
  return new DocStorageFake(docName) as unknown as DocStorage;
}

async function createFakeAttachmentStoreProvider(): Promise<IAttachmentStoreProvider> {
  return new AttachmentStoreProvider(
    [await makeTestingFilesystemStoreSpec("filesystem")],
    "TEST-INSTALLATION-UUID"
  );
}

describe("AttachmentFileManager", function() {
  let defaultProvider: IAttachmentStoreProvider;
  let defaultDocStorageFake: DocStorage;

  beforeEach(async function() {
    defaultProvider = await createFakeAttachmentStoreProvider();
    defaultDocStorageFake = createDocStorageFake(defaultTestDocName);
  });

  it("should throw if uses an external store when no document pool id is available", async function () {
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      undefined,
    );

    const storeId = defaultProvider.listAllStoreIds()[0];

    await assert.isRejected(manager.addFile(storeId, ".txt", Buffer.alloc(0)), StoresNotConfiguredError);
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
    await defaultDocStorageFake.findOrAttachFile(fileId, undefined, "SOME-STORE-ID");

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

  it("should get a file from local storage", async function() {
    const docId = "12345";
    const manager = new AttachmentFileManager(
      defaultDocStorageFake,
      defaultProvider,
      { id: docId, trunkId: null  },
    );

    const result = await manager.addFile(undefined, ".txt", Buffer.from(defaultTestFileContent));
    const fileData = await manager.getFileData(result.fileIdent);

    assert.equal(fileData?.toString(), defaultTestFileContent, "downloaded file contents do not match original file")
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
        sinon.replace(store, 'upload', () => { throw new Error("Upload should never be called") });
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
    assert.equal(fileData!.toString(), defaultTestFileContent);
  });
});
