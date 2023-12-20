/**
 * A QuerySet represents a data query to the server, which returns matching data and includes a
 * subscription. The subscription tells the server to send us docActions that affect this query.
 *
 * This file combines several classes related to it:
 *
 * - QuerySetManager is maintained by GristDoc, and keeps all active QuerySets for this doc.
 *   A new one is created using QuerySetManager.useQuerySet(owner, query)
 *
 *      This creates a subscription to the server, and sets up owner.autoDispose() to clean up
 *      that subscription. If a subscription already exists, it only returns a reference to it,
 *      and disposal will remove the reference, only unsubscribing from the server when no
 *      referernces remain.
 *
 * - DynamicQuerySet is used by BaseView (in place of FilteredRowSource used previously). It is a
 *   single RowSource which mirrors a QuerySet, and allows the QuerySet to be changed.
 *   You set it to a new query using DynamicQuerySet.makeQuery(...)
 *
 * - QuerySet represents the actual query, makes the calls to the server to populate the data in
 *   the relevant TableData. It is also a FilteredRowSource for the rows matching the query.
 *
 * - TableQuerySets is a simple set of queries maintained for a single table (by DataTableModel).
 *   It's needed to know which rows are still relevant after a QuerySet is disposed.
 *
 * TODO: need to have a fetch limit (e.g. 1000 by default, or an option for user)
 * TODO: client-side should show "..." or "50000 more rows not shown" in that case.
 * TODO: Reference columns don't work properly because always use a displayCol which relies on formulas
 */
import {ClientColumnGettersByColId} from 'app/client/models/ClientColumnGetters';
import DataTableModel from 'app/client/models/DataTableModel';
import {DocModel} from 'app/client/models/DocModel';
import {BaseFilteredRowSource, RowList, RowSource} from 'app/client/models/rowset';
import {TableData} from 'app/client/models/TableData';
import {ActiveDocAPI, ClientQuery, QueryOperation} from 'app/common/ActiveDocAPI';
import {TableDataAction} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {nativeCompare} from 'app/common/gutil';
import {IRefCountSub, RefCountMap} from 'app/common/RefCountMap';
import {getLinkingFilterFunc, RowFilterFunc} from 'app/common/RowFilterFunc';
import {TableData as BaseTableData} from 'app/common/TableData';
import {tbind} from 'app/common/tbind';
import {UIRowId} from 'app/plugin/GristAPI';
import {Disposable, Holder, IDisposableOwnerT} from 'grainjs';
import * as ko from 'knockout';
import debounce = require('lodash/debounce');

// Limit on the how many rows to request for OnDemand tables.
const ON_DEMAND_ROW_LIMIT = 10000;

// Copied from app/server/lib/DocStorage.js. Actually could be 999, we are just playing it safe.
const MAX_SQL_PARAMS = 500;

/**
 * A representation of a Query that uses tableRef/colRefs (i.e. metadata rowIds) to remain stable
 * across table/column renames.
 */
export interface QueryRefs {
  tableRef: number;
  filterTuples: Array<FilterTuple>;
}

type ColRef = number | 'id';
type FilterTuple = [ColRef, QueryOperation, any[]];

/**
 * QuerySetManager keeps track of all queries for a GristDoc instance. It is also responsible for
 * disposing all state associated with queries when a GristDoc is disposed.
 *
 * Note that queries are made using tableId + colIds, which is a more suitable interface for a
 * (future) public API, and easier to interact with DocData/TableData. However, it creates
 * problems when tables or columns are renamed or deleted.
 *
 * To handle renames, we keep track of queries using their QueryRef representation, using
 * tableRef/colRefs, i.e. metadata rowIds that aren't affected by renames.
 *
 * To handle deletes, we subscribe to isDeleted() observables of the needed tables and columns,
 * and purge the query from QuerySetManager if any isDeleted() flag becomes true.
 */
export class QuerySetManager extends Disposable {
  private _queryMap: RefCountMap<string, QuerySet>;

  constructor(private _docModel: DocModel, docComm: ActiveDocAPI) {
    super();
    this._queryMap = this.autoDispose(new RefCountMap<string, QuerySet>({
      create: (query: string) => QuerySet.create(null, _docModel, docComm, query, this),
      dispose: (query: string, querySet: QuerySet) => querySet.dispose(),
      gracePeriodMs: 60000,   // Dispose after a minute of disuse.
    }));
  }

