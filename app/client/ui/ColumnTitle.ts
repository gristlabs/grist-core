import { makeT } from 'app/client/lib/localization';
import { FocusLayer } from 'app/client/lib/FocusLayer';
import { ColumnRec } from 'app/client/models/entities/ColumnRec';
import { basicButton, cssButton, primaryButton } from 'app/client/ui2018/buttons';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { cssTextInput } from 'app/client/ui2018/editableLabel';
import { menuCssClass } from 'app/client/ui2018/menus';
import { ModalControl } from 'app/client/ui2018/modals';
import { Computed, dom, DomElementArg, IInputOptions, input, makeTestId, Observable, styled } from 'grainjs';
import { IOpenController, setPopupToCreateDom } from 'popweasel';
import { textarea } from './inputs';
import { copyToClipboard } from '../lib/copyToClipboard';
import { showTransientTooltip } from './tooltips';
import { setTestState } from '../lib/testState';

const testId = makeTestId('test-column-title-');
const t = makeT('ColumnTitle');

export function buildColumnTitle(columnRec: ColumnRec, ...args: DomElementArg[]) {
  const label = Computed.create(null, use => use(columnRec.label));
  return buildRenameColumn(columnRec, label, dom.autoDispose(label), ...args);
}

export function buildRenameColumn(
  columnRec: ColumnRec,
  label: Observable<string>,
  ...args: DomElementArg[]) {
  return cssTitleContainer(
    cssTitle(
      testId('text'),
      dom.text(label),
      // In case titleDef is all blank space, make it visible on hover.
      cssTitle.cls("-empty", use => !use(label)?.trim()),
      elem => {
        setPopupToCreateDom(elem, ctl => buildColumnRenamePopup(ctl, columnRec), {
          placement: 'bottom-start',
          trigger: [ 'click' ],
          attach: 'body',
          boundaries: 'viewport',
        });
      },
    ),
    ...args
  );
}

function buildColumnRenamePopup(ctrl: IOpenController, columnRec: ColumnRec) {
  const editedLabel = Observable.create(ctrl, columnRec.label.peek());
  const editedDesc = Observable.create(ctrl, columnRec.description.peek());
  const colId = '$' + columnRec.colId.peek();

  const disableSave = Computed.create(ctrl, (use) => {
    // Can't save when there wasn't any change.
    return (
      use(editedLabel)?.trim() === columnRec.label.peek()
      && use(editedDesc)?.trim() === columnRec.description.peek()
    );
  });

  const modalCtl = ModalControl.create(ctrl, () => ctrl.close());

  const saveColumnLabel = async () => {
    const newLabel = editedLabel.get()?.trim() ?? '';
    if (newLabel !== columnRec.label.peek()) {
      await columnRec.label.saveOnly(newLabel);
    }
  };

  const saveColumnDesc = async () => {
    const newDesc = editedDesc.get()?.trim() ?? '';
    if (newDesc !== columnRec.description.peek()) {
      await columnRec.description.saveOnly(newDesc);
    }
  };

  const doSave = modalCtl.doWork(() => Promise.all([
    saveColumnLabel(),
    saveColumnDesc()
  ]), { close: true });

  let labelInput: HTMLInputElement | undefined;
  return cssRenamePopup(
    // Create a FocusLayer to keep focus in this popup while it's active, and prevent keyboard
    // shortcuts from being seen by the view underneath.
    elem => { FocusLayer.create(ctrl, { defaultFocusElem: elem, pauseMousetrap: true }); },
    testId('popup'),
    dom.cls(menuCssClass),

    cssLabel(t("COLUMN LABEL")),
    cssColLabelBlock(
      labelInput = cssInput(
        editedLabel,
        updateOnKey,
        { placeholder: t("Provide a column label") },
        testId('column-label-input')
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
        testId('field-col-id'),
      ),
    ),
    cssLabel(t("COLUMN DESCRIPTION")),
    cssTextArea(editedDesc, updateOnKey,
      {},
      testId('field-description'),
    ),

    cssButtons(
      primaryButton(t("Save"),
        dom.on('click', doSave),
        dom.boolAttr('disabled', use => use(disableSave) || use(modalCtl.workInProgress)),
        testId('save'),
      ),
      basicButton(t("Cancel"),
        testId('cancel'),
        dom.on('click', () => modalCtl.close())
      ),
    ),
    dom.onKeyDown({
      Escape: () => modalCtl.close(),
      // On enter save or cancel - depending on the change.
      Enter: () => disableSave.get() ? modalCtl.close() : doSave(),
    }),
    elem => { setTimeout(() => { labelInput?.focus(); labelInput?.select(); }, 0); },
  );
}

const updateOnKey = { onInput: true };

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

const cssColLabelBlock = styled('div', `
  display: flex;
  flex-direction: column;
  flex: auto;
  min-width: 80px;
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

const cssColId = styled('div', `
  font-size: ${vars.xsmallFontSize};
  font-weight: ${vars.bigControlTextWeight};
  margin-top: 8px;
  color: grey;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
`);

const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  padding: 10px;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
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
