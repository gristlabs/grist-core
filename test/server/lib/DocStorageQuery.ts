import {DocStorage} from 'app/server/lib/DocStorage';
import {ExpandedQuery} from 'app/server/lib/ExpandedQuery';
import {assert} from 'chai';
import * as sinon from 'sinon';
import * as testUtils from 'test/server/testUtils';

describe('DocStorageQuery', function() {

  const sandbox = sinon.createSandbox();
  const dbCalls: Array<unknown[]> = [];
  let docStorage: DocStorage;

  const collapseWhitespace = (str: string) => str.replace(/\s+/g, ' ').trim();

  // Stub DocStorage and its database so that instead of making queries, we just extract the SQL
  // that's constructed.
  async function createDocStorage() {
    const fakeStorageManager = { getPath: (name: string) => name };
    const docStorage = new DocStorage(fakeStorageManager as any, ':memory:');
    await docStorage.createFile();
    const db = (docStorage as any)._getDB();
    sandbox.stub(db, 'run').callsFake(
      (sql: string, ...args: unknown[]) => { dbCalls.push(['run', sql, args]); });
    sandbox.stub(db, 'exec').callsFake(
      (sql: string) => { dbCalls.push(['exec', sql]); });
    sandbox.stub(db, 'allMarshal').callsFake(
      (sql: string, ...params: unknown[]) => { dbCalls.push(['allMarshal', collapseWhitespace(sql), params]); });
    return docStorage;
  }

  testUtils.setTmpLogLevel('warn');

  beforeEach(async function() {
    docStorage = await createDocStorage();
  });

  afterEach(async function() {
    await docStorage.shutdown();
    sandbox.restore();
    dbCalls.length = 0;
  });


  async function getFetchQueryDbCalls(docStorage: DocStorage, query: ExpandedQuery) {
    dbCalls.length = 0;
    await docStorage.fetchQuery(query);
    return dbCalls;
  }

  it('should construct correct query from normally expected fields', async function() {
    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {}, limit: 4}),
      [['allMarshal', 'SELECT * FROM "foo" LIMIT 4', []]]);

    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {tag: [1, 2, 3], X: ['Y']}}),
      [['allMarshal', 'SELECT * FROM "foo" WHERE ("foo"."tag" IN (?, ?, ?)) AND ("foo"."X" IN (?))',
        [1, 2, 3, 'Y']]]);
  });

  it('should reject invalid identifiers', async function() {
    // This is to ensure "identifiers" can't be used as a vector for an SQL injection attacks.
    await assert.isRejected(getFetchQueryDbCalls(docStorage,
      {tableId: 'foo"; DROP TABLE foo', filters: {}}),
      /SQL identifier is not valid/);

    await assert.isRejected(getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {'bar"; DROP TABLE foo;': [1]}}),
      /SQL identifier is not valid/);
  });

  it('should ignore non-numeric limit', async function() {
    // This is to ensure "limit" can't be used as a vector for an SQL injection attack.
    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {}, limit: '5; DROP TABLE foo' as any}),
      [['allMarshal', 'SELECT * FROM "foo"', []]]);

    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {bar: [1]}, limit: {foo: 'bar'} as any}),
      [['allMarshal', 'SELECT * FROM "foo" WHERE ("foo"."bar" IN (?))', [1]]]);
  });

  it('should combine where clause and filters correctly', async function() {
    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {}, limit: 4, where: {clause: 'age IS NULL OR age > ?', params: [18]}}),
      [['allMarshal', 'SELECT * FROM "foo" WHERE (age IS NULL OR age > ?) LIMIT 4', [18]]]);

    assert.deepEqual(await getFetchQueryDbCalls(docStorage,
      {tableId: 'foo', filters: {tag: [1, 2, 3], X: ['Y']},
        where: {clause: "name LIKE ? OR ? = ?", params: ['J%', 4, 5]}
      }),
      [['allMarshal',
        'SELECT * FROM "foo" WHERE (name LIKE ? OR ? = ?) AND ("foo"."tag" IN (?, ?, ?)) AND ("foo"."X" IN (?))',
        ['J%', 4, 5, 1, 2, 3, 'Y']]]);
  });

  it('should construct correct query for many-valued filters', async function() {
    // Query with many values in the filter.
    const values = Array.from(Array(1200), (_, i) => `foo-${i}`);
    const ages = [28];
    await getFetchQueryDbCalls(docStorage, {tableId: 'foo', filters: {values, ages}});

    // It's a bit tricky to test, so we use a clever helper (defined below) that checks that
    // same-named matching groups all match.
    assertMatches(dbCalls, [
      [ 'exec', 'BEGIN' ],
      [ 'exec', /^CREATE TEMPORARY TABLE (?<table1>_grist_tmp\w+)\(data\)$/],
      [ 'run', /^INSERT INTO (?<table1>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [values.slice(0, 500)]],
      [ 'run', /^INSERT INTO (?<table1>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [values.slice(500, 1000)]],
      [ 'run', /^INSERT INTO (?<table1>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [values.slice(1000, 1200)]],
      [ 'exec', /^CREATE TEMPORARY TABLE (?<table2>_grist_tmp\w+)\(data\)$/],
      [ 'run', /^INSERT INTO (?<table2>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [ [28] ]],
      [ 'allMarshal', new RegExp(
        /^SELECT \* FROM "foo" WHERE /.source +
        /\("foo"\."values" IN \(SELECT data FROM (?<table1>_grist_tmp\w+)\)\) AND /.source +
        /\("foo"\."ages" IN \(SELECT data FROM (?<table2>_grist_tmp\w+)\)\)/.source),
        []
      ],
      [ 'exec', /^DROP TABLE (?<table1>_grist_tmp\w+)$/ ],
      [ 'exec', /^DROP TABLE (?<table2>_grist_tmp\w+)$/ ],
      [ 'exec', 'COMMIT' ],
    ]);
  });

  it('should combine where clause and many-valued filters correctly', async function() {
    // Query with many values in the filter, AND with a custom "where" clause.
    const bars = Array.from(Array(600), (_, i) => `bar-${i}`);
    await getFetchQueryDbCalls(docStorage, {tableId: 'foo', filters: {bars},
      where: {clause: "name LIKE ? OR ? = ?", params: ['J%', 4, 5]}});

    // It's a bit tricky to test, so we use a clever helper (defined below) that checks that
    // same-named matching groups all match.
    assertMatches(dbCalls, [
      [ 'exec', 'BEGIN' ],
      [ 'exec', /^CREATE TEMPORARY TABLE (?<table1>_grist_tmp\w+)\(data\)$/],
      [ 'run', /^INSERT INTO (?<table1>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [bars.slice(0, 500)]],
      [ 'run', /^INSERT INTO (?<table1>_grist_tmp\w+)\(data\) VALUES \(\?\)(,\(\?\))*$/, [bars.slice(500, 600)]],
      [ 'allMarshal', new RegExp(
        /^SELECT \* FROM "foo" WHERE \(name LIKE \? OR \? = \?\) AND /.source +
        /\("foo"\."bars" IN \(SELECT data FROM (?<table1>_grist_tmp\w+)\)\)/.source),
        ['J%', 4, 5],
      ],
      [ 'exec', /^DROP TABLE (?<table1>_grist_tmp\w+)$/ ],
      [ 'exec', 'COMMIT' ],
    ]);
  });
});


/**
 * Clever function to match an array of arrays, with some dynamically generated parts of
 * strings. Items can be regular expressions. These can contain named groups (e.g. /Hello (?<name>.*)/).
 * Across different regular expressions, same-named groups must match.
 */
function assertMatches(calls: Array<unknown[]>, expected: Array<Array<unknown|RegExp>>) {
  const groups = new Map<string, string>();
  for (const [n, expectedCall] of expected.entries()) {
    assert.isAtLeast(calls.length, n + 1);
    const actualCall = calls[n];
    for (const [i, expectedPart] of expectedCall.entries()) {
      assert.isAtLeast(actualCall.length, i + 1);
      const actualPart = actualCall[i];
      if (expectedPart instanceof RegExp) {
        assert.equal(typeof actualPart, 'string');
        if (typeof actualPart !== 'string') { throw new Error('X'); }
        assert.match(actualPart, expectedPart, `in call #${n}`);
        const match = actualPart.match(expectedPart);
        if (match?.groups) {
          for (const [name, value] of Object.entries(match.groups)) {
            if (groups.has(name)) {
              assert.equal(value, groups.get(name), `in call #${n} while matching: ${actualPart}`);
            } else {
              groups.set(name, value);
            }
          }
        }
      } else {
        assert.deepEqual(actualPart, expectedPart);
      }
    }
    assert.equal(calls[n].length, expectedCall.length);
  }
  assert.equal(calls.length, expected.length);
}
