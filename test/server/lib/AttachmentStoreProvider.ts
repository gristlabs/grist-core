import {ObjMetadata, ObjSnapshot, ObjSnapshotWithMetadata} from 'app/common/DocSnapshot';
import {ExternalStorageSupportingAttachments} from 'app/server/lib/AttachmentStore';
import {AttachmentStoreProvider} from 'app/server/lib/AttachmentStoreProvider';
import {CoreCreate} from 'app/server/lib/coreCreator';
import {ExternalStorage, Unchanged} from 'app/server/lib/ExternalStorage';
import {makeTestingFilesystemStoreConfig} from 'test/server/lib/FilesystemAttachmentStore';
import {assert} from 'chai';
import {Readable, Writable} from 'form-data';

const testInstallationUUID = "FAKE-UUID";

function expectedStoreId(label: string) {
  return `${testInstallationUUID}-${label}`;
}

describe('AttachmentStoreProvider', () => {
  it('constructs stores using the installations UID and store type', async () => {
    const storesConfig = [
      await makeTestingFilesystemStoreConfig("filesystem1"),
      await makeTestingFilesystemStoreConfig("filesystem2")
    ];

    const provider = new AttachmentStoreProvider(storesConfig, testInstallationUUID);
    const allStores = await provider.getAllStores();
    const ids = allStores.map(store => store.id);

    assert.deepEqual(ids, [expectedStoreId("filesystem1"), expectedStoreId("filesystem2")]);

    const allStoreIds = provider.listAllStoreIds();
    assert.deepEqual(allStoreIds, [expectedStoreId("filesystem1"), expectedStoreId("filesystem2")]);
  });

  it("can retrieve a store if it exists", async () => {
    const storesConfig = [
      await makeTestingFilesystemStoreConfig("filesystem1"),
    ];

    const provider = new AttachmentStoreProvider(storesConfig, testInstallationUUID);

    assert.isNull(await provider.getStore("doesn't exist"), "store shouldn't exist");

    assert(await provider.getStore(expectedStoreId("filesystem1")), "store not present");
  });

  it("can check if a store exists", async () => {
    const storesConfig = [
      await makeTestingFilesystemStoreConfig("filesystem1"),
    ];

    const provider = new AttachmentStoreProvider(storesConfig, testInstallationUUID);

    assert(await provider.storeExists(expectedStoreId("filesystem1")));
  });
});

describe("Snapshot attachment store option", () => {
  it("is not available if the external storage is undefined", async () => {
    const create = new CoreCreatorExternalStorageStub(() => undefined);
    const isAvailable = await create.getAttachmentStoreOptions().snapshots.isAvailable();
    assert.isFalse(isAvailable);
  });

  it("is not available if the external storage doesn't implement the right methods", async () => {
    const create = new CoreCreatorExternalStorageStub(() => new FakeExternalStorage());
    const isAvailable = await create.getAttachmentStoreOptions().snapshots.isAvailable();
    assert.isFalse(isAvailable);
  });

  it("is available if the external storage supports attachments", async () => {
    const create = new CoreCreatorExternalStorageStub(() => new FakeAttachmentExternalStorage());
    const isAvailable = await create.getAttachmentStoreOptions().snapshots.isAvailable();
    assert.isTrue(isAvailable);
  });

  it("throws if the external storage is being used but doesn't support attachments", async () => {
    const create = new CoreCreatorExternalStorageStub(() => new FakeExternalStorage());
    await assert.isRejected(create.getAttachmentStoreOptions().snapshots.create("anything"));
  });

  it("can be used if the external storage supports attachments", async () => {
    const create = new CoreCreatorExternalStorageStub(() => new FakeAttachmentExternalStorage());
    const store = await create.getAttachmentStoreOptions().snapshots.create("anything");
    // Exact method checked doesn't matter - just that we get a valid instance.
    assert.isFalse(await store.exists("pool1", "doc1"));
  });
});

class FakeExternalStorage implements ExternalStorage {
  public async exists(key: string, snapshotId?: string | undefined): Promise<boolean> {
    return false;
  }
  public async head(key: string, snapshotId?: string | undefined): Promise<ObjSnapshotWithMetadata | null> {
    return null;
  }
  public async upload(
    key: string, fname: string, metadata?: ObjMetadata | undefined
  ): Promise<string | typeof Unchanged | null> {
    return null;
  }
  public async download(key: string, fname: string, snapshotId?: string | undefined): Promise<string> {
    return "";
  }
  public async remove(key: string, snapshotIds?: string[] | undefined): Promise<void> {
    return;
  }
  public async versions(key: string): Promise<ObjSnapshot[]> {
    return [];
  }
  public url(key: string): string {
    return "";
  }
  public isFatalError(err: any): boolean {
    return false;
  }
  public async close(): Promise<void> {}
}

class FakeAttachmentExternalStorage extends FakeExternalStorage implements ExternalStorageSupportingAttachments {
  public async uploadStream(
    key: string, inStream: Readable, metadata?: ObjMetadata | undefined
  ): Promise<string | typeof Unchanged | null> {
    return null;
  }
  public async downloadStream(key: string, outStream: Writable, snapshotId?: string | undefined): Promise<string> {
    return "";
  }
  public async removeAllWithPrefix(prefix: string): Promise<void> {
    return;
  }
}

class CoreCreatorExternalStorageStub extends CoreCreate {
  constructor(private _makeStore: () => ExternalStorage | undefined) {
    super();
  }
  public override ExternalStorage(): ExternalStorage | undefined {
    return this._makeStore();
  }
}
