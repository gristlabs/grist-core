/**
 * Creates a UI for column filter menu given a columnFilter model, a mapping of cell values to counts, and an onClose
 * callback that's triggered on Apply or on Cancel. Changes to the UI result in changes to the underlying model,
 * but on Cancel the model is reset to its initial state prior to menu closing.
 */
import {t} from 'app/client/lib/localization';
import {allInclusive, ColumnFilter} from 'app/client/models/ColumnFilter';
import {ColumnFilterMenuModel, IFilterCount} from 'app/client/models/ColumnFilterMenuModel';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {FilterInfo} from 'app/client/models/entities/ViewSectionRec';
import {RowId, RowSource} from 'app/client/models/rowset';
import {ColumnFilterFunc, SectionFilter} from 'app/client/models/SectionFilter';
import {TableData} from 'app/client/models/TableData';
import {cssInput} from 'app/client/ui/cssInput';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {cssLabel as cssCheckboxLabel, cssCheckboxSquare, cssLabelText, Indeterminate, labeledTriStateSquareCheckbox
       } from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass, menuDivider} from 'app/client/ui2018/menus';
import {CellValue} from 'app/common/DocActions';
import {isEquivalentFilter} from "app/common/FilterState";
import {Computed, dom, DomElementArg, DomElementMethod, IDisposableOwner, input, makeTestId, Observable,
  styled} from 'grainjs';
