import {fromKoSave} from 'app/client/lib/fromKoSave';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {cssRow} from 'app/client/ui/RightPanel';
import {alignmentSelect, makeButtonSelect} from 'app/client/ui2018/buttonSelect';
import {testId} from 'app/client/ui2018/cssVars';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {dom, DomContents, fromKo, Observable} from 'grainjs';

/**
 * TextBox - The most basic widget for displaying text information.
 */
export class NTextBox extends NewAbstractWidget {
  protected alignment: Observable<string>;
  protected wrapping: Observable<boolean>;

  constructor(field: ViewFieldRec) {
    super(field);

    this.alignment = fromKoSave<string>(this.options.prop('alignment'));
    this.wrapping = fromKo(this.field.wrapping);

    this.autoDispose(this.wrapping.addListener(() => {
      this.field.viewSection().events.trigger('rowHeightChange');
    }));
  }

  public buildConfigDom(): DomContents {
    return [
      cssRow(
        alignmentSelect(this.alignment),
        dom('div', {style: 'margin-left: 8px;'},
          makeButtonSelect(this.wrapping, [{value: true, icon: 'Wrap'}], this._toggleWrap.bind(this), {}),
          testId('tb-wrap-text')
        )
      )
    ];
  }

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()];
    return dom('div.field_clip',
      dom.style('text-align', this.alignment),
      dom.cls('text_wrapping', this.wrapping),
      dom.text((use) => use(row._isAddRow) ? '' : use(this.valueFormatter).format(use(value))),
    );
  }

  private _toggleWrap(value: boolean) {
    const newValue = !this.wrapping.get();
    this.options.update({wrap: newValue});
    (this.options as any).save();
  }
}