  public useQuerySet(owner: IDisposableOwnerT<IRefCountSub<QuerySet>>, query: ClientQuery): QuerySet {
    // Convert the query to a string key which identifies it.
    const queryKey: string = encodeQuery(convertQueryToRefs(this._docModel, query));

    // Look up or create the query in the RefCountMap. The returned object is a RefCountSub
    // subscription, which decrements reference count when disposed.
    const querySetRefCount = this._queryMap.use(queryKey);

    // The passed-in owner is what will dispose this subscription (decrement reference count).
    owner.autoDispose(querySetRefCount);
    return querySetRefCount.get();
  }

  public purgeKey(queryKey: string) {
    this._queryMap.purgeKey(queryKey);
  }

  // For testing: set gracePeriodMs, returning the previous value.
  public testSetGracePeriodMs(ms: number): number {
    return this._queryMap.testSetGracePeriodMs(ms);
  }

}

/**
 * DynamicQuerySet wraps one QuerySet, and allows changing it on the fly. It serves as a
 * RowSource.
 */
export class DynamicQuerySet extends RowSource {
  // Holds a reference to the currently active QuerySet.
  private _holder = Holder.create<IRefCountSub<QuerySet>>(this);

  // Shortcut to _holder.get().get().
  private _querySet?: QuerySet;

  // A ticket number for the latest makeQuery() call. We use it to avoid calling cb() for
  // superseded queries.
  private _lastTicket = 0;

  // We could switch between several different queries quickly. If several queries are done
  // fetching at the same time (e.g. were already ready), debounce lets us only update the
  // query-set once to the last query.
  private _updateQuerySetDebounced = debounce(tbind(this._updateQuerySet, this), 0);

  constructor(private _querySetManager: QuerySetManager, private _tableModel: DataTableModel) {
    super();
  }

  public getAllRows(): RowList {
    return this._querySet ? this._querySet.getAllRows() : [];
  }

  public getNumRows(): number {
    return this._querySet ? this._querySet.getNumRows() : 0;
  }

  /**
   * Tells whether the query's result got truncated, i.e. not all rows are included.
   */
  public get isTruncated(): boolean {
    return this._querySet ? this._querySet.isTruncated : false;
  }

  /**
   * Replace the query represented by this DynamicQuerySet. If multiple makeQuery() calls are made
   * quickly (while waiting for the server), cb() may only be called for the latest one.
   *
   * If there is an error fetching data, cb(err) will be called with that error. The second
   * argument to cb() is true if any data was changed, and false if not. Note that for a series of
   * makeQuery() calls, cb() is always called at least once, and always asynchronously.
   */
  public makeQuery(filters: {[colId: string]: any[]},
                   operations: {[colId: string]: QueryOperation},
                   cb: (err: Error|null, changed: boolean) => void): void {
    const query: ClientQuery = {tableId: this._tableModel.tableData.tableId, filters, operations};
    const newQuerySet = this._querySetManager.useQuerySet(this._holder, query);
    const ticket = this._getTicket();

    // CB should be called asynchronously, since surprising hard-to-debug interactions can happen
    // if it's sometimes synchronous and sometimes not.
    newQuerySet.fetchPromise.then(() => {
      // Only if we weren't superseded by another query.
      if (!ticket.isValid()) { return; }
      this._updateQuerySetDebounced(newQuerySet, cb);
    })
    .catch((err) => { cb(err, false); });
  }

  private _updateQuerySet(nextQuerySet: QuerySet, cb: (err: Error|null, changed: boolean) => void): void {
    try {
      if (nextQuerySet !== this._querySet) {
        const oldQuerySet = this._querySet;
        this._querySet = nextQuerySet;

        if (oldQuerySet) {
          this.stopListening(oldQuerySet, 'rowChange');
          this.stopListening(oldQuerySet, 'rowNotify');
          this.trigger('rowChange', 'remove', oldQuerySet.getAllRows());
        }
        this.trigger('rowChange', 'add', this._querySet.getAllRows());
        this.listenTo(this._querySet, 'rowNotify', tbind(this.trigger, this, 'rowNotify'));
        this.listenTo(this._querySet, 'rowChange', tbind(this.trigger, this, 'rowChange'));
      }
      cb(null, true);
    } catch (err) {
      cb(err, true);
    }
  }

