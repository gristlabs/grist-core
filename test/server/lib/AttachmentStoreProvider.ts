import {assert} from 'chai';
import {AttachmentStoreProvider} from 'app/server/lib/AttachmentStoreProvider';
import {makeTestingFilesystemStoreSpec} from './FilesystemAttachmentStore';

const testInstallationUUID = "FAKE-UUID";
function expectedStoreId(type: string) {
  return `${testInstallationUUID}-${type}`;
}

describe('AttachmentStoreProvider', () => {
  it('constructs stores using the installations UUID and store type', async () => {
    const filesystemType1 = await makeTestingFilesystemStoreSpec("filesystem1");
    const filesystemType2 = await makeTestingFilesystemStoreSpec("filesystem2");

    const provider = new AttachmentStoreProvider([filesystemType1, filesystemType2], testInstallationUUID);
    const allStores = await provider.getAllStores();
    const ids = allStores.map(store => store.id);

    assert.includeMembers(ids, [expectedStoreId("filesystem1"), expectedStoreId("filesystem2")]);
  });

  it("can retrieve a store if it exists", async () => {
    const filesystemSpec = await makeTestingFilesystemStoreSpec("filesystem");
    const provider = new AttachmentStoreProvider([filesystemSpec], testInstallationUUID);

    assert.isNull(await provider.getStore("doesn't exist"), "store shouldn't exist");

    assert(await provider.getStore(expectedStoreId("filesystem")), "store not present");
  });

  it("can check if a store exists", async () => {
    const filesystemSpec = await makeTestingFilesystemStoreSpec("filesystem");
    const provider = new AttachmentStoreProvider([filesystemSpec], testInstallationUUID);

    assert(await provider.storeExists(expectedStoreId("filesystem")));
  });
});
