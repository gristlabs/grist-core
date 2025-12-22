import {
  Archive,
  ArchiveEntry,
  ArchivePackingOptions,
  create_tar_archive,
  create_zip_archive,
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
  },
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

async function assertArchiveContainsTestFiles(archiveData: Buffer) {
  const files = await decompress(archiveData);
  assert.equal(files.length, testFiles.length);

  for (const testFile of testFiles) {
    const zippedFile = files.find(file => file.path === testFile.name);
    assert.notEqual(zippedFile, undefined);
    assert.deepEqual(zippedFile?.data.toString(), testFile.contents);
  }
}

type ArchiveCreator = (entries: AsyncIterable<ArchiveEntry>, options?: ArchivePackingOptions) => Archive;

function testArchive(type: string, makeArchive: ArchiveCreator) {
  it(`should create a ${type} archive`, async function () {
    const archive = makeArchive(generateTestArchiveContents());
    const output = new MemoryWritableStream();
    await archive.packInto(output);
    const archiveData = output.getBuffer();
    await assertArchiveContainsTestFiles(archiveData);
  });

  it('errors in archive.completed if the generator errors', async function () {
    async function* throwErrorGenerator() {
      throw new Error("Test error");
      yield {name: 'Test', size: 0, data: Buffer.from([])};
    }

    // Shouldn't error here - as this just starts the packing.
    const output = new MemoryWritableStream();
    const archive = makeArchive(throwErrorGenerator());
    await assert.isRejected(archive.packInto(output), "Test error");
  });

  it('respects the "endDestStream" option', async function () {
    async function* throwErrorGenerator() {
      throw new Error("Test error");
      yield {name: 'Test', size: 0, data: Buffer.from([])};
    }

    const test = async (archive: Archive, end: boolean, name: string) => {
      const output = new MemoryWritableStream();
      try {
        await archive.packInto(output, { endDestStream: end });
      }
      catch(err) {
        // Do nothing, don't care about this error.
      }
      finally {
        assert.equal(output.closed, end, `expected ${name} to be ${ end ? "closed" : "open" }`);
      }
    };

    await test(makeArchive(generateTestArchiveContents()), false, "successful archive");
    await test(makeArchive(generateTestArchiveContents()), true, "successful archive");
    await test(makeArchive(throwErrorGenerator()), false, "erroring archive");
    await test(makeArchive(throwErrorGenerator()), true, "erroring archive");
  });
}

describe('Archive', function () {
  describe('create_zip_archive', function () {
    const creator: ArchiveCreator = entries => create_zip_archive({store: true}, entries);
    testArchive('zip', creator);
  });
  describe('create_tar_archive', function () {
    const creator: ArchiveCreator = entries => create_tar_archive(entries);
    testArchive('tar', creator);
  });
});
