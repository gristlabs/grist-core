import {DocStorage} from 'app/server/lib/DocStorage';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import {OpenMode, SQLiteDB} from 'app/server/lib/SQLiteDB';
import {promisify} from 'bluebird';
import * as child_process from 'child_process';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as testUtils from 'test/server/testUtils';
import {assert} from 'test/server/testUtils';
import * as tmp from 'tmp';

tmp.setGracefulCleanup();
const execFileAsync = promisify(child_process.execFile);

describe('DocStorageMigrations', function() {

  testUtils.setTmpLogLevel('warn');

  let docStorageManager: DocStorageManager;

  before(async function() {
    // Set Grist home to a temporary directory, and wipe it out on exit.
    let tmpDir = await tmp.dirAsync({ prefix: 'grist_test_', unsafeCleanup: true });
    tmpDir = await fse.realpath(tmpDir);
    docStorageManager = new DocStorageManager(tmpDir);
  });

  async function testMigration(fromName: string, toName: string): Promise<void> {
    const docName: string = await testUtils.useFixtureDoc(fromName, docStorageManager);
    const docPath = docStorageManager.getPath(docName);
    const docStorage = new DocStorage(docStorageManager, docName);
    await docStorage.openFile();
    await docStorage.shutdown();
    const stdout = await execFileAsync('sqlite3', [docPath, '.dump']);

    const expectedPath = path.resolve(testUtils.fixturesRoot, "docs", toName);
    const expectedStdout = await execFileAsync('sqlite3', [expectedPath, '.dump']);
    assert.deepEqual(stdout, expectedStdout);
  }

  it('should migrate from v1 correctly', function() {
    return testMigration('BlobMigrationV1.grist', 'BlobMigrationV9.grist');
  });

  it('should migrate from v2 correctly', function() {
    return testMigration('BlobMigrationV2.grist', 'BlobMigrationV9.grist');
  });

  it('should migrate from v3 correctly', async function() {
    // Open the original file read-only and check that it has no _gristsys_FileInfo table.
    // (Any file would work, we use "BlobMigration" files because they are already there.)
    const docName = await testUtils.useFixtureDoc('BlobMigrationV3.grist', docStorageManager);
    const docPath = docStorageManager.getPath(docName);
    let db = await SQLiteDB.openDBRaw(docPath, OpenMode.OPEN_READONLY);
    await assert.isRejected(db.run('SELECT * FROM _gristsys_FileInfo'), /no such table: _gristsys_FileInfo/);
    await db.close();

    // Migrate by opening with DocStorage.
    const docStorage = new DocStorage(docStorageManager, docName);
    await docStorage.openFile();
    await docStorage.shutdown();

    // Open after migration and check that the table now exists and has a single record.
    db = await SQLiteDB.openDBRaw(docPath, OpenMode.OPEN_READONLY);
    const rows = await db.all('SELECT * FROM _gristsys_FileInfo');
    assert.deepEqual(rows, [{id: 0, docId: '', ownerInstanceId: ''}]);
    await db.close();

    // Also do the test to check out the full document against a saved copy. To know if the copy
    // makes sense, run in test/fixtures/docs:
    //    diff -u <(sqlite3 BlobMigrationV3.grist .dump) <(sqlite3 BlobMigrationV4.grist .dump)
    await testMigration('BlobMigrationV3.grist', 'BlobMigrationV9.grist');
  });

  it('should migrate from v4 correctly', function() {
    return testMigration('BlobMigrationV4.grist', 'BlobMigrationV9.grist');
  });

  it('should migrate from v5 correctly', async function() {
    // The DefaultValuesV5 sample document has two tables, one with correct defaults and values,
    // the other wrong. On migration, one table should be untouched and the other fixed in both
    // the schema (to have correct defaults), and the NULL values in the non-NULL columns.
    //
    // Verify correctness of these fixture files with:
    //  diff -u <(sqlite3 DefaultValuesV5.grist .dump) <(sqlite3 DefaultValuesV7.grist .dump)
    return testMigration('DefaultValuesV5.grist', 'DefaultValuesV9.grist');
  });

  it('should migrate from v6 correctly', async function() {
    // This migration adds formula columns to the database, filled with the value ['P'] (encoded
    // as a marshalled buffer).
    //
    // Verify correctness of updated fixture files with, for instance:
    //  cd test/fixtures/docs ; \
    //    diff -u <(sqlite3 DefaultValuesV6.grist .dump) <(sqlite3 DefaultValuesV7.grist .dump)
    await testMigration('BlobMigrationV6.grist', 'BlobMigrationV9.grist');
    await testMigration('DefaultValuesV6.grist', 'DefaultValuesV9.grist');
  });
});
