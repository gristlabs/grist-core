// tslint:disable:no-console
// TODO: Add documentation and clean up log statements.

import {GristDoc} from 'app/client/components/GristDoc';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {delay} from 'app/common/delay';
import {waitObs} from 'app/common/gutil';
import {TableData} from 'app/common/TableData';
import {BaseFormatter, createFormatter} from 'app/common/ValueFormatter';
import {Disposable, Observable} from 'grainjs';
import debounce = require('lodash/debounce');

/**
 * SearchModel used to maintain the state of the search UI.
 */
export interface SearchModel {
  value: Observable<string>;       // string in the search input
  isOpen: Observable<boolean>;     // indicates whether the search bar is expanded to show the input
  noMatch: Observable<boolean>;    // indicates if there are no search matches
  isEmpty: Observable<boolean>;     // indicates whether the value is empty
  isRunning: Observable<boolean>;  // indicates that matching is in progress
  multiPage: Observable<boolean>;   // if true will search across all pages

  findNext(): Promise<void>;       // find next match
  findPrev(): Promise<void>;       // find previous match
}

interface SearchPosition {
  tabIndex: number;
  sectionIndex: number;
  rowIndex: number;
  fieldIndex: number;
}

class Stepper<T> {
  public array: ReadonlyArray<T> = [];
  public index: number = 0;

  public inRange() {
    return this.index >= 0 && this.index < this.array.length;
  }

  // Doing await at every step adds a ton of overhead; we can optimize by returning and waiting on
  // Promises only when needed.
  public next(step: number, nextArrayFunc: () => Promise<void>|void): Promise<void>|void {
    this.index += step;
    if (!this.inRange()) {
      // If index reached the end of the array, take a step at a higher level to get a new array.
      // For efficiency, only wait asynchronously if the callback returned a promise.
      const p = nextArrayFunc();
      if (p) {
        return p.then(() => this.setStart(step));
      } else {
        this.setStart(step);
      }
    }
  }

  public setStart(step: number) {
    this.index = step > 0 ? 0 : this.array.length - 1;
  }

  public get value(): T { return this.array[this.index]; }
}

/**
 * Implementation of SearchModel used to construct the search UI.
 */
export class SearchModelImpl extends Disposable implements SearchModel {
  public readonly value = Observable.create(this, '');
  public readonly isOpen = Observable.create(this, false);
  public readonly isRunning = Observable.create(this, false);
  public readonly noMatch = Observable.create(this, true);
  public readonly isEmpty = Observable.create(this, true);
  public readonly multiPage = Observable.create(this, false);
  private _searchRegexp: RegExp;
  private _tabStepper = new Stepper<any>();
  private _sectionStepper = new Stepper<ViewSectionRec>();
  private _sectionTableData: TableData;
  private _rowStepper = new Stepper<number>();
  private _fieldStepper = new Stepper<ViewFieldRec>();
  private _fieldFormatters: BaseFormatter[];
  private _startPosition: SearchPosition;
  private _tabsSwitched: number = 0;
  private _isRestartNeeded: boolean = false;

  constructor(private _gristDoc: GristDoc) {
    super();

    // Listen to input value changes (debounced) to activate searching.
    const findFirst = debounce((_value: string) => this._findFirst(_value), 100);
    this.autoDispose(this.value.addListener(v => { void findFirst(v); }));

    // Set this.noMatch to false when multiPage gets turned ON.
    this.autoDispose(this.multiPage.addListener(v => { if (v) { this.noMatch.set(false); }}));

    // Schedule a search restart when user changes pages (otherwise search would resume from the
    // previous page that is not shown anymore). Also revert noMatch flag when in single page mode.
    this.autoDispose(this._gristDoc.activeViewId.addListener(() => {
      if (!this.multiPage.get()) { this.noMatch.set(false); }
      this._isRestartNeeded = true;
    }));
  }

  public async findNext() {
    if (this.noMatch.get()) { return; }
    if (this._isRestartNeeded) { return this._findFirst(this.value.get()); }
    this._startPosition = this._getCurrentPosition();
    await this._nextField(1);
    return this._matchNext(1);
  }

  public async findPrev() {
    if (this.noMatch.get()) { return; }
    if (this._isRestartNeeded) { return this._findFirst(this.value.get()); }
    this._startPosition = this._getCurrentPosition();
    await this._nextField(-1);
    return this._matchNext(-1);
  }

