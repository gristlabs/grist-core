import {
  ExternalStorageAttachmentStore,
  ExternalStorageSupportingAttachments
} from 'app/server/lib/AttachmentStore';
import {MemoryWritableStream} from 'app/server/utils/MemoryWritableStream';

import {assert} from 'chai';
import * as stream from 'node:stream';
import sinon from 'sinon';

const testStoreId = "test-store-1";
const testPoolId = "pool1";
const testFileId = "file1";
const expectedPoolPrefix = "pool1";
const testFileContents = "This is the contents of a file";
const testFileBuffer = Buffer.from(testFileContents);
const getExpectedFilePath = (fileId: string) => `${expectedPoolPrefix}/${fileId}`;

describe('ExternalStorageAttachmentStore', () => {
  it('can upload a file', async () => {
    const fakeStorage = {
      uploadStream: sinon.fake.resolves(undefined),
    };

    const storage = fakeStorage as unknown as ExternalStorageSupportingAttachments;

    const store = new ExternalStorageAttachmentStore(testStoreId, storage);
    const fileStream = stream.Readable.from(testFileBuffer);
    await store.upload(testPoolId, testFileId, fileStream);

    assert.isTrue(fakeStorage.uploadStream.calledOnce, "upload should be called exactly once");
    const call = fakeStorage.uploadStream.getCalls()[0];
    assert.equal(call.args[0], getExpectedFilePath(testFileId), "upload path is incorrect");
    assert.equal(call.args[1], fileStream, "file stream is incorrect");
  });

  it('can download a file', async () => {
    const fileStream = stream.Readable.from(testFileBuffer);
    const fakeStorage = {
      downloadStream: sinon.fake((_, outputStream: stream.Writable) => {
        fileStream.pipe(outputStream);
      })
    };

    const storage = fakeStorage as unknown as ExternalStorageSupportingAttachments;
    const store = new ExternalStorageAttachmentStore(testStoreId, storage);
    const output = new MemoryWritableStream();
    await store.download(testPoolId, testFileId, output);

    assert.isTrue(fakeStorage.downloadStream.calledOnce, "download should be called exactly once");
    const call = fakeStorage.downloadStream.getCalls()[0];
    assert.equal(call.args[0], getExpectedFilePath(testFileId), "download path is incorrect");
    assert.equal(output.getBuffer().toString(), testFileContents, "downloaded file contents don't match");
  });

  it('can check if a file exists', async () => {
    const fakeStorage = {
      exists: sinon.fake.resolves(true),
    };

    const storage = fakeStorage as unknown as ExternalStorageSupportingAttachments;
    const store = new ExternalStorageAttachmentStore(testStoreId, storage);
    const exists = await store.exists(testPoolId, testFileId);

    assert.isTrue(fakeStorage.exists.calledOnce, "exists should be called exactly once");
    const call = fakeStorage.exists.getCalls()[0];
    assert.equal(call.args[0], getExpectedFilePath(testFileId), "file path is incorrect");
    assert.isTrue(exists, "correct exists value should be returned");
  });

  it('can delete a file', async () => {
    const fakeStorage = {
      remove: sinon.fake.resolves(undefined),
    };

    const storage = fakeStorage as unknown as ExternalStorageSupportingAttachments;
    const store = new ExternalStorageAttachmentStore(testStoreId, storage);
    await store.delete(testPoolId, testFileId);

    assert.isTrue(fakeStorage.remove.calledOnce, "remove should be called exactly once");
    const call = fakeStorage.remove.getCalls()[0];
    assert.equal(call.args[0], getExpectedFilePath(testFileId), "file path is incorrect");
  });

  it('can remove an entire pool', async () => {
    const fakeStorage = {
      removeAllWithPrefix: sinon.fake.resolves(undefined),
    };

    const storage = fakeStorage as unknown as ExternalStorageSupportingAttachments;
    const store = new ExternalStorageAttachmentStore(testStoreId, storage);
    await store.removePool(testPoolId);

    assert.isTrue(fakeStorage.removeAllWithPrefix.calledOnce, "removeAllWithPrefix should be called exactly once");
    const call = fakeStorage.removeAllWithPrefix.getCalls()[0];
    assert.equal(call.args[0], expectedPoolPrefix, "path of attachment pool is incorrect");
  });
});
