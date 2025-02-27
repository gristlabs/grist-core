import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnFilter} from 'app/client/models/ColumnFilter';
import {ColumnFilterMenuModel, IFilterCount} from 'app/client/models/ColumnFilterMenuModel';
import * as modelUtil from 'app/client/models/modelUtil';
import {columnFilterMenu, cssItemValue, IFilterMenuOptions} from 'app/client/ui/ColumnFilterMenu';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {createFormatter} from 'app/common/ValueFormatter';
import {createParserRaw} from 'app/common/ValueParser';
import {CellValue} from 'app/plugin/GristData';
import {dom, DomArg, IDisposableOwner, makeTestId, Observable, styled} from 'grainjs';
import ko from 'knockout';
import {noop} from 'lodash';
import {IOpenController, setPopupToCreateDom} from 'popweasel';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

const testId = makeTestId('fixture-');
const dateFormatter = createFormatter('Date', {dateFormat: 'YYYY-MM-DD'}, {locale: 'en-US'});
const dateParser = createParserRaw('Date', {dateFormat: 'YYYY-MM-DD'}, {locale: 'en-US'});

const DATA_BY_TYPES: {[k: string]: Partial<IFilterMenuOptions>} = {
  'Numeric': {
    valueCounts: new Map(patchFilterCount([
      [1, {label: '1', count: 12}],
      [2, {label: '2', count: 24}],
      [3, {label: '3', count: 1}],
      [7, {label: '7', count: 1}],
      [9, {label: '9', count: 1}],
      [31, {label: '311', count: 1}],
      [541, {label: '541', count: 1}],
      [44, {label: '44', count: 1}],
      [81, {label: '81', count: 43}]
    ]))
  },
  'Date': {
    valueCounts: new Map(([['2022-05-05', 3], ['2022-04-05', 1], ['2022-01-05', 5]] as const)
      .map(([d, count]) => {
        const num = dateParser.cleanParse(d);
        return [num, {label: d, count, displayValue: num}];
      })),
    valueParser: dateParser.cleanParse.bind(dateParser),
    valueFormatter: dateFormatter.formatAny.bind(dateFormatter),
  },
  'Text': {
    valueCounts: new Map(patchFilterCount([
      ['Apples',       {label: 'Apples', count: 12}],
      ['Bananas',      {label: 'Bananas', count: 17}],
      ['Cranberries; a very very very long-named fruit',
       {label: 'Cranberries; a very very very long-named fruit', count: 8000}],
      ['Dates',        {label: 'Dates', count: 1}],
      ['Figs',         {label: 'Figs', count: 1}],
      ['Goji berries', {label: 'Goji berries', count: 1}],
      ['Honeydew',     {label: 'Honeydew', count: 1}],
      ['Icicles',      {label: 'Icicles', count: 1}],
      ['Joojoo',       {label: 'Joojoo', count: 1}],
      ['Knapples',     {label: 'Knapples', count: 2}],
      ['Lemons',       {label: 'Lemons', count: 9}],
      ['Mandarins',    {label: 'Mandarins', count: 3}],
      ['Nectarines',   {label: 'Nectarines', count: 5}],
      ['Oranges',      {label: 'Oranges', count: 14}],
      ['Plums',        {label: 'Plums', count: 32}],
      ['Quince',       {label: 'Quince', count: 15}],
      ['Rhubarb',      {label: 'Rhubarb', count: 42}]
    ]))
  }
};

