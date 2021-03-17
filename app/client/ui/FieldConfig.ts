import type {GristDoc} from 'app/client/components/GristDoc';
import type {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {buildHighlightedCode, cssCodeBlock} from 'app/client/ui/CodeHighlight';
import {cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {sanitizeIdent} from 'app/common/gutil';
import {Computed, dom, fromKo, IDisposableOwner, Observable, styled} from 'grainjs';

export function buildNameConfig(owner: IDisposableOwner, origColumn: ColumnRec) {
  const untieColId = origColumn.untieColIdFromLabel;

  const editedLabel = Observable.create(owner, '');
  const editableColId = Computed.create(owner, editedLabel, (use, edited) =>
    '$' + (edited ? sanitizeIdent(edited) : use(origColumn.colId)));
  const saveColId = (val: string) => origColumn.colId.saveOnly(val.startsWith('$') ? val.slice(1) : val);

  return [
    cssLabel('COLUMN LABEL AND ID'),
    cssRow(
      cssColLabelBlock(
        textInput(fromKo(origColumn.label),
          async val => { await origColumn.label.saveOnly(val); editedLabel.set(''); },
          dom.on('input', (ev, elem) => { if (!untieColId.peek()) { editedLabel.set(elem.value); } }),
          dom.boolAttr('disabled', origColumn.disableModify),
          testId('field-label'),
        ),
        textInput(editableColId,
          saveColId,
          dom.boolAttr('disabled', use => use(origColumn.disableModify) || !use(origColumn.untieColIdFromLabel)),
          cssCodeBlock.cls(''),
          {style: 'margin-top: 8px'},
          testId('field-col-id'),
        ),
      ),
      cssColTieBlock(
        cssColTieConnectors(),
        cssToggleButton(icon('FieldReference'),
          cssToggleButton.cls('-selected', (use) => !use(untieColId)),
          dom.on('click', () => untieColId.saveOnly(!untieColId.peek())),
          testId('field-derive-id')
        ),
      )
    ),
  ];
}

type BuildEditor = (cellElem: Element) => void;

export function buildFormulaConfig(
  owner: IDisposableOwner, origColumn: ColumnRec, gristDoc: GristDoc, buildEditor: BuildEditor
) {
  const clearColumn = () => gristDoc.clearColumns([origColumn.id.peek()]);
  const convertToData = () => gristDoc.convertFormulasToData([origColumn.id.peek()]);

  return dom.maybe(use => {
      if (!use(origColumn.id)) { return null; }    // Invalid column, show nothing.
      if (use(origColumn.isEmpty)) { return "empty"; }
      return use(origColumn.isFormula) ? "formula" : "data";
    },
    (type: "empty"|"formula"|"data") => {
      function buildHeader(label: string, menuFunc: () => Element[]) {
        return cssRow(
          cssInlineLabel(label,
            testId('field-is-formula-label'),
          ),
          cssDropdownLabel('Actions', icon('Dropdown'), menu(menuFunc),
            cssDropdownLabel.cls('-disabled', origColumn.disableModify),
            testId('field-actions-menu'),
          )
        );
      }
      function buildFormulaRow(placeholder = 'Enter formula') {
        return cssRow(dom.create(buildFormula, origColumn, buildEditor, placeholder));
      }
      if (type === "empty") {
        return [
          buildHeader('EMPTY COLUMN', () => [
            menuItem(clearColumn, 'Clear column', dom.cls('disabled', true)),
            menuItem(convertToData, 'Make into data column'),
          ]),
          buildFormulaRow(),
        ];
      } else if (type === "formula") {
        return [
          buildHeader('FORMULA COLUMN', () => [
            menuItem(clearColumn, 'Clear column'),
            menuItem(convertToData, 'Convert to data column'),
          ]),
          buildFormulaRow(),
        ];
      } else {
        return [
          buildHeader('DATA COLUMN', () => [
            menuItem(clearColumn, 'Clear and make into formula'),
          ]),
          buildFormulaRow('Default formula'),
          cssHintRow('Default formula for new records'),
        ];
      }
    }
  );
}

function buildFormula(owner: IDisposableOwner, column: ColumnRec, buildEditor: BuildEditor, placeholder: string) {
  return cssFieldFormula(column.formula, {placeholder, maxLines: 2},
    dom.cls('formula_field_sidepane'),
    cssFieldFormula.cls('-disabled', column.disableModify),
    cssFieldFormula.cls('-disabled-icon', use => !use(column.formula)),
    dom.cls('disabled'),
    {tabIndex: '-1'},
    dom.on('focus', (ev, elem) => buildEditor(elem)),
  );
}

const cssFieldFormula = styled(buildHighlightedCode, `
  flex: auto;
  cursor: pointer;
  margin-top: 4px;
  padding-left: 24px;
  --icon-color: ${colors.lightGreen};

  &-disabled-icon.formula_field_sidepane::before {
    --icon-color: ${colors.slate};
  }
  &-disabled {
    pointer-events: none;
  }
`);

const cssToggleButton = styled(cssIconButton, `
  margin-left: 8px;
  background-color: var(--grist-color-medium-grey-opaque);
  box-shadow: inset 0 0 0 1px ${colors.darkGrey};

  &-selected, &-selected:hover {
    box-shadow: none;
    background-color: ${colors.dark};
    --icon-color: ${colors.light};
  }
  &-selected:hover {
    --icon-color: ${colors.darkGrey};
  }
`);

const cssInlineLabel = styled(cssLabel, `
  padding: 4px 8px;
  margin: 4px 0 -4px -8px;
`);

const cssDropdownLabel = styled(cssInlineLabel, `
  margin-left: auto;
  display: flex;
  align-items: center;
  border-radius: ${vars.controlBorderRadius};
  cursor: pointer;

  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};

  &:hover, &:focus, &.weasel-popup-open {
    background-color: ${colors.mediumGrey};
  }
  &-disabled {
    color: ${colors.slate};
    --icon-color: ${colors.slate};
    pointer-events: none;
  }
`);

const cssHintRow = styled('div', `
  margin: -4px 16px 8px 16px;
  color: ${colors.slate};
  text-align: center;
`);

const cssColLabelBlock = styled('div', `
  display: flex;
  flex-direction: column;
`);

const cssColTieBlock = styled('div', `
  position: relative;
`);

const cssColTieConnectors = styled('div', `
  position: absolute;
  border: 2px solid var(--grist-color-dark-grey);
  top: -9px;
  bottom: -9px;
  right: 11px;
  left: 0px;
  border-left: none;
  z-index: -1;
`);
