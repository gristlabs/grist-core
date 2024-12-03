import {assert} from 'chai';
import * as fse from 'fs-extra';
import {map, noop} from 'lodash';
import {join as pathJoin} from 'path';
import * as tmp from 'tmp';

import {delay} from 'app/common/delay';
import {OpenMode, SchemaInfo, SQLiteDB} from 'app/server/lib/SQLiteDB';
import * as testUtils from 'test/server/testUtils';

tmp.setGracefulCleanup();

describe('SQLiteDB', function() {
  let tmpDir: string;

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('warn');

  before(async function() {
    // Create a temporary directory, and wipe it out on exit.
    tmpDir = await tmp.dirAsync({ prefix: 'grist_test_SQLiteDB_', unsafeCleanup: true });
  });

  after(async function() {
    await fse.remove(tmpDir);
  });

  // Convenience helpers to make tests more concise and readable.
  function dbPath(fileName: string): string {
    return pathJoin(tmpDir, fileName);
  }

  async function getTableNames(sdb: SQLiteDB): Promise<string[]> {
    return map(await sdb.all("SELECT * FROM sqlite_master WHERE type='table'"), 'name');
  }

  it('should create correct schema for a new DB', async function() {
    assert.isFalse(await fse.pathExists(dbPath('test1A')));
    const sdb = await SQLiteDB.openDB(dbPath('test1A'), schemaInfo, OpenMode.OPEN_CREATE);
    assert.isTrue(await fse.pathExists(dbPath('test1A')));

    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    assert.deepEqual(await sdb.collectMetadata(), {
      Foo: {A: 'TEXT', B: 'NUMERIC'},
      Bar: {C: 'TEXT', D: 'NUMERIC'},
    });
    await sdb.close();
  });

  it('should support all OpenMode values', async function() {
    let sdb: SQLiteDB;

    // Check that OPEN_CREATE works for both new and existing DB.
    assert.isFalse(await fse.pathExists(dbPath('test2A')));
    sdb = await SQLiteDB.openDB(dbPath('test2A'), schemaInfo, OpenMode.OPEN_CREATE);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    await sdb.close();

    assert.isTrue(await fse.pathExists(dbPath('test2A')));
    sdb = await SQLiteDB.openDB(dbPath('test2A'), schemaInfo, OpenMode.OPEN_CREATE);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    await sdb.close();

    // Check that OPEN_EXISTING works for existing but fails for new.
    sdb = await SQLiteDB.openDB(dbPath('test2A'), schemaInfo, OpenMode.OPEN_EXISTING);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    await sdb.close();

    assert.isFalse(await fse.pathExists(dbPath('test2B')));
    await assert.isRejected(SQLiteDB.openDB(dbPath('test2B'), schemaInfo, OpenMode.OPEN_EXISTING),
      /unable to open database/);
    assert.isFalse(await fse.pathExists(dbPath('test2B')));

    // Check that OPEN_READONLY works for existing, fails for new, and prevents changes.
    await assert.isRejected(SQLiteDB.openDB(dbPath('test2B'), schemaInfo, OpenMode.OPEN_READONLY),
      /unable to open database/);
    sdb = await SQLiteDB.openDB(dbPath('test2A'), schemaInfo, OpenMode.OPEN_READONLY);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    await assert.isRejected(sdb.run('INSERT INTO Foo (A) VALUES ("hello")'),
      /readonly database/);
    await sdb.close();

    // Check that OPEN_READONLY works when a migration is required, without a migration.
    sdb = await SQLiteDB.openDB(dbPath('test2C'), schemaInfoV1, OpenMode.OPEN_CREATE);
    await sdb.close();
    await testUtils.captureLog('warn', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test2C'), schemaInfo, OpenMode.OPEN_READONLY);
    });
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    assert.strictEqual(sdb.migrationBackupPath, null);
    await sdb.close();

    // Check that CREATE_EXCL works for new, fails for existing.
    assert.isFalse(await fse.pathExists(dbPath('test2D')));
    sdb = await SQLiteDB.openDB(dbPath('test2D'), schemaInfo, OpenMode.CREATE_EXCL);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    await sdb.close();

    assert.isTrue(await fse.pathExists(dbPath('test2D')));
    await assert.isRejected(SQLiteDB.openDB(dbPath('test2D'), schemaInfo, OpenMode.CREATE_EXCL),
      /already exists/);
    assert.isTrue(await fse.pathExists(dbPath('test2D')));
  });

  it('should warn about opening the same DB more than once', async function() {
    // Open a database.
    const sdb = await SQLiteDB.openDB(dbPath('testWarn'), schemaInfo, OpenMode.OPEN_CREATE);
    let msgs: string[];

    // Open the same database again, with open() and openRaw()
    msgs = await testUtils.captureLog('warn', async () => {
      const sdb2 = await SQLiteDB.openDB(dbPath('testWarn'), schemaInfo, OpenMode.OPEN_EXISTING);
      await sdb2.close();
      const sdb3 = await SQLiteDB.openDBRaw(dbPath('testWarn'), OpenMode.OPEN_EXISTING);
      await sdb3.close();
    });
    testUtils.assertMatchArray(msgs, [
      /\/testWarn.* avoid opening same DB more than once/,
      /\/testWarn.* avoid opening same DB more than once/,
    ]);

    // Close and repeat the test: should have no errors.
    await sdb.close();
    msgs = await testUtils.captureLog('warn', async () => {
      const sdb2 = await SQLiteDB.openDB(dbPath('testWarn'), schemaInfo, OpenMode.OPEN_EXISTING);
      await sdb2.close();
      const sdb3 = await SQLiteDB.openDBRaw(dbPath('testWarn'), OpenMode.OPEN_EXISTING);
      await sdb3.close();
    });
    testUtils.assertMatchArray(msgs, []);
  });

  it('should apply migrations, with backup, if needed', async function() {
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    let msgs: string[];

    // On creating a V1 schema doc.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3A'), schemaInfoV1, OpenMode.CREATE_EXCL);
    });
    assert.deepEqual(msgs, []);                         // No warnings.
    assert.strictEqual(sdb.migrationBackupPath, null);  // No migration backup.
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    await sdb.close();

    // On reopen using V1 schema.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3A'), schemaInfoV1, OpenMode.OPEN_EXISTING);
    });
    assert.deepEqual(msgs, []);                         // No warnings.
    assert.strictEqual(sdb.migrationBackupPath, null);  // No migration backup.
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    assert.deepEqual(await sdb.collectMetadata(), { Foo: {A: 'TEXT'} });
    await sdb.close();

    // On reopen using V2 schema.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3A'), schemaInfoV2, OpenMode.OPEN_EXISTING);
    });
    testUtils.assertMatchArray(msgs, [
      /\/test3A.* needs migration from version 1 to 2/,
      /\/test3A.* backed up to .*\/test3A\.[0-9-]+\.V1\.bak, migrated to 2/,
    ]);
    assert.match(sdb.migrationBackupPath!, /test3A\.\d{4}-\d{2}-\d{2}\.V1\.bak$/);
    assert.isTrue(await fse.pathExists(sdb.migrationBackupPath!));
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    assert.deepEqual(await sdb.collectMetadata(), {
      Foo: {A: 'TEXT', B: 'NUMERIC'},
      Bar: {D: 'NUMERIC'},
    });
    await sdb.close();

    // Check that the backup makes sense.
    const migrationSDB = await SQLiteDB.openDB(
      sdb.migrationBackupPath!, schemaInfoV1, OpenMode.OPEN_READONLY);
    assert.deepEqual(await migrationSDB.collectMetadata(), { Foo: {A: 'TEXT'} });
    await migrationSDB.close();

    // On reopen using V3 schema.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3A'), schemaInfo, OpenMode.OPEN_EXISTING);
    });
    testUtils.assertMatchArray(msgs, [
      /\/test3A.* needs migration from version 2 to 3/,
      /\/test3A.* backed up to .*\/test3A\.[0-9-]+\.V2\.bak, migrated to 3/,
    ]);
    assert.match(sdb.migrationBackupPath!, /test3A\.\d{4}-\d{2}-\d{2}\.V2\.bak$/);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    assert.deepEqual(await sdb.collectMetadata(), {
      Foo: {A: 'TEXT', B: 'NUMERIC'},
      Bar: {C: 'TEXT', D: 'NUMERIC'},
    });
    await sdb.close();

    // Second reopen using V3 schema.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3A'), schemaInfo, OpenMode.OPEN_EXISTING);
    });
    assert.deepEqual(msgs, []);                         // No warnings.
    assert.strictEqual(sdb.migrationBackupPath, null);  // No migration backup.
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    assert.deepEqual(await sdb.collectMetadata(), {
      Foo: {A: 'TEXT', B: 'NUMERIC'},
      Bar: {C: 'TEXT', D: 'NUMERIC'},
    });
    await sdb.close();
  });

  it('should allow migrating across multiple versions', async function() {
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    let msgs: string[];
    // Open a document at V1, then migrate directly to V3 skipping V2.
    sdb = await SQLiteDB.openDB(dbPath('test3B'), schemaInfoV1, OpenMode.CREATE_EXCL);
    assert.strictEqual(await sdb.getMigrationVersion(), 1);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    await sdb.close();
    assert.strictEqual(await SQLiteDB.getMigrationVersion(dbPath('test3B')), 1);

    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test3B'), schemaInfo, OpenMode.OPEN_EXISTING);
    });
    assert.strictEqual(await sdb.getMigrationVersion(), 3);
    testUtils.assertMatchArray(msgs, [
      /\/test3B.* needs migration from version 1 to 3/,
      /\/test3B.* backed up to .*\/test3B\.[0-9-]+\.V1\.bak, migrated to 3/,
    ]);
    msgs = await testUtils.captureLog('info', async () => {
      assert.strictEqual(await SQLiteDB.getMigrationVersion(dbPath('test3B')), 3);
    });
    testUtils.assertMatchArray(msgs, [
      /\/test3B.* avoid opening same DB more than once/,
    ]);
    assert.match(sdb.migrationBackupPath!, /test3B\.\d{4}-\d{2}-\d{2}\.V1\.bak$/);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo', 'Bar']);
    assert.deepEqual(await sdb.collectMetadata(), {
      Foo: {A: 'TEXT', B: 'NUMERIC'},
      Bar: {C: 'TEXT', D: 'NUMERIC'},
    });
    await sdb.close();
  });

  it('should open read-only files needing migration', async function() {
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    // Open a document at V1, then open READONLY with v3.
    sdb = await SQLiteDB.openDB(dbPath('testRO'), schemaInfoV1, OpenMode.CREATE_EXCL);
    assert.strictEqual(await sdb.getMigrationVersion(), 1);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    await sdb.close();

    await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('testRO'), schemaInfo, OpenMode.OPEN_READONLY);
    });
    assert.strictEqual(await sdb.getMigrationVersion(), 1);
    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    assert.match(sdb.migrationError!.message, /migration .* readonly/);
  });

  it('should migrate DBs created without versioning', async function() {
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    sdb = await SQLiteDB.openDBRaw(dbPath('testPRE'), OpenMode.OPEN_CREATE);
    await sdb.exec('CREATE TABLE _grist_Foo (A TEXT)');
    void sdb.close();

    async function create(db: SQLiteDB) {
      await db.exec('CREATE TABLE _grist_Foo (A TEXT)');
    }
    async function migrateV0(db: SQLiteDB) {
      await db.exec('CREATE TABLE IF NOT EXISTS _grist_Bar (B TEXT)');
    }

    sdb = await SQLiteDB.openDB(dbPath('testPRE'), {create, migrations: [migrateV0]}, OpenMode.OPEN_CREATE);
    assert.strictEqual(await sdb.getMigrationVersion(), 1);
    assert.sameDeepMembers(await getTableNames(sdb), ['_grist_Foo', '_grist_Bar']);
    assert.match(sdb.migrationBackupPath!, /testPRE\..*\.V0\.bak$/);
    void sdb.close();

    // Simulate new schema version.
    async function create2(db: SQLiteDB) {
      await db.exec('CREATE TABLE _grist_Foo (A TEXT)');
      await db.exec('CREATE TABLE _grist_Bar (B TEXT, X TEXT)');
    }
    async function migrateV1(db: SQLiteDB) {
      await db.exec('CREATE TABLE IF NOT EXISTS _grist_Bar (B TEXT, X TEXT)');
    }

    sdb = await SQLiteDB.openDBRaw(dbPath('testPRE2'), OpenMode.OPEN_CREATE);
    await create2(sdb);
    void sdb.close();
    sdb = await SQLiteDB.openDB(dbPath('testPRE2'),
      {create: create2, migrations: [migrateV0, migrateV1]}, OpenMode.OPEN_CREATE);
    assert.strictEqual(await sdb.getMigrationVersion(), 2);
    assert.sameDeepMembers(await getTableNames(sdb), ['_grist_Foo', '_grist_Bar']);
    assert.match(sdb.migrationBackupPath!, /testPRE2\..*\.V0\.bak$/);
    void sdb.close();
  });

  it('should skip migration backup on migration failure', async function() {
    // Create a document at V1.
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    let msgs: string[];

    // Create a V1 schema doc.
    sdb = await SQLiteDB.openDB(dbPath('test4A'), schemaInfoV1, OpenMode.CREATE_EXCL);
    await sdb.close();

    // Open it using a broken V4 version. When the migration fails, we complain but continue with
    // unmigrated DB, and expose a `.migrationError` property.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test4A'), schemaInfoV4Broken, OpenMode.OPEN_EXISTING);
    });
    testUtils.assertMatchArray(msgs, [
      /\/test4A.* needs migration from version 1 to 4/,
      /\/test4A.* migration from 1 to 4 failed.*"SOME_INVALID_SQL".*syntax error/,
      /table Foo does not match schema/,
      /table Bar does not match schema/,
    ]);
    // Check the migrationError property.
    assert.match(sdb.migrationError!.message, /migration to 4.*SOME_INVALID_SQL.*syntax error/);
    // Check that migrationBackupPath isn't set.
    assert.strictEqual(sdb.migrationBackupPath, null);

    assert.sameDeepMembers(await getTableNames(sdb), ['Foo']);
    assert.deepEqual(await sdb.collectMetadata(), { Foo: {A: 'TEXT'} });
    await sdb.close();

    // Check that the only file with test4A is our file, i.e. no extra files got created.
    assert.deepEqual((await fse.readdir(tmpDir)).filter(d => /test4A/.test(d)), ['test4A']);

    // Check also that if we open READONLY with a bad migration, we only get discrepancy warnings.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test4A'), schemaInfoV4Broken, OpenMode.OPEN_READONLY);
    });
    testUtils.assertMatchArray(msgs, [
      /table Foo does not match schema/,
      /table Bar does not match schema/,
    ]);
    assert.match(sdb.migrationError!.message, /migration .* readonly/);
    assert.strictEqual(sdb.migrationBackupPath, null);
    await sdb.close();
  });

  it('should warn if DB is incorrect, incl after migrations', async function() {
    let sdb: SQLiteDB = null as any;    // To silence warnings about use before assignment.
    let msgs: string[];

    // Create a doc.
    sdb = await SQLiteDB.openDB(dbPath('test5A'), schemaInfo, OpenMode.CREATE_EXCL);
    assert.strictEqual(sdb.migrationBackupPath, null);

    // Now modify its schema.
    await sdb.exec("ALTER TABLE Foo ADD COLUMN Unplanned TEXT");
    await sdb.close();

    // Reopening should produce warnings.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test5A'), schemaInfo, OpenMode.OPEN_CREATE);
    });
    assert.strictEqual(sdb.migrationBackupPath, null);
    testUtils.assertMatchArray(msgs, [
      /warn:.*\/test5A.* table Foo does not match schema.*Unplanned/,
    ]);
    await sdb.close();

    // Now create a doc using V1 and migrate to an inconsitent migration.
    sdb = await SQLiteDB.openDB(dbPath('test5B'), schemaInfoV1, OpenMode.CREATE_EXCL);
    assert.strictEqual(sdb.migrationBackupPath, null);
    await sdb.close();

    // Use a migration that doesn't match the create() func.
    msgs = await testUtils.captureLog('info', async () => {
      sdb = await SQLiteDB.openDB(dbPath('test5B'), schemaInfoV2Inconsistent, OpenMode.OPEN_CREATE);
    });
    assert.match(sdb.migrationBackupPath!, /test5B\.\d{4}-\d{2}-\d{2}\.V1\.bak$/);
    assert.strictEqual(sdb.migrationError, null);
    testUtils.assertMatchArray(msgs, [
      /\/test5B.* needs migration from version 1 to 2/,
      /\/test5B.* backed up to .*\/test5B\.[0-9-]+\.V1\.bak, migrated to 2/,
      /warn: .*table Foo does not match schema.*BadCol/,
    ]);
  });

  describe('execTransaction', function() {
    it("should run callback inside a transaction", async function() {
      const sdb = await SQLiteDB.openDB(dbPath('testTrans1'), schemaInfo, OpenMode.OPEN_CREATE);

      // Simple case: just run a statement and it should succeed.
      await sdb.execTransaction(() => sdb.exec('INSERT INTO Foo (A) VALUES ("hello")'));
      assert.deepEqual(await sdb.all("SELECT A FROM Foo"), [{A: "hello"}]);

      // Now try running one statement that should succeed, and then failing inside the
      // transaction; it should be rolled back along with the first statement.
      await assert.isRejected(sdb.execTransaction(async () => {
        await sdb.exec('INSERT INTO Foo (A) VALUES ("good bye")');
        throw new Error("Fake error");
      }), /Fake error/);
      // Ensure that the new value did NOT get added.
      assert.deepEqual(await sdb.all("SELECT A FROM Foo"), [{A: "hello"}]);
      void sdb.close();
    });

    it("should serialize execTransaction calls", async function() {
      // We do not maintain a chain of promises but rely on SQLite's serialize() behavior.
      // Start several transactions simultaneously, including failing ones; later transaction must
      // see the effects of earlier ones, and should not be affected by earlier failures.
      const sdb = await SQLiteDB.openDB(dbPath('testTrans2'), schemaInfo, OpenMode.OPEN_CREATE);
      const results: any[] = await Promise.all([
        sdb.execTransaction(() => sdb.exec('INSERT INTO Foo (A) VALUES ("trans1")')),
        sdb.execTransaction(() => sdb.all("SELECT A FROM Foo")),
        sdb.execTransaction(() => sdb.exec('INSERT INTO Foo (A) VALUES ("trans2")')),
        sdb.execTransaction(() => sdb.exec('CREATE TABLE TableNew (foo TEXT)')),
        assert.isRejected(sdb.execTransaction(() => sdb.exec('CREATE TABLE TableNew (foo TEXT)')),
          /TableNew.*already exists/).then(noop),
        sdb.execTransaction(() => sdb.all("SELECT A FROM Foo")),
        sdb.execTransaction(async () => {
          await delay(30);
          await sdb.exec('INSERT INTO Foo (A) VALUES ("trans3")');
          await delay(30);
        }),
        sdb.execTransaction(() => sdb.all("SELECT A FROM Foo")),
      ]);
      assert.deepEqual(results, [
        undefined,
        [{A: 'trans1'}],
        undefined,
        undefined,
        undefined,
        [{A: 'trans1'}, {A: 'trans2'}],
        undefined,
        [{A: 'trans1'}, {A: 'trans2'}, {A: 'trans3'}],
      ]);
      void sdb.close();
    });

    it("should allow nested execTransaction calls", async function() {
      const sdb = await SQLiteDB.openDB(dbPath('testTrans3'), schemaInfo, OpenMode.OPEN_CREATE);
      await sdb.execTransaction(async () => {
        await sdb.exec('INSERT INTO Foo (A) VALUES ("thing1")');
        await sdb.execTransaction(async () => {
          await sdb.exec('INSERT INTO Foo (A) VALUES ("thing2")');
          await sdb.exec('INSERT INTO Foo (A) VALUES ("thing3")');
        });
      });
      assert.lengthOf(await sdb.all("SELECT A FROM Foo"), 3);
    });

    it("should rollback nested execTransaction calls as a group", async function() {
      const sdb = await SQLiteDB.openDB(dbPath('testTrans4'), schemaInfo, OpenMode.OPEN_CREATE);
      await assert.isRejected(
        sdb.execTransaction(async () => {
          await sdb.exec('INSERT INTO Foo (A) VALUES ("thing1")');
          await sdb.execTransaction(async () => {
            await sdb.exec('INSERT INTO Foo (A) VALUES ("thing2")');
            await sdb.exec('INSERT INTO Foo (A) VALUESBORKBORKBORK ("thing3")');
          });
        }),
        /SQLITE_ERROR/);
      assert.lengthOf(await sdb.all("SELECT A FROM Foo"), 0);
    });
  });

  it("should forbid ATTACHed databases", async function() {
    const db0 = await SQLiteDB.openDB(dbPath('testAttach0'), schemaInfo, OpenMode.OPEN_CREATE);
    await db0.close();
    const db1 = await SQLiteDB.openDB(dbPath('testAttach1'), schemaInfo, OpenMode.OPEN_CREATE);
    await assert.isRejected(db1.exec(`ATTACH '${dbPath('testAttach0')}' AS zing`),
                            /SQLITE_ERROR: too many attached databases - max 0/);
    await db1.close();
  });
});


