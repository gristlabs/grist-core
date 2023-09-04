import { Marshaller } from 'app/common/marshal';
import { OpenMode, quoteIdent } from 'app/server/lib/SQLiteDB';

/**
 * Code common to SQLite wrappers.
 */

/**
 * It is important that Statement exists - but we don't expect
 * anything of it.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Statement {}

// Some facts about the wrapper implementation.
export interface MinDBOptions {
  // is interruption implemented?
  canInterrupt: boolean;

  // Do all methods apart from exec() process at most one
  // statement?
  bindableMethodsProcessOneStatement: boolean;
}

export interface MinDB {
  // This method is expected to be able to handle multiple
  // semicolon-separated statements, as for sqlite3_exec:
  //   https://www.sqlite.org/c3ref/exec.html
  exec(sql: string): Promise<void>;

  // For all these methods, sql should ultimately be passed
  // to sqlite3_prepare_v2 or later, and any tail text ignored after
  // the first complete statement, so only the first statement is
  // used if there are multiple.
  //   https://www.sqlite.org/c3ref/prepare.html
  run(sql: string, ...params: any[]): Promise<MinRunResult>;
  get(sql: string, ...params: any[]): Promise<ResultRow|undefined>;
  all(sql: string, ...params: any[]): Promise<ResultRow[]>;
  prepare(sql: string, ...params: any[]): Promise<PreparedStatement>;
  runAndGetId(sql: string, ...params: any[]): Promise<number>;
  allMarshal(sql: string, ...params: any[]): Promise<Buffer>;

  close(): Promise<void>;

  /**
   * Limit the number of ATTACHed databases permitted.
   */
  limitAttach(maxAttach: number): Promise<void>;

  /**
   * Stop all current queries.
   */
  interrupt?(): Promise<void>;

  /**
   * Get some facts about the wrapper.
   */
  getOptions?(): MinDBOptions;
}

export interface MinRunResult {
  changes: number;
}

// Describes the result of get() and all() database methods.
export interface ResultRow {
  [column: string]: any;
}

export interface PreparedStatement {
  run(...params: any[]): Promise<MinRunResult>;
  finalize(): Promise<void>;
  columns(): string[];
}

export interface SqliteVariant {
  opener(dbPath: string, mode: OpenMode): Promise<MinDB>;
}

/**
 * A crude implementation of Grist marshalling.
 * There is a fork of node-sqlite3 that has Grist
 * marshalling built in, at:
 *   https://github.com/gristlabs/node-sqlite3
 * If using a version of SQLite without this built
 * in, another option is to add custom functions
 * to do it. This object has the initialize, step,
 * and finalize callbacks typically needed to add
 * a custom aggregration function.
 */
export const gristMarshal = {
  initialize(): GristMarshalIntermediateValue {
    return {};
  },
  step(accum: GristMarshalIntermediateValue, ...row: any[]) {
    if (!accum.names || !accum.values) {
      accum.names = row.map(value => String(value));
      accum.values = row.map(() => []);
    } else {
      for (const [i, v] of row.entries()) {
        accum.values[i].push(v);
      }
    }
    return accum;
  },
  finalize(accum: GristMarshalIntermediateValue) {
    const marshaller = new Marshaller({version: 2, keysAreBuffers: true});
    const result: Record<string, Array<any>> = {};
    if (accum.names && accum.values) {
      for (const [i, name] of accum.names.entries()) {
        result[name] = accum.values[i];
      }
    }
    marshaller.marshal(result);
    return marshaller.dumpAsBuffer();
  }
};

/**
 * An intermediate value used during an aggregation.
 */
interface GristMarshalIntermediateValue {
  // The names of the columns, once known.
  names?: string[];
  // Values stored in the columns.
  // There is one element in the outermost array per column.
  // That element contains a list of values stored in that column.
  values?: Array<Array<any>>;
}

/**
 * Run Grist marshalling as a SQLite query, assuming
 * a custom aggregation has been added as "grist_marshal".
 * The marshalled result needs to contain the column
 * identifiers embedded in it. This is a little awkward
 * to organize - hence the hacky UNION here. This is
 * for compatibility with the existing marshalling method,
 * which could be replaced instead.
 */
export async function allMarshalQuery(db: MinDB, sql: string, ...params: any[]): Promise<Buffer> {
  const statement = await db.prepare(sql);
  const columns = statement.columns();
  const quotedColumnList = columns.map(quoteIdent).join(',');
  const query = await db.all(`select grist_marshal(${quotedColumnList}) as buf FROM ` +
    `(select ${quotedColumnList} UNION ALL select * from (` + sql + '))', ..._fixParameters(params));
  return query[0].buf;
}

/**
 * Booleans need to be cast to 1 or 0 for SQLite.
 * The node-sqlite3 wrapper does this automatically, but other
 * wrappers do not.
 */
function _fixParameters(params: any[]) {
  return params.map(p => p === true ? 1 : (p === false ? 0 : p));
}
