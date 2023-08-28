// tslint:disable:no-console
// TODO: Add documentation and clean up log statements.

import {GristDoc} from 'app/client/components/GristDoc';
import {PageRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {delay} from 'app/common/delay';
import {IDocPage} from 'app/common/gristUrls';
import {nativeCompare, waitObs} from 'app/common/gutil';
import {TableData} from 'app/common/TableData';
import {BaseFormatter} from 'app/common/ValueFormatter';
import { makeT } from 'app/client/lib/localization';
import {CursorPos} from 'app/plugin/GristAPI';
import {Computed, Disposable, Observable} from 'grainjs';
import debounce = require('lodash/debounce');

const t = makeT('SearchModel');

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
  allLabel: Observable<string>;   // label to show instead of default 'Search all pages'

  findNext(): Promise<void>;       // find next match
  findPrev(): Promise<void>;       // find previous match
}

interface SearchPosition {
  pageIndex: number;
  sectionIndex: number;
  rowIndex: number;
  fieldIndex: number;
}

/**
 * Stepper is an helper class that is used to implement stepping through all the cells of a
 * document. Fields belongs to rows, rows belongs to section and sections to pages. So this is four
 * steppers that must be used together, one for each level (field, rows, section and pages). When a
 * stepper reaches the end of its array, this is the `nextArrayFunc` callback, passed to the
 * `next()`, that is responsible for both taking a step at the higher level and updating the
 * stepper's array.
 */
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
 * Interface that represents an ongoing search job which stops on the first match found.
 */
interface IFinder {
  matchFound: boolean;             // true if a match was found
  startPosition: SearchPosition;   // position at which to stop searching for a new match
  abort(): void;                   // abort current search
  matchNext(step: number): Promise<void>;      // next match
  nextField(step: number): Promise<void>|void; // move the current position
  getCurrentPosition(): SearchPosition;        // get the current position
}

// A callback to opening a page: useful to switch to next page during an ongoing search.
type DocPageOpener = (viewId: IDocPage) => Promise<void>;

// To support Raw Data Views we will introduce a 'wrapped' page abstraction. Raw data
// page is not a true page (it doesn't have a record), this will allow as to treat a raw view section
// as if it were a PageRec.
interface ISearchablePageRec {
  viewSections(): ViewSectionRec[];
  activeSectionId(): number;
  getViewId(): IDocPage;
  openPage(): Promise<void>;
}

class RawSectionWrapper implements ISearchablePageRec {
  constructor(private _section: ViewSectionRec) {

  }
  public viewSections(): ViewSectionRec[] {
    return [this._section];
  }

  public activeSectionId() {
    return this._section.id.peek();
  }

  public getViewId(): IDocPage {
    return 'data';
  }

  public async openPage() {
    this._section.view.peek().activeSectionId(this._section.getRowId());
    await waitObs(this._section.viewInstance);
    await this._section.viewInstance.peek()?.getLoadingDonePromise();
  }
}

class PageRecWrapper implements ISearchablePageRec {
  constructor(private _page: PageRec, private _opener: DocPageOpener) {

  }
  public viewSections(): ViewSectionRec[] {
    const sections = this._page.view.peek().viewSections.peek().peek();
    const collapsed = new Set(this._page.view.peek().activeCollapsedSections.peek());
    const activeSectionId = this._page.view.peek().activeSectionId.peek();
    // If active section is collapsed, it means it is rendered in the popup, so narrow
    // down the search to only it.
    const inPopup = collapsed.has(activeSectionId);
    if (inPopup) {
      return sections.filter((s) => s.getRowId() === activeSectionId);
    }
    return sections.filter((s) => !collapsed.has(s.getRowId()));
  }

  public activeSectionId() {
    return this._page.view.peek().activeSectionId.peek();
  }

  public getViewId() {
    return this._page.view.peek().getRowId();
  }

  public openPage() {
    return this._opener(this.getViewId());
  }
}

//activeSectionId

/**
 * An implementation of an IFinder.
 */
class FinderImpl implements IFinder {
  public matchFound = false;
  public startPosition: SearchPosition;

  private _searchRegexp: RegExp;
  private _pageStepper = new Stepper<ISearchablePageRec>();
  private _sectionStepper = new Stepper<ViewSectionRec>();
  private _sectionTableData: TableData;
  private _rowStepper = new Stepper<number>();
  private _fieldStepper = new Stepper<ViewFieldRec>();
  private _fieldFormatters: [ViewFieldRec, BaseFormatter][];
  private _pagesSwitched: number = 0;
  private _aborted = false;
  private _clearCursorHighlight: (() => void)|undefined;

