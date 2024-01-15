/**
 * rowset.js module defines a number of classes to deal with maintaining collections of rows and
 * listening to their changes.
 *
 * RowSource: abstract interface for a source of row changes.
 *  - emits rowChange('add|remove|update', rows) events with rows an iterable.
 *  - offers getAllRows() method that returns all rows currently in the RowSource.
 *
 * RowListener: base class for a listener to row changes.
 *  - offers subscribeTo(rowSource), unsubscribeFrom(rowSource) methods.
 *  - derived classes should implement onAddRows(), onRemoveRows(), onUpdateRows().
 *
 * FilteredRowSource(filterFunc): a RowListener that can be subscribed to any other RowSources and
 *  is itself a RowSource which forwards changes to rows that match filterFunc.
 *
 * RowGrouping(groupFunc): a RowListener that can be subscribed to any RowSources, groups
 *  rows by the result of groupFunc, and exposes a per-group RowSource via its getGroup() method.
 *
 * SortedRowSet(compareFunc): a RowListener that can be subscribed to any RowSources, and exposes
 *  an observable koArray via getKoArray(), which maintains rows from RowSources in sorted order.
 */
// tslint:disable:max-classes-per-file

import koArray, {KoArray} from 'app/client/lib/koArray';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {CompareFunc, sortedIndex} from 'app/common/gutil';
import {SkippableRows} from 'app/common/TableData';
import {RowFilterFunc} from "app/common/RowFilterFunc";
import {UIRowId} from 'app/plugin/GristAPI';
import {Observable} from 'grainjs';

/**
 * Special constant value that can be used for the `rows` array for the 'rowNotify'
 * event to indicate that the event applies to all rows.
 */
export const ALL: unique symbol = Symbol("ALL");

export type ChangeType = 'add' | 'remove' | 'update';
export type ChangeMethod = 'onAddRows' | 'onRemoveRows' | 'onUpdateRows';
export type RowList = Iterable<UIRowId>;
export type RowsChanged = RowList | typeof ALL;

// ----------------------------------------------------------------------
// RowSource
// ----------------------------------------------------------------------

/**
 * RowSource is an interface expected by RowListener. It should implement `getAllRows()` method,
 * and should emit `rowChange('add|remove|update', rows)` events on changes,
 * and `rowNotify(rows, value)` event to notify listeners of a value associated with a row.
 * For the `rowNotify` event, rows may be the rowset.ALL constant.
 */
export abstract class RowSource extends DisposableWithEvents {
  /**
   * Returns an iterable over all rows in this RowSource. Should be implemented by derived classes.
   */
  public abstract getAllRows(): RowList;

  /**
   * Returns the number of rows in this row source.
   */
  public abstract getNumRows(): number;
}

// ----------------------------------------------------------------------
// RowListener
// ----------------------------------------------------------------------

const _changeTypes: {[key: string]: ChangeMethod} = {
  add:    'onAddRows',
  remove: 'onRemoveRows',
  update: 'onUpdateRows',
};

/**
 * RowListener is the base class for collections that want to subscribe to rowset changes. It
 * offers `subscribeTo(rowSource)` method. The derived class should implement several methods
 * which will be called on row changes.
 */
export class RowListener extends DisposableWithEvents {
  /**
   * Subscribes to the given rowSource and adds the rows currently in it.
   */
  public subscribeTo(rowSource: RowSource): void {
    this.onAddRows(rowSource.getAllRows(), rowSource);
    this.listenTo(rowSource, 'rowChange', (changeType: ChangeType, rows: RowList) => {
      const method: ChangeMethod = _changeTypes[changeType];
      this[method](rows, rowSource);
    });
    this.listenTo(rowSource, 'rowNotify', this.onRowNotify);
  }

  /**
   * Unsubscribes from the given rowSource removing its rows. This is not needed for disposal;
   * dispose() on its own is sufficient and faster.
   */
  public unsubscribeFrom(rowSource: RowSource): void {
    this.stopListening(rowSource, 'rowChange');
    this.stopListening(rowSource, 'rowNotify');
    this.onRemoveRows(rowSource.getAllRows());
  }

