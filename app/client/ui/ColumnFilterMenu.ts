/**
 * Creates a UI for column filter menu given a columnFilter model, a mapping of cell values to counts, and an onClose
 * callback that's triggered on Apply or on Cancel. Changes to the UI result in changes to the underlying model,
 * but on Cancel the model is reset to its initial state prior to menu closing.
 */
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {ColumnFilter, NEW_FILTER_JSON} from 'app/client/models/ColumnFilter';
import {ColumnFilterMenuModel, IFilterCount} from 'app/client/models/ColumnFilterMenuModel';
import {ColumnRec, ViewFieldRec} from 'app/client/models/DocModel';
import {FilterInfo} from 'app/client/models/entities/ViewSectionRec';
import {RowSource} from 'app/client/models/rowset';
import {ColumnFilterFunc, SectionFilter} from 'app/client/models/SectionFilter';
import {TableData} from 'app/client/models/TableData';
import {ColumnFilterCalendarView} from 'app/client/ui/ColumnFilterCalendarView';
import {relativeDatesControl} from 'app/client/ui/ColumnFilterMenuUtils';
import {cssInput} from 'app/client/ui/cssInput';
import {getDateRangeOptions, IDateRangeOption} from 'app/client/ui/DateRangeOptions';
import {cssPinButton} from 'app/client/ui/RightPanelStyles';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {cssLabel as cssCheckboxLabel, cssCheckboxSquare,
        cssLabelText, Indeterminate, labeledTriStateSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssOptionRowIcon, menu, menuCssClass, menuDivider, menuItem} from 'app/client/ui2018/menus';
import {cssDeleteButton, cssDeleteIcon, cssToken as cssTokenTokenBase} from 'app/client/widgets/ChoiceListEditor';
import {ChoiceOptions} from 'app/client/widgets/ChoiceTextBox';
import {choiceToken} from 'app/client/widgets/ChoiceToken';
import {CellValue} from 'app/common/DocActions';
import {IRelativeDateSpec, isEquivalentFilter, isRelativeBound} from 'app/common/FilterState';
import {extractTypeFromColType, isDateLikeType, isList, isNumberType, isRefListType} from 'app/common/gristTypes';
import {formatRelBounds} from 'app/common/RelativeDates';
import {createFormatter} from 'app/common/ValueFormatter';
import {UIRowId} from 'app/plugin/GristAPI';
import {decodeObject} from 'app/plugin/objtypes';
import {Computed, dom, DomArg, DomElementArg, DomElementMethod, IDisposableOwner,
        input, makeTestId, Observable, styled} from 'grainjs';
