import {t} from 'app/client/lib/localization';
import { reportError } from 'app/client/models/AppModel';
import { ColumnRec, DocModel, TableRec, ViewSectionRec } from 'app/client/models/DocModel';
import { linkId, NoLink } from 'app/client/ui/selectBy';
import { getWidgetTypes, IWidgetType } from 'app/client/ui/widgetTypes';
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { spinnerModal } from 'app/client/ui2018/modals';
import { isLongerThan, nativeCompare } from "app/common/gutil";
import { computed, Computed, Disposable, dom, domComputed, fromKo, IOption, select} from "grainjs";
import { makeTestId, Observable, onKeyDown, styled} from "grainjs";
import without = require('lodash/without');
import Popper from 'popper.js';
import { IOpenController, popupOpen, setPopupToCreateDom } from 'popweasel';

const translate = (x: string, args?: any): string => t(`PageWidgetPicker.${x}`, args);

type TableId = number|'New Table'|null;

// Describes a widget selection.
export interface IPageWidget {

  // The widget type
  type: IWidgetType;

  // The table (one of the listed tables or 'New Table')
  table: TableId;

  // Whether to summarize the table (not available for "New Table").
  summarize: boolean;

  // some of the listed columns to use to summarize the table.
  columns: number[];

  // link
  link: string;

  // the page widget section id (should be 0 for a to-be-saved new widget)
  section: number;
}

// Creates a IPageWidget from a ViewSectionRec.
export function toPageWidget(section: ViewSectionRec): IPageWidget {
  const link = linkId({
    srcSectionRef: section.linkSrcSectionRef.peek(),
    srcColRef: section.linkSrcColRef.peek(),
    targetColRef: section.linkTargetColRef.peek()
  });
  return {
    type: section.parentKey.peek() as IWidgetType,
    table: section.table.peek().summarySourceTable.peek() || section.tableRef.peek(),
    summarize: Boolean(section.table.peek().summarySourceTable.peek()),
    columns: section.table.peek().columns.peek().peek()
      .filter((col) => col.summarySourceCol.peek())
      .map((col) => col.summarySourceCol.peek()),
    link, section: section.id.peek()
  };
}


export interface IOptions extends ISelectOptions {

  // the initial selected value, we call the function when the popup get triggered
  value?: () => IPageWidget;

  // placement, directly passed to the underlying Popper library.
  placement?: Popper.Placement;
}

const testId = makeTestId('test-wselect-');

// The picker disables some choices that do not make much sense. This function return the list of
// compatible types given the tableId and whether user is creating a new page or not.
function getCompatibleTypes(tableId: TableId, isNewPage: boolean|undefined): IWidgetType[] {
  if (tableId !== 'New Table') {
    return ['record', 'single', 'detail', 'chart', 'custom'];
  } else if (isNewPage) {
    // New view + new table means we'll be switching to the primary view.
    return ['record'];
  } else {
    // The type 'chart' makes little sense when creating a new table.
    return ['record', 'single', 'detail'];
  }
}

// Whether table and type make for a valid selection whether the user is creating a new page or not.
function isValidSelection(table: TableId, type: IWidgetType, isNewPage: boolean|undefined) {
  return table !== null && getCompatibleTypes(table, isNewPage).includes(type);
}

export type ISaveFunc = (val: IPageWidget) => Promise<any>;

// Delay in milliseconds, after a user click on the save btn, before we start showing a modal
// spinner. If saving completes before this time elapses (which is likely to happen for regular
// table) we don't show the modal spinner.
const DELAY_BEFORE_SPINNER_MS = 500;

// Attaches the page widget picker to elem to open on 'click' on the left.
export function attachPageWidgetPicker(elem: HTMLElement, docModel: DocModel, onSave: ISaveFunc,
                                       options: IOptions = {}) {
  // Overrides .placement, this is needed to enable the page widget to update position when user
  // expand the `Group By` panel.
  // TODO: remove .placement from the options of this method (note: breaking buildPageWidgetPicker
  // into two steps, one for model creation and the other for building UI, seems promising. In
  // particular listening to value.summarize to update popup position could be done directly in
  // code).
  options.placement = 'left';
  const domCreator = (ctl: IOpenController) => buildPageWidgetPicker(ctl, docModel, onSave, options);
  setPopupToCreateDom(elem, domCreator, {
    placement: 'left',
    trigger: ['click'],
    attach: 'body',
    boundaries: 'viewport'
  });
}

// Open page widget widget picker on the right of element.
export function openPageWidgetPicker(elem: HTMLElement, docModel: DocModel, onSave: ISaveFunc,
                                     options: IOptions = {}) {
  popupOpen(elem, (ctl) => buildPageWidgetPicker(
    ctl, docModel, onSave, options
  ), { placement: 'right' });
}