  /**
   * Process row additions. To be implemented by derived classes.
   */
  protected onAddRows(rows: RowList, rowSource?: RowSource) { /* no-op */ }

  /**
   * Process row removals. To be implemented by derived classes.
   */
  protected onRemoveRows(rows: RowList, rowSource?: RowSource) { /* no-op */ }

  /**
   * Process row updates. To be implemented by derived classes.
   */
  protected onUpdateRows(rows: RowList, rowSource?: RowSource) { /* no-op */ }

  /**
   * Derived classes may override this event to handle row notifications. By default, it re-triggers
   * rowNotify on the RowListener itself.
   */
  protected onRowNotify(rows: RowList, notifyValue: any) {
    this.trigger('rowNotify', rows, notifyValue);
  }
}

// ----------------------------------------------------------------------
// MappedRowSource
// ----------------------------------------------------------------------

/**
 * MappedRowSource wraps any other RowSource, and passes through all rows, replacing each row
 * identifier with the result of mapperFunc(row) call.
 *
 * The underlying RowSource is exposed as this.parentRowSource.
 *
 * TODO: This class is not used anywhere at the moment, and is a candidate for removal.
 */
export class MappedRowSource extends RowSource {
  private _mapperFunc: (row: UIRowId) => UIRowId;

  constructor(
    public parentRowSource: RowSource,
    mapperFunc: (row: UIRowId) => UIRowId,
  ) {
    super();

    // Wrap mapperFunc to ensure arguments after the first one aren't passed on to it.
    this._mapperFunc = (row => mapperFunc(row));

    // Listen to the two event types a rowSource might produce, and map the rows in them.
    this.listenTo(parentRowSource, 'rowChange', (changeType: ChangeType, rows: RowList) => {
      this.trigger('rowChange', changeType, Array.from(rows, this._mapperFunc));
    });
    this.listenTo(parentRowSource, 'rowNotify', (rows: RowsChanged, notifyValue: any) => {
      this.trigger('rowNotify', rows === ALL ? ALL : Array.from(rows, this._mapperFunc), notifyValue);
    });
  }

  public getAllRows(): RowList {
    return Array.from(this.parentRowSource.getAllRows(), this._mapperFunc);
  }

  public getNumRows(): number {
    return this.parentRowSource.getNumRows();
  }
}

/**
 * A RowSource with some extra rows added.
 */
export class ExtendedRowSource extends RowSource {

  constructor(
    public parentRowSource: RowSource,
    public extras: UIRowId[]
  ) {
    super();

   // Listen to the two event types a rowSource might produce, and map the rows in them.
    this.listenTo(parentRowSource, 'rowChange', (changeType: ChangeType, rows: RowList) => {
      this.trigger('rowChange', changeType, rows);
    });
    this.listenTo(parentRowSource, 'rowNotify', (rows: RowsChanged, notifyValue: any) => {
      this.trigger('rowNotify', rows === ALL ? ALL : rows, notifyValue);
    });
  }

  public getAllRows(): RowList {
    return [...this.parentRowSource.getAllRows()].concat(this.extras);
  }

  public getNumRows(): number {
    return this.parentRowSource.getNumRows() + this.extras.length;
  }
}

// ----------------------------------------------------------------------
// FilteredRowSource
// ----------------------------------------------------------------------

interface FilterRowChanges {
  adds?: UIRowId[];
  updates?: UIRowId[];
  removes?: UIRowId[];
}

/**
 * See FilteredRowSource, for which this is the base. BaseFilteredRowSource is simpler, in that it
 * does not maintain excluded rows, and does not allow changes to filterFunc.
 */
export class BaseFilteredRowSource extends RowListener implements RowSource {
  protected _matchingRows: Set<UIRowId> = new Set();   // Set of rows matching the filter.

  constructor(protected _filterFunc: RowFilterFunc<UIRowId>) {
    super();
  }

