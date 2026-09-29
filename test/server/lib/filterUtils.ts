import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { filterDocumentInPlace, makeFilterOptions } from "app/server/lib/filterUtils";
import { OpenMode, SQLiteDB } from "app/server/lib/SQLiteDB";
import * as testUtils from "test/server/testUtils";

import { join as pathJoin } from "path";

import { assert } from "chai";

describe("filterUtils", function() {
  let testDir: string;

  testUtils.setTmpLogLevel("warn");

  before(async function() {
    testDir = await testUtils.createTestDir("filterUtils");
  });

  // Filtering works in place, so take a copy and leave the fixture alone.
  async function copyFixture(fixture: string): Promise<string> {
    const filename = pathJoin(testDir, fixture);
    await testUtils.copyFixtureDoc(fixture, filename);
    return filename;
  }

  // makeFilterOptions() with nothing asked of it is what a plain download uses,
  // so these exercise the whole sequence rather than one step of it.
  async function downloadFilter(filename: string) {
    await filterDocumentInPlace(makeExceptionalDocSession("system"), filename, makeFilterOptions());
  }

  async function withDb<T>(filename: string, fn: (db: SQLiteDB) => Promise<T>): Promise<T> {
    const db = await SQLiteDB.openDBRaw(filename, OpenMode.OPEN_EXISTING);
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  async function getColumns(filename: string, tableId: string): Promise<string[]> {
    return withDb(filename, async db =>
      (await db.all(`PRAGMA table_info(${tableId})`)).map(column => column.name as string));
  }

  it("disables triggers in the document being downloaded", async function() {
    const filename = await copyFixture("Hello.grist");
    await withDb(filename, db =>
      db.run("INSERT INTO _grist_Triggers (tableRef, enabled) VALUES (1, 1)"));

    await downloadFilter(filename);

    const rows = await withDb(filename, db => db.all("SELECT enabled FROM _grist_Triggers"));
    assert.deepEqual(rows.map(row => row.enabled), [0]);
  });

  // A column each step of the filtering uses, with a fixture from before it
  // existed. Filtering must still complete; the document is left as it is, and
  // gains the column when it is next opened and migrated. Checking the fixture
  // first is what keeps these honest, so that they fail rather than quietly
  // stop covering anything should a fixture be regenerated.
  const oldDocuments = [
    // _grist_Triggers arrived in schema version 24, `enabled` only in 39.
    { fixture: "World.grist", tableId: "_grist_Triggers", colId: "enabled" },
    // documentSettings, which markAction needs, arrived in schema version 23.
    { fixture: "World-v20.grist", tableId: "_grist_DocInfo", colId: "documentSettings" },
  ];

  for (const { fixture, tableId, colId } of oldDocuments) {
    it(`downloads a document predating ${tableId}.${colId}`, async function() {
      const filename = await copyFixture(fixture);
      assert.notInclude(await getColumns(filename, tableId), colId);

      await downloadFilter(filename);
    });
  }
});