  constructor(private _gristDoc: GristDoc, value: string, private _openDocPageCB: DocPageOpener,
              public multiPage: Observable<boolean>) {
    this._searchRegexp = makeRegexp(value);
  }

  public abort() {
    this._aborted = true;
    if (this._clearCursorHighlight) { this._clearCursorHighlight(); }
  }

  public getCurrentPosition(): SearchPosition {
    return {
      pageIndex: this._pageStepper.index,
      sectionIndex: this._sectionStepper.index,
      rowIndex: this._rowStepper.index,
      fieldIndex: this._fieldStepper.index,
    };
  }

  // Initialize the steppers. Returns false if anything goes wrong.
  public async init(): Promise<boolean> {
    // If we are on a raw view page, pretend that we are looking at true pages.
    if ('data' === this._gristDoc.activeViewId.get()) {
      // Get all raw sections.
      const rawSections = this._gristDoc.docModel.visibleTables.peek()
                              // sort in order that is the same as on the raw data list page,
                              .sort((a, b) => nativeCompare(a.tableNameDef.peek(), b.tableNameDef.peek()))
                              // get rawViewSection,
                              .map(table => table.rawViewSection.peek())
                              // and test if it isn't an empty record.
                              .filter(s => Boolean(s.id.peek()));
      // Pretend that those are pages.
      this._pageStepper.array = rawSections.map(r => new RawSectionWrapper(r));
      // Find currently selected one (by comparing to active section id)
      this._pageStepper.index = rawSections.findIndex(s =>
        s.getRowId() === this._gristDoc.viewModel.activeSectionId.peek());
      // If we are at listing, where no section is active open the first page. Otherwise, search will fail.
      if (this._pageStepper.index < 0) {
        this._pageStepper.index = 0;
        await this._pageStepper.value.openPage();
      }
    } else {
      // Else read all visible pages.
      const pages = this._gristDoc.docModel.visibleDocPages.peek();
      this._pageStepper.array = pages.map(p => new PageRecWrapper(p, this._openDocPageCB));
      this._pageStepper.index = pages.findIndex(page => page.viewRef.peek() === this._gristDoc.activeViewId.get());
      if (this._pageStepper.index < 0) { return false; }
    }

    const sections = this._pageStepper.value.viewSections();
    this._sectionStepper.array = sections;
    this._sectionStepper.index = sections.findIndex(s => s.getRowId() === this._pageStepper.value.activeSectionId());
    if (this._sectionStepper.index < 0) { return false; }

    this._initNewSectionShown();

    // Find the current cursor position in the current section.
    const viewInstance = this._sectionStepper.value.viewInstance.peek()!;
    const pos = viewInstance.cursor.getCursorPos();
    this._rowStepper.index = pos.rowIndex!;
    this._fieldStepper.index = pos.fieldIndex!;
    return true;
  }

  public async matchNext(step: number): Promise<void> {
    let count = 0;
    let lastBreak = Date.now();

    this._pagesSwitched = 0;

    while (!this._matches() || ((await this._loadSection(step)) && !this._matches())) {

      // If search was aborted, simply returns.
      if (this._aborted) { return; }

      // To avoid hogging the CPU for too long, check time periodically, and if we've been running
      // for long enough, take a brief break. We choose a 5ms break every 20ms; and only check
      // time every 100 iterations, to avoid excessive overhead purely due to time checks.
      if ((++count) % 100 === 0 && Date.now() >= lastBreak + 20) {
        await delay(5);
        lastBreak = Date.now();
      }

      const p = this.nextField(step);
      if (p) { await p; }

      // Detect when we get back to the start position; this is where we break on no match.
      if (this._isCurrentPosition(this.startPosition) && !this._matches()) {
        console.log("SearchBar: reached start position without finding anything");
        this.matchFound = false;
        return;
      }

      // A fail-safe to prevent certain bugs from causing infinite loops; break also if we scan
      // through pages too many times.
      // TODO: test it by disabling the check above.
      if (this._pagesSwitched > this._pageStepper.array.length) {
        console.log("SearchBar: aborting search due to too many page switches");
        this.matchFound = false;
        return;
      }
    }
    console.log("SearchBar: found a match at %s", JSON.stringify(this.getCurrentPosition()));
    this.matchFound = true;
    await this._highlight();
  }

  public nextField(step: number): Promise<void>|void {
    return this._fieldStepper.next(step, () => this._nextRow(step));
  }

