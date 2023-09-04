/**
 * Module to handle the storage of Grist documents.
 *
 * A Grist document is stored as a SQLite database file. We keep everything in a single database
 * file, including attachments, for the sake of having a single file represent a single "document"
 * or "data set".
 */


import {LocalActionBundle} from 'app/common/ActionBundle';
import {BulkColValues, DocAction, TableColValues, TableDataAction, toTableDataAction} from 'app/common/DocActions';
import * as gristTypes from 'app/common/gristTypes';
import {isList, isListType, isRefListType} from 'app/common/gristTypes';
import * as marshal from 'app/common/marshal';
import * as schema from 'app/common/schema';
import {SingleCell} from 'app/common/TableData';
import {GristObjCode} from "app/plugin/GristData";
import {ActionHistoryImpl} from 'app/server/lib/ActionHistoryImpl';
import {ExpandedQuery} from 'app/server/lib/ExpandedQuery';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import log from 'app/server/lib/log';
import assert from 'assert';
import * as bluebird from 'bluebird';
import * as fse from 'fs-extra';
import * as _ from 'underscore';
import * as util from 'util';
import uuidv4 from "uuid/v4";
import {OnDemandStorage} from './OnDemandActions';
import {ISQLiteDB, MigrationHooks, OpenMode, PreparedStatement, quoteIdent,
        ResultRow, RunResult, SchemaInfo, SQLiteDB} from 'app/server/lib/SQLiteDB';
import chunk = require('lodash/chunk');
import cloneDeep = require('lodash/cloneDeep');
import groupBy = require('lodash/groupBy');
import { MinDBOptions } from './SqliteCommon';


// Run with environment variable NODE_DEBUG=db (may include additional comma-separated sections)
// for verbose logging.
const debuglog = util.debuglog('db');

const maxSQLiteVariables = 500;     // Actually could be 999, so this is playing it safe.

const PENDING_VALUE = [GristObjCode.Pending];

// Number of days that soft-deleted attachments are kept in file storage before being completely deleted.
// Once a file is deleted it can't be restored by undo, so we want it to be impossible or at least extremely unlikely
// that someone would delete a reference to an attachment and then undo that action this many days later.
export const ATTACHMENTS_EXPIRY_DAYS = 7;

// Cleanup expired attachments every hour (also happens when shutting down).
export const REMOVE_UNUSED_ATTACHMENTS_DELAY = {delayMs: 60 * 60 * 1000, varianceMs: 30 * 1000};


export class DocStorage implements ISQLiteDB, OnDemandStorage {

  // ======================================================================
  // Static fields
  // ======================================================================

