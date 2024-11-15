import {setTmpLogLevel} from 'test/server/testUtils';

import {createTmpDir, Deps, fetchURL, moveUpload, UploadSet} from 'app/server/lib/uploads';
import {globalUploadSet} from 'app/server/lib/uploads';
import {delay} from 'bluebird';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import noop = require('lodash/noop');
import pick = require('lodash/pick');
import {Response} from 'node-fetch';
import * as path from 'path';
import * as sinon from 'sinon';
import {Readable} from 'stream';
import {createFile} from 'test/server/docTools';

describe("uploads", function() {

  setTmpLogLevel('warn');

  describe("createTmpDir", function() {
    it("should create and clean up tmp dirs", async function() {
      // Create tmp dir.
      const {tmpDir, cleanupCallback} = await createTmpDir({prefix: "test-uploads-", postfix: "-foo"});
      assert.isTrue(path.basename(tmpDir).startsWith("test-uploads-"));
      assert.isTrue(tmpDir.endsWith("-foo"));

      // Check that it exists.
      assert.isTrue(await fse.pathExists(tmpDir));

      // Touch a file there.
      const filePath = path.join(tmpDir, "hello.txt");
      await fse.outputFile(filePath, "Hello");
      assert.isTrue(await fse.pathExists(filePath));

      // Call cleanupCallback.
      await cleanupCallback();

      // Check that neither file nor directory exist.
      assert.isFalse(await fse.pathExists(filePath));
      assert.isFalse(await fse.pathExists(tmpDir));
    });
  });

  describe("UploadSet", function() {
    it("should allow registering and cleaning uploads", async function() {
      const uploadSet = new UploadSet();

      // Register upload, get id 0.
      const {tmpDir: tmpDir0, cleanupCallback: cleanupCallback0} = await createTmpDir({});
      const files0 = [await createFile(tmpDir0, "aa"), await createFile(tmpDir0, "bb")];
      assert.strictEqual(uploadSet.registerUpload(files0, tmpDir0, cleanupCallback0, null), 0);

      // Register another upload, get uploadId 1.
      const {tmpDir: tmpDir1, cleanupCallback: cleanupCallback1} = await createTmpDir({});
      const files1 = [await createFile(tmpDir1, "cc"), await createFile(tmpDir1, "dd")];
      assert.strictEqual(uploadSet.registerUpload(files1, tmpDir1, cleanupCallback1, null), 1);

      // Check that tmp dirs exist.
      assert.sameMembers(await fse.readdir(tmpDir0), ["aa", "bb"]);
      assert.sameMembers(await fse.readdir(tmpDir1), ["cc", "dd"]);

      // Clean first upload; check that it worked.
      await uploadSet.cleanup(0);

      assert.isFalse(await fse.pathExists(tmpDir0));
      assert.sameMembers(await fse.readdir(tmpDir1), ["cc", "dd"]);

      // Create and register another upload, get uploadId 2 (ids are not reused); this one does
      // NOT clean up tmpDir.
      const {tmpDir: tmpDir2, cleanupCallback: cleanupCallback2} = await createTmpDir({});
      const fakeCleanupCallback2 = sinon.spy();
      const files2 = [await createFile(tmpDir2, "ee"), await createFile(tmpDir2, "ff")];
      assert.strictEqual(uploadSet.registerUpload(files2, null, fakeCleanupCallback2, null), 2);

      assert.isFalse(await fse.pathExists(tmpDir0));
      assert.sameMembers(await fse.readdir(tmpDir1), ["cc", "dd"]);
      assert.sameMembers(await fse.readdir(tmpDir2), ["ee", "ff"]);

      sinon.assert.notCalled(fakeCleanupCallback2);
      await uploadSet.cleanupAll();
      sinon.assert.calledOnce(fakeCleanupCallback2);

      // Assert that it workd.
      assert.isFalse(await fse.pathExists(tmpDir0));
      assert.isFalse(await fse.pathExists(tmpDir1));
      assert.sameMembers(await fse.readdir(tmpDir2), ["ee", "ff"]);

      // Manually clean the remaining dir.
      await cleanupCallback2();
      assert.isFalse(await fse.pathExists(tmpDir2));
    });

    it("should allow moving uploads", async function() {
      const uploadSet = new UploadSet();

      // Register upload, get id 0.
      const {tmpDir: tmpDir0, cleanupCallback: cleanupCallback0} = await createTmpDir({});
      const files0 = [await createFile(tmpDir0, "xx"), await createFile(tmpDir0, "yy")];
      assert.strictEqual(uploadSet.registerUpload(files0, tmpDir0, cleanupCallback0, null), 0);

      // Register another upload without cleanup, get id 1.
      const {tmpDir: tmpDir1, cleanupCallback: cleanupCallback1} = await createTmpDir({});
      const fakeCleanupCallback1 = sinon.spy();
      const files1 = [await createFile(tmpDir1, "zz"), await createFile(tmpDir1, "ww")];
      assert.strictEqual(uploadSet.registerUpload(files1, null, fakeCleanupCallback1, null), 1);

      // Move upload 0: old directory should be gone, new one should exist.
      const {tmpDir: tmpDir2, cleanupCallback: cleanupCallback2} = await createTmpDir({});
      await moveUpload(uploadSet.getUploadInfo(0, null), tmpDir2);
      assert.isFalse(await fse.pathExists(tmpDir0));

      // New directory is a new tmpDir within tmpDir2.
      const moved0 = uploadSet.getUploadInfo(0, null);
      assert.strictEqual(path.dirname(moved0.tmpDir!), tmpDir2);
      assert.sameMembers(await fse.readdir(moved0.tmpDir!), ["xx", "yy"]);
      assert.sameMembers(moved0.files.map(f => f.absPath),
        [path.join(moved0.tmpDir!, "xx"), path.join(moved0.tmpDir!, "yy")]);

      // Move upload 1: old directory should still be there, and new one have copies.
      await moveUpload(uploadSet.getUploadInfo(1, null), tmpDir2);

      // Old directory is still there (this one is not being cleaned up).
      assert.sameMembers(await fse.readdir(tmpDir1), ["zz", "ww"]);

      // New directory should be similar to the first move.
      const moved1 = uploadSet.getUploadInfo(1, null);
      assert.strictEqual(path.dirname(moved1.tmpDir!), tmpDir2);
      assert.sameMembers(await fse.readdir(moved1.tmpDir!), ["zz", "ww"]);
      assert.sameMembers(moved1.files.map(f => f.absPath),
        [path.join(moved1.tmpDir!, "zz"), path.join(moved1.tmpDir!, "ww")]);

      sinon.assert.calledOnce(fakeCleanupCallback1);

      // Cleanup gets rid of all directories maintained by uploadSet.
      await uploadSet.cleanupAll();
      assert.isFalse(await fse.pathExists(moved0.tmpDir!));
      assert.isFalse(await fse.pathExists(moved1.tmpDir!));
      assert.sameMembers(await fse.readdir(tmpDir2), []);
      assert.sameMembers(await fse.readdir(tmpDir1), ["zz", "ww"]);

      // Also clean up the directories we created for the sake of the test.
      await cleanupCallback1();
      await cleanupCallback2();
      assert.isFalse(await fse.pathExists(tmpDir1));
      assert.isFalse(await fse.pathExists(tmpDir2));
    });

    it('should clean up automatically after a timeout', async function() {
      this.timeout(10000);
      const sandbox = sinon.createSandbox();
      const tmpTimeout = 400;
      try {
        sandbox.stub(Deps, 'INACTIVITY_CLEANUP_MS').value(tmpTimeout);

        const uploadSet = new UploadSet();

        // Register upload, get id 0.
        const {tmpDir: tmpDir0, cleanupCallback: cleanupCallback0} = await createTmpDir({});
        const files0 = [await createFile(tmpDir0, "aa"), await createFile(tmpDir0, "bb")];
        assert.strictEqual(uploadSet.registerUpload(files0, tmpDir0, cleanupCallback0, null), 0);

        // Register another upload, get uploadId 1.
        const {tmpDir: tmpDir1, cleanupCallback: cleanupCallback1} = await createTmpDir({});
        const files1 = [await createFile(tmpDir1, "cc"), await createFile(tmpDir1, "dd")];
        assert.strictEqual(uploadSet.registerUpload(files1, tmpDir1, cleanupCallback1, null), 1);

        // Check that tmp dirs exist.
        assert.sameMembers(await fse.readdir(tmpDir0), ["aa", "bb"]);
        assert.sameMembers(await fse.readdir(tmpDir1), ["cc", "dd"]);

        // Wait a bit.
        await delay(200);

        // Check that tmp dirs still exist.
        assert.sameMembers(await fse.readdir(tmpDir0), ["aa", "bb"]);
        assert.sameMembers(await fse.readdir(tmpDir1), ["cc", "dd"]);

        // Touch one of the uploads.
        assert.deepInclude(uploadSet.getUploadInfo(0, null), {uploadId: 0, tmpDir: tmpDir0});

        // Wait a bit longer.
        await delay(250);

        // Upload 1 should now be cleaned out, but not the recently touched upload 0.
        assert.isFalse(await fse.pathExists(tmpDir1));
        assert.sameMembers(await fse.readdir(tmpDir0), ["aa", "bb"]);

        // Wait a bit longer still; now the other one should be clean too.
        await delay(200);
        assert.isFalse(await fse.pathExists(tmpDir0));
      } finally {
        sandbox.restore();
        assert.isAbove(Deps.INACTIVITY_CLEANUP_MS, tmpTimeout);   // Check that .restore() worked
      }
    });

    describe("fetchURL", async function() {
      const sandbox = sinon.createSandbox();

      let response: Response;
      let url: string;

      beforeEach(function() {
        sandbox.stub(Deps, "fetch").callsFake(async () => response);
        sandbox.stub(Response.prototype, "url").get(() => url);
      });

      afterEach(async function() {
        sandbox.restore();
        await globalUploadSet.cleanupAll();
      });

      it("should guess name from content-type if provided", async function() {
        response = new Response(streamify("a, b\n0, 1\n"));
        url = "fake/url";
        response.headers.set("content-type", "text/csv; charset=utf-8");
        const result = await fetchURL(url, null);
        assert.equal(result.files.length, 1);
        assert.deepEqual(pick(result.files[0], ["origName", "ext"]), {origName: "url", ext: ".csv"});
      });

      it("should guess name from url if content-type is missing or text/plain", async function() {
        response = new Response(streamify("a, b\n0, 1\n"));
        // content-type should be shadowed by the type in the url when it's text/plain
        response.headers.set("content-type", "text/plain; charset=utf-8");
        url = "fake/url/file.csv";
        const result = await fetchURL(url, null);
        assert.equal(result.files.length, 1);
        assert.deepEqual(pick(result.files[0], ["origName", "ext"]), {origName: "file.csv", ext: ".csv"});

        // Just URL extension should be used if no content type.
        response = new Response(streamify("a, b\n0, 1\n"));
        url = "fake/url/file2.csv";
        const result2 = await fetchURL(url, null);
        assert.equal(result2.files.length, 1);
        assert.deepEqual(pick(result2.files[0], ["origName", "ext"]), {origName: "file2.csv", ext: ".csv"});

        // Content-type should be used in other cases.
        response = new Response(streamify("a, b\n0, 1\n"));
        response.headers.set("content-type", "application/json; charset=utf-8");
        url = "fake/url/file3.csv";
        const result3 = await fetchURL(url, null);
        assert.equal(result3.files.length, 1);
        assert.deepEqual(pick(result3.files[0], ["origName", "ext"]), {origName: "file3.csv", ext: ".json"});
      });
    });

    it("should respect access ids for uploads", async function() {
      const uploadSet = new UploadSet();

      // Register upload for accessId x42, get uploadId 0.
      const {tmpDir: tmpDir0, cleanupCallback: cleanupCallback0} = await createTmpDir({});
      const files0 = [await createFile(tmpDir0, "aa"), await createFile(tmpDir0, "bb")];
      assert.strictEqual(uploadSet.registerUpload(files0, tmpDir0, cleanupCallback0, "x42"), 0);

      // Register upload for accessId x43, get uploadId 1.
      const {tmpDir: tmpDir1, cleanupCallback: cleanupCallback1} = await createTmpDir({});
      const files1 = [await createFile(tmpDir1, "cc"), await createFile(tmpDir1, "dd")];
      assert.strictEqual(uploadSet.registerUpload(files1, tmpDir1, cleanupCallback1, "x43"), 1);

      // Check that we can access uploadId 0 with accessId x42 but not x43 or null.
      assert.isObject(uploadSet.getUploadInfo(0, "x42"));
      assert.throws(() => uploadSet.getUploadInfo(0, "x43"), /access denied/i);
      assert.throws(() => uploadSet.getUploadInfo(0, null), /access denied/i);

      // Check that we can access uploadId 1 with accessId x43 but not x42 or null.
      assert.isObject(uploadSet.getUploadInfo(1, "x43"));
      assert.throws(() => uploadSet.getUploadInfo(1, "x42"), /access denied/i);
      assert.throws(() => uploadSet.getUploadInfo(1, null), /access denied/i);

      // Check that noone can access uploadId 2 (non-existent)
      assert.throws(() => uploadSet.getUploadInfo(2, "x42"), /unknown upload/i);
      assert.throws(() => uploadSet.getUploadInfo(2, "x43"), /unknown upload/i);
      assert.throws(() => uploadSet.getUploadInfo(2, null), /unknown upload/i);

      await uploadSet.cleanupAll();
    });
  });
});

function streamify(str: string): Readable {
  const s = new Readable();
  s._read = noop;
  s.push(str);
  s.push(null);
  return s;
}