import {IOpenController, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import concat = require('lodash/concat');
import identity = require('lodash/identity');
import noop = require('lodash/noop');
import partition = require('lodash/partition');
import some = require('lodash/some');
import tail = require('lodash/tail');
import debounce = require('lodash/debounce');

const t = makeT('ColumnFilterMenu');

export interface IFilterMenuOptions {
  model: ColumnFilterMenuModel;
  valueCounts: Map<CellValue, IFilterCount>;
  rangeInputOptions?: IRangeInputOptions;
  showAllFiltersButton?: boolean;
  doCancel(): void;
  doSave(): void;
  renderValue(key: CellValue, value: IFilterCount): DomElementArg;
  onClose(): void;
  valueParser?(val: string): any;
  valueFormatter?(val: any): string;
}

const testId = makeTestId('test-filter-menu-');

export type IColumnFilterViewType = 'listView'|'calendarView';

/**
 * Returns the DOM content for the column filter menu.
 *
 * For use with setPopupToCreateDom().
 */
export function columnFilterMenu(owner: IDisposableOwner, opts: IFilterMenuOptions): HTMLElement {
  const { model, doCancel, doSave, onClose, renderValue, valueParser, showAllFiltersButton } = opts;
  const { columnFilter, filterInfo, gristDoc } = model;
  const valueFormatter = opts.valueFormatter || ((val) => val?.toString() || '');

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
  const isDateFilter = isDateLikeType(columnFilter.columnType);
  const selectedBoundObs = Observable.create<'min'|'max'|null>(owner, null);
  const viewTypeObs = Computed.create<IColumnFilterViewType>(owner, (
    (use) => isDateFilter && use(selectedBoundObs) ? 'calendarView' : 'listView'
  ));
  const isMinSelected = Computed.create<boolean>(owner, (use) => use(selectedBoundObs) === 'min')
    .onWrite((val) => val ? selectedBoundObs.set('min') : selectedBoundObs.set('max'));
  const isMaxSelected = Computed.create<boolean>(owner, (use) => use(selectedBoundObs) === 'max')
    .onWrite((val) => val ? selectedBoundObs.set('max') : selectedBoundObs.set('min'));

  let searchInput: HTMLInputElement;
  let cancel = false;

  const filterMenu: HTMLElement = cssMenu(
    { tabindex: '-1' }, // Allow menu to be focused
    testId('wrapper'),

    // Makes sure focus goes back to menu container and disable grist keyboard shortcut while open.
    elem => {
      FocusLayer.create(owner, {defaultFocusElem: elem, pauseMousetrap: true});

      // Gives focus to the searchInput on open (or to the min input if the range filter is
      // present). Note that this must happen after the instanciation of FocusLayer in order to
      // correctly override focus set by the latter also using a 0 delay.
      setTimeout(() => {
        const el = searchInput;
        el.focus();
        el.select();
      }, 0);

    },

    dom.cls(menuCssClass),
    dom.autoDispose(filterListener),
    // Save or cancel on disposal, which should always happen as part of closing.
    dom.onDispose(() => cancel ? doCancel() : doSave()),
    dom.onKeyDown({
      Enter: () => onClose(),
      Escape: () => onClose(),
    }),

    // Filter by range
    dom.maybe(showRangeFilter, () => [
      cssRangeContainer(
        rangeInput(
          columnFilter.min, {
            isDateFilter,
            placeholder: isDateFilter ? t("Start") : t("Min"),
            valueParser,
            valueFormatter,
            isSelected: isMinSelected,
            viewTypeObs,
            nextSelected: () => selectedBoundObs.set('max'),
          },
          testId('min'),
          dom.onKeyDown({Tab: (e) => e.shiftKey || selectedBoundObs.set('max')}),
        ),
        rangeInput(
          columnFilter.max, {
            isDateFilter,
            placeholder: isDateFilter ? t("End") : t("Max"),
            valueParser,
            valueFormatter,
            isSelected: isMaxSelected,
            viewTypeObs,
          },
          testId('max'),
          dom.onKeyDown({Tab: (e) => e.shiftKey ? selectedBoundObs.set('min') : selectedBoundObs.set('max')}),
        ),
      ),

      // presets links
      dom.maybe(isDateFilter, () => {
        function action(option: IDateRangeOption) {
          const {min, max} = option;
          columnFilter.min.set(min);
          columnFilter.max.set(max);
          // open the calendar view
          selectedBoundObs.set('min');
        }
        return [
          cssLinkRow(
            testId('presets-links'),
            cssLink(
              getDateRangeOptions()[0].label,
              dom.on('click', () => action(getDateRangeOptions()[0]))
            ),
            cssLink(
              getDateRangeOptions()[1].label,
              dom.on('click', () => action(getDateRangeOptions()[1]))
            ),
            cssLink(
              'More ', icon('Dropdown'),
              menu(() => getDateRangeOptions().map(
                (option) => menuItem(() => action(option), option.label)
              ), {attach: '.' + cssMenu.className})
            ),
          ),
        ];
      }),
      cssMenuDivider(),
    ]),

    dom.domComputed(viewTypeObs, viewType => viewType === 'listView' ? ListView() :
      dom.create(ColumnFilterCalendarView, {
        viewTypeObs, selectedBoundObs, columnFilter,
      })),
    Footer(),

    // Prevents click on presets links submenus (any one of the 'More' submenus) from bubling up and
    // eventually cause the parent menu to close (which used to happen when opening the column
    // filter from the section sort&filter menu)
    dom.on('click', ev => ev.stopPropagation()),
  );

  function ListView() {
    return [
      cssMenuHeader(
        cssSearchIcon('Search'),
        searchInput = cssSearch(
          searchValueObs, { onInput: true },
          testId('search-input'),
          { type: 'search', placeholder: t('Search values') },
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
              dom.text(searchValue ? t('All Shown') : t('All')),
              dom.prop('disabled', isEquivalentFilter(state, allSpec)),
              dom.on('click', () => columnFilter.setState(allSpec)),
              testId('bulk-action'),
            ),
            cssDotSeparator('•'),
            cssSelectAll(
              searchValue ? t('All Except') : t('None'),
              dom.prop('disabled', isEquivalentFilter(state, noneSpec)),
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
        dom.maybe(use => use(filteredValues).length === 0, () => cssNoResults(t("No matching values"))),
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
    ];
  }

  function Footer() {
    return [
      cssMenuDivider(),
      cssMenuFooter(
        dom.domComputed((use) => {
          const isAboveLimit = use(isAboveLimitObs);
          const searchValue = use(isSearchingObs);
          const otherValues = use(model.otherValues);
          const anyOtherValues = Boolean(otherValues.length);
          const valuesBeyondLimit = use(model.valuesBeyondLimit);
          const isRangeFilter = use(columnFilter.isRange);
          if (isRangeFilter || use(viewTypeObs) === 'calendarView') {
            return [];
          }
          if (isAboveLimit) {
            return searchValue ? [
              buildSummary(t("Other Matching"), valuesBeyondLimit, false, model),
              buildSummary(t("Other Non-Matching"), otherValues, true, model),
            ] : [
              buildSummary(t("Other Values"), concat(otherValues, valuesBeyondLimit), false, model),
              buildSummary(t("Future Values"), [], true, model),
            ];
          } else {
            return anyOtherValues ? [
              buildSummary(t('Others'), otherValues, true, model)
            ] : [
              buildSummary(t("Future Values"), [], true, model)
            ];
          }
        }),
        cssFooterButtons(
          dom('div',
            cssPrimaryButton('Close', testId('apply-btn'),
              dom.on('click', () => {
                onClose();
              }),
            ),
            basicButton('Cancel', testId('cancel-btn'),
              dom.on('click', () => {
                cancel = true;
                onClose();
              }),
            ),
            !showAllFiltersButton ? null : cssAllFiltersButton(
              'All filters',
              dom.on('click', () => {
                onClose();
                commands.allCommands.sortFilterMenuOpen.run(filterInfo.viewSection.getRowId());
              }),
              testId('all-filters-btn'),
            ),
          ),
          dom('div',
            cssPinButton(
              icon('PinTilted'),
              cssPinButton.cls('-pinned', model.filterInfo.isPinned),
              dom.on('click', () => filterInfo.pinned(!filterInfo.pinned())),
              gristDoc.behavioralPromptsManager.attachPopup('filterButtons', {
                popupOptions: {
                  attach: null,
                  placement: 'right',
                },
              }),
              testId('pin-btn'),
            ),
          ),
        )
      )
    ];
  }
  return filterMenu;
}

export interface IRangeInputOptions {
  isDateFilter: boolean;
  placeholder: string;
  isSelected: Observable<boolean>;
  viewTypeObs: Observable<IColumnFilterViewType>;
  valueParser?(val: string): any;
  valueFormatter(val: any): string;
  nextSelected?(): void;
}

// The range input with the preset links.
function rangeInput(obs: Observable<number|undefined|IRelativeDateSpec>, opts: IRangeInputOptions,
                    ...args: DomArg<HTMLDivElement>[]) {

  const buildInput = () => [
    dom.maybe(use => isRelativeBound(use(obs)), () => relativeToken(obs, opts)),
    numericInput(obs, opts),
  ];

  return cssRangeInputContainer(

    dom.maybe(opts.isDateFilter, () => [
      cssRangeInputIcon('FieldDate'),
      buildInput(),
      icon('Dropdown')
    ]),

    dom.maybe(!opts.isDateFilter, () => [
      buildInput(),
    ]),

    cssRangeInputContainer.cls('-relative', use => isRelativeBound(use(obs))),
    dom.cls('selected', (use) => use(opts.viewTypeObs) === 'calendarView' && use(opts.isSelected)),
    dom.on('click', () => opts.isSelected.set(true)),
    (elem) => opts.isDateFilter ? attachRelativeDatesOptions(elem, obs, opts) : null,
    dom.onKeyDown({
      Backspace$: () => isRelativeBound(obs.get()) && obs.set(undefined),
    }),
    ...args,
  );
}

// Attach the date options dropdown to elem.
function attachRelativeDatesOptions(elem: HTMLElement, obs: Observable<number|undefined|IRelativeDateSpec>,
                                    opts: IRangeInputOptions) {
  const popupCtl = relativeDatesControl(elem, obs, {
    ...opts,
    placement: 'right-start',
    attach: '.' + cssMenu.className
  });

  // makes sure the options are shown any time the value changes.
  const onValueChange = () => {
    if (opts.isSelected.get()) {
      popupCtl.open();
    } else {
      popupCtl.close();
    }
  };

  // toggle popup on click
  dom.update(elem, [
    dom.on('click', () => popupCtl.toggle()),
    dom.autoDispose(opts.isSelected.addListener(onValueChange)),
    dom.autoDispose(obs.addListener(onValueChange)),
    dom.onKeyDown({
      Enter$: (e) => {
        if (opts.viewTypeObs.get() === 'listView') { return; }
        if (opts.isSelected.get()) {
          if (popupCtl.isOpen()) {
            opts.nextSelected?.();
          } else {
            popupCtl.open();
          }
        }
        // Prevents Enter to close filter menu
        e.stopPropagation();
      },
    }),
  ]);

}

function numericInput(obs: Observable<number|undefined|IRelativeDateSpec>,
                      opts: IRangeInputOptions,
                      ...args: DomArg<HTMLDivElement>[]) {
  const valueParser = opts.valueParser || Number;
  const formatValue = opts.valueFormatter;
  const placeholder = opts.placeholder;
  let editMode = false;
  let inputEl: HTMLInputElement;
  // handle change
  const onBlur = () => {
    onInput.flush();
    editMode = false;
    inputEl.value = formatValue(obs.get());

    setTimeout(() => {
      // Make sure focus is trapped on input during calendar view, so that uses can still use keyboard
      // to navigate relative date options just after picking a date on the calendar.
      if (opts.viewTypeObs.get() === 'calendarView' && opts.isSelected.get()) {
        inputEl.focus();
      }
    });
  };
  const onInput = debounce(() => {
    if (isRelativeBound(obs.get())) { return; }
    editMode = true;
    const val = inputEl.value ? valueParser(inputEl.value) : undefined;
    if (val === undefined || typeof val === 'number' && !isNaN(val)) {
      obs.set(val);
    }
  }, 100);
  // TODO: could be nice to have the cursor positioned at the end of the input
  return inputEl = cssRangeInput(
    {inputmode: 'numeric', placeholder, value: formatValue(obs.get())},
    dom.on('input', onInput),
    dom.on('blur', onBlur),
    // keep input content in sync only when no edit are going on.
    dom.autoDispose(obs.addListener(() => editMode ? null : inputEl.value = formatValue(obs.get()))),
    dom.autoDispose(opts.isSelected.addListener(val => val && inputEl.focus())),

    dom.onKeyDown({
      Enter$: () => onBlur(),
      Tab$: () => onBlur(),
    }),
    ...args,
  );
}

function relativeToken(obs: Observable<number|undefined|IRelativeDateSpec>,
                       opts: IRangeInputOptions) {
  return cssTokenContainer(
    cssTokenToken(
      dom.text((use) => formatRelBounds(use(obs) as IRelativeDateSpec)),
      cssDeleteButton(
        // Ignore mousedown events, so that tokens aren't draggable by the delete button.
        dom.on('mousedown', (ev) => ev.stopPropagation()),
        cssDeleteIcon('CrossSmall'),
        dom.on('click', () => obs.set(undefined)),
        testId('tokenfield-delete'),
      ),
      testId('tokenfield-token'),
    ),
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

export interface IColumnFilterMenuOptions {
  /** If true, shows a button that opens the sort & filter widget menu. */
  showAllFiltersButton?: boolean;
  /** Callback for when the filter menu is closed. */
  onClose?: () => void;
}

export interface ICreateFilterMenuParams extends IColumnFilterMenuOptions {
  openCtl: IOpenController;
  sectionFilter: SectionFilter;
  filterInfo: FilterInfo;
  rowSource: RowSource;
  tableData: TableData;
  gristDoc: GristDoc;
}

/**
 * Returns content for the newly created columnFilterMenu; for use with setPopupToCreateDom().
 */
export function createFilterMenu(params: ICreateFilterMenuParams) {
  const {
    openCtl,
    sectionFilter,
    filterInfo,
    rowSource,
    tableData,
    gristDoc,
    showAllFiltersButton,
    onClose = noop
  } = params;

  // Go through all of our shown and hidden rows, and count them up by the values in this column.
  const {fieldOrColumn, filter, isPinned} = filterInfo;
  const columnType = fieldOrColumn.origCol.peek().type.peek();
  const visibleColumnType = fieldOrColumn.visibleColModel.peek()?.type.peek() || columnType;
  const {keyMapFunc, labelMapFunc, valueMapFunc} = getMapFuncs(columnType, tableData, fieldOrColumn);

  // range input options
  const valueParser = (fieldOrColumn as any).createValueParser?.();
  let colFormatter = fieldOrColumn.visibleColFormatter();

  // Show only the date part of the datetime format in range picker.
  if (extractTypeFromColType(colFormatter.type) === 'DateTime') {
    const {docSettings} = colFormatter;
    const widgetOpts = fieldOrColumn.origCol.peek().widgetOptionsJson();
    colFormatter = createFormatter('Date', widgetOpts, docSettings);
  }

  // formatting values for Numeric columns entail issues. For instance with '%' when users type
  // 0.499 and press enter, the input now shows 50% and there's no way to know what is the actual
  // underlying value. Maybe worse, both 0.499 and 0.495 format to 50% but they can have different
  // effects depending on data. Hence as of writing better to keep it only for Date.
  const valueFormatter = isDateLikeType(visibleColumnType) ?
    (val: any) => colFormatter.formatAny(val) : undefined;

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
  const columnFilter = ColumnFilter.create(openCtl, filter.peek(), columnType, visibleColumnType,
                                           valueCountsArr.map((arr) => arr[0]));
  sectionFilter.setFilterOverride(fieldOrColumn.origCol().getRowId(), columnFilter); // Will be removed on menu disposal
  const model = ColumnFilterMenuModel.create(openCtl, {
    columnFilter,
    filterInfo,
    valueCount: valueCountsArr,
    gristDoc,
  });

  return columnFilterMenu(openCtl, {
    model,
    valueCounts,
    onClose: () => { openCtl.close(); onClose(); },
    doSave: () => {
      const spec = columnFilter.makeFilterJson();
      const {viewSection} = sectionFilter;
      viewSection.setFilter(
        fieldOrColumn.origCol().origColRef(),
        {filter: spec}
      );

      // Check if the save was for a new filter, and if that new filter was pinned. If it was, and
      // it is the second pinned filter in the section, trigger a tip that explains how multiple
      // filters in the same section work.
      const isNewPinnedFilter = columnFilter.initialFilterJson === NEW_FILTER_JSON && isPinned();
      if (isNewPinnedFilter && viewSection.pinnedActiveFilters.get().length === 2) {
        viewSection.showNestedFilteringPopup.set(true);
      }
    },
    doCancel: () => {
      const {viewSection} = sectionFilter;
      if (columnFilter.initialFilterJson === NEW_FILTER_JSON) {
        viewSection.revertFilter(fieldOrColumn.origCol().origColRef());
      } else {
        const initialFilter = columnFilter.initialFilterJson;
        columnFilter.setState(initialFilter);
        viewSection.setFilter(
          fieldOrColumn.origCol().origColRef(),
          {filter: initialFilter, pinned: model.initialPinned}
        );
      }
    },
    renderValue: getRenderFunc(columnType, fieldOrColumn),
    valueParser,
    valueFormatter,
    showAllFiltersButton,
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
function addCountsToMap(valueMap: Map<CellValue, IFilterCount>, rowIds: UIRowId[],
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

interface IColumnFilterPopupOptions {
  // Options to pass to the popup component.
  popupOptions?: IPopupOptions;
}

type IAttachColumnFilterMenuOptions = IColumnFilterPopupOptions & IColumnFilterMenuOptions;

// Helper to attach the column filter menu.
export function attachColumnFilterMenu(
  filterInfo: FilterInfo,
  options: IAttachColumnFilterMenuOptions = {}
): DomElementMethod {
  const {popupOptions, ...filterMenuOptions} = options;
  const popupOptionsWithDefaults = {...defaultPopupOptions, ...popupOptions};
  return (elem) => {
    const instance = filterInfo.viewSection.viewInstance();
    if (instance && instance.createFilterMenu) { // Should be set if using BaseView
      setPopupToCreateDom(elem, ctl => instance.createFilterMenu(
        ctl, filterInfo, filterMenuOptions), popupOptionsWithDefaults);
    }
  };
}

const cssMenu = styled('div', `
  display: flex;
  flex-direction: column;
  min-width: 252px;
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
const cssSelectAll = styled(textButton, `
  --icon-color: ${theme.controlFg};
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
const cssLink = textButton;
const cssLinkRow = styled(cssMenuItem, `
  column-gap: 12px;
  padding-top: 0;
  padding-bottom: 16px;
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
const cssFooterButtons = styled('div', `
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
`);
const cssPrimaryButton = styled(primaryButton, `
  margin-right: 8px;
`);
const cssAllFiltersButton = styled(textButton, `
  margin-left: 8px;
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
const cssRangeContainer = styled(cssMenuItem, `
  display: flex;
  align-items: center;
  row-gap: 6px;
  flex-direction: column;
  padding: 16px 16px;
`);
const cssRangeInputContainer = styled('div', `
  position: relative;
  width: 100%;
  display: flex;
  background-color: ${theme.inputBg};
  height: 30px;
  width: 100%;
  border-radius: 3px;
  border: 1px solid ${theme.inputBorder};
  outline: none;
  padding: 5px;
  &.selected {
    border: 1px solid ${theme.inputValid};
  }
  &-relative input {
    padding: 0;
    max-width: 0;
  }
`);
const cssRangeInputIcon = cssOptionRowIcon;
const cssRangeInput = styled(cssInput, `
  height: unset;
  border: none;
  padding: 0;
  width: unset;
  flex-grow: 1;
`);
const cssTokenToken = styled(cssTokenTokenBase, `
  height: 18px;
  line-height: unset;
  align-self: center;
  cursor: default;
`);
const cssTokenContainer = styled('div', `
  width: 100%;
  display: flex;
  outline: none;
`);
