import {makeT} from 'app/client/lib/localization';
import type {ColumnRec} from 'app/client/models/entities/ColumnRec';
import type {TableRec} from 'app/client/models/entities/TableRec';
import {reportError} from 'app/client/models/errors';
import {cssRow} from 'app/client/ui/RightPanelStyles';
import {shadowScroll} from 'app/client/ui/shadowScroll';
import {basicButton, primaryButton} from "app/client/ui2018/buttons";
import {labeledSquareCheckbox} from "app/client/ui2018/checkbox";
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from "app/client/ui2018/icons";
import {menuCssClass, menuDivider} from 'app/client/ui2018/menus';
import {cssSelectBtn} from 'app/client/ui2018/select';
import {CellValue} from 'app/common/DocActions';
import {isEmptyList, RecalcWhen} from 'app/common/gristTypes';
import {nativeCompare} from 'app/common/gutil';
import {decodeObject, encodeObject} from 'app/plugin/objtypes';
import {Computed, dom, IDisposableOwner, MultiHolder, Observable, styled} from 'grainjs';
import {cssMenu, cssMenuItem, defaultMenuOptions, IOpenController, setPopupToCreateDom} from "popweasel";
import isEqual = require('lodash/isEqual');

const t = makeT('TriggerFormulas');

/**
 * Build UI to select triggers for formulas in data columns (such for default values).
 */
export function buildFormulaTriggers(owner: MultiHolder, column: ColumnRec, options: {
  notTrigger?: Observable<boolean>|null // if column is not yet a trigger,
  disabled?: Observable<boolean>
}) {
  // Set up observables to translate between the UI representation of triggers, and what we
  // actually store.
  // - We store the pair (recalcWhen, recalcDeps). When recalcWhen is DEFAULT, recalcDeps lists
  //   the fields to depend on; in other cases, recalcDeps is not used.
  // - We show two checkboxes:
  //   [] Apply to new records -- toggles between recalcWhen of NEVER and DEFAULT.
  //   [] Apply on record changes -- when turned on, allows selecting fields to depend on. When
  //      "Any field" is selected, it toggles between recalcWhen of MANUAL_UPDATES and DEFAULT.

  function isApplyOnChangesChecked(recalcWhen: RecalcWhen, recalcDeps: CellValue): boolean {
    return recalcWhen === RecalcWhen.MANUAL_UPDATES ||
      (recalcWhen === RecalcWhen.DEFAULT && recalcDeps != null && !isEmptyList(recalcDeps));
  }

  async function toggleApplyOnChanges(value: boolean) {
    // Whether turning on or off, we reset to the default state.
    await setRecalc(RecalcWhen.DEFAULT, null);
    forceApplyOnChanges.set(value);
  }

  // The state of "Apply to new records" checkbox. Only writable when applyOnChanges is false, so
  // only controls if recalcWhen should be DEFAULT or NEVER.
  const applyToNew = Computed.create(owner, use => use(column.recalcWhen) !== RecalcWhen.NEVER)
    .onWrite(value => setRecalc(value ? RecalcWhen.DEFAULT : RecalcWhen.NEVER, null));

  // If true, mark 'Apply on record changes' checkbox, overriding stored state.
  const forceApplyOnChanges = Observable.create(owner, false);

  // The actual state of the checkbox. Clicking it toggles forceApplyOnChanges, and also resets
  // recalcWhen/recalcDeps to its default state.
  const applyOnChanges = Computed.create(owner,
    use => (use(forceApplyOnChanges) || isApplyOnChangesChecked(use(column.recalcWhen), use(column.recalcDeps))))
    .onWrite(toggleApplyOnChanges);

  // Helper to update column's recalcWhen and recalcDeps properties.
  async function setRecalc(when: RecalcWhen, deps: number[]|null) {
    if (when !== column.recalcWhen.peek() || deps !== column.recalcDeps.peek()) {
      return column._table.sendTableAction(
        ["UpdateRecord", column.id.peek(), {recalcWhen: when, recalcDeps: encodeObject(deps)}]
      );
    }
  }

  const docModel = column._table.docModel;
  const summaryText = Computed.create(owner, use => {
    if (use(column.recalcWhen) === RecalcWhen.MANUAL_UPDATES) {
      return t("Any field");
    }
    const deps = decodeObject(use(column.recalcDeps)) as number[]|null;
    if (!deps || deps.length === 0) { return ''; }
    return deps.map(dep => use(docModel.columns.getRowModel(dep)?.label)).join(", ");
  });


  const changesDisabled = Computed.create(owner, use => {
    return Boolean(
      (options.disabled && use(options.disabled)) ||
      (options.notTrigger && use(options.notTrigger))
    );
  });

  const newRowsDisabled = Computed.create(owner, use => {
    return Boolean(
      use(applyOnChanges) || use(changesDisabled)
    );
  });

  return [
    cssRow(
      labeledSquareCheckbox(
        applyToNew,
        t("Apply to new records"),
        dom.boolAttr('disabled', newRowsDisabled),
        testId('field-formula-apply-to-new'),
      ),
    ),
    cssRow(
      labeledSquareCheckbox(
        applyOnChanges,
        dom.text(use => use(applyOnChanges) ?
          t("Apply on changes to:") :
          t("Apply on record changes")
        ),
        dom.boolAttr('disabled', changesDisabled),
        testId('field-formula-apply-on-changes'),
      ),
    ),
    dom.maybe(applyOnChanges, () =>
      cssIndentedRow(
        cssSelectBtn(
          cssSelectSummary(dom.text(summaryText)),
          icon('Dropdown'),
          testId('field-triggers-select'),
          dom.cls('disabled', use => !!options.disabled && use(options.disabled)),
          elem => {
            setPopupToCreateDom(elem, ctl => buildTriggerSelectors(ctl, column.table.peek(), column, setRecalc),
              {...defaultMenuOptions, placement: 'bottom-end'});
          }
        )
      )
    )
  ];
}