import concat = require('lodash/concat');
import identity = require('lodash/identity');
import noop = require('lodash/noop');
import partition = require('lodash/partition');
import some = require('lodash/some');
import tail = require('lodash/tail');
import debounce = require('lodash/debounce');
import {IOpenController, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import {decodeObject} from 'app/plugin/objtypes';
import {isDateLikeType, isList, isNumberType, isRefListType} from 'app/common/gristTypes';
import {choiceToken} from 'app/client/widgets/ChoiceToken';
import {ChoiceOptions} from 'app/client/widgets/ChoiceTextBox';

const translate = (x: string, args?: any): string => t(`ColumnFilterMenu.${x}`, args);

export interface IFilterMenuOptions {
  model: ColumnFilterMenuModel;
  valueCounts: Map<CellValue, IFilterCount>;
  doSave: (reset: boolean) => void;
  onClose: () => void;
  renderValue: (key: CellValue, value: IFilterCount) => DomElementArg;
  rangeInputOptions?: IRangeInputOptions
}

const testId = makeTestId('test-filter-menu-');

export function columnFilterMenu(owner: IDisposableOwner, opts: IFilterMenuOptions): HTMLElement {
  const { model, doSave, onClose, rangeInputOptions = {}, renderValue } = opts;
  const { columnFilter } = model;
  // Save the initial state to allow reverting back to it on Cancel
  const initialStateJson = columnFilter.makeFilterJson();

  // Map to keep track of displayed checkboxes
  const checkboxMap: Map<CellValue, HTMLInputElement> = new Map();

  // Listen for changes to filterFunc, and update checkboxes accordingly. Debounce is needed to
  // prevent some weirdness when users click on a checkbox while focus was on a range input (causing
  // sometimes the checkbox to not toggle)
  const filterListener = columnFilter.filterFunc.addListener(debounce(func => {
    for (const [value, elem] of checkboxMap) {
      elem.checked = func(value);
    }
  }));

  const {searchValue: searchValueObs, filteredValues, filteredKeys, isSortedByCount} = model;

  const isAboveLimitObs = Computed.create(owner, (use) => use(model.valuesBeyondLimit).length > 0);
  const isSearchingObs = Computed.create(owner, (use) => Boolean(use(searchValueObs)));
  const showRangeFilter = isNumberType(columnFilter.columnType) || isDateLikeType(columnFilter.columnType);

  let searchInput: HTMLInputElement;
  let minRangeInput: HTMLInputElement;
  let reset = false;

  // Gives focus to the searchInput on open (or to the min input if the range filter is present).
  setTimeout(() => (minRangeInput || searchInput).select(), 0);

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

    // Filter by range
    dom.maybe(showRangeFilter, () => [
      cssRangeHeader(translate('FilterByRange')),
      cssRangeContainer(
        minRangeInput = rangeInput('Min ', columnFilter.min, rangeInputOptions, testId('min')),
        cssRangeInputSeparator('→'),
        rangeInput('Max ', columnFilter.max, rangeInputOptions, testId('max')),
      ),
      cssMenuDivider(),
    ]),

    cssMenuHeader(
      cssSearchIcon(translate('Search')),
      searchInput = cssSearch(
        searchValueObs, { onInput: true },
        testId('search-input'),
        { type: 'search', placeholder: translate('SearchValues') },
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
            dom.text(searchValue ? translate('AllShown') : translate('All')),
            cssSelectAll.cls('-disabled', isEquivalentFilter(state, allSpec)),
            dom.on('click', () => columnFilter.setState(allSpec)),
            testId('bulk-action'),
          ),
          cssDotSeparator('•'),
          cssSelectAll(
            searchValue ? translate('AllExcept') : translate('None'),
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
      dom.maybe(use => use(filteredValues).length === 0, () => cssNoResults(translate('NoMatchingValues'))),
      dom.domComputed(filteredValues, (values) => values.slice(0, model.limitShown).map(([key, value]) => (
        cssMenuItem(
          cssLabel(
            cssCheckboxSquare(
              {type: 'checkbox'},
              dom.on('change', (_ev, elem) => {
                elem.checked ? columnFilter.add(key) : columnFilter.delete(key);
             }),
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
            buildSummary(translate('OtherMatching'), valuesBeyondLimit, false, model),
            buildSummary(translate('OtherNonMatching'), otherValues, true, model),
          ] : [
            buildSummary(translate('OtherValues'), concat(otherValues, valuesBeyondLimit), false, model),
            buildSummary(translate('FutureValues'), [], true, model),
          ];
        } else {
          return anyOtherValues ? [
            buildSummary(translate('Others'), otherValues, true, model)
          ] : [
            buildSummary(translate('FutureValues'), [], true, model)
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

export interface IRangeInputOptions {
  valueParser?: (val: string) => any;
  valueFormatter?: (val: any) => string;
}

function rangeInput(placeholder: string, obs: Observable<number|undefined>, opts: IRangeInputOptions,
                    ...args: DomElementArg[]) {
  const valueParser = opts.valueParser || Number;
  const formatValue = opts.valueFormatter || ((val) => val?.toString() || '');
  let editMode = false;
  let el: HTMLInputElement;
  // keep input content in sync only when no edit are going on.
  const lis = obs.addListener(() => editMode ? null : el.value = formatValue(obs.get()));
  // handle change
  const onBlur = () => {
    onInput.flush();
    editMode = false;
    el.value = formatValue(obs.get());
  };
  const onInput = debounce(() => {
    editMode = true;
    const val = el.value ? valueParser(el.value) : undefined;
    if (val === undefined || !isNaN(val)) {
      obs.set(val);
    }
  }, 100);
  return el = cssRangeInput(
    {inputmode: 'numeric', placeholder, value: formatValue(obs.get())},
    dom.on('input', onInput),
    dom.on('blur', onBlur),
    dom.autoDispose(lis),
    ...args
  );
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
 * `switchFilterType` is true it also converts the filter into an exclusion filter.
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
 * Returns a new `Map` object to holds pairs of `CellValue` and `IFilterCount`. For `Bool`, `Choice`
 * and `ChoiceList` type of column, the map is initialized with all possible values in order to make
 * sure they get shown to the user.
 */
function getEmptyCountMap(fieldOrColumn: ViewFieldRec|ColumnRec): Map<CellValue, IFilterCount> {
  const columnType = fieldOrColumn.origCol().type();
  let values: any[] = [];
  if (columnType === 'Bool') {
    values = [true, false];
  } else if (['Choice', 'ChoiceList'].includes(columnType)) {
    const options = fieldOrColumn.origCol().widgetOptionsJson;
    values = options.prop('choices')() ?? [];
  }
  return new Map(values.map((v) => [v, {label: String(v), count: 0, displayValue: v}]));
}

/**
 * Returns content for the newly created columnFilterMenu; for use with setPopupToCreateDom().
 */
export function createFilterMenu(openCtl: IOpenController, sectionFilter: SectionFilter, filterInfo: FilterInfo,
                                 rowSource: RowSource, tableData: TableData, onClose: () => void = noop) {
  // Go through all of our shown and hidden rows, and count them up by the values in this column.
  const fieldOrColumn = filterInfo.fieldOrColumn;
  const columnType = fieldOrColumn.origCol.peek().type.peek();
  const visibleColumnType = fieldOrColumn.visibleColModel.peek()?.type.peek() || columnType;
  const {keyMapFunc, labelMapFunc, valueMapFunc} = getMapFuncs(columnType, tableData, filterInfo.fieldOrColumn);
  const activeFilterBar = sectionFilter.viewSection.activeFilterBar;

  // range input options
  const valueParser = (fieldOrColumn as any).createValueParser?.();
  const colFormatter = fieldOrColumn.visibleColFormatter();
  // formatting values for Numeric columns entail issues. For instance with '%' when users type
  // 0.499 and press enter, the input now shows 50% and there's no way to know what is the actual
  // underlying value. Maybe worth, both 0.499 and 0.495 format to 50% but they can have different
  // effects depending on data. Hence as of writing better to keep it only for Date.
  const valueFormatter = isDateLikeType(visibleColumnType) ?
    (val: any) => colFormatter.formatAny(val) :
    undefined;

  function getFilterFunc(col: ViewFieldRec|ColumnRec, colFilter: ColumnFilterFunc|null) {
    return col.getRowId() === fieldOrColumn.getRowId() ? null : colFilter;
  }
  const filterFunc = Computed.create(null, use => sectionFilter.buildFilterFunc(getFilterFunc, use));
  openCtl.autoDispose(filterFunc);

  const [allRows, hiddenRows] = partition(Array.from(rowSource.getAllRows()), filterFunc.get());
  const valueCounts = getEmptyCountMap(fieldOrColumn);
  addCountsToMap(valueCounts, allRows, {keyMapFunc, labelMapFunc, columnType,
                                        valueMapFunc});
  addCountsToMap(valueCounts, hiddenRows, {keyMapFunc, labelMapFunc, columnType,
                                           areHiddenRows: true, valueMapFunc});

  const valueCountsArr = Array.from(valueCounts);
  const columnFilter = ColumnFilter.create(openCtl, filterInfo.filter.peek(), columnType, visibleColumnType,
                                           valueCountsArr.map((arr) => arr[0]));
  sectionFilter.setFilterOverride(fieldOrColumn.origCol().getRowId(), columnFilter); // Will be removed on menu disposal
  const model = ColumnFilterMenuModel.create(openCtl, columnFilter, valueCountsArr);

  return columnFilterMenu(openCtl, {
    model,
    valueCounts,
    onClose: () => { openCtl.close(); onClose(); },
    doSave: (reset: boolean = false) => {
      const spec = columnFilter.makeFilterJson();
      // If filter is moot and filter bar is hidden, let's remove the filter.
      sectionFilter.viewSection.setFilter(
        fieldOrColumn.origCol().origColRef(),
        spec === allInclusive && !activeFilterBar.peek() ? '' : spec
      );
      if (reset) {
        sectionFilter.resetTemporaryRows();
      }
    },
    renderValue: getRenderFunc(columnType, fieldOrColumn),
    rangeInputOptions: {
      valueParser,
      valueFormatter,
    }
  });
}

/**
 * Returns three callback functions, `keyMapFunc`, `labelMapFunc`
 * and `valueMapFunc`, which map row ids to cell values, labels
 * and visible col value respectively.
 *
 * The functions vary based on the `columnType`. For example,
 * Reference Lists have a unique `labelMapFunc` that returns a list
 * of all labels in a given cell, rather than a single label.
 *
 * Used by ColumnFilterMenu to compute counts of unique cell
 * values and display them with an appropriate label.
 */
function getMapFuncs(columnType: string, tableData: TableData, fieldOrColumn: ViewFieldRec|ColumnRec) {
  const keyMapFunc = tableData.getRowPropFunc(fieldOrColumn.colId())!;
  const labelGetter = tableData.getRowPropFunc(fieldOrColumn.displayColModel().colId())!;
  const formatter = fieldOrColumn.visibleColFormatter();

  let labelMapFunc: (rowId: number) => string | string[];
  const valueMapFunc: (rowId: number) => any = (rowId: number) => decodeObject(labelGetter(rowId)!);

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
  return {keyMapFunc, labelMapFunc, valueMapFunc};
}

/**
 * Returns a callback function for rendering values in a filter menu.
 *
 * For example, Choice and Choice List columns will differ from other
 * column types by rendering their values as colored tokens instead of
 * text.
 */
function getRenderFunc(columnType: string, fieldOrColumn: ViewFieldRec|ColumnRec) {
  if (['Choice', 'ChoiceList'].includes(columnType)) {
    const options = fieldOrColumn.widgetOptionsJson.peek();
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
          fontBold: choiceOptions[value.label]?.fontBold ?? false,
          fontUnderline: choiceOptions[value.label]?.fontUnderline ?? false,
          fontItalic: choiceOptions[value.label]?.fontItalic ?? false,
          fontStrikethrough: choiceOptions[value.label]?.fontStrikethrough ?? false,
          invalid: !choiceSet.has(value.label),
        },
        dom.cls(cssToken.className),
        testId('choice-token')
      );
    };
  }

  return (key: CellValue, value: IFilterCount) =>
    cssItemValue(value.label === undefined ? String(key) : value.label);
}

interface ICountOptions {
  columnType: string;
  // returns the indexing key for the filter
  keyMapFunc?: (v: any) => any;
  // returns the string representation of the value (can involves some formatting).
  labelMapFunc?: (v: any) => any;
  // returns the underlying value (useful for comparison)
  valueMapFunc: (v: any) => any;
  areHiddenRows?: boolean;
}

/**
 * For each row id in Iterable, adds a key mapped with `keyMapFunc` and a value object with a
 * `label` mapped with `labelMapFunc` and a `count` representing the total number of times the key
 * has been encountered and a `displayValues` mapped with `valueMapFunc`.
 *
 * The optional column type controls how complex cell values are decomposed into keys (e.g. Choice Lists have
 * the possible choices as keys).
 * Note that this logic is replicated in BaseView.prototype.filterByThisCellValue.
 */
function addCountsToMap(valueMap: Map<CellValue, IFilterCount>, rowIds: RowId[],
                        { keyMapFunc = identity, labelMapFunc = identity, columnType,
                          areHiddenRows = false, valueMapFunc }: ICountOptions) {

  for (const rowId of rowIds) {
    let key = keyMapFunc(rowId);

    // If row contains a list and the column is a Choice List, treat each choice as a separate key
    if (isList(key) && (columnType === 'ChoiceList')) {
      const list = decodeObject(key) as unknown[];
      if (!list.length) {
        // If the list is empty, add an item for the whole list, otherwise the row will be missing from filters.
        addSingleCountToMap(valueMap, '', () => '', () => '', areHiddenRows);
      }
      for (const item of list) {
        addSingleCountToMap(valueMap, item, () => item, () => item, areHiddenRows);
      }
      continue;
    }

    // If row contains a Reference List, treat each reference as a separate key
    if (isList(key) && isRefListType(columnType)) {
      const refIds = decodeObject(key) as unknown[];
      if (!refIds.length) {
        // If the list is empty, add an item for the whole list, otherwise the row will be missing from filters.
        addSingleCountToMap(valueMap, null, () => null, () => null, areHiddenRows);
      }
      const refLabels = labelMapFunc(rowId);
      const displayValues = valueMapFunc(rowId);
      refIds.forEach((id, i) => {
        addSingleCountToMap(valueMap, id, () => refLabels[i], () => displayValues[i], areHiddenRows);
      });
      continue;
    }
    // For complex values, serialize the value to allow them to be properly stored
    if (Array.isArray(key)) { key = JSON.stringify(key); }
    addSingleCountToMap(valueMap, key, () => labelMapFunc(rowId), () => valueMapFunc(rowId), areHiddenRows);
  }
}

/**
 * Adds the `value` to `valueMap` using `labelGetter` to get the label and increments `count` unless
 * isHiddenRow is true.
 */
function addSingleCountToMap(valueMap: Map<CellValue, IFilterCount>, value: any, label: () => any,
                             displayValue: () => any, isHiddenRow: boolean) {
  if (!valueMap.has(value)) {
    valueMap.set(value, { label: label(), count: 0, displayValue: displayValue() });
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
export function attachColumnFilterMenu(viewSection: ViewSectionRec, filterInfo: FilterInfo,
                                       popupOptions: IColumnFilterMenuOptions): DomElementMethod {
  const options = {...defaultPopupOptions, ...popupOptions};
  return (elem) => {
    const instance = viewSection.viewInstance();
    if (instance && instance.createFilterMenu) { // Should be set if using BaseView
      setPopupToCreateDom(elem, ctl =>
        instance.createFilterMenu(ctl, filterInfo, popupOptions.onCloseContent), options);
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
  background-color: ${theme.menuBg};
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
  color: ${theme.controlFg};
  cursor: default;
  user-select: none;
  &-disabled {
    color: ${theme.controlSecondaryFg};
  }
`);
const cssDotSeparator = styled('span', `
  color: ${theme.controlFg};
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
  white-space: pre;
`);
const cssItemCount = styled('div', `
  flex-grow: 1;
  align-self: normal;
  text-align: right;
  color: ${theme.lightText};
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
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  flex-grow: 1;
  min-width: 1px;
  -webkit-appearance: none;
  -moz-appearance: none;

  font-size: ${vars.mediumFontSize};

  margin: 0px 16px 0px 8px;
  padding: 0px;
  border: none;
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
const cssSearchIcon = styled(icon, `
  --icon-color: ${theme.lightText};
  flex-shrink: 0;
  margin-left: auto;
  margin-right: 4px;
`);
const cssNoResults = styled(cssMenuItem, `
  font-style: italic;
  color: ${theme.lightText};
  justify-content: center;
`);
const cssSortIcon = styled(icon, `
  --icon-color: ${theme.controlSecondaryFg};
  margin-left: auto;
  &-active {
    --icon-color: ${theme.controlFg}
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
const cssRangeHeader = styled(cssMenuItem, `
  color: ${theme.text};
  padding: unset;
  border-radius: 0 0 3px 0;
  text-transform: uppercase;
  font-size: var(--grist-x-small-font-size);
  margin: 16px 16px 6px 16px;
`);
const cssRangeContainer = styled(cssMenuItem, `
  display: flex;
  justify-content: left;
  align-items: center;
  column-gap: 10px;
`);
const cssRangeInputSeparator = styled('span', `
  font-weight: 600;
  color: ${theme.lightText};
`);
const cssRangeInput = styled(cssInput, `
  height: unset;
  width: 120px;
`);