  public getAllRows(): RowList {
    return this._matchingRows.values();
  }

  public getNumRows(): number {
    return this._matchingRows.size;
  }

  public onAddRows(rows: RowList) {
    const outputRows = [];
    for (const r of rows) {
      if (this._filterFunc(r)) {
        this._matchingRows.add(r);
        outputRows.push(r);
      } else {
        this._addExcludedRow(r);
      }
    }
    if (outputRows.length > 0) {
      this.trigger('rowChange', 'add', outputRows);
    }
  }

  public onRemoveRows(rows: RowList) {
    const outputRows = [];
    for (const r of rows) {
      if (this._matchingRows.delete(r)) {
        outputRows.push(r);
      }
      this._deleteExcludedRow(r);
    }
    if (outputRows.length > 0) {
      this.trigger('rowChange', 'remove', outputRows);
    }
  }

  public onUpdateRows(rows: RowList) {
    const changes = this._updateRowsHelper({}, rows);
    if (changes.removes) { this.trigger('rowChange', 'remove', changes.removes); }
    if (changes.updates) { this.trigger('rowChange', 'update', changes.updates); }
    if (changes.adds) { this.trigger('rowChange', 'add', changes.adds); }
  }

  public onRowNotify(rows: RowsChanged, notifyValue: any) {
    if (rows === ALL) {
      this.trigger('rowNotify', ALL, notifyValue);
    } else {
      const outputRows = [];
      for (const r of rows) {
        if (this._matchingRows.has(r)) {
          outputRows.push(r);
        }
      }
      if (outputRows.length > 0) {
        this.trigger('rowNotify', outputRows, notifyValue);
      }
    }
  }

  /**
   * Helper which goes through the given rows, applies _filterFunc() to them, and depending on the
   * result, adds the row to one of the arrays: changes.adds, changes.removes, or changes.updates.
   * Returns `changes` (the first parameter).
   */
  protected _updateRowsHelper(changes: FilterRowChanges, rows: RowList) {
    for (const r of rows) {
      if (this._filterFunc(r)) {
        if (this._matchingRows.has(r)) {
          (changes.updates || (changes.updates = [])).push(r);
        } else if (this._deleteExcludedRow(r)) {
          this._matchingRows.add(r);
          (changes.adds || (changes.adds = [])).push(r);
        }
      } else {
        if (this._matchingRows.delete(r)) {
          this._addExcludedRow(r);
          (changes.removes || (changes.removes = [])).push(r);
        }
      }
    }
    return changes;
  }

  // These are implemented by FilteredRowSource, but the base class doesn't need to do anything.
  protected _addExcludedRow(row: UIRowId): void { /* no-op */ }
  protected _deleteExcludedRow(row: UIRowId): boolean { return true; }
}

/**
 * FilteredRowSource can listen to any other RowSource, and passes through only the rows matching
 * the given filter function. In particular, an 'update' event may turn into an 'add' or 'remove'
 * if the row starts or stops matching the function.
 *
 * FilteredRowSource is also a RowListener, so to subscribe to a rowSource, use `subscribeTo()`.
 */
export class FilteredRowSource extends BaseFilteredRowSource {
  private _excludedRows: Set<UIRowId> = new Set();   // Set of rows NOT matching the filter.

  /**
   * Change the filter function. This may trigger 'remove' and 'add' events as necessary to indicate
   * that rows stopped or started matching the new filter.
   */
  public updateFilter(filterFunc: RowFilterFunc<UIRowId>) {
    this._filterFunc = filterFunc;
    const changes: FilterRowChanges = {};
    // After the first call, _excludedRows may have additional rows, but there is no harm in it,
    // as we know they don't match, and so will be ignored by _updateRowsHelper.
    this._updateRowsHelper(changes, this._matchingRows);
    this._updateRowsHelper(changes, this._excludedRows);
    if (changes.removes) { this.trigger('rowChange', 'remove', changes.removes); }
    if (changes.adds) { this.trigger('rowChange', 'add', changes.adds); }
  }