  /**
   * Schema for all system tables, i.e. those that are NOT known by the data engine. Regular
   * metadata tables (such as _grist_DocInfo) are created via DocActions received from
   * InitNewDoc useraction.
   *
   * The current "Storage Version" used by Grist is the length of the migrations list in its
   * Schema.  We use it to track changes to how data is stored on disk, and changes to the schema
   * of non-data-engine tables (such as _gristsys_* tables). By contrast, "Schema Version" keeps
   * track of the version of data-engine metadata. In SQLite, we use "PRAGMA user_version" to
   * store the storage version number.
   */
  public static docStorageSchema: SchemaInfo = {
    async create(db: SQLiteDB): Promise<void> {
      await db.exec(`CREATE TABLE _gristsys_Files (
        id INTEGER PRIMARY KEY,
        ident TEXT UNIQUE,
        data BLOB
       )`);
      await db.exec(`CREATE TABLE _gristsys_Action (
        id INTEGER PRIMARY KEY,
        "actionNum" BLOB DEFAULT 0,
        "time" BLOB DEFAULT 0,
        "user" BLOB DEFAULT '',
        "desc" BLOB DEFAULT '',
        "otherId" BLOB DEFAULT 0,
        "linkId" BLOB DEFAULT 0,
        "json" BLOB DEFAULT ''
      )`);
      await db.exec(`CREATE TABLE _gristsys_Action_step (
        id INTEGER PRIMARY KEY,
        "parentId" BLOB DEFAULT 0,
        "type" BLOB DEFAULT '',
        "name" BLOB DEFAULT '',
        "tableId" BLOB DEFAULT '',
        "colIds" BLOB DEFAULT '',
        "rowIds" BLOB DEFAULT '',
        "values" BLOB DEFAULT '',
        "json" BLOB DEFAULT ''
      )`);
      await db.exec(`CREATE TABLE _gristsys_ActionHistory (
        id INTEGER PRIMARY KEY,       -- Plain integer action ID ("actionRef")
        actionHash TEXT UNIQUE,       -- Action checksum
        parentRef INTEGER,            -- id of parent of this action
        actionNum INTEGER,            -- distance from root of tree in actions
        body BLOB                     -- content of action
      )`);
      await db.exec(`CREATE TABLE _gristsys_ActionHistoryBranch (
        id INTEGER PRIMARY KEY,       -- Numeric branch ID
        name TEXT UNIQUE,             -- Branch name
        actionRef INTEGER             -- Latest action on branch
      )`);
      for (const branchName of ['shared', 'local_sent', 'local_unsent']) {
        await db.run("INSERT INTO _gristsys_ActionHistoryBranch(name) VALUES(?)",
                     branchName);
      }
      // This is a single row table (enforced by the CHECK on 'id'), containing non-shared info.
      // - ownerInstanceId is the id of the instance which owns this copy of the Grist doc.
      // - docId is also kept here because it should not be changeable by UserActions.
      await db.exec(`CREATE TABLE _gristsys_FileInfo (
        id INTEGER PRIMARY KEY CHECK (id = 0),
        docId TEXT DEFAULT '',
        ownerInstanceId TEXT DEFAULT ''
      )`);
      await db.exec("INSERT INTO _gristsys_FileInfo (id) VALUES (0)");
      await db.exec(`CREATE TABLE _gristsys_PluginData (
        id INTEGER PRIMARY KEY,      -- Plain integer plugin data id
        pluginId TEXT NOT NULL,      -- Plugin id
        key TEXT NOT NULL,           -- the key
        value BLOB DEFAULT ''        -- the value associated with the key
        );
        -- Plugins have unique keys.
        CREATE UNIQUE INDEX _gristsys_PluginData_unique_key on _gristsys_PluginData(pluginId, key);`);
    },
    migrations: [
      async function(db: SQLiteDB): Promise<void> {
        // Storage version 1 does not require a migration. Docs at v1 (or before) may not all
        // be the same, and are only made uniform by v2.
      },
      async function(db: SQLiteDB): Promise<void> {
        // Storage version 2. We change the types of all columns to BLOBs.
        // This applies to all Grist tables, including metadata.
        const migrationLabel = "DocStorage.docStorageSchema.migrations[v1->v2]";
        const oldMaxPosDefault = String(Math.pow(2, 31) - 1);

        function _upgradeTable(tableId: string) {
          log.debug(`${migrationLabel}: table ${tableId}`);
          // This returns rows with (at least) {name, type, dflt_value}.
          return db.all(`PRAGMA table_info(${quoteIdent(tableId)})`)
            .then(infoRows => {
              const colListSql = infoRows.map(info => quoteIdent(info.name)).join(', ');
              const colSpecSql = infoRows.map(_sqlColSpec).join(', ');
              const tmpTableId = DocStorage._makeTmpTableId(tableId);
              debuglog(`${migrationLabel}: ${tableId} (${colSpecSql})`);
              return db.runEach(
                `CREATE TABLE ${quoteIdent(tmpTableId)} (${colSpecSql})`,
                `INSERT INTO ${quoteIdent(tmpTableId)} SELECT ${colListSql} FROM ${quoteIdent(tableId)}`,
                `DROP TABLE ${quoteIdent(tableId)}`,
                `ALTER TABLE ${quoteIdent(tmpTableId)} RENAME TO ${quoteIdent(tableId)}`
              );
            });
        }

        function _sqlColSpec(info: ResultRow): string {
          if (info.name === 'id') { return 'id INTEGER PRIMARY KEY'; }
          // Fix the default for PositionNumber and ManualPos types, if set to a wrong old value.
          const dfltValue = (info.type === 'REAL' && info.dflt_value === oldMaxPosDefault) ?
            DocStorage._formattedDefault('PositionNumber') :
            // The string "undefined" is also an invalid default; fix that too.
            (info.dflt_value === 'undefined' ? 'NULL' : info.dflt_value);

          return DocStorage._sqlColSpecFromDBInfo(Object.assign({}, info, {
            type: 'BLOB',
            dflt_value: dfltValue
          }));
        }

        // Some migration-type steps pre-date storage migrations. We can do them once for the first
        // proper migration (i.e. this one, to v2), and then never worry about them for upgraded docs.

        // Create table for files that wasn't always created in the past.
        await db.exec(`CREATE TABLE IF NOT EXISTS _gristsys_Files (
          id INTEGER PRIMARY KEY,
          ident TEXT UNIQUE,
          data BLOB
         )`);
        // Create _gristsys_Action.linkId column that wasn't always created in the past.
        try {
          await db.exec('ALTER TABLE _gristsys_Action ADD COLUMN linkId INTEGER');
          log.debug("${migrationLabel}: Column linkId added to _gristsys_Action");
        } catch (err) {
          if (!(/duplicate/.test(err.message))) {
            // ok if column already existed
            throw err;
          }
        }
        // Deal with the transition to blob types
        const tblRows = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        for (const tblRow of tblRows) {
          // Note that _gristsys_Action tables in the past used Grist actions to create appropriate
          // tables, so docs from that period would use BLOBs. For consistency, we upgrade those tables
          // too.
          if (tblRow.name.startsWith('_grist_') || !tblRow.name.startsWith('_') ||
              tblRow.name.startsWith('_gristsys_Action')) {
            await _upgradeTable(tblRow.name);
          }
        }
      },
      async function(db: SQLiteDB): Promise<void> {
        // Storage version 3. Convert old _gristsys_Action* tables to _gristsys_ActionHistory*.
        await db.exec(`CREATE TABLE IF NOT EXISTS _gristsys_ActionHistory (
          id INTEGER PRIMARY KEY,
          actionHash TEXT UNIQUE,
          parentRef INTEGER,
          actionNum INTEGER,
          body BLOB
        )`);
        await db.exec(`CREATE TABLE IF NOT EXISTS _gristsys_ActionHistoryBranch (
          id INTEGER PRIMARY KEY,
          name TEXT UNIQUE,
          actionRef INTEGER
        )`);
        for (const branchName of ['shared', 'local_sent', 'local_unsent']) {
          await db.run("INSERT OR IGNORE INTO _gristsys_ActionHistoryBranch(name) VALUES(?)",
                       branchName);
        }
        // Migrate any ActionLog information as best we can
        const actions = await db.all("SELECT * FROM _gristsys_Action ORDER BY actionNum");
        const steps = groupBy(await db.all("SELECT * FROM _gristsys_Action_step ORDER BY id"),
                              'parentId');
        await db.execTransaction(async () => {
          const history = new ActionHistoryImpl(db);
          await history.initialize();
          for (const action of actions) {
            const step = steps[action.actionNum] || [];
            const crudeTranslation: LocalActionBundle = {
              actionNum: history.getNextHubActionNum(),
              actionHash: null,
              parentActionHash: null,
              envelopes: [],
              info: [
                0,
                {
                  time: action.time,
                  user: action.user,
                  inst: "",
                  desc: action.desc,
                  otherId: action.otherId,
                  linkId: action.linkId
                }
              ],
              // Take what was logged as a UserAction and treat it as a DocAction.  Summarization
              // currently depends on stored+undo fields to understand what changed in an ActionBundle.
              // DocActions were not logged prior to this version, so we have to fudge things a little.
              stored: [[0, JSON.parse(action.json) as DocAction]],
              calc: [],
              userActions: [JSON.parse(action.json)],
              undo: step.map(row => JSON.parse(row.json))
            };
            await history.recordNextShared(crudeTranslation);
          }
          await db.run("DELETE FROM _gristsys_Action_step");
          await db.run("DELETE FROM _gristsys_Action");
        });
      },
      async function(db: SQLiteDB): Promise<void> {
        // Storage version 4. Maintain docId and ownerInstanceId in a single-row special table;
        // for standalone sharing.
        await db.exec(`CREATE TABLE _gristsys_FileInfo (
          id INTEGER PRIMARY KEY CHECK (id = 0),
          docId TEXT DEFAULT '',
          ownerInstanceId TEXT DEFAULT ''
        )`);
        await db.exec("INSERT INTO _gristsys_FileInfo (id) VALUES (0)");
      },
      async function(db: SQLiteDB): Promise<void> {
        // Storage version 5. Add a table to maintain per-plugin data, for plugins' Storage API.
        await db.exec(`CREATE TABLE _gristsys_PluginData (
          id INTEGER PRIMARY KEY,
          pluginId TEXT NOT NULL,
          key TEXT NOT NULL,
          value BLOB DEFAULT ''
          );
          CREATE UNIQUE INDEX IF NOT EXISTS _gristsys_PluginData_unique_key on _gristsys_PluginData(pluginId, key);`);
      },

      async function(db: SQLiteDB): Promise<void> {
        // Storage version 6. Migration to fix columns in user tables which have an incorrect
        // DEFAULT for their Grist type, due to bug T462.
        const migrationLabel = "DocStorage.docStorageSchema.migrations[v5->v6]";

        const colRows: ResultRow[] = await db.all('SELECT t.tableId, c.colId, c.type ' +
          'FROM _grist_Tables_column c JOIN _grist_Tables t ON c.parentId=t.id');
        const docSchema = new Map<string, string>();   // Maps tableId.colId to grist type.
        for (const {tableId, colId, type} of colRows) {
          docSchema.set(`${tableId}.${colId}`, type);
        }

        // Fixes defaults and affected null values in a particular table.
        async function _fixTable(tableId: string) {
          log.debug(`${migrationLabel}: table ${tableId}`);
          // This returns rows with (at least) {name, type, dflt_value}.
          const infoRows: ResultRow[] = await db.all(`PRAGMA table_info(${quoteIdent(tableId)})`);
          const origColSpecSql = infoRows.map(_sqlColSpec).join(', ');

          // Get the column SQL for what the columns should be, and the value SQL for how to
          // prepare the values to fill them in.
          const fixes = infoRows.map((r) => _getInfoAndValuesSql(r, tableId));
          const newColSpecSql = fixes.map(pair => pair[0]).map(_sqlColSpec).join(', ');
          const valuesSql = fixes.map(pair => pair[1]).join(', ');

          // Rebuild the table only if any column's SQL (e.g. DEFAULT values) have changed.
          if (newColSpecSql === origColSpecSql) {
            debuglog(`${migrationLabel}: ${tableId} unchanged: (${newColSpecSql})`);
          } else {
            debuglog(`${migrationLabel}: ${tableId} changed: (${newColSpecSql})`);
            const tmpTableId = DocStorage._makeTmpTableId(tableId);
            return db.runEach(
              `CREATE TABLE ${quoteIdent(tmpTableId)} (${newColSpecSql})`,
              `INSERT INTO ${quoteIdent(tmpTableId)} SELECT ${valuesSql} FROM ${quoteIdent(tableId)}`,
              `DROP TABLE ${quoteIdent(tableId)}`,
              `ALTER TABLE ${quoteIdent(tmpTableId)} RENAME TO ${quoteIdent(tableId)}`
            );
          }
        }

        // Look up the type for a single column, and if the default changed to non-NULL, construct
        // the updated column SQL and the value SQL for how to prepare values.
        function _getInfoAndValuesSql(info: ResultRow, tableId: string): [ResultRow, string] {
          const qColId = quoteIdent(info.name);
          const gristType = docSchema.get(`${tableId}.${info.name}`);
          if (gristType) {
            const dflt = DocStorage._formattedDefault(gristType);
            if (info.dflt_value === 'NULL' && dflt !== 'NULL') {
              return [{...info, dflt_value: dflt}, `IFNULL(${qColId}, ${dflt}) as ${qColId}`];
            }
          }
          return [info, qColId];
        }

        function _sqlColSpec(info: ResultRow): string {
          if (info.name === 'id') { return 'id INTEGER PRIMARY KEY'; }
          return DocStorage._sqlColSpecFromDBInfo(info);
        }

        // Go through all user tables and fix them.
        const tblRows = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        for (const tblRow of tblRows) {
          if (!tblRow.name.startsWith('_')) {
            await _fixTable(tblRow.name);
          }
        }
      },

      async function(db: SQLiteDB): Promise<void> {
        // Storage version 7. Migration to store formulas in SQLite.
        // Here, we only create empty columns for each formula column in the document. We let
        // ActiveDoc, when it calculates formulas on open, detect that this migration just
        // happened, and save the calculated results.
        const colRows: ResultRow[] = await db.all('SELECT t.tableId, c.colId, c.type ' +
          'FROM _grist_Tables_column c JOIN _grist_Tables t ON c.parentId=t.id WHERE c.isFormula');

        // Go table by table.
        const tableColRows = groupBy(colRows, 'tableId');
        for (const tableId of Object.keys(tableColRows)) {
          // There should be no columns conflicting with formula columns, but we check and skip
          // them if there are.
          const infoRows = await db.all(`PRAGMA table_info(${quoteIdent(tableId)})`);
          const presentCols = new Set([...infoRows.map(row => row.name)]);
          const newCols = tableColRows[tableId].filter(c => !presentCols.has(c.colId));

          // Create all new columns.
          for (const {colId, type} of newCols) {
            await db.exec(`ALTER TABLE ${quoteIdent(tableId)} ` +
              `ADD COLUMN ${DocStorage._columnDefWithBlobs(colId, type)}`);
          }

          // Fill them in with PENDING_VALUE. This way, on first load and Calculate, they would go
          // from "Loading..." to their proper value. After the migration, they should never have
          // PENDING_VALUE again.
          const colListSql = newCols.map(c => `${quoteIdent(c.colId)}=?`).join(', ');
          const types = newCols.map(c => c.type);
          const sqlParams = DocStorage._encodeColumnsToRows(types, newCols.map(c => [PENDING_VALUE]));
          await db.run(`UPDATE ${quoteIdent(tableId)} SET ${colListSql}`, ...sqlParams[0]);
        }
      },

      async function(db: SQLiteDB): Promise<void> {
        // Storage version 8.
        // Migration to add an index to _grist_Attachments.fileIdent for fast joining against _gristsys_Files.ident.
        const tables = await db.all(`SELECT * FROM sqlite_master WHERE type='table' AND name='_grist_Attachments'`);
        if (!tables.length) {
          // _grist_Attachments is created in the first Python migration so doesn't exist here for new documents.
          // createAttachmentsIndex is called separately by ActiveDoc for that.
          return;
        }
        await createAttachmentsIndex(db);
      },

    ]
  };

  /**
   * Decodes a database row object, returning a new object with decoded values. This is needed for
   * Grist data, which is encoded.  Careful: doesn't handle booleans specially, should not
   * be used within main Grist application.
   */
  public static decodeRowValues(dbRow: ResultRow): any {
    return _.mapObject(dbRow, val => DocStorage._decodeValue(val, 'Any', 'BLOB'));
  }

