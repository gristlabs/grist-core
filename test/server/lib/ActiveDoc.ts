import {getEnvContent} from 'app/common/ActionBundle';
import {ServerQuery} from 'app/common/ActiveDocAPI';
import {delay} from 'app/common/delay';
import {BulkColValues, CellValue, fromTableDataAction} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import {CreatableArchiveFormats} from 'app/common/UserAPI';
import {TableData} from 'app/common/TableData';
import {GristObjCode} from 'app/plugin/GristData';
import {ActiveDoc, Deps} from 'app/server/lib/ActiveDoc';
import {getDocPoolIdFromDocInfo} from 'app/server/lib/AttachmentStore';
import {
  AttachmentStoreProvider,
  IAttachmentStoreProvider
} from 'app/server/lib/AttachmentStoreProvider';
import {DummyAuthorizer} from 'app/server/lib/DocAuthorizer';
import {AuthSession} from 'app/server/lib/AuthSession';
import {Client} from 'app/server/lib/Client';
import {makeExceptionalDocSession, makeOptDocSession, OptDocSession} from 'app/server/lib/DocSession';
import {guessExt} from 'app/server/lib/guessExt';
import log from 'app/server/lib/log';
import {timeoutReached} from 'app/server/lib/serverUtils';
import {Throttle} from 'app/server/lib/Throttle';
import {createTmpDir as createTmpUploadDir, globalUploadSet} from 'app/server/lib/uploads';
import {MemoryWritableStream} from 'app/server/utils/streams';
import {promisify} from 'bluebird';
import {assert} from 'chai';
import decompress from 'decompress';
import * as child_process from 'child_process';
import * as fse from 'fs-extra';
import * as _ from 'lodash';
import * as stream from 'node:stream';
import path, {resolve} from 'path';
import * as sinon from 'sinon';
import {createDocTools} from 'test/server/docTools';
import {makeTestingFilesystemStoreConfig} from 'test/server/lib/FilesystemAttachmentStore';
import * as testUtils from 'test/server/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';
import * as tmp from 'tmp';

const execFileAsync = promisify(child_process.execFile);

const UNSUPPORTED_FORMULA: CellValue = [GristObjCode.Exception, 'Formula not supported'];

tmp.setGracefulCleanup();

