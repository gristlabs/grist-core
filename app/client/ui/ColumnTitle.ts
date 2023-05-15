import * as Clipboard from 'app/client/components/Clipboard';
import * as commands from 'app/client/components/commands';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {setTestState} from 'app/client/lib/testState';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {autoGrow} from 'app/client/ui/forms';
import {showTransientTooltip} from 'app/client/ui/tooltips';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass} from 'app/client/ui2018/menus';

import {Computed, dom, makeTestId, Observable, styled} from 'grainjs';
import * as ko from 'knockout';
import {IOpenController, PopupControl, setPopupToCreateDom} from 'popweasel';
import { cssInput, cssLabel, cssRenamePopup, cssTextArea } from 'app/client/ui/RenamePopupStyles';


const testId = makeTestId('test-column-title-');
const t = makeT('ColumnTitle');

interface IColumnTitleOptions {
  field: ViewFieldRec;
  isEditing: ko.Computed<boolean>;
  optCommands?: any;
}

export function buildRenameColumn(options: IColumnTitleOptions) {
  return (elem: Element) => {
    // To open the popup we will listen to the isEditing observable, and open the popup when it
    // it is changed. This can be changed either by us, but also by an external source.
    const trigger = (triggerElem: Element, ctl: PopupControl) => {
      ctl.autoDispose(options.isEditing.subscribe((editing) => {
        if (editing) {
          ctl.open();
        } else if (!ctl.isDisposed()) {
          ctl.close();
        }
      }));
    };
    setPopupToCreateDom(elem, ctl => buildColumnRenamePopup(ctl, options), {
      placement: 'bottom-start',
      trigger: [trigger],
      attach: 'body',
      boundaries: 'viewport',
    });
  };
}

