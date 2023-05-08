import {ActionSummary, ColumnDelta, createEmptyActionSummary, createEmptyTableDelta} from 'app/common/ActionSummary';
import {CellDelta} from 'app/common/TabularDiff';
import {concatenateSummaries} from 'app/common/ActionSummarizer';
import {ISQLiteDB, quoteIdent, ResultRow} from 'app/server/lib/SQLiteDB';
import keyBy = require('lodash/keyBy');
import matches = require('lodash/matches');
import sortBy = require('lodash/sortBy');
import toPairs = require('lodash/toPairs');

/**
 * We can combine an ActionSummary with the current state of the database
 * to answer questions about the state of the database in the past.  This
 * is particularly useful for grist metadata tables, which are needed to
 * interpret the content of user tables fully.
 *   - TimeCursor is a simple container for the db and an ActionSummary
 *   - TimeQuery offers a db-like interface for a given table and set of columns
 *   - TimeLayout answers a couple of concrete questions about table meta-data using a
 *     set of TimeQuery objects hooked up to _grist_* tables.  It could be used to
 *     improve the rendering of the ActionLog, for example, although it is not (yet).
 */

/** Track the state of the database at a particular time. */
export class TimeCursor {
  public summary: ActionSummary;

  constructor(public db: ISQLiteDB) {
    this.summary = createEmptyActionSummary();
  }

  /** add a summary of an action just before the last action applied to the TimeCursor */
  public prepend(prevSummary: ActionSummary) {
    this.summary = concatenateSummaries([prevSummary, this.summary]);
  }

  /** add a summary of an action just after the last action applied to the TimeCursor */
  public append(nextSummary: ActionSummary) {
    this.summary = concatenateSummaries([this.summary, nextSummary]);
  }
}

/** internal class for storing a ResultRow dictionary, keyed by rowId */
class ResultRows {
  [rowId: number]: ResultRow;
}

/**
 * Query the state of a particular table in the past, given a TimeCursor holding the
 * current db and a summary of all changes between that past time and now.
 * For the moment, for simplicity, names of tables and columns are assumed not to
 * change, and TimeQuery should only be used for _grist_* tables.
 */
export class TimeQuery {
  private _currentRows: ResultRow[];
  private _pastRows: ResultRow[];

  constructor(public tc: TimeCursor, public tableId: string, public colIds: string[]) {
  }

  /** Get fresh data from DB and overlay with any past data */
  public async update(): Promise<ResultRow[]> {
    this._currentRows = await this.tc.db.all(
      `select ${['id', ...this.colIds].map(quoteIdent).join(',')} from ${quoteIdent(this.tableId)}`);

    // Let's see everything the summary has accumulated about the table back then.
    const td = this.tc.summary.tableDeltas[this.tableId] || createEmptyTableDelta();

    // Now rewrite the summary as a ResultRow dictionary, to make it comparable
    // with database.
    const summaryRows: ResultRows = {};
    for (const [colId, columns] of toPairs(td.columnDeltas)) {
      for (const [rowId, cell] of toPairs(columns) as unknown as Array<[keyof ColumnDelta, CellDelta]>) {
        if (!summaryRows[rowId]) { summaryRows[rowId] = {}; }
        const val = cell[0];
        summaryRows[rowId][colId] = (val !== null && typeof val === 'object' ) ? val[0] : null;
      }
    }

    // Prepare to access the current database state by rowId.
    const rowsById = keyBy(this._currentRows, r => (r.id as number));

    // Prepare a list of rowIds at the time of interest.
    // The past rows are whatever the db has now, omitting rows that were added
    // since the past time, and adding back any rows that were removed since then.
    // Careful about the order of this, since rows could be replaced.
    const additions = new Set(td.addRows);
    const pastRowIds =
      new Set([...this._currentRows.map(r => r.id as number).filter(r => !additions.has(r)),
               ...td.removeRows]);

    // Now prepare a row for every expected rowId, using current db data if available
    // and relevant, and overlaying past data when available.
    this._pastRows = new Array<ResultRow>();
    const colIdsOfInterest = new Set(this.colIds);
    for (const id of Array.from(pastRowIds).sort()) {
      const row: ResultRow = rowsById[id] || {id};
      if (summaryRows[id] && !additions.has(id)) {
        for (const [colId, val] of toPairs(summaryRows[id])) {
          if (colIdsOfInterest.has(colId)) { row[colId] = val; }
        }
      }
      this._pastRows.push(row);
    }
    return this._pastRows;
  }

  /**
   * Do a query with a single result, specifying any desired filters.  Exception thrown
   * if there is no result.
   */
  public one(args: {[name: string]: any}): ResultRow {
    const result = this._pastRows.find(matches(args));
    if (!result) {
      throw new Error(`could not find: ${JSON.stringify(args)} for ${this.tableId}`);
    }
    return result;
  }

  /** Get all results for a query. */
  public all(args?: {[name: string]: any}): ResultRow[] {
    if (!args) { return this._pastRows; }
    return this._pastRows.filter(matches(args));
  }
}

/**
 * Put some TimeQuery queries to work answering questions about column order and
 * user-facing name of tables.
 */
export class TimeLayout {
  public tables: TimeQuery;
  public fields: TimeQuery;
  public columns: TimeQuery;
  public views: TimeQuery;
  public sections: TimeQuery;

  constructor(public tc: TimeCursor) {
    this.tables = new TimeQuery(tc, '_grist_Tables', ['tableId', 'primaryViewId', 'rawViewSectionRef']);
    this.fields = new TimeQuery(tc, '_grist_Views_section_field',
                                ['parentId', 'parentPos', 'colRef']);
    this.columns = new TimeQuery(tc, '_grist_Tables_column', ['parentId', 'colId']);
    this.views = new TimeQuery(tc, '_grist_Views', ['id', 'name']);
    this.sections = new TimeQuery(tc, '_grist_Views_section', ['id', 'title']);
  }

  /** update from TimeCursor */
  public async update() {
    await this.tables.update();
    await this.columns.update();
    await this.fields.update();
    await this.views.update();
    await this.sections.update();
  }

  public getColumnOrder(tableId: string): string[] {
    const primaryViewId = this.tables.one({tableId}).primaryViewId;
    const preorder = this.fields.all({parentId: primaryViewId});
    const precol = keyBy(this.columns.all(), 'id');
    const ordered = sortBy(preorder, 'parentPos');
    const names = ordered.map(r => precol[r.colRef].colId);
    return names;
  }

  public getTableName(tableId: string): string {
    const rawViewSectionRef = this.tables.one({tableId}).rawViewSectionRef;
    return this.sections.one({id: rawViewSectionRef}).title;
  }
}
