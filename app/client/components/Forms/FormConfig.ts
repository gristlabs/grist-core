import {fromKoSave} from 'app/client/lib/fromKoSave';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {cssLabel, cssRow, cssSeparator} from 'app/client/ui/RightPanelStyles';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId} from 'app/client/ui2018/cssVars';
import {Disposable} from 'grainjs';

const t = makeT('FormConfig');

export class FieldRulesConfig extends Disposable {
  constructor(private _field: ViewFieldRec) {
    super();
  }

  public buildDom() {
    const requiredField: KoSaveableObservable<boolean> = this._field.widgetOptionsJson.prop('formRequired');

    return [
      cssSeparator(),
      cssLabel(t('Field rules')),
      cssRow(labeledSquareCheckbox(
        fromKoSave(requiredField),
        t('Required field'),
        testId('field-required'),
      )),
    ];
  }
}