  private _findFirst(value: string) {
    this._isRestartNeeded = false;
    this.isEmpty.set(!value);
    if (!value) { this.noMatch.set(true); return; }
    this._searchRegexp = makeRegexp(value);
    const tabs: any[] = this._gristDoc.docModel.allDocPages.peek();
    this._tabStepper.array = tabs;
    this._tabStepper.index = tabs.findIndex(t => t.viewRef() === this._gristDoc.activeViewId.get());
    if (this._tabStepper.index < 0) { this.noMatch.set(true); return; }

    const view = this._tabStepper.value.view.peek();
    const sections: any[] = view.viewSections().peek();
    this._sectionStepper.array = sections;
    this._sectionStepper.index = sections.findIndex(s => s.getRowId() === view.activeSectionId());
    if (this._sectionStepper.index < 0) { this.noMatch.set(true); return; }

    this._initNewSectionShown();

    // Find the current cursor position in the current section.
    const viewInstance = this._sectionStepper.value.viewInstance.peek()!;
    const pos = viewInstance.cursor.getCursorPos();
    this._rowStepper.index = pos.rowIndex!;
    this._fieldStepper.index = pos.fieldIndex!;

    this._startPosition = this._getCurrentPosition();
    return this._matchNext(1);
  }

  private async _matchNext(step: number): Promise<void> {
    const indicatorTimer = setTimeout(() => this.isRunning.set(true), 300);
    try {
      const searchRegexp = this._searchRegexp;
      let count = 0;
      let lastBreak = Date.now();

      this._tabsSwitched = 0;
      while (!this._matches() || ((await this._loadSection(step)) && !this._matches())) {
        // To avoid hogging the CPU for too long, check time periodically, and if we've been running
        // for long enough, take a brief break. We choose a 5ms break every 20ms; and only check
        // time every 100 iterations, to avoid excessive overhead purely due to time checks.
        if ((++count) % 100 === 0 && Date.now() >= lastBreak + 20) {
          await delay(5);
          lastBreak = Date.now();

          // After other code had a chance to run, it's possible that we are now searching for
          // something else, in which case abort this task.
          if (this._searchRegexp !== searchRegexp) {
            console.log("SearchBar: aborting search since a new one was started");
            return;
          }
        }

        const p = this._nextField(step);
        if (p) { await p; }

        // Detect when we get back to the start position; this is where we break on no match.
        if (this._isCurrentPosition(this._startPosition) && !this._matches()) {
          console.log("SearchBar: reached start position without finding anything");
          this.noMatch.set(true);
          return;
        }

        // A fail-safe to prevent certain bugs from causing infinite loops; break also if we scan
        // through tabs too many times.
        // TODO: test it by disabling the check above.
        if (this._tabsSwitched > this._tabStepper.array.length) {
          console.log("SearchBar: aborting search due to too many tab switches");
          this.noMatch.set(true);
          return;
        }
      }
      console.log("SearchBar: found a match at %s", JSON.stringify(this._getCurrentPosition()));
      this.noMatch.set(false);
      await this._highlight();
    } finally {
      clearTimeout(indicatorTimer);
      this.isRunning.set(false);
    }
  }

  private _getCurrentPosition(): SearchPosition {
    // It's important to call _getCurrentPosition() in the visible tab, since other tabs will not
    // use the currently visible version of the data (with the same sort and filter).
    return {
      tabIndex: this._tabStepper.index,
      sectionIndex: this._sectionStepper.index,
      rowIndex: this._rowStepper.index,
      fieldIndex: this._fieldStepper.index,
    };
  }

  private _isCurrentPosition(pos: SearchPosition): boolean {
    return (
      this._tabStepper.index === pos.tabIndex &&
      this._sectionStepper.index === pos.sectionIndex &&
      this._rowStepper.index === pos.rowIndex &&
      this._fieldStepper.index === pos.fieldIndex
    );
  }

  private _nextField(step: number): Promise<void>|void {
    return this._fieldStepper.next(step, () => this._nextRow(step));
    // console.log("nextField", this._fieldStepper.index);
  }

  private _nextRow(step: number) {
    return this._rowStepper.next(step, () => this._nextSection(step));
    // console.log("nextRow", this._rowStepper.index);
  }

  private async _nextSection(step: number) {
    // Switching sections is rare enough that we don't worry about optimizing away `await` calls.
    await this._sectionStepper.next(step, () => this._nextTab(step));
    // console.log("nextSection", this._sectionStepper.index);
    await this._initNewSectionAny();
  }

    // TODO There are issues with filtering. A section may have filters applied, and it may be
    // auto-filtered (linked sections). If a tab is shown, we have the filtered list of rowIds; if
    // the tab is not shown, it takes work to apply explicit filters. For linked sections, the
    // sensible behavior seems to scan through ALL values, then once a match is found, set the
    // cursor that determines the linking to include the matched row. And even that may not always
    // be possible. So this is an open question.

