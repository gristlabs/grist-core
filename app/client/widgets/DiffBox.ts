import { DataRowModel } from 'app/client/models/DataRowModel';
import { NewAbstractWidget } from 'app/client/widgets/NewAbstractWidget';
import { CellValue } from 'app/common/DocActions';
import { isVersions } from 'app/common/gristTypes';
import { inlineStyle } from 'app/common/gutil';
import { BaseFormatter } from 'app/common/ValueFormatter';
import { Diff, DIFF_DELETE, DIFF_EQUAL, DIFF_INSERT, diff_match_patch as DiffMatchPatch } from 'diff-match-patch';
import { Computed, dom } from 'grainjs';

/**
 *
 * A special widget used for rendering cell-level comparisons and conflicts.
 *
 */
export class DiffBox extends NewAbstractWidget {

  private _diffTool = new DiffMatchPatch();

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
      return this._prepareCellDiff(value, formatter);
    });
    return dom(
      'div.field_clip',
      dom.autoDispose(formattedValue),
      dom.style('text-align', this.options.prop('alignment')),
      dom.cls('text_wrapping', (use) => Boolean(use(this.options.prop('wrap')))),
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

  /**
   * Given the cell value and the formatter, construct a list of fragments in
   * diff-match-patch format expressing the difference between versions.
   * The format is a list of [CODE, STRING] pairs, where the possible values of
   * CODE are:
   *   -1  -- meaning DELETION of the parent value.
   *    0  -- meaning text common to all versions.
   *    1  -- meaning INSERTION of the remote value.
   *    2  -- meaning INSERTION of the local value.
   *
   * When a change is made only locally or remotely, then the list returned may
   * include common text, deletions and insertions in any order.
   *
   * When a change is made both locally and remotely, the list returned does not
   * include any common text, but just reports the parent value, then the local value,
   * then the remote value.  This may be optimized in future.
   */
  private _prepareCellDiff(value: CellValue, formatter: BaseFormatter): Diff[] {
    if (!isVersions(value)) {
      // This can happen for reference columns, where the diff widget is
      // selected on the basis of one column, but we are displaying the
      // content of another.  We have more version information for the
      // reference column than for its display column.
      return [[DIFF_EQUAL, formatter.formatAny(value)]];
    }
    const versions = value[1];
    if (!('local' in versions)) {
      // Change was made remotely only.
      return this._prepareTextDiff(
        formatter.formatAny(versions.parent),
        formatter.formatAny(versions.remote));
    } else if (!('remote' in versions)) {
      // Change was made locally only.
      return this._prepareTextDiff(
        formatter.formatAny(versions.parent),
        formatter.formatAny(versions.local))
        .map(([code, txt]) => [code === DIFF_INSERT ? DIFF_LOCAL : code, txt]);
    }
    // Change was made both locally and remotely.
    return [[DIFF_DELETE, formatter.formatAny(versions.parent)],
            [DIFF_LOCAL, formatter.formatAny(versions.local)],
            [DIFF_INSERT, formatter.formatAny(versions.remote)]];
  }

  // Run diff-match-patch on the text, do its cleanup, and then some extra
  // ad-hoc cleanup of our own.  Diffs are hard to read if they are too
  // "choppy".
  private _prepareTextDiff(txt1: string, txt2: string): Diff[] {
    const diffs = this._diffTool.diff_main(txt1, txt2);
    this._diffTool.diff_cleanupSemantic(diffs);
    if (diffs.length > 2 && this._notDiffWorthy(txt1, diffs.length) &&
        this._notDiffWorthy(txt2, diffs.length)) {
      return [[DIFF_DELETE, txt1], [DIFF_INSERT, txt2]];
    }
    if (diffs.length === 1 && diffs[0][0] === DIFF_DELETE) {
      // Add an empty set symbol, since otherwise it will be ambiguous
      // whether the deletion was done locally or remotely.
      diffs.push([1, '\u2205']);
    }
    return diffs;
  }

  // Heuristic for whether to show common parts of versions, or to treat them
  // as entirely distinct.
  private _notDiffWorthy(txt: string, parts: number) {
    return txt.length < 5 * parts || this._isMostlyNumeric(txt);
  }

  // Check is text has a lot of numeric content.
  private _isMostlyNumeric(txt: string) {
    return [...txt].filter(c => c >= '0' && c <= '9').length > txt.length / 2;
  }
}

// A constant marking text fragments present locally but not in parent (or remote).
// Must be distinct from DiffMatchPatch.DIFF_* constants (-1, 0, 1).
const DIFF_LOCAL = 2;