  /**
   * Re-apply the filter to the given rows, triggering add/remove events as needed. This is also
   * similar to what happens on an rowChange/update event from a RowSource, except that no 'update'
   * event is propagated if filter status hasn't changed.
   */
  public refilterRows(rows: RowList) {
    const changes = this._updateRowsHelper({}, rows);
    if (changes.removes) { this.trigger('rowChange', 'remove', changes.removes); }
    if (changes.adds) { this.trigger('rowChange', 'add', changes.adds); }
  }

  /**
   * Returns an iterable over all rows that got filtered out by this FilteredRowSource.
   */
  public getHiddenRows() {
    return this._excludedRows.values();
  }

  protected _addExcludedRow(row: UIRowId): void { this._excludedRows.add(row); }
  protected _deleteExcludedRow(row: UIRowId): boolean { return this._excludedRows.delete(row); }
}

// ----------------------------------------------------------------------
// RowGrouping
// ----------------------------------------------------------------------

/**
 * Private helper object that maintains a set of rows for a particular group.
 */
class RowGroupHelper<Value> extends RowSource {
  private _rows: Set<UIRowId> = new Set();
  constructor(public readonly groupValue: Value) {
    super();
  }

  public getAllRows() {
    return this._rows.values();
  }

  public getNumRows(): number {
    return this._rows.size;
  }

  public _addAll(rows: RowList) {
    for (const r of rows) { this._rows.add(r); }
  }

  public _removeAll(rows: RowList) {
    for (const r of rows) { this._rows.delete(r); }
  }
}

// ----------------------------------------------------------------------
/**
 * Helper function that does map.get(key).push(r), creating an Array for the given key if
 * necessary.
 */
function _addToMapOfArrays<K, V>(map: Map<K, V[]>, key: K, r: V): void {
  let arr = map.get(key);
  if (!arr) { map.set(key, arr = []); }
  arr.push(r);
}


/**
 * RowGrouping is a RowListener which groups rows by the results of _groupFunc(row) and exposes
 * per-group RowSources via getGroup(val).
 *
 * @param {Function} groupFunc: called with row identifier, should return the value to group by.
 *    The returned value must be a primitive value such as a String or Number.
 */
export class RowGrouping<Value> extends RowListener {
  // Maps row identifiers to groupValues.
  private _rowsToValues: Map<UIRowId, Value> = new Map();

  // Maps group values to RowGroupHelpers
  private _valuesToGroups: Map<Value, RowGroupHelper<Value>> = new Map();

  constructor(private _groupFunc: (row: UIRowId) => Value) {
    super();

    // On disposal, dispose all RowGroupHelpers that we maintain.
    this.onDispose(() => {
      for (const rowGroupHelper of this._valuesToGroups.values()) {
        rowGroupHelper.dispose();
      }
    });
  }

  /**
   * Returns a RowSource for the group of rows for which groupFunc(row) is equal to groupValue.
   */
  public getGroup(groupValue: Value): RowGroupHelper<Value> {
    let group = this._valuesToGroups.get(groupValue);
    if (!group) {
      group = new RowGroupHelper(groupValue);
      this._valuesToGroups.set(groupValue, group);
    }
    return group;
  }

  // Implementation of the RowListener interface.

  public onAddRows(rows: RowList) {
    const groupedRows = new Map();
    for (const r of rows) {
      const newValue = this._groupFunc(r);
      _addToMapOfArrays(groupedRows, newValue, r);
      this._rowsToValues.set(r, newValue);
    }

    groupedRows.forEach((groupRows, groupValue) => {
      const group = this.getGroup(groupValue);
      group._addAll(groupRows);
      group.trigger('rowChange', 'add', groupRows);
    });
  }

