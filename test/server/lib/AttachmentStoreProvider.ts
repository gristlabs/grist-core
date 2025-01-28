import {assert} from 'chai';
import {
  AttachmentStoreProvider,
} from 'app/server/lib/AttachmentStoreProvider';
import {
  makeTestingFilesystemStoreConfig,
} from 'test/server/lib/FilesystemAttachmentStore';

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
