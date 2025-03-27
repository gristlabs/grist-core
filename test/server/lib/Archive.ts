import {
  Archive,
  ArchiveEntry,
  create_tar_archive,
  create_zip_archive
} from 'app/server/lib/Archive';
import {MemoryWritableStream} from 'app/server/utils/streams';
import decompress from 'decompress';
import {assert} from 'chai';
import * as stream from 'node:stream';

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
  for (const file of testFiles) {
    const buffer = Buffer.from(file.contents);
    yield {
      name: file.name,
      size: buffer.length,
      data: stream.Readable.from(buffer),
    };
  }
}

async function assertArchiveCompletedSuccessfully(archive: Archive) {
  await assert.isFulfilled(archive.completed);
  assert.isTrue(archive.dataStream.destroyed, "archive data stream was not finished");
}

async function assertArchiveFailedWithError(archive: Archive) {
  await assert.isRejected(archive.completed);
  assert.isTrue(archive.dataStream.destroyed, "archive data stream was not finished");
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

type ArchiveCreator = (entries: AsyncIterable<ArchiveEntry>) => Promise<Archive>;

function testArchive(type: string, makeArchive: ArchiveCreator) {
  it(`should create a ${type} archive`, async function () {
    const archive = await makeArchive(generateTestArchiveContents());
    const output = new MemoryWritableStream();
    archive.dataStream.pipe(output);
    await assertArchiveCompletedSuccessfully(archive);

    const archiveData = output.getBuffer();

    await assertArchiveContainsTestFiles(archiveData);
  });

  it('errors in archive.completed if the generator errors', async function () {
    async function* throwErrorGenerator() {
      throw new Error("Test error");
      yield {name: 'Test', size: 0, data: Buffer.from([])};
    }

    // Shouldn't error here - as this just starts the packing.
    const archive = await makeArchive(throwErrorGenerator());
    await assert.isRejected(archive.completed, "Test error");
    await assertArchiveFailedWithError(archive);
  });
}

describe('Archive', function () {
  describe('create_zip_archive', function () {
    const creator: ArchiveCreator = (entries) => create_zip_archive({store: true}, entries);
    testArchive('zip', creator);
  });
  describe('create_tar_archive', function () {
    const creator: ArchiveCreator = (entries) => create_tar_archive(entries);
    testArchive('tar', creator);
  });
});
