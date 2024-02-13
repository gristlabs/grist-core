import {makeT} from 'app/client/lib/localization';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/DocModel';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {RuleOwner} from 'app/client/models/RuleOwner';
import {Style} from 'app/client/models/Styles';
import {cssFieldFormula} from 'app/client/ui/FieldConfig';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {textButton} from 'app/client/ui2018/buttons';
import {ColorOption, colorSelect} from 'app/client/ui2018/ColorSelect';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {setupEditorCleanup} from 'app/client/widgets/FieldEditor';
import {cssError, openFormulaEditor} from 'app/client/widgets/FormulaEditor';
import {isRaisedException, isValidRuleValue} from 'app/common/gristTypes';
import {RowRecord} from 'app/plugin/GristData';
import {Computed, Disposable, dom, DomContents, makeTestId, Observable, styled} from 'grainjs';
import debounce = require('lodash/debounce');

const testId = makeTestId('test-widget-style-');
const t = makeT('ConditionalStyle');

export class ConditionalStyle extends Disposable {
  // Holds data from currently selected record (holds data only when this field has conditional styles).
  private _currentRecord: Computed<RowRecord | undefined>;
  // Helper field for refreshing current record data.
  private _dataChangeTrigger = Observable.create(this, 0);

  constructor(
    private _label: string,
    private _ruleOwner: RuleOwner,
    private _gristDoc: GristDoc,
    private _disabled?: Observable<boolean>
  ) {
    super();
    this._currentRecord = Computed.create(this, use => {
      if (!use(this._ruleOwner.hasRules)) {
        return;
      }
      // As we are not subscribing to data change, we will monitor actions
      // that are sent from the server to refresh this computed observable.
      void use(this._dataChangeTrigger);
      const tableId = use(_ruleOwner.tableId);
      const tableData = _gristDoc.docData.getTable(tableId)!;
      const cursor = use(_gristDoc.cursorPosition);
      // Make sure we are not on the new row.
      if (!cursor || typeof cursor.rowId !== 'number') {
        return undefined;
      }
      return tableData.getRecord(cursor.rowId);
    });

    // Here we will subscribe to tableActionEmitter, and update currentRecord observable.
    // We have 'dataChangeTrigger' that is just a number that will be updated every time
    // we received some table actions.
    const debouncedUpdate = debounce(() => {
      if (this._dataChangeTrigger.isDisposed()) {
        return;
      }
      this._dataChangeTrigger.set(this._dataChangeTrigger.get() + 1);
    }, 0);
    Computed.create(this, (use) => {
      const tableId = use(_ruleOwner.tableId);
      const tableData = _gristDoc.docData.getTable(tableId);
      return tableData ? use.owner.autoDispose(tableData.tableActionEmitter.addListener(debouncedUpdate)) : null;
    });
  }

  public buildDom(): DomContents {
    return [
      cssRow(
        { style: 'margin-top: 16px' },
        withInfoTooltip(
          textButton(
            t('Add conditional style'),
            testId('add-conditional-style'),
            dom.on('click', () => this._ruleOwner.addEmptyRule()),
            dom.prop('disabled', this._disabled),
          ),
          this._label === t('Row Style') ? 'addRowConditionalStyle' : 'addColumnConditionalStyle'
        ),
        dom.hide(use => use(this._ruleOwner.hasRules))
      ),
      dom.domComputedOwned(
        use => use(this._ruleOwner.rulesCols),
        (owner, rules) =>
          cssRuleList(
            dom.show(use => rules.length > 0 && (!this._disabled || !use(this._disabled))),
            ...rules.map((column, ruleIndex) => {
              const textColor = this._buildStyleOption(owner, ruleIndex, 'textColor');
              const fillColor = this._buildStyleOption(owner, ruleIndex, 'fillColor');
              const fontBold = this._buildStyleOption(owner, ruleIndex, 'fontBold');
              const fontItalic = this._buildStyleOption(owner, ruleIndex, 'fontItalic');
              const fontUnderline = this._buildStyleOption(owner, ruleIndex, 'fontUnderline');
              const fontStrikethrough = this._buildStyleOption(owner, ruleIndex, 'fontStrikethrough');
              const save = async () => {
                // This will save both options.
                await this._ruleOwner.rulesStyles.save();
              };
              const currentValue = Computed.create(owner, use => {
                const record = use(this._currentRecord);
                if (!record) {
                  return null;
                }
                const value = record[use(column.colId)];
                return value ?? null;
              });
              const hasError = Computed.create(owner, use => {
                return !isValidRuleValue(use(currentValue));
              });
              const errorMessage = Computed.create(owner, use => {
                const value = use(currentValue);
                return (!use(hasError) ? '' :
                  isRaisedException(value) ? t('Error in style rule') :
                    t('Rule must return True or False'));
              });
              return dom('div',
                testId(`conditional-rule-${ruleIndex}`),
                testId(`conditional-rule`), // for testing
                cssLineLabel('IF...'),
                cssColumnsRow(
                  cssLeftColumn(
                    this._buildRuleFormula(column.formula, column, hasError),
                    cssRuleError(
                      dom.text(errorMessage),
                      dom.show(hasError),
                      testId(`rule-error-${ruleIndex}`),
                    ),
                    colorSelect(
                      {
                        textColor: new ColorOption({color:textColor, allowsNone: true, noneText: 'default'}),
                        fillColor: new ColorOption({color:fillColor, allowsNone: true, noneText: 'none'}),
                        fontBold,
                        fontItalic,
                        fontUnderline,
                        fontStrikethrough
                      }, {
                        onSave: save,
                        placeholder: this._label || 'Conditional Style',
                      }
                    )
                  ),
                  cssRemoveButton(
                    'Remove',
                    testId(`remove-rule-${ruleIndex}`),
                    dom.on('click', () => this._ruleOwner.removeRule(ruleIndex))
                  )
                )
              );
            })
          )
      ),
      cssRow(
        textButton(t('Add another rule'),
          dom.on('click', () => this._ruleOwner.addEmptyRule()),
          testId('add-another-rule'),
          dom.prop('disabled', use => this._disabled && use(this._disabled))
        ),
        dom.show(use => use(this._ruleOwner.hasRules))
      ),
    ];
  }

