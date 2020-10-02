import {Disposable, dom} from 'grainjs';

export interface ISize {
  width: number;
  height: number;
}

interface ISizeOpts {
  // Don't reposition the editor as part of the size calculation.
  calcOnly?: boolean;
}

// edgeMargin is how many pixels to leave before the edge of the browser window.
const edgeMargin = 12;

// How large the editor can get when it needs to shift to the left or upwards.
const maxShiftWidth = 560;
const maxShiftHeight = 400;


/**
 * This class implements the placement and sizing of the cell editor, such as TextEditor and
 * FormulaEditor. These try to match the size and position of the cell being edited, expanding
 * when needed.
 *
 * This class also takes care of attaching the editor DOM and destroying it on disposal.
 */
export class EditorPlacement extends Disposable {
  private _editorRoot: HTMLElement;

  // - editorDom is the DOM to attach. It gets destroyed when EditorPlacement is disposed.
  // - cellRect is the bounding box of the cell being mirrored by the editor; the editor generally
  //   expands to match the size of the cell.
  constructor(editorDom: HTMLElement, private _cellRect: ClientRect|DOMRect) {
    super();

    const editorRoot = this._editorRoot = dom('div.cell_editor', editorDom);
    // To hide from the user the incorrectly-sized element, we set visibility to hidden, and
    // reset it in _calcEditorSize() as soon as we have the sizes.
    editorRoot.style.visibility = 'hidden';

    document.body.appendChild(editorRoot);
    this.onDispose(() => {
      // When the editor is destroyed, destroy and remove its DOM.
      dom.domDispose(editorRoot);
      editorRoot.remove();
    });
  }

  /**
   * Calculate the size of the full editor and shift the editor if needed to give it more space.
   * The position and size are applied to the editor unless {calcOnly: true} option is given.
   */
  public calcSize(desiredSize: ISize, options: ISizeOpts = {}): ISize {
    const maxRect = document.body.getBoundingClientRect();

    const noShiftMaxWidth = maxRect.right - edgeMargin - this._cellRect.left;
    const maxWidth = Math.min(maxRect.width - 2 * edgeMargin, Math.max(maxShiftWidth, noShiftMaxWidth));
    const width = Math.min(maxWidth, Math.max(this._cellRect.width, desiredSize.width));
    const left = Math.max(edgeMargin, Math.min(this._cellRect.left - maxRect.left, maxRect.width - edgeMargin - width));

    const noShiftMaxHeight = maxRect.bottom - edgeMargin - this._cellRect.top;
    const maxHeight = Math.min(maxRect.height - 2 * edgeMargin, Math.max(maxShiftHeight, noShiftMaxHeight));
    const height = Math.min(maxHeight, Math.max(this._cellRect.height, desiredSize.height));
    const top = Math.max(edgeMargin, Math.min(this._cellRect.top - maxRect.top, maxRect.height - edgeMargin - height));

    // To hide from the user the split second before things are sized correctly, we set visibility
    // to hidden until we can get the sizes. As soon as sizes are available, restore visibility.
    if (!options.calcOnly) {
      Object.assign(this._editorRoot.style, {
        visibility: 'visible',
        left: left + 'px',
        top: top + 'px',
        // Set the width (but not the height) of the outer container explicitly to accommodate the
        // particular setup where a formula may include error details below -- these should
        // stretch to the calculated width (so need an explicit value), but may be dynamic in
        // height. (This feels hacky, but solves the problem.)
        width: width + 'px',
      });
    }

    return {width, height};
  }

  /**
   * Calculate the size for the editable part of the editor, given in elem. This assumes that the
   * size of the full editor differs from the editable part only in constant padding. The full
   * editor may be shifted as part of this call.
   */
  public calcSizeWithPadding(elem: HTMLElement, desiredElemSize: ISize, options: ISizeOpts = {}): ISize {
    const rootRect = this._editorRoot.getBoundingClientRect();
    const elemRect = elem.getBoundingClientRect();
    const heightDelta = rootRect.height - elemRect.height;
    const widthDelta = rootRect.width - elemRect.width;
    const {width, height} = this.calcSize({
      width: desiredElemSize.width + widthDelta,
      height: desiredElemSize.height + heightDelta,
    }, options);
    return {
      width: width - widthDelta,
      height: height - heightDelta,
    };
  }
}