  public onRemoveRows(rows: RowList) {
    const groupedRows = new Map();
    for (const r of rows) {
      _addToMapOfArrays(groupedRows, this._rowsToValues.get(r), r);
      this._rowsToValues.delete(r);
    }

    // Note that we don't dispose the RowGroupHelper itself when it becomes empty, because this
    // group may be in use elsewhere (even if empty at the moment). RowGroupHelpers are only
    // disposed together with the RowGrouping object itself.
    groupedRows.forEach((groupRows, groupValue) => {
      const group = this._valuesToGroups.get(groupValue)!;
      group._removeAll(groupRows);
      group.trigger('rowChange', 'remove', groupRows);
    });
  }

  public onUpdateRows(rows: RowList) {
    let updateGroup, removeGroup, insertGroup;
    for (const r of rows) {
      const oldValue = this._rowsToValues.get(r);
      const newValue = this._groupFunc(r);
      if (newValue === oldValue) {
        _addToMapOfArrays(updateGroup || (updateGroup = new Map()), oldValue, r);
      } else {
        this._rowsToValues.set(r, newValue);
        _addToMapOfArrays(removeGroup || (removeGroup = new Map()), oldValue, r);
        _addToMapOfArrays(insertGroup || (insertGroup = new Map()), newValue, r);
      }
    }
    if (removeGroup) {
      removeGroup.forEach((groupRows, groupValue) => {
        const group = this._valuesToGroups.get(groupValue)!;
        group._removeAll(groupRows);
        group.trigger('rowChange', 'remove', groupRows);
      });
    }
    if (updateGroup) {
      updateGroup.forEach((groupRows, groupValue) => {
        const group = this._valuesToGroups.get(groupValue)!;
        group.trigger('rowChange', 'update', groupRows);
      });
    }
    if (insertGroup) {
      insertGroup.forEach((groupRows, groupValue) => {
        const group = this.getGroup(groupValue);
        group._addAll(groupRows);
        group.trigger('rowChange', 'add', groupRows);
      });
    }
  }

  public onRowNotify(rows: RowsChanged, notifyValue: any) {
    if (rows === ALL) {
      for (const group of this._valuesToGroups.values()) {
        group.trigger('rowNotify', ALL, notifyValue);
      }
    } else {
      const groupedRows = new Map();
      for (const r of rows) {
        _addToMapOfArrays(groupedRows, this._rowsToValues.get(r), r);
      }

      groupedRows.forEach((groupRows, groupValue) => {
        const group = this._valuesToGroups.get(groupValue)!;
        group.trigger('rowNotify', groupRows, notifyValue);
      });
    }
  }
}

// ----------------------------------------------------------------------
// SortedRowSet
// ----------------------------------------------------------------------

/**
 * SortedRowSet is a RowListener which maintains a set of rows in a sorted order, according to the
 * results of compareFunc. The sorted rows are exposed as an observable koArray.
 *
 * SortedRowSet re-emits 'rowNotify(rows, value)' events from RowSources that it subscribes to.
 */
export class SortedRowSet extends RowListener {
  private _allRows: Set<UIRowId> = new Set();
  private _isPaused: boolean = false;
  private _koArray: KoArray<UIRowId>;
  private _keepFunc?: (rowId: number|'new') => boolean;

  constructor(private _compareFunc: CompareFunc<UIRowId>,
              private _skippableRows?: SkippableRows) {
    super();
    this._koArray = this.autoDispose(koArray<UIRowId>());
    this._keepFunc = _skippableRows?.getKeepFunc();
  }

  /**
   * Returns the sorted observable koArray maintained by this SortedRowSet.
   */
  public getKoArray() {
    return this._koArray;
  }

  /**
   * Disable the populating of koArray temporarily. When pause(false) is called, the array is
   * brought back up to date. This is useful if there are multiple changes, e.g. subscriptions and
   * compareFunc updates, to avoid sorting multiple times.
   */
  public pause(doPause: boolean) {
    if (!doPause && this._isPaused) {
      this._koArray.assign(Array.from(this._allRows).sort(this._compareFunc));
    }
    this._isPaused = Boolean(doPause);
  }

  /**
   * Re-sorts the array according to the new compareFunc.
   */
  public updateSort(compareFunc: CompareFunc<UIRowId>): void {
    this._compareFunc = compareFunc;
    if (!this._isPaused) {
      this._koArray.assign(Array.from(this._koArray.peek()).sort(this._compareFunc));
    }
  }


