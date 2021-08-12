/**
 * Creates a UI for column filter menu given a columnFilter model, a mapping of cell values to counts, and an onClose
 * callback that's triggered on Apply or on Cancel. Changes to the UI result in changes to the underlying model,
 * but on Cancel the model is reset to its initial state prior to menu closing.
 */

import {allInclusive, ColumnFilter} from 'app/client/models/ColumnFilter';
import {ColumnFilterMenuModel, IFilterCount} from 'app/client/models/ColumnFilterMenuModel';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {RowId, RowSource} from 'app/client/models/rowset';
import {ColumnFilterFunc, SectionFilter} from 'app/client/models/SectionFilter';
import {TableData} from 'app/client/models/TableData';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {cssLabel as cssCheckboxLabel, cssCheckboxSquare, cssLabelText, Indeterminate, labeledTriStateSquareCheckbox
       } from 'app/client/ui2018/checkbox';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass, menuDivider} from 'app/client/ui2018/menus';
import {CellValue} from 'app/common/DocActions';
import {isEquivalentFilter} from "app/common/FilterState";
import {Computed, dom, DomElementArg, DomElementMethod, IDisposableOwner, input, makeTestId, styled} from 'grainjs';
import concat = require('lodash/concat');
import identity = require('lodash/identity');
import noop = require('lodash/noop');
import partition = require('lodash/partition');
import some = require('lodash/some');
import tail = require('lodash/tail');
import {IOpenController, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import {decodeObject} from 'app/plugin/objtypes';
import {isList, isRefListType} from 'app/common/gristTypes';
import {choiceToken} from 'app/client/widgets/ChoiceToken';
import {ChoiceOptions} from 'app/client/widgets/ChoiceTextBox';
import {cssInvalidToken} from 'app/client/widgets/ChoiceListCell';

interface IFilterMenuOptions {
  model: ColumnFilterMenuModel;
  valueCounts: Map<CellValue, IFilterCount>;
  doSave: (reset: boolean) => void;
  onClose: () => void;
  renderValue: (key: CellValue, value: IFilterCount) => DomElementArg;
}

const testId = makeTestId('test-filter-menu-');

export function columnFilterMenu(owner: IDisposableOwner, opts: IFilterMenuOptions): HTMLElement {
  const { model, doSave, onClose, renderValue } = opts;
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

  const {searchValue: searchValueObs, filteredValues, filteredKeys, isSortedByCount} = model;

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
            testId('bulk-action'),
          ),
          cssDotSeparator('•'),
          cssSelectAll(
            searchValue ? 'All Except' : 'None',
            cssSelectAll.cls('-disabled', isEquivalentFilter(state, noneSpec)),
            dom.on('click', () => columnFilter.setState(noneSpec)),
            testId('bulk-action'),
          )
        ];
      }),
      cssSortIcon(
        'Sort',
        cssSortIcon.cls('-active', isSortedByCount),
        dom.on('click', () => isSortedByCount.set(!isSortedByCount.get())),
      )
    ),
    cssItemList(
      testId('list'),
      dom.maybe(use => use(filteredValues).length === 0, () => cssNoResults('No matching values')),
      dom.domComputed(filteredValues, (values) => values.slice(0, model.limitShown).map(([key, value]) => (
        cssMenuItem(
          cssLabel(
            cssCheckboxSquare(
              {type: 'checkbox'},
              dom.on('change', (_ev, elem) =>
                elem.checked ? columnFilter.add(key) : columnFilter.delete(key)),
              (elem) => { elem.checked = columnFilter.includes(key); checkboxMap.set(key, elem); },
              dom.style('position', 'relative'),
            ),
            renderValue(key, value),
          ),
          cssItemCount(value.count.toLocaleString(), testId('count')))
      ))) // Include comma separator
    ),
    cssMenuDivider(),
    cssMenuFooter(
      dom.domComputed((use) => {
        const isAboveLimit = use(isAboveLimitObs);
        const searchValue = use(isSearchingObs);
        const otherValues = use(model.otherValues);
        const anyOtherValues = Boolean(otherValues.length);
        const valuesBeyondLimit = use(model.valuesBeyondLimit);
        if (isAboveLimit) {
          return searchValue ? [
            buildSummary('Other Matching', valuesBeyondLimit, false, model),
            buildSummary('Other Non-Matching', otherValues, true, model),
          ] : [
            buildSummary('Other Values', concat(otherValues, valuesBeyondLimit), false, model),
            buildSummary('Future Values', [], true, model),
          ];
        } else {
          return anyOtherValues ? [
            buildSummary('Others', otherValues, true, model)
          ] : [
            buildSummary('Future Values', [], true, model)
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


/**
 * Builds a tri-state checkbox that summaries the state of all the `values`. The special value
 * `Future Values` which turns the filter into an inclusion filter or exclusion filter, can be
 * added to the summary using `switchFilterType`. Uses `label` as label and also expects
 * `model` as the column filter menu model.
 *
 * The checkbox appears checked if all values of the summary are included, unchecked if none, and in
 * the indeterminate state if values are in mixed state.
 *
 * On user clicks, if checkbox is checked, it does uncheck all the values, and if the
 * `switchFilterType` is true it also converts the filter into an inclusion filter. But if the
 * checkbox is unchecked, or in the Indeterminate state, it does check all the values, and if the
 * `switchFilterType` is true it also converts the filter into an exlusion filter.
 */
function buildSummary(label: string|Computed<string>, values: Array<[CellValue, IFilterCount]>,
                      switchFilterType: boolean, model: ColumnFilterMenuModel) {
  const columnFilter = model.columnFilter;
  const checkboxState = Computed.create(
    null, columnFilter.isInclusionFilter, columnFilter.filterFunc,
    (_use, isInclusionFilter) => {

      // let's gather all sub options.
      const subOptions = values.map((val) => ({getState: () => columnFilter.includes(val[0])}));
      if (switchFilterType) {
        subOptions.push({getState: () => !isInclusionFilter});
      }

      // At this point if sub options is still empty let's just return false (unchecked).
      if (!subOptions.length) { return false; }

      // let's compare the state for first sub options against all the others. If there is one
      // different, then state should be `Indeterminate`, otherwise, the state will the the same as
      // the one of the first sub option.
      const first = subOptions[0].getState();
      if (some(tail(subOptions), (val) => val.getState() !== first)) { return Indeterminate; }
      return first;

    }).onWrite((val) => {

      if (switchFilterType) {

        // Note that if `includeFutureValues` is true, we only needs to toggle the filter type
        // between exclusive and inclusive. Doing this will automatically excludes/includes all
        // other values, so no need for extra steps.
        const state = val ?
          {excluded: model.filteredKeys.get().filter((key) => !columnFilter.includes(key))} :
          {included: model.filteredKeys.get().filter((key) => columnFilter.includes(key))};
        columnFilter.setState(state);

      } else {

        const keys = values.map(([key]) => key);
        if (val) {
          columnFilter.addMany(keys);
        } else {
          columnFilter.deleteMany(keys);
        }
      }
    });

  return cssMenuItem(
    dom.autoDispose(checkboxState),
    testId('summary'),
    labeledTriStateSquareCheckbox(
      checkboxState,
      `${label} ${formatUniqueCount(values)}`.trim()
    ),
    cssItemCount(formatCount(values), testId('count')),
  );
}

function formatCount(values: Array<[CellValue, IFilterCount]>) {
  const count = getCount(values);
  return count ? count.toLocaleString() : '';
}

function formatUniqueCount(values: Array<[CellValue, IFilterCount]>) {
  const count = values.length;
  return count ? '(' + count.toLocaleString() + ')' : '';
}

/**
 * Returns content for the newly created columnFilterMenu; for use with setPopupToCreateDom().
 */
export function createFilterMenu(openCtl: IOpenController, sectionFilter: SectionFilter, field: ViewFieldRec,
                                 rowSource: RowSource, tableData: TableData, onClose: () => void = noop) {
  // Go through all of our shown and hidden rows, and count them up by the values in this column.
  const columnType = field.column().type.peek();
  const {keyMapFunc, labelMapFunc} = getMapFuncs(columnType, tableData, field);
  const activeFilterBar = field.viewSection.peek().activeFilterBar;

  function getFilterFunc(f: ViewFieldRec, colFilter: ColumnFilterFunc|null) {
    return f.getRowId() === field.getRowId() ? null : colFilter;
  }
  const filterFunc = Computed.create(null, use => sectionFilter.buildFilterFunc(getFilterFunc, use));
  openCtl.autoDispose(filterFunc);

  const columnFilter = ColumnFilter.create(openCtl, field.activeFilter.peek(), columnType);
  sectionFilter.setFilterOverride(field.getRowId(), columnFilter); // Will be removed on menu disposal

  const [allRows, hiddenRows] = partition(Array.from(rowSource.getAllRows()), filterFunc.get());
  const valueCounts: Map<CellValue, {label: string, count: number}> = new Map();
  addCountsToMap(valueCounts, allRows, {keyMapFunc, labelMapFunc, columnType});
  addCountsToMap(valueCounts, hiddenRows, {keyMapFunc, labelMapFunc, columnType,
                                                               areHiddenRows: true});

  const model = ColumnFilterMenuModel.create(openCtl, columnFilter, Array.from(valueCounts));


  return columnFilterMenu(openCtl, {
    model,
    valueCounts,
    onClose: () => { openCtl.close(); onClose(); },
    doSave: (reset: boolean = false) => {
      const spec = columnFilter.makeFilterJson();
      // If filter is moot and filter bar is hidden, let's remove the filter.
      field.activeFilter((spec === allInclusive && !activeFilterBar.peek()) ? '' : spec);
      if (reset) {
        sectionFilter.resetTemporaryRows();
      }
    },
    renderValue: getRenderFunc(columnType, field),
  });
}

/**
 * Returns two callback functions, `keyMapFunc` and `labelMapFunc`,
 * which map row ids to cell values and labels respectively.
 *
 * The functions vary based on the `columnType`. For example,
 * Reference Lists have a unique `labelMapFunc` that returns a list
 * of all labels in a given cell, rather than a single label.
 *
 * Used by ColumnFilterMenu to compute counts of unique cell
 * values and display them with an appropriate label.
 */
function getMapFuncs(columnType: string, tableData: TableData, field: ViewFieldRec) {
  const keyMapFunc = tableData.getRowPropFunc(field.column().colId())!;
  const labelGetter = tableData.getRowPropFunc(field.displayColModel().colId())!;
  const formatter = field.createVisibleColFormatter();

  let labelMapFunc: (rowId: number) => string | string[];
  if (isRefListType(columnType)) {
    labelMapFunc = (rowId: number) => {
      const maybeLabels = labelGetter(rowId);
      if (!maybeLabels) { return ''; }
      const labels = isList(maybeLabels) ? maybeLabels.slice(1) : [maybeLabels];
      return labels.map(l => formatter.formatAny(l));
    };
  } else {
    labelMapFunc = (rowId: number) => formatter.formatAny(labelGetter(rowId));
  }

  return {keyMapFunc, labelMapFunc};
}

/**
 * Returns a callback function for rendering values in a filter menu.
 *
 * For example, Choice and Choice List columns will differ from other
 * column types by rendering their values as colored tokens instead of
 * text.
 */
function getRenderFunc(columnType: string, field: ViewFieldRec) {
  if (['Choice', 'ChoiceList'].includes(columnType)) {
    const options = field.column().widgetOptionsJson.peek();
    const choiceSet: Set<string> = new Set(options.choices || []);
    const choiceOptions: ChoiceOptions = options.choiceOptions || {};

    return (_key: CellValue, value: IFilterCount) => {
      if (value.label === '') {
        return cssItemValue(value.label);
      }

      return choiceToken(
        value.label,
        {
          fillColor: choiceOptions[value.label]?.fillColor,
          textColor: choiceOptions[value.label]?.textColor,
        },
        dom.cls(cssToken.className),
        cssInvalidToken.cls('-invalid', !choiceSet.has(value.label)),
        testId('choice-token')
      );
    };
  }

  return (key: CellValue, value: IFilterCount) =>
    cssItemValue(value.label === undefined ? String(key) : value.label);
}

interface ICountOptions {
  columnType: string;
  keyMapFunc?: (v: any) => any;
  labelMapFunc?: (v: any) => any;
  areHiddenRows?: boolean;
}

/**
 * For each row id in Iterable, adds a key mapped with `keyMapFunc` and a value object with a `label` mapped
 * with `labelMapFunc` and a `count` representing the total number of times the key has been encountered.
 *
 * The optional column type controls how complex cell values are decomposed into keys (e.g. Choice Lists have
 * the possible choices as keys).
 */
function addCountsToMap(valueMap: Map<CellValue, IFilterCount>, rowIds: RowId[],
                        { keyMapFunc = identity, labelMapFunc = identity, columnType,
                          areHiddenRows = false }: ICountOptions) {

  for (const rowId of rowIds) {
    let key = keyMapFunc(rowId);

    // If row contains a list and the column is a Choice List, treat each choice as a separate key
    if (isList(key) && (columnType === 'ChoiceList')) {
      const list = decodeObject(key) as unknown[];
      for (const item of list) {
        addSingleCountToMap(valueMap, item, () => item, areHiddenRows);
      }
      continue;
    }

    // If row contains a Reference List, treat each reference as a separate key
    if (isList(key) && isRefListType(columnType)) {
      const refIds = decodeObject(key) as unknown[];
      const refLabels = labelMapFunc(rowId);
      refIds.forEach((id, i) => {
        addSingleCountToMap(valueMap, id, () => refLabels[i], areHiddenRows);
      });
      continue;
    }
    // For complex values, serialize the value to allow them to be properly stored
    if (Array.isArray(key)) { key = JSON.stringify(key); }
    addSingleCountToMap(valueMap, key, () => labelMapFunc(rowId), areHiddenRows);
  }
}

/**
 * Adds the `value` to `valueMap` using `labelGetter` to get the label and increments `count` unless
 * isHiddenRow is true.
 */
function addSingleCountToMap(valueMap: Map<CellValue, IFilterCount>, value: any, labelGetter: () => any,
                       isHiddenRow: boolean) {
  if (!valueMap.has(value)) {
    valueMap.set(value, { label: labelGetter(), count: 0 });
  }
  if (!isHiddenRow) {
    valueMap.get(value)!.count++;
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

interface IColumnFilterMenuOptions extends IPopupOptions {
  // callback for when the content of the menu is closed by clicking the apply or revert buttons
  onCloseContent?: () => void;
}

// Helper to attach the column filter menu.
export function attachColumnFilterMenu(viewSection: ViewSectionRec, field: ViewFieldRec,
                                       popupOptions: IColumnFilterMenuOptions): DomElementMethod {
  const options = {...defaultPopupOptions, ...popupOptions};
  return (elem) => {
    const instance = viewSection.viewInstance();
    if (instance && instance.createFilterMenu) { // Should be set if using BaseView
      setPopupToCreateDom(elem, ctl => instance.createFilterMenu(ctl, field, popupOptions.onCloseContent), options);
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
  user-select: none;
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
export const cssItemValue = styled(cssLabelText, `
  margin-right: 12px;
  color: ${colors.dark};
  white-space: pre;
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
const cssSortIcon = styled(icon, `
  --icon-color: ${colors.slate};
  margin-left: auto;
  &-active {
    --icon-color: ${colors.lightGreen}
  }
`);
const cssLabel = styled(cssCheckboxLabel, `
  align-items: center;
  font-weight: initial;   /* negate bootstrap */
`);
const cssToken = styled('div', `
  margin-left: 8px;
  margin-right: 12px;
`);
