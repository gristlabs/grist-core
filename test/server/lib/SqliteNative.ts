import { assert } from "chai";
import * as fse from "fs-extra";
import * as tmp from "tmp-promise";

import { Unmarshaller } from "app/common/marshal";
import { MinDB, ResultRow } from "app/server/lib/SqliteCommon";
import { NativeSqliteDatabaseAdapter, NativeSqliteVariant } from "app/server/lib/SqliteNative";
import { OpenMode } from "app/server/lib/SQLiteDB";

tmp.setGracefulCleanup();

describe("SqliteNative", function() {
  let tmpDir: string;
  let cleanup: () => void;

  before(async function() {
    ({ path: tmpDir, cleanup } = await tmp.dir({ prefix: "grist_test_SqliteNative_", unsafeCleanup: true }));
  });

  after(function() {
    cleanup();
  });

  function dbPath(name: string): string {
    return `${tmpDir}/${name}.db`;
  }

  describe("NativeSqliteVariant", function() {
    const variant = new NativeSqliteVariant();

    it("should open a new database with OPEN_CREATE", async function() {
      const db = await variant.opener(dbPath("create"), OpenMode.OPEN_CREATE);
      await db.exec("CREATE TABLE t(x TEXT)");
      await db.run("INSERT INTO t VALUES(?)", "hello");
      const row = await db.get("SELECT x FROM t");
      assert.deepEqual(row, { x: "hello" });
      await db.close();
    });

    it("should open an existing database with OPEN_EXISTING", async function() {
      // Create first.
      const db1 = await variant.opener(dbPath("existing"), OpenMode.OPEN_CREATE);
      await db1.exec("CREATE TABLE t(x TEXT)");
      await db1.run("INSERT INTO t VALUES(?)", "data");
      await db1.close();

      // Reopen.
      const db2 = await variant.opener(dbPath("existing"), OpenMode.OPEN_EXISTING);
      const row = await db2.get("SELECT x FROM t");
      assert.deepEqual(row, { x: "data" });
      await db2.close();
    });

    it("should fail to open non-existent database with OPEN_EXISTING", async function() {
      await assert.isRejected(
        variant.opener(dbPath("nonexistent"), OpenMode.OPEN_EXISTING),
        /unable to open database/
      );
    });

    it("should open in read-only mode with OPEN_READONLY", async function() {
      // Create first.
      const db1 = await variant.opener(dbPath("readonly"), OpenMode.OPEN_CREATE);
      await db1.exec("CREATE TABLE t(x TEXT)");
      await db1.run("INSERT INTO t VALUES(?)", "data");
      await db1.close();

      // Open readonly.
      const db2 = await variant.opener(dbPath("readonly"), OpenMode.OPEN_READONLY);
      const row = await db2.get("SELECT x FROM t");
      assert.deepEqual(row, { x: "data" });

      // Writes should fail.
      await assert.isRejected(
        db2.run("INSERT INTO t VALUES(?)", "more"),
        /readonly|attempt to write/
      );
      await db2.close();
    });
  });

  describe("NativeSqliteDatabaseAdapter", function() {
    let db: MinDB;

    beforeEach(async function() {
      db = await new NativeSqliteVariant().opener(":memory:", OpenMode.OPEN_CREATE);
      await db.exec("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT, count INTEGER)");
    });

    afterEach(async function() {
      await db.close();
    });

    describe("exec", function() {
      it("should execute multiple statements", async function() {
        await db.exec(`
          INSERT INTO items(name, count) VALUES('a', 1);
          INSERT INTO items(name, count) VALUES('b', 2);
        `);
        const rows = await db.all("SELECT name FROM items ORDER BY name");
        assert.deepEqual(rows, [{ name: "a" }, { name: "b" }]);
      });
    });

    describe("run", function() {
      it("should return changes count", async function() {
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "x", 10);
        const result = await db.run("UPDATE items SET count = ? WHERE name = ?", 20, "x");
        assert.equal(result.changes, 1);
      });

      it("should handle boolean parameters", async function() {
        await db.exec("CREATE TABLE flags(val INTEGER)");
        await db.run("INSERT INTO flags VALUES(?)", true);
        await db.run("INSERT INTO flags VALUES(?)", false);
        const rows = await db.all("SELECT val FROM flags ORDER BY val");
        assert.deepEqual(rows, [{ val: 0 }, { val: 1 }]);
      });
    });

    describe("get", function() {
      it("should return a single row", async function() {
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "one", 1);
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "two", 2);
        const row = await db.get("SELECT name, count FROM items WHERE count = ?", 2);
        assert.deepEqual(row, { name: "two", count: 2 });
      });

      it("should return undefined for no match", async function() {
        const row = await db.get("SELECT * FROM items WHERE name = ?", "nope");
        assert.isUndefined(row);
      });
    });

    describe("all", function() {
      it("should return all matching rows", async function() {
        await db.exec(`
          INSERT INTO items(name, count) VALUES('a', 1);
          INSERT INTO items(name, count) VALUES('b', 2);
          INSERT INTO items(name, count) VALUES('c', 3);
        `);
        const rows = await db.all("SELECT name FROM items WHERE count > ? ORDER BY name", 1);
        assert.deepEqual(rows, [{ name: "b" }, { name: "c" }]);
      });

      it("should return empty array for no matches", async function() {
        const rows = await db.all("SELECT * FROM items WHERE count > ?", 999);
        assert.deepEqual(rows, []);
      });
    });

    describe("prepare", function() {
      it("should create a reusable prepared statement", async function() {
        const stmt = await db.prepare("INSERT INTO items(name, count) VALUES(?, ?)");
        await stmt.run("p1", 10);
        await stmt.run("p2", 20);
        await stmt.finalize();

        const rows = await db.all("SELECT name, count FROM items ORDER BY name");
        assert.deepEqual(rows, [
          { name: "p1", count: 10 },
          { name: "p2", count: 20 },
        ]);
      });

      it("should report column names", async function() {
        const stmt = await db.prepare("SELECT id, name, count FROM items");
        assert.deepEqual(stmt.columns(), ["id", "name", "count"]);
        await stmt.finalize();
      });
    });

    describe("runAndGetId", function() {
      it("should return the last inserted row id", async function() {
        const id1 = await db.runAndGetId("INSERT INTO items(name, count) VALUES(?, ?)", "first", 1);
        const id2 = await db.runAndGetId("INSERT INTO items(name, count) VALUES(?, ?)", "second", 2);
        assert.equal(id1, 1);
        assert.equal(id2, 2);
      });
    });

    describe("allMarshal", function() {
      it("should return marshalled data that can be unmarshalled", async function() {
        await db.exec(`
          INSERT INTO items(name, count) VALUES('alice', 10);
          INSERT INTO items(name, count) VALUES('bob', 20);
        `);

        const buf = await db.allMarshal("SELECT name, count FROM items ORDER BY name");

        // Should be a Buffer (or Uint8Array that we can work with).
        assert.isTrue(buf instanceof Uint8Array, "result should be a Uint8Array or Buffer");
        assert.isAbove(buf.length, 0);

        // Unmarshal and verify contents.
        const unmarshaller = new Unmarshaller();
        unmarshaller.parse(buf, (value: any) => {
          // The marshalled data should be a dict of column_name -> [values].
          assert.deepEqual(value.name, ["alice", "bob"]);
          assert.deepEqual(value.count, [10, 20]);
        });
      });

      it("should handle empty result sets", async function() {
        const buf = await db.allMarshal("SELECT name, count FROM items WHERE 0");
        assert.isTrue(buf instanceof Uint8Array);

        const unmarshaller = new Unmarshaller();
        unmarshaller.parse(buf, (value: any) => {
          assert.deepEqual(value.name, []);
          assert.deepEqual(value.count, []);
        });
      });
    });

    describe("limitAttach", function() {
      it("should block ATTACH by default", async function() {
        await assert.isRejected(
          db.exec("ATTACH ':memory:' AS extra"),
          /not authorized/
        );
      });

      it("should allow ATTACH after limitAttach(1)", async function() {
        await db.limitAttach(1);
        await db.exec("ATTACH ':memory:' AS extra");
        // Verify we can use the attached database.
        await db.exec("CREATE TABLE extra.t2(y TEXT)");
        await db.run("INSERT INTO extra.t2 VALUES(?)", "attached");
        const row = await db.get("SELECT y FROM extra.t2");
        assert.deepEqual(row, { y: "attached" });
      });

      it("should re-block ATTACH after limitAttach(0)", async function() {
        await db.limitAttach(1);
        await db.exec("ATTACH ':memory:' AS extra");
        await db.exec("DETACH extra");
        await db.limitAttach(0);
        await assert.isRejected(
          db.exec("ATTACH ':memory:' AS extra2"),
          /not authorized/
        );
      });
    });

    describe("getOptions", function() {
      it("should report canInterrupt as false", function() {
        const opts = (db as NativeSqliteDatabaseAdapter).getOptions!();
        assert.isFalse(opts.canInterrupt);
        assert.isTrue(opts.bindableMethodsProcessOneStatement);
      });
    });

    describe("transactions via exec", function() {
      it("should support BEGIN/COMMIT transactions", async function() {
        await db.exec("BEGIN");
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "tx1", 1);
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "tx2", 2);
        await db.exec("COMMIT");

        const rows = await db.all("SELECT name FROM items ORDER BY name");
        assert.deepEqual(rows, [{ name: "tx1" }, { name: "tx2" }]);
      });

      it("should support ROLLBACK", async function() {
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "keep", 1);
        await db.exec("BEGIN");
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", "discard", 2);
        await db.exec("ROLLBACK");

        const rows = await db.all("SELECT name, count FROM items");
        assert.deepEqual(rows, [{ name: "keep", count: 1 }]);
      });
    });

    describe("data types", function() {
      it("should handle NULL values", async function() {
        await db.run("INSERT INTO items(name, count) VALUES(?, ?)", null, null);
        const row = await db.get("SELECT name, count FROM items WHERE id = last_insert_rowid()");
        assert.deepEqual(row, { name: null, count: null });
      });

      it("should handle BLOB values", async function() {
        await db.exec("CREATE TABLE blobs(data BLOB)");
        const blob = Buffer.from([0x00, 0x01, 0x02, 0xff]);
        await db.run("INSERT INTO blobs VALUES(?)", blob);
        const row = await db.get("SELECT data FROM blobs") as ResultRow;
        // node:sqlite returns Uint8Array for blobs.
        assert.isTrue(row.data instanceof Uint8Array);
        assert.deepEqual(Buffer.from(row.data), blob);
      });

      it("should handle large integers", async function() {
        await db.exec("CREATE TABLE big(val INTEGER)");
        await db.run("INSERT INTO big VALUES(?)", Number.MAX_SAFE_INTEGER);
        const row = await db.get("SELECT val FROM big") as ResultRow;
        assert.equal(row.val, Number.MAX_SAFE_INTEGER);
      });
    });

    describe("PRAGMA", function() {
      it("should support PRAGMA queries", async function() {
        // user_version is used for schema versioning in Grist.
        await db.exec("PRAGMA user_version = 42");
        const row = await db.get("PRAGMA user_version") as ResultRow;
        assert.equal(row.user_version, 42);
      });

      it("should support table_info", async function() {
        const cols = await db.all("PRAGMA table_info(items)");
        const names = cols.map((c: ResultRow) => c.name);
        assert.deepEqual(names, ["id", "name", "count"]);
      });
    });
  });

  describe("backup", function() {
    it("should backup a database to a file", async function() {
      const variant = new NativeSqliteVariant();
      const db = await variant.opener(":memory:", OpenMode.OPEN_CREATE) as NativeSqliteDatabaseAdapter;
      await db.exec("CREATE TABLE data(x INTEGER)");
      for (let i = 0; i < 100; i++) {
        await db.run("INSERT INTO data VALUES(?)", i);
      }

      const dest = dbPath("backup_dest");
      await db.backupTo(dest, { rate: 10 });

      // Verify backup contents.
      assert.isTrue(await fse.pathExists(dest));
      const db2 = await variant.opener(dest, OpenMode.OPEN_READONLY);
      const rows = await db2.all("SELECT count(*) as c FROM data");
      assert.equal(rows[0].c, 100);
      await db2.close();
      await db.close();
    });
  });
});