function setupTest(owner: IDisposableOwner, opts: {limitShown?: number, filterType?: string|null} = {},
                   resetBtn: DomArg) {
  const limitShown = opts.limitShown;
  const filterType = opts.filterType || 'Text';
  const valueCounts = DATA_BY_TYPES[filterType].valueCounts!;

  const columnFilter = ColumnFilter.create(null, '', filterType, filterType,
                                           Array.from(valueCounts).map(arr => arr[0]));

  const filter = modelUtil.customComputed({read: () => ''});
  const pinned = modelUtil.customComputed({read: () => false});
  const filterInfo = {
    filter,
    pinned,
    fieldOrColumn: 'unused' as any,
    viewSection: 'unused' as any,
    isFiltered: ko.pureComputed(() => filter() !== ''),
    isPinned: ko.pureComputed(() => pinned()),
  };
  const gristDoc: GristDoc = {
    behavioralPromptsManager: {
      attachPopup: () => {},
    },
  } as any;

  const model = ColumnFilterMenuModel.create(null, {
    columnFilter,
    filterInfo,
    valueCount: Array.from(valueCounts),
    limitShow: limitShown,
    gristDoc,
  });

  const renderValue = (key: CellValue, value: IFilterCount) =>
    cssItemValue(value.label === undefined ? String(key) : value.label);
  const doCancel = () => columnFilter.setState(columnFilter.initialFilterJson);
  const openFilterMenu = (ctl: IOpenController) => dom('div',
    dom.cls('grist-floating-menu'),
    columnFilterMenu(ctl, {
      valueCounts,
      model,
      renderValue,
      doCancel,
      doSave: noop,
      onClose: () => ctl.close(),
      ...DATA_BY_TYPES[filterType],
    })
  );

  return [
    testWrapper(
      testControls(
        dom('button', 'Open menu', testId('filter-menu-btn'),
          (elem) => { setPopupToCreateDom(elem, openFilterMenu, {
            attach: 'body',
            placement: 'bottom-start',
            trigger: ['click']
          }); })
      ),
      testContent(
        dom(
          'div',
          testId('stored-menu'),
          dom.create(columnFilterMenu, ({ model, valueCounts, renderValue, doCancel, doSave: noop, onClose: noop,
                                          ...DATA_BY_TYPES[filterType] }))
        ),
        dom.domComputed(columnFilter.filterFunc, filterFunc =>
          testOutput(
            resetBtn,
            dom('div', testId('json'), columnFilter.makeFilterJson()),
            dom('div', 'All values: ',
            dom('span', testId('all-values'),
            `[${Array.from(valueCounts.keys()).join(', ')}]`)),
            dom('div', 'Displayed values: ',
            dom('span', testId('displayed-values'),
            `[${Array.from(valueCounts.keys()).filter(filterFunc).join(', ')}]`)),
          )
        )
      )
    )
  ];
}

function patchFilterCount(arr: Array<[any, {label: string, count: number}]>): Array<[any, IFilterCount]> {
  return arr.map(([val, filterCount]) => [val, {...filterCount, displayValue: filterCount.label}]);
}

function getFilterTypeFromUrl() {
  const params = (new URL(document.location.href)).searchParams;
  return params.get('filterType');
}

function setFilterType(val: string) {
  const url = new URL(document.location.href);
  const params = url.searchParams;
  params.set('filterType', val);
  document.location.href = url.href;
}

function setup(owner: IDisposableOwner) {
  let limitShownInput: HTMLInputElement;
  const filterType = getFilterTypeFromUrl() || 'Text';
  const getOpt = () => ({
    limitShown: limitShownInput.value ? Number(limitShownInput.value) : undefined,
    filterType: getFilterTypeFromUrl(),
  });
  const resetBtn = [
    dom(
      'div',
      'limitShown: ',
      limitShownInput = dom(
        'input', {type: 'text', value: ''},
        testId('limit-shown')
      )
    ),
    dom(
      'input', {type: 'button', value: 'Reset All'},
      testId('reset'),
      dom.on('click', () => { value.set(dom.create(setupTest, getOpt(), resetBtn)); })
    ),
    dom(
      'select',
      ['Numeric', 'Date', 'Text'].map(value => (
        dom('option', {value, selected: filterType === value}, value)
      )),
      dom.on('input', (ev, el) => setFilterType(el.value))
    )
  ];
  const value = Observable.create(owner, dom.create(setupTest, getOpt(), resetBtn));
  return [
    dom('div', dom.domComputed(value)),
  ];
}

const testWrapper = styled('div', `
  display: flex;
`);

const testControls = styled('div', `
  min-width: 400px;
`);

const testContent = styled('div', `
  display: flex;
`);

const testOutput = styled('div', `
  max-width: 300px;
  padding: 5px;
  margin: 12px;
  border: 1px solid black;
`);

void withLocale(() => {
  // Load icons.css, wait for it to load, then build the page.
  document.head.appendChild(dom('link', {rel: 'stylesheet', href: 'icons.css'},
    dom.on('load', () => dom.update(document.body, dom.cls(cssRootVars), dom.create(setup)))
  ));
});