function buildColumnRenamePopup(
  ctrl: IOpenController, {field, isEditing, optCommands}: IColumnTitleOptions
) {
  // Store temporary values for the label and description.
  const editedLabel = Observable.create(ctrl, field.displayLabel.peek());
  const editedDesc = Observable.create(ctrl, field.description.peek());
  // Col id is static, as we can't forsee if it will change and what it will
  // change to (it may overlap with another column)
  const colId = '$' + field.colId.peek();

  const hasChange = Computed.create(ctrl, (use) => {
    return use(editedLabel)?.trim() !== field.displayLabel.peek()
        || use(editedDesc)?.trim() !== field.description.peek();
  });

  const cantSave = Computed.create(ctrl, (use) => {
    const filledLabel = Boolean(use(editedLabel)?.trim());
    return !filledLabel;
  });

  // Function to change a column name.
  const saveColumnLabel = async () => {
    // Trim new label and make sure it is a string (not null).
    const newLabel = editedLabel.get()?.trim() ?? '';
    // Save only when it is not empty and different from the current value.
    if (newLabel && newLabel !== field.displayLabel.peek()) {
      await field.displayLabel.setAndSave(newLabel);
    }
  };

  // Function to change a column description.
  const saveColumnDesc = async () => {
    const newDesc = editedDesc.get()?.trim() ?? '';
    if (newDesc !== field.description.peek()) {
      await field.description.saveOnly(newDesc);
    }
  };

  // Function save column name and description and close the popup.
  const save = () => Promise.all([
    saveColumnLabel(),
    saveColumnDesc()
  ]);

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
    // Reset the isEditing flag. It will set the editIndex in GridView to -1 if this is active column.
    // It can happen that we will be open even if the column is not active (as the isEditing flag is asynchronous).
    isEditing(false);
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
    // Tab: save and close the popup, and move to the next field.
    nextField: () => {
      close();
      optCommands?.nextField?.();
    },
    // Shift + Tab: save and close the popup, and move to the previous field.
    prevField: () => {
      close();
      optCommands?.prevField?.();
    },
    // ArrowUp: moves focus to the label if it is already at the top
    cursorUp: () => {
      if (document.activeElement === descInput && descInput?.selectionStart === 0) {
        labelInput?.focus();
        labelInput?.select();
      } else {
        return true;
      }
    },
    // ArrowDown: move to the description input, only if the label input is focused.
    cursorDown: () => {
      if (document.activeElement === labelInput) {
        const focus = () => {
          descInput?.focus();
          descInput?.select();
        };
        showDesc.set(true);
        focus();
      } else {
        return true;
      }
    }
  };

  // Create this group and attach it to the popup and both inputs.
  const commandGroup = commands.createGroup({...optCommands, ...myCommands}, ctrl, true);

  // We will still focus from other elements and restore it on either the label or description input.
  let lastFocus: HTMLElement | undefined;
  const rememberFocus = (el: HTMLElement) => dom.on('focus', () => lastFocus = el);
  const restoreFocus = (el: HTMLElement) => dom.on('focus', () => lastFocus?.focus());

  const showDesc = Observable.create(null, Boolean(field.description.peek() !== ''));

  let labelInput: HTMLInputElement | undefined;
  let descInput: HTMLTextAreaElement | undefined;
  return cssRenamePopup(
    dom.onDispose(onClose),
    dom.autoDispose(commandGroup),
    dom.autoDispose(showDesc),
    testId('popup'),
    dom.cls(menuCssClass),
    cssLabel(t("Column label")),
    cssColLabelBlock(
      labelInput = cssInput(
        editedLabel,
        updateOnKey,
        { placeholder: t("Provide a column label") },
        testId('label'),
        commandGroup.attach(),
        rememberFocus,
      ),
      cssColId(
        t("COLUMN ID: "),
        colId,
        dom.on('click', async (e, d) => {
          e.stopImmediatePropagation();
          e.preventDefault();
          showTransientTooltip(d, t("Column ID copied to clipboard"), {
            key: 'copy-column-id'
          });
          await copyToClipboard(colId);
          setTestState({clipboard: colId});
        }),
        testId('colid'),
      ),
    ),
    dom.maybe(use => !use(showDesc), () => cssAddDescription(
      textButton(
        icon('Plus'),
        t("Add description"),
        dom.on('click', () => {
          showDesc.set(true);
          descInput?.focus();
          setTimeout(() => descInput?.focus(), 0);
        }),
        testId('add-description'),
      ),
    )),
    dom.maybe(showDesc, () => [
      cssLabel(t("Column description")),
      descInput = cssTextArea(editedDesc, updateOnKey,
        testId('description'),
        commandGroup.attach(),
        rememberFocus,
        autoGrow(editedDesc),
      ),
    ]),
    dom.onKeyDown({
      Enter$: e => {
        if (e.ctrlKey || e.metaKey) {
          close();
          return false;
        }
      }
    }),
    cssButtons(
      primaryButton(
        dom.on('click', cancel),
        testId('close'),
        dom.hide(hasChange),
        t("Close"),
      ),
      primaryButton(t("Save"),
        dom.on('click', close),
        testId('save'),
        dom.show(hasChange),
        dom.boolAttr('disabled', cantSave),
      ),
      basicButton(t("Cancel"),
        testId('cancel'),
        dom.on('click', cancel),
        dom.show(hasChange)
      ),
    ),
    // After showing the popup, focus the label input and select it's content.
    elem => { setTimeout(() => {
      if (ctrl.isDisposed()) { return; }
      labelInput?.focus();
      labelInput?.select();
    }, 0); },
    // Create a FocusLayer to keep focus in this popup while it's active, by default when focus is stolen
    // by someone else, we will bring back it to the label element. Clicking anywhere outside the popup
    // will close it, but not when we click on the header itself (as it will reopen it). So this one
    // makes sure that the focus is restored in the label.
    elem => { FocusLayer.create(ctrl, {
      defaultFocusElem: elem,
      pauseMousetrap: false,
      allowFocus: Clipboard.allowFocus
    }); },
    restoreFocus
  );
}

const updateOnKey = { onInput: true };

const cssAddDescription = styled('div', `
  display: flex;
  padding-top: 14px;
  padding-bottom: 4px;
  & button {
    display: flex;
    align-items: center;
    gap: 8px;
  }
`);

const cssColLabelBlock = styled('div', `
  display: flex;
  flex-direction: column;
  flex: auto;
  min-width: 80px;
`);

const cssColId = styled('div', `
  font-size: ${vars.xsmallFontSize};
  font-weight: ${vars.bigControlTextWeight};
  margin-top: 8px;
  color: ${theme.lightText};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  align-self: start;
`);

const cssButtons = styled('div', `
  display: flex;
  margin-top: 16px;
  gap: 8px;
  & button {
    min-width: calc(50 / 13 * 1em); /* Min 50px for 13px font size, to make Save and Close buttons equal width */
  }
`);
