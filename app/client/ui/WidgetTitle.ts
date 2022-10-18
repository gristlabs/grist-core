import {t} from 'app/client/lib/localization';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {basicButton, cssButton, primaryButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {cssTextInput} from 'app/client/ui2018/editableLabel';
import {menuCssClass} from 'app/client/ui2018/menus';
import {ModalControl} from 'app/client/ui2018/modals';
import {Computed, dom, DomElementArg, IInputOptions, input, makeTestId, Observable, styled} from 'grainjs';
import {IOpenController, setPopupToCreateDom} from 'popweasel';

const testId = makeTestId('test-widget-title-');
const translate = (x: string, args?: any): string => t(`WidgetTitle.${x}`, args);

interface WidgetTitleOptions {
  tableNameHidden?: boolean,
  widgetNameHidden?: boolean,
}

export function buildWidgetTitle(vs: ViewSectionRec, options: WidgetTitleOptions, ...args: DomElementArg[]) {
  const title = Computed.create(null, use => use(vs.titleDef));
  return buildRenameWidget(vs, title, options, dom.autoDispose(title), ...args);
}

export function buildTableName(vs: ViewSectionRec, ...args: DomElementArg[]) {
  const title = Computed.create(null, use => use(use(vs.table).tableNameDef));
  return buildRenameWidget(vs, title, { widgetNameHidden: true }, dom.autoDispose(title), ...args);
}

export function buildRenameWidget(
  vs: ViewSectionRec,
  title: Observable<string>,
  options: WidgetTitleOptions,
  ...args: DomElementArg[]) {
  return cssTitleContainer(
    cssTitle(
      testId('text'),
      dom.text(title),
      // In case titleDef is all blank space, make it visible on hover.
      cssTitle.cls("-empty", use => !use(title)?.trim()),
      elem => {
        setPopupToCreateDom(elem, ctl => buildWidgetRenamePopup(ctl, vs, options), {
          placement: 'bottom-start',
          trigger: ['click'],
          attach: 'body',
          boundaries: 'viewport',
        });
      },
      dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
    ),
    ...args
  );
}

function buildWidgetRenamePopup(ctrl: IOpenController, vs: ViewSectionRec, options: WidgetTitleOptions) {
  const tableRec = vs.table.peek();
  // If the table is a summary table.
  const isSummary = Boolean(tableRec.summarySourceTable.peek());
  // Table name, for summary table it contains also a grouping description, but it is not editable.
  // Example: Table1 or Table1 [by B, C]
  const tableName = [tableRec.tableNameDef.peek(), tableRec.groupDesc.peek()]
                    .filter(p => Boolean(p?.trim())).join(' ');
  // User input for table name.
  const inputTableName = Observable.create(ctrl, tableName);
  // User input for widget title.
  const inputWidgetTitle = Observable.create(ctrl, vs.title.peek() ?? '');
  // Placeholder for widget title:
  // - when widget title is empty shows a default widget title (what would be shown when title is empty)
  // - when widget title is set, shows just a text to override it.
  const inputWidgetPlaceholder = !vs.title.peek() ? translate('OverrideTitle') : vs.defaultWidgetTitle.peek();

  const disableSave = Computed.create(ctrl, (use) => {
    const newTableName = use(inputTableName)?.trim() ?? '';
    const newWidgetTitle = use(inputWidgetTitle)?.trim() ?? '';
    // Can't save when table name is empty or there wasn't any change.
    return !newTableName || (newTableName === tableName && newWidgetTitle === use(vs.title));
  });

  const modalCtl = ModalControl.create(ctrl, () => ctrl.close());

  const saveTableName = async () => {
    // For summary table ignore - though we could rename primary table.
    if (isSummary) { return; }
    // Can't save an empty name - there are actually no good reasons why we can't have empty table name,
    // unfortunately there are some use cases that really on the empty name:
    // - For ACL we sometimes may check if tableId is empty (and sometimes if table name).
    // - Pages with empty name are not visible by default (and pages are renamed with a table - if their name match).
    if (!inputTableName.get().trim()) { return; }
    // If value was changed.
    if (inputTableName.get() !== tableRec.tableNameDef.peek()) {
      await tableRec.tableNameDef.saveOnly(inputTableName.get());
    }
  };

  const saveWidgetTitle = async () => {
    const newTitle = inputWidgetTitle.get()?.trim() ?? '';
    // If value was changed.
    if (newTitle !== vs.title.peek()) {
      await vs.title.saveOnly(newTitle);
    }
  };
  const doSave = modalCtl.doWork(() => Promise.all([
    saveTableName(),
    saveWidgetTitle()
  ]), {close: true});

  function initialFocus() {
    const isRawView = !widgetInput;
    const isWidgetTitleEmpty = !vs.title.peek();
    function focus(inputEl?: HTMLInputElement) {
      inputEl?.focus();
      inputEl?.select();
    }
    if (isSummary) {
      focus(widgetInput);
    } else if (isRawView) {
      focus(tableInput);
    } else if (isWidgetTitleEmpty) {
      focus(tableInput);
    } else {
      focus(widgetInput);
    }
  }

  // Build actual dom that looks like:
  // DATA TABLE NAME
  // [input]
  // WIDGET TITLE
  // [input]
  // [Save] [Cancel]
  let tableInput: HTMLInputElement|undefined;
  let widgetInput: HTMLInputElement|undefined;
  return cssRenamePopup(
    // Create a FocusLayer to keep focus in this popup while it's active, and prevent keyboard
    // shortcuts from being seen by the view underneath.
    elem => { FocusLayer.create(ctrl, {defaultFocusElem: elem, pauseMousetrap: true}); },
    testId('popup'),
    dom.cls(menuCssClass),
    dom.maybe(!options.tableNameHidden, () => [
      cssLabel(translate('DataTableName')),
      // Update tableName on key stroke - this will show the default widget name as we type.
      // above this modal.
      tableInput = cssInput(
        inputTableName,
        updateOnKey,
        {disabled: isSummary, placeholder: translate('NewTableName')},
        testId('table-name-input')
      ),
    ]),
    dom.maybe(!options.widgetNameHidden, () => [
      cssLabel(translate('WidgetTitle')),
      widgetInput = cssInput(inputWidgetTitle, updateOnKey, {placeholder: inputWidgetPlaceholder},
        testId('section-name-input')
      ),
    ]),
    cssButtons(
      primaryButton(translate('Save'),
        dom.on('click', doSave),
        dom.boolAttr('disabled', use => use(disableSave) || use(modalCtl.workInProgress)),
        testId('save'),
      ),
      basicButton(translate('Cancel'),
        testId('cancel'),
        dom.on('click', () => modalCtl.close())
      ),
    ),
    dom.onKeyDown({
      Escape: () => modalCtl.close(),
      // On enter save or cancel - depending on the change.
      Enter: () => disableSave.get() ? modalCtl.close() : doSave(),
    }),
    elem => { setTimeout(initialFocus, 0); },
  );
}

const updateOnKey = {onInput: true};

// Leave class for tests.
const cssTitleContainer = styled('div', `
  flex: 1 1 0px;
  min-width: 0px;
  display: flex;
`);

const cssTitle = styled('div', `
  cursor: pointer;
  overflow: hidden;
  border-radius: 3px;
  margin: -4px;
  padding: 4px;
  text-overflow: ellipsis;
  align-self: start;
  &:hover {
    background-color: ${theme.hover};
  }
  &-empty {
    min-width: 48px;
    min-height: 23px;
  }
`);

const cssRenamePopup = styled('div', `
  display: flex;
  flex-direction: column;
  min-width: 280px;
  padding: 16px;
  background-color: ${theme.popupBg};
  border-radius: 2px;
  outline: none;
`);

const cssLabel = styled('label', `
  color: ${theme.text};
  font-size: ${vars.xsmallFontSize};
  font-weight: ${vars.bigControlTextWeight};
  margin: 0 0 8px 0;
  &:not(:first-child) {
    margin-top: 16px;
  }
`);

const cssButtons = styled('div', `
  display: flex;
  margin-top: 16px;
  & > .${cssButton.className}:not(:first-child) {
    margin-left: 8px;
  }
`);

const cssInputWithIcon = styled('div', `
  position: relative;
  display: flex;
  flex-direction: column;
`);

const cssInput = styled((
  obs: Observable<string>,
  opts: IInputOptions,
  ...args) => input(obs, opts, cssTextInput.cls(''), ...args), `
  text-overflow: ellipsis;
  color: ${theme.inputFg};
  background-color: transparent;
  &:disabled {
    color: ${theme.inputDisabledFg};
    background-color: ${theme.inputDisabledBg};
    pointer-events: none;
  }
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
  .${cssInputWithIcon.className} > &:disabled {
    padding-right: 28px;
  }
`);
