import {DataRowModel} from 'app/client/models/DataRowModel';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {
  ChoiceOptionsByName,
  ChoiceTextBox,
  getFillColor,
  getTextColor
} from 'app/client/widgets/ChoiceTextBox';
import {CellValue} from 'app/common/DocActions';
import {decodeObject} from 'app/plugin/objtypes';
import {Computed, dom, styled} from 'grainjs';

/**
 * ChoiceListCell - A cell that renders a list of choice tokens.
 */
export class ChoiceListCell extends ChoiceTextBox {
  private _choiceSet = Computed.create(this, this.getChoiceValues(), (use, values) => new Set(values));

  public buildDom(row: DataRowModel) {
    const value = row.cells[this.field.colId.peek()];

    return cssChoiceList(
      dom.cls('field_clip'),
      cssChoiceList.cls('-wrap', this.wrapping),
      dom.style('justify-content', use => use(this.alignment) === 'right' ? 'flex-end' : use(this.alignment)),
      dom.domComputed((use) => {
        return use(row._isAddRow) ? null :
          [
            use(value), use(this._choiceSet),
            use(this.getChoiceOptions())
          ] as [CellValue, Set<string>, ChoiceOptionsByName];
      }, (input) => {
        if (!input) { return null; }
        const [rawValue, choiceSet, choiceOptionsByName] = input;
        const val = decodeObject(rawValue);
        if (!val) { return null; }
        // Handle any unexpected values we might get (non-array, or array with non-strings).
        const tokens: unknown[] = Array.isArray(val) ? val : [val];
        return tokens.map(token =>
            cssToken(
              String(token),
              cssInvalidToken.cls('-invalid', !choiceSet.has(token as string)),
              dom.style('background-color', getFillColor(choiceOptionsByName.get(String(token)))),
              dom.style('color', getTextColor(choiceOptionsByName.get(String(token)))),
              testId('choice-list-cell-token')
            ),
        );
      }),
    );
  }
}

const cssChoiceList = styled('div', `
  display: flex;
  align-items: start;
  padding: 0 3px;

  position: relative;
  height: min-content;
  min-height: 22px;

  &-wrap {
    flex-wrap: wrap;
  }
`);

const cssToken = styled('div', `
  flex: 0 1 auto;
  min-width: 0px;
  overflow: hidden;
  border-radius: 3px;
  padding: 1px 4px;
  margin: 2px;
  line-height: 16px;
`);

export const cssInvalidToken = styled('div', `
  &-invalid {
    background-color: white !important;
    box-shadow: inset 0 0 0 1px var(--grist-color-error);
    color: ${colors.slate};
  }
`);
