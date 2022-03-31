import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/DocModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {Style} from 'app/client/models/Styles';
import {cssFieldFormula} from 'app/client/ui/FieldConfig';
import {cssIcon, cssLabel, cssRow} from 'app/client/ui/RightPanel';
import {textButton} from 'app/client/ui2018/buttons';
import {colorSelect} from 'app/client/ui2018/ColorSelect';
import {colors} from 'app/client/ui2018/cssVars';
import {setupEditorCleanup} from 'app/client/widgets/FieldEditor';
import {cssError, openFormulaEditor} from 'app/client/widgets/FormulaEditor';
import {isRaisedException, isValidRuleValue} from 'app/common/gristTypes';
import {RowRecord} from 'app/plugin/GristData';
import {Computed, Disposable, dom, DomContents, fromKo, makeTestId, MultiHolder, Observable, styled} from 'grainjs';
import debounce = require('lodash/debounce');

const testId = makeTestId('test-widget-style-');

export class CellStyle extends Disposable {
  protected textColor: Observable<string>;
  protected fillColor: Observable<string>;
  // Holds data from currently selected record (holds data only when this field has conditional styles).
  protected currentRecord: Computed<RowRecord | undefined>;
  // Helper field for refreshing current record data.
  protected dataChangeTrigger = Observable.create(this, 0);

  constructor(
    protected field: ViewFieldRec,
    protected gristDoc: GristDoc,
    defaultTextColor: string = '#000000'
  ) {
    super();
    this.textColor = Computed.create(
      this,
      use => use(this.field.textColor) || defaultTextColor
    ).onWrite(val => this.field.textColor(val === defaultTextColor ? '' : val));
    this.fillColor = fromKo(this.field.fillColor);
    this.currentRecord = Computed.create(this, use => {
      if (!use(this.field.hasRules)) {
        return;
      }
      // As we are not subscribing to data change, we will monitor actions
      // that are sent from the server to refresh this computed observable.
      void use(this.dataChangeTrigger);
      const tableId = use(use(use(field.column).table).tableId);
      const tableData = gristDoc.docData.getTable(tableId)!;
      const cursor = use(gristDoc.cursorPosition);
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
      if (this.dataChangeTrigger.isDisposed()) {
        return;
      }
      this.dataChangeTrigger.set(this.dataChangeTrigger.get() + 1);
    }, 0);
    Computed.create(this, (use) => {
      const tableId = use(use(use(field.column).table).tableId);
      const tableData = gristDoc.docData.getTable(tableId);
      return tableData ? use.owner.autoDispose(tableData.tableActionEmitter.addListener(debouncedUpdate)) : null;
    });
  }

  public buildDom(): DomContents {
    const holder = new MultiHolder();
    return [
      cssLabel('CELL STYLE', dom.autoDispose(holder)),
      cssRow(
        colorSelect(
          this.textColor,
          this.fillColor,
          // Calling `field.widgetOptionsJson.save()` saves both fill and text color settings.
          () => this.field.widgetOptionsJson.save()
        )
      ),
      cssRow(
        {style: 'margin-top: 16px'},
        textButton(
          'Add conditional style',
          testId('add-conditional-style'),
          dom.on('click', () => this.field.addEmptyRule())
        ),
        dom.hide(this.field.hasRules)
      ),
      dom.domComputedOwned(
        use => use(this.field.rulesCols),
        (owner, rules) =>
          cssRuleList(
            dom.show(rules.length > 0),
            ...rules.map((column, ruleIndex) => {
              const textColor = this._buildStyleOption(owner, ruleIndex, 'textColor');
              const fillColor = this._buildStyleOption(owner, ruleIndex, 'fillColor');
              const save = async () => {
                // This will save both options.
                await this.field.rulesStyles.save();
              };
              const currentValue = Computed.create(owner, use => {
                const record = use(this.currentRecord);
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
                  isRaisedException(value) ? 'Error in style rule' :
                  'Rule must return True or False');
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
                    colorSelect(textColor, fillColor, save, true)
                  ),
                  cssRemoveButton(
                    'Remove',
                    testId(`remove-rule-${ruleIndex}`),
                    dom.on('click', () => this.field.removeRule(ruleIndex))
                  )
                )
              );
            })
          )
      ),
      cssRow(
        textButton('Add another rule'),
        testId('add-another-rule'),
        dom.on('click', () => this.field.addEmptyRule()),
        dom.show(this.field.hasRules)
      ),
    ];
  }

  private _buildStyleOption(owner: Disposable, index: number, option: keyof Style) {
    const obs = Computed.create(owner, use => use(this.field.rulesStyles)[index]?.[option]);
    obs.onWrite(value => {
      const list = Array.from(this.field.rulesStyles.peek() ?? []);
      list[index] = list[index] ?? {};
      list[index][option] = value;
      this.field.rulesStyles(list);
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
      {maxLines: 1},
      dom.cls('formula_field_sidepane'),
      dom.cls(cssErrorBorder.className, hasError),
      {tabIndex: '-1'},
      dom.on('focus', (_, refElem) => {
        const vsi = this.gristDoc.viewModel.activeSection().viewInstance();
        const editorHolder = openFormulaEditor({
          gristDoc: this.gristDoc,
          field: this.field,
          column,
          editRow: vsi?.moveEditRowToCursor(),
          refElem,
          setupCleanup: setupEditorCleanup,
        });
        // Add editor to document holder - this will prevent multiple formula editor instances.
        this.gristDoc.fieldEditorHolder.autoDispose(editorHolder);
      })
    );
  }
}

const cssRemoveButton = styled(cssIcon, `
  flex: none;
  margin: 6px;
  margin-right: 0px;
  transform: translateY(4px);
  cursor: pointer;
  --icon-color: ${colors.slate};
  &:hover {
    --icon-color: ${colors.lightGreen};
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
  border-color: ${colors.error};
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
