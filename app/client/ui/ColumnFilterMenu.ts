/**
 * Creates a UI for column filter menu given a columnFilter model, a mapping of cell values to counts, and an onClose
 * callback that's triggered on Apply or on Cancel. Changes to the UI result in changes to the underlying model,
 * but on Cancel the model is reset to its initial state prior to menu closing.
 */

import {allInclusive, ColumnFilter} from 'app/client/models/ColumnFilter';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {FilteredRowSource} from 'app/client/models/rowset';
import {SectionFilter} from 'app/client/models/SectionFilter';
import {TableData} from 'app/client/models/TableData';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {cssCheckboxSquare, cssLabel, cssLabelText} from 'app/client/ui2018/checkbox';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass, menuDivider, menuIcon} from 'app/client/ui2018/menus';
import {CellValue} from 'app/common/DocActions';
import {nativeCompare} from 'app/common/gutil';
import {Computed, dom, input, makeTestId, Observable, styled} from 'grainjs';
import escapeRegExp = require('lodash/escapeRegExp');
import identity = require('lodash/identity');
import {IOpenController} from 'popweasel';


interface IFilterCount {
  label: string;
  count: number;
}

interface IFilterMenuOptions {
  columnFilter: ColumnFilter;
  valueCounts: Map<CellValue, IFilterCount>;
  doSave: (reset: boolean) => void;
  onClose: () => void;
}

