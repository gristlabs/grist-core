import { inlineSign, isRtl } from "app/client/lib/direction";
import { reportError } from "app/client/models/errors";
import * as modelUtil from "app/client/models/modelUtil";
import { mouseDrag } from "app/client/ui/mouseDrag";

import { dom, DomElementMethod } from "grainjs";

export interface IColumnResizerOptions {
  // Whether .save() on widthObservable should be called when resizing stops. Defaults to true.
  shouldSave?: boolean;
  // The minimum width the column can be resized to. Defaults to 10.
  minWidth?: number;
}

const DEFAULT_MIN_WIDTH = 10;

/**
 * Attaches a drag handle to the end edge of a column header, so that dragging it resizes the
 * column. The width is written into widthObservable while dragging; if the observable has a
 * .save() method, it is called when the drag ends.
 *
 * The handle sits on the inline-end edge (right in LTR, left in RTL) and the drag direction
 * follows the header's computed direction, so the same code serves both orientations.
 */
export function columnResizer(
  widthObservable: modelUtil.KoSaveableObservable<number>,
  options: IColumnResizerOptions = {},
): DomElementMethod {
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
  return (header) => {
    header.appendChild(dom("div.column_resize_handle.ui-resizable-handle",
      mouseDrag((startEv, handle) => {
        startEv.preventDefault();
        startEv.stopPropagation();
        const sign = inlineSign(isRtl(header));
        const startWidth = header.getBoundingClientRect().width;
        const startBodyCursor = document.body.style.cursor;
        document.body.style.cursor = getComputedStyle(handle).cursor;
        header.classList.add("column_resize_active");
        const widthAt = (ev: MouseEvent) =>
          Math.max(minWidth, Math.round(startWidth + sign * (ev.pageX - startEv.pageX)));
        return {
          onMove(ev) { widthObservable(widthAt(ev)); },
          onStop(ev) {
            document.body.style.cursor = startBodyCursor;
            header.classList.remove("column_resize_active");
            widthObservable(widthAt(ev));
            if (options.shouldSave !== false) { widthObservable.save?.().catch(reportError); }
          },
        };
      }),
    ));
  };
}
