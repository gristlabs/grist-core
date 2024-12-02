import { assert } from 'chai';
import { AttachmentStoreProvider, IAttachmentStoreSpecification } from "app/server/lib/AttachmentStoreProvider";
import { makeTestingFilesystemStore } from "./FilesystemAttachmentStore";

function makeFilesystemStoreSpec(typeId: string): IAttachmentStoreSpecification {
  return {
    name: typeId,
    create: async (storeId) => (await makeTestingFilesystemStore(storeId)).store,
  };
}

const testInstallationUUID = "FAKE-UUID";
function expectedStoreId(type: string) {
  return `${testInstallationUUID}-${type}`;
}

describe('AttachmentStoreProvider', () => {
  it('constructs stores using the installations UUID and store type', async () => {
    const filesystemType1 = makeFilesystemStoreSpec("filesystem1");
    const filesystemType2 = makeFilesystemStoreSpec("filesystem2");

    const provider = new AttachmentStoreProvider([filesystemType1, filesystemType2], testInstallationUUID);
    const allStores = await provider.getAllStores();
    const ids = allStores.map(store => store.id);

    assert.includeMembers(ids, [expectedStoreId("filesystem1"), expectedStoreId("filesystem2")]);
  });

  it("can retrieve a store if it exists", async () => {
    const filesystemSpec = makeFilesystemStoreSpec("filesystem");
    const provider = new AttachmentStoreProvider([filesystemSpec], testInstallationUUID);

    assert.isNull(await provider.getStore("doesn't exist"), "store shouldn't exist");

    assert(await provider.getStore(expectedStoreId("filesystem")), "store not present");
  });

  it("can check if a store exists", async () => {
    const filesystemSpec = makeFilesystemStoreSpec("filesystem");
    const provider = new AttachmentStoreProvider([filesystemSpec], testInstallationUUID);

    assert(await provider.storeExists(expectedStoreId("filesystem")));
  });
});
