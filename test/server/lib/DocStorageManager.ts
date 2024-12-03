/* global describe, before, it */

import {assert} from 'chai';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as tmp from 'tmp';

import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import * as docUtils from 'app/server/lib/docUtils';
import * as testUtils from 'test/server/testUtils';

tmp.setGracefulCleanup();

describe('DocStorageManager', function() {

  // Set Grist home to a temporary directory, and wipe it out on exit.
  let docsRoot: string;
  let docStorageManager: DocStorageManager;
  before(function() {
    return tmp.dirAsync({ prefix: 'grist_test_', unsafeCleanup: true })
    .then(tmpDir => {
      docsRoot = fse.realpathSync(tmpDir);
      docStorageManager = new DocStorageManager(docsRoot);
    });
  });

  describe('getPath', function() {
    it('should return proper full path for docNames', function() {
      assert.equal(docStorageManager.getPath('Hello World'),
        path.join(docsRoot, 'Hello World.grist'));
      assert.equal(docStorageManager.getPath('/foo/bar/Hello.grist'),
                   path.resolve('/foo/bar/Hello.grist'));
    });
  });

  describe("getCanonicalDocName", function() {
    it('should convert alternative names to canonical ones', async function() {
      // Define a shorthand for readability.
      async function verify(altDocName: string, expected: string) {
        const docName = await docStorageManager.getCanonicalDocName(altDocName);
        assert.equal(docName, expected);
      }

      // docNames within docsRoot are represented by a human-friendly name (basename).
      await verify('Hello', 'Hello');
      // Same should be returned if the path is represented differently.
      await verify(path.join(docsRoot, 'Hello.grist'), 'Hello');
      // With or without extension.
      await verify(path.join(docsRoot, 'Hello'), 'Hello');

      // For paths outside of docsRoot, the canonical version is the realpath.
      // For non-existent paths, realpath should leave the path unchanged.
      await verify('/foo/bar/Hello.grist', path.resolve('/foo/bar/Hello.grist'));
      // But extension should always be added.
      await verify('/foo/bar/Hello', path.resolve('/foo/bar/Hello.grist'));
      // Path should always be normalized.
      await verify('/foo/./bar/../Hello', path.resolve('/foo/Hello.grist'));
      // For realistic paths, they should be properly resolved.
      await verify(path.join(docsRoot, '..', 'foo'),
                   path.resolve(docsRoot, '../foo.grist'));
    });
  });

  describe("listDocs", function() {
    it('should list all .grist documents in docsRoot', async function() {
      let docs = await docStorageManager.listDocs();
      assert.deepEqual(docs, []);
      // Create a couple of .grist files for testing.
      fse.writeFileSync(path.join(docsRoot, "World.grist"), "this is a test");
      fse.writeFileSync(path.join(docsRoot, "hello.grist"), "this is a test");
      docs = await docStorageManager.listDocs();
      // Check also that they are sorted in a human-friendly way.
      assert.deepEqual(docs.map(o => o.name), ['hello', 'World']);
    });
  });

  describe("deleteDoc", function() {
    it("should delete document", async function() {
      const doc1 = path.join(docsRoot, "DeleteTest.grist");

      // First create a doc, one under docsRoot, one outside; and include an attachment.
      fse.writeFileSync(doc1, "this is a test");
      const doc2 = tmp.fileSync({
        prefix: 'DeleteTest2', postfix: '.grist', unsafeCleanup: true,
        discardDescriptor: true
      }).name;
      // Check that items got created as we expect.
      assert(await docUtils.pathExists(doc1));
      assert(await docUtils.pathExists(doc2));

      // Now delete things.
      await docStorageManager.deleteDoc(doc1, true);
      // Check that attempting to send items to the trash fails
      await assert.isRejected(docStorageManager.deleteDoc(doc2),
                              /Unable to move document to trash/);
      await docStorageManager.deleteDoc(doc2, true);
      // And check that all the files we created are gone.
      assert(!(await docUtils.pathExists(doc1)));
      assert(!(await docUtils.pathExists(doc2)));
    });
  });

  describe("renameDoc", function() {
    it("should rename document", async function() {
      const doc1 = path.join(docsRoot, "RenameFrom.grist");
      const doc2 = path.join(docsRoot, "RenameTo.grist");
      fse.writeFileSync(doc1, "this is a test");

      // Check that "from" files exist and "to" files don't.
      assert(await docUtils.pathExists(doc1));
      assert(!(await docUtils.pathExists(doc2)));

      // Rename and check that "to" files now exist and "from" files don't.
      await docStorageManager.renameDoc(doc1, doc2);
      assert(!(await docUtils.pathExists(doc1)));
      assert(await docUtils.pathExists(doc2));
    });

    it("Should not allow renaming to an existing file, unless it's the same file", async function() {
      const doc1 = path.join(docsRoot, "Foo.grist");
      const doc2 = path.join(docsRoot, "FOO.grist");
      const doc3 = path.join(docsRoot, "Bar.grist");
      fse.writeFileSync(doc1, "this is Foo test");
      fse.writeFileSync(doc3, "this is Bar test");

      // Check that both files exists, but directory lists only the To file
      let files = fse.readdirSync(docsRoot);
      assert.include(files, "Foo.grist");
      assert.include(files, "Bar.grist");
      assert.notInclude(files, "FOO.grist");

      // Rename and check that the new file has the same
      await docStorageManager.renameDoc(doc1, doc2);
      files = fse.readdirSync(docsRoot);
      assert.notInclude(files, "Foo.grist");
      assert.include(files, "Bar.grist");
      assert.include(files, "FOO.grist");

      const messages = await testUtils.captureLog('warn', () => {
        return testUtils.expectRejection(
          docStorageManager.renameDoc(doc2, doc3), 'EEXIST', /file already exists.*Bar\.grist/)
        .then(() => {
          files = fse.readdirSync(docsRoot);
          assert.notInclude(files, "Foo.grist");
          assert.include(files, "Bar.grist");
          assert.include(files, "FOO.grist");
        });
      });
      testUtils.assertMatchArray(messages, [/file already exists.*Bar/]);
    });
  });
});