  private _nextRow(step: number) {
    return this._rowStepper.next(step, () => this._nextSection(step));
  }

  private async _nextSection(step: number) {
    // Switching sections is rare enough that we don't worry about optimizing away `await` calls.
    await this._sectionStepper.next(step, () => this._nextPage(step));
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
    this._initFormatters();
    return tableModel;
  }

  private _initNewSectionShown() {
    this._initNewSectionCommon();
    const viewInstance = this._sectionStepper.value.viewInstance.peek()!;
    const skip = ['chart'].includes(this._sectionStepper.value.parentKey.peek());
    this._rowStepper.array = skip ? [] : viewInstance.sortedRows.getKoArray().peek() as number[];
  }

  private async _initNewSectionAny() {
    const tableModel = this._initNewSectionCommon();

    const viewInstance = this._sectionStepper.value.viewInstance.peek();
    const skip = ['chart'].includes(this._sectionStepper.value.parentKey.peek());
    if (skip) {
      this._rowStepper.array = [];
    } else if (viewInstance) {
      this._rowStepper.array = viewInstance.sortedRows.getKoArray().peek() as number[];
    } else {
      // If we are searching through another page (not currently loaded), we will NOT have a
      // viewInstance, but we use the unsorted unfiltered row list, and if we find a match, the
      // _loadSection() method will load the page and we'll repeat the search with a viewInstance.
      await tableModel.fetch();
      this._rowStepper.array = this._sectionTableData.getRowIds();
    }
  }

  private async _nextPage(step: number) {
    if (!this.multiPage.get()) { return; }
    await this._pageStepper.next(step, () => undefined);
    this._pagesSwitched++;

    const view = this._pageStepper.value;
    this._sectionStepper.array = view.viewSections();
  }

  private _initFormatters() {
    this._fieldFormatters = this._fieldStepper.array.map(f => [f, f.formatter.peek()]);
  }

  private _matches(): boolean {
    if (this._pageStepper.index < 0 || this._sectionStepper.index < 0 ||
        this._rowStepper.index < 0 || this._fieldStepper.index < 0) {
      console.warn("match outside");
      return false;
    }
    const field = this._fieldStepper.value;
    let formatter = this._fieldFormatters[this._fieldStepper.index];
    // When fields are removed during search (or reordered) we need to update
    // formatters we retrieved on init.
    if (!formatter || formatter[0 /* field */] !== field) {
      this._initFormatters();
      formatter = this._fieldFormatters[this._fieldStepper.index];
    }
    const rowId = this._rowStepper.value;
    const displayCol = field.displayColModel.peek();

    const value = this._sectionTableData.getValue(rowId, displayCol.colId.peek());

    // TODO: Note that formatting dates is now the bulk of the performance cost.
    const text = formatter[1  /* formatter */].formatAny(value);
    return this._searchRegexp.test(text);
  }

  private async _loadSection(step: number): Promise<boolean> {
    // If we found a match in a section for which we don't have a valid BaseView instance, we need
    // to load the BaseView and start searching the section again, since the match we found does
    // not take into account sort or filters. So we switch to the right page, wait for the
    // viewInstance to be created, reset the section info, and return true to continue searching.
    const section = this._sectionStepper.value;
    if (!section.viewInstance.peek()) {
      const view = this._pageStepper.value;
      if (this._aborted) { return false; }
      await view.openPage();
      console.log("SearchBar: loading view %s section %s", view.getViewId(), section.getRowId());
      const viewInstance: any = await waitObs(section.viewInstance);
      await viewInstance.getLoadingDonePromise();
      this._initNewSectionShown();
      this._rowStepper.setStart(step);
      this._fieldStepper.setStart(step);
      console.log("SearchBar: loaded view %s section %s", view.getViewId(), section.getRowId());
      return true;
    }
    return false;
  }

  // Highlights the cell at the current position.
  private async _highlight() {
    if (this._aborted) { return; }

    const section = this._sectionStepper.value;
    const sectionId = section.getRowId();
    const cursorPos: CursorPos = {
      sectionId,
      rowId: this._rowStepper.value,
      fieldIndex: this._fieldStepper.index,
    };
    await this._gristDoc.recursiveMoveToCursorPos(cursorPos, true).catch(reportError);
    if (this._aborted) { return; }

    // Highlight the selected cursor, after giving it a chance to update. We find the cursor in
    // this ad-hoc way rather than use observables, to avoid the overhead of *every* cell
    // depending on an additional observable.
    await delay(0);
    const viewInstance = (await waitObs(section.viewInstance))!;
    await viewInstance.getLoadingDonePromise();
    if (this._aborted) { return; }
    // Make sure we are at good place. This is important when the cursor
    // was already in a matched record, but the record was scrolled away.
    viewInstance.scrollToCursor(true).catch(reportError);

    const cursor = viewInstance.viewPane.querySelector('.selected_cursor');
    if (cursor) {
      cursor.classList.add('search-match');
      this._clearCursorHighlight = () => {
        cursor.classList.remove('search-match');
        clearTimeout(timeout);
        this._clearCursorHighlight = undefined;
      };
      const timeout = setTimeout(this._clearCursorHighlight, 20);
    }
  }