  private _getTicket() {
    const myTicket = ++this._lastTicket;
    return {
      isValid: () => this._lastTicket === myTicket
    };
  }
}

/**
 * Class representing a query, which knows how to fetch the data, an presents a RowSource with
 * matching rows. It uses new Comm calls for onDemand tables, but for regular tables, fetching
 * data uses the good old tableModel.fetch(). In in most cases the data is already available, so
 * this class is little more than a FilteredRowSource.
 */
export class QuerySet extends BaseFilteredRowSource {
  // A publicly exposed promise, which may be waited on in order to know that the data has
  // arrived. Until then, the RowSource underlying this QuerySet is empty.
  public readonly fetchPromise: Promise<void>;

  // Whether the fetched result is considered incomplete, i.e. not all rows were fetched.
  public isTruncated: boolean;

  constructor(docModel: DocModel, docComm: ActiveDocAPI, queryKey: string, qsm: QuerySetManager) {
    const queryRefs: QueryRefs = decodeQuery(queryKey);
    const query: ClientQuery = convertQueryFromRefs(docModel, queryRefs);

    super(getFilterFunc(docModel.docData, query));
    this.isTruncated = false;

    // When table or any needed columns are deleted, purge this QuerySet from the map.
    const isInvalid = this.autoDispose(makeQueryInvalidComputed(docModel, queryRefs));
    this.autoDispose(isInvalid.subscribe((invalid) => {
      if (invalid) { qsm.purgeKey(queryKey); }
    }));

    // Find the relevant DataTableModel.
    const tableModel = docModel.dataTables[query.tableId];

    // The number of values across all filters is limited to MAX_SQL_PARAMS. Normally a query has
    // a single filter column, but in case there are multiple we divide the limit across all
    // columns. It's OK to modify the query in place, since this modified version is not used
    // elsewhere.

    // (It might be better to limit this in DocStorage.js, but by limiting here, it's easier to
    // know when to set isTruncated flag, to inform the user that data is incomplete.)
    const colIds = Object.keys(query.filters);
    if (colIds.length > 0) {
      const maxParams = Math.floor(MAX_SQL_PARAMS / colIds.length);
      for (const c of colIds) {
        const values = query.filters[c];
        if (values.length > maxParams) {
          query.filters[c] = values.slice(0, maxParams);
          this.isTruncated = true;
        }
      }
    }

    let fetchPromise: Promise<void>;
    if (tableModel.tableMetaRow.onDemand()) {
      const tableQS = tableModel.tableQuerySets;
      fetchPromise = docComm.useQuerySet({limit: ON_DEMAND_ROW_LIMIT, ...query}).then((data) => {
        // We assume that if we fetched the max number of rows, that there are likely more and the
        // result should be reported as truncated.
        // TODO: Better to fetch ON_DEMAND_ROW_LIMIT + 1 and omit one of them, so that isTruncated
        // is only set if the row limit really was exceeded.
        const rowIds = data.tableData[2];
        if (rowIds.length >= ON_DEMAND_ROW_LIMIT) {
          this.isTruncated = true;
        }

        this.onDispose(() => {
          docComm.disposeQuerySet(data.querySubId).catch((err) => {
            // tslint:disable-next-line:no-console
            console.log(`Promise rejected for disposeQuerySet: ${err.message}`);
          });
          tableQS.removeQuerySet(this);
        });
        tableQS.addQuerySet(this, data.tableData);
      });
    } else {
      // For regular (small), we fetch in bulk (and do nothing if already fetched).
      fetchPromise = tableModel.fetch(false);
    }

    // This is a FilteredRowSource; subscribe it to the underlying data once the fetch resolves.
    this.fetchPromise = fetchPromise.then(() => this.subscribeTo(tableModel));
  }
}

/**
 * Helper for use in a DataTableModel to maintain all QuerySets.
 */
export class TableQuerySets {
  private _querySets: Set<QuerySet> = new Set();

  constructor(private _tableData: TableData) {}

  public addQuerySet(querySet: QuerySet, data: TableDataAction): void {
    this._querySets.add(querySet);
    this._tableData.loadPartial(data);
  }

