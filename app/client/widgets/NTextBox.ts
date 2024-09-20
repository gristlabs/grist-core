import { FormFieldRulesConfig } from 'app/client/components/Forms/FormConfig';
import { GristDoc } from 'app/client/components/GristDoc';
import { fromKoSave } from 'app/client/lib/fromKoSave';
import { makeT } from 'app/client/lib/localization';
import { DataRowModel } from 'app/client/models/DataRowModel';
import { ViewFieldRec } from 'app/client/models/entities/ViewFieldRec';
import { fieldWithDefault } from 'app/client/models/modelUtil';
import { FormTextFormat } from 'app/client/ui/FormAPI';
import { cssLabel, cssNumericSpinner, cssRow } from 'app/client/ui/RightPanelStyles';
import { alignmentSelect, buttonSelect, cssButtonSelect, makeButtonSelect } from 'app/client/ui2018/buttonSelect';
import { testId } from 'app/client/ui2018/cssVars';
import { makeLinks } from 'app/client/ui2018/links';
import { NewAbstractWidget, Options } from 'app/client/widgets/NewAbstractWidget';
import { Computed, dom, DomContents, fromKo, Observable } from 'grainjs';

const t = makeT('NTextBox');

/**
 * TextBox - The most basic widget for displaying text information.
 */
export class NTextBox extends NewAbstractWidget {
  protected alignment: Observable<string>;
  protected wrapping: Observable<boolean>;

  constructor(field: ViewFieldRec, options: Options = {}) {
    super(field, options);

    this.alignment = fromKo(this.options.prop('alignment'));
    this.wrapping = fromKo(this.field.wrap);

    this._addRowHeightListeners();
  }

  public buildConfigDom(_gristDoc: GristDoc): DomContents {
    const toggle = () => {
      const newValue = !this.field.config.wrap.peek();
      this.field.config.wrap.setAndSave(newValue).catch(reportError);
    };
    const options = this.field.config.options;
    // Some options might be disabled, as more than one column is selected.
    // Prop observable is owned by the options object.
    const alignmentDisabled = Computed.create(this, use => use(options.disabled('alignment')));
    const wrapDisabled = Computed.create(this, (use) => use(options.disabled('wrap')));
    return [
      cssRow(
        alignmentSelect(
          fromKoSave(this.field.config.alignment),
          cssButtonSelect.cls('-disabled', alignmentDisabled),
        ),
        dom('div', {style: 'margin-left: 8px;'},
          makeButtonSelect(
            fromKo(this.field.config.wrap),
            [{value: true, icon: 'Wrap'}],
            toggle,
            cssButtonSelect.cls('-disabled', wrapDisabled),
          ),
          testId('tb-wrap-text'),
        ),
      ),
    ];
  }

  public buildFormConfigDom(): DomContents {
    const format = fieldWithDefault<FormTextFormat>(
      this.field.widgetOptionsJson.prop('formTextFormat'),
      'singleline'
    );
    const lineCount = fieldWithDefault<number|"">(
      this.field.widgetOptionsJson.prop('formTextLineCount'),
      ''
    );

    return [
      cssLabel(t('Field Format')),
      cssRow(
        buttonSelect(
          fromKoSave(format),
          [
            {value: 'singleline', label: t('Single line')},
            {value: 'multiline', label: t('Multi line')},
          ],
          testId('tb-form-field-format'),
        ),
      ),
      dom.maybe(use => use(format) === 'multiline', () =>
        cssRow(
          cssNumericSpinner(
            fromKo(lineCount),
            {
              label: t('Lines'),
              defaultValue: 3,
              minValue: 1,
              maxValue: 99,
              save: async (val) => lineCount.setAndSave((val && Math.floor(val)) ?? ''),
            },
          ),
        ),
      ),
      dom.create(FormFieldRulesConfig, this.field),
    ];
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()];
    return dom('div.field_clip',
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      dom.domComputed((use) => use(row._isAddRow) || this.isDisposed() ?
        null :
        makeLinks(use(this.valueFormatter).formatAny(use(value), t)))
    );
  }

  private _addRowHeightListeners() {
    for (const obs of [this.wrapping, fromKo(this.field.config.widget)]) {
      this.autoDispose(obs.addListener(() => {
        this.field.viewSection().events.trigger('rowHeightChange');
      }));
    }
  }
}