// The schema we use in the tests.
const schemaInfo: SchemaInfo = {
  async create(db: SQLiteDB) {
    await db.exec("CREATE TABLE Foo (A TEXT, B NUMERIC)");
    await db.exec("CREATE TABLE Bar (C TEXT, D NUMERIC)");
  },
  migrations: [
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Foo (A TEXT)");
    },
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Bar (D NUMERIC)");
      await db.exec("ALTER TABLE Foo ADD COLUMN B NUMERIC");
    },
    async function(db: SQLiteDB) {
      await db.exec("ALTER TABLE Bar ADD COLUMN C TEXT");
    },
  ]
};

// Version 1 of the schema above. This illustratees how code gets updated when schema evolves.
// Note that migration array only gets new steps, not changes to existing ones.
const schemaInfoV1: SchemaInfo = {
  async create(db: SQLiteDB) {
    await db.exec("CREATE TABLE Foo (A TEXT)");
  },
  migrations: [
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Foo (A TEXT)");
    },
  ]
};

// Version 2 of the schema above.
const schemaInfoV2: SchemaInfo = {
  async create(db: SQLiteDB) {
    await db.exec("CREATE TABLE Foo (A TEXT, B NUMERIC)");
    await db.exec("CREATE TABLE Bar (D NUMERIC)");
  },
  migrations: [
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Foo (A TEXT)");
    },
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Bar (D NUMERIC)");
      await db.exec("ALTER TABLE Foo ADD COLUMN B NUMERIC");
    },
  ]
};

// Inconsistent schema version.
const schemaInfoV2Inconsistent: SchemaInfo = {
  create: schemaInfoV2.create,
  migrations: [
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Foo (A TEXT)");
    },
    async function(db: SQLiteDB) {
      await db.exec("CREATE TABLE Bar (D NUMERIC)");
      await db.exec("ALTER TABLE Foo ADD COLUMN BadCol NUMERIC");
    },
  ]
};

// Broken schema version.
const schemaInfoV4Broken: SchemaInfo = {
  create: schemaInfo.create,
  migrations: [
    ...schemaInfo.migrations,
    async function(db: SQLiteDB) {
      await db.exec("SOME_INVALID_SQL");
    },
  ]
};