  public onAddRows(rows: RowList) {
    for (const r of rows) {
      this._allRows.add(r);
    }
    if (this._isPaused) {
      return;
    }
    if (this._canChangeIncrementally(rows)) {
      for (const r of rows) {
        const insertIndex = sortedIndex(this._koArray.peek(), r, this._compareFunc);
        this._koArray.splice(insertIndex, 0, r);
      }
    } else {
      this._koArray.assign(this._keep(Array.from(this._allRows).sort(this._compareFunc)));
    }
  }

  public onRemoveRows(rows: RowList) {
    for (const r of rows) {
      this._allRows.delete(r);
    }
    if (this._isPaused) {
      return;
    }
    if (this._canChangeIncrementally(rows)) {
      for (const r of rows) {
        const index = this._koArray.peek().indexOf(r);
        if (index !== -1) {
          this._koArray.splice(index, 1);
        }
      }
    } else {
      this._koArray.assign(this._keep(Array.from(this._allRows).sort(this._compareFunc)));
    }
  }

  public onUpdateRows(rows: RowList) {
    // If paused, do nothing, since we'll re-sort later anyway.
    if (this._isPaused) {
      return;
    }

    // If all affected rows are in correct place relative to their neighbors, then the array is
    // still sorted, and there is nothing to do. (It's a common case when the update affects fields
    // not participating in the sort.)
    //
    // Note that the logic is all or none, since we can't assume that a single row is in its right
    // place by comparing to neighbors because the neighbors might themselves be affected and wrong.
    const sortedRows = Array.from(rows).sort(this._compareFunc);
    if (_allRowsSorted(this._koArray.peek(), this._allRows, sortedRows, this._compareFunc)) {
      return;
    }

    if (this._canChangeIncrementally(rows)) {
      // Note that we can't add any rows before we remove all affected rows, because affected rows
      // may no longer be in the correct sort order, so binary search is broken until they are gone.
      this.onRemoveRows(rows);
      this.onAddRows(rows);
    } else {
      this._koArray.assign(this._keep(Array.from(this._koArray.peek()).sort(this._compareFunc)));
    }
  }

  // Check whether a change in the specified rows can be applied incrementally.
  private _canChangeIncrementally(rows: RowList) {
    return !this._keepFunc && isSmallChange(rows);
  }

  // Filter out any rows that should be skipped. This is a no-op if no _keepFunc was found.
  // All rows that sort within nContext rows of something meant to be kept are also kept.
  private _keep(rows: UIRowId[], nContext: number = 2) {
    // Nothing to be done if there's no _keepFunc.
    if (!this._keepFunc) { return rows; }

    // Seed a list of rows to be kept (we'll expand it as we go).
    const keeping = rows.map(this._keepFunc);

    // Within a range of skipped rows, we'll keep one as an interstitial, with its
    // rowId replaced with a special "skip" id that makes it get rendered a special
    // way (with "..." in every cell).
    // Start with a blank list (we'll fill it out as we go).
    const edge = rows.map(() => false);

    // Keep the first and last (typically 'new') row.
    const n = rows.length;
    if (n >= 1) { keeping[0] = true; }
    if (n >= 2) { keeping[n - 1] = true; }

    // Sweep forwards through the list of kept rows, keeping an extra nContext rows
    // after each.
    let last = - nContext - 1;
    for (let i = 0; i < n; i++) {
      if (keeping[i]) { last = i; }
      else if (i - last <= nContext) { keeping[i] = true; }
    }

    // Sweep backwards through the list of kept rows, keeping an extra nContext rows
    // before each.
    last = n + nContext + 1;
    for (let i = n - 1; i >= 0; i--) {
      if (keeping[i]) { last = i; }
      else if (last - i <= nContext) { keeping[i] = true; }
    }

    // Keep one extra "edge" row from each sequence of rows that are to be skipped.
    let skipping: boolean = false;
    for (let i = 0; i < n; i++) {
      if (keeping[i]) {
        skipping = false;
      } else {
        if (!skipping) {
          edge[i] = true;
          skipping = true;
        }
      }
    }

    // Go ahead and filter out the rows to keep, tweaking the row id of the
    // "edge" rows.
    const skipRowId = this._skippableRows?.getSkipRowId() || 0;
    return rows
      .map((v, i) => edge[i] ? skipRowId : v)
      .filter((v, i) => keeping[i] || edge[i] || v === 'new');
  }
}

