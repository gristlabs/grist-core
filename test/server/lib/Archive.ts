import * as stream from 'node:stream';
import {Archive, create_zip_archive} from 'app/server/lib/Archive';
import {MemoryWritableStream} from 'app/server/utils/MemoryWritableStream';
import decompress from 'decompress';
import {assert} from 'chai';

const testFiles = [
  {
    name: "Test1.txt",
    contents: "This is the contents of a test file.",
  },
  {
    name: "Test2.txt",
    contents: "This is some other file.",
  }
];

async function* generateTestArchiveContents() {
  yield {
    name: testFiles[0].name,
    data: stream.Readable.from(Buffer.from(testFiles[0].contents))
  };
  yield {
    name: testFiles[1].name,
    data: Buffer.from(testFiles[1].contents)
  };
}

async function assertArchiveCompletedSuccessfully(archive: Archive) {
  await assert.isFulfilled(archive.completed);
  assert.isTrue(archive.dataStream.closed, "archive data stream was not closed");
}

async function assertArchiveFailedWithError(archive: Archive) {
  await assert.isRejected(archive.completed);
  assert.isTrue(archive.dataStream.closed, "archive data stream was not closed");
}

async function assertArchiveContainsTestFiles(archiveData: Buffer) {
  const files = await decompress(archiveData);
  assert.equal(files.length, testFiles.length);

  for (const testFile of testFiles) {
    const zippedFile = files.find((file) => file.path === testFile.name);
    assert.notEqual(zippedFile, undefined);
    assert.deepEqual(zippedFile?.data.toString(), testFile.contents);
  }
}

describe('create_zip_archive', function () {
  it('should create a zip archive', async function () {
    const archive = await create_zip_archive({ store: true }, generateTestArchiveContents());
    const output = new MemoryWritableStream();
    archive.dataStream.pipe(output);
    await assertArchiveCompletedSuccessfully(archive);

    const archiveData = output.getBuffer();

    await assertArchiveContainsTestFiles(archiveData);
  });

  it('errors in archive.completed if the generator errors', async function () {
    async function* throwErrorGenerator() {
      throw new Error("Test error");
      yield {name: testFiles[0].name, data: Buffer.from(testFiles[0].contents)};
    }


    // Shouldn't error here - as this just starts the packing.
    const archive = await create_zip_archive({store: true}, throwErrorGenerator());
    await assert.isRejected(archive.completed, "Test error");
    await assertArchiveFailedWithError(archive);
  });
});