export function columnFilterMenu({ columnFilter, valueCounts, doSave, onClose }: IFilterMenuOptions): HTMLElement {
  // Save the initial state to allow reverting back to it on Cancel
  const initialStateJson = columnFilter.makeFilterJson();

  const testId = makeTestId('test-filter-menu-');

  // Computed boolean reflecting whether current filter state is all-inclusive.
  const includesAll: Computed<boolean> = Computed.create(null, columnFilter.filterFunc, () => {
    const spec = columnFilter.makeFilterJson();
    return spec === allInclusive;
  });

  // Map to keep track of displayed checkboxes
  const checkboxMap: Map<CellValue, HTMLInputElement> = new Map();

  // Listen for changes to filterFunc, and update checkboxes accordingly
  const filterListener = columnFilter.filterFunc.addListener(func => {
    for (const [value, elem] of checkboxMap) {
      elem.checked = func(value);
    }
  });

  const valueCountArr: Array<[CellValue, IFilterCount]> = Array.from(valueCounts);

  const openSearch = Observable.create(null, false);
  const searchValueObs = Observable.create(null, '');
  const filteredValues = Computed.create(null, openSearch, searchValueObs, (_use, isOpen, searchValue) => {
    const searchRegex = new RegExp(escapeRegExp(searchValue), 'i');
    return valueCountArr.filter(([key]) => !isOpen || searchRegex.test(key as string))
    .sort((a, b) => nativeCompare(a[1].label, b[1].label));
  });

  let searchInput: HTMLInputElement;
  let reset = false;

  const filterMenu: HTMLElement = cssMenu(
    { tabindex: '-1' }, // Allow menu to be focused
    testId('wrapper'),
    dom.cls(menuCssClass),
    dom.autoDispose(includesAll),
    dom.autoDispose(filterListener),
    dom.autoDispose(openSearch),
    dom.autoDispose(searchValueObs),
    dom.autoDispose(filteredValues),
    (elem) => { setTimeout(() => elem.focus(), 0); }, // Grab focus on open
    dom.onDispose(() => doSave(reset)),    // Save on disposal, which should always happen as part of closing.
    dom.onKeyDown({
      Enter: () => onClose(),
      Escape: () => onClose()
    }),
    cssMenuHeader(
      cssSelectAll(testId('select-all'),
        dom.hide(openSearch),
        dom.on('click', () => includesAll.get() ? columnFilter.clear() : columnFilter.selectAll()),
        dom.domComputed(includesAll, yesNo => [
          menuIcon(yesNo ? 'CrossSmall' : 'Tick'),
          yesNo ? 'Select none' : 'Select all'
        ])
      ),
      dom.maybe(openSearch, () => { return [
        cssLabel(
          cssCheckboxSquare({type: 'checkbox', checked: includesAll.get()}, testId('search-select'),
            dom.on('change', (_ev, elem) => {
              if (!searchValueObs.get()) { // If no search has been entered, treat select/deselect as Select All
                elem.checked ? columnFilter.selectAll() : columnFilter.clear();
              } else { // Otherwise, add/remove specific matched values
                filteredValues.get()
                .forEach(([key]) => elem.checked ? columnFilter.add(key) : columnFilter.delete(key));
              }
            })
          )
        ),
        searchInput = cssSearch(searchValueObs, { onInput: true },
          testId('search-input'),
          { type: 'search', placeholder: 'Search values' },
          dom.show(openSearch),
          dom.onKeyDown({
            Enter: () => undefined,
            Escape: () => {
              setTimeout(() => filterMenu.focus(), 0); // Give focus back to menu
              openSearch.set(false);
            }
          })
        )
      ]; }),
      dom.domComputed(openSearch, isOpen => isOpen ?
        cssSearchIcon('CrossBig', testId('search-close'), dom.on('click', () => {
          openSearch.set(false);
          searchValueObs.set('');
        })) :
        cssSearchIcon('Search', testId('search-open'), dom.on('click', () => {
          openSearch.set(true);
          setTimeout(() => searchInput.focus(), 0);
        }))
      )
    ),
    cssMenuDivider(),
    cssItemList(
      testId('list'),
      dom.maybe(use => use(filteredValues).length === 0, () => cssNoResults('No matching values')),
      dom.forEach(filteredValues, ([key, value]) => cssMenuItem(
        cssLabel(
          cssCheckboxSquare({type: 'checkbox'},
            dom.on('change', (_ev, elem) =>
              elem.checked ? columnFilter.add(key) : columnFilter.delete(key)),
            (elem) => { elem.checked = columnFilter.includes(key); checkboxMap.set(key, elem); }),
            cssItemValue(value.label === undefined ? key as string : value.label),
        ),
        cssItemCount(value.count.toLocaleString())) // Include comma separator
      )
    ),
    cssMenuDivider(),
    cssMenuFooter(
      cssApplyButton('Apply', testId('apply-btn'),
        dom.on('click', () => { reset = true; onClose(); })),
      basicButton('Cancel', testId('cancel-btn'),
        dom.on('click', () => { columnFilter.setState(initialStateJson); onClose(); } )))
  );
  return filterMenu;
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
  addCountsToMap(valueCounts, rowSource.getAllRows() as Iterable<number>, valueGetter, valueMapFunc);
  addCountsToMap(valueCounts, rowSource.getHiddenRows() as Iterable<number>, valueGetter, valueMapFunc);

  const columnFilter = ColumnFilter.create(openCtl, field.activeFilter.peek());
  sectionFilter.setFilterOverride(field.getRowId(), columnFilter); // Will be removed on menu disposal

  return columnFilterMenu({
    columnFilter,
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

const cssMenu = styled('div', `
  display: flex;
  flex-direction: column;
  min-width: 400px;
  max-width: 400px;
  max-height: 90vh;
  outline: none;
  background-color: white;
`);
const cssMenuHeader = styled('div', `
  flex-shrink: 0;

  display: flex;
  align-items: center;

  margin: 0 8px;
`);
const cssSelectAll = styled('div', `
  display: flex;
  color: ${colors.lightGreen};
  cursor: default;
  user-select: none;
`);
const cssMenuDivider = styled(menuDivider, `
  flex-shrink: 0;
  margin: 8px 0;
`);
const cssItemList = styled('div', `
  flex-shrink: 1;
  overflow: auto;
  padding-right: 8px; /* Space for scrollbar */
  min-height: 80px;
`);
const cssMenuItem = styled('div', `
  display: flex;
  padding: 4px 8px;
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
  margin: 0 8px;
  flex-shrink: 0;
`);
const cssApplyButton = styled(primaryButton, `
  margin-right: 4px;
`);
const cssSearch = styled(input, `
  flex-grow: 1;
  min-width: 1px;
  -webkit-appearance: none;
  -moz-appearance: none;

  font-size: ${vars.controlFontSize};

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