  private _initNewSectionCommon() {
    const section = this._sectionStepper.value;
    const tableModel = this._gristDoc.getTableModel(section.table.peek().tableId.peek());
    this._sectionTableData = tableModel.tableData;

    this._fieldStepper.array = section.viewFields().peek();
    this._fieldFormatters = this._fieldStepper.array.map(
      f => createFormatter(f.displayColModel().type(), f.widgetOptionsJson()));
    return tableModel;
  }

  private _initNewSectionShown() {
    this._initNewSectionCommon();
    const viewInstance = this._sectionStepper.value.viewInstance.peek()!;
    this._rowStepper.array = viewInstance.sortedRows.getKoArray().peek() as number[];
  }

  private async _initNewSectionAny() {
    const tableModel = this._initNewSectionCommon();

    const viewInstance = this._sectionStepper.value.viewInstance.peek();
    if (viewInstance) {
      this._rowStepper.array = viewInstance.sortedRows.getKoArray().peek() as number[];
    } else {
      // If we are searching through another tab (not currently loaded), we will NOT have a
      // viewInstance, but we use the unsorted unfiltered row list, and if we find a match, the
      // _loadSection() method will load the tab and we'll repeat the search with a viewInstance.
      await tableModel.fetch();
      this._rowStepper.array = this._sectionTableData.getRowIds();
    }
  }

  private async _nextTab(step: number) {
    if (!this.multiPage.get()) { return; }
    await this._tabStepper.next(step, () => undefined);
    this._tabsSwitched++;
    // console.log("nextTab", this._tabStepper.index);

    const view = this._tabStepper.value.view.peek();
    this._sectionStepper.array = view.viewSections().peek();
  }

  private _matches(): boolean {
    if (this._tabStepper.index < 0 || this._sectionStepper.index < 0 ||
        this._rowStepper.index < 0 || this._fieldStepper.index < 0) {
      console.warn("match outside");
      return false;
    }
    const field = this._fieldStepper.value;
    const formatter = this._fieldFormatters[this._fieldStepper.index];
    const rowId = this._rowStepper.value;
    const displayCol = field.displayColModel.peek();

    const value = this._sectionTableData.getValue(rowId, displayCol.colId.peek());

    // TODO: Note that formatting dates is now the bulk of the performance cost.
    const text = formatter.format(value);
    return this._searchRegexp.test(text);
  }

  private async _loadSection(step: number): Promise<boolean> {
    // If we found a match in a section for which we don't have a valid BaseView instance, we need
    // to load the BaseView and start searching the section again, since the match we found does
    // not take into account sort or filters. So we switch to the right tab, wait for the
    // viewInstance to be created, reset the section info, and return true to continue searching.
    const section = this._sectionStepper.value;
    if (!section.viewInstance.peek()) {
      const view = this._tabStepper.value.view.peek();
      await this._openDocPage(view.getRowId());
      console.log("SearchBar: loading view %s section %s", view.getRowId(), section.getRowId());
      const viewInstance: any = await waitObs(section.viewInstance);
      await viewInstance.getLoadingDonePromise();
      this._initNewSectionShown();
      this._rowStepper.setStart(step);
      this._fieldStepper.setStart(step);
      console.log("SearchBar: loaded view %s section %s", view.getRowId(), section.getRowId());
      return true;
    }
    return false;
  }

  // Highlights the cell at the current position.
  private async _highlight() {
    const view = this._tabStepper.value.view.peek();
    await this._gristDoc.openDocPage(view.getRowId());

    const section = this._sectionStepper.value;
    view.activeSectionId(section.getRowId());

    // We may need to wait for the BaseView instance to load.
    const viewInstance = await waitObs<any>(section.viewInstance);
    await viewInstance.getLoadingDonePromise();
    viewInstance.setCursorPos({
      rowIndex: this._rowStepper.index,
      fieldIndex: this._fieldStepper.index,
    });

    // Highlight the selected cursor, after giving it a chance to update. We find the cursor in
    // this ad-hoc way rather than use observables, to avoid the overhead of *every* cell
    // depending on an additional observable.
    await delay(0);
    const cursor = viewInstance.viewPane.querySelector('.selected_cursor');
    if (cursor) {
      cursor.classList.add('search-match');
      setTimeout(() => cursor.classList.remove('search-match'), 20);
    }
  }

  // Opens doc page without triggering a restart.
  private async _openDocPage(viewId: number) {
    await this._gristDoc.openDocPage(viewId);
    this._isRestartNeeded = false;
  }
}

function makeRegexp(value: string) {
  // From https://stackoverflow.com/a/3561711/328565
  const escaped = value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(escaped, 'i');
}
