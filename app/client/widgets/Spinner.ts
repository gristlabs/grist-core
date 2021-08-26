import * as kf from 'app/client/lib/koForm';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {NumericTextBox} from 'app/client/widgets/NumericTextBox';
import {buildNumberFormat} from 'app/common/NumberFormat';
import {dom} from 'grainjs';
import * as ko from 'knockout';

/**
 * Spinner - A widget with a text field and spinner.
 */
export class Spinner extends NumericTextBox {
  private _stepSize: ko.Computed<number>;

  constructor(field: ViewFieldRec) {
    super(field);
    const resolved = this.autoDispose(ko.computed(() => {
      const {numMode} = this.options();
      const docSettings = this.field.documentSettings();
      return buildNumberFormat({numMode}, docSettings).resolvedOptions();
    }));
    this._stepSize = this.autoDispose(ko.computed(() => {
      const extraScaling = (this.options().numMode === 'percent') ? 2 : 0;
      return Math.pow(10, -(this.options().decimals || resolved().minimumFractionDigits) - extraScaling);
    }));
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()];
    return dom.update(super.buildDom(row),
      dom.cls('widget_spinner'),
      kf.spinner(value, this._stepSize)
    );
  }
}
