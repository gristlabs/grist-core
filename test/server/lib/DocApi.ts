import {ActionSummary} from 'app/common/ActionSummary';
import {BulkColValues} from 'app/common/DocActions';
import {arrayRepeat} from 'app/common/gutil';
import {DocState, UserAPIImpl} from 'app/common/UserAPI';
import {AddOrUpdateRecord} from 'app/plugin/DocApiTypes';
import {teamFreeFeatures} from 'app/gen-server/entity/Product';
import {CellValue, GristObjCode} from 'app/plugin/GristData';
import {applyQueryParameters, docDailyApiUsageKey} from 'app/server/lib/DocApi';
import * as log from 'app/server/lib/log';
import {exitPromise} from 'app/server/lib/serverUtils';
import {connectTestingHooks, TestingHooksClient} from 'app/server/lib/TestingHooks';
import axios, {AxiosResponse} from 'axios';
import {delay} from 'bluebird';
import * as bodyParser from 'body-parser';
import {assert} from 'chai';
import {ChildProcess, execFileSync, spawn} from 'child_process';
import * as FormData from 'form-data';
import * as fse from 'fs-extra';
import * as _ from 'lodash';
import fetch from 'node-fetch';
import {tmpdir} from 'os';
import * as path from 'path';
import {createClient, RedisClient} from 'redis';
import {configForUser} from 'test/gen-server/testUtils';
import {serveSomething, Serving} from 'test/server/customUtil';
import * as testUtils from 'test/server/testUtils';
import clone = require('lodash/clone');
import defaultsDeep = require('lodash/defaultsDeep');

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');
const charon = configForUser('Charon');
const nobody = configForUser('Anonymous');
const support = configForUser('support');

// some doc ids
const docIds: {[name: string]: string} = {
  ApiDataRecordsTest: 'sample_7',
  Timesheets: 'sample_13',
  Bananas: 'sample_6',
  Antartic: 'sample_11'
};

