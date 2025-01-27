import {FilesystemAttachmentStore} from 'app/server/lib/AttachmentStore';
import {IAttachmentStoreConfig} from 'app/server/lib/AttachmentStoreProvider';
import {MemoryWritableStream} from 'app/server/utils/MemoryWritableStream';
import {createTmpDir} from 'test/server/docTools';

import {assert} from 'chai';
import {mkdtemp, pathExists} from 'fs-extra';
import * as stream from 'node:stream';
import * as path from 'path';

const testingDocPoolId = "1234-5678";
const testingFileId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.grist";
const testingFileContents = "Grist is the best tool ever.";

function getTestingFileAsBuffer(contents: string = testingFileContents) {
  return Buffer.from(contents, 'utf8');
}

function getTestingFileAsReadableStream(contents?: string): stream.Readable {
  return stream.Readable.from(getTestingFileAsBuffer(contents));
}

export async function makeTestingFilesystemStoreSpec(
  name: string = "filesystem"
) {
  const tempFolder = await createTmpDir();
  const tempDir = await mkdtemp(path.join(tempFolder, 'filesystem-store-test-'));
  return {
    rootDirectory: tempDir,
    name,
    create: async (storeId: string) => (new FilesystemAttachmentStore(storeId, tempDir))
  };
}

export async function makeTestingFilesystemStoreConfig(
  name: string = "test-filesystem"
): Promise<IAttachmentStoreConfig> {
  return {
    label: name,
    spec: await makeTestingFilesystemStoreSpec(name),
  };
}

describe('FilesystemAttachmentStore', () => {
  it('can upload a file', async () => {
    const spec = await makeTestingFilesystemStoreSpec();
    const store = await spec.create("test-filesystem-store");
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());

    const exists = await pathExists(path.join(spec.rootDirectory, testingDocPoolId, testingFileId));
    assert.isTrue(exists, "uploaded file does not exist on the filesystem");
  });

  it('can download a file', async () => {
    const spec = await makeTestingFilesystemStoreSpec();
    const store = await spec.create("test-filesystem-store");
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());

    const outputBuffer = new MemoryWritableStream();
    await store.download(testingDocPoolId, testingFileId, outputBuffer);

    assert.equal(outputBuffer.getBuffer().toString(), testingFileContents, "file contents do not match");
  });

  it('can check if a file exists', async () => {
    const spec = await makeTestingFilesystemStoreSpec();
    const store = await spec.create("test-filesystem-store");

    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());
    assert.isTrue(await store.exists(testingDocPoolId, testingFileId));
  });

  it('can delete a file', async () => {
    const spec = await makeTestingFilesystemStoreSpec();
    const store = await spec.create("test-filesystem-store");

    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());
    assert.isTrue(await store.exists(testingDocPoolId, testingFileId));
    await store.delete(testingDocPoolId, testingFileId);
    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
  });

  it('can remove an entire pool', async () => {
    const spec = await makeTestingFilesystemStoreSpec();
    const store = await spec.create("test-filesystem-store");
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());
    assert.isTrue(await store.exists(testingDocPoolId, testingFileId));

    await store.removePool(testingDocPoolId);

    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
  });
});