// Builds a picker to stick into the popup. Takes care of setting up the initial selected value and
// bind various events to the popup behaviours: close popup on save, gives focus to the picker,
// binds cancel and save to Escape and Enter keydown events. Also takes care of preventing the popup
// to overlay the trigger element (which could happen when the 'Group By' panel is expanded for the
// first time). When saving is taking time, show a modal spinner (see DELAY_BEFORE_SPINNER_MS).
export function buildPageWidgetPicker(
    ctl: IOpenController,
    docModel: DocModel,
    onSave: ISaveFunc,
    options: IOptions = {}) {

  const tables = fromKo(docModel.visibleTables.getObservable());
  const columns = fromKo(docModel.columns.createAllRowsModel('parentPos').getObservable());

  // default value for when it is omitted
  const defaultValue: IPageWidget = {
    type: 'record',
    table: null, // when creating a new widget, let's initially have no table selected
    summarize: false,
    columns: [],
    link: NoLink,
    section: 0,
  };

  // get initial value and setup state for the picker.
  const initValue = options.value && options.value() || defaultValue;
  const value: IWidgetValueObs = {
    type: Observable.create(ctl, initValue.type),
    table: Observable.create(ctl, initValue.table),
    summarize: Observable.create(ctl, initValue.summarize),
    columns: Observable.create(ctl, initValue.columns),
    link: Observable.create(ctl, initValue.link),
    section: Observable.create(ctl, initValue.section)
  };

  // calls onSave and closes the popup. Failure must be handled by the caller.
  async function onSaveCB() {
    ctl.close();
    const type = value.type.get();
    const savePromise = onSave({
      type,
      table: value.table.get(),
      summarize: value.summarize.get(),
      columns: sortedAs(value.columns.get(), columns.get().map((col) => col.id.peek())),
      link: value.link.get(),
      section: value.section.get(),
    });
    if (value.table.get() === 'New Table') {
      // Adding empty table will show a prompt, so we don't want to wait for it.
      await savePromise;
    } else {
      // If savePromise throws an error, before or after timeout, we let the error propagate as it
      // should be handle by the caller.
      if (await isLongerThan(savePromise, DELAY_BEFORE_SPINNER_MS)) {
        const label = getWidgetTypes(type).label;
        await spinnerModal(translate('BuildingWidget', { label }), savePromise);
      }
    }
  }

  // whether the current selection is valid
  function isValid() {
    return isValidSelection(value.table.get(), value.type.get(), options.isNewPage);
  }

  // Summarizing a table causes the 'Group By' panel to expand on the right. To prevent it from
  // overlaying the trigger, we bind an update of the popup to it when it is on the left of the
  // trigger.
  // WARN: This does not work when the picker is triggered from a menu item because the trigger
  // element does not exist anymore at this time so calling update will misplace the popup. However,
  // this is not a problem at the time or writing because the picker is never placed at the left of
  // a menu item (currently picker is only placed at the right of a menu item and at the left of a
  // basic button).
  if (options.placement && options.placement === 'left') {
    ctl.autoDispose(value.summarize.addListener((val, old) => val && ctl.update()));
  }

  // dom
  return cssPopupWrapper(
    dom.create(PageWidgetSelect, value, tables, columns, onSaveCB, options),

    // gives focus and binds keydown events
    (elem: any) => { setTimeout(() => elem.focus(), 0); },
    onKeyDown({
      Escape: () => ctl.close(),
      Enter: () => isValid() && onSaveCB()
    })

  );
}

// Same as IWidgetValue but with observable values
export type IWidgetValueObs = {
  [P in keyof IPageWidget]: Observable<IPageWidget[P]>;
};


export interface ISelectOptions {

  // the button's label
  buttonLabel?: string;

  // Indicates whether the section builder is in a new view
  isNewPage?: boolean;

  // A callback to provides the links that are available to a page widget. It is called any time the
  // user changes in the selected page widget (type, table, summary ...) and we update the "SELECT
  // BY" dropdown with the result list of options. The "SELECT BY" dropdown is hidden if omitted.
  selectBy?: (val: IPageWidget) => Array<IOption<string>>;
}

// the list of widget types in the order they should be listed by the widget.
const sectionTypes: IWidgetType[] = [
  'record', 'single', 'detail', 'chart', 'custom'
];


// Returns dom that let a user select a page widget. User can select a widget type (id: 'grid',
// 'card', ...), one of `tables` and optionally some of the `columns` of the selected table if she
// wants to generate a summary. Clicking the `Add ...` button trigger `onSave()`. Note: this is an
// internal method used by widgetPicker, it is only exposed for testing reason.
export class PageWidgetSelect extends Disposable {