type RowTester = (rowId: UIRowId) => boolean;
/**
 * RowWatcher is a RowListener that maintains an observable function that checks whether a row
 * is in the connected RowSource.
 */
export class RowWatcher extends RowListener {
  /**
   * Observable function that returns true if the row is in the connected RowSource.
   */
  public rowFilter: Observable<RowTester> = Observable.create(this, () => false);
  // We count the number of times the row is added or removed from the source.
  // In most cases row is added and removed only once.
  private _rowCounter: Map<UIRowId, number> = new Map();

  public clear() {
    this._rowCounter.clear();
    this.rowFilter.set(() => false);
    this.stopListening();
  }

  protected onAddRows(rows: RowList) {
    for (const r of rows) {
      this._rowCounter.set(r, (this._rowCounter.get(r) || 0) + 1);
    }
    this.rowFilter.set((row) => (this._rowCounter.get(row) ?? 0) > 0);
  }

  protected onRemoveRows(rows: RowList) {
    for (const r of rows) {
      this._rowCounter.set(r, (this._rowCounter.get(r) || 0) - 1);
    }
    this.rowFilter.set((row) => (this._rowCounter.get(row) ?? 0) > 0);
  }
}

function isSmallChange(rows: RowList) {
  return Array.isArray(rows) && rows.length <= 2;
}

/**
 * Helper function to tell if array[index] is in order relative to its neighbors.
 */
function _isIndexInOrder<T>(array: T[], index: number, compareFunc: CompareFunc<T>): boolean {
  const r = array[index];
  return ((index === 0 || compareFunc(array[index - 1], r) <= 0) &&
          (index === array.length - 1 || compareFunc(r, array[index + 1]) <= 0));
}

/**
 * Helper function to tell if each of sortedRows, if present in the array, is in order relative to
 * its neighbors. sortedRows should be sorted the same way as the array.
 */
function _allRowsSorted<T>(array: T[], allRows: Set<T>, sortedRows: Iterable<T>, compareFunc: CompareFunc<T>): boolean {
  let last = 0;
  for (const r of sortedRows) {
    if (!allRows.has(r)) {
      continue;
    }
    const index = array.indexOf(r, last);
    if (index === -1 || !_isIndexInOrder(array, index, compareFunc)) {
      // rows of sortedRows are not present in the array in the same relative order.
      return false;
    }
    last = index;
  }
  return true;
}


/**
 * Track rows that should temporarily be visible even if they don't match filters.
 * This is so that a newly added row doesn't immediately disappear, which would be confusing.
 * This doesn't have much to do with BaseFilteredRowSource, it's just reusing some implementation.
 */
export class ExemptFromFilterRowSource extends BaseFilteredRowSource {
  public constructor() {
    super(() => false);
  }

  /**
   * Call this when one or more new rows are added to keep them temporarily visible.
   */
  public addExemptRows(rows: RowList) {
    const newRows = [];
    for (const r of rows) {
      if (!this._matchingRows.has(r)) {
        this._matchingRows.add(r);
        newRows.push(r);
      }
    }
    if (newRows.length > 0) {
      this.trigger('rowChange', 'add', newRows);
    }
  }

  public addExemptRow(rowId: number) {
    this.addExemptRows([rowId]);
  }

  /**
   * Call this when linking or filters change to clear out the temporary rows.
   */
  public reset() {
    this.onRemoveRows(this.getAllRows());
  }

  public onUpdateRows() { /* no-op */ }
}