  /**
   * Internal helper to distinguish which tables contain information about the metadata
   * that docstorage needs to keep track of
   */
  private static _isMetadataTable(tableId: string): boolean {
    return tableId === "_grist_Tables" || tableId === "_grist_Tables_column";
  }

  /**
   * Shortcut to get the SQL default for the given Grist type.
   */
  private static _formattedDefault(colType: string): any {
    return gristTypes.getDefaultForType(colType, {sqlFormatted: true});
  }

  /**
   * Join array of strings by prefixing each one with sep.
   */
  private static _prefixJoin(sep: string, array: string[]): string {
    return array.length ? sep + array.join(sep) : '';
  }

  /**
   * Internal helper to make a tmp table given a tableId
   *
   * @param {String} tableId
   * @returns {String}
   */
  private static _makeTmpTableId(tableId: string): string {
    return '_tmp_' + tableId;
  }

  private static _sqlColSpecFromDBInfo(info: ResultRow): string {
    return `${quoteIdent(info.name)} ${info.type} DEFAULT ${info.dflt_value}`;
  }

  /**
   * Converts an array of columns to an array of rows (suitable to use as sqlParams), encoding all
   * values as needed, according to an array of Grist type strings (must be parallel to columns).
   */
  private static _encodeColumnsToRows(types: string[], valueColumns: any[]): any[][] {
    const marshaller = new marshal.Marshaller({version: 2});
    const rows = _.unzip(valueColumns);
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        row[i] = DocStorage._encodeValue(marshaller, types[i], this._getSqlType(types[i]), row[i]);
      }
    }
    return rows;
  }

  /**
   * Encodes a single value for storing in SQLite. Numbers and text are stored as is, but complex
   * types are marshalled and stored as BLOBs. We also marshal binary data, so that for encoded
   * data, all BLOBs consistently contain marshalled data.
   *
   * Note that SQLite may contain tables that aren't used for Grist data (e.g. attachments), for
   * which such encoding/marshalling is not used, and e.g. binary data is stored to BLOBs directly.
   */
  private static _encodeValue(
    marshaller: marshal.Marshaller, gristType: string, sqlType: string, val: any
  ): Uint8Array|string|number|boolean {
    const marshalled = () => {
      marshaller.marshal(val);
      return marshaller.dump();
    };
    if (gristType == 'ChoiceList') {
      // See also app/plugin/objtype.ts for decodeObject(). Here we manually check and decode
      // the "List" object type.
      if (isList(val) && val.every(tok => (typeof(tok) === 'string'))) {
        return JSON.stringify(val.slice(1));
      }
    } else if (isRefListType(gristType)) {
      if (isList(val) && val.slice(1).every((tok: any) => (typeof(tok) === 'number'))) {
        return JSON.stringify(val.slice(1));
      }
    }
    // Marshall anything non-primitive.
    if (Array.isArray(val) || val instanceof Uint8Array || Buffer.isBuffer(val)) {
      return marshalled();
    }
    // Leave nulls unchanged.
    if (val === null) { return val; }
    // At this point, we have a non-null primitive.  Check what is the Sqlite affinity
    // of the destination.  May be NUMERIC, INTEGER, TEXT, or BLOB.  We handle REAL
    // also even though it is not currently used.
    const affinity = this._getAffinity(sqlType);
    // For strings, numbers, and booleans, we have distinct strategies and problems.
    switch (typeof(val)) {
      case 'string':
        // Strings are easy with TEXT and BLOB affinity, they can be stored verbatim.
        if (affinity === 'TEXT' || affinity === 'BLOB') { return val; }
        // With an INTEGER, NUMERIC, or REAL affinity, we need to be careful since
        // if the string looks like a number it will get cast.
        // See vdbe.c:applyNumericAffinity in SQLite source code for
        // details.  From reading the code, anything that doesn't start
        // with '+', '-' or '.', or a digit, or whitespace is certainly safe.
        // Whitespace is a little bit fuzzy, could perhaps depend on locale depending
        // on how compiled?
        if (!/[-+ \t\n\r\v0-9.]/.test(val.charAt(0))) {
          return val;
        }
        // We could make further tests, but that'll increase our odds of
        // getting it wrong and letting a string through that gets unexpectedly
        // converted.  So marshall everything else.
        return marshalled();
      case 'number':
        // Marshal with TEXT affinity, and handle some other awkward cases.
        if (affinity === 'TEXT' || Number.isNaN(val) || Object.is(val, -0.0) ||
            (sqlType === 'BOOLEAN' && (val === 0 || val === 1))) {
          return marshalled();
        }
        // Otherwise, SQLite will handle numbers safely.
        return val;
      case 'boolean':
        // Booleans are only safe to store in columns of grist type Bool
        // (SQL type BOOLEAN), since they will be consistently unencoded as
        // booleans.
        return (sqlType === 'BOOLEAN') ? val : marshalled();
    }
    return marshalled();
  }

  /**
   * Decodes Grist data received from SQLite; the inverse of _encodeValue().
   * Both Grist and SQL types are expected. Used to interpret Bool/BOOLEANs, and to parse
   * ChoiceList values.
   */
  private static _decodeValue(val: any, gristType: string, sqlType: string): any {
    if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
      val = marshal.loads(val);
    }
    if (gristType === 'Bool') {
      if (val === 0 || val === 1) {
        // Boolean values come in as 0/1. If the column is of type "Bool", interpret those as
        // true/false (note that the data engine does this too).
        return Boolean(val);
      }
    }
    if (isListType(gristType)) {
      if (typeof val === 'string' && val.startsWith('[')) {
        try {
          return ['L', ...JSON.parse(val)];
        } catch (e) {
          // Fall through without parsing
        }
      }
    }
    return val;
  }

  /**
   * Helper to return SQL snippet for column definition, using its colId and Grist type.
   */
  private static _columnDef(colId: string, colType: string): string {
    const colSqlType = DocStorage._getSqlType(colType);
    return `${quoteIdent(colId)} ${colSqlType} DEFAULT ${DocStorage._formattedDefault(colType)}`;
  }

  /**
   * As _columnDef(), but column type is strictly Blobs.  Used to maintain an old migration.
   * TODO: could probably rip out the Blob migration and update all related tests.
   */
  private static _columnDefWithBlobs(colId: string, colType: string): string {
    return `${quoteIdent(colId)} BLOB DEFAULT ${DocStorage._formattedDefault(colType)}`;
  }

  /**
   * Based on a Grist type, pick a good Sqlite SQL type name to use.  Sqlite columns
   * are loosely typed, and the types named here are not all distinct in terms of
   * 'affinities', but they are helpful as comments.  Type names chosen from:
   *   https://www.sqlite.org/datatype3.html#affinity_name_examples
   */
  private static _getSqlType(colType: string|null): string {
    switch (colType) {
      case 'Bool':
        return 'BOOLEAN';
      case 'Choice':
      case 'Text':
        return 'TEXT';
      case 'ChoiceList':
      case 'RefList':
      case 'ReferenceList':
      case 'Attachments':
        return 'TEXT';      // To be encoded as a JSON array of strings.
      case 'Date':
        return 'DATE';
      case 'DateTime':
        return 'DATETIME';
      case 'Int':
      case 'Id':
      case 'Ref':
      case 'Reference':
        return 'INTEGER';
      case 'Numeric':
      case 'ManualSortPos':
      case 'PositionNumber':
        return 'NUMERIC';
    }
    if (colType) {
      if (colType.startsWith('Ref:')) {
        return 'INTEGER';
      }
      if (colType.startsWith('RefList:')) {
        return 'TEXT';      // To be encoded as a JSON array of strings.
      }
    }
    return 'BLOB';
  }

  /**
   * For a SQL type, figure out the closest affinity in Sqlite.
   * Only SQL types output by _getSqlType are recognized.
   * Result is one of NUMERIC, INTEGER, TEXT, or BLOB.
   * We don't use REAL, the only remaining affinity.
   */
  private static _getAffinity(colType: string|null): string {
    switch (colType) {
      case 'TEXT':
        return 'TEXT';
      case 'INTEGER':
        return 'INTEGER';
      case 'BOOLEAN':
      case 'DATE':
      case 'DATETIME':
      case 'NUMERIC':
        return 'NUMERIC';
    }
    return 'BLOB';
  }

  // ======================================================================
  // Instance fields
  // ======================================================================

  public docPath: string; // path to document file on disk
  private _db: SQLiteDB|null; // database handle

  // Maintains { tableId: { colId: gristType } } mapping for all tables, including grist metadata
  // tables (obtained from auto-generated schema.js).
  private _docSchema: {[tableId: string]: {[colId: string]: string}};

  private _cachedDataSize: number|null = null;

  public constructor(public storageManager: IDocStorageManager, public docName: string) {
    this.docPath = this.storageManager.getPath(docName);
    this._db = null;
    this._docSchema = Object.assign({}, schema.schema);
  }

  /**
   * Opens an existing SQLite database and prepares it for use.
   */
  public openFile(hooks: MigrationHooks = {}): Promise<void> {
    // It turns out to be important to return a bluebird promise, a lot of code outside
    // of DocStorage ultimately depends on this.
    return bluebird.Promise.resolve(this._openFile(OpenMode.OPEN_EXISTING, hooks))
      .then(() => this._initDB())
      .then(() => this._updateMetadata());
  }

  /**
   * Creates a new SQLite database. Will throw an error if the database already exists.
   * After a database is created it should be initialized by applying the InitNewDoc action
   * or by executing the initialDocSql.
   */
  public createFile(options?: {
    useExisting?: boolean,  // If set, it is ok if an sqlite file already exists
                            // where we would store the Grist document. Its content
                            // will not be touched. Useful when "gristifying" an
                            // existing SQLite DB.
  }): Promise<void> {
    // It turns out to be important to return a bluebird promise, a lot of code outside
    // of DocStorage ultimately depends on this.
    return bluebird.Promise.resolve(this._openFile(
      options?.useExisting ? OpenMode.OPEN_EXISTING : OpenMode.CREATE_EXCL,
      {}))
      .then(() => this._initDB());
    // Note that we don't call _updateMetadata() as there are no metadata tables yet anyway.
  }

  public isInitialized(): boolean {
    return Boolean(this._db);
  }

  /**
   * Initializes the database with proper settings.
   */
  public _initDB(): Promise<void> {
    // Set options for speed across multiple OSes/Filesystems.
    // WAL is fast and safe (guarantees consistency across crashes), but has disadvantages
    // including generating unwanted extra files that can be tricky to deal with in renaming, etc
    // the options for WAL are commented out
    // Setting synchronous to OFF is the fastest method, but is not as safe, and could lead to
    // a database being corrupted if the computer it is running on crashes.
    // TODO: Switch setting to FULL, but don't wait for SQLite transactions to finish before
    // returning responses to the user. Instead send error messages on unexpected errors.
    return this._getDB().exec(
      // "PRAGMA wal_autochceckpoint = 1000;" +
      // "PRAGMA page_size           = 4096;" +
      // "PRAGMA journal_size_limit  = 0;" +
      // "PRAGMA journal_mode        = WAL;" +
      // "PRAGMA auto_vacuum         = 0;" +
      // "PRAGMA synchronous         = NORMAL"
      "PRAGMA synchronous         = OFF;" +
      "PRAGMA trusted_schema      = OFF;"  // mitigation suggested by https://www.sqlite.org/security.html#untrusted_sqlite_database_files
    );
  }

  /**
   * Queries the database for Grist metadata and updates this._docSchema. It extends the auto-
   * generated mapping in app/common/schema.js, to all tables, as `{tableId: {colId: gristType}}`.
   */
  public _updateMetadata(): Promise<void> {
    return this.all('SELECT t.tableId, c.colId, c.type ' +
                    'FROM _grist_Tables_column c JOIN _grist_Tables t ON c.parentId=t.id')
      .then((rows: ResultRow[]) => {
        const s: {[key: string]: any} = {};
        for (const {tableId, colId, type} of rows) {
          const table = s.hasOwnProperty(tableId) ? s[tableId] : (s[tableId] = {});
          table[colId] = type;
        }
        // Note that schema is what's imported from app/common/schema.js
        this._docSchema = Object.assign(s, schema.schema);
      })
      .catch(err => {
        // This replicates previous logic for _updateMetadata.
        // It matches errors from node-sqlite3 and better-sqlite3
        if (err.message.startsWith('SQLITE_ERROR: no such table') ||
          err.message.startsWith('no such table:')) {
          err.message = `NO_METADATA_ERROR: ${this.docName} has no metadata`;
          if (!err.cause) { err.cause = {}; }
          err.cause.code = 'NO_METADATA_ERROR';
        }
        throw err;
      });
  }

  /**
   * Closes the SQLite database.
   */
  public async shutdown(): Promise<void> {
    if (!this._db) {
      log.debug('DocStorage shutdown (trivial) success');
      return;
    }
    const db = this._getDB();
    this._db = null;
    await db.close();
    log.debug('DocStorage shutdown success');
  }


  /**
   * Attaches the file to the document.
   *
   * TODO: This currently does not make the attachment available to the sandbox code. This is likely
   * to be needed in the future, and a suitable API will need to be provided. Note that large blobs
   * would be (very?) inefficient until node-sqlite3 adds support for incremental reading from a
   * blob: https://github.com/mapbox/node-sqlite3/issues/424.
   *
   * @param {String} sourcePath: The path of the file containing the attachment data.
   * @param {String} fileIdent: The unique identifier of the file in the database. ActiveDoc uses the
   *    checksum of the file's contents with the original extension.
   * @returns {Promise[Boolean]} True if the file got attached; false if this ident already exists.
   */
  public findOrAttachFile(sourcePath: string, fileIdent: string): Promise<boolean> {
    return this.execTransaction(db => {
      // Try to insert a new record with the given ident. It'll fail UNIQUE constraint if exists.
      return db.run('INSERT INTO _gristsys_Files (ident) VALUES (?)', fileIdent)
      // Only if this succeeded, do the work of reading the file and inserting its data.
        .then(() => fse.readFile(sourcePath))
        .then(data =>
              db.run('UPDATE _gristsys_Files SET data=? WHERE ident=?', data, fileIdent))
        .then(() => true)
      // If UNIQUE constraint failed, this ident must already exists, so return false.
        .catch(err => {
          if (/^(SQLITE_CONSTRAINT: )?UNIQUE constraint failed/.test(err.message)) {
            return false;
          }
          throw err;
        });
    });
  }

  /**
   * Reads and returns the data for the given attachment.
   * @param {String} fileIdent: The unique identifier of a file, as used by findOrAttachFile.
   * @returns {Promise[Buffer]} The data buffer associated with fileIdent.
   */
  public getFileData(fileIdent: string): Promise<Buffer> {
    return this.get('SELECT data FROM _gristsys_Files WHERE ident=?', fileIdent)
      .then(row => row && row.data);
  }


  /**
   * Fetches the given table from the database. See fetchQuery() for return value.
   */
  public fetchTable(tableId: string): Promise<Buffer> {
    return this.fetchQuery({tableId, filters: {}});
  }

  /**
   * Returns as a number the next row id for the given table.
   */
  public async getNextRowId(tableId: string): Promise<number> {
    const colData = await this.get(`SELECT MAX(id) as maxId FROM ${quoteIdent(tableId)}`);
    if (!colData) {
      throw new Error(`Error in DocStorage.getNextRowId: no table ${tableId}`);
    }
    return colData.maxId ? colData.maxId + 1 : 1;
  }

  /**
   * Look up Grist type of column.
   */
  public getColumnType(tableId: string, colId: string): string|undefined {
    return this._docSchema[tableId]?.[colId];
  }

  /**
   * Fetches all rows of the table with the given rowIds.
   */
  public async fetchActionData(tableId: string, rowIds: number[], colIds?: string[]): Promise<TableDataAction> {
    const colSpec = colIds ? ['id', ...colIds].map((c) => quoteIdent(c)).join(', ') : '*';
    let fullValues: TableColValues|undefined;

    // There is a limit to the number of arguments that may be passed in, so fetch data in chunks.
    for (const rowIdChunk of chunk(rowIds, maxSQLiteVariables)) {
      const sqlArg = rowIdChunk.map(() => '?').join(',');
      const marshalled: Buffer = await this._getDB().allMarshal(
        `SELECT ${colSpec} FROM ${quoteIdent(tableId)} WHERE id IN (${sqlArg})`, rowIdChunk);

      const colValues: TableColValues = this.decodeMarshalledData(marshalled, tableId);
      if (!fullValues) {
        fullValues = colValues;
      } else {
        for (const col of Object.keys(colValues)) {
          fullValues[col].push(...colValues[col]);
        }
      }
    }
    return toTableDataAction(tableId, fullValues || {id: []});    // Return empty TableColValues if rowIds was empty.
  }

  /**
   * Fetches a subset of the data specified by the given query, and returns an encoded TableData
   * object, which is a marshalled dict mapping column ids (including 'id') to arrays of values.
   *
   * This now essentially subsumes the old fetchTable() method.
   * Note that text is marshalled as unicode and blobs as binary strings (used to be binary strings
   * for both before 2017-11-09). This allows blobs to be used exclusively for encoding types that
   * are not easily stored as sqlite's native types.
   */
  public async fetchQuery(query: ExpandedQuery): Promise<Buffer> {
    // Check if there are a lot of parameters, and if so, switch to a method that can support
    // that.
    const totalParameters = Object.values(query.filters).map(vs => vs.length).reduce((a, b) => a + b, 0);
    if (totalParameters > maxSQLiteVariables) {
      // Fall back on using temporary tables if there are many parameters.
      return this._fetchQueryWithManyParameters(query);
    }

    // Convert query to SQL.
    const params: any[] = [];
    let whereParts: string[] = [];
    for (const colId of Object.keys(query.filters)) {
      const values = query.filters[colId];
      // If values is empty, "IN ()" works in SQLite (always false), but wouldn't work in Postgres.
      whereParts.push(`${quoteIdent(query.tableId)}.${quoteIdent(colId)} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    }
    whereParts = whereParts.concat(query.wheres ?? []);
    const sql = this._getSqlForQuery(query, whereParts);
    return this._getDB().allMarshal(sql, ...params);
  }

  /**
   * Fetches and returns the names of all tables in the database (including _gristsys_ tables).
   */
  public async getAllTableNames(): Promise<string[]> {
    const rows = await this.all("SELECT name FROM sqlite_master WHERE type='table'");
    return rows.map(row => row.name);
  }

  /**
   * Unmarshals and decodes data received from db.allMarshal() method (which we added to node-sqlite3).
   * The data is a dictionary mapping column ids (including 'id') to arrays of values. This should
   * be used for Grist data, which is encoded. For non-Grist data, use `marshal.loads()`.
   *
   * Note that we do NOT use this when loading data from a document, since the whole point of
   * db.allMarshal() is to pass data directly to Python data engine without parsing in Node.
   */
  public decodeMarshalledData(marshalledData: Buffer | Uint8Array, tableId: string): TableColValues {
    const columnValues: TableColValues = marshal.loads(marshalledData);
    // Decode in-place to avoid unnecessary array creation.
    for (const col of Object.keys(columnValues)) {
      const type = this._getGristType(tableId, col);
      const column = columnValues[col];
      for (let i = 0; i < column.length; i++) {
        column[i] = DocStorage._decodeValue(column[i], type, DocStorage._getSqlType(type));
      }
    }
    return columnValues;
  }

  /**
   * Variant of `decodeMarshalledData` that supports decoding data containing columns from
   * multiple tables.
   *
   * Expects all column names in `marshalledData` to be prefixed with the table id and a
   * trailing period (separator).
   */
  public decodeMarshalledDataFromTables(marshalledData: Buffer | Uint8Array): BulkColValues {
    const columnValues: BulkColValues = marshal.loads(marshalledData);
    // Decode in-place to avoid unnecessary array creation.
    for (const col of Object.keys(columnValues)) {
      const [tableId, colId] = col.split('.');
      const type = this._getGristType(tableId, colId);
      const column = columnValues[col];
      for (let i = 0; i < column.length; i++) {
        column[i] = DocStorage._decodeValue(column[i], type, DocStorage._getSqlType(type));
      }
    }
    return columnValues;
  }

  /**
   * Applies stored actions received from data engine to the database by converting them to SQL
   * statements and executing a serialized transaction.
   * @param {Array[DocAction]} docActions - Array of doc actions from DataEngine.
   * @returns {Promise} - An empty promise, resolved if successfully committed to db.
   */
  public async applyStoredActions(docActions: DocAction[]): Promise<void> {
    debuglog('DocStorage.applyStoredActions');

    docActions = this._compressStoredActions(docActions);
    for (const action of docActions) {
      try {
        await this.applyStoredAction(action);
      } catch (e) {
        // If the table doesn't have a manualSort column, we'll try
        // again without setting manualSort. This should never happen
        // for regular Grist documents, but could happen for a
        // "gristified" Sqlite database where we are choosing to
        // leave the user tables untouched. The manualSort column doesn't
        // make much sense outside the context of spreadsheets.
        // TODO: it could be useful to make Grist more inherently aware of
        // and tolerant of tables without manual sorting.
        if (String(e).match(/no column named manualSort/)) {
          const modifiedAction = this._considerWithoutManualSort(action);
          if (modifiedAction) {
            await this.applyStoredAction(modifiedAction);
            return;
          }
        }
        throw e;
      }
    }
  }

  // Apply a single stored action, dispatching to an appropriate
  // _process_<ActionType> handler.
  public async applyStoredAction(action: DocAction): Promise<void> {
    const actionType = action[0];
    const f = (this as any)["_process_" + actionType];
    if (!_.isFunction(f)) {
      log.error("Unknown action: " + actionType);
    } else {
      await f.apply(this, action.slice(1));
      const tableId = action[1]; // The first argument is always tableId;
      if (DocStorage._isMetadataTable(tableId) && actionType !== 'AddTable') {
        // We only need to update the metadata for actions that change
        // the metadata. We don't update on AddTable actions
        // because the additional of a table gives no additional data
        // and if we tried to update when only _grist_Tables was added
        // without _grist_Tables_column, we would get an error
        await this._updateMetadata();
      }
    }
  }

  /**
   * Internal helper to process AddTable action.
   *
   * @param {String} tableId - Table ID.
   * @param {Array[Object]} columns - List of column objects with schema attributes.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_AddTable(tableId: string, columns: any[]): Promise<void> {
    const colSpecSql =
      DocStorage._prefixJoin(', ',
                             columns.map(c => DocStorage._columnDef(c.id, c.type)));

    // Every table needs an "id" column, and it should be an "integer primary key" type so that it
    // serves as the alias for the SQLite built-in "rowid" column. See
    // https://www.sqlite.org/lang_createtable.html#rowid for details.
    const sql = `CREATE TABLE ${quoteIdent(tableId)} (id INTEGER PRIMARY KEY${colSpecSql})`;
    log.debug('AddTable SQL : ' + sql);

    return this.exec(sql);
  }

  /**
   * Internal helper to process UpdateRecord action.
   *
   * @param {String} tableId - Table Id.
   * @param {String} rowId - Row Id.
   * @param {Object} columnValues - Column object with keys as column names.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_UpdateRecord(tableId: string, rowId: string, columnValues: any): Promise<void> {
    // Do some small preprocessing to make this look like a BulkUpdateRecord
    return this._process_BulkUpdateRecord(tableId, [rowId], _.mapObject(columnValues, (val: any) => [val]));
  }

  /**
   * Internal helper to process AddRecord action.
   *
   * @param {String} tableId - Table ID.
   * @param {Integer} rowId - Row ID.
   * @param {Object} columnValues - Column object with keys as column names.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_AddRecord(tableId: string, rowId: number, columnValues: any): Promise<void> {
    // Do some small preprocessing to make this look like a BulkAddRecord
    return this._process_BulkAddRecord(tableId, [rowId], _.mapObject(columnValues, (val: any) => [val]));
  }

  /**
   * Internal helper to process BulkUpdateRecord action.
   *
   * @param {String} tableId - Table Id.
   * @param {Array[String]} rowIds - List of Row Ids.
   * @param {Object} columnValues - Column object with keys as column names and arrays of values.
   * @returns {Promise} - Promise for SQL execution.
   */
  public _process_BulkUpdateRecord(tableId: string, rowIds: string[], columnValues: any): Promise<void> {
    const cols = Object.keys(columnValues);
    if (!rowIds.length || !cols.length) { return Promise.resolve(); }  // Nothing to do.

    const colListSql = cols.map(c => quoteIdent(c) + '=?').join(', ');
    const sql = `UPDATE ${quoteIdent(tableId)} SET ${colListSql} WHERE id=?`;

    const types = cols.map(c => this._getGristType(tableId, c));
    const sqlParams = DocStorage._encodeColumnsToRows(types, cols.map(c => columnValues[c]).concat([rowIds]));

    debuglog("DocStorage._maybeBulkUpdateRecord SQL: %s (%s rows)", sql, sqlParams.length);
    return this._applyMaybeBulkUpdateOrAddSql(sql, sqlParams);
  }

  /**
   * Internal helper to process BulkAddRecord action.
   *
   * @param {String} tableId - Table ID.
   * @param {Array[Integer]} rowIds - Array of row IDs to be inserted.
   * @param {Array[Object]} columnValues - Array of column info objects.
   * @returns {Promise} - Promise for SQL execution.
   */
  public _process_BulkAddRecord(tableId: string, rowIds: number[], columnValues: {[key: string]: any}): Promise<void> {
    if (rowIds.length === 0) { return Promise.resolve(); } // no rows means nothing to do

    const cols = Object.keys(columnValues);
    const colListSql = cols.map(c => quoteIdent(c) + ', ').join('');
    const placeholders = cols.map(c => '?, ').join('');
    const sql = `INSERT INTO ${quoteIdent(tableId)} (${colListSql}id) VALUES (${placeholders}?)`;

    const types = cols.map(c => this._getGristType(tableId, c));
    const sqlParams =
      DocStorage._encodeColumnsToRows(types,
                                      cols.map(c => columnValues[c]).concat([rowIds]));

    debuglog("DocStorage._maybeBulkAddRecord SQL: %s (%s rows)", sql, sqlParams.length);
    return this._applyMaybeBulkUpdateOrAddSql(sql, sqlParams);
  }

  /**
   * Internal helper to process RemoveRecord action.
   *
   * @param {String} tableId - Table ID.
   * @param {String} rowId   - Row ID.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_RemoveRecord(tableId: string, rowId: string): Promise<RunResult> {
    const sql = "DELETE FROM " + quoteIdent(tableId) + " WHERE id=?";
    debuglog("RemoveRecord SQL: " + sql, [rowId]);
    return this.run(sql, rowId);
  }


  /**
   * Internal helper to process ReplaceTableData action. It is identical to BulkAddRecord, but
   * deletes all data from the table first.
   */
  public _process_ReplaceTableData(tableId: string, rowIds: number[], columnValues: any[]): Promise<void> {
    return this.exec("DELETE FROM " + quoteIdent(tableId))
      .then(() => this._process_BulkAddRecord(tableId, rowIds, columnValues));
  }

  /**
   * Internal helper to process BulkRemoveRecord action.
   *
   * @param {String} tableId        - Table ID.
   * @param {Array[Integer]} rowIds - Array of row IDs to be deleted.
   * @returns {Promise} - Promise for SQL execution.
   */
  public async _process_BulkRemoveRecord(tableId: string, rowIds: number[]): Promise<void> {
    if (rowIds.length === 0) { return; }// If we have nothing to remove, done.

    const chunkSize = 10;
    const preSql = "DELETE FROM " + quoteIdent(tableId) + " WHERE id IN (";
    const postSql = ")";
    const q = _.constant('?');
    const chunkParams = _.range(chunkSize).map(q).join(',');
    const numChunks = Math.floor(rowIds.length / chunkSize);
    const numLeftovers = rowIds.length % chunkSize;

    if (numChunks > 0) {
      debuglog("DocStorage.BulkRemoveRecord: splitting " + rowIds.length +
               " deletes into chunks of size " + chunkSize);
      const stmt = await this.prepare(preSql + chunkParams + postSql);
      for (const index of _.range(0, numChunks * chunkSize, chunkSize)) {
        debuglog("DocStorage.BulkRemoveRecord: chunk delete " + index + "-" + (index + chunkSize - 1));
        await stmt.run(...rowIds.slice(index, index + chunkSize));
      }
      await stmt.finalize();
    }

    if (numLeftovers > 0) {
      debuglog("DocStorage.BulkRemoveRecord: leftover delete " + (numChunks * chunkSize) + "-" + (rowIds.length - 1));
      const leftoverParams = _.range(numLeftovers).map(q).join(',');
      await this.run(preSql + leftoverParams + postSql,
                     ...rowIds.slice(numChunks * chunkSize, rowIds.length));
    }
  }

  /**
   * Internal helper to process AddColumn action.
   *
   * @param {String} tableId - Table Id.
   * @param {String} colId - Column Id.
   * @param {Object} colInfo - Column info object.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public async _process_AddColumn(tableId: string, colId: string, colInfo: any): Promise<void> {
    await this.exec(
      `ALTER TABLE ${quoteIdent(tableId)} ADD COLUMN ${DocStorage._columnDef(colId, colInfo.type)}`);
  }

  /**
   * Internal helper to process RenameColumn action.
   *
   * @param {String} tableId - Table ID.
   * @param {String} fromColId - Column ID to rename.
   * @param {String} toColId - New Column ID.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public async _process_RenameColumn(tableId: string, fromColId: string, toColId: string): Promise<void> {
    if (fromColId === 'id' || fromColId === 'manualSort' || tableId.startsWith('_grist')) {
      throw new Error('Cannot rename internal Grist column');
    }
    await this.exec(
      `ALTER TABLE ${quoteIdent(tableId)} RENAME COLUMN ${quoteIdent(fromColId)} TO ${quoteIdent(toColId)}`);
  }

  /**
   * Internal helper to process ModifyColumn action.
   *
   * Note that this requires access to the _grist_ tables, unlike many of the other actions.
   *
   * @param {String} tableId - Table ID.
   * @param {String} colId   - Column ID.
   * @param {Object} colInfo - Column info object.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public async _process_ModifyColumn(tableId: string, colId: string, colInfo: any): Promise<void> {
    if (!colInfo) {
      log.error("ModifyColumn action called without params.");
      return;
    }
    return this._alterColumn(tableId, colId, colId, colInfo.type);
  }


  /**
   * Internal helper to process RemoveColumn action.
   *
   * @param {String} tableId - Table ID.
   * @param {String} colId   - Column ID to rename.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_RemoveColumn(tableId: string, colId: string): Promise<void> {
    const quote = quoteIdent;
    const tmpTableId = DocStorage._makeTmpTableId(tableId);

    // Note that SQLite does not support easily dropping columns. To drop a column from a table, we
    // need to follow the instructions at https://sqlite.org/lang_altertable.html Since we don't use
    // indexes or triggers, we skip a few steps.
    // TODO: SQLite has since added support for ALTER TABLE DROP COLUMN, should
    // use that to be more efficient and less disruptive.

    // This returns rows with (at least) {name, type, dflt_value}.
    return this.all(`PRAGMA table_info(${quote(tableId)})`)
      .then(infoRows => {
        const newInfoRows = infoRows.filter(row => (row.name !== colId && row.name !== 'id'));
        if (newInfoRows.length === infoRows.length) {
          // Column was not found. That's ok, and happens when deleting formula column.
          return;
        }
        const colListSql = DocStorage._prefixJoin(', ', newInfoRows.map(info => quote(info.name)));
        const colSpecSql = DocStorage._prefixJoin(', ', newInfoRows.map(DocStorage._sqlColSpecFromDBInfo));
        return this._getDB().runEach(
          `CREATE TABLE ${quote(tmpTableId)} (id INTEGER PRIMARY KEY${colSpecSql})`,
          `INSERT INTO ${quote(tmpTableId)} SELECT id${colListSql} FROM ${quote(tableId)}`,
          `DROP TABLE ${quote(tableId)}`,
          `ALTER TABLE ${quote(tmpTableId)} RENAME TO ${quote(tableId)}`
        );
      });
  }


  /**
   * Internal helper to process RenameTable action.
   *
   * @param {string} fromTableId - Old table id
   * @param {string}   toTableId - New table id
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_RenameTable(fromTableId: string, toTableId: string): Promise<void> {
    const sql: string[] = [];

    if (fromTableId === toTableId) {
      return Promise.resolve();
    } else if (fromTableId.toLowerCase() === toTableId.toLowerCase()) {
      const tmpTableId = DocStorage._makeTmpTableId(fromTableId);
      sql.push("ALTER TABLE " + quoteIdent(fromTableId) +
               " RENAME TO " + quoteIdent(tmpTableId));
      fromTableId = tmpTableId;
    }

    sql.push("ALTER TABLE " + quoteIdent(fromTableId) +
             " RENAME TO "  + quoteIdent(toTableId));

    log.debug("RenameTable SQL: " + sql);
    return bluebird.Promise.each(sql, (stmt: string) => this.exec(stmt));
  }

  /**
   * Internal helper to process RemoveTable action.
   *
   * @param {String} tableId - Table ID.
   * @returns {Promise} - A promise for the SQL execution.
   */
  public _process_RemoveTable(tableId: string): Promise<void> {
    const sql = "DROP TABLE " + quoteIdent(tableId);

    log.debug("RemoveTable SQL: " + sql);

    return this.exec(sql);
  }

  public renameDocTo(newName: string): Promise<void> {
    log.debug('DocStorage.renameDocTo: %s -> %s', this.docName, newName);
    return this.shutdown()
      .then(() => this.storageManager.renameDoc(this.docName, newName))
      .catch(err => {
        log.error("DocStorage: renameDocTo %s -> %s failed: %s", this.docName, newName, err.message);
        return this.openFile()
          .then(function() {
            throw err;
          });
      })
        .then(() => {
          this.docName = newName;
          this.docPath = this.storageManager.getPath(newName);
          return this.openFile();
        });
  }

  /**
   * Returns the total number of bytes used for storing attachments that haven't been soft-deleted.
   * May be stale if ActiveDoc.updateUsedAttachmentsIfNeeded isn't called first.
   */
  public async getTotalAttachmentFileSizes(): Promise<number> {
    const result = await this.get(`
      SELECT SUM(len) AS total
      FROM (
        -- Using MAX(LENGTH()) instead of just LENGTH() is needed in the presence of GROUP BY
        -- to make LENGTH() quickly read the stored length instead of actually reading the blob data.
        -- We use LENGTH() in the first place instead of _grist_Attachments.fileSize because the latter can
        -- be changed by users.
        SELECT MAX(LENGTH(files.data)) AS len
        FROM _gristsys_Files AS files
          JOIN _grist_Attachments AS meta
            ON meta.fileIdent = files.ident
        WHERE meta.timeDeleted IS NULL  -- Don't count soft-deleted attachments
        -- Duplicate attachments (i.e. identical file contents) are only stored once in _gristsys_Files
        -- but can be duplicated in _grist_Attachments, so the GROUP BY prevents adding up duplicated sizes.
        GROUP BY meta.fileIdent
      )
    `);
    return result!.total ?? 0;
  }

  /**
   * Returns an array of objects where:
   *   - `id` is a row ID of _grist_Attachments
   *   - `used` is true if and only if `id` is in a list in a cell of type Attachments
   *   - The value of `timeDeleted` in this row of _grist_Attachments needs to be updated
   *     because its truthiness doesn't match `used`, i.e. either:
   *       - a used attachment is marked as deleted, OR
   *       - an unused attachment is not marked as deleted
   */
  public async scanAttachmentsForUsageChanges(): Promise<{ used: boolean, id: number }[]> {
    // Array of SQL queries where attachment_ids contains JSON arrays (typically containg row IDs).
    // Below we add one query for each column of type Attachments in the document.
    // We always include this first dummy query because if the array is empty then the final SQL query
    // will just have `()` causing a syntax error.
    // We can't just return when there are no Attachments columns
    // because we may still need to delete all remaining attachments.
    const attachmentsQueries = ["SELECT '[0]' AS attachment_ids"];
    for (const [tableId, cols] of Object.entries(this._docSchema)) {
      for (const [colId, type] of Object.entries(cols)) {
        if (type === "Attachments") {
          attachmentsQueries.push(`
            SELECT t.${quoteIdent(colId)} AS attachment_ids
            FROM ${quoteIdent(tableId)} AS t
            WHERE json_valid(attachment_ids)
          `);
        }
      }
    }

    // `UNION ALL` instead of `UNION` because duplicate values are unlikely and deduplicating is not worth the cost
    const allAttachmentsQuery = attachmentsQueries.join(' UNION ALL ');

    const sql = `
      WITH all_attachment_ids(id) AS (
        SELECT json_each.value AS id
        FROM json_each(attachment_ids), (${allAttachmentsQuery})
      )  -- flatten out all the lists of IDs into a simple column of IDs
      SELECT id, id IN all_attachment_ids AS used
      FROM _grist_Attachments
      WHERE used != (timeDeleted IS NULL);  -- only include rows that need updating
    `;
    return (await this.all(sql)) as any[];
  }

  /**
   * Collect all cells that refer to a particular attachment. Ideally this is
   * something we could use an index for. Regular indexes in SQLite don't help.
   * FTS5 works, but is somewhat overkill.
   */
  public async findAttachmentReferences(attId: number): Promise<Array<SingleCell>> {
    const queries: string[] = [];
    // Switch quotes so to insert a table or column name as a string literal
    // rather than as an identifier.
    function asLiteral(name: string) {
      return quoteIdent(name).replace(/"/g, '\'');
    }
    for (const [tableId, cols] of Object.entries(this._docSchema)) {
      for (const [colId, type] of Object.entries(cols)) {
        if (type !== "Attachments") { continue; }
        queries.push(`SELECT
          t.id as rowId,
          ${asLiteral(tableId)} as tableId,
          ${asLiteral(colId)} as colId
        FROM ${quoteIdent(tableId)} AS t, json_each(t.${quoteIdent(colId)}) as a
        WHERE a.value = ${attId}`);
      }
    }
    return (await this.all(queries.join(' UNION ALL '))) as any[];
  }

  /**
   * Return row IDs of unused attachments in _grist_Attachments.
   * Uses the timeDeleted column which is updated in ActiveDoc.updateUsedAttachmentsIfNeeded.
   * @param expiredOnly: if true, only return attachments where timeDeleted is at least
   *                     ATTACHMENTS_EXPIRY_DAYS days ago.
   */
  public async getSoftDeletedAttachmentIds(expiredOnly: boolean): Promise<number[]> {
    const condition = expiredOnly
      ? `datetime(timeDeleted, 'unixepoch') < datetime('now', '-${ATTACHMENTS_EXPIRY_DAYS} days')`
      : "timeDeleted IS NOT NULL";

    const rows = await this.all(`
      SELECT id
      FROM _grist_Attachments
      WHERE ${condition}
    `);
    return rows.map(r => r.id);
  }

  /**
   * Delete attachments from _gristsys_Files that have no matching metadata row in _grist_Attachments.
   */
  public async removeUnusedAttachments() {
    const result = await this._getDB().run(`
      DELETE FROM _gristsys_Files
      WHERE ident IN (
        SELECT ident
        FROM _gristsys_Files
        LEFT JOIN _grist_Attachments
        ON fileIdent = ident
        WHERE fileIdent IS NULL
      )
    `);
    if (result.changes > 0) {
      await this._markAsChanged(Promise.resolve());
    }
  }

  public interrupt(): Promise<void> {
    return this._getDB().interrupt();
  }

  public getOptions(): MinDBOptions|undefined {
    return this._getDB().getOptions();
  }

  public all(sql: string, ...args: any[]): Promise<ResultRow[]> {
    return this._getDB().all(sql, ...args);
  }

  public run(sql: string, ...args: any[]): Promise<RunResult> {
    return this._markAsChanged(this._getDB().run(sql, ...args));
  }

  public exec(sql: string): Promise<void> {
    return this._markAsChanged(this._getDB().exec(sql));
  }

  public prepare(sql: string): Promise<PreparedStatement> {
    return this._getDB().prepare(sql);
  }

  public get(sql: string, ...args: any[]): Promise<ResultRow|undefined> {
    return this._getDB().get(sql, ...args);
  }

  public execTransaction<T>(transx: (db1: SQLiteDB) => Promise<T>): Promise<T> {
    const db = this._getDB();
    return this._markAsChanged(db.execTransaction(() => transx(db)));
  }

  public runAndGetId(sql: string, ...params: any[]): Promise<number> {
    const db = this._getDB();
    return this._markAsChanged(db.runAndGetId(sql, ...params));
  }

  public requestVacuum(): Promise<boolean> {
    const db = this._getDB();
    return this._markAsChanged(db.requestVacuum());
  }

  public async getPluginDataItem(pluginId: string, key: string): Promise<any> {
    const row = await this.get('SELECT value from _gristsys_PluginData WHERE pluginId = ? and key = ?', pluginId, key);
    if (row) {
      return row.value;
    }
    return undefined;
  }

  public async hasPluginDataItem(pluginId: string, key: string): Promise<any> {
    const row = await this.get('SELECT value from _gristsys_PluginData WHERE pluginId=? and key=?', pluginId, key);
    return typeof row !== 'undefined';
  }

  public async setPluginDataItem(pluginId: string, key: string, value: string): Promise<void> {
    await this.run('INSERT OR REPLACE into _gristsys_PluginData (pluginId, key, value) values (?, ?, ?)',
      pluginId, key, value);
  }

  public async removePluginDataItem(pluginId: string, key: string): Promise<void> {
    await this.run('DELETE from _gristsys_PluginData where pluginId = ? and key = ?', pluginId, key);
  }

  public async clearPluginDataItem(pluginId: string): Promise<void> {
    await this.run('DELETE from _gristsys_PluginData where pluginId = ?', pluginId);
  }

  /**
   * Get a list of indexes.  For use in tests.
   */
  public async testGetIndexes(): Promise<IndexInfo[]> {
    return this._getIndexes();
  }

  /**
   * Create the specified indexes if they don't already exist.  Remove indexes we
   * created in the past that are not listed (leaving other indexes untouched).
   */
  public async updateIndexes(desiredIndexes: IndexColumns[]) {
    // Find all indexes on user tables.
    const indexes = await this._getIndexes();
    // Keep track of indexes prior to calling this method and after the call to this method
    // as two sets of "tableId.colId" strings.
    const pre = new Set<string>(indexes.map(index => `${index.tableId}.${index.colId}`));
    const post = new Set<string>();
    for (const index of desiredIndexes) {
      const idx = `${index.tableId}.${index.colId}`;
      if (!pre.has(idx)) {
        const name = `auto_index_${uuidv4().replace(/-/g, '_')}`;
        log.debug(`DocStorage.updateIndexes: doc ${this.docName} adding index ${name} for ` +
                  `table ${index.tableId}, column ${index.colId}`);
        await this.exec(`CREATE INDEX ${name} ON ${quoteIdent(index.tableId)}(${quoteIdent(index.colId)})`);
        log.debug(`DocStorage.updateIndexes: doc ${this.docName} added index ${name} for ` +
                  `table ${index.tableId}, column ${index.colId}`);
      }
      post.add(idx);
    }
    for (const index of indexes) {
      const idx = `${index.tableId}.${index.colId}`;
      if (!post.has(idx) && index.indexId.startsWith('auto_index_')) {
        log.debug(`DocStorage.updateIndexes: doc ${this.docName} dropping index ${index.indexId} for ` +
                  `table ${index.tableId}, column ${index.colId}`);
        await this.exec(`DROP INDEX ${index.indexId}`);
        log.debug(`DocStorage.updateIndexes: doc ${this.docName} dropped index ${index.indexId} for ` +
                  `table ${index.tableId}, column ${index.colId}`);
      }
    }
  }

  /**
   * Return the total size of data in the user + meta tables of the SQLite doc (excluding gristsys
   * tables). Uses cached results if possible. Any change to data invalidates the cache, via
   * _markAsChanged().
   */
  public async getDataSize(): Promise<number> {
    return this._cachedDataSize ?? (this._cachedDataSize = await this.getDataSizeUncached());
  }

  /**
   * Measure and return the total size of data in the user + meta tables of the SQLite doc
   * (excluding gristsys tables). Note that this operation involves reading the entire database.
   */
  public async getDataSizeUncached(): Promise<number> {
    const result = await this.get(`
      SELECT SUM(pgsize - unused) AS totalSize
      FROM dbstat
      WHERE NOT (
        name LIKE 'sqlite_%' OR
        name LIKE '_gristsys_%'
      );
    `).catch(e => {
      if (String(e).match(/no such table: dbstat/)) {
        // We are using a version of SQLite that doesn't have
        // dbstat compiled in. But it would be sad to disable
        // Grist entirely just because we can't track byte-count.
        // So return NaN in this case.
        return {totalSize: NaN};
      }
      throw e;
    });
    return result!.totalSize;
  }

  private async _markAsChanged<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } finally {
      this._cachedDataSize = null;
      this.storageManager.markAsChanged(this.docName);
    }
  }

  /**
   * Creates a new or opens an existing SQLite database, depending on mode.
   * @return {Promise<number>} Promise for user_version stored in the database.
   */
  private async _openFile(mode: number, hooks: MigrationHooks): Promise<number> {
    try {
      this._db = await SQLiteDB.openDB(this.docPath, DocStorage.docStorageSchema, mode, hooks);
      log.debug("DB %s open successfully", this.docName);
      return this._db.getMigrationVersion();
    } catch (err) {
      log.debug("DB %s open error: %s", this.docName, err);
      throw err;
    }
  }

  /**
   * Internal helper for applying Bulk Update or Add Record sql
   */
  private async _applyMaybeBulkUpdateOrAddSql(sql: string, sqlParams: any[][]): Promise<void> {
    if (sqlParams.length === 1) {
      await this.run(sql, ...sqlParams[0]);
    } else {
      const stmt = await this.prepare(sql);
      for (const param of sqlParams) {
        await stmt.run(...param);
      }
      await stmt.finalize();
    }
  }

  /**
   * Read SQLite's metadata for tableId, and generate SQL for the altered version of the table.
   * @param {string} colId: Existing colId to change or delete. We'll return null if it's missing.
   * @param {string} newColId: New colId.
   * @param {string|null} newColType: New grist type, or null to keep unchanged.
   * @return {Promise<string|null>} New table SQL, or null when nothing changed or colId is missing.
   */
  private async _rebuildTableSql(tableId: string, colId: string, newColId: string,
                                 newColType: string|null = null): Promise<RebuildResult|null> {
    // This returns rows with (at least) {name, type, dflt_value}.
    assert(newColId, 'newColId required');
    let infoRows = await this.all(`PRAGMA table_info(${quoteIdent(tableId)})`);

    // Skip "id" column, and find the column we are modifying.
    infoRows = infoRows.filter(row => (row.name !== 'id'));
    const colInfo = infoRows.find(info => (info.name === colId));
    if (!colInfo) {
      return null;      // Column not found.
    }
    const oldGristType = this._getGristType(tableId, colId);
    const oldSqlType = colInfo.type || 'BLOB';
    const oldDefault = fixDefault(colInfo.dflt_value);
    const newSqlType = newColType ? DocStorage._getSqlType(newColType) : oldSqlType;
    const newDefault = fixDefault(newColType ? DocStorage._formattedDefault(newColType) : oldDefault);
    const newInfo = {name: newColId, type: newSqlType, dflt_value: newDefault};
    // Check if anything actually changed, and only rebuild the table then.
    if (Object.keys(newInfo).every(p => ((newInfo as any)[p] === colInfo[p]))) {
      return null;      // No changes.
    }
    Object.assign(colInfo, newInfo);
    const colSpecSql = DocStorage._prefixJoin(', ', infoRows.map(DocStorage._sqlColSpecFromDBInfo));
    return {
      sql: `CREATE TABLE ${quoteIdent(tableId)} (id INTEGER PRIMARY KEY${colSpecSql})`,
      oldGristType,
      newGristType: newColType || oldGristType,
      oldDefault,
      newDefault,
      oldSqlType,
      newSqlType,
    };
  }

  /**
   * Helper to alter a table to new table SQL, which is appropriate for renaming columns, or
   * changing default values for a column, i.e. changes that don't affect on-disk content in any
   * way. See https://sqlite.org/lang_altertable.html.
   */
  private async _alterTableSoft(tableId: string, newTableSql: string): Promise<void> {
    // Procedure according to https://sqlite.org/lang_altertable.html: "appropriate for ... renaming
    // columns, or adding or removing or changing default values on a column."
    const row = await this.get("PRAGMA schema_version");
    assert(row && row.schema_version, "Could not retrieve schema_version.");
    const newSchemaVersion = row.schema_version + 1;
    const tmpTableId = DocStorage._makeTmpTableId(tableId);
    await this._getDB().runEach(
      "PRAGMA writable_schema=ON",
      ["UPDATE sqlite_master SET sql=? WHERE type='table' and name=?", [newTableSql, tableId]],
      `PRAGMA schema_version=${newSchemaVersion}`,
      "PRAGMA writable_schema=OFF",
      // The following are not in the instructions, but are needed for SQLite to notice the
      // changes for subsequent queries.
      `ALTER TABLE ${quoteIdent(tableId)} RENAME TO ${quoteIdent(tmpTableId)}`,
      `ALTER TABLE ${quoteIdent(tmpTableId)} RENAME TO ${quoteIdent(tableId)}`
    );
  }

  private async _alterColumn(tableId: string, colId: string, newColId: string,
                             newColType: string|null = null): Promise<void> {
    const result = await this._rebuildTableSql(tableId, colId, newColId, newColType);
    if (result) {
      const q = quoteIdent;
      if (result.oldDefault !== result.newDefault) {
        // This isn't strictly necessary, but addresses a SQLite quirk that breaks our tests
        // (although likely unnoticeable in practice): an added column has "holes" for existing
        // records that show up as the default value but don't actually store that default. When
        // we do the soft-alter here, those values reflect the new default, i.e. change
        // unexpectedly. Setting the default values explicitly prevents this unexpected change.
        const dflt = result.oldDefault;
        // (Note that comparison below must use "IS" rather than "=" to work for NULLs.)
        await this.exec(`UPDATE ${q(tableId)} SET ${q(colId)}=${dflt} WHERE ${q(colId)} IS ${dflt}`);
      }
      await this._alterTableSoft(tableId, result.sql);

      // For any marshalled objects, check if we can now unmarshall them if they are the
      // native type.
      if (result.newGristType !== result.oldGristType || result.newSqlType !== result.oldSqlType) {
        const cells = await this.all(`SELECT id, ${q(colId)} as value FROM ${q(tableId)} ` +
                                     `WHERE typeof(${q(colId)}) = 'blob'`);
        const marshaller = new marshal.Marshaller({version: 2});
        const sqlParams: Array<[any, number]> = [];
        for (const cell of cells) {
          const id: number = cell.id;
          const value: any = cell.value;
          const decodedValue = DocStorage._decodeValue(value, result.oldGristType, result.oldSqlType);
          const newValue = DocStorage._encodeValue(marshaller, result.newGristType, result.newSqlType, decodedValue);
          if (!(newValue instanceof Uint8Array)) {
            sqlParams.push([newValue, id]);
          }
        }
        const sql = `UPDATE ${q(tableId)} SET ${q(colId)}=? WHERE id=?`;
        await this._applyMaybeBulkUpdateOrAddSql(sql, sqlParams);
      }
    }
  }

  private _getGristType(tableId: string, colId: string): string {
    return (this._docSchema[tableId] && this._docSchema[tableId][colId]) || 'Any';
  }

  private _getDB(): SQLiteDB {
    if (!this._db) {
      throw new Error("Tried to use DocStorage database before it was opened");
    }
    return this._db;
  }

  /**
   * Get a list of user indexes
   */
  private async _getIndexes(): Promise<IndexInfo[]> {
    // Find all indexes on user tables.
    return await this.all("SELECT tbl_name as tableId, il.name as indexId, ii.name as colId " +
                          "FROM sqlite_master AS m, " +
                          "pragma_index_list(m.name) AS il, " +
                          "pragma_index_info(il.name) AS ii " +
                          "WHERE m.type='table' " +
                          "AND tbl_name NOT LIKE '_grist%' " +
                          "ORDER BY tableId, colId") as any;
  }

  /**
   * Implement a filtered query by adding any parameters into
   * temporary tables, to avoid hitting an SQLite parameter limit.
   * Backing for temporary tables lies outside of the document database,
   * and operates with `synchronous=OFF` and `journal_mode=PERSIST`, so
   * should be reasonably fast:
   *   https://sqlite.org/tempfiles.html#temp_databases
   */
  private async _fetchQueryWithManyParameters(query: ExpandedQuery): Promise<Buffer> {
    const db = this._getDB();
    return db.execTransaction(async () => {
      const tableNames: string[] = [];
      const whereParts: string[] = [];
      for (const colId of Object.keys(query.filters)) {
        const values = query.filters[colId];
        const tableName = `_grist_tmp_${tableNames.length}_${uuidv4().replace(/-/g, '_')}`;
        await db.exec(`CREATE TEMPORARY TABLE ${tableName}(data)`);
        for (const valuesChunk of chunk(values, maxSQLiteVariables)) {
          const placeholders = valuesChunk.map(() => '(?)').join(',');
          await db.run(`INSERT INTO ${tableName}(data) VALUES ${placeholders}`, valuesChunk);
        }
        whereParts.push(`${quoteIdent(query.tableId)}.${quoteIdent(colId)} IN (SELECT data FROM ${tableName})`);
      }
      const sql = this._getSqlForQuery(query, whereParts);
      try {
        return await db.allMarshal(sql);
      } finally {
        await Promise.all(tableNames.map(tableName => db.exec(`DROP TABLE ${tableName}`)));
      }
    });
  }

  /**
   * Construct SQL for an ExpandedQuery.  Expects that filters have been converted into
   * a set of WHERE terms that should be ANDed.
   */
  private _getSqlForQuery(query: ExpandedQuery, whereParts: string[]) {
    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
    const limitClause = (typeof query.limit === 'number') ? `LIMIT ${query.limit}` : '';
    const joinClauses = query.joins ? query.joins.join(' ') : '';
    const selects = query.selects ? query.selects.join(', ') : '*';
    const sql = `SELECT ${selects} FROM ${quoteIdent(query.tableId)} ` +
      `${joinClauses} ${whereClause} ${limitClause}`;
    return sql;
  }

  // If we are being asked to add a record and then update several of its
  // columns, compact that into a single action. For fully Grist-managed
  // documents, this makes no difference. But if the underlying SQLite DB
  // has extra constraints on columns, it can make a difference.
  // TODO: consider dealing with other scenarios, especially a BulkAddRecord.
  private _compressStoredActions(docActions: DocAction[]): DocAction[] {
    if (docActions.length > 1) {
      const first = docActions[0];
      if (first[0] === 'AddRecord' &&
        docActions.slice(1).every(
          // Check other actions are UpdateRecords for the same table and row.
          a => a[0] === 'UpdateRecord' && a[1] === first[1] && a[2] === first[2]
        )) {
        const merged = cloneDeep(first);
        for (const a2 of docActions.slice(1)) {
          Object.assign(merged[3], a2[3]);
        }
        docActions = [merged];
      }
    }
    return docActions;
  }

  // If an action can have manualSort removed, go ahead and do it (after cloning),
  // otherwise return null.
  private _considerWithoutManualSort(act: DocAction): DocAction|null {
    if (act[0] === 'AddRecord' || act[0] === 'UpdateRecord' ||
      act[0] === 'BulkAddRecord' || act[0] === 'BulkUpdateRecord' &&
      'manualSort' in act[3]) {
      act = cloneDeep(act);
      delete act[3].manualSort;
      return act;
    }
    return null;
  }
}

interface RebuildResult {
  sql: string;
  oldGristType: string;
  newGristType: string;
  oldDefault: string;
  newDefault: string;
  oldSqlType: string;
  newSqlType: string;
}

// A summary of columns a database index is covering or should cover.
export interface IndexColumns {
  tableId: string;     // name of table
  colId: string;       // column indexed (only single-column indexes supported for now)
}

// A summary of a database index, including its name.
export interface IndexInfo extends IndexColumns {
  indexId: string;     // name of index
}

/**
 * Creates an index that allows fast SQL JOIN between _grist_Attachments.fileIdent and _gristsys_Files.ident.
 */
export async function createAttachmentsIndex(db: ISQLiteDB) {
  await db.exec(`CREATE INDEX _grist_Attachments_fileIdent ON _grist_Attachments(fileIdent)`);
}

// Old docs may have incorrect quotes in their schema for default values
// that node-sqlite3 may tolerate but not other wrappers. Patch such
// material as we run into it.
function fixDefault(def: string) {
  return (def === '""') ? "''" : def;
}