  // an observable holding the list of options of the `select by` dropdown
  private _selectByOptions = this._options.selectBy ?
    Computed.create(this, (use) => {
      // TODO: it is unfortunate to have to convert from IWidgetValueObs to IWidgetValue. Maybe
      // better to change this._value to be Observable<IWidgetValue> instead.
      const val = {
        type: use(this._value.type),
        table: use(this._value.table),
        summarize: use(this._value.summarize),
        columns: use(this._value.columns),
        // should not have a dependency on .link
        link: this._value.link.get(),
        section: use(this._value.section),
      };
      return this._options.selectBy!(val);
    }) :
    null;

  private _isNewTableDisabled = Computed.create(this, this._value.type, (use, t) => !isValidSelection(
    'New Table', t, this._options.isNewPage));

  constructor(
    private _value: IWidgetValueObs,
    private _tables: Observable<TableRec[]>,
    private _columns: Observable<ColumnRec[]>,
    private _onSave: () => Promise<void>,
    private _options: ISelectOptions = {}
  ) { super(); }

  public buildDom() {
    return cssContainer(
      testId('container'),
      cssBody(
        cssPanel(
          header(translate('SelectWidget')),
          sectionTypes.map((value) => {
            const {label, icon: iconName} = getWidgetTypes(value);
            const disabled = computed(this._value.table, (use, tid) => this._isTypeDisabled(value, tid));
            return cssEntry(
              dom.autoDispose(disabled),
              cssTypeIcon(iconName),
              label,
              dom.on('click', () => !disabled.get() && this._selectType(value)),
              cssEntry.cls('-selected', (use) => use(this._value.type) === value),
              cssEntry.cls('-disabled', disabled),
              testId('type'),
            );
          }),
        ),
        cssPanel(
          testId('data'),
          header(translate('Select Data')),
          cssEntry(
            cssIcon('TypeTable'), 'New Table',
            // prevent the selection of 'New Table' if it is disabled
            dom.on('click', (ev) => !this._isNewTableDisabled.get() && this._selectTable('New Table')),
            cssEntry.cls('-selected', (use) => use(this._value.table) === 'New Table'),
            cssEntry.cls('-disabled', this._isNewTableDisabled),
            testId('table')
          ),
          dom.forEach(this._tables, (table) => dom('div',
            cssEntryWrapper(
              cssEntry(cssIcon('TypeTable'),
                       cssLabel(dom.text(use => use(table.tableNameDef) || use(table.tableId))),
                       dom.on('click', () => this._selectTable(table.id())),
                       cssEntry.cls('-selected', (use) => use(this._value.table) === table.id()),
                       testId('table-label')
              ),
              cssPivot(
                cssBigIcon('Pivot'),
                cssEntry.cls('-selected', (use) => use(this._value.summarize) && use(this._value.table) === table.id()),
                dom.on('click', (ev, el) => this._selectPivot(table.id(), el as HTMLElement)),
                testId('pivot'),
              ),
              testId('table'),
            )
          )),
        ),
        cssPanel(
          header(translate('GroupBy')),
          dom.hide((use) => !use(this._value.summarize)),
          domComputed(
            (use) => use(this._columns)
              .filter((col) => !col.isHiddenCol() && col.parentId() === use(this._value.table)),
            (cols) => cols ?
              dom.forEach(cols, (col) =>
                cssEntry(cssIcon('FieldColumn'), cssFieldLabel(dom.text(col.label)),
                  dom.on('click', () => this._toggleColumnId(col.id())),
                  cssEntry.cls('-selected', (use) => use(this._value.columns).includes(col.id())),
                  testId('column')
                )
              ) :
              null
          ),
        ),
      ),
      cssFooter(
        cssFooterContent(
          // If _selectByOptions exists and has more than then "NoLinkOption", show the selector.
          dom.maybe((use) => this._selectByOptions && use(this._selectByOptions).length > 1, () => cssSelectBy(
            cssSmallLabel('SELECT BY'),
            dom.update(cssSelect(this._value.link, this._selectByOptions!),
                       testId('selectby'))
          )),
          dom('div', {style: 'flex-grow: 1'}),
          bigPrimaryButton(
            // TODO: The button's label of the page widget picker should read 'Close' instead when
            // there are no changes.
            this._options.buttonLabel || translate('AddToPage'),
            dom.prop('disabled', (use) => !isValidSelection(
              use(this._value.table), use(this._value.type), this._options.isNewPage)
            ),
            dom.on('click', () => this._onSave().catch(reportError)),
            testId('addBtn'),
          ),
        ),
      ),
    );
  }

  private _closeSummarizePanel() {
    this._value.summarize.set(false);
    this._value.columns.set([]);
  }