  private _buildStyleOption<T extends keyof Style>(owner: Disposable, index: number, option: T) {
    const obs = Computed.create(owner, use => {
      const styles = use(this._ruleOwner.rulesStyles);
      return styles?.[index]?.[option];
    });
    obs.onWrite(value => {
      const list = Array.from(this._ruleOwner.rulesStyles.peek() ?? []);
      list[index] = list[index] ?? {};
      list[index][option] = value;
      this._ruleOwner.rulesStyles(list);
    });
    return obs;
  }

  private _buildRuleFormula(
    formula: KoSaveableObservable<string>,
    column: ColumnRec,
    hasError: Observable<boolean>
  ) {
    return cssFieldFormula(
      formula,
      { gristTheme: this._gristDoc.currentTheme, maxLines: 1 },
      dom.cls('formula_field_sidepane'),
      dom.cls(cssErrorBorder.className, hasError),
      { tabIndex: '-1' },
      dom.on('focus', (_, refElem) => {
        const section = this._gristDoc.viewModel.activeSection();
        const vsi = section.viewInstance();
        const editorHolder = openFormulaEditor({
          gristDoc: this._gristDoc,
          editingFormula: section.editingFormula,
          column,
          editRow: vsi?.moveEditRowToCursor(),
          refElem,
          setupCleanup: setupEditorCleanup,
          canDetach: false,
        });
        // Add editor to document holder - this will prevent multiple formula editor instances.
        this._gristDoc.fieldEditorHolder.autoDispose(editorHolder);
      })
    );
  }
}

const cssIcon = styled(icon, `
  flex: 0 0 auto;
`);

const cssLabel = styled('div', `
  text-transform: uppercase;
  margin: 16px 16px 12px 16px;
  color: ${theme.text};
  font-size: ${vars.xsmallFontSize};
`);

const cssRow = styled('div', `
  display: flex;
  margin: 8px 16px;
  align-items: center;
  &-top-space {
    margin-top: 24px;
  }
  &-disabled {
    color: ${theme.disabledText};
  }
`);

const cssRemoveButton = styled(cssIcon, `
  flex: none;
  margin: 6px;
  margin-right: 0px;
  transform: translateY(4px);
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover {
    --icon-color: ${theme.controlFg};
  }
`);

const cssLineLabel = styled(cssLabel, `
  margin-top: 0px;
  margin-bottom: 0px;
`);

const cssRuleList = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  margin-bottom: 12px;
`);

const cssErrorBorder = styled('div', `
  border-color: ${theme.inputInvalid};
`);

const cssRuleError = styled(cssError, `
  margin: 2px 0px 10px 0px;
`);

const cssColumnsRow = styled(cssRow, `
  align-items: flex-start;
  margin-top: 0px;
  margin-bottom: 0px;
`);

const cssLeftColumn = styled('div', `
  overflow: hidden;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`);