  private _isCurrentPosition(pos: SearchPosition): boolean {
    return (
      this._pageStepper.index === pos.pageIndex &&
        this._sectionStepper.index === pos.sectionIndex &&
        this._rowStepper.index === pos.rowIndex &&
        this._fieldStepper.index === pos.fieldIndex
    );
  }
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
  public readonly allLabel: Computed<string>;

  private _isRestartNeeded = false;
  private _finder: IFinder|null = null;

  constructor(private _gristDoc: GristDoc) {
    super();

    // Listen to input value changes (debounced) to activate searching.
    const findFirst = debounce((_value: string) => this._findFirst(_value), 100);
    this.autoDispose(this.value.addListener(v => { this.isRunning.set(true); void findFirst(v); }));

    // Set this.noMatch to false when multiPage gets turned ON.
    this.autoDispose(this.multiPage.addListener(v => { if (v) { this.noMatch.set(false); } }));

    this.allLabel = Computed.create(this, use => use(this._gristDoc.activeViewId) === 'data' ?
      t('Search all tables') : t('Search all pages'));

    // Schedule a search restart when user changes pages (otherwise search would resume from the
    // previous page that is not shown anymore). Also revert noMatch flag when in single page mode.
    this.autoDispose(this._gristDoc.activeViewId.addListener(() => {
      if (!this.multiPage.get()) { this.noMatch.set(false); }
      this._isRestartNeeded = true;
    }));

    // On Raw data view, whenever table is closed (so activeSectionId = 0), restart search.
    this.autoDispose(this._gristDoc.viewModel.activeSectionId.subscribe((sectionId) => {
      if (this._gristDoc.activeViewId.get() === 'data' && sectionId === 0) {
        this._isRestartNeeded = true;
        this.noMatch.set(false);
      }
    }));
  }

  public async findNext() {
    if (this.isRunning.get() || this.noMatch.get()) { return; }
    if (this._isRestartNeeded) { return this._findFirst(this.value.get()); }
    await this._run(async (finder) => {
      await finder.nextField(1);
      await finder.matchNext(1);
    });
  }

  public async findPrev() {
    if (this.isRunning.get() || this.noMatch.get()) { return; }
    if (this._isRestartNeeded) { return this._findFirst(this.value.get()); }
    await this._run(async (finder) => {
      await finder.nextField(-1);
      await finder.matchNext(-1);
    });
  }

  private async _findFirst(value: string) {
    this._isRestartNeeded = false;
    this.isEmpty.set(!value);
    await this._updateFinder(value);
    if (!value || !this._finder) { this.noMatch.set(true); return; }
    await this._run(async (finder) => {
      await finder.matchNext(1);
    });
  }

  private async _updateFinder(value: string) {
    if (this._finder) { this._finder.abort(); }
    const impl = new FinderImpl(this._gristDoc, value, this._openDocPage.bind(this), this.multiPage);
    const isValid = await impl.init();
    this._finder = isValid ? impl : null;
  }

  // Internal helper that runs cb, passing it the current `this._finder` as first argument and sets
  // this.isRunning to true until the call resolves. It also takes care of updating this.noMatch.
  private async _run(cb: (finder: IFinder) => Promise<void>) {

    const finder = this._finder;
    if (!finder) { throw new Error("SearchModel: finder is not defined"); }

    try {
      this.isRunning.set(true);
      finder.startPosition = finder.getCurrentPosition();
      await cb(finder);
    } finally {
      this.isRunning.set(false);
      this.noMatch.set(!finder.matchFound);
    }
  }

  // Opens doc page without triggering a restart.
  private async _openDocPage(viewId: IDocPage) {
    await this._gristDoc.openDocPage(viewId);
    this._isRestartNeeded = false;
  }
}

function makeRegexp(value: string) {
  // From https://stackoverflow.com/a/3561711/328565
  const escaped = value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp(escaped, 'i');
}