  // Returns a Set of unused RowIds from querySet.
  public removeQuerySet(querySet: QuerySet): void {
    this._querySets.delete(querySet);

    // Figure out which rows are not used by any other QuerySet in this DataTableModel.
    const unusedRowIds = new Set(querySet.getAllRows());
    for (const qs of this._querySets) {
      for (const rowId of qs.getAllRows()) {
        unusedRowIds.delete(rowId);
      }
    }
    this._tableData.unloadPartial(Array.from(unusedRowIds) as number[]);
  }
}

/**
 * Returns a filtering function which tells whether a row matches the given query.
 */
export function getFilterFunc(docData: DocData, query: ClientQuery): RowFilterFunc<UIRowId> {
  // NOTE we rely without checking on tableId and colIds being valid.
  const tableData: BaseTableData = docData.getTable(query.tableId)!;
  const colGetters = new ClientColumnGettersByColId(tableData);
  const rowFilterFunc = getLinkingFilterFunc(colGetters, query);
  return (rowId: UIRowId) => rowId !== "new" && rowFilterFunc(rowId);
}

/**
 * Helper that converts a Query (with tableId/colIds) to an object with tableRef/colRefs (i.e.
 * rowIds), and consistently sorted. We use that to identify a Query across table/column renames.
 */
function convertQueryToRefs(docModel: DocModel, query: ClientQuery): QueryRefs {
  // During table rename, we can be referencing old name of a table.
  const tableRec = Object.values(docModel.dataTables).find(t => t.tableData.tableId === query.tableId)?.tableMetaRow;
  if (!tableRec) {
    throw new Error(`Table ${query.tableId} not found`);
  }

  const colRefsByColId: {[colId: string]: ColRef} = {id: 'id'};
  for (const col of tableRec.columns.peek().peek()) {
    colRefsByColId[col.colId.peek()] = col.getRowId();
  }

  const filterTuples = Object.keys(query.filters).map((colId) => {
    const values = query.filters[colId];
    // Keep filter values sorted by value, for consistency.
    values.sort(nativeCompare);
    return [colRefsByColId[colId], query.operations[colId], values] as FilterTuple;
  });
  // Keep filters sorted by colRef, for consistency.
  filterTuples.sort((a, b) =>
    nativeCompare(a[0], b[0]) || nativeCompare(a[1], b[1]));
  return {tableRef: tableRec.getRowId(), filterTuples};
}

/**
 * Helper to convert a QueryRefs (using tableRef/colRefs) object back to a Query (using
 * tableId/colIds).
 */
function convertQueryFromRefs(docModel: DocModel, queryRefs: QueryRefs): ClientQuery {
  const tableRec = docModel.dataTablesByRef.get(queryRefs.tableRef)!.tableMetaRow;
  const filters: {[colId: string]: any[]} = {};
  const operations: {[colId: string]: QueryOperation} = {};
  for (const [colRef, operation, values] of queryRefs.filterTuples) {
    const colId = colRef === 'id' ? 'id' : docModel.columns.getRowModel(colRef).colId.peek();
    filters[colId] = values;
    operations[colId] = operation;
  }
  return {tableId: tableRec.tableId.peek(), filters, operations};
}

/**
 * Encodes a query (converted to QueryRefs using convertQueryToRefs()) as a string, to be usable
 * as a key into a map.
 *
 * It uses JSON.stringify, but avoids objects since their order of keys in serialization is not
 * guaranteed. This is important to produce consistent results (same query => same encoding).
 */
function encodeQuery(queryRefs: QueryRefs): string {
  return JSON.stringify([queryRefs.tableRef, queryRefs.filterTuples]);
}

// Decode an encoded QueryRefs.
function decodeQuery(queryKey: string): QueryRefs {
  const [tableRef, filterTuples] = JSON.parse(queryKey);
  return {tableRef, filterTuples};
}

/**
 * Returns a ko.computed() which turns to true when the table or any of the columns needed by the
 * given query are deleted.
 */
function makeQueryInvalidComputed(docModel: DocModel, queryRefs: QueryRefs): ko.Computed<boolean> {
  const tableFlag: ko.Observable<boolean> = docModel.tables.getRowModel(queryRefs.tableRef)._isDeleted;
  const colFlags: Array<ko.Observable<boolean> | null> = queryRefs.filterTuples.map(
    ([colRef, , ]) => colRef === 'id' ? null : docModel.columns.getRowModel(colRef)._isDeleted);
  return ko.computed(() => Boolean(tableFlag() || colFlags.some((c) => c?.())));
}
