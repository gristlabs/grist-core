/**
 * Exports resizeFlexVHandle() for resizing flex items. The returned handle should be attached to
 * a flexbox container next to the item that needs resizing. Usage:
 *
 *    dom('div.flex',
 *      dom('div.child-to-be-resized', ...),
 *      resizeFlexVHandle({target: 'left', onSave: (width) => { ... })
 *      dom('div.other-children', ...),
 *    )
 *
 * The .target parameter determines whether to resize the left or right sibling of the handle. The
 * handle shows up as a 1px line of color --resize-handle-color. On hover and while resizing, it
 * changes to --resize-handle-highlight.
 *
 * The handle may be dragged to change the width of the target. It sets style.width while
 * dragging, and calls .onSave(width) at the end, and optionally .onDrag(width) while dragging.
 *
 * You may limit the width of the target with min-width, max-width properties as usual.
 *
 * At the moment, flexbox width resizing is the only need, but the same approach is intended to be
 * easily extended to non-flexbox situation, and to height-resizing.
 */
import {mouseDrag} from 'app/client/ui/mouseDrag';
import {DomElementArg, styled} from "grainjs";

export type ChangeFunc = (value: number) => void;
export type Edge = 'left' | 'right';

export interface IResizeFlexOptions {
  // Whether to change the width of the flex item to the left or to the right of this handle.
  target: 'left'|'right';
  onDrag?(value: number): void;
  onSave(value: number): void;
}

export interface IResizeOptions {
  prop: 'width' | 'height';
  sign: 1 | -1;
  getTarget(handle: Element): Element|null;
  onDrag?(value: number): void;
  onSave(value: number): void;
}

// See module documentation for usage.
export function resizeFlexVHandle(options: IResizeFlexOptions, ...args: DomElementArg[]): Element {
  const resizeOptions: IResizeOptions = {
    prop: 'width',
    sign: options.target === 'left' ? 1 : -1,
    getTarget(handle: Element) {
      return options.target === 'left' ? handle.previousElementSibling : handle.nextElementSibling;
    },
    onDrag: options.onDrag,
    onSave: options.onSave,
  };
  return cssResizeFlexVHandle(
    mouseDrag((ev, handle) => onResizeStart(ev, handle, resizeOptions)),
    ...args);
}

// The core of the implementation. This is intended to be very general, so as to be adaptable to
// other kinds of resizing (edge of parent, resizing height) by only attaching this to the
// mouseDrag() event with suitable options. See resizeFlexVHandle().
function onResizeStart(startEv: MouseEvent, handle: Element, options: IResizeOptions) {
  const target = options.getTarget(handle) as HTMLElement|null;
  if (!target) { return null; }

  const {sign, prop, onDrag, onSave} = options;
  const startSize = getComputedSize(target, prop);

  // Set the body cursor to that on the handle, so that it doesn't jump to different shapes as
  // the mouse moves temporarily outside of the handle. (Approach from jqueryui-resizable.)
  const startBodyCursor = document.body.style.cursor;
  document.body.style.cursor = window.getComputedStyle(handle).cursor;

  handle.classList.add(cssResizeDragging.className);

  return {
    // While moving, just adjust the size of the target, relying on min-width/max-width for
    // constraints.
    onMove(ev: MouseEvent) {
      target.style[prop] = (startSize + sign * (ev.pageX - startEv.pageX)) + 'px';
      if (onDrag) { onDrag(getComputedSize(target, prop)); }
    },

    // At the end, undo temporary changes, and call onSave() with the actual size.
    onStop(ev: MouseEvent) {
      handle.classList.remove(cssResizeDragging.className);

      // Restore the body cursor to what it was.
      document.body.style.cursor = startBodyCursor;

      target.style[prop] = (startSize + sign * (ev.pageX - startEv.pageX)) + 'px';
      onSave(getComputedSize(target, prop));
    },
  };
}


// Compute the CSS width or height of the element. If element.style[prop] is set to it, it should
// be unchanged. (Note that when an element has borders or padding, the size from
// getBoundingClientRect() would be different, and isn't suitable for style[prop].)
function getComputedSize(elem: Element, prop: 'width'|'height'): number {
  const sizePx = window.getComputedStyle(elem)[prop];
  const sizeNum = sizePx && parseFloat(sizePx);
  // If we can't get the size, fall back to getBoundingClientRect().
  return Number.isFinite(sizeNum as number) ? sizeNum as number : elem.getBoundingClientRect()[prop];
}

const cssResizeFlexVHandle = styled('div', `
  position: relative;
  flex: none;
  top: 0;
  height: 100%;
  cursor: ew-resize;
  z-index: 10;

  /* width with negative margins leaves exactly 1px line in the middle */
  width: 7px;
  margin: auto -3px;

  /* two highlighted 1px lines are placed in the middle, normal and highlighted one */
  &::before, &::after {
    content: "";
    position: absolute;
    height: 100%;
    width: 1px;
    left: 3px;
  }
  &::before {
    background-color: var(--resize-handle-color, lightgrey);
  }
  /* the highlighted line is shown on hover with opacity transition */
  &::after {
    background-color: var(--resize-handle-highlight, black);
    opacity: 0;
    transition: opacity linear 0.2s;
  }
  &:hover::after {
    opacity: 1;
    transition: opacity linear 0.2s 0.2s;
  }
  /* the highlighted line is also always shown while dragging */
  &-dragging::after {
    opacity: 1;
    transition: none !important;
  }
`);

// May be applied to Handle class to show the highlighted line while dragging.
const cssResizeDragging = styled('div', `
  &::after {
    opacity: 1;
    transition: none !important;
  }
`);
