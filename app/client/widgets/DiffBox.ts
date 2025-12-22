import { DataRowModel } from 'app/client/models/DataRowModel';
import { NewAbstractWidget } from 'app/client/widgets/NewAbstractWidget';
import { inlineStyle } from 'app/common/gutil';
import { Diff, DIFF_DELETE, DIFF_INSERT } from 'diff-match-patch';
import { Computed, dom } from 'grainjs';
import { CellDiffTool, DIFF_LOCAL } from 'app/client/lib/CellDiffTool';

/**
 *
 * A special widget used for rendering cell-level comparisons and conflicts.
 *
 */
export class DiffBox extends NewAbstractWidget {

  private _diffTool = new CellDiffTool();

  public buildConfigDom() {
    return dom('div');
  }

  /**
   * Render a cell-level diff as a series of styled spans.
   */
  public buildDom(row: DataRowModel) {
    const formattedValue = Computed.create(null, (use) => {
      if (use(row._isAddRow) || this.isDisposed() || use(this.field.displayColModel).isDisposed()) {
        // Work around JS errors during certain changes, following code in Reference.js
        return [] as Diff[];
      }
      const value = use(row.cells[use(use(this.field.displayColModel).colId)]);
      const formatter = use(this.valueFormatter);
      return this._diffTool.prepareCellDiff(value, formatter);
    });
    return dom(
      'div.field_clip',
      dom.autoDispose(formattedValue),
      dom.style('text-align', this.options.prop('alignment')),
      dom.cls('text_wrapping', use => Boolean(use(this.options.prop('wrap')))),
      inlineStyle('--grist-diff-color', '#000000'),
      inlineStyle('--grist-diff-background-color', '#00000000'),
      dom.forEach(formattedValue, ([code, txt]) => {
        if (code === DIFF_DELETE) {
          return dom("span.diff-parent", txt);
        } else if (code === DIFF_INSERT) {
          return dom("span.diff-remote", txt);
        } else if (code === DIFF_LOCAL) {
          return dom("span.diff-local", txt);
        } else {
          return dom("span.diff-common", txt);
        }
      }),
    );
  }
}
