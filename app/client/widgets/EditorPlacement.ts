import {Disposable, dom, Emitter} from 'grainjs';

export interface ISize {
  width: number;
  height: number;
}

interface ISizeOpts {
  // Don't reposition the editor as part of the size calculation.
  calcOnly?: boolean;
}

export interface IMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type IRect = ISize & IMargins;


// edgeMargin is how many pixels to leave before the edge of the browser window by default.
// This is added to margins that may be passed into the constructor.
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
  public readonly onReposition = this.autoDispose(new Emitter());

  private _editorRoot: HTMLElement;
  private _maxRect: IRect;
  private _cellRect: IRect;
  private _margins: IMargins;

  // - editorDom is the DOM to attach. It gets destroyed when EditorPlacement is disposed.
  // - cellElem is the cell being mirrored by the editor; the editor generally expands to match
  //   the size of the cell.
  // - margins may be given to add to the default edgeMargin, to increase distance to edges of the window.
  constructor(editorDom: HTMLElement, private _cellElem: Element, options: {margins?: IMargins} = {}) {
    super();

    this._margins = {
      top: (options.margins?.top || 0) + edgeMargin,
      bottom: (options.margins?.bottom || 0) + edgeMargin,
      left: (options.margins?.left || 0) + edgeMargin,
      right: (options.margins?.right || 0) + edgeMargin,
    };

    // Initialize _maxRect and _cellRect used for sizing the editor. We don't re-measure them
    // while typing (e.g. OK to scroll the view away from the editor), but we re-measure them on
    // window resize, which is only a normal occurrence on Android when virtual keyboard is shown.
    this._maxRect = document.body.getBoundingClientRect();
    this._cellRect = rectWithoutBorders(this._cellElem);

    this.autoDispose(dom.onElem(window, 'resize', () => {
      this._maxRect = document.body.getBoundingClientRect();
      this._cellRect = rectWithoutBorders(this._cellElem);
      this.onReposition.emit();
    }));

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
    const maxRect = this._maxRect;
    const margin = this._margins;

    const noShiftMaxWidth = maxRect.right - margin.right - this._cellRect.left;
    const maxWidth = Math.min(maxRect.width - margin.left - margin.right, Math.max(maxShiftWidth, noShiftMaxWidth));
    const width = Math.min(maxWidth, Math.max(this._cellRect.width, desiredSize.width));
    const left = Math.max(margin.left,
      Math.min(this._cellRect.left - maxRect.left, maxRect.width - margin.right - width));

    const noShiftMaxHeight = maxRect.bottom - margin.bottom - this._cellRect.top;
    const maxHeight = Math.min(maxRect.height - margin.top - margin.bottom, Math.max(maxShiftHeight, noShiftMaxHeight));
    const height = Math.min(maxHeight, Math.max(this._cellRect.height, desiredSize.height));
    const top = Math.max(margin.top,
      Math.min(this._cellRect.top - maxRect.top, maxRect.height - margin.bottom - height));

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
        'max-height': maxHeight + 'px',
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

// Get the bounding rect of elem excluding borders. This allows the editor to match cellElem more
// closely which is more visible in case of DetailView.
function rectWithoutBorders(elem: Element): IRect {
  const rect = elem.getBoundingClientRect();
  const style = getComputedStyle(elem, null);
  const bTop = parseFloat(style.getPropertyValue('border-top-width'));
  const bRight = parseFloat(style.getPropertyValue('border-right-width'));
  const bBottom = parseFloat(style.getPropertyValue('border-bottom-width'));
  const bLeft = parseFloat(style.getPropertyValue('border-left-width'));
  return {
    width: rect.width - bLeft - bRight,
    height: rect.height - bTop - bBottom,
    top: rect.top + bTop,
    bottom: rect.bottom - bBottom,
    left: rect.left + bLeft,
    right: rect.right - bRight,
  };
}
