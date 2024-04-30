import {fromKoSave} from 'app/client/lib/fromKoSave';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {fieldWithDefault} from 'app/client/models/modelUtil';
import {FormOptionsAlignment, FormOptionsSortOrder, FormSelectFormat} from 'app/client/ui/FormAPI';
import {
  cssLabel,
  cssRow,
  cssSeparator,
} from 'app/client/ui/RightPanelStyles';
import {buttonSelect} from 'app/client/ui2018/buttonSelect';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {select} from 'app/client/ui2018/menus';
import {Disposable, dom, makeTestId} from 'grainjs';

const t = makeT('FormConfig');

const testId = makeTestId('test-form-');

export class FormSelectConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const format = fieldWithDefault<FormSelectFormat>(
      this._field.widgetOptionsJson.prop('formSelectFormat'),
      'select'
    );

    return [
      cssLabel(t('Field Format')),
      cssRow(
        buttonSelect(
          fromKoSave(format),
          [
            {value: 'select', label: t('Select')},
            {value: 'radio', label: t('Radio')},
          ],
          testId('field-format'),
        ),
      ),
      dom.maybe(use => use(format) === 'radio', () => dom.create(FormOptionsAlignmentConfig, this._field)),
    ];
  }
}

export class FormOptionsAlignmentConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const alignment = fieldWithDefault<FormOptionsAlignment>(
      this._field.widgetOptionsJson.prop('formOptionsAlignment'),
      'vertical'
    );

    return [
      cssLabel(t('Options Alignment')),
      cssRow(
        select(
          fromKoSave(alignment),
          [
            {value: 'vertical', label: t('Vertical')},
            {value: 'horizontal', label: t('Horizontal')},
          ],
          {defaultLabel: t('Vertical')}
        ),
      ),
    ];
  }
}

export class FormOptionsSortConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const optionsSortOrder = fieldWithDefault<FormOptionsSortOrder>(
      this._field.widgetOptionsJson.prop('formOptionsSortOrder'),
      'default'
    );

    return [
      cssLabel(t('Options Sort Order')),
      cssRow(
        select(
          fromKoSave(optionsSortOrder),
          [
            {value: 'default', label: t('Default')},
            {value: 'ascending', label: t('Ascending')},
            {value: 'descending', label: t('Descending')},
          ],
          {defaultLabel: t('Default')}
        ),
      ),
    ];
  }
}

export class FormFieldRulesConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const requiredField = fieldWithDefault<boolean>(
      this._field.widgetOptionsJson.prop('formRequired'),
      false
    );

    return [
      cssSeparator(),
      cssLabel(t('Field Rules')),
      cssRow(labeledSquareCheckbox(
        fromKoSave(requiredField),
        t('Required field'),
        testId('field-required'),
      )),
    ];
  }
}
