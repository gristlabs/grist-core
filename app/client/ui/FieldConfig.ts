import {CursorPos} from 'app/client/components/Cursor';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {buildHighlightedCode, cssCodeBlock} from 'app/client/ui/CodeHighlight';
import {cssEmptySeparator, cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {buildFormulaTriggers} from 'app/client/ui/TriggerFormulas';
import {textButton} from 'app/client/ui2018/buttons';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {cssIconButton, icon} from 'app/client/ui2018/icons';
import {selectMenu, selectOption, selectTitle} from 'app/client/ui2018/menus';
import {sanitizeIdent} from 'app/common/gutil';
import {bundleChanges, Computed, dom, DomContents, DomElementArg, fromKo, MultiHolder, Observable,
        styled, subscribe} from 'grainjs';
import * as ko from 'knockout';
import debounce = require('lodash/debounce');
import {IconName} from 'app/client/ui2018/IconList';

export function buildNameConfig(owner: MultiHolder, origColumn: ColumnRec, cursor: ko.Computed<CursorPos>) {
  const untieColId = origColumn.untieColIdFromLabel;

  const editedLabel = Observable.create(owner, '');
  const editableColId = Computed.create(owner, editedLabel, (use, edited) =>
    '$' + (edited ? sanitizeIdent(edited) : use(origColumn.colId)));
  const saveColId = (val: string) => origColumn.colId.saveOnly(val.startsWith('$') ? val.slice(1) : val);

  // We will listen to cursor position and force a blur event on
  // the text input, which will trigger save before the column observable
  // will change its value.
  // Otherwise, blur will be invoked after column change and save handler will
  // update a different column.
  let editor: HTMLInputElement | undefined;
  owner.autoDispose(
   cursor.subscribe(() => {
     editor?.blur();
   })
  );

  return [
    cssLabel('COLUMN LABEL AND ID'),
    cssRow(
      cssColLabelBlock(
        editor = textInput(fromKo(origColumn.label),
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

type BuildEditor = (
  cellElem: Element,
  editValue?: string,
  onSave?: (formula: string) => Promise<void>,
  onCancel?: () => void) => void;

type BEHAVIOR = "empty"|"formula"|"data";

export function buildFormulaConfig(
  owner: MultiHolder, origColumn: ColumnRec, gristDoc: GristDoc, buildEditor: BuildEditor
) {

  // Intermediate state - user wants to specify formula, but haven't done yet
  const maybeFormula = Observable.create(owner, false);

  // Intermediate state - user wants to specify formula, but haven't done yet
  const maybeTrigger = Observable.create(owner, false);

  // Column behaviour. There are 3 types of behaviors:
  // - empty: isFormula and formula == ''
  // - formula: isFormula and formula != ''
  // - data: not isFormula nd formula == ''
  const behavior = Computed.create<BEHAVIOR|null>(owner, (use) => {
    // When no id column is invalid, show nothing.
    if (!use(origColumn.id)) { return null; }
    // Column is a formula column, when it is a formula column with valid formula or will be a formula.
    if (use(origColumn.isRealFormula) || use(maybeFormula)) { return "formula"; }
    // If column is not empty, or empty but wants to be a trigger
    if (use(maybeTrigger) || !use(origColumn.isEmpty)) { return "data"; }
    return "empty";
  });

  // Reference to current editor, we will open it when user wants to specify a formula or trigger.
  // And close it dispose it when user opens up behavior menu.
  let formulaField: HTMLElement|null = null;

  // Helper function to clear temporary state (will be called when column changes or formula editor closes)
  const clearState = () => bundleChanges(() => {
    maybeFormula.set(false);
    maybeTrigger.set(false);
    formulaField = null;
  });

  // Clear state when column has changed
  owner.autoDispose(origColumn.id.subscribe(clearState));

  // Menu helper that will show normal menu with some default options
  const menu = (label: DomContents, options: DomElementArg[]) =>
    cssRow(
      selectMenu(
        label,
        () => options,
        testId("field-behaviour"),
        // HACK: Menu helper will add tabindex to this element, which will make
        // this element focusable and will steal focus from clipboard. This in turn,
        // will not dispose the formula editor when menu is clicked.
        (el) => el.removeAttribute("tabindex"),
        dom.cls("disabled", origColumn.disableModify)),
    );

  // Behaviour label
  const behaviorName = Computed.create(owner, behavior, (use, type) => {
    if (type === 'formula') { return "Formula Column"; }
    if (type === 'data') { return "Data Column"; }
    return "Empty Column";
  });
  const behaviorIcon = Computed.create<IconName>(owner, (use) => {
    return use(behaviorName) === "Data Column" ? "Database" : "Script";
  });
  const behaviourLabel = () => selectTitle(behaviorName, behaviorIcon);

  // Actions on select menu:

  // Converts data column to formula column.
  const convertDataColumnToFormulaOption = () => selectOption(
    () => (maybeFormula.set(true), formulaField?.focus()),
    'Clear and make into formula', 'Script');

  // Converts to empty column and opens up the editor. (label is the same, but this is used when we have no formula)
  const convertTriggerToFormulaOption = () => selectOption(
    () => gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: true, noRecalc: true}),
    'Clear and make into formula', 'Script');

  // Convert column to data.
  // This method is also available through a text button.
  const convertToData = () => gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: false, noRecalc: true});
  const convertToDataOption = () => selectOption(
    convertToData,
    'Convert column to data', 'Database');

  // Clears the column
  const clearAndResetOption = () => selectOption(
    () => gristDoc.clearColumns([origColumn.id.peek()]),
    'Clear and reset', 'CrossSmall');

  // Actions on text buttons:

  // Tries to convert data column to a trigger column.
  const convertDataColumnToTriggerColumn = () => {
    maybeTrigger.set(true);
    // Open the formula editor.
    formulaField?.focus();
  };

  // Converts formula column to trigger formula column.
  const convertFormulaToTrigger = () =>
    gristDoc.convertIsFormula([origColumn.id.peek()], {toFormula: false, noRecalc: false});

  const setFormula = () => (maybeFormula.set(true), formulaField?.focus());
  const setTrigger = () => (maybeTrigger.set(true), formulaField?.focus());

  // Actions on save formula

  // Converts column to formula column or updates formula on a formula column.
  const onSaveConvertToFormula = async (formula: string) => {
    const notBlank = Boolean(formula);
    const trueFormula = !maybeFormula.get();
    if (notBlank || trueFormula) { await gristDoc.convertToFormula(origColumn.id.peek(), formula); }
    clearState();
  };

  // Updates formula or convert column to trigger formula column if necessary.
  const onSaveConvertToTrigger = async (formula: string) => {
    if (formula && maybeTrigger.get()) {
      // Convert column to trigger
      await gristDoc.convertToTrigger(origColumn.id.peek(), formula);
    } else if (origColumn.hasTriggerFormula.peek()) {
      // This is true trigger formula, just update the formula (or make it blank)
      await origColumn.formula.setAndSave(formula);
    }
    clearState();
  };

  const errorMessage = createFormulaErrorObs(owner, gristDoc, origColumn);
  // Helper that will create different flavors for formula builder.
  const formulaBuilder = (onSave: (formula: string) => Promise<void>) => [
    cssRow(formulaField = buildFormula(
      origColumn,
      buildEditor,
      "Enter formula",
      onSave,
      clearState)),
    dom.maybe(errorMessage, errMsg => cssRow(cssError(errMsg), testId('field-error-count'))),
  ];

  return dom.maybe(behavior, (type: BEHAVIOR) => [
      cssLabel('COLUMN BEHAVIOR'),
      ...(type === "empty" ? [
        menu(behaviourLabel(), [
          convertToDataOption()
        ]),
        cssEmptySeparator(),
        cssRow(textButton(
          "Set formula",
          dom.on("click", setFormula),
          dom.prop("disabled", origColumn.disableModify),
          testId("field-set-formula")
        )),
        cssRow(textButton(
          "Set trigger formula",
          dom.on("click", setTrigger),
          dom.prop("disabled", origColumn.disableModify),
          testId("field-set-trigger")
        )),
        cssRow(textButton(
          "Make into data column",
          dom.on("click", convertToData),
          dom.prop("disabled", origColumn.disableModify),
          testId("field-set-data")
        ))
      ] : type === "formula" ? [
        menu(behaviourLabel(), [
          convertToDataOption(),
          clearAndResetOption(),
        ]),
        formulaBuilder(onSaveConvertToFormula),
        cssEmptySeparator(),
        cssRow(textButton(
          "Convert to trigger formula",
          dom.on("click", convertFormulaToTrigger),
          dom.hide(maybeFormula),
          dom.prop("disabled", origColumn.disableModify),
          testId("field-set-trigger")
        ))
      ] : /* type == 'data' */ [
        menu(behaviourLabel(),
          [
            dom.domComputed(origColumn.hasTriggerFormula, (hasTrigger) => hasTrigger ?
              // If we have trigger, we will convert it directly to a formula column
              convertTriggerToFormulaOption() :
              // else we will convert to empty column and open up the editor
              convertDataColumnToFormulaOption()
            ),
            clearAndResetOption(),
          ]
        ),
        // If data column is or wants to be a trigger formula:
        dom.maybe((use) => use(maybeTrigger) || use(origColumn.hasTriggerFormula), () => [
          cssLabel('TRIGGER FORMULA'),
          formulaBuilder(onSaveConvertToTrigger),
          dom.create(buildFormulaTriggers, origColumn, maybeTrigger)
        ]),
        // Else offer a way to convert to trigger formula.
        dom.maybe((use) => !(use(maybeTrigger) || use(origColumn.hasTriggerFormula)), () => [
          cssEmptySeparator(),
          cssRow(textButton(
            "Set trigger formula",
            dom.on("click", convertDataColumnToTriggerColumn),
            dom.prop("disabled", origColumn.disableModify),
            testId("field-set-trigger")
          ))
        ])
      ])
  ]);
}

function buildFormula(
    column: ColumnRec,
    buildEditor: BuildEditor,
    placeholder: string,
    onSave?: (formula: string) => Promise<void>,
    onCancel?: () => void) {
  return cssFieldFormula(column.formula, {placeholder, maxLines: 2},
    dom.cls('formula_field_sidepane'),
    cssFieldFormula.cls('-disabled', column.disableModify),
    cssFieldFormula.cls('-disabled-icon', use => !use(column.formula)),
    dom.cls('disabled'),
    {tabIndex: '-1'},
    // Focus event use used by a user to edit an existing formula.
    // It can also be triggered manually to open up the editor.
    dom.on('focus', (_, elem) => buildEditor(elem, undefined, onSave, onCancel)),
  );
}

/**
 * Create and return an observable for the count of errors in a column, which gets updated in
 * response to changes in origColumn and in user data.
 */
function createFormulaErrorObs(owner: MultiHolder, gristDoc: GristDoc, origColumn: ColumnRec) {
  const errorMessage = Observable.create(owner, '');

  // Count errors in origColumn when it's a formula column. Counts get cached by the
  // tableData.countErrors() method, and invalidated on relevant data changes.
  function countErrors() {
    if (owner.isDisposed()) { return; }
    const tableData = gristDoc.docData.getTable(origColumn.table.peek().tableId.peek());
    const isFormula = origColumn.isRealFormula.peek() || origColumn.hasTriggerFormula.peek();
    if (tableData && isFormula) {
      const colId = origColumn.colId.peek();
      const numCells = tableData.getColValues(colId)?.length || 0;
      const numErrors = tableData.countErrors(colId) || 0;
      errorMessage.set(
        (numErrors === 0) ? '' :
        (numCells === 1) ? `Error in the cell` :
        (numErrors === numCells) ? `Errors in all ${numErrors} cells` :
        `Errors in ${numErrors} of ${numCells} cells`
      );
    } else {
      errorMessage.set('');
    }
  }

  // Debounce the count calculation to defer it to the end of a bundle of actions.
  const debouncedCountErrors = debounce(countErrors, 0);

  // If there is an update to the data in the table, count errors again. Since the same UI is
  // reused when different page widgets are selected, we need to re-create this subscription
  // whenever the selected table changes. We use a Computed to both react to changes and dispose
  // the previous subscription when it changes.
  Computed.create(owner, (use) => {
    const tableData = gristDoc.docData.getTable(use(use(origColumn.table).tableId));
    return tableData ? use.owner.autoDispose(tableData.tableActionEmitter.addListener(debouncedCountErrors)) : null;
  });

  // The counts depend on the origColumn and its isRealFormula status, but with the debounced
  // callback and subscription to data, subscribe to relevant changes manually (rather than using
  // a Computed).
  owner.autoDispose(subscribe(use => { use(origColumn.id); use(origColumn.isRealFormula); debouncedCountErrors(); }));
  return errorMessage;
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

const cssError = styled('div', `
  color: ${colors.error};
`);
