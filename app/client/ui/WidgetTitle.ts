import * as commands from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import { FocusLayer } from 'app/client/lib/FocusLayer';
import {ViewSectionRec} from 'app/client/models/entities/ViewSectionRec';
import {basicButton, cssButton, primaryButton} from 'app/client/ui2018/buttons';
import { theme } from 'app/client/ui2018/cssVars';
import {menuCssClass} from 'app/client/ui2018/menus';
import {ModalControl} from 'app/client/ui2018/modals';
import { Computed, dom, DomElementArg, makeTestId, Observable, styled } from 'grainjs';
import {IOpenController, IPopupOptions, PopupControl, setPopupToCreateDom} from 'popweasel';
import { descriptionInfoTooltip } from './tooltips';
import { autoGrow } from './forms';
import { cssInput, cssLabel, cssRenamePopup, cssTextArea } from 'app/client/ui/RenamePopupStyles';

const testId = makeTestId('test-widget-title-');
const t = makeT('WidgetTitle');

interface WidgetTitleOptions {
  tableNameHidden?: boolean,
  widgetNameHidden?: boolean,
  disabled?: boolean,
}

export function buildWidgetTitle(vs: ViewSectionRec, options: WidgetTitleOptions, ...args: DomElementArg[]) {
  const title = Computed.create(null, use => use(vs.titleDef));
  const description = Computed.create(null, use => use(vs.description));
  return buildRenamableTitle(vs, title, description, options, dom.autoDispose(title), ...args);
}

interface TableNameOptions {
  isEditing: Observable<boolean>,
  disabled?: boolean,
}

export function buildTableName(vs: ViewSectionRec, options: TableNameOptions, ...args: DomElementArg[]) {
  const title = Computed.create(null, use => use(use(vs.table).tableNameDef));
  const description = Computed.create(null, use => use(vs.description));
  return buildRenamableTitle(
    vs,
    title,
    description,
    {
      openOnClick: false,
      widgetNameHidden: true,
      ...options,
    },
    dom.autoDispose(title),
    ...args
  );
}

interface RenamableTitleOptions {
  tableNameHidden?: boolean,
  widgetNameHidden?: boolean,
  /** Defaults to true. */
  openOnClick?: boolean,
  isEditing?: Observable<boolean>,
  disabled?: boolean,
}

function buildRenamableTitle(
  vs: ViewSectionRec,
  title: Observable<string>,
  description: Observable<string>,
  options: RenamableTitleOptions,
  ...args: DomElementArg[]
) {
  const {openOnClick = true, disabled = false, isEditing, ...renameTitleOptions} = options;
  let popupControl: PopupControl | undefined;
  return cssTitleContainer(
    cssTitle(
      testId('text'),
      dom.text(title),
      dom.on('click', () => {
        // The popup doesn't close if `openOnClick` is false and the title is
        // clicked. Make sure that it does.
        if (!openOnClick) { popupControl?.close(); }
      }),
      // In case titleDef is all blank space, make it visible on hover.
      cssTitle.cls("-empty", use => !use(title)?.trim()),
      cssTitle.cls("-open-on-click", openOnClick),
      cssTitle.cls("-disabled", disabled),
      elem => {
        if (disabled) { return; }

        // The widget title popup can be configured to open in up to two ways:
        //   1. When the title is clicked - done by setting `openOnClick` to `true`.
        //   2. When `isEditing` is set to true - done by setting `isEditing` to `true`.
        //
        // Typically, the former should be set. The latter is useful for triggering the
        // popup from a different part of the UI, like a menu item.
        const trigger: IPopupOptions['trigger'] = [];
        if (openOnClick) { trigger.push('click'); }
        if (isEditing) {
          trigger.push((_: Element, ctl: PopupControl) => {
            popupControl = ctl;
            ctl.autoDispose(isEditing.addListener((editing) => {
              if (editing) {
                ctl.open();
              } else if (!ctl.isDisposed()) {
                ctl.close();
              }
            }));
          });
        }
        setPopupToCreateDom(elem, ctl => {
          if (isEditing) {
            ctl.onDispose(() => isEditing.set(false));
          }

          return buildRenameTitlePopup(ctl, vs, renameTitleOptions);
        }, {
          placement: 'bottom-start',
          trigger,
          attach: 'body',
          boundaries: 'viewport',
        });
      },
      openOnClick ? dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }) : null,
    ),
    dom.maybe(description, () => [
      descriptionInfoTooltip(description.get(), "widget")
    ]),
    ...args
  );
}

