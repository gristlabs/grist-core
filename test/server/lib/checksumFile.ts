import { checksumFile, HashPassthroughStream } from "app/server/lib/checksumFile";
import { MemoryWritableStream } from "app/server/utils/streams";
import { assert } from "chai";
import times from "lodash/times";
import stream from "node:stream";
import * as testUtils from "test/server/testUtils";

const testValues = {
  small: {
    contents: "This is a test.\n",
    hashes: {
      sha1: "0828324174b10cc867b7255a84a8155cf89e1b8b",
      md5: "02bcabffffd16fe0fc250f08cad95e0c",
    },
  },
  empty: {
    contents: "",
    hashes: {
      sha1: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
      md5: "d41d8cd98f00b204e9800998ecf8427e",
    },
  },
};

describe("#checksumFile", function() {
  it("should compute correct checksum of a small file", async function() {
    const path = await testUtils.writeTmpFile(testValues.small.contents);
    assert.equal(await checksumFile(path), testValues.small.hashes.sha1);
    assert.equal(await checksumFile(path, "md5"), testValues.small.hashes.md5);
  });

  it("should compute correct checksum of the empty file", async function() {
    const path = await testUtils.writeTmpFile(testValues.empty.contents);
    assert.equal(await checksumFile(path), testValues.empty.hashes.sha1);
    assert.equal(await checksumFile(path, "md5"), testValues.empty.hashes.md5);
  });

  it("should compute correct checksum of a large file", async function() {
    this.timeout(4000);
    // Make the test more intense by doing it a few times in parallel;
    // this helped catch a bug in the implementation that manifested very rarely.
    await Promise.all(times(10, async () => {
      const path = await testUtils.generateTmpFile(100000);   // about 3MB
      assert.equal(await checksumFile(path), "894159eca97e575f0ddbf712175a1853d7d3e619");
      assert.equal(await checksumFile(path, "md5"), "5dd0680c1ee14351a5aa300d5e6460d6");
    }));
  });

  it("should reject promise on error reading file", async function() {
    await assert.isRejected(checksumFile("/non-existent/foo/bar"), /no such file/);
  });
});

describe("HashPassthroughStream", function() {
  async function testStreamHash(contents: string, hash: string, algorithm?: string) {
    const contentBuffer = Buffer.from(contents);
    const sourceStream = stream.Readable.from(contentBuffer);
    const hashStream = new HashPassthroughStream(algorithm);
    const destination = new MemoryWritableStream();
    await stream.promises.pipeline(sourceStream, hashStream, destination);
    assert.equal(hashStream.getDigest(), hash);
    assert(destination.getBuffer().equals(contentBuffer));
  }

  const testCases: (keyof typeof testValues)[] = ["small", "empty"];
  for (const testCase of testCases) {
    it(`can hash a stream (${testCase})`, async function() {
      const values = testValues[testCase];
      await testStreamHash(values.contents, values.hashes.sha1);
      await testStreamHash(values.contents, values.hashes.md5, "md5");
    });
  }

  it(`errors if the stream isn't finished`, async function() {
    const sourceStream = stream.Readable.from(Buffer.from("Doesn't matter"));
    const hashStream = new HashPassthroughStream();
    sourceStream.pipe(hashStream);
    assert.throws(() => hashStream.getDigest(), "must be closed");
  });
});
