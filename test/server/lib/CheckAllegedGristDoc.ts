import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { checkAllegedGristDoc, isCompatibleColId, isCompatibleTableId } from "app/server/lib/serverUtils";
import { OpenMode, SQLiteDB } from "app/server/lib/SQLiteDB";
import { assert, createTestDir, setTmpLogLevel } from "test/server/testUtils";

import * as path from "path";

// An imported document is refused if its schema has a table or column id that Grist's id
// sanitizer could not have produced. These tests pin the accept/reject boundary and the check.
describe("checkAllegedGristDoc", function() {
  setTmpLogLevel("warn");

  describe("id predicates", function() {
    it("accepts every id Grist can produce", function() {
      // These are all real outputs of pick_col_ident / pick_table_ident: a "Total " header
      // becomes "Total_", "Foo_" stays "Foo_" (leading underscores only are stripped), "Café "
      // becomes "Cafe_", and system-generated names are allowed.
      for (const id of ["Foo_", "Total_", "Notes__", "Cafe_", "A1_2",
        "manualSort", "id", "gristHelper_Display", "GristSummary_2_Table1", "GristHidden_import",
        "sqlite_sequence"]) {
        assert.isTrue(isCompatibleColId(id), id);
        assert.isTrue(isCompatibleTableId(id), id);
      }
      // System tables are allowed as tables (their leading underscore fails the column shape).
      for (const id of ["_grist_Tables", "_grist_Tables_column", "_gristsys_Files"]) {
        assert.isTrue(isCompatibleTableId(id), id);
        assert.isFalse(isCompatibleColId(id), id);
      }
    });

    it("rejects ids Grist would never produce", function() {
      // Foreign shapes: punctuation, spaces, non-ASCII, leading underscores, leading digits.
      for (const id of ["a.b", "a b", "col-1", "café", "_leadingUnderscore", "_Foo", "1leading", ""]) {
        assert.isFalse(isCompatibleColId(id), id);
      }
      // System-table prefixes are allowed for tables only, never columns.
      assert.isTrue(isCompatibleTableId("_grist_Foo"), "_grist_Foo");
      assert.isFalse(isCompatibleColId("_grist_Foo"), "_grist_Foo");
      // A leading underscore is only allowed as part of a system-table prefix, and only ahead of
      // an otherwise valid id: the prefix does not excuse junk after it.
      assert.isFalse(isCompatibleTableId("a.b"), "a.b");
      assert.isFalse(isCompatibleTableId("_Foo"), "_Foo");
      assert.isFalse(isCompatibleTableId("_notASystemTable"), "_notASystemTable");
      assert.isFalse(isCompatibleTableId("_grist_a.b"), "_grist_a.b");
      assert.isFalse(isCompatibleTableId("_gristsys_bad name"), "_gristsys_bad name");
      assert.isFalse(isCompatibleTableId("_grist_"), "_grist_");
    });
  });

  describe("import check", function() {
    const docSession = makeExceptionalDocSession("system");
    let testDir: string;

    before(async function() {
      testDir = await createTestDir("checkAllegedGristDoc");
    });

    // Build a raw SQLite file running the given schema SQL, and return its path.
    async function makeRawDoc(name: string, schemaSql: string[]): Promise<string> {
      const docPath = path.join(testDir, `${name}.grist`);
      const db = await SQLiteDB.openDBRaw(docPath, OpenMode.OPEN_CREATE);
      for (const sql of schemaSql) { await db.exec(sql); }
      await db.close();
      return docPath;
    }

    it("accepts a schema of Grist-shaped ids", async function() {
      const docPath = await makeRawDoc("good", ['CREATE TABLE Table1 ("id" INTEGER, "Foo_" TEXT)']);
      await assert.isFulfilled(checkAllegedGristDoc(docSession, docPath));
    });

    it("rejects a foreign column id", async function() {
      const docPath = await makeRawDoc("bad-col", ['CREATE TABLE Table1 ("id" INTEGER, "a.b" TEXT)']);
      await assert.isRejected(checkAllegedGristDoc(docSession, docPath),
        /unexpected column id "a\.b" in table "Table1"/);
    });

    it("rejects a foreign table id", async function() {
      const docPath = await makeRawDoc("bad-table", ['CREATE TABLE "my.table" ("id" INTEGER)']);
      await assert.isRejected(checkAllegedGristDoc(docSession, docPath),
        /unexpected table id "my\.table"/);
    });
  });
});
