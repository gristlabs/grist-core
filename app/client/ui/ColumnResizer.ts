/**
 * Reusable column-resize logic for table-based grid views.
 * Builds on the mouseDrag utility to encapsulate the start/move/stop lifecycle
 * for dragging a column edge to change its width.
 *
 * Usage (as a grainjs dom directive on a resize handle element):
 *
 *    import { columnResizeDrag } from "app/client/ui/ColumnResizer";
 *
 *    cssResizeHandle(
 *      columnResizeDrag({
 *        getWidth: () => currentWidths[colIndex],
 *        setWidth: (w) => updateColWidth(colIndex, w),
 *        minWidth: 30,
 *      }),
 *    )
 */
import { mouseDrag, MouseDragHandler } from "app/client/ui/mouseDrag";

import { DomElementMethod } from "grainjs";

export interface ColumnResizeOptions {
  /** Minimum allowed width (defaults to 30). */
  minWidth?: number;
  /** Returns the current column width in pixels. */
  getWidth(): number;
  /** Called during drag and on stop with the new width. */
  setWidth(width: number): void;
  /** Called once when the drag finishes with the final width. */
  onSave?(width: number): void;
}

/**
 * Returns a DomElementMethod that attaches column-resize drag handling to the element.
 * The element should be positioned as the drag handle (e.g. right edge of a column header).
 */
export function columnResizeDrag(options: ColumnResizeOptions): DomElementMethod {
  const minWidth = options.minWidth ?? 30;

  return mouseDrag((startEv: MouseEvent, _elem: HTMLElement): MouseDragHandler | null => {
    if (startEv.button !== 0) { return null; }
    startEv.preventDefault();
    startEv.stopPropagation();

    const startX = startEv.clientX;
    const startWidth = options.getWidth();

    const startBodyCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";

    return {
      onMove(moveEv: MouseEvent) {
        const delta = moveEv.clientX - startX;
        const newWidth = Math.max(minWidth, startWidth + delta);
        options.setWidth(newWidth);
      },
      onStop(stopEv: MouseEvent) {
        document.body.style.cursor = startBodyCursor;
        const delta = stopEv.clientX - startX;
        const finalWidth = Math.max(minWidth, startWidth + delta);
        options.setWidth(finalWidth);
        options.onSave?.(finalWidth);
      },
    };
  });
}