  private _openSummarizePanel() {
    this._value.summarize.set(true);
  }

  private _selectType(t: IWidgetType) {
    this._value.type.set(t);
  }

  private _selectTable(tid: TableId) {
    if (tid !== this._value.table.get()) {
      this._value.link.set(NoLink);
    }
    this._value.table.set(tid);
    this._closeSummarizePanel();
  }

  private _isSelected(el: HTMLElement) {
    return el.classList.contains(cssEntry.className + '-selected');
  }

  private _selectPivot(tid: TableId, pivotEl: HTMLElement) {
    if (this._isSelected(pivotEl)) {
      this._closeSummarizePanel();
    } else {
      if (tid !== this._value.table.get()) {
        this._value.columns.set([]);
        this._value.table.set(tid);
        this._value.link.set(NoLink);
      }
      this._openSummarizePanel();
    }
  }

  private _toggleColumnId(cid: number) {
    const ids = this._value.columns.get();
    const newIds = ids.includes(cid) ? without(ids, cid) : [...ids, cid];
    this._value.columns.set(newIds);
  }

  private _isTypeDisabled(type: IWidgetType, table: TableId) {
    if (table === null) {
      return false;
    }
    return !getCompatibleTypes(table, this._options.isNewPage).includes(type);
  }

}

function header(label: string) {
  return cssHeader(dom('h4', label), testId('heading'));
}

const cssContainer = styled('div', `
  --outline: 1px solid ${theme.widgetPickerBorder};

  max-height: 386px;
  box-shadow: 0 2px 20px 0 ${theme.widgetPickerShadow};
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  user-select: none;
  background-color: ${theme.widgetPickerPrimaryBg};
`);

const cssPopupWrapper = styled('div', `
  &:focus {
    outline: none;
  }
`);

const cssBody = styled('div', `
  display: flex;
  min-height: 0;
`);

// todo: try replace min-width / max-width
const cssPanel = styled('div', `
  width: 224px;
  font-size: ${vars.mediumFontSize};
  overflow: auto;
  padding-bottom: 18px;
  &:nth-of-type(2n) {
    background-color: ${theme.widgetPickerSecondaryBg};
    outline: var(--outline);
  }
`);

const cssHeader = styled('div', `
  color: ${theme.text};
  margin: 24px 0 24px 24px;
  font-size: ${vars.mediumFontSize};
`);

const cssEntry = styled('div', `
  color: ${theme.widgetPickerItemFg};
  padding: 0 0 0 24px;
  height: 32px;
  display: flex;
  flex-direction: row;
  flex: 1 1 0px;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  &-selected {
    background-color: ${theme.widgetPickerItemSelectedBg};
  }
  &-disabled {
    color: ${theme.widgetPickerItemDisabledBg};
    cursor: default;
  }
  &-disabled&-selected {
    background-color: inherit;
  }
`);

const cssIcon = styled(icon, `
  margin-right: 8px;
  flex-shrink: 0;
  --icon-color: ${theme.widgetPickerIcon};
  .${cssEntry.className}-disabled > & {
    opacity: 0.25;
  }
`);

const cssTypeIcon = styled(cssIcon, `
  --icon-color: ${theme.widgetPickerPrimaryIcon};
`);

const cssLabel = styled('span', `
  text-overflow: ellipsis;
  overflow: hidden;
`);

const cssFieldLabel = styled(cssLabel, `
  padding-right: 8px;
`);

const cssEntryWrapper = styled('div', `
  display: flex;
  align-items: center;
`);

const cssPivot = styled(cssEntry, `
  width: 48px;
  padding-left: 8px;
  flex: 0 0 auto;
`);

const cssBigIcon = styled(icon, `
  width: 24px;
  height: 24px;
  background-color: ${theme.widgetPickerSummaryIcon};
`);

const cssFooter = styled('div', `
  display: flex;
  border-top: var(--outline);
`);

const cssFooterContent = styled('div', `
  flex-grow: 1;
  height: 65px;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 24px 0 24px;
`);

const cssSmallLabel = styled('span', `
  color: ${theme.text};
  font-size: ${vars.xsmallFontSize};
  margin-right: 8px;
`);

const cssSelect = styled(select, `
  color: ${theme.selectButtonFg};
  background-color: ${theme.selectButtonBg};
  flex: 1 0 160px;
  width: 160px;
`);

const cssSelectBy = styled('div', `
  display: flex;
  align-items: center;
`);

// Returns a copy of array with its items sorted in the same order as they appear in other.
function sortedAs(array: number[], other: number[]) {
  const order: {[id: number]: number} = {};
  for (const [index, item] of other.entries()) {
    order[item] = index;
  }
  return array.slice().sort((a, b) => nativeCompare(order[a], order[b]));
}
