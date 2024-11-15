import {checksumFile} from 'app/server/lib/checksumFile';
import {assert} from 'chai';
import times = require('lodash/times');
import * as testUtils from 'test/server/testUtils';

describe("#checksumFile", function() {

  it("should compute correct checksum of a small file", async function() {
    const path = await testUtils.writeTmpFile("This is a test.\n");
    assert.equal(await checksumFile(path), "0828324174b10cc867b7255a84a8155cf89e1b8b");
    assert.equal(await checksumFile(path, 'md5'), "02bcabffffd16fe0fc250f08cad95e0c");
  });

  it("should compute correct checksum of the empty file", async function() {
    const path = await testUtils.writeTmpFile("");
    assert.equal(await checksumFile(path), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    assert.equal(await checksumFile(path, 'md5'), "d41d8cd98f00b204e9800998ecf8427e");
  });

  it("should compute correct checksum of a large file", async function() {
    this.timeout(4000);
    // Make the test more intense by doing it a few times in parallel;
    // this helped catch a bug in the implementation that manifested very rarely.
    await Promise.all(times(10, async () => {
      const path = await testUtils.generateTmpFile(100000);   // about 3MB
      assert.equal(await checksumFile(path), "894159eca97e575f0ddbf712175a1853d7d3e619");
      assert.equal(await checksumFile(path, 'md5'), "5dd0680c1ee14351a5aa300d5e6460d6");
    }));
  });

  it("should reject promise on error reading file", async function() {
    await assert.isRejected(checksumFile("/non-existent/foo/bar"), /no such file/);
  });
});