function buildRenameTitlePopup(ctrl: IOpenController, vs: ViewSectionRec, options: RenamableTitleOptions) {
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
  const inputWidgetPlaceholder = !vs.title.peek() ? t("Override widget title") : vs.defaultWidgetTitle.peek();

  // User input for widget description
  const inputWidgetDesc = Observable.create(ctrl, vs.description.peek() ?? '');

  const disableSave = Computed.create(ctrl, (use) => {
    const newTableName = use(inputTableName)?.trim() ?? '';
    const newWidgetTitle = use(inputWidgetTitle)?.trim() ?? '';
    const newWidgetDesc = use(inputWidgetDesc)?.trim() ?? '';
    // Can't save when table name is empty or there wasn't any change.
    return !newTableName || (
      newTableName === tableName
      && newWidgetTitle === use(vs.title)
      && newWidgetDesc === use(vs.description)
    );
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

  const saveWidgetDesc = async () => {
    const newWidgetDesc = inputWidgetDesc.get().trim() ?? '';
    // If value was changed.
    if (newWidgetDesc !== vs.description.peek()) {
      await vs.description.saveOnly(newWidgetDesc);
    }
  };

  const save = () => Promise.all([
    saveTableName(),
    saveWidgetTitle(),
    saveWidgetDesc()
  ]);

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

  // When the popup is closing we will save everything, unless the user has pressed the cancel button.
  let cancelled = false;

  // Function to close the popup with saving.
  const close = () => ctrl.close();

  // Function to close the popup without saving.
  const cancel = () => { cancelled = true; close(); };

  // Function that is called when popup is closed.
  const onClose = () => {
    if (!cancelled) {
      save().catch(reportError);
    }
  };

  // User interface for the popup.
  const myCommands = {
    // Escape key: just close the popup.
    cancel,
    // Enter key: save and close the popup, unless the description input is focused.
    // There is also a variant for Ctrl+Enter which will always save.
    accept: () => {
      // Enters are ignored in the description input (unless ctrl is pressed)
      if (document.activeElement === descInput) { return true; }
      close();
    },
    // ArrowUp
    cursorUp: () => {
      // moves focus to the widget title input if it is already at the top of widget description
      if (document.activeElement === descInput && descInput?.selectionStart === 0) {
        widgetInput?.focus();
        widgetInput?.select();
      } else if (document.activeElement === widgetInput) {
        tableInput?.focus();
        tableInput?.select();
      } else {
        return true;
      }
    },
    // ArrowDown
    cursorDown: () => {
      if (document.activeElement === tableInput) {
        widgetInput?.focus();
        widgetInput?.select();
      } else if (document.activeElement === widgetInput) {
        descInput?.focus();
        descInput?.select();
      } else {
        return true;
      }
    }
  };

  // Create this group and attach it to the popup and all inputs.
  const commandGroup = commands.createGroup({ ...myCommands }, ctrl, true);

  let tableInput: HTMLInputElement|undefined;
  let widgetInput: HTMLInputElement|undefined;
  let descInput: HTMLTextAreaElement | undefined;
  return cssRenamePopup(
    // Create a FocusLayer to keep focus in this popup while it's active, and prevent keyboard
    // shortcuts from being seen by the view underneath.
    elem => { FocusLayer.create(ctrl, { defaultFocusElem: elem, pauseMousetrap: false }); },
    dom.onDispose(onClose),
    dom.autoDispose(commandGroup),
    testId('popup'),
    dom.cls(menuCssClass),
    dom.maybe(!options.tableNameHidden, () => [
      cssLabel(t("DATA TABLE NAME")),
      // Update tableName on key stroke - this will show the default widget name as we type.
      // above this modal.
      tableInput = cssInput(
        inputTableName,
        updateOnKey,
        {disabled: isSummary, placeholder: t("Provide a table name")},
        testId('table-name-input'),
        commandGroup.attach(),
      ),
    ]),
    dom.maybe(!options.widgetNameHidden, () => [
      cssLabel(t("WIDGET TITLE")),
      widgetInput = cssInput(inputWidgetTitle, updateOnKey, {placeholder: inputWidgetPlaceholder},
        testId('section-name-input'),
        commandGroup.attach(),
      ),
    ]),
    cssLabel(t("WIDGET DESCRIPTION")),
    descInput = cssTextArea(inputWidgetDesc, updateOnKey,
      testId('section-description-input'),
      commandGroup.attach(),
      autoGrow(inputWidgetDesc),
    ),
    cssButtons(
      primaryButton(t("Save"),
        dom.on('click', close),
        dom.boolAttr('disabled', use => use(disableSave) || use(modalCtl.workInProgress)),
        testId('save'),
      ),
      basicButton(t("Cancel"),
        testId('cancel'),
        dom.on('click', cancel)
      ),
    ),
    dom.onKeyDown({
      Enter$: e => {
        if (e.ctrlKey || e.metaKey) {
          close();
          return false;
        }
      }
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
  .info_toggle_icon {
    width: 13px;
    height: 13px;
  }
`);

const cssTitle = styled('div', `
  overflow: hidden;
  border-radius: 3px;
  margin: -4px;
  padding: 4px;
  text-overflow: ellipsis;
  align-self: start;
  &-open-on-click:not(&-disabled) {
    cursor: pointer;
  }
  &-open-on-click:not(&-disabled):hover {
    background-color: ${theme.hover};
  }
  &-empty {
    min-width: 48px;
    min-height: 23px;
  }
`);

const cssButtons = styled('div', `
  display: flex;
  margin-top: 16px;
  & > .${cssButton.className}:not(:first-child) {
    margin-left: 8px;
  }
`);
