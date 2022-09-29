/**
 * Small utility to help with processing mouse-drag events. Usage is:
 *    dom('div', mouseDrag((startEvent, elem) => ({
 *      onMove(moveEvent) { ... },
 *      onStop(stopEvent) { ... },
 *    })));
 *
 * The passed-in callback is called on 'mousedown' events. It may return null to ignore the event.
 * Otherwise, it should return a handler for mousemove/mouseup: we will then subscribe to these
 * events, and clean up on mouseup.
 */
import {dom, DomElementMethod, IDisposable} from "grainjs";


export interface MouseDragHandler {
  onMove(moveEv: MouseEvent): void;
  onStop(endEv: MouseEvent): void;
}

export type MouseDragStart = (startEv: MouseEvent, elem: HTMLElement) => MouseDragHandler|null;

export function mouseDragElem(elem: HTMLElement, onStart: MouseDragStart): IDisposable {

  // This prevents the default text-drag behavior when elem is part of a text selection.
  elem.style.userSelect = 'none';

  return dom.onElem(elem, 'mousedown', (ev, el) => _startDragging(ev, el, onStart));
}
export function mouseDrag(onStart: MouseDragStart): DomElementMethod {
  return (elem) => { mouseDragElem(elem, onStart); };
}

// Same as mouseDragElem, but listens for mousedown on descendants of elem that match selector.
export function mouseDragMatchElem(elem: HTMLElement, selector: string, onStart: MouseDragStart): IDisposable {
  return dom.onMatchElem(elem, selector, 'mousedown',
    (ev, el) => _startDragging(ev as MouseEvent, el as HTMLElement, onStart));
}

function _startDragging(startEv: MouseEvent, elem: HTMLElement, onStart: MouseDragStart) {
  const dragHandler = onStart(startEv, elem);
  if (dragHandler) {

    const {onMove, onStop} = dragHandler;
    const upLis = dom.onElem(document, 'mouseup', stop, {useCapture: true});
    const moveLis = dom.onElem(document, 'mousemove', onMove, {useCapture: true});

    function stop(stopEv: MouseEvent) {
      moveLis.dispose();
      upLis.dispose();
      onStop(stopEv);
    }
  }
}