function buildTriggerSelectors(ctl: IOpenController, tableRec: TableRec, column: ColumnRec,
  setRecalc: (when: RecalcWhen, deps: number[]|null) => Promise<void>
) {
  // ctl may be used as an owner for disposable object. Just give is a clearer name for this.
  const owner: IDisposableOwner = ctl;

  // The initial set of selected columns (as a set of rowIds).
  const initialDeps = new Set(decodeObject(column.recalcDeps.peek()) as number[]|null);

  // State of the "Any field" checkbox.
  const allUpdates = Observable.create(owner, column.recalcWhen.peek() === RecalcWhen.MANUAL_UPDATES);

  // Collect all the ColumnRec objects for available columns in this table.
  const showColumns = tableRec.columns.peek().peek().filter(col => !col.isHiddenCol.peek());
  showColumns.sort((a, b) => nativeCompare(a.label.peek(), b.label.peek()));

  // Array of observables for the checkbox for each column. There should never be so many
  // columns as to make this a performance problem.
  const columnsState = showColumns.map(col => Observable.create(owner, initialDeps.has(col.id.peek())));

  // The "Current field" checkbox is merely one of the column checkboxes.
  const current = columnsState.find((col, index) => showColumns[index].id.peek() === column.id.peek())!;

  // If user checks the "Any field" checkbox, all the others should get unchecked.
  owner.autoDispose(allUpdates.addListener(value => {
    if (value) {
      columnsState.forEach(obs => obs.set(false));
    }
  }));

  // Computed results based on current selections.
  const when = Computed.create(owner, use => use(allUpdates) ? RecalcWhen.MANUAL_UPDATES : RecalcWhen.DEFAULT);
  const deps = Computed.create(owner, use => {
    return use(allUpdates) ? null :
      showColumns.filter((col, index) => use(columnsState[index])).map(col => col.id.peek());
  });

  // Whether the selections changed, i.e. warrant saving.
  const isChanged = Computed.create(owner, (use) => {
    return use(when) !== use(column.recalcWhen) || !isEqual(new Set(use(deps)), initialDeps);
  });

  let shouldSave = true;
  function close(_shouldSave: boolean) {
    shouldSave = _shouldSave;
    ctl.close();
  }

  function onClose() {
    if (shouldSave && isChanged.get()) {
      setRecalc(when.get(), deps.get()).catch(reportError);
    }
  }

  return cssSelectorMenu(
    { tabindex: '-1' }, // Allow menu to be focused
    testId('field-triggers-dropdown'),
    dom.cls(menuCssClass),
    dom.onDispose(onClose),
    dom.onKeyDown({
      Enter: () => close(true),
      Escape: () => close(false)
    }),
    // Set focus on open, so that keyboard events work.
    elem => { setTimeout(() => elem.focus(), 0); },

    cssItemsFixed(
      cssSelectorItem(
        labeledSquareCheckbox(current,
          [t("Current field "), cssSelectorNote('(data cleaning)')],
          dom.boolAttr('disabled', allUpdates),
        ),
      ),
      menuDivider(),
      cssSelectorItem(
        labeledSquareCheckbox(allUpdates,
          [`${t("Any field")} `, cssSelectorNote('(except formulas)')]
        ),
      ),
    ),
    cssItemsList(
      showColumns.map((col, index) =>
        cssSelectorItem(
          labeledSquareCheckbox(columnsState[index],
            col.label.peek(),
            dom.boolAttr('disabled', allUpdates),
          ),
        )
      ),
    ),
    cssItemsFixed(
      cssSelectorFooter(
        dom.maybe(isChanged, () =>
          primaryButton(t("OK"),
            dom.on('click', () => close(true)),
            testId('trigger-deps-apply')
          ),
        ),
        basicButton(dom.text(use => use(isChanged) ? t("Cancel") : t("Close")),
          dom.on('click', () => close(false)),
          testId('trigger-deps-cancel')
        ),
      )
    ),
  );
}

const cssIndentedRow = styled(cssRow, `
  margin-left: 40px;
`);

const cssSelectSummary = styled('div', `
  flex: 1 1 0px;
  overflow: hidden;
  text-overflow: ellipsis;

  &:empty::before {
    content: "Select fields";
    color: ${theme.selectButtonPlaceholderFg};
  }
`);


const cssSelectorMenu = styled(cssMenu, `
  display: flex;
  flex-direction: column;
  max-height: calc(max(300px, 95vh - 300px));
  max-width: 400px;
  padding-bottom: 0px;
`);

const cssItemsList = styled(shadowScroll, `
  flex: auto;
  min-height: 80px;
  border-top: 1px solid ${theme.menuBorder};
  border-bottom: 1px solid ${theme.menuBorder};
  margin-top: 8px;
  padding: 8px 0;
`);

const cssItemsFixed = styled('div', `
  flex: none;
`);

const cssSelectorItem = styled(cssMenuItem, `
  justify-content: flex-start;
  align-items: center;
  display: flex;
  padding: 8px 16px;
  white-space: nowrap;
`);

const cssSelectorNote = styled('span', `
  color: ${theme.lightText};
`);

const cssSelectorFooter = styled(cssSelectorItem, `
  justify-content: space-between;
  margin: 3px 0;
`);
