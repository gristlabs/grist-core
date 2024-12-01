import { FilesystemAttachmentStore, IAttachmentStore } from "app/server/lib/AttachmentStore";
import { MemoryWritableStream } from "app/server/utils/MemoryWritableStream";
import { assert } from "chai";
import { createTmpDir } from "../docTools";
import { mkdtemp, pathExists } from 'fs-extra';
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

async function makeTestingFilesystemStore(): Promise<{ store: IAttachmentStore, dir: string }> {
  const tempFolder = await createTmpDir();
  const tempDir = await mkdtemp(path.join(tempFolder, 'filesystem-store-test-'));
  return {
    store: new FilesystemAttachmentStore("test-filesystem-store", tempDir),
    dir: tempDir,
  };
}

describe('FilesystemAttachmentStore', () => {
  it('can upload a file', async () => {
    const { store, dir } = await makeTestingFilesystemStore();
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());

    const exists = await pathExists(path.join(dir, testingDocPoolId, testingFileId));
    assert.isTrue(exists, "uploaded file does not exist on the filesystem");
  });

  it('can download a file', async () => {
    const { store } = await makeTestingFilesystemStore();
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());

    const outputBuffer = new MemoryWritableStream();
    await store.download(testingDocPoolId, testingFileId, outputBuffer);

    assert.equal(outputBuffer.getBuffer().toString(), testingFileContents, "file contents do not match");
  });

  it('can check if a file exists', async () => {
    const { store } = await makeTestingFilesystemStore();

    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());
    assert.isTrue(await store.exists(testingDocPoolId, testingFileId));
  });

  it('can remove an entire pool', async () => {
    const { store } = await makeTestingFilesystemStore();
    await store.upload(testingDocPoolId, testingFileId, getTestingFileAsReadableStream());
    assert.isTrue(await store.exists(testingDocPoolId, testingFileId));

    await store.removePool(testingDocPoolId);

    assert.isFalse(await store.exists(testingDocPoolId, testingFileId));
  });
});