describe('ActiveDoc', async function() {
  this.timeout(10000);

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('warn');

  const createAttachmentStoreProvider = async () => new AttachmentStoreProvider(
    [await makeTestingFilesystemStoreConfig("filesystem")],
    "TEST-INSTALLATION-UUID"
  );

  const docTools = createDocTools({ createAttachmentStoreProvider });

  const fakeSession = makeExceptionalDocSession('system');

  const sandbox = sinon.createSandbox();

  async function fetchValues(activeDoc: ActiveDoc, tableId: any): Promise<BulkColValues> {
    const {tableData} = await activeDoc.fetchTable(fakeSession, tableId, true);
    return _.omit(tableData[3], 'manualSort');
  }

  this.afterEach(() => {
    sandbox.restore();
  });

  const allTypes = {
    Any:            'Any',
    Attachments:    'Attachments',
    Blob:           'Blob',
    Bool:           'Bool',
    Choice:         'Choice',
    ChoiceList:     'ChoiceList',
    Date:           'Date',
    DateTime:       'DateTime',
    Int:            'Int',
    ManualSortPos:  'ManualSortPos',
    Numeric:        'Numeric',
    PositionNumber: 'PositionNumber',
    Ref:            'Ref:Defaults',       // Ref columns must specify a valid target
    RefList:        'RefList:Defaults',
    Text:           'Text',
  };

  const allValues = [
    null,
    true,                     // Bool
    false,                    // Bool
    "choice",                 // Choice
    1510012800.000,           // Date
    1510074073.123,           // DateTime
    17,                       // Reference, Int
    123.456,                  // Numeric, PositionNumber, ManualSortPos
    Number.POSITIVE_INFINITY, // Numeric
    Number.NaN,               // Numeric
    Number.MIN_VALUE,         // Numeric
    0,                        // Int, Numeric
    -0.0,                     // Numeric
    Number.MAX_SAFE_INTEGER,  // Int, Numeric
    Number.MIN_SAFE_INTEGER,  // Int, Numeric
    ['L', 3, 5, 6],           // Attachments, ReferenceList
    "Hello!",                 // Text
    "¡Aló!",                  // Text containing non-ascii unicode
    "0",                      // Text that looks like int
    "-1e4",                   // Text that looks like float
    "true",                   // Text that looks like bool
    "",                       // Text that's empty.
    ['L', ['O', {A: 1.0}], ['L', 5, 's']],  // other complex types
    ['L', "Foo", "Bar"],      // ChoiceList
    // TODO We are unable YET to support binary data in the sandbox properly because we don't
    // distinguish in the sandbox between unicode text and binary. Once that's fixed, this should
    // be made to work.
    //   Uint8Array.from([0x00, 0x01, 0x02, 0x03]),    // Binary data
    //   new Uint8Array(Buffer.from("¡Aló!", 'utf8')), // Binary data that's valid utf8
    //   new Uint8Array(0),                            // Binary data that's empty
  ];

  // Set the specified table to be onDemand/regular, and reload the document.
  async function reloadOnDemand(activeDoc: ActiveDoc, tableId: string,
                                onDemand: boolean = true): Promise<ActiveDoc> {
    // We can use fetchQuery() to look up a tableRef from a tableId.
    const data = fromTableDataAction(await activeDoc.fetchQuery(fakeSession,
      {tableId: '_grist_Tables', filters: {tableId: [tableId]}}));
    assert.deepEqual(data.onDemand, [!onDemand]);
    const tableRef = data.id[0];

    await activeDoc.applyUserActions(fakeSession, [['UpdateRecord', '_grist_Tables', tableRef, {onDemand}]]);
    await activeDoc.shutdown();
    const activeDoc2 = await docTools.loadDoc(activeDoc.docName);

    // Check that the table is known to be onDemand.
    const data2 = fromTableDataAction(await activeDoc2.fetchQuery(fakeSession,
      {tableId: '_grist_Tables', filters: {tableId: [tableId]}}));
    assert.deepEqual(data2.id, [tableRef]);
    assert.deepEqual(data2.onDemand, [onDemand]);

    // We don't update indexes on load at this time, which is awkward in tests.
    await activeDoc2.testUpdateIndexes();

    return activeDoc2;
  }

  describe("DocData", function() {
    function verifyTableData(t: TableData|undefined, colIdSubset: string[], data: CellValue[][]): void {
      if (!t) { throw new Error("table could not be fetched"); }
      const idIndex = colIdSubset.indexOf('id');
      assert(idIndex !== -1, "verifyTableData expects 'id' column");
      const rowIds: number[] = data.map(row => row[idIndex]) as number[];
      assert.deepEqual(t.getSortedRowIds(), rowIds);
      assert.deepEqual(rowIds.map(r => colIdSubset.map(c => t.getValue(r, c))), data);
    }

    it('should maintain up-to-date DocData', async function() {
      const docName = 'docdata1';
      const activeDoc1 = await docTools.createDoc(docName);

      // ----------------------------------------
      await activeDoc1.applyUserActions(fakeSession, [
        ["AddTable", "Hello", [{id: "city", type: "Text"}, {id: "state", type: "Text"}]],
        ["BulkAddRecord", "Hello", [1, 4], {
          city: ['New York', 'Boston'],
          state: ['NY', 'MA'],
        }]
      ]);

      verifyTableData(activeDoc1.docData!.getTable('_grist_Tables'), ["id", "tableId"], [
        [1, "Hello"]
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Tables_column'), ["id", "parentId", "colId", "type"], [
        [1, 1, "manualSort", "ManualSortPos"],
        [2, 1, "city", "Text"],
        [3, 1, "state", "Text"],
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Views_section'), ["id", "tableRef"], [
        [1, 1],
        [2, 1],
        [3, 1],
      ]);

      // ----------------------------------------
      await activeDoc1.applyUserActions(fakeSession, [
        ["RenameColumn", "Hello", "city", "ciudad"],
        ["ModifyColumn", "Hello", "ciudad", {type: "Choice"}],
        ["AddTable", "Foo", [{id: "A"}]],
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Tables'), ["id", "tableId"], [
        [1, "Hello"],
        [2, "Foo"]
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Tables_column'), ["id", "parentId", "colId", "type"], [
        [1, 1, "manualSort", "ManualSortPos"],
        [2, 1, "ciudad", "Choice"],
        [3, 1, "state", "Text"],
        [4, 2, "manualSort", "ManualSortPos"],
        [5, 2, "A", "Text"],
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Views_section'), ["id", "tableRef"], [
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 2],
        [5, 2],
        [6, 2],
      ]);
      verifyTableData(activeDoc1.docData!.getTable('_grist_Views_section_field'), ["id", "parentId", "colRef"], [
        [1, 1, 2],
        [2, 1, 3],
        [3, 2, 2],
        [4, 2, 3],
        [5, 3, 2],
        [6, 3, 3],
        [7, 4, 5],
        [8, 5, 5],
        [9, 6, 5],
      ]);

      // ----------------------------------------
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);

      verifyTableData(activeDoc2.docData!.getTable('_grist_Tables'), ["id", "tableId"], [
        [1, "Hello"],
        [2, "Foo"]
      ]);
      verifyTableData(activeDoc2.docData!.getTable('_grist_Tables_column'), ["id", "parentId", "colId", "type"], [
        [1, 1, "manualSort", "ManualSortPos"],
        [2, 1, "ciudad", "Choice"],
        [3, 1, "state", "Text"],
        [4, 2, "manualSort", "ManualSortPos"],
        [5, 2, "A", "Text"],
      ]);
      verifyTableData(activeDoc2.docData!.getTable('_grist_Views_section'), ["id", "tableRef"], [
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 2],
        [5, 2],
        [6, 2],
      ]);
      verifyTableData(activeDoc2.docData!.getTable('_grist_Views_section_field'), ["id", "parentId", "colRef"], [
        [1, 1, 2],
        [2, 1, 3],
        [3, 2, 2],
        [4, 2, 3],
        [5, 3, 2],
        [6, 3, 3],
        [7, 4, 5],
        [8, 5, 5],
        [9, 6, 5],
      ]);
    });
  });

  describe('useQuerySet', function() {
    it('should support useQuerySet to fetch a subset of data', async function() {
      const docName = 'doc_use_query_set';
      const activeDoc1 = await docTools.createDoc(docName);
      const res = await activeDoc1.applyUserActions(fakeSession, [
        ["AddTable", "Bar", [
          { id: 'fname', type: 'Text', isFormula: false },
          { id: 'lname', type: 'Text', isFormula: false },
          { id: 'age', type: 'Numeric', isFormula: false },
          { id: 'age2', type: 'Numeric', isFormula: true, formula: '$age * 2' },
        ]],
        ["AddRecord", "Bar", 1, { fname: 'Alice',  lname: 'Johnson', age: 28 }],
        ["AddRecord", "Bar", 2, { fname: 'Bob', lname: 'Upton', age: 28 }]
      ]);
      const tableRef = res.retValues[0].id;

      // Ensure that we now have a table with two records.
      assert.deepEqual((await activeDoc1.fetchTable(fakeSession, 'Bar')).tableData[2], [1, 2]);

      // Test useQuerySet with this regular (NOT onDemand) table. We expect it to return all
      // formula columns.
      await testUseQuery(activeDoc1, false);

      // Now change the table to be onDemand, and reload the data engine.
      await activeDoc1.applyUserActions(fakeSession, [['UpdateRecord', '_grist_Tables', tableRef, {onDemand: true}]]);
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);

      // fetchTable() now returns data too, coming straight from the database.
      assert.deepEqual((await activeDoc2.fetchTable(fakeSession, 'Bar')).tableData[2], [1, 2]);

      // Test that useQuerySet still works as before, except for not including formula columns
      // not supported with SQL.
      await testUseQuery(activeDoc2, true);
    });

    // Implements the useQuerySet() test asserts, used unchanged for regular and onDemand tables.
    async function testUseQuery(activeDoc: ActiveDoc, onDemand: boolean) {
      // some formulas are not yet supported for on-demand tables.
      const ifSupported = (...args: any[]) => args.map(v => onDemand ? UNSUPPORTED_FORMULA : v);

      // Simple query matching one record.
      const res1 = await activeDoc.useQuerySet(fakeSession, {tableId: "Bar", filters: {lname: ['Johnson']}});
      assert.deepEqual(res1.tableData,
        ["TableData", "Bar", [1], {
          fname: ['Alice'],  lname: ['Johnson'], age: [28], manualSort: [1],
          age2: ifSupported(56),
        }]);

      // Simple query matching multiple records.
      const res2 = await activeDoc.useQuerySet(fakeSession, {tableId: "Bar", filters: {age: [28]}});
      assert.deepEqual(res2.tableData,
        ["TableData", "Bar", [1, 2], {
          fname: ['Alice', 'Bob'],  lname: ['Johnson', 'Upton'], age: [28, 28], manualSort: [1, 2],
          age2: ifSupported(56, 56),
        }]);

      // Combination query matching no records.
      const res3 = await activeDoc.useQuerySet(fakeSession,
        {tableId: "Bar", filters: {age: [200], lname: ['Johnson']}});
      assert.deepEqual(res3.tableData, ["TableData", "Bar", [], {
        fname: [],  lname: [], age: [], manualSort: [],
        age2: [],
      }]);

      // Query with no filters should match all records.
      const res4 = await activeDoc.useQuerySet(fakeSession, {tableId: "Bar", filters: {}});
      assert.deepEqual(res4.tableData,
        ["TableData", "Bar", [1, 2], {
          fname: ['Alice', 'Bob'],  lname: ['Johnson', 'Upton'], age: [28, 28], manualSort: [1, 2],
          age2: ifSupported(56, 56),
        }]);

      // Query with multiple values in the filter.
      const res5 = await activeDoc.useQuerySet(fakeSession,
        {tableId: "Bar", filters: {lname: ['Johnson', 'Upton', 'Hacker";\';Bob'], age: [28]}});
      assert.deepEqual(res5.tableData,
        ["TableData", "Bar", [1, 2], {
          fname: ['Alice', 'Bob'],  lname: ['Johnson', 'Upton'], age: [28, 28], manualSort: [1, 2],
          age2: ifSupported(56, 56),
        }]);

      // Query with many values in the filter.
      const lnames = ['Johnson', 'Upton', 'Hacker";\';Bob'];
      const ages = [28];
      // add a lot of chaff
      lnames.push(...[...Array(100000).keys()].map(i => `chaff-${i}`));
      ages.push(...[...Array(100000).keys()].map(i => 1000 + i));
      const res6 = await activeDoc.useQuerySet(fakeSession,
        {tableId: "Bar", filters: {lname: lnames, age: ages}});
      assert.deepEqual(res6.tableData,
        ["TableData", "Bar", [1, 2], {
          fname: ['Alice', 'Bob'],  lname: ['Johnson', 'Upton'], age: [28, 28], manualSort: [1, 2],
          age2: ifSupported(56, 56),
        }]);

      // Query with an empty filter.
      const res7 = await activeDoc.useQuerySet(fakeSession,
        {tableId: "Bar", filters: {lname: [], age: [28]}});
      assert.deepEqual(res7.tableData, ["TableData", "Bar", [], {
        fname: [],  lname: [], age: [], manualSort: [],
        age2: [],
      }]);
    }
  });

  describe('fetchQuery', function() {
    this.timeout(10000);

    async function makeDoc(docName: string) {
      const activeDoc = await docTools.createDoc(docName);
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "Theme", [
          { id: 'name', type: 'Text', isFormula: false },
          { id: 'volume', type: 'Numeric', isFormula: false },
        ]],
        ["AddTable", "Animal", [
          { id: 'name', type: 'Text', isFormula: false },
          { id: 'habitat', type: 'Text', isFormula: false },
        ]],
        ["AddTable", "Bar", [
          { id: 'fname', type: 'Text', isFormula: false },
          { id: 'lname', type: 'Text', isFormula: false },
          { id: 'age', type: 'Numeric', isFormula: false },
          { id: 'age2', type: 'Numeric', isFormula: true, formula: '$age * 2' },
          { id: 'theme', type: 'Ref:Theme', isFormula: false },
          { id: 'nightTheme', type: 'Ref:Theme', isFormula: false },
          { id: 'volume', type: 'Numeric', isFormula: true, formula: '$theme.volume' },
          { id: 'lname2', type: 'Text', isFormula: true, formula: '$lname' },
          { id: 'nightVolume', type: 'Numeric', isFormula: true, formula: '$nightTheme.volume' },
          { id: 'animal', type: 'Ref:Animal', isFormula: false },
          { id: 'habitat', type: 'Text', isFormula: true, formula: '$animal.habitat' },
        ]],
        ["AddTable", "Dupe", [
          { id: 'name', type: 'Text', isFormula: false },
          { id: 'theme', type: 'Ref:Theme', isFormula: false },
          { id: 'volume', type: 'Numeric', isFormula: true, formula: '$theme.volume' },
        ]],
        ["AddRecord", "Theme", 1, { name: 'Space', volume: 15 }],
        ["AddRecord", "Theme", 2, { name: 'Underwater', volume: 3 }],
        ["AddRecord", "Animal", 1, { name: 'Camel', habitat: 'Desert' }],
        ["AddRecord", "Animal", 2, { name: 'Koala', habitat: 'Australia' }],
        ["AddRecord", "Bar", 1, { fname: 'Alice',  lname: 'Johnson', age: 28, theme: 1 }],
        ["AddRecord", "Bar", 2, { fname: 'Bob', lname: 'Upton', age: 28, theme: 1, animal: 2 }],
        ["AddRecord", "Bar", 3, { fname: 'Bob', lname: 'C', age: 0, theme: 2, nightTheme: 1 }],
        ["SetDisplayFormula", "Bar", null, 9, '$theme.name'],
        ["AddRecord", "Dupe", 1, { name: 'Me', theme: 2 }],
      ]);
      return activeDoc;
    }

    // Run queries on tables, either regular or on-demand.
    async function commonQueries(activeDoc: ActiveDoc, onDemand: boolean) {
      // some formulas are not yet supported for on-demand tables.
      const ifSupported = (...args: any[]) => args.map(v => onDemand ? UNSUPPORTED_FORMULA : v);
      // values via invalid references are not yet consistent.
      const noNumeric = onDemand ? null : 0;
      const noText = onDemand ? null : "";
      // on-demand table can not yet be filtered by the output of a formula.
      const ageFilter: {[key: string]: any[]} = onDemand ? {age: [28]} : {age2: [56]};

      const query = async (s: OptDocSession, q: ServerQuery) => (await activeDoc.fetchQuery(s, q)).tableData;
      assert.deepEqual(await query(fakeSession,
        {tableId: 'Bar', filters: {fname: ['Bob'], lname: ['Upton']}}),
        ['TableData', 'Bar', [2], {
          fname: ['Bob'], lname: ['Upton'], age: [28], age2: ifSupported(56), manualSort: [2],
          theme: [1], gristHelper_Display: ['Space'],
          nightTheme: [0],
          volume: [15],
          lname2: ['Upton'],
          nightVolume: [noNumeric],
          animal: [2], habitat: ['Australia'],
        }]);

      assert.deepEqual(await query(fakeSession,
        {tableId: 'Bar', filters: ageFilter}),
        ['TableData', 'Bar', [1, 2], {
          fname: ['Alice', 'Bob'], lname: ['Johnson', 'Upton'], age: [28, 28],
          age2: ifSupported(56, 56),
          manualSort: [1, 2],
          theme: [1, 1], gristHelper_Display: ['Space', 'Space'],
          nightTheme: [0, 0],
          volume: [15, 15],
          lname2: ['Johnson', 'Upton'],
          nightVolume: [noNumeric, noNumeric],
          animal: [0, 2], habitat: [noText, 'Australia'],
        }]);

      assert.deepEqual(await query(fakeSession,
        {tableId: 'Bar', filters: {fname: ['Bob'], ...ageFilter}}),
        ['TableData', 'Bar', [2], {
          fname: ['Bob'], lname: ['Upton'], age: [28], age2: ifSupported(56),
          manualSort: [2],
          theme: [1], gristHelper_Display: ['Space'],
          nightTheme: [0],
          volume: [15],
          lname2: ['Upton'],
          nightVolume: [noNumeric],
          animal: [2], habitat: ['Australia'],
        }]);

      assert.deepEqual(await query(fakeSession,
        {tableId: 'Bar', filters: {fname: ['Bob']}}),
        ['TableData', 'Bar', [2, 3], {
          fname: ['Bob', 'Bob'], lname: ['Upton', 'C'], age: [28, 0],
          age2: ifSupported(56, 0),
          manualSort: [2, 3],
          theme: [1, 2], gristHelper_Display: ['Space', 'Underwater'],
          nightTheme: [0, 1],
          volume: [15, 3],
          lname2: ['Upton', 'C'],
          nightVolume: [noNumeric, 15],
          animal: [2, 0], habitat: ['Australia', noText],
        }]);

      assert.deepEqual(await query(fakeSession,
        {tableId: 'Bar', filters: {fname: ['Bob'], age: [0]}}),
        ['TableData', 'Bar', [3], {
          fname: ['Bob'], lname: ['C'], age: [0], age2: ifSupported(0), manualSort: [3],
          theme: [2], gristHelper_Display: ['Underwater'],
          nightTheme: [1],
          volume: [3],
          lname2: ['C'],
          nightVolume: [15],
          animal: [0], habitat: [noText],
        }]);

      await assert.isRejected(query(fakeSession, {tableId: 'Foo', filters: {}}),
        /Sandbox.*Foo/);
    }

    // Get a list of indexes on user tables of form [Table1.col1, Table1.col2, ...]
    async function getIndexes(activeDoc: ActiveDoc) {
      const indexes = await activeDoc.docStorage.testGetIndexes();
      return indexes.map(idx => `${idx.tableId}.${idx.colId}`);
    }

    it('should support querying for regular tables', async function() {
      const docName = 'doc_fetch_query1';
      const activeDoc = await makeDoc(docName);
      assert.lengthOf(await activeDoc.docStorage.testGetIndexes(), 0);
      await commonQueries(activeDoc, false);
    });

    it('should support querying for on-demand tables', async function() {
      const docName = 'doc_fetch_query2';
      let activeDoc = await makeDoc(docName);
      assert.lengthOf(await getIndexes(activeDoc), 0);
      activeDoc = await reloadOnDemand(activeDoc, 'Bar');

      // Check we got indexes for reference columns
      assert.sameMembers(await getIndexes(activeDoc), ['Bar.animal', 'Bar.nightTheme', 'Bar.theme']);

      // Make queries as before; this time the results have SQL-based formula evaluation.
      await commonQueries(activeDoc, true);

      // Duplicate column names should not be a problem for on-demand tables with references.
      // There was previously an "ambiguous column name" problem for a table with a reference
      // to another table with a column of the same name, where the query was filtered by
      // that column name.
      activeDoc = await reloadOnDemand(activeDoc, 'Dupe');

      assert.sameMembers(await getIndexes(activeDoc), ['Bar.animal', 'Bar.nightTheme', 'Bar.theme', 'Dupe.theme']);

      assert.deepEqual((await activeDoc.fetchQuery(fakeSession,
                        {tableId: 'Dupe', filters: {name: ['Me']}})).tableData,
        ['TableData', 'Dupe', [1], {
          manualSort: [1], name: ['Me'], theme: [2], volume: [3]
        }]);

      // Make Bar a regular table again, and check that its indexes go away.
      activeDoc = await reloadOnDemand(activeDoc, 'Bar', false);
      assert.sameMembers(await getIndexes(activeDoc), ['Dupe.theme']);

      // Make Dupe a regular table again, and check that its indexes go away.
      activeDoc = await reloadOnDemand(activeDoc, 'Dupe', false);
      assert.lengthOf(await getIndexes(activeDoc), 0);
    });

    it('should maintain indexes for on-demand tables across schema changes', async function() {
      const docName = 'doc_fetch_query3';
      const activeDoc = await reloadOnDemand(await makeDoc(docName), 'Dupe');
      assert.sameMembers(await getIndexes(activeDoc), ['Dupe.theme']);
      await activeDoc.applyUserActions(fakeSession, [
        ['RenameColumn', 'Dupe', 'theme', 'thematic']
      ]);
      assert.sameMembers(await getIndexes(activeDoc), ['Dupe.thematic']);
      await activeDoc.applyUserActions(fakeSession, [
        ['RemoveColumn', 'Dupe', 'thematic']
      ]);
      assert.lengthOf(await getIndexes(activeDoc), 0);
      await activeDoc.applyUserActions(fakeSession, [
        ['AddColumn', 'Dupe', 'retheme', {type: 'Ref:Theme', isFormula: false}]
      ]);
      assert.sameMembers(await getIndexes(activeDoc), ['Dupe.retheme']);
      await activeDoc.applyUserActions(fakeSession, [
        ['ModifyColumn', 'Dupe', 'retheme', {label: 'retheme!'}]
      ]);
      assert.sameMembers(await getIndexes(activeDoc), ['Dupe.retheme_']);
    });
  });

  describe('Data Types', function() {

    it('should load data with exact types as stored', async function() {
      const docName = 'all-types';
      const activeDoc1 = await docTools.createDoc(docName);
      const rowIds = _.range(1, allValues.length + 1);

      // Data maps each type to the array containing all values (the same for each column). So
      // each row contains a single value copied across all column.
      const data = _.fromPairs(_.map(allTypes, (type, colId) => [colId, _.clone(allValues)])) as BulkColValues;

      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'Types', _.map(allTypes, (type, id) => ({id, type, isFormula: false}))],
        // Force lower-level DocActions to be applied rather than UserActions, to avoid all the
        // smartness that sandbox might have (e.g. setting manualSort values).
        ['ApplyDocActions', [['BulkAddRecord', 'Types', rowIds, data]]],
      ]);

      // We expect data ALMOST as stored, except that when we load 1/0 into a Bool column, they
      // come out as true/false. This is, I think, acceptable.
      const expectedData = _.clone(data);
      expectedData.Bool = expectedData.Bool.map((x: any) => (x === 0 ? false : (x === 1 ? true : x)));

      // Check that values from the sandbox are correct.
      assert.deepEqual(await fetchValues(activeDoc1, 'Types'), expectedData);

      // Shut down the doc, re-load it from the database, and check again.
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);
      assert.deepEqual(await fetchValues(activeDoc2, 'Types'), expectedData);

      // Reload as an on-demand table to test how data comes out when read directly from DB.
      const activeDoc3 = await reloadOnDemand(activeDoc2, 'Types', true);
      assert.deepEqual(await fetchValues(activeDoc3, 'Types'), expectedData);
    });

    it('should not produce spurious Calculate actions with type conversions', async function() {
      // When we load formula results and recalculate them, we should find exactly equal values
      // (and so, the recalculation should not produce any action to change the document).
      const docName = 'formula-types';
      const activeDoc1 = await docTools.createDoc(docName);
      const rowIds = _.range(1, allValues.length + 1);
      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'Types', [
          {id: 'value', type: 'Any', isFormula: false},
          {id: 'valueRepr', type: 'Any', isFormula: true, formula: 'type($value)'},
          // Here we'll create a formula column of each type, each of which returns the various
          // possible values in different rows.
          ..._.map(allTypes, (type, id) => ({id, type, isFormula: true, formula: '$value'})),

          // Some values end up with identical representation after encoding to JSON and DB and
          // loading from it. E.g. 5 and 5.0, or "A" and u"A". Typed columns make them uniform
          // (this is checked by the columns above). A formula column of type 'Any' that evaluates
          // to 5.0 will get loaded from DB as 5 (int). On Calculate, it will get corrected (to
          // 5.0) -- so other Python code sees the precise values -- but should not emit any
          // action, since there is no change as seen from outside the sandbox. This isn't covered
          // by the columns above because both the formula column and its source are loaded in the
          // same way. So test using another column that produces different value types.
          {id: 'typeConv', type: 'Any', isFormula: true, formula:
            '(bool($value) if $value == 1 else\n' +
            ' float($value) if isinstance($value, (int, bool)) else\n' +
            ' int($value) if isinstance($value, float) else\n' +
            ' unicode($value) if isinstance($value, str) else\n' +
            ' $value)'
          },
        ]],
        // Force lower-level DocActions to be applied rather than UserActions, to avoid all the
        // smartness that sandbox might have (e.g. setting manualSort values).
        ['ApplyDocActions', [['BulkAddRecord', 'Types', rowIds, {value: allValues}]]],
      ]);

      // Get the data from the sandbox. Formulas convert their results to the column's type, so we
      // don't expect them equal to the original allValues.
      // TODO: I now think it's a poor approach; it would be better to keep the formula's result
      // unchanged, and only use the column type to inform the UI on rendering, linking, etc.
      const data1 = await fetchValues(activeDoc1, 'Types');

      // The 'Any' columns are easy to check.
      assert.deepEqual(data1.value, allValues as CellValue[]);
      assert.deepEqual(data1.Any, allValues as CellValue[]);

      // There should just be the one UserAction that we created.
      const actions1 = await activeDoc1.getRecentActionsDirect();
      assert.deepEqual(actions1.map(a => a.userActions.map(ua => ua[0])),
        [[], ['AddTable', 'ApplyDocActions']]);

      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);
      const data2 = await fetchValues(activeDoc2, 'Types');

      // There should still just be the one UserAction, as before, and no new 'Calculate' action.
      const actions2 = await activeDoc2.getRecentActionsDirect();
      if (actions2[2]) {
        // An extra action is a problem; add an assert that will print some details.
        assert.deepEqual(getEnvContent(actions2[2].stored), []);
      }
      assert.deepEqual(actions2.map(a => a.userActions.map(ua => ua[0])),
        [[], ['AddTable', 'ApplyDocActions']]);

      assert.deepEqual(data2.value, allValues as CellValue[]);
      assert.deepEqual(data2.Any, allValues as CellValue[]);
      assert.deepEqual(data2, data1);
    });

    it('should produce correct defaults for all types', async function() {
      const docName = 'type-defaults';
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'Defaults', _.map(allTypes, (type, id) => ({id, type, isFormula: false}))],
        // Force lower-level DocActions to be applied rather than UserActions, to avoid all the
        // smartness that sandbox might have (e.g. setting manualSort values).
        ['ApplyDocActions', [['AddRecord', 'Defaults', 1, {}]]],
      ]);

      const expectedData = _.mapValues(allTypes, t => [gristTypes.getDefaultForType(t)]);

      // Check that values from the sandbox are correct.
      assert.deepEqual(await fetchValues(activeDoc1, 'Defaults'), expectedData);

      // Shut down the doc, re-load it from the database, and check again.
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);
      assert.deepEqual(await fetchValues(activeDoc2, 'Defaults'), expectedData);

      // Reload as an on-demand table to test how data comes out when read directly from DB.
      const activeDoc3 = await reloadOnDemand(activeDoc2, 'Defaults', true);
      assert.deepEqual(await fetchValues(activeDoc3, 'Defaults'), expectedData);
    });

    it('should produce correct defaults after a column conversion', async function() {
      const docName = 'defaults-conversions';
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'Defaults', _.map(allTypes, (type, id) => ({id, type, isFormula: false}))],

        // This isn't a normal conversion, but just the ModifyColumn docaction part.
        ['ModifyColumn', 'Defaults', 'Any',           {type: 'Blob'}],
        ['ModifyColumn', 'Defaults', 'Blob',          {type: 'Text'}],
        ['ModifyColumn', 'Defaults', 'Bool',          {type: 'Int'}],
        ['ModifyColumn', 'Defaults', 'Int',           {type: 'Numeric'}],
        ['ModifyColumn', 'Defaults', 'ManualSortPos', {type: 'Ref:Defaults'}],
        ['ModifyColumn', 'Defaults', 'Numeric',       {type: 'Bool'}],
        ['ModifyColumn', 'Defaults', 'Ref',           {type: 'Attachments'}],
        ['ModifyColumn', 'Defaults', 'Text',          {type: 'Numeric'}],

        // Add a new record with all defaults. We'll check that we get correct defaults.
        ['ApplyDocActions', [['AddRecord', 'Defaults', 1, {}]]],
      ]);

      // For all columns that we converted, expect the new default.
      const expectedRow = _.mapValues(allTypes, t => gristTypes.getDefaultForType(t));
      expectedRow.Any           = gristTypes.getDefaultForType('Blob');
      expectedRow.Blob          = gristTypes.getDefaultForType('Text');
      expectedRow.Bool          = gristTypes.getDefaultForType('Int');
      expectedRow.Int           = gristTypes.getDefaultForType('Numeric');
      expectedRow.ManualSortPos = gristTypes.getDefaultForType('Ref:Default');
      expectedRow.Numeric       = gristTypes.getDefaultForType('Bool');
      expectedRow.Ref           = gristTypes.getDefaultForType('Attachments');
      expectedRow.Text          = gristTypes.getDefaultForType('Numeric');

      const expectedData = _.mapValues(expectedRow, v => [v]);

      assert.deepEqual(await fetchValues(activeDoc1, 'Defaults'), expectedData);

      // Shut down the doc, re-load it from the database, and check again.
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);
      assert.deepEqual(await fetchValues(activeDoc2, 'Defaults'), expectedData);

      // Reload as an on-demand table to test how data comes out when read directly from DB.
      const activeDoc3 = await reloadOnDemand(activeDoc2, 'Defaults', true);
      assert.deepEqual(await fetchValues(activeDoc3, 'Defaults'), expectedData);
    });
  });

  describe("SQLite data", function() {
    it('should produce expected SQLite data', async function() {
      // This test is to allow us to verify what gets stored in SQLite for different data types.
      // It checks that what's stored corresponds to test/fixtures/docs/ActiveDoc-sqlite.grist,
      // so see THAT FILE for the expected data.
      //
      // If this test fails due to an expected difference, run the test with NO_CLEANUP=1 in the
      // environment, using test/testrun.sh. This will leave the actual file produced in
      // _testoutputs/server/testdir/grist_test_XXXXXX/actual-data.grist. Run `sqlite3 $file
      // .dump` on the expected and actual files, and check differences. A good way is:
      //
      //    git diff --no-index --color-words='\w+|[^[:space:]]' $dump1 $dump2
      //
      // If all as it should be, replace the text fixture.
      //
      // Some points of note:
      // - Booleans are 0/1 in the Bool column, but marshalled values (X'46', X'54') elsewhere.
      // - .dump represents Infinity as Inf, which is unusable to actually load data from it.
      // - .dump represents -0.0 as 0.0, which is wrong (but reading DB returns it correctly).

      const docName = 'actual-data';
      const activeDoc1 = await docTools.createDoc(docName);
      const docPath = activeDoc1.docStorage.docPath;

      const rowIds = _.range(1, allValues.length + 1);
      const data = _.fromPairs(_.map(allTypes, (type, colId) => [colId, _.clone(allValues)]));
      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'Types', _.map(allTypes, (type, id) => ({id, type, isFormula: false}))],
        // Force lower-level DocActions to be applied rather than UserActions, to avoid all the
        // smartness that sandbox might have (e.g. setting manualSort values).
        ['ApplyDocActions', [['BulkAddRecord', 'Types', rowIds, data]]],
        ['AddTable', 'Defaults', _.map(allTypes, (type, id) => ({id, type, isFormula: false}))],
        // Force lower-level DocActions to be applied rather than UserActions, to avoid all the
        // smartness that sandbox might have (e.g. setting manualSort values).
        ['ApplyDocActions', [['AddRecord', 'Defaults', 1, {}]]],
      ]);
      await activeDoc1.shutdown();

      const stdout = await dumpTables(docPath);
      const expectedDocPath = resolve(testUtils.fixturesRoot, 'docs', 'ActiveDoc-sqlite.grist');
      const expectedStdout = await dumpTables(expectedDocPath);
      assert.deepEqual(stdout, expectedStdout);
    });
  });

  describe("ActionHistory", function() {
    it('should exist', async function() {
      const docName = 'tmp';
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.addInitialTable(fakeSession);
      const {actions: actions1} = await activeDoc1.getRecentActions(fakeSession, true);
      assert.lengthOf(actions1, 2);
      assert.equal(actions1[1].primaryAction, 'AddEmptyTable');
      assert.equal(actions1[1].actionNum, 2);
      await activeDoc1.shutdown();

      const activeDoc2 = await docTools.loadDoc(docName);
      const {actions: actions2} = await activeDoc2.getRecentActions(fakeSession, true);
      assert.lengthOf(actions2, 2);
      assert.equal(actions2[1].primaryAction, 'AddEmptyTable');
      assert.equal(actions2[1].actionNum, 2);
      const action = actions2[1];
      for (const key of ['actionNum', 'fromSelf']) {
        assert.include(Object.keys(action), key);
      }
    });

    it('should be sequential', async function() {
      const docName = 'tmp2';
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.addInitialTable(fakeSession);
      await activeDoc1.applyUserActions(fakeSession, [
        ["AddTable", "Hello", [{id: "city", type: "Text"}, {id: "state", type: "Text"}]],
        ["BulkAddRecord", "Hello", [1, 4], {
          city: ['New York', 'Boston'],
          state: ['NY', 'MA'],
        }]
      ]);
      async function checkDoc(doc: ActiveDoc) {
        const {actions} = await doc.getRecentActions(fakeSession, true);
        assert.lengthOf(actions, 3);
        assert.equal(actions[1].primaryAction, 'AddEmptyTable');
        assert.equal(actions[1].actionNum, 2);
        assert.equal(actions[2].primaryAction, 'AddTable');
        assert.equal(actions[2].actionNum, 3);
        await doc.shutdown();
      }
      await checkDoc(activeDoc1);
      const activeDoc2 = await docTools.loadDoc(docName);
      await checkDoc(activeDoc2);
    });
  });

  it('should not attribute Calculate actions to opening user', async function() {
    // Set up a fake test@test user session.
    const docName = 'calculate-attribution';

    // Make a fake client with a particular fake user.
    const authSession = AuthSession.fromUser({id: 17, name: 'Test McTester', email: 'test@test'}, 'docs');
    const client = new Client(null as any, null as any, null!);
    client.setConnection({websocket: {} as any, req: null as any, counter: null, browserSettings: {}, authSession});
    const userSession = makeOptDocSession(client);
    userSession.authorizer = new DummyAuthorizer('owners', docName);

    // Make a document with a cell that is set to "=NOW()"
    const activeDoc1 = await docTools.createDoc(docName);
    await activeDoc1.applyUserActions(userSession, [
      ['AddTable', 'Calc', [
        {id: 'tick', type: 'Any', isFormula: true, formula: 'NOW()'},
      ]],
      ['AddRecord', 'Calc', null, {}],
    ]);

    // Check we see the expected user actions.
    await fetchValues(activeDoc1, 'Calc');
    const actions1 = await activeDoc1.getRecentActionsDirect();
    assert.deepEqual(actions1.map(a => a.userActions.map(ua => ua[0])),
                     [[], ['AddTable', 'AddRecord']]);

    // Close and reopen.
    await activeDoc1.shutdown();
    const activeDoc2 = await docTools.loadDoc(docName);

    // Fetch table to make sure any calculation is complete.
    await fetchValues(activeDoc2, 'Calc');

    // Check we see we have an extra Calculate action now, and its user is
    // overridden to be "grist".
    const actions2 = await activeDoc2.getRecentActionsDirect();
    assert.deepEqual(actions2.map(a => a.userActions.map(ua => ua[0])),
                     [[], ['AddTable', 'AddRecord'], ['Calculate']]);
    assert.equal(actions2[0].info[1].user, 'grist');
    assert.equal(actions2[1].info[1].user, 'test@test');
    assert.equal(actions2[2].info[1].user, 'grist');
  });

  describe('applyUserActions', function() {
    it('should send user info to the sandbox', async function() {
      // Set up a fake user session.
      const docName = 'user-info';
      const authSession = AuthSession.fromUser(
        {id: 567, ref: 'randomString', name: 'testUser', email: 'test@test'},
        '',
        'u567'
      );
      const client = new Client(null as any, null as any, null!);
      client.setConnection({websocket: {} as any, req: null as any, counter: null, browserSettings: {}, authSession});
      const userSession = makeExceptionalDocSession('system', {client});

      // Spy on calls to the sandbox.
      const rawPyCall = sandbox.spy(ActiveDoc.prototype, "_rawPyCall" as any);

      // Make a document and add a table with some records.
      const activeDoc = await docTools.createDoc(docName);
      await activeDoc.applyUserActions(userSession, [
        ["AddTable", "Residences",
          [{id: "email", type: "Text"}, {id: "city", type: "Text"}, {id: "state", type: "Text"}]
        ],
        ["BulkAddRecord", "Residences", [1, 4], {
          email: ['foo@getgrist.com', 'test@test'],
          city: ['New York', 'Boston'],
          state: ['NY', 'MA'],
        }]
      ]);

      // Check that the last call to sandbox included correct user info.
      assert.deepEqual(
        rawPyCall.lastCall.args[2],
        {
          Access: 'owners',
          Email: 'test@test',
          IsLoggedIn: true,
          LinkKey: {},
          Origin: null,
          Name: 'testUser',
          SessionID: 'u567',
          ShareRef: null,
          UserID: 567,
          UserRef: 'randomString',
          Type: null,
        }
      );

      // Add another table, and set up the tables to be user attribute tables.
      await activeDoc.applyUserActions(userSession, [
        ["AddTable", "Favorites",
          [{id: "email", type: "Text"}, {id: "color", type: "Text"}, {id: "food", type: "Text"}]
        ],
        ["BulkAddRecord", "Favorites", [1, 2, 3], {
          email: ['foo@getgrist.com', 'bar@getgrist.com', ''],
          color: ['Red', 'Green', 'Blue'],
          food: ['Pizza', 'Pasta', 'Soup'],
        }],
        ['AddRecord', '_grist_ACLResources', -1, {tableId: '*', colIds: '*'}],
        ['AddRecord', '_grist_ACLResources', -2, {tableId: 'Residences', colIds: '*'}],
        ['AddRecord', '_grist_ACLResources', -3, {tableId: 'Favorites', colIds: '*'}],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, userAttributes: JSON.stringify({
            name: 'Residences',
            tableId: 'Residences',
            charId: 'Email',
            lookupColId: 'email',
          })
        }],
        ['AddRecord', '_grist_ACLRules', null, {
          resource: -1, userAttributes: JSON.stringify({
            name: 'Favorites',
            tableId: 'Favorites',
            charId: 'Email',
            lookupColId: 'email',
          })
        }],
      ]);

      // Trigger another user action by adding one more record.
      await activeDoc.applyUserActions(userSession, [
        ["BulkAddRecord", "Residences", [3], {
          email: [''],
          city: ['Portland'],
          state: ['OR'],
        }]
      ]);

      // Check that the correct attributes are included in the user info sent to the sandbox.
      assert.deepEqual(
        rawPyCall.lastCall.args[2],
        {
          Access: 'owners',
          Email: 'test@test',
          IsLoggedIn: true,
          LinkKey: {},
          Origin: null,
          Name: 'testUser',
          SessionID: 'u567',
          ShareRef: null,
          Type: null,
          UserID: 567,
          UserRef: `randomString`,
          Residences: ['Residences', 4],
          Favorites: null,
        }
      );

      rawPyCall.restore();
    });
  });

  describe('sandboxed python3', async function() {
    let oldEnv: EnvironmentSnapshot | undefined;

    before(async function() {
      // Skip this test if sandbox is not present.
      if (!await canSandboxPython3()) { this.skip(); }
      oldEnv = new EnvironmentSnapshot();
      // Set environment variable that currently determines whether a sandbox choice is allowed.
      process.env.GRIST_EXPERIMENTAL_PLUGINS = '1';
      delete process.env.GRIST_SANDBOX_FLAVOR;
    });

    after(async function() {
      oldEnv?.restore();
    });

    // Adds an Info table containing `sys.version`, and checks python
    // is version 3.
    async function checkPythonIs3(activeDoc: ActiveDoc) {
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "Info", [
          {id: 'Version', formula: 'import sys\nsys.version'},
          {id: 'UUID', formula: 'UUID()'}
        ]],
        ["AddRecord", "Info", null, {}],
      ]);
      const version = String((await activeDoc.fetchTable(fakeSession, 'Info', true)).tableData[3].Version[0]);
      assert.match(version, /3\./);
      assert.notMatch(version, /2\.7/);
    }

    async function makePython3Doc(docName: string) {
      // Make a python3 document.
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.applyUserActions(fakeSession, [
        ["UpdateRecord", "_grist_DocInfo", 1, {
          documentSettings: JSON.stringify({ engine: 'python3' }),
        }]
      ]);
      await activeDoc1.shutdown();
      const activeDoc2 = await docTools.loadDoc(docName);
      await checkPythonIs3(activeDoc2);
      return activeDoc2;
    }

    it('can use python3 sandbox', async function() {
      await makePython3Doc('sandbox');  // includes test for python3-ness
    });

    // There was a problem where checkpointed sandboxes had same seed.
    // Checkpointing is currently used in running these tests. If that
    // changes, this test would pass trivially.
    it('can use randomness in python3 sandbox', async function() {
      const activeDoc = await makePython3Doc('randomness');
      const uuid1 = String((await activeDoc.fetchTable(fakeSession, 'Info', true)).tableData[3].UUID[0]);
      await activeDoc.shutdown();
      const activeDoc2 = await docTools.loadDoc('randomness');
      const uuid2 = String((await activeDoc2.fetchTable(fakeSession, 'Info', true)).tableData[3].UUID[0]);
      assert.notEqual(uuid1, uuid2);
    });

    it('can throttle python3', async function() {
      this.timeout(60000);
      process.env.GRIST_THROTTLE_CPU = '1';

      let logMeta: log.ILogMeta = {};
      sandbox.replace(Throttle.prototype, "_log" as any, async function(msg: string, meta: log.ILogMeta) {
        log.rawWarn(msg, meta);  // Show something since this is a slow operation.
        logMeta = meta;
      });

      const activeDoc = await makePython3Doc('throttle');
      activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "SlowTable", [{
          id: 'Delay',
          formula: 'total = 0\nfor x in range(0, 1000000000):\n  total += x\nreturn total'}]],
        ["AddRecord", "SlowTable", null, {}],
      ]).catch(e => null);
      // Make sure we can throttle down - broken throttling would leave throttledRate up
      // near 100.
      while (!logMeta || !logMeta.throttle || logMeta.throttledRate > 60) {
        await delay(250);
      }
    });

    it('can limit memory use by python3', async function() {
      if (!process.env.GVISOR_LIMIT_MEMORY) { this.skip(); }

      const activeDoc = await makePython3Doc('memory');
      // Add a table with a formula that uses a lot of memory during computation.
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "TestTable", [{
          id: 'Size', type: 'Int',
        }, {
          id: 'Test',
          formula: 'len("x" * $Size)'
        }]],
        ["AddRecord", "TestTable", null, {Size: 1}],
      ]);

      // Push a bit.
      const MB = 1024 * 1024;
      await assert.isFulfilled(activeDoc.applyUserActions(fakeSession, [
        ["UpdateRecord", "TestTable", 1, {Size: 10 * MB}]
      ]));

      // Push a bit more.
      await assert.isFulfilled(activeDoc.applyUserActions(fakeSession, [
        ["UpdateRecord", "TestTable", 1, {Size: 100 * MB}]
      ]));

      // Push too much.
      const tooMuch = parseInt(process.env.GVISOR_LIMIT_MEMORY, 10);
      await assert.isRejected(activeDoc.applyUserActions(fakeSession, [
        ["UpdateRecord", "TestTable", 1, {Size: tooMuch}]
      ]), /MemoryError/);
    });

    it('can use python3 sandbox by default', async function() {
      const docName = 'sandbox-default';
      const activeDoc = await docTools.createDoc(docName);
      await checkPythonIs3(activeDoc);
    });
  });

  it('can access document before engine opens', async function() {
    // Create a document.
    const docName = 'makeEngineTest';
    const activeDoc1 = await docTools.createDoc(docName);
    await activeDoc1.addInitialTable(fakeSession);
    await activeDoc1.applyUserActions(fakeSession, [
      ["AddTable", "Info", [{id: 'Version', type: 'Int'}]],
      ["AddRecord", "Info", null, {Version: 10}],
    ]);

    // Shut down document, then delay future engine creation by a second.
    await activeDoc1.shutdown();
    const makeEngineFn = (ActiveDoc.prototype as any)._makeEngine;
    sandbox.replace(ActiveDoc.prototype, "_makeEngine" as any, async function(this: any) {
      await delay(1000);
      return makeEngineFn.apply(this);
    });

    // Check an immediate fetch sees data.
    const activeDoc2 = await docTools.loadDoc(docName);
    let version = (await activeDoc2.fetchTable(fakeSession, 'Info', false)).tableData[3].Version[0];
    assert.equal(version, 10);

    // Start making a change - this will be blocked on engine availability.
    const change = activeDoc2.applyUserActions(fakeSession, [
      ["UpdateRecord", "Info", 1, {Version: 20}],
    ]).catch(e => console.error(e));

    // Check a fetch after a half-second doesn't see a change.
    await delay(500);
    version = (await activeDoc2.fetchTable(fakeSession, 'Info', false)).tableData[3].Version[0];
    assert.equal(version, 10);

    // Check a later fetch does see the change.
    assert.isFalse(await timeoutReached(4000, change));
    version = (await activeDoc2.fetchTable(fakeSession, 'Info', false)).tableData[3].Version[0];
    assert.equal(version, 20);
  });

  it('sandbox passes in docUrl', async function() {
    // Try with a valid docUrl and one with some extra stuff thrown in.
    for (const docUrl of [
      'https://templates.getgrist.com/doc/lightweight-crm~8sJPiNkWZo68KFJkc5Ukbr~4',
      'https://templates!.getgrist.com/doc/lightweight-crm 8sJPiNkWZo68KFJkc5Ukbr~4'
    ] as const) {
      const activeDoc = new ActiveDoc(docTools.getDocManager(), 'docUrlTest' + docUrl.length,
                                      new AttachmentStoreProvider([], "TEST-INSTALL-ID"),
                                      { docUrl });
      await activeDoc.createEmptyDoc(fakeSession);
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "Info", [{id: 'Url', formula: 'SELF_HYPERLINK()'}]],
        ["AddRecord", "Info", null, {}],
      ]);
      const url = String((await activeDoc.fetchTable(fakeSession, 'Info', true)).tableData[3].Url[0]);
      assert.equal(url, docUrl);
      await activeDoc.shutdown();
    }
  });

  it('sandbox passes in truthy custom values', async function () {
    const env = new EnvironmentSnapshot();
    try {
      process.env.GRIST_TRUTHY_VALUES = 'meep';
      // If using GVisor, ignore any checkpoint prepared earlier (since
      // env variable wasn't set then).
      delete process.env.GRIST_CHECKPOINT;
      const activeDoc = new ActiveDoc(docTools.getDocManager(), 'truthyTest');
      await activeDoc.createEmptyDoc(fakeSession);
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "Info", [{id: 'Flag', type: 'Bool'}]],
        ["AddRecord", "Info", null, {Flag: 'meep'}],
        ["AddRecord", "Info", null, {Flag: 'moop'}],
      ]);
      const data = (await activeDoc.fetchTable(fakeSession, 'Info', true)).tableData[3];
      assert.deepEqual(data.Flag, [true, 'moop'], "Expected 'meep' to be truthy");
      await activeDoc.shutdown();
    } finally {
      env.restore();
    }
  });

  it('sandbox passes in falsy custom values', async function () {
    const env = new EnvironmentSnapshot();
    try {
      process.env.GRIST_FALSY_VALUES = 'moop';
      delete process.env.GRIST_CHECKPOINT;
      const activeDoc = new ActiveDoc(docTools.getDocManager(), 'falsyTest');
      await activeDoc.createEmptyDoc(fakeSession);
      await activeDoc.applyUserActions(fakeSession, [
        ["AddTable", "Info", [{id: 'Flag', type: 'Bool'}]],
        ["AddRecord", "Info", null, {Flag: 'meep'}],
        ["AddRecord", "Info", null, {Flag: 'moop'}],
      ]);
      const data = (await activeDoc.fetchTable(fakeSession, 'Info', true)).tableData[3];
      assert.deepEqual(data.Flag, ['meep', false], "Expected 'moop' to be falsy");
      await activeDoc.shutdown();
    } finally {
      env.restore();
    }
  });

  describe('attachments', async function() {
    // Provides the fake userId `null`, so we can access uploaded files with hitting an
    // authorization errors.
    const fakeTransferSession = docTools.createFakeSession();

    const testAttachments = [
      {
        name: "Test.doc",
        contents: "Hello world!",
      },
      {
        name: "Test2.txt",
        contents: "I am a test file!",
      },
    ];

    async function uploadAttachments(doc: ActiveDoc, files: {name: string, contents: string}[]) {
      const { tmpDir, cleanupCallback } = await createTmpUploadDir({});

      const uploadPromises = files.map(async (file) => {
        const filePath = resolve(tmpDir, file.name);
        const buffer = Buffer.from(file.contents, 'utf8');
        await fse.writeFile(path.join(tmpDir, file.name), buffer);
        return {
          absPath: filePath,
          origName: file.name,
          size: buffer.length,
          ext: await guessExt(filePath, file.name, null)
        };
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      const uploadId = globalUploadSet.registerUpload(uploadedFiles, tmpDir, cleanupCallback, null);
      await doc.addAttachments(fakeTransferSession, uploadId);
    }

    async function assertArchiveContents(
      archive: string | Buffer,
      archiveType: string,
      expectedFiles: { name: string; contents?: string }[],
    ) {
      const getFileName = (filePath: string) => filePath.substring(filePath.indexOf("_") + 1);
      const files = await decompress(archive);
      for (const expectedFile of expectedFiles) {
        const file = files.find((file) => getFileName(file.path) === expectedFile.name);
        assert(file, "file not found in archive");
        if (expectedFile.contents) {
          assert.equal(
            file?.data.toString(), expectedFile.contents, `file contents in ${archiveType} archive don't match`);
        }
      }
    }


    it('can enforce internal attachments limit', async function() {

      // Add a tight limit, make sure adding attachments fails.
      let stub = sandbox.stub(Deps, 'MAX_INTERNAL_ATTACHMENTS_BYTES').value(10);
      const activeDoc = await docTools.createDoc('enforceInternalLimit');
      try {
        await assert.isRejected(
          uploadAttachments(activeDoc, testAttachments),
          /Exceeded internal attachments limit/
        );

        // Ease off, make sure adding attachments succeeds.
        stub.restore();
        await assert.isFulfilled(
          uploadAttachments(activeDoc, testAttachments)
        );

        // Add limit again, make sure it works, then set the doc for external
        // storage and see if adding attachments works now.
        stub = sandbox.stub(Deps, 'MAX_INTERNAL_ATTACHMENTS_BYTES').value(10);
        await assert.isRejected(
          uploadAttachments(activeDoc, testAttachments),
          /Exceeded internal attachments limit/
        );
        await activeDoc.setAttachmentStore(
          makeExceptionalDocSession('system'),
          docTools.getAttachmentStoreProvider().listAllStoreIds()[0],
        );
        await assert.isFulfilled(
          uploadAttachments(activeDoc, testAttachments)
        );

        await activeDoc.startTransferringAllAttachmentsToDefaultStore();
        await activeDoc.allAttachmentTransfersCompleted();
        let transfer = await activeDoc.attachmentTransferStatus();
        assert.equal(transfer.status.failures, 0);
        assert.equal(transfer.status.successes, 2);
        // Now transfer attachments back and see if limit is
        // respected.
        await activeDoc.setAttachmentStore(
          makeExceptionalDocSession('system'),
          undefined
        );
        await activeDoc.startTransferringAllAttachmentsToDefaultStore();
        await activeDoc.allAttachmentTransfersCompleted();
        transfer = await activeDoc.attachmentTransferStatus();
        assert.equal(transfer.status.failures, 2);
        assert.equal(transfer.status.successes, 0);
      } finally {
        stub.restore();
        await activeDoc.shutdown();
      }
    });

    it('can pack attachments into an archive', async function() {
      const docName = 'attachment-archive';
      const activeDoc1 = await docTools.createDoc(docName);

      await uploadAttachments(activeDoc1, testAttachments);

      for (const archiveType of CreatableArchiveFormats.values) {
        const archive = await activeDoc1.getAttachmentsArchive(fakeTransferSession, archiveType);
        const archiveMemoryStream = new MemoryWritableStream();
        await archive.packInto(archiveMemoryStream);

        await assertArchiveContents(archiveMemoryStream.getBuffer(), archiveType, testAttachments);
      }
    });

    describe('restoring attachments', () => {
      let activeDoc: ActiveDoc;
      let provider: IAttachmentStoreProvider;
      let externalStoreId: string;

      beforeEach(async function() {
        activeDoc = await docTools.createDoc(this.currentTest?.title ?? 'restore-attachments');
        provider = docTools.getAttachmentStoreProvider();
        externalStoreId = provider.listAllStoreIds()[0];

        await activeDoc.setAttachmentStore(fakeSession, externalStoreId);

        await uploadAttachments(activeDoc, testAttachments);
      });

      async function deleteAttachmentsFromStorage() {
        const store = (await provider.getStore(externalStoreId))!;
        // Purge any attachments related to this doc.
        await store.removePool(getDocPoolIdFromDocInfo({ id: activeDoc.docName, trunkId: undefined }));
      }

      async function downloadAttachmentsTarArchive() {
        const attachmentsArchive = await activeDoc.getAttachmentsArchive(fakeSession, "tar");
        const attachmentsTarStream = new MemoryWritableStream();
        await attachmentsArchive.packInto(attachmentsTarStream);
        return attachmentsTarStream.getBuffer();
      }

      it('can import missing attachments from an archive', async function() {
        const attachmentsTar = await downloadAttachmentsTarArchive();
        await deleteAttachmentsFromStorage();

        const result1 = await activeDoc.addMissingFilesFromArchive(fakeSession, stream.Readable.from(attachmentsTar));
        assert.equal(result1.added, testAttachments.length, "all attachments should be added");

        const result2 = await activeDoc.addMissingFilesFromArchive(fakeSession, stream.Readable.from(attachmentsTar));
        assert.equal(result2.added, 0, "no attachments should be added");
        assert.equal(result2.unused, testAttachments.length, "all attachments should be unused");
      });

      it('updates the document\'s attachment usage on .tar upload', async function() {
        const systemSession = makeExceptionalDocSession('system');

        const attachmentsTar = await downloadAttachmentsTarArchive();
        await deleteAttachmentsFromStorage();

        const getAttachmentTableData = async () =>
          (await activeDoc.fetchTable(systemSession, '_grist_Attachments')).tableData;

        const rowIds = (await getAttachmentTableData())[2];

        const getFileSizes = async () =>
          (await getAttachmentTableData())[3].fileSize;

        const originalFileSizes = await getFileSizes();
        assert(originalFileSizes.every(size => size && size > 0), 'uploaded files should have non-zero sizes');

        // Sets all file sizes in _grist_Attachments to zero.
        await activeDoc.applyUserActions(
          systemSession,
          [['BulkUpdateRecord', '_grist_Attachments', rowIds, { fileSize: rowIds.map(() => 0) }]]
        );

        const zeroedFileSizes = await getFileSizes();
        assert(zeroedFileSizes.every(size => size === 0), 'all file sizes should be 0');

        await activeDoc.addMissingFilesFromArchive(fakeSession, stream.Readable.from(attachmentsTar));
        const restoredFileSizes = await getFileSizes();
        assert.deepEqual(restoredFileSizes, originalFileSizes, 'restored file sizes should match originals');
      });
    });

    /*
    it('can transfer attachments to a new store, with correct status reporting', async function() {
      const docName = 'transfer status';
      const activeDoc1 = await docTools.createDoc(docName);
      await activeDoc1.applyUserActions(fakeSession, [
        ['AddTable', 'MyAttachments', [{id: "A", type: allTypes.Attachments, isFormula: false}]],
      ]);

      const initialTransferStatus = activeDoc1.attachmentTransferStatus();
      assert.isFalse(initialTransferStatus.isRunning);
      assert.equal(initialTransferStatus.pendingTransferCount, 0);

      const initialAttachmentsLocation = await activeDoc1.attachmentLocationSummary();
      assert.equal(initialAttachmentsLocation, "NO FILES");

      await uploadAttachments(activeDoc1, [{
        name: "A.txt",
        contents: "Contents1",
      }]);

      const postUploadAttachmentsLocation = await activeDoc1.attachmentLocationSummary();
      assert.equal(postUploadAttachmentsLocation, "INTERNAL");

      await activeDoc1.setAttachmentStore(fakeSession, attachmentStoreProvider.listAllStoreIds()[0]);
      await activeDoc1.startTransferringAllAttachmentsToDefaultStore();

      // These assertions should always be correct, as we don't await any promises here, so there's
      // no time for the async transfers to run.
      const transferStartedStatus = activeDoc1.attachmentTransferStatus();
      assert.isTrue(transferStartedStatus.isRunning);
      assert.isTrue(transferStartedStatus.pendingTransferCount > 0, "at least one transfer should be pending");

      // Can't assert location here, as "INTERNAL", "MIXED" and "EXTERNAL" are all valid, depending
      // on how the transfer status is going in the background.

      await activeDoc1.allAttachmentTransfersCompleted();

      const finalTransferStatus = activeDoc1.attachmentTransferStatus();
      assert.isFalse(finalTransferStatus.isRunning);
      assert.equal(finalTransferStatus.pendingTransferCount, 0);

      const finalAttachmentsLocation = await activeDoc1.attachmentLocationSummary();
      assert(finalAttachmentsLocation, "INTERNAL");
    });
    */
  });
});

async function dumpTables(path: string): Promise<string> {
  return await execFileAsync('sqlite3', [path, '.dump Types', '.dump Defaults']);
}

async function canSandboxPython3() {
  return await fse.pathExists('/usr/bin/runsc') ||  // linux sandbox
    await fse.pathExists('/usr/local/bin/runsc') ||
    await fse.pathExists('/usr/bin/sandbox-exec');  // mac sandbox
}
