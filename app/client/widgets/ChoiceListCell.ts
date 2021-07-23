import {DataRowModel} from 'app/client/models/DataRowModel';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {
  ChoiceOptionsByName,
  ChoiceTextBox,
} from 'app/client/widgets/ChoiceTextBox';
import {CellValue} from 'app/common/DocActions';
import {decodeObject} from 'app/plugin/objtypes';
import {Computed, dom, styled} from 'grainjs';
import {choiceToken} from 'app/client/widgets/ChoiceToken';

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
          choiceToken(
            String(token),
            choiceOptionsByName.get(String(token)) || {},
            cssInvalidToken.cls('-invalid', !choiceSet.has(String(token))),
            dom.cls(cssToken.className),
            testId('choice-list-cell-token')
          )
        );
      }),
    );
  }
}

export const cssChoiceList = styled('div', `
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

export const cssToken = styled('div', `
  flex: 0 1 auto;
  min-width: 0px;
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
