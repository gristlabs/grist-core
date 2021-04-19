/**
 * Creates a UI for column filter menu given a columnFilter model, a mapping of cell values to counts, and an onClose
 * callback that's triggered on Apply or on Cancel. Changes to the UI result in changes to the underlying model,
 * but on Cancel the model is reset to its initial state prior to menu closing.
 */

import {allInclusive, ColumnFilter, isEquivalentFilter} from 'app/client/models/ColumnFilter';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {FilteredRowSource} from 'app/client/models/rowset';
import {SectionFilter} from 'app/client/models/SectionFilter';
import {TableData} from 'app/client/models/TableData';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {cssCheckboxSquare, cssLabel, cssLabelText} from 'app/client/ui2018/checkbox';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass, menuDivider} from 'app/client/ui2018/menus';
import {CellValue} from 'app/common/DocActions';
import {Computed, Disposable, dom, DomElementMethod, IDisposableOwner, input, makeTestId, styled} from 'grainjs';
import identity = require('lodash/identity');
import {IOpenController, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import {ColumnFilterMenuModel, IFilterCount} from '../models/ColumnFilterMenuModel';


interface IFilterMenuOptions {
  model: ColumnFilterMenuModel;
  valueCounts: Map<CellValue, IFilterCount>;
  doSave: (reset: boolean) => void;
  onClose: () => void;
}

const testId = makeTestId('test-filter-menu-');

export function columnFilterMenu(owner: IDisposableOwner, opts: IFilterMenuOptions): HTMLElement {
  const { model, doSave, onClose } = opts;
  const { columnFilter } = model;
  // Save the initial state to allow reverting back to it on Cancel
  const initialStateJson = columnFilter.makeFilterJson();

  // Map to keep track of displayed checkboxes
  const checkboxMap: Map<CellValue, HTMLInputElement> = new Map();

  // Listen for changes to filterFunc, and update checkboxes accordingly
  const filterListener = columnFilter.filterFunc.addListener(func => {
    for (const [value, elem] of checkboxMap) {
      elem.checked = func(value);
    }
  });

  const {searchValue: searchValueObs, filteredValues, filteredKeys} = model;

  const isAboveLimitObs = Computed.create(owner, (use) => use(model.valuesBeyondLimit).length > 0);
  const isSearchingObs = Computed.create(owner, (use) => Boolean(use(searchValueObs)));

  let searchInput: HTMLInputElement;
  let reset = false;

  // Gives focus to the searchInput on open
  setTimeout(() => searchInput.focus(), 0);

  const filterMenu: HTMLElement = cssMenu(
    { tabindex: '-1' }, // Allow menu to be focused
    testId('wrapper'),
    dom.cls(menuCssClass),
    dom.autoDispose(filterListener),
    dom.onDispose(() => doSave(reset)),    // Save on disposal, which should always happen as part of closing.
    dom.onKeyDown({
      Enter: () => onClose(),
      Escape: () => onClose()
    }),
    cssMenuHeader(
      cssSearchIcon('Search'),
      searchInput = cssSearch(
        searchValueObs, { onInput: true },
        testId('search-input'),
        { type: 'search', placeholder: 'Search values' },
        dom.onKeyDown({
          Enter: () => {
            if (searchValueObs.get()) {
              columnFilter.setState({included: filteredKeys.get()});
            }
          },
          Escape$: (ev) => {
            if (searchValueObs.get()) {
              searchValueObs.set('');
              searchInput.focus();
              ev.stopPropagation();
            }
          }
        })
      ),
      dom.maybe(searchValueObs, () => cssSearchIcon(
        'CrossSmall', testId('search-close'),
        dom.on('click', () => {
          searchValueObs.set('');
          searchInput.focus();
        }),
      )),
    ),
    cssMenuDivider(),
    cssMenuItem(
      dom.domComputed((use) => {
        const searchValue = use(searchValueObs);
        // This is necessary to avoid a known bug in grainjs where filteredKeys does not get
        // recalculated.
        use(filteredKeys);
        const allSpec = searchValue ? {included: use(filteredKeys)} : {excluded: []};
        const noneSpec = searchValue ? {excluded: use(filteredKeys)} : {included: []};
        const state = use(columnFilter.state);
        return [
          cssSelectAll(
            dom.text(searchValue ? 'All Shown' : 'All'),
            cssSelectAll.cls('-disabled', isEquivalentFilter(state, allSpec)),
            dom.on('click', () => columnFilter.setState(allSpec)),
            testId('select-all'),
          ),
          cssDotSeparator('•'),
          cssSelectAll(
            searchValue ? 'All Except' : 'None',
            cssSelectAll.cls('-disabled', isEquivalentFilter(state, noneSpec)),
            dom.on('click', () => columnFilter.setState(noneSpec)),
            testId('select-all'),
          )
        ];
      })
    ),
    cssItemList(
      testId('list'),
      dom.maybe(use => use(filteredValues).length === 0, () => cssNoResults('No matching values')),
      dom.domComputed(filteredValues, (values) => values.slice(0, model.limitShown).map(([key, value]) => (
        cssMenuItem(
          cssLabel(
            cssCheckboxSquare({type: 'checkbox'},
                              dom.on('change', (_ev, elem) =>
                                     elem.checked ? columnFilter.add(key) : columnFilter.delete(key)),
                              (elem) => { elem.checked = columnFilter.includes(key); checkboxMap.set(key, elem); }),
            cssItemValue(value.label === undefined ? key as string : value.label),
          ),
          cssItemCount(value.count.toLocaleString(), testId('count')))
      ))) // Include comma separator
    ),
    cssMenuDivider(),
    cssMenuFooter(
      dom.domComputed((use) => {
        const isAboveLimit = use(isAboveLimitObs);
        const searchValue = use(isSearchingObs);
        if (isAboveLimit) {
          return searchValue ? [
            buildSummary('Other Matching', BeyondLimit, model),
            buildSummary('Other Non-Matching', OtherValues, model),
          ] : [
            buildSummary('Other Values', BeyondLimit, model),
            buildSummary('Future Values', OtherValues, model)
          ];
        } else {
          return searchValue ? [
            buildSummary('Others', OtherValues, model)
          ] : [
            buildSummary('Future Values', OtherValues, model)
          ];
        }
      }),
      cssMenuItem(
        cssApplyButton('Apply', testId('apply-btn'),
                       dom.on('click', () => { reset = true; onClose(); })),
        basicButton('Cancel', testId('cancel-btn'),
                    dom.on('click', () => { columnFilter.setState(initialStateJson); onClose(); } ))
      )
    )
  );
  return filterMenu;
}

// Describes the model for one summary checkbox.
interface SummaryModel extends Disposable {

  // Whether checkbox is checked
  isChecked: Computed<boolean> ;

  // Callback for when the checkbox is changed.
  callback: (checked: boolean) => void;

  // The count.
  count: Computed<string>;
}

// Ctor that construct a SummaryModel.
type SummaryModelCreator = new(columnFilter: ColumnFilterMenuModel) => SummaryModel;

// Summaries all the values that are in `columnFilter.valuesBeyondLimit`, ie: it includes a count
// for all the values and clicking the checkbox successively add/delete these values from the
// `columnFilter`.
class BeyondLimit extends Disposable implements SummaryModel {

  public columnFilter = this.model.columnFilter;

  public isChecked = Computed.create(this, (use) => (
    !use(this.model.valuesBeyondLimit).find(([key, _val]) => !this.columnFilter.includes(key))
  ));

  public count = Computed.create(this, (use) => getCount(use(this.model.valuesBeyondLimit)).toLocaleString());

  constructor(public model: ColumnFilterMenuModel) { super(); }

  public callback(checked: boolean) {
    const keys = this.model.valuesBeyondLimit.get().map(([key, _val]) => key);
    if (checked) {
      this.columnFilter.addMany(keys);
    } else {
      this.columnFilter.deleteMany(keys);
    }
  }
}

// Summaries the values that are not in columnFilter.filteredValues, it includes both the values in
// `columnFilter.otherValues` (ie: the values that are filtered out if user is using the search) and
// the future values. The checkbox successively turns columnFilter into an inclusion/exclusion
// filter. The count is hidden if `columnFilter.otherValues` is empty (ie: no search is peformed =>
// only checkbox only toggles future values)
class OtherValues extends Disposable implements SummaryModel {
  public columnFilter = this.model.columnFilter;
  public isChecked = Computed.create(this, (use) => !use(this.columnFilter.isInclusionFilter));

  public count = Computed.create(this, (use) => {
    const c = getCount(use(this.model.otherValues));
    return c ? c.toLocaleString() : '';
  });

  constructor(public model: ColumnFilterMenuModel) { super(); }

  public callback(checked: boolean) {
    const columnFilter = this.columnFilter;
    const filteredKeys = this.model.filteredKeys;
    const state = checked ?
      {excluded: filteredKeys.get().filter((key) => !columnFilter.includes(key))} :
      {included: filteredKeys.get().filter((key) => columnFilter.includes(key))};
    return columnFilter.setState(state);
  }
}

function buildSummary(label: string, SummaryModelCtor: SummaryModelCreator, model: ColumnFilterMenuModel) {
  const summaryModel = new SummaryModelCtor(model);
  return cssMenuItem(
    dom.autoDispose(summaryModel),
    testId('summary'),
    cssLabel(
      cssCheckboxSquare(
        {type: 'checkbox'},
        dom.on('change', (_ev, elem) => summaryModel.callback(elem.checked)),
        dom.prop('checked', summaryModel.isChecked)
      ),
      cssItemValue(label),
    ),
    summaryModel.count !== undefined ? cssItemCount(dom.text(summaryModel.count), testId('count')) : null,
  );
}

/**
 * Returns content for the newly created columnFilterMenu; for use with setPopupToCreateDom().
 */
export function createFilterMenu(openCtl: IOpenController, sectionFilter: SectionFilter, field: ViewFieldRec,
                                 rowSource: FilteredRowSource, tableData: TableData) {
  // Go through all of our shown and hidden rows, and count them up by the values in this column.
  const valueGetter = tableData.getRowPropFunc(field.column().colId())!;
  const labelGetter = tableData.getRowPropFunc(field.displayColModel().colId())!;
  const formatter = field.createVisibleColFormatter();
  const valueMapFunc = (rowId: number) => formatter.formatAny(labelGetter(rowId));

  const valueCounts: Map<CellValue, {label: string, count: number}> = new Map();
  // TODO: as of now, this is not working for non text-or-numeric columns, ie: for Date column it is
  // not possible to search for anything. Likely caused by the key being something completely
  // different than the label.
  addCountsToMap(valueCounts, rowSource.getAllRows() as Iterable<number>, valueGetter, valueMapFunc);
  addCountsToMap(valueCounts, rowSource.getHiddenRows() as Iterable<number>, valueGetter, valueMapFunc);

  const columnFilter = ColumnFilter.create(openCtl, field.activeFilter.peek());
  const model = ColumnFilterMenuModel.create(openCtl, columnFilter, Array.from(valueCounts));
  sectionFilter.setFilterOverride(field.getRowId(), columnFilter); // Will be removed on menu disposal

  return columnFilterMenu(openCtl, {
    model,
    valueCounts,
    onClose: () => openCtl.close(),
    doSave: (reset: boolean = false) => {
      const spec = columnFilter.makeFilterJson();
      field.activeFilter(spec === allInclusive ? '' : spec);
      if (reset) {
        sectionFilter.resetTemporaryRows();
      }
    },
  });
}

/**
 * For each value in Iterable, adds a key mapped with `keyMapFunc` and a value object with a `label` mapped
 * with `labelMapFunc` and a `count` representing the total number of times the key has been encountered.
 */
function addCountsToMap(valueMap: Map<CellValue, IFilterCount>, values: Iterable<CellValue>,
                        keyMapFunc: (v: any) => any = identity, labelMapFunc: (v: any) => any = identity) {
  for (const v of values) {
    let key = keyMapFunc(v);

    // For complex values, serialize the value to allow them to be properly stored
    if (Array.isArray(key)) { key = JSON.stringify(key); }
    if (valueMap.get(key)) {
      valueMap.get(key)!.count++;
    } else {
      valueMap.set(key, { label: labelMapFunc(v), count: 1 });
    }
  }
}

function getCount(values: Array<[CellValue, IFilterCount]>) {
   return values.reduce((acc, val) => acc + val[1].count, 0);
}

const defaultPopupOptions: IPopupOptions = {
  placement: 'bottom-start',
  boundaries: 'viewport',
  trigger: ['click'],
};

// Helper to attach the column filter menu.
export function attachColumnFilterMenu(viewSection: ViewSectionRec, field: ViewFieldRec,
                                       popupOptions: IPopupOptions): DomElementMethod {
  const options = {...defaultPopupOptions, ...popupOptions};
  return (elem) => {
    const instance = viewSection.viewInstance();
    if (instance && instance.createFilterMenu) { // Should be set if using BaseView
      setPopupToCreateDom(elem, ctl => instance.createFilterMenu(ctl, field), options);
    }
  };
}

const cssMenu = styled('div', `
  display: flex;
  flex-direction: column;
  min-width: 400px;
  max-width: 400px;
  max-height: 90vh;
  outline: none;
  background-color: white;
  padding-top: 0;
  padding-bottom: 12px;
`);
const cssMenuHeader = styled('div', `
  height: 40px;
  flex-shrink: 0;

  display: flex;
  align-items: center;

  margin: 0 16px;
`);
const cssSelectAll = styled('div', `
  display: flex;
  color: ${colors.lightGreen};
  cursor: default;
  user-select: none;
  &-disabled {
    color: ${colors.slate};
  }
`);
const cssDotSeparator = styled('span', `
  color: ${colors.lightGreen};
  margin: 0 4px;
`);
const cssMenuDivider = styled(menuDivider, `
  flex-shrink: 0;
  margin: 0;
`);
const cssItemList = styled('div', `
  flex-shrink: 1;
  overflow: auto;
  min-height: 80px;
  margin-top: 4px;
  padding-bottom: 8px;
`);
const cssMenuItem = styled('div', `
  display: flex;
  padding: 8px 16px;
`);
const cssItemValue = styled(cssLabelText, `
  margin-right: 12px;
  color: ${colors.dark};
  white-space: nowrap;
`);
const cssItemCount = styled('div', `
  flex-grow: 1;
  align-self: normal;
  text-align: right;
  color: ${colors.slate};
`);
const cssMenuFooter = styled('div', `
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  padding-top: 4px;
`);
const cssApplyButton = styled(primaryButton, `
  margin-right: 4px;
`);
const cssSearch = styled(input, `
  flex-grow: 1;
  min-width: 1px;
  -webkit-appearance: none;
  -moz-appearance: none;

  font-size: ${vars.mediumFontSize};

  margin: 0px 16px 0px 8px;
  padding: 0px;
  border: none;
  outline: none;

`);
const cssSearchIcon = styled(icon, `
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 4px;
`);
const cssNoResults = styled(cssMenuItem, `
  font-style: italic;
  color: ${colors.slate};
  justify-content: center;
`);
