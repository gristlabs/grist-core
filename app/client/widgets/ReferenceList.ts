import {DataRowModel} from 'app/client/models/DataRowModel';
import {testId} from 'app/client/ui2018/cssVars';
import {isList} from 'app/common/gristTypes';
import {dom} from 'grainjs';
import {cssChoiceList, cssToken} from "./ChoiceListCell";
import {Reference} from "./Reference";
import {choiceToken} from "./ChoiceToken";

/**
 * ReferenceList - The widget for displaying lists of references to another table's records.
 */
export class ReferenceList extends Reference {
  public buildDom(row: DataRowModel) {
    return cssChoiceList(
      dom.cls('field_clip'),
      cssChoiceList.cls('-wrap', this.wrapping),
      dom.style('justify-content', use => use(this.alignment) === 'right' ? 'flex-end' : use(this.alignment)),
      dom.domComputed((use) => {

        if (use(row._isAddRow) || this.isDisposed() || use(this.field.displayColModel).isDisposed()) {
          // Work around JS errors during certain changes (noticed when visibleCol field gets removed
          // for a column using per-field settings).
          return null;
        }
        const value = row.cells[use(use(this.field.displayColModel).colId)];
        if (!value) {
          return null;
        }
        const content = use(value);
        // if (isVersions(content)) {  // TODO
        //   // We can arrive here if the reference value is unchanged (viewed as a foreign key)
        //   // but the content of its displayCol has changed.  Postponing doing anything about
        //   // this until we have three-way information for computed columns.  For now,
        //   // just showing one version of the cell.  TODO: elaborate.
        //   return use(this._formatValue)(content[1].local || content[1].parent);
        // }
        const items = isList(content) ? content.slice(1) : [content];
        return items.map(use(this._formatValue));
      }, (input) => {
        if (!input) {
          return null;
        }
        return input.map(token =>
          choiceToken(
            String(token),
            {},  // default colors
            dom.cls(cssToken.className),
            testId('ref-list-cell-token')
          ),
        );
      }),
    );
  }
}