// A testDir of the form grist_test_{USER}_{SERVER_NAME}
const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi`);

let dataDir: string;
let suitename: string;
let serverUrl: string;
let homeUrl: string;
let hasHomeApi: boolean;
let home: TestServer;
let docs: TestServer;
let userApi: UserAPIImpl;

describe('DocApi', function() {
  this.timeout(20000);
  testUtils.setTmpLogLevel('error');
  const oldEnv = clone(process.env);

  before(async function() {
    // Create the tmp dir removing any previous one
    await fse.remove(tmpDir);
    await fse.mkdirs(tmpDir);
    log.warn(`Test logs and data are at: ${tmpDir}/`);

    // Let's create a sqlite db that we can share with servers that run in other processes, hence
    // not an in-memory db. Running seed.ts directly might not take in account the most recent value
    // for TYPEORM_DATABASE, because ormconfig.js may already have been loaded with a different
    // configuration (in-memory for instance). Spawning a process is one way to make sure that the
    // latest value prevail.
    process.env.TYPEORM_DATABASE = path.join(tmpDir, 'landing.db');
    const seed = await testUtils.getBuildFile('test/gen-server/seed.js');
    execFileSync('node', [seed, 'init'], {
      env: process.env,
      stdio: 'inherit'
    });
  });

  after(() => {
    Object.assign(process.env, oldEnv);
  });

  /**
   * Doc api tests are run against three different setup:
   *  - a merged server: a single server serving both as a home and doc worker
   *  - two separated servers: requests are sent to a home server which then forward them to a doc worker
   *  - a doc worker: request are sent directly to the doc worker (note that even though it is not
   *    used for testing we starts anyway a home server, needed for setting up the test cases)
   *
   *  Future tests must be added within the testDocApi() function.
   */

  describe("should work with a merged server", async () => {
    setup('merged', async () => {
      home = docs = await startServer('home,docs');
      homeUrl = serverUrl = home.serverUrl;
      hasHomeApi = true;
    });
    testDocApi();
  });

  // the way these tests are written, non-merged server requires redis.
  if (process.env.TEST_REDIS_URL) {
    describe("should work with a home server and a docworker", async () => {
      setup('separated', async () => {
        home = await startServer('home');
        docs = await startServer('docs', home.serverUrl);
        homeUrl = serverUrl = home.serverUrl;
        hasHomeApi = true;
      });
      testDocApi();
    });

    describe("should work directly with a docworker", async () => {
      setup('docs', async () => {
        home = await startServer('home');
        docs = await startServer('docs', home.serverUrl);
        homeUrl = home.serverUrl;
        serverUrl = docs.serverUrl;
        hasHomeApi = false;
      });
      testDocApi();
    });
  }

  describe("QueryParameters", async () => {

    function makeExample() {
      return {
        id:    [   1,        2,       3,      7,       8,       9  ],
        color: ['red', 'yellow', 'white', 'blue', 'black', 'purple'],
        spin:  [ 'up',     'up',  'down', 'down',    'up',     'up'],
      };
    }

    it("supports ascending sort", async function() {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['color']}, null), {
        id: [8, 7, 9, 1, 3, 2],
        color: ['black', 'blue', 'purple', 'red', 'white', 'yellow'],
        spin: ['up', 'down', 'up', 'up', 'down', 'up']
      });
    });

    it("supports descending sort", async function() {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-id']}, null), {
        id: [9, 8, 7, 3, 2, 1],
        color: ['purple', 'black', 'blue', 'white', 'yellow', 'red'],
        spin: ['up', 'up', 'down', 'down', 'up', 'up'],
      });
    });

    it("supports multi-key sort", async function() {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-spin', 'color']}, null), {
        id: [8, 9, 1, 2, 7, 3],
        color: ['black', 'purple', 'red', 'yellow', 'blue', 'white'],
        spin: ['up', 'up', 'up', 'up', 'down', 'down'],
      });
    });

    it("does not freak out sorting mixed data", async function() {
      const example = {
        id:    [   1,       2,       3,    4, 5,    6,          7,               8,     9],
        mixed: ['red', 'green', 'white', 2.5, 1, null, ['zing', 3] as any, 5, 'blue']
      };
      assert.deepEqual(applyQueryParameters(example, {sort: ['mixed']}, null), {
        mixed: [1, 2.5, 5, null, ['zing', 3] as any, 'blue', 'green', 'red', 'white'],
        id: [5, 4, 8, 6, 7, 9, 2, 1, 3],
      });
    });

    it("supports limit", async function() {
      assert.deepEqual(applyQueryParameters(makeExample(), {limit: 1}),
                       { id: [1], color: ['red'], spin: ['up'] });
    });

    it("supports sort and limit", async function() {
      assert.deepEqual(applyQueryParameters(makeExample(), {sort: ['-color'], limit: 2}, null),
                       { id: [2, 3], color: ['yellow', 'white'], spin: ['up', 'down'] });
    });
  });
});

// Contains the tests. This is where you want to add more test.
function testDocApi() {

  it("guesses types of new columns", async () => {
    const userActions = [
      ['AddTable', 'GuessTypes', []],
      // Make 5 blank columns of type Any
      ['AddColumn', 'GuessTypes', 'Date', {}],
      ['AddColumn', 'GuessTypes', 'DateTime', {}],
      ['AddColumn', 'GuessTypes', 'Bool', {}],
      ['AddColumn', 'GuessTypes', 'Numeric', {}],
      ['AddColumn', 'GuessTypes', 'Text', {}],
      // Add string values from which the initial type will be guessed
      ['AddRecord', 'GuessTypes', null, {
        Date: "1970-01-02",
        DateTime: "1970-01-02 12:00",
        Bool: "true",
        Numeric: "1.2",
        Text: "hello",
      }],
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);

    // Check that the strings were parsed to typed values
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/GuessTypes/records`, chimpy)).data,
      {
        records: [
          {
            id: 1,
            fields: {
              Date: 24 * 60 * 60,
              DateTime: 36 * 60 * 60,
              Bool: true,
              Numeric: 1.2,
              Text: "hello",
            },
          },
        ],
      },
    );

    // Check the column types
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/GuessTypes/columns`, chimpy))
        .data.columns.map((col: any) => col.fields.type),
      ["Date", "DateTime:UTC", "Bool", "Numeric", "Text"],
    );
  });

  for (const mode of ['logged in', 'anonymous']) {
    for (const content of ['with content', 'without content']) {
      it(`POST /api/docs ${content} creates an unsaved doc when ${mode}`, async function() {
        const user = (mode === 'logged in') ? chimpy : nobody;
        const formData = new FormData();
        formData.append('upload', 'A,B\n1,2\n3,4\n', 'table1.csv');
        const config = defaultsDeep({headers: formData.getHeaders()}, user);
        let resp = await axios.post(`${serverUrl}/api/docs`,
          ...(content === 'with content' ? [formData, config] : [null, user]));
        assert.equal(resp.status, 200);
        const urlId = resp.data;
        if (mode === 'logged in') {
          assert.match(urlId, /^new~[^~]*~[0-9]+$/);
        } else {
          assert.match(urlId, /^new~[^~]*$/);
        }

        // Access information about that document should be sane for current user
        resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, user);
        assert.equal(resp.status, 200);
        assert.equal(resp.data.name, 'Untitled');
        assert.equal(resp.data.workspace.name, 'Examples & Templates');
        assert.equal(resp.data.access, 'owners');
        if (mode === 'anonymous') {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, chimpy);
          assert.equal(resp.data.access, 'owners');
        } else {
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, charon);
          assert.equal(resp.status, 403);
          resp = await axios.get(`${homeUrl}/api/docs/${urlId}`, nobody);
          assert.equal(resp.status, 403);
        }

        // content was successfully stored
        resp = await axios.get(`${serverUrl}/api/docs/${urlId}/tables/Table1/data`, user);
        if (content === 'with content') {
          assert.deepEqual(resp.data, { id: [ 1, 2 ], manualSort: [ 1, 2 ], A: [ 1, 3 ], B: [ 2, 4 ] });
        } else {
          assert.deepEqual(resp.data, { id: [], manualSort: [], A: [], B: [], C: [] });
        }
      });
    }
  }

  it("GET /docs/{did}/tables/{tid}/data retrieves data in column format", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['hello', '', '', ''],
      B: ['', 'world', '', ''],
      C: ['', '', '', ''],
      D: [null, null, null, null],
      E: ['HELLO', '', '', ''],
      manualSort: [1, 2, 3, 4]
    });
  });

  it("GET /docs/{did}/tables/{tid}/records retrieves data in records format", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        records:
          [
            {
              id: 1,
              fields: {
                A: 'hello',
                B: '',
                C: '',
                D: null,
                E: 'HELLO',
              },
            },
            {
              id: 2,
              fields: {
                A: '',
                B: 'world',
                C: '',
                D: null,
                E: '',
              },
            },
            {
              id: 3,
              fields: {
                A: '',
                B: '',
                C: '',
                D: null,
                E: '',
              },
            },
            {
              id: 4,
              fields: {
                A: '',
                B: '',
                C: '',
                D: null,
                E: '',
              },
            },
          ]
      });
  });

  it("GET /docs/{did}/tables/{tid}/records handles errors and hidden columns", async function () {
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        "records": [
          {
            "id": 1,
            "fields": {
              "A": null,
              "B": "Hi",
              "C": 1,
            },
            "errors": {
              "A": "ZeroDivisionError"
            }
          }
        ]
      }
    );

    // /data format for comparison: includes manualSort, gristHelper_Display, and ["E", "ZeroDivisionError"]
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.ApiDataRecordsTest}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        "id": [
          1
        ],
        "manualSort": [
          1
        ],
        "A": [
          [
            "E",
            "ZeroDivisionError"
          ]
        ],
        "B": [
          "Hi"
        ],
        "C": [
          1
        ],
        "gristHelper_Display": [
          "Hi"
        ]
      }
    );
  });

  it("GET /docs/{did}/tables/{tid}/columns retrieves columns", async function () {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/columns`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        columns: [
          {
            id: 'A',
            fields: {
              colRef: 2,
              parentId: 1,
              parentPos: 1,
              type: 'Text',
              widgetOptions: '',
              isFormula: false,
              formula: '',
              label: 'A',
              untieColIdFromLabel: false,
              summarySourceCol: 0,
              displayCol: 0,
              visibleCol: 0,
              rules: null,
              recalcWhen: 0,
              recalcDeps: null
            }
          },
          {
            id: 'B',
            fields: {
              colRef: 3,
              parentId: 1,
              parentPos: 2,
              type: 'Text',
              widgetOptions: '',
              isFormula: false,
              formula: '',
              label: 'B',
              untieColIdFromLabel: false,
              summarySourceCol: 0,
              displayCol: 0,
              visibleCol: 0,
              rules: null,
              recalcWhen: 0,
              recalcDeps: null
            }
          },
          {
            id: 'C',
            fields: {
              colRef: 4,
              parentId: 1,
              parentPos: 3,
              type: 'Text',
              widgetOptions: '',
              isFormula: false,
              formula: '',
              label: 'C',
              untieColIdFromLabel: false,
              summarySourceCol: 0,
              displayCol: 0,
              visibleCol: 0,
              rules: null,
              recalcWhen: 0,
              recalcDeps: null
            }
          },
          {
            id: 'D',
            fields: {
              colRef: 5,
              parentId: 1,
              parentPos: 3,
              type: 'Any',
              widgetOptions: '',
              isFormula: true,
              formula: '',
              label: 'D',
              untieColIdFromLabel: false,
              summarySourceCol: 0,
              displayCol: 0,
              visibleCol: 0,
              rules: null,
              recalcWhen: 0,
              recalcDeps: null
            }
          },
          {
            id: 'E',
            fields: {
              colRef: 6,
              parentId: 1,
              parentPos: 4,
              type: 'Any',
              widgetOptions: '',
              isFormula: true,
              formula: '$A.upper()',
              label: 'E',
              untieColIdFromLabel: false,
              summarySourceCol: 0,
              displayCol: 0,
              visibleCol: 0,
              rules: null,
              recalcWhen: 0,
              recalcDeps: null
            }
          }
        ]
      }
    );
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent doc", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data returns 404 for non-existent table", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent doc", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/typotypotypo/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /document not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/columns returns 404 for non-existent table", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Typo1/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /table not found/i);
  });

  it("GET /docs/{did}/tables/{tid}/data supports filters", async function() {
    function makeQuery(filters: {[colId: string]: any[]}) {
      const query = "filter=" + encodeURIComponent(JSON.stringify(filters));
      return axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data?${query}`, chimpy);
    }
    function checkResults(resp: AxiosResponse<any>, expectedData: any) {
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, expectedData);
    }

    checkResults(await makeQuery({B: ['world']}), {
      id: [2], A: [''], B: ['world'], C: [''], D: [null], E: [''], manualSort: [2],
    });

    // Can query by id
    checkResults(await makeQuery({id: [1]}), {
      id: [1], A: ['hello'], B: [''], C: [''], D: [null], E: ['HELLO'], manualSort: [1],
    });

    checkResults(await makeQuery({B: [''], A: ['']}), {
      id: [3, 4], A: ['', ''], B: ['', ''], C: ['', ''], D: [null, null], E: ['', ''], manualSort: [3, 4],
    });

    // Empty filter is equivalent to no filter and should return full data.
    checkResults(await makeQuery({}), {
      id: [1, 2, 3, 4],
      A: ['hello', '', '', ''],
      B: ['', 'world', '', ''],
      C: ['', '', '', ''],
      D: [null, null, null, null],
      E: ['HELLO', '', '', ''],
      manualSort: [1, 2, 3, 4]
    });

    // An impossible filter should succeed but return an empty set of rows.
    checkResults(await makeQuery({B: ['world'], C: ['Neptune']}), {
      id: [], A: [], B: [], C: [], D: [], E: [], manualSort: [],
    });

    // An invalid filter should return an error
    {
      const resp = await makeQuery({BadCol: ['']});
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /BadCol/);
    }

    {
      const resp = await makeQuery({B: 'world'} as any);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /filter values must be arrays/);
    }
  });

  for (const mode of ['url', 'header']) {
    it(`GET /docs/{did}/tables/{tid}/data supports sorts and limits in ${mode}`, async function() {
      function makeQuery(sort: string[]|null, limit: number|null) {
        const url = new URL(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`);
        const config = configForUser('chimpy');
        if (mode === 'url') {
          if (sort) { url.searchParams.append('sort', sort.join(',')); }
          if (limit) { url.searchParams.append('limit', String(limit)); }
        } else {
          if (sort)  { config.headers['x-sort'] = sort.join(','); }
          if (limit) { config.headers['x-limit'] = String(limit); }
        }
        return axios.get(url.href, config);
      }
      function checkResults(resp: AxiosResponse<any>, expectedData: any) {
        assert.equal(resp.status, 200);
        assert.deepEqual(resp.data, expectedData);
      }

      checkResults(await makeQuery(['-id'], null), {
        id: [4, 3, 2, 1],
        A: ['', '', '', 'hello'],
        B: ['', '', 'world', ''],
        C: ['', '', '', ''],
        D: [null, null, null, null],
        E: ['', '', '', 'HELLO'],
        manualSort: [4, 3, 2, 1]
      });

      checkResults(await makeQuery(['-id'], 2), {
        id: [4, 3],
        A: ['', ''],
        B: ['', ''],
        C: ['', ''],
        D: [null, null],
        E: ['', ''],
        manualSort: [4, 3]
      });
    });
  }

  it("GET /docs/{did}/tables/{tid}/data respects document permissions", async function() {
    // as not part of any group kiwi cannot fetch Timesheets
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, kiwi);
    assert.equal(resp.status, 403);
  });

  it("GET /docs/{did}/tables/{tid}/data returns matches /not found/ for bad table id", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);
  });

  it("POST /docs/{did}/apply applies user actions", async function() {
    const userActions = [
      ['AddTable', 'Foo', [{id: 'A'}, {id: 'B'}]],
      ['BulkAddRecord', 'Foo', [1, 2], {A: ["Santa", "Bob"], B: [1, 11]}]
    ];
    const resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(
      (await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data,
      {id: [1, 2], A: ['Santa', 'Bob'], B: ['1', '11'], manualSort: [1, 2]});
  });

  it("POST /docs/{did}/apply respects document permissions", async function() {
    const userActions = [
      ['AddTable', 'FooBar', [{id: 'A'}]]
    ];
    let resp: AxiosResponse;

    // as a guest chimpy cannot edit Bananas
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Bananas}/apply`, userActions, chimpy);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No write access'});

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Bananas}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);

    // as not in any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/apply`, userActions, kiwi);
    assert.equal(resp.status, 403);

    // check that changes did not apply
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/FooBar/data`, chimpy);
    assert.equal(resp.status, 404);
    assert.match(resp.data.error, /not found/);

  });

  it("POST /docs/{did}/tables/{tid}/data adds records", async function() {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, [3, 4]);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  it("POST /docs/{did}/tables/{tid}/records adds records", async function() {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
      records: [
        {fields: {A: 'John', B: 55}},
        {fields: {A: 'Jane', B: 0}},
      ]
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, {
      records: [
        {id: 5},
        {id: 6},
      ]
    });
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      {
        records:
          [
            {
              id: 1,
              fields: {
                A: 'Santa',
                B: '1',
              },
            },
            {
              id: 2,
              fields: {
                A: 'Bob',
                B: '11',
              },
            },
            {
              id: 3,
              fields: {
                A: 'Alice',
                B: '2',
              },
            },
            {
              id: 4,
              fields: {
                A: 'Felix',
                B: '22',
              },
            },
            {
              id: 5,
              fields: {
                A: 'John',
                B: '55',
              },
            },
            {
              id: 6,
              fields: {
                A: 'Jane',
                B: '0',
              },
            },
          ]
      });
  });

  it("POST /docs/{did}/tables/{tid}/data/delete deletes records", async function() {
    let resp = await axios.post(
      `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data/delete`,
      [3, 4, 5, 6],
      chimpy,
    );
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data, null);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2],
      A: ['Santa', 'Bob'],
      B: ["1", "11"],
      manualSort: [1, 2]
    });

    // restore rows
    await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    }, chimpy);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  function checkError(status: number, test: RegExp|object, resp: AxiosResponse<any>, message?: string) {
    assert.equal(resp.status, status);
    if (test instanceof RegExp) {
      assert.match(resp.data.error, test, message);
    } else {
      try {
      assert.deepEqual(resp.data, test, message);
      } catch(err) {
        console.log(JSON.stringify(resp.data));
        console.log(JSON.stringify(test));
        throw err;
      }
    }
  }

  it("parses strings in user actions", async () => {
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
    const docUrl = `${serverUrl}/api/docs/${docId}`;
    const recordsUrl = `${docUrl}/tables/Table1/records`;

    // Make the column numeric, delete the other columns we don't care about
    await axios.post(`${docUrl}/apply`, [
      ['ModifyColumn', 'Table1', 'A', {type: 'Numeric'}],
      ['RemoveColumn', 'Table1', 'B'],
      ['RemoveColumn', 'Table1', 'C'],
    ], chimpy);

    // Add/update some records without and with string parsing
    // Specifically test:
    // 1. /apply, with an AddRecord
    // 2. POST  /records (BulkAddRecord)
    // 3. PATCH /records (BulkUpdateRecord)
    // Send strings that look like currency which need string parsing to become numbers
    for (const queryParams of ['?noparse=1', '']) {
      await axios.post(`${docUrl}/apply${queryParams}`, [
        ['AddRecord', 'Table1', null, {'A': '$1'}],
      ], chimpy);

      const response = await axios.post(`${recordsUrl}${queryParams}`,
        {
          records: [
            {fields: {'A': '$2'}},
            {fields: {'A': '$3'}},
          ]
        },
        chimpy);

      // Update $3 -> $4
      const rowId = response.data.records[1].id;
      await axios.patch(`${recordsUrl}${queryParams}`,
        {
          records: [
            {id: rowId, fields: {'A': '$4'}}
          ]
        },
        chimpy);
    }

    // Check the results
    const resp = await axios.get(recordsUrl, chimpy);
    assert.deepEqual(resp.data, {
        records:
          [
            // Without string parsing
            {id: 1, fields: {A: '$1'}},
            {id: 2, fields: {A: '$2'}},
            {id: 3, fields: {A: '$4'}},

            // With string parsing
            {id: 4, fields: {A: 1}},
            {id: 5, fields: {A: 2}},
            {id: 6, fields: {A: 4}},
          ]
      }
    );
  });

  describe("PUT /docs/{did}/tables/{tid}/records", async function() {
    it("should add or update records", async function() {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({name: 'BlankTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;

      async function check(records: AddOrUpdateRecord[], expectedTableData: BulkColValues, params: any={}) {
        const resp = await axios.put(url, {records}, {...chimpy, params});
        assert.equal(resp.status, 200);
        const table = await userApi.getTable(docId, "Table1");
        delete table.manualSort;
        delete table.C;
        assert.deepStrictEqual(table, expectedTableData);
      }

      // Add 3 new records, since the table is empty so nothing matches `requires`
      await check(
         [
            {
              require: {A: 1},
            },
            {
              // Since no record with A=2 is found, create a new record,
              // but `fields` overrides `require` for the value when creating,
              // so the new record has A=3
              require: {A: 2},
              fields: {A: 3},
            },
            {
              require: {A: 4},
              fields: {B: 5},
            },
          ],
        {id: [1, 2, 3], A: [1, 3, 4], B: [0, 0, 5]}
      );

      // Update all three records since they all match the `require` values here
      await check(
        [
            {
              // Does nothing
              require: {A: 1},
            },
            {
              // Changes A from 3 to 33
              require: {A: 3},
              fields: {A: 33},
            },
            {
              // Changes B from 5 to 6 in the third record where A=4
              require: {A: 4},
              fields: {B: 6},
            },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]}
      );

      // This would normally add a record, but noadd suppresses that
      await check([
          {
            require: {A: 100},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]},
        {noadd: "1"},
      );

      // This would normally update A from 1 to 11, bot noupdate suppresses that
      await check([
          {
            require: {A: 1},
            fields: {A: 11},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [0, 0, 6]},
        {noupdate: "1"},
      );

      // There are 2 records with B=0, update them both to B=1
      // Use onmany=all to specify that they should both be updated
      await check([
          {
            require: {B: 0},
            fields: {B: 1},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [1, 1, 6]},
        {onmany: "all"}
      );

      // In contrast to the above, the default behaviour for no value of onmany
      // is to only update the first matching record,
      // so only one of the records with B=1 is updated to B=2
      await check([
          {
            require: {B: 1},
            fields: {B: 2},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 4], B: [2, 1, 6]},
      );

      // By default, strings in `require` and `fields` are parsed based on column type,
      // so these dollar amounts are treated as currency
      // and parsed as A=4 and A=44
      await check([
          {
            require: {A: "$4"},
            fields: {A: "$44"},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, 44], B: [2, 1, 6]},
      );

      // Turn off the default string parsing with noparse=1
      // Now we need A=44 to actually be a number to match,
      // A="$44" wouldn't match and would create a new record.
      // Because A="$55" isn't parsed, the raw string is stored in the table.
      await check([
          {
            require: {A: 44},
            fields: {A: "$55"},
          },
        ],
        {id: [1, 2, 3], A: [1, 33, "$55"], B: [2, 1, 6]},
        {noparse: 1}
      );

      await check([
          // First three records already exist and nothing happens
          {require: {A: 1}},
          {require: {A: 33}},
          {require: {A: "$55"}},
          // Without string parsing, A="$33" doesn't match A=33 and a new record is created
          {require: {A: "$33"}},
        ],
        {id: [1, 2, 3, 4], A: [1, 33, "$55", "$33"], B: [2, 1, 6, 0]},
        {noparse: 1}
      );

      // Checking that updating by `id` works.
      await check([
          {
            require: {id: 3},
            fields: {A: "66"},
          },
        ],
        {id: [1, 2, 3, 4], A: [1, 33, 66, "$33"], B: [2, 1, 6, 0]},
      );

      // allow_empty_require option with empty `require` updates all records
      await check([
          {
            require: {},
            fields: {A: 99, B: 99},
          },
        ],
        {id: [1, 2, 3, 4], A: [99, 99, 99, 99], B: [99, 99, 99, 99]},
        {allow_empty_require: "1", onmany: "all"},
      );
    });

    it("should 404 for missing tables", async () => {
      checkError(404, /Table not found "Bad_Foo_"/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/records`,
          {records: [{require: {id: 1}}]}, chimpy));
    });

    it("should 400 for missing columns", async () => {
      checkError(400, /Invalid column "no_such_column"/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {no_such_column: 1}}]}, chimpy));
    });

    it("should 400 for an incorrect onmany parameter", async function() {
      checkError(400,
        /onmany parameter foo should be one of first,none,all/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {id: 1}}]}, {...chimpy, params: {onmany: "foo"}}));
    });

    it("should 400 for an empty require without allow_empty_require", async function() {
      checkError(400,
        /require is empty but allow_empty_require isn't set/,
        await axios.put(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`,
          {records: [{require: {}}]}, chimpy));
    });

    it("should validate request schema", async function() {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async (payload: any, error: { error: string, details: string }) => {
        const resp = await axios.put(url, payload, chimpy);
        checkError(400, error, resp);
      };
      await test({}, {error: 'Invalid payload', details: 'Error: body.records is missing'});
      await test({records: 1}, {error: 'Invalid payload', details: 'Error: body.records is not an array'});
      await test({records: [{fields: {}}]},
        {
          error: 'Invalid payload',
          details: 'Error: ' +
            'body.records[0] is not a AddOrUpdateRecord; ' +
            'body.records[0].require is missing',
        });
      await test({records: [{require: {id: "1"}}]},
        {
          error: 'Invalid payload',
          details: 'Error: ' +
            'body.records[0] is not a AddOrUpdateRecord; ' +
            'body.records[0].require.id is not a number',
        });
    });
  });

  describe("POST /docs/{did}/tables/{tid}/records", async function() {
    it("POST should have good errors", async () => {
      checkError(404, /not found/,
                await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Bad_Foo_/data`,
                { A: ['Alice', 'Felix'], B: [2, 22] }, chimpy));

      checkError(400, /Invalid column "Bad"/,
                await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`,
                { A: ['Alice'], Bad: ['Monthy'] }, chimpy));

      // Other errors should also be maximally informative.
      checkError(400, /Error manipulating data/,
                await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`,
                { A: ['Alice'], B: null }, chimpy));
    });

    it("validates request schema", async function() {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      const test = async(payload: any, error: {error: string, details: string}) => {
        const resp = await axios.post(url, payload, chimpy);
        checkError(400, error, resp);
      };
      await test({}, {error: 'Invalid payload', details: 'Error: body.records is missing'});
      await test({records: 1}, {error: 'Invalid payload', details: 'Error: body.records is not an array'});
      // All column types are allowed, except Arrays (or objects) without correct code.
      const testField = async (A: any) => {
        await test({records: [{ id: 1, fields: { A } }]}, {error: 'Invalid payload', details:
                    'Error: body.records[0] is not a NewRecord; '+
                    'body.records[0].fields.A is not a CellValue; '+
                    'body.records[0].fields.A is none of number, '+
                    'string, boolean, null, 1 more; body.records[0].'+
                    'fields.A[0] is not a GristObjCode; body.records[0]'+
                    '.fields.A[0] is not a valid enum value'});
      };
      // test no code at all
      await testField([]);
      // test invalid code
      await testField(['ZZ']);
    });

    it("allows to create a blank record", async function() {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({ name : 'BlankTest'}, wid);
      // Create two blank records
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const resp = await axios.post(url, {records: [{}, { fields: {}}]}, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, { records : [{id: 1}, {id: 2}]});
    });

    it("allows to create partial records", async function() {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({ name : 'BlankTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create partial records
      const resp = await axios.post(url, {records: [{fields: { A: 1}}, { fields: {B: 2}}, {}]}, chimpy);
      assert.equal(resp.status, 200);
      const table = await userApi.getTable(docId, "Table1");
      delete table.manualSort;
      assert.deepStrictEqual(
        table,
        { id: [1, 2, 3], A: [1, null, null], B: [null, 2, null], C:[null, null, null]});
    });

    it("allows CellValue as a field", async function() {
      // create sample document
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({ name : 'PostTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const testField = async(A?: CellValue, message?: string) =>{
        const resp = await axios.post(url, {records: [{ fields: { A } }]}, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      // test allowed types for a field
      await testField(1); // ints
      await testField(1.2); // floats
      await testField("string"); // strings
      await testField(true); // true and false
      await testField(false);
      await testField(null); // null
      // encoded values (though not all make sense)
      for (const code of [
          GristObjCode.List,
          GristObjCode.Dict,
          GristObjCode.DateTime,
          GristObjCode.Date,
          GristObjCode.Skip,
          GristObjCode.Censored,
          GristObjCode.Reference,
          GristObjCode.ReferenceList,
          GristObjCode.Exception,
          GristObjCode.Pending,
          GristObjCode.Unmarshallable,
          GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  it("POST /docs/{did}/tables/{tid}/data respects document permissions", async function() {
    let resp: AxiosResponse;
    const data = {
      A: ['Alice', 'Felix'],
      B: [2, 22]
    };

    // as a viewer charon cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, charon);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No write access'});

    // as not part of any group kiwi cannot edit TestDoc
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No view access'});

    // check that TestDoc did not change
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
    assert.deepEqual(resp.data, {
      id: [1, 2, 3, 4],
      A: ['Santa', 'Bob', 'Alice', 'Felix'],
      B: ["1", "11", "2", "22"],
      manualSort: [1, 2, 3, 4]
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/records", function() {
    it("updates records", async function () {
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, {
        records: [
          {
            id: 1,
            fields: {
              A: 'Father Christmas',
            },
          },
        ],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        records:
          [
            {
              id: 1,
              fields: {
                A: 'Father Christmas',
                B: '1',
              },
            },
            {
              id: 2,
              fields: {
                A: 'Bob',
                B: '11',
              },
            },
            {
              id: 3,
              fields: {
                A: 'Alice',
                B: '2',
              },
            },
            {
              id: 4,
              fields: {
                A: 'Felix',
                B: '22',
              },
            },
          ]
      });
    });

    it("validates request schema", async function() {
      const url = `${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/records`;
      async function failsWithError(payload: any, error: { error: string, details?: string }){
        const resp = await axios.patch(url, payload, chimpy);
        checkError(400, error, resp);
      }

      await failsWithError({}, {error: 'Invalid payload', details: 'Error: body.records is missing'});

      await failsWithError({records: 1}, {error: 'Invalid payload', details: 'Error: body.records is not an array'});

      await failsWithError({records: []}, {error: 'Invalid payload', details:
                  'Error: body.records[0] is not a Record; body.records[0] is not an object'});

      await failsWithError({records: [{}]}, {error: 'Invalid payload', details:
                  'Error: body.records[0] is not a Record\n    '+
                  'body.records[0].id is missing\n    '+
                  'body.records[0].fields is missing'});

      await failsWithError({records: [{id: "1"}]}, {error: 'Invalid payload', details:
                  'Error: body.records[0] is not a Record\n' +
                  '    body.records[0].id is not a number\n' +
                  '    body.records[0].fields is missing'});

      await failsWithError(
        {records: [{id: 1, fields: {A : 1}}, {id: 2, fields: {B: 3}}]},
        {error: 'PATCH requires all records to have same fields'});

      // Test invalid object codes
      const fieldIsNotValid = async (A: any) => {
        await failsWithError({records: [{ id: 1, fields: { A } }]}, {error: 'Invalid payload', details:
                    'Error: body.records[0] is not a Record; '+
                    'body.records[0].fields.A is not a CellValue; '+
                    'body.records[0].fields.A is none of number, '+
                    'string, boolean, null, 1 more; body.records[0].'+
                    'fields.A[0] is not a GristObjCode; body.records[0]'+
                    '.fields.A[0] is not a valid enum value'});
      };
      await fieldIsNotValid([]);
      await fieldIsNotValid(['ZZ']);
    });

    it("allows CellValue as a field", async function() {
      // create sample document for testing
      const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
      const docId = await userApi.newDoc({ name : 'PatchTest'}, wid);
      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      // create record for patching
      const id = (await axios.post(url, { records: [{}] }, chimpy)).data.records[0].id;
      const testField = async(A?: CellValue, message?: string) =>{
        const resp = await axios.patch(url, {records: [{ id, fields: { A } }]}, chimpy);
        assert.equal(resp.status, 200, message ?? `Error for code ${A}`);
      };
      await testField(1);
      await testField(1.2);
      await testField("string");
      await testField(true);
      await testField(false);
      await testField(null);
      for (const code of [
          GristObjCode.List,
          GristObjCode.Dict,
          GristObjCode.DateTime,
          GristObjCode.Date,
          GristObjCode.Skip,
          GristObjCode.Censored,
          GristObjCode.Reference,
          GristObjCode.ReferenceList,
          GristObjCode.Exception,
          GristObjCode.Pending,
          GristObjCode.Unmarshallable,
          GristObjCode.Versions,
      ]) {
        await testField([code]);
      }
    });
  });

  describe("PATCH /docs/{did}/tables/{tid}/data", function() {

    it("updates records", async function() {
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ['Santa Klaus'],
      }, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy);
      // check that rest of the data is left unchanged
      assert.deepEqual(resp.data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });

    });

    it("throws 400 for invalid row ids", async function() {

      // combination of valid and invalid ids fails
      let resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1, 5],
        A: ['Alice', 'Felix']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 5/);

      // only invalid ids also fails
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [10, 5],
        A: ['Alice', 'Felix']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid row id 10/);

      // check that changes related to id 1 did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });
    });

    it("throws 400 for invalid column", async function() {
      const resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, {
        id: [1],
        A: ['Alice'],
        C: ['Monthy']
      }, chimpy);
      assert.equal(resp.status, 400);
      assert.match(resp.data.error, /Invalid column "C"/);
    });

    it("respects document permissions", async function() {
      let resp: AxiosResponse;
      const data = {
        id: [1],
        A: ['Santa'],
      };

      // check data
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });

      // as a viewer charon cannot patch TestDoc
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, charon);
      assert.equal(resp.status, 403);
      assert.deepEqual(resp.data, {error: 'No write access'});

      // as not part of any group kiwi cannot patch TestDoc
      resp = await axios.patch(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, data, kiwi);
      assert.equal(resp.status, 403);
      assert.deepEqual(resp.data, {error: 'No view access'});

      // check that changes did not apply
      assert.deepEqual((await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/tables/Foo/data`, chimpy)).data, {
        id: [1, 2, 3, 4],
        A: ['Santa Klaus', 'Bob', 'Alice', 'Felix'],
        B: ["1", "11", "2", "22"],
        manualSort: [1, 2, 3, 4]
      });
    });

  });

  describe('attachments', function() {
    it("POST /docs/{did}/attachments adds attachments", async function() {
      let formData = new FormData();
      formData.append('upload', 'foobar', "hello.doc");
      formData.append('upload', '123456', "world.jpg");
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [1, 2]);

      // Another upload gets the next number.
      formData = new FormData();
      formData.append('upload', 'abcdef', "hello.png");
      resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [3]);
    });

    it("GET /docs/{did}/attachments/{id} returns attachment metadata", async function() {
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2`, chimpy);
      assert.equal(resp.status, 200);
      assert.include(resp.data, {fileName: "world.jpg", fileSize: 6});
      assert.match(resp.data.timeUploaded, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("GET /docs/{did}/attachments/{id}/download downloads attachment contents", async function() {
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        {...chimpy, responseType: 'arraybuffer'});
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/jpeg');
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.data, Buffer.from('123456'));
    });

    it("GET /docs/{did}/attachments/{id}/download works after doc shutdown", async function() {
      // Check that we can download when ActiveDoc isn't currently open.
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/force-reload`, null, chimpy);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/2/download`,
        {...chimpy, responseType: 'arraybuffer'});
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/jpeg');
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.jpg"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.data, Buffer.from('123456'));
    });

    it("GET /docs/{did}/attachments/{id}... returns 404 when attachment not found", async function() {
      let resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/22`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/moo`, chimpy);
      checkError(404, /Attachment not found: moo/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/22/download`, chimpy);
      checkError(404, /Attachment not found: 22/, resp);
      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/moo/download`, chimpy);
      checkError(404, /Attachment not found: moo/, resp);
    });

    it("POST /docs/{did}/attachments produces reasonable errors", async function() {
      // Check that it produces reasonable errors if we try to use it with non-form-data
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, [4, 5, 6], chimpy);
      assert.equal(resp.status, 415);     // Wrong content-type

      // Check for an error if there is no data included.
      const formData = new FormData();
      resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 400);
      // TODO The error here is "stream ended unexpectedly", which isn't really reasonable.
    });

    it("POST/GET /docs/{did}/attachments respect document permissions", async function() {
      const formData = new FormData();
      formData.append('upload', 'xyzzz', "wrong.png");
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, kiwi));
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/3`, kiwi);
      checkError(403, /No view access/, resp);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/3/download`, kiwi);
      checkError(403, /No view access/, resp);
    });

    it("POST /docs/{did}/attachments respects untrusted content-type only if valid", async function() {
      const formData = new FormData();
      formData.append('upload', 'xyz', {filename: "foo", contentType: "application/pdf"});
      formData.append('upload', 'abc', {filename: "hello.png", contentType: "invalid/content-type"});
      formData.append('upload', 'def', {filename: "world.doc", contentType: "text/plain\nbad-header: 1\n\nEvil"});
      let resp = await axios.post(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments`, formData,
        defaultsDeep({headers: formData.getHeaders()}, chimpy));
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, [4, 5, 6]);

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/4/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'application/pdf');    // A valid content-type is respected
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="foo.pdf"');
      assert.deepEqual(resp.data, 'xyz');

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/5/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'image/png');    // Did not pay attention to invalid header
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="hello.png"');
      assert.deepEqual(resp.data, 'abc');

      resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/attachments/6/download`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.headers['content-type'], 'application/msword');    // Another invalid header ignored
      assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="world.doc"');
      assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
      assert.deepEqual(resp.headers['bad-header'], undefined);   // Attempt to hack in more headers didn't work
      assert.deepEqual(resp.data, 'def');
    });
  });

  it("GET /docs/{did}/download serves document", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, chimpy);
    assert.equal(resp.status, 200);
    assert.match(resp.data, /grist_Tables_column/);
  });

  it("GET /docs/{did}/download respects permissions", async function() {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download`, kiwi);
    assert.equal(resp.status, 403);
    assert.notMatch(resp.data, /grist_Tables_column/);
  });

  it("GET /docs/{did}/download/csv serves CSV-encoded document", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/download/csv?tableId=Table1`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n');

    const resp2 = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Foo`, chimpy);
    assert.equal(resp2.status, 200);
    assert.equal(resp2.data, 'A,B\nSanta,1\nBob,11\nAlice,2\nFelix,22\n');
  });

  it("GET /docs/{did}/download/csv respects permissions", async function() {
    // kiwi has no access to TestDoc
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1`, kiwi);
    assert.equal(resp.status, 403);
    assert.notEqual(resp.data, 'A,B,C,D,E\nhello,,,,HELLO\n,world,,,\n,,,,\n,,,,\n');
  });

  it("GET /docs/{did}/download/csv returns 404 if tableId is invalid", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=MissingTableId`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'Table MissingTableId not found.' });
  });

  it("GET /docs/{did}/download/csv returns 404 if viewSectionId is invalid", async function() {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv?tableId=Table1&viewSection=9999`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: 'No record 9999 in table _grist_Views_section' });
  });

  it("GET /docs/{did}/download/csv returns 400 if tableId is missing", async function() {
    const resp = await axios.get(
      `${serverUrl}/api/docs/${docIds.TestDoc}/download/csv`, chimpy);
    assert.equal(resp.status, 400);
    assert.deepEqual(resp.data, { error: 'tableId parameter should be a string: undefined' });
  });

  it('POST /workspaces/{wid}/import handles empty filenames', async function() {
    if (!process.env.TEST_REDIS_URL) { this.skip(); }
    const worker1 = await userApi.getWorkerAPI('import');
    const wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    const fakeData1 = await testUtils.readFixtureDoc('Hello.grist');
    const uploadId1 = await worker1.upload(fakeData1, '.grist');
    const resp = await axios.post(`${worker1.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
                                configForUser('Chimpy'));
    assert.equal(resp.status, 200);
    assert.equal(resp.data.title, 'Untitled upload');
    assert.equal(typeof resp.data.id, 'string');
    assert.notEqual(resp.data.id, '');
  });

  it("document is protected during upload-and-import sequence", async function() {
    if (!process.env.TEST_REDIS_URL) { this.skip(); }
    // Prepare an API for a different user.
    const kiwiApi = new UserAPIImpl(`${home.serverUrl}/o/Fish`, {
      headers: {Authorization: 'Bearer api_key_for_kiwi'},
      fetch : fetch as any,
      newFormData: () => new FormData() as any,
      logger: log
    });
    // upload something for Chimpy and something else for Kiwi.
    const worker1 = await userApi.getWorkerAPI('import');
    const fakeData1 = await testUtils.readFixtureDoc('Hello.grist');
    const uploadId1 = await worker1.upload(fakeData1, 'upload.grist');
    const worker2 = await kiwiApi.getWorkerAPI('import');
    const fakeData2 = await testUtils.readFixtureDoc('Favorite_Films.grist');
    const uploadId2 = await worker2.upload(fakeData2, 'upload2.grist');

    // Check that kiwi only has access to their own upload.
    let wid = (await kiwiApi.getOrgWorkspaces('current')).find((w) => w.name === 'Big')!.id;
    let resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
                                configForUser('Kiwi'));
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: "access denied"});

    resp = await axios.post(`${worker2.url}/api/workspaces/${wid}/import`, {uploadId: uploadId2},
                            configForUser('Kiwi'));
    assert.equal(resp.status, 200);

    // Check that chimpy has access to their own upload.
    wid = (await userApi.getOrgWorkspaces('current')).find((w) => w.name === 'Private')!.id;
    resp = await axios.post(`${worker1.url}/api/workspaces/${wid}/import`, {uploadId: uploadId1},
                            configForUser('Chimpy'));
    assert.equal(resp.status, 200);
  });

  it('limits parallel requests', async function() {
    // Launch 30 requests in parallel and see how many are honored and how many
    // return 429s.  The timing of this test is a bit delicate.  We close the doc
    // to increase the odds that results won't start coming back before all the
    // requests have passed authorization.  May need to do something more sophisticated
    // if this proves unreliable.
    await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
    const reqs = [...Array(30).keys()].map(
      i => axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy));
    const responses = await Promise.all(reqs);
    assert.lengthOf(responses.filter(r => r.status === 200), 10);
    assert.lengthOf(responses.filter(r => r.status === 429), 20);
  });

  it('allows forced reloads', async function() {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force a reload.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/force-reload`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force a reload through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/force-reload`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it('allows assignments', async function() {
    let resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, chimpy);
    assert.equal(resp.status, 200);
    // Check that support cannot force an assignment.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/assign`, null, support);
    assert.equal(resp.status, 403);
    if (hasHomeApi) {
      // Check that support can force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, support);
      assert.equal(resp.status, 200);
      // Check that regular user cannot force an assignment through housekeeping api.
      resp = await axios.post(`${serverUrl}/api/housekeeping/docs/${docIds.Timesheets}/assign`, null, chimpy);
      assert.equal(resp.status, 403);
    }
  });

  it('honors urlIds', async function() {
    // Make a document with a urlId
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1', urlId: 'urlid1'}, ws1);
    try {
      // Make sure an edit made by docId is visible when accessed via docId or urlId
      let resp = await axios.post(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      // Make sure an edit made by urlId is visible when accessed via docId or urlId
      resp = await axios.post(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, {
        A: ['Orange'], B: [42]
      }, chimpy);
      resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], 'Orange');
      resp = await axios.get(`${serverUrl}/api/docs/urlid1/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[1], 'Orange');
    } finally {
      await userApi.deleteDoc(doc1);
    }
  });

  it('filters urlIds by org', async function() {
    // Make two documents with same urlId
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1', urlId: 'urlid'}, ws1);
    const nasaApi = new UserAPIImpl(`${home.serverUrl}/o/nasa`, {
      headers: {Authorization: 'Bearer api_key_for_chimpy'},
      fetch : fetch as any,
      newFormData: () => new FormData() as any,
      logger: log
    });
    const ws2 = (await nasaApi.getOrgWorkspaces('current'))[0].id;
    const doc2 = await nasaApi.newDoc({name: 'testdoc2', urlId: 'urlid'}, ws2);
    try {
      // Place a value in "docs" doc
      await axios.post(`${serverUrl}/o/docs/api/docs/urlid/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      // Place a value in "nasa" doc
      await axios.post(`${serverUrl}/o/nasa/api/docs/urlid/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      // Check the values made it to the right places
      let resp = await axios.get(`${serverUrl}/api/docs/${doc1}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Apple');
      resp = await axios.get(`${serverUrl}/api/docs/${doc2}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Orange');
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it('allows docId access to any document from merged org', async function() {
    // Make two documents
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1'}, ws1);
    const nasaApi = new UserAPIImpl(`${home.serverUrl}/o/nasa`, {
      headers: {Authorization: 'Bearer api_key_for_chimpy'},
      fetch : fetch as any,
      newFormData: () => new FormData() as any,
      logger: log
    });
    const ws2 = (await nasaApi.getOrgWorkspaces('current'))[0].id;
    const doc2 = await nasaApi.newDoc({name: 'testdoc2'}, ws2);
    try {
      // Should fail to write to a document in "docs" from "nasa" url
      let resp = await axios.post(`${serverUrl}/o/nasa/api/docs/${doc1}/tables/Table1/data`, {
        A: ['Apple'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 404);
      // Should successfully write to a document in "nasa" from "docs" url
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 200);
      // Should fail to write to a document in "nasa" from "pr" url
      resp = await axios.post(`${serverUrl}/o/pr/api/docs/${doc2}/tables/Table1/data`, {
        A: ['Orange'], B: [99]
      }, chimpy);
      assert.equal(resp.status, 404);
    } finally {
      await userApi.deleteDoc(doc1);
      await nasaApi.deleteDoc(doc2);
    }
  });

  it("GET /docs/{did}/replace replaces one document with another", async function() {
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const doc1 = await userApi.newDoc({name: 'testdoc1'}, ws1);
    const doc2 = await userApi.newDoc({name: 'testdoc2'}, ws1);
    const doc3 = await userApi.newDoc({name: 'testdoc2'}, ws1);
    await userApi.updateDocPermissions(doc2, {users: {'kiwi@getgrist.com': 'editors'}});
    await userApi.updateDocPermissions(doc3, {users: {'kiwi@getgrist.com': 'viewers'}});
    try {
      // Put some material in doc3
      let resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc3}/tables/Table1/data`, {
        A: ['Orange']
      }, chimpy);
      assert.equal(resp.status, 200);

      // Kiwi can replace doc2 with doc3
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 200);
      resp = await axios.get(`${serverUrl}/api/docs/${doc2}/tables/Table1/data`, chimpy);
      assert.equal(resp.data.A[0], 'Orange');

      // Kiwi can't replace doc1 with doc3, no write access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc1}/replace`, {
        sourceDocId: doc3
      }, kiwi);
      assert.equal(resp.status, 403);

      // Kiwi can't replace doc2 with doc1, no read access to doc1
      resp = await axios.post(`${serverUrl}/o/docs/api/docs/${doc2}/replace`, {
        sourceDocId: doc1
      }, kiwi);
      assert.equal(resp.status, 403);
    } finally {
      await userApi.deleteDoc(doc1);
      await userApi.deleteDoc(doc2);
    }
  });

  it("GET /docs/{did}/snapshots retrieves a list of snapshots", async function() {
    const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/snapshots`, chimpy);
    assert.equal(resp.status, 200);
    assert.isAtLeast(resp.data.snapshots.length, 1);
    assert.hasAllKeys(resp.data.snapshots[0], ['docId', 'lastModified', 'snapshotId']);
  });

  it("POST /docs/{did}/states/remove removes old states", async function() {
    // Check doc has plenty of states.
    let resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    const states: DocState[] = resp.data.states;
    assert.isAbove(states.length, 5);

    // Remove all but 3.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, {keep: 3}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 3);
    assert.equal(resp.data.states[0].h, states[0].h);
    assert.equal(resp.data.states[1].h, states[1].h);
    assert.equal(resp.data.states[2].h, states[2].h);

    // Remove all but 1.
    resp = await axios.post(`${serverUrl}/api/docs/${docIds.Timesheets}/states/remove`, {keep: 1}, chimpy);
    assert.equal(resp.status, 200);
    resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/states`, chimpy);
    assert.equal(resp.status, 200);
    assert.lengthOf(resp.data.states, 1);
    assert.equal(resp.data.states[0].h, states[0].h);
  });

  it("GET /docs/{did1}/compare/{did2} tracks changes between docs", async function() {
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId1 = await userApi.newDoc({name: 'testdoc1'}, ws1);
    const docId2 = await userApi.newDoc({name: 'testdoc2'}, ws1);
    const doc1 = userApi.getDocAPI(docId1);
    const doc2 = userApi.getDocAPI(docId2);

    // Stick some content in column A so it has a defined type
    // so diffs are smaller and simpler.
    await doc2.addRows('Table1', {A: [0]});

    let comp = await doc1.compareDoc(docId2);
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary']);
    assert.equal(comp.summary, 'unrelated');
    assert.equal(comp.parent, null);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 1);
    assert.equal(comp.right.n, 2);

    await doc1.replace({sourceDocId: docId2});

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'same');
    assert.equal(comp.left.n, 2);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details, {
      leftChanges: { tableRenames: [], tableDeltas: {} },
      rightChanges: { tableRenames: [], tableDeltas: {} }
    });

    await doc1.addRows('Table1', {A: [1]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'left');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 2);
    assert.deepEqual(comp.right, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.rightChanges,
                     { tableRenames: [], tableDeltas: {} });
    const addA1: ActionSummary = {
      tableRenames: [],
      tableDeltas: { Table1: {
        updateRows: [],
        removeRows: [],
        addRows: [ 2 ],
        columnDeltas: {
          A: { [2]: [null, [1]] },
          manualSort: { [2]: [null, [2]] },
        },
        columnRenames: [],
      } }
    };
    assert.deepEqual(comp.details!.leftChanges, addA1);

    await doc2.addRows('Table1', {A: [1]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'both');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 3);
    assert.equal(comp.parent!.n, 2);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.leftChanges, addA1);
    assert.deepEqual(comp.details!.rightChanges, addA1);

    await doc1.replace({sourceDocId: docId2});

    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'same');
    assert.equal(comp.left.n, 3);
    assert.deepEqual(comp.left, comp.right);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details, {
      leftChanges: { tableRenames: [], tableDeltas: {} },
      rightChanges: { tableRenames: [], tableDeltas: {} }
    });

    await doc2.addRows('Table1', {A: [2]});
    comp = await doc1.compareDoc(docId2);
    assert.equal(comp.summary, 'right');
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.left, comp.parent);
    assert.equal(comp.details, undefined);

    comp = await doc1.compareDoc(docId2, { detail: true });
    assert.deepEqual(comp.details!.leftChanges,
                     { tableRenames: [], tableDeltas: {} });
    const addA2: ActionSummary = {
      tableRenames: [],
      tableDeltas: { Table1: {
        updateRows: [],
        removeRows: [],
        addRows: [ 3 ],
        columnDeltas: {
          A: { [3]: [null, [2]] },
          manualSort: { [3]: [null, [3]] },
        },
        columnRenames: [],
      } }
    };
    assert.deepEqual(comp.details!.rightChanges, addA2);
  });

  it("GET /docs/{did}/compare tracks changes within a doc", async function() {
    // Create a test document.
    const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
    const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
    const doc = userApi.getDocAPI(docId);

    // Give the document some history.
    await doc.addRows('Table1', {A: ['a1'], B: ['b1']});
    await doc.addRows('Table1', {A: ['a2'], B: ['b2']});
    await doc.updateRows('Table1', {id: [1], A: ['A1']});

    // Examine the most recent change, from HEAD~ to HEAD.
    let comp = await doc.compareVersion('HEAD~', 'HEAD');
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary', 'details']);
    assert.equal(comp.summary, 'right');
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 3);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [],
          columnDeltas: {
            A: { [1]: [['a1'], ['A1']] }
          },
          columnRenames: [],
        }
      }
    });

    // Check we get the same result with actual hashes.
    assert.notMatch(comp.left.h, /HEAD/);
    assert.notMatch(comp.right.h, /HEAD/);
    const comp2 = await doc.compareVersion(comp.left.h, comp.right.h);
    assert.deepEqual(comp, comp2);

    // Check that comparing the HEAD with itself shows no changes.
    comp = await doc.compareVersion('HEAD', 'HEAD');
    assert.equal(comp.summary, 'same');
    assert.deepEqual(comp.parent, comp.left);
    assert.deepEqual(comp.parent, comp.right);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, { tableRenames: [], tableDeltas: {} });

    // Examine the combination of the last two changes.
    comp = await doc.compareVersion('HEAD~~', 'HEAD');
    assert.hasAllKeys(comp, ['left', 'right', 'parent', 'summary', 'details']);
    assert.equal(comp.summary, 'right');
    assert.deepEqual(comp.parent, comp.left);
    assert.notDeepEqual(comp.parent, comp.right);
    assert.hasAllKeys(comp.left, ['n', 'h']);
    assert.hasAllKeys(comp.right, ['n', 'h']);
    assert.equal(comp.left.n, 2);
    assert.equal(comp.right.n, 4);
    assert.deepEqual(comp.details!.leftChanges, { tableRenames: [], tableDeltas: {} });
    assert.deepEqual(comp.details!.rightChanges, {
      tableRenames: [],
      tableDeltas: {
        Table1: {
          updateRows: [1],
          removeRows: [],
          addRows: [2],
          columnDeltas: {
            A: { [1]: [['a1'], ['A1']],
                 [2]: [null, ['a2']] },
            B: { [2]: [null, ['b2']] },
            manualSort: { [2]: [null, [2]] },
          },
          columnRenames: [],
        }
      }
    });
  });

  it('doc worker endpoints ignore any /dw/.../ prefix', async function() {
    const docWorkerUrl = docs.serverUrl;
    let resp = await axios.get(`${docWorkerUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

    resp = await axios.get(`${docWorkerUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

    if (docWorkerUrl !== homeUrl) {
      resp = await axios.get(`${homeUrl}/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 200);
      assert.containsAllKeys(resp.data, ['A', 'B', 'C']);

      resp = await axios.get(`${homeUrl}/dw/zing/api/docs/${docIds.Timesheets}/tables/Table1/data`, chimpy);
      assert.equal(resp.status, 404);
    }
  });

  it("POST /docs/{did}/tables/{tid}/_subscribe validates inputs", async function () {
    async function check(requestBody: any, status: number, error: string) {
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
        requestBody, chimpy
      );
      assert.equal(resp.status, status);
      assert.deepEqual(resp.data, {error});
    }

    await check({}, 400, "eventTypes must be a non-empty array");
    await check({eventTypes: 0}, 400, "eventTypes must be a non-empty array");
    await check({eventTypes: []}, 400, "eventTypes must be a non-empty array");
    await check({eventTypes: ["foo"]}, 400, "Allowed values in eventTypes are: add,update");
    await check({eventTypes: ["add"]}, 400, "Bad request: url required");
    await check({eventTypes: ["add"], url: "https://evil.com"}, 403, "Provided url is forbidden");
    await check({eventTypes: ["add"], url: "http://example.com"}, 403, "Provided url is forbidden");  // not https
    await check({eventTypes: ["add"], url: "https://example.com", isReadyColumn: "bar"}, 404, `Column not found "bar"`);
  });

  it("POST /docs/{did}/tables/{tid}/_unsubscribe validates inputs", async function() {
    const subscribeResponse = await axios.post(
      `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
      {eventTypes: ["add"], url: "https://example.com"}, chimpy
    );
    assert.equal(subscribeResponse.status, 200);
    const {triggerId, unsubscribeKey, webhookId} = subscribeResponse.data;

    async function check(requestBody: any, status: number, responseBody: any) {
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_unsubscribe`,
        requestBody, chimpy
      );
      assert.equal(resp.status, status);
      if (status !== 200) {
        responseBody = {error: responseBody};
      }
      assert.deepEqual(resp.data, responseBody);
    }

    await check({triggerId: 999}, 404, `Trigger not found "999"`);
    await check({triggerId, webhookId: "foo"}, 404, `Webhook not found "foo"`);
    await check({triggerId, webhookId}, 400, 'Bad request: id and unsubscribeKey both required');
    await check({triggerId, webhookId, unsubscribeKey: "foo"}, 401, 'Wrong unsubscribeKey');

    // Actually unsubscribe
    await check({triggerId, webhookId, unsubscribeKey}, 200, {success: true});

    // Trigger is now deleted!
    await check({triggerId, webhookId, unsubscribeKey}, 404, `Trigger not found "${triggerId}"`);
  });

  describe("Daily API Limit", () => {
    let redisClient: RedisClient;
    let workspaceId: number;
    let freeTeamApi: UserAPIImpl;

    before(async function() {
      if (!process.env.TEST_REDIS_URL) { this.skip(); }
      redisClient = createClient(process.env.TEST_REDIS_URL);
      freeTeamApi = makeUserApi('freeteam');
      workspaceId = await getWorkspaceId(freeTeamApi, 'FreeTeamWs');
    });

    it("limits daily API usage", async function() {
      // Make a new document in a free team site, currently the only product which limits daily API usage.
      const docId = await freeTeamApi.newDoc({name: 'TestDoc'}, workspaceId);
      const key = docDailyApiUsageKey(docId);
      const limit = teamFreeFeatures.baseMaxApiUnitsPerDocumentPerDay!;
      // Rather than making 5000 requests, set a high count directly in redis.
      await redisClient.setAsync(key, String(limit - 2));

      // Make three requests. The first two should succeed since we set the count to `limit - 2`.
      // Wait a little after each request to allow time for the local cache to be updated with the redis count.
      let response = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
      assert.equal(response.status, 200);
      await delay(100);

      response = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
      assert.equal(response.status, 200);
      await delay(100);

      // The count should now have reached the limit, and the key should expire in one day.
      assert.equal(await redisClient.ttlAsync(key), 86400);
      assert.equal(await redisClient.getAsync(key), String(limit));

      // Making the same request a third time should fail.
      response = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
      assert.equal(response.status, 429);
      assert.deepEqual(response.data, {error: `Exceeded daily limit for document ${docId}`});
    });

    after(async () => {
      await redisClient.quitAsync();
    });
  });

  describe("Webhooks", () => {
    let serving: Serving;  // manages the test webhook server

    let requests: WebhookRequests;

    let receivedLastEvent: Promise<void>;

    // Requests corresponding to adding 200 rows, sent in two batches of 100
    const expected200AddEvents = [
      _.range(100).map(i => ({
        id: 9 + i, manualSort: 9 + i, A3: 200 + i, B3: true,
      })),
      _.range(100).map(i => ({
        id: 109 + i, manualSort: 109 + i, A3: 300 + i, B3: true,
      })),
    ];

    // Every event is sent to three webhook URLs which differ by the subscribed eventTypes
    // Each request is an array of one or more events.
    // Multiple events caused by the same action bundle get batched into a single request.
    const expectedRequests: WebhookRequests = {
      "add": [
        [{id: 1, A: 1, B: true, C: null, manualSort: 1}],
        [{id: 2, A: 4, B: true, C: null, manualSort: 2}],

        // After isReady (B) went to false and then true again
        // we treat this as creation even though it's really an update
        [{id: 2, A: 7, B: true, C: null, manualSort: 2}],

        // From the big applies
        [{id: 3, A3: 13, B3: true, manualSort: 3},
         {id: 5, A3: 15, B3: true, manualSort: 5}],
        [{id: 7, A3: 18, B3: true, manualSort: 7}],

        ...expected200AddEvents,
      ],
      "update": [
        [{id: 2, A: 8, B: true, C: null, manualSort: 2}],

        // From the big applies
        [{id: 1, A3: 101, B3: true, manualSort: 1}],
      ],
      "add,update": [
        // add
        [{id: 1, A: 1, B: true, C: null, manualSort: 1}],
        [{id: 2, A: 4, B: true, C: null, manualSort: 2}],
        [{id: 2, A: 7, B: true, C: null, manualSort: 2}],

        // update
        [{id: 2, A: 8, B: true, C: null, manualSort: 2}],

        // from the big applies
        [{id: 1, A3: 101, B3: true, manualSort: 1},  // update
         {id: 3, A3: 13, B3: true, manualSort: 3},   // add
         {id: 5, A3: 15, B3: true, manualSort: 5}],  // add

        [{id: 7, A3: 18, B3: true, manualSort: 7}],  // add

        ...expected200AddEvents,
      ]
    };

    let redisMonitor: any;
    let redisCalls: any[];

    before(async function() {
      if (!process.env.TEST_REDIS_URL) { this.skip(); }
      requests = {
        "add,update": [],
        "add": [],
        "update": [],
      };

      let resolveReceivedLastEvent: () => void;
      receivedLastEvent = new Promise<void>(r => {
        resolveReceivedLastEvent = r;
      });

      // TODO test retries on failure and slowness in a new test
      serving = await serveSomething(app => {
        app.use(bodyParser.json());
        app.post('/:eventTypes', async ({body, params: {eventTypes}}, res) => {
          requests[eventTypes as keyof WebhookRequests].push(body);
          res.sendStatus(200);
          if (
            _.flattenDeep(_.values(requests)).length >=
            _.flattenDeep(_.values(expectedRequests)).length
          ) {
            resolveReceivedLastEvent();
          }
        });
      }, webhooksTestPort);

      redisCalls = [];
      redisMonitor = createClient(process.env.TEST_REDIS_URL);
      redisMonitor.monitor();
      redisMonitor.on("monitor", (_time: any, args: any, _rawReply: any) => {
        redisCalls.push(args);
      });
    });

    after(async function() {
      if (!process.env.TEST_REDIS_URL) { this.skip(); }
      serving.shutdown();
      await redisMonitor.quitAsync();
    });

    it("delivers expected payloads from combinations of changes, with retrying and batching", async function() {
      // Create a test document.
      const ws1 = (await userApi.getOrgWorkspaces('current'))[0].id;
      const docId = await userApi.newDoc({name: 'testdoc'}, ws1);
      const doc = userApi.getDocAPI(docId);

      // For some reason B is turned into Numeric even when given bools
      await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
        ['ModifyColumn', 'Table1', 'B', {type: 'Bool'}],
      ], chimpy);

      // Make a webhook for every combination of event types
      const subscribeResponses = [];
      const webhookIds: Record<string, string> = {};
      for (const eventTypes of [
        ["add"],
        ["update"],
        ["add", "update"],
      ]) {
        const {data, status} = await axios.post(
          `${serverUrl}/api/docs/${docId}/tables/Table1/_subscribe`,
          {eventTypes, url: `${serving.url}/${eventTypes}`, isReadyColumn: "B"}, chimpy
        );
        assert.equal(status, 200);
        subscribeResponses.push(data);
        webhookIds[data.webhookId] = String(eventTypes);
      }

      // Add and update some rows, trigger some events
      // Values of A where B is true and thus the record is ready are [1, 4, 7, 8]
      // So those are the values seen in expectedEvents
      await doc.addRows("Table1", {
        A: [1, 2],
        B: [true, false], // 1  is ready, 2 is not ready yet
      });
      await doc.updateRows("Table1", {id: [2], A: [3]});  // still not ready
      await doc.updateRows("Table1", {id: [2], A: [4], B: [true]});  // ready!
      await doc.updateRows("Table1", {id: [2], A: [5], B: [false]});  // not ready again
      await doc.updateRows("Table1", {id: [2], A: [6]});  // still not ready
      await doc.updateRows("Table1", {id: [2], A: [7], B: [true]});  // ready!
      await doc.updateRows("Table1", {id: [2], A: [8]});  // still ready!

      // The end result here is additions for column A (now A3) with values [13, 15, 18]
      // and an update for 101
      await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
        ['BulkAddRecord', 'Table1', [3, 4, 5, 6], {A: [9, 10, 11, 12], B: [true, true, false, false]}],
        ['BulkUpdateRecord', 'Table1', [1, 2, 3, 4, 5, 6], {
          A: [101, 102, 13, 14, 15, 16],
          B: [true, false, true, false, true, false],
        }],

        ['RenameColumn', 'Table1', 'A', 'A3'],
        ['RenameColumn', 'Table1', 'B', 'B3'],

        ['RenameTable', 'Table1', 'Table12'],

        // FIXME a double rename A->A2->A3 doesn't seem to get summarised correctly
        // ['RenameColumn', 'Table12', 'A2', 'A3'],
        // ['RenameColumn', 'Table12', 'B2', 'B3'],

        ['RemoveColumn', 'Table12', 'C'],
      ], chimpy);

      // FIXME record changes after a RenameTable in the same bundle
      //  don't appear in the action summary
      await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
        ['AddRecord', 'Table12', 7, {A3: 17, B3: false}],
        ['UpdateRecord', 'Table12', 7, {A3: 18, B3: true}],

        ['AddRecord', 'Table12', 8, {A3: 19, B3: true}],
        ['UpdateRecord', 'Table12', 8, {A3: 20, B3: false}],

        ['AddRecord', 'Table12', 9, {A3: 20, B3: true}],
        ['RemoveRecord', 'Table12', 9],
      ], chimpy);

      // Add 200 rows. These become the `expected200AddEvents`
      await doc.addRows("Table12", {
        A3: _.range(200, 400),
        B3: arrayRepeat(200, true),
      });

      await receivedLastEvent;

      // Unsubscribe
      await Promise.all(subscribeResponses.map(async subscribeResponse => {
        const unsubscribeResponse = await axios.post(
          `${serverUrl}/api/docs/${docId}/tables/Table12/_unsubscribe`,
          subscribeResponse, chimpy
        );
        assert.equal(unsubscribeResponse.status, 200);
        assert.deepEqual(unsubscribeResponse.data, {success: true});
      }));

      // Further changes should generate no events because the triggers are gone
      await doc.addRows("Table12", {
        A3: [88, 99],
        B3: [true, false],
      });

      assert.deepEqual(requests, expectedRequests);

      // Check that the events were all pushed to the redis queue
      const queueRedisCalls = redisCalls.filter(args => args[1] === "webhook-queue-" + docId);
      const redisPushes = _.chain(queueRedisCalls)
        .filter(args => args[0] === "rpush")          // Array<["rpush", key, ...events: string[]]>
        .flatMap(args => args.slice(2))               // events: string[]
        .map(JSON.parse)                              // events: WebhookEvent[]
        .groupBy('id')                                // {[webHookId: string]: WebhookEvent[]}
        .mapKeys((_value, key) => webhookIds[key])    // {[eventTypes: 'add'|'update'|'add,update']: WebhookEvent[]}
        .mapValues(group => _.map(group, 'payload'))  // {[eventTypes: 'add'|'update'|'add,update']: RowRecord[]}
        .value();
      const expectedPushes = _.mapValues(expectedRequests, value => _.flatten(value));
      assert.deepEqual(redisPushes, expectedPushes);

      // Check that the events were all removed from the redis queue
      const redisTrims = queueRedisCalls.filter(args => args[0] === "ltrim")
        .map(([,, start, end]) => {
          assert.equal(end, '-1');
          start = Number(start);
          assert.isTrue(start > 0);
          return start;
      });
      const expectedTrims = Object.values(redisPushes).map(value => value.length);
      assert.equal(
        _.sum(redisTrims),
        _.sum(expectedTrims),
      );

    });
  });

  // PLEASE ADD MORE TESTS HERE
}

interface WebhookRequests {
  add: object[][];
  update: object[][];
  "add,update": object[][];
}

function setup(name: string, cb: () => Promise<void>) {
  let api: UserAPIImpl;

  before(async function() {
    suitename = name;
    dataDir = path.join(tmpDir, `${suitename}-data`);
    await fse.mkdirs(dataDir);
    await setupDataDir(dataDir);
    await cb();

    // create TestDoc as an empty doc into Private workspace
    userApi = api = makeUserApi('docs-1');
    const wid = await getWorkspaceId(api, 'Private');
    docIds.TestDoc = await api.newDoc({name: 'TestDoc'}, wid);
  });

  after(async function() {
    // remove TestDoc
    await api.deleteDoc(docIds.TestDoc);
    delete docIds.TestDoc;

    // stop all servers
    await home.stop();
    await docs.stop();
  });
}

function makeUserApi(org: string) {
  return new UserAPIImpl(`${home.serverUrl}/o/${org}`, {
    headers: {Authorization: 'Bearer api_key_for_chimpy'},
    fetch: fetch as any,
    newFormData: () => new FormData() as any,
    logger: log
  });
}

async function getWorkspaceId(api: UserAPIImpl, name: string) {
  const workspaces = await api.getOrgWorkspaces('current');
  return workspaces.find((w) => w.name === name)!.id;
}

async function startServer(serverTypes: string, _homeUrl?: string): Promise<TestServer> {
  const server = new TestServer(serverTypes);
  await server.start(_homeUrl);
  return server;
}

const webhooksTestPort = 34365;

class TestServer {
  public testingSocket: string;
  public testingHooks: TestingHooksClient;
  public serverUrl: string;
  public stopped = false;

  private _server: ChildProcess;
  private _exitPromise: Promise<number|string>;

  constructor(private _serverTypes: string) {}

  public async start(_homeUrl?: string) {

    // put node logs into files with meaningful name that relate to the suite name and server type
    const fixedName = this._serverTypes.replace(/,/, '_');
    const nodeLogPath = path.join(tmpDir, `${suitename}-${fixedName}-node.log`);
    const nodeLogFd = await fse.open(nodeLogPath, 'a');
    const serverLog = process.env.VERBOSE ? 'inherit' : nodeLogFd;

    // use a path for socket that relates to suite name and server types
    this.testingSocket = path.join(tmpDir, `${suitename}-${fixedName}.socket`);

    // env
    const env = {
      GRIST_DATA_DIR: dataDir,
      GRIST_INST_DIR: tmpDir,
      GRIST_SERVERS: this._serverTypes,
      // with port '0' no need to hard code a port number (we can use testing hooks to find out what
      // port server is listening on).
      GRIST_PORT: '0',
      GRIST_TESTING_SOCKET: this.testingSocket,
      GRIST_DISABLE_S3: 'true',
      REDIS_URL: process.env.TEST_REDIS_URL,
      APP_HOME_URL: _homeUrl,
      ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
      ...process.env
    };

    const main = await testUtils.getBuildFile('app/server/mergedServerMain.js');
    this._server = spawn('node', [main, '--testingHooks'], {
      env,
      stdio: ['inherit', serverLog, serverLog]
    });

    this._exitPromise = exitPromise(this._server);

    // Try to be more helpful when server exits by printing out the tail of its log.
    this._exitPromise.then((code) => {
        if (this._server.killed) { return; }
        log.error("Server died unexpectedly, with code", code);
        const output = execFileSync('tail', ['-30', nodeLogPath]);
        log.info(`\n===== BEGIN SERVER OUTPUT ====\n${output}\n===== END SERVER OUTPUT =====`);
      })
      .catch(() => undefined);

    await this._waitServerReady(30000);
    log.info(`server ${this._serverTypes} up and listening on ${this.serverUrl}`);
  }

  public async stop() {
    if (this.stopped) { return; }
    log.info("Stopping node server: " + this._serverTypes);
    this.stopped = true;
    this._server.kill();
    this.testingHooks.close();
    await this._exitPromise;
  }

  public async isServerReady(): Promise<boolean> {
    // Let's wait for the testingSocket to be created, then get the port the server is listening on,
    // and then do an api check. This approach allow us to start server with GRIST_PORT set to '0',
    // which will listen on first available port, removing the need to hard code a port number.
    try {

      // wait for testing socket
      while (!(await fse.pathExists(this.testingSocket))) {
        await delay(200);
      }

      // create testing hooks and get own port
      this.testingHooks = await connectTestingHooks(this.testingSocket);
      const port: number = await this.testingHooks.getOwnPort();
      this.serverUrl = `http://localhost:${port}`;

      // wait for check
      return (await fetch(`${this.serverUrl}/status/hooks`, {timeout: 1000})).ok;
    } catch (err) {
      return false;
    }
  }


  private async _waitServerReady(ms: number) {
    // It's important to clear the timeout, because it can prevent node from exiting otherwise,
    // which is annoying when running only this test for debugging.
    let timeout: any;
    const maxDelay = new Promise((resolve) => {
      timeout = setTimeout(resolve, 30000);
    });
    try {
      await Promise.race([
        this.isServerReady(),
        this._exitPromise.then(() => { throw new Error("Server exited while waiting for it"); }),
        maxDelay,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function setupDataDir(dir: string) {
  // we'll be serving Hello.grist content for various document ids, so let's make copies of it in
  // tmpDir
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Timesheets + '.grist'));
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Bananas + '.grist'));
  await testUtils.copyFixtureDoc('Hello.grist', path.resolve(dir, docIds.Antartic + '.grist'));

  await testUtils.copyFixtureDoc(
    'ApiDataRecordsTest.grist',
    path.resolve(dir, docIds.ApiDataRecordsTest + '.grist'));
}
