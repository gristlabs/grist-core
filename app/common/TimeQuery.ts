import {ActionSummary, ColumnDelta, createEmptyActionSummary, createEmptyTableDelta} from 'app/common/ActionSummary';
import {CellDelta} from 'app/common/TabularDiff';
import {concatenateSummaries} from 'app/common/ActionSummarizer';
import keyBy = require('lodash/keyBy');
import matches = require('lodash/matches');
import sortBy = require('lodash/sortBy');
import toPairs = require('lodash/toPairs');

/**
 * We can combine an ActionSummary with the current state of the database
 * to answer questions about the state of the database in the past.  This
 * is particularly useful for Grist metadata tables, which are needed to
 * interpret the content of user tables fully.
 *   - TimeCursor is a simple container for the db and an ActionSummary
 *   - TimeQuery offers a db-like interface for a given table and set of columns
 *   - TimeLayout answers a couple of concrete questions about table meta-data using a
 *     set of TimeQuery objects hooked up to _grist_* tables.
 */

export interface ResultRow {
  [column: string]: any;
}

export interface ITimeData {
  fetch(tableId: string, colIds: string[], rowIds?: number[]): Promise<ResultRow[]>;
  getColIds(tableId: string): Promise<string[]>;
}

/** Track the state of the database at a particular time. */
export class TimeCursor {
  public summary: ActionSummary;

  constructor(public db: ITimeData) {
    this.summary = createEmptyActionSummary();
  }

  /**
   * Add a summary of an action just before the last action applied to
   * the TimeCursor, so we stretch further back in time.
   */
  public prepend(prevSummary: ActionSummary) {
    this.summary = concatenateSummaries([prevSummary, this.summary]);
  }

  /**
   * Add a summary of an action just after the last action applied to
   * the TimeCursor, going one step closer to current time. When the
   * cursor is used, the summary is assumed to extend right up to
   * current time.
   */
  public append(nextSummary: ActionSummary) {
    // TODO: concatenation appears to modify its inputs, so we
    // need to clone to avoid propagating that. Look to see if
    // a safe version of concatenation could be written to save
    // cloning.
    this.summary = concatenateSummaries([this.summary, nextSummary]);
  }
}

/** internal class for storing a ResultRow dictionary, keyed by rowId */
interface ResultRows {
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

  constructor(public tc: TimeCursor,
              public tableId: string,
              public colIds: string[] | '*',
              public rowIds?: number[]) {
  }

  public reset(tableId: string, colIds: string[] | '*', rowIds?: number[]) {
    this.tableId = tableId;
    this.colIds = colIds;
    this.rowIds = rowIds;
    this._currentRows = [];
    this._pastRows = [];
  }

  /**
   * Get fresh data from DB and overlay with any past data.
   * TODO: optimize.
   */
  public async update(): Promise<ResultRow[]> {
    this._currentRows = [];
    this._pastRows = [];

    const tableRenameDelta = this.tc.summary.tableRenames.find(
      (delta) => delta[0] === this.tableId
    );
    const tableRenamed = tableRenameDelta ? tableRenameDelta[1] : this.tableId;
    // Table no longer exists.
    if (!tableRenamed) { return []; }

    // Let's see everything the summary has accumulated about the table back then.
    const td = this.tc.summary.tableDeltas[tableRenamed] || createEmptyTableDelta();

    const columnForwardRenames: Record<string, string|null> =
        Object.fromEntries(td.columnRenames.filter(delta => delta[0]));
    const columnBackwardRenames: Record<string, string|null> =
        Object.fromEntries(td.columnRenames.map(([a, b]) => [b, a]).filter(delta => delta[0]));

    const colIdsExpanded = this.colIds === '*' ?
        (await this.tc.db.getColIds(tableRenamed)).map(colId => columnBackwardRenames[colId] ?? colId) :
        this.colIds;

    const colIdsRenamed =
        colIdsExpanded.map(colId => columnForwardRenames[colId] ?? colId).filter(colId => colId);
    this._currentRows = await this.tc.db.fetch(
      tableRenamed,
      ['id', ...colIdsRenamed],
      this.rowIds,
    );

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
    const colIdsOfInterest = new Set(colIdsExpanded);
    for (const id of Array.from(pastRowIds).sort()) {
      const rowCurrent: ResultRow = rowsById[id] || {id};
      const row: ResultRow = {};
      for (const colId of ['id', ...colIdsExpanded]) {
        const colIdRenamed = columnForwardRenames[colId] ?? colId;
        if (!colIdRenamed) { continue; }
        row[colId] = rowCurrent[colIdRenamed];
      }
      if (summaryRows[id] && !additions.has(id)) {
        for (const [colId, val] of toPairs(summaryRows[id])) {
          const colIdRenamed = columnBackwardRenames[colId] ?? colId;
          if (colIdsOfInterest.has(colIdRenamed)) {
            row[colIdRenamed] = val;
          }
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
