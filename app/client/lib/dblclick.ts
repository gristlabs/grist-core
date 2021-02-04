import {dom, EventCB} from 'grainjs';

const DOUBLE_TAP_INTERVAL_MS = 500;

/**
 * Helper to handle 'dblclick' events on either browser or mobile.
 *
 * This is equivalent to a 'dblclick' handler when touch events are not supported. When they are,
 * the callback will be called on second touch within a short time of a first one. (In that case,
 * preventDefault() prevents a 'dblclick' event from being emulated.)
 *
 * Background: though mobile browsers we care about already generate 'click' and 'dblclick' events
 * in response to touch events, it doesn't seem to be treated as a direct user interaction. E.g.
 * double-click to edit a cell should focus the editor and open the mobile keyboard, but a
 * JS-issued focus() call only works when triggered by a direct user interaction, and synthesized
 * dblclick doesn't seem to do that.
 *
 * Helpful links on emulated (synthesized) events:
 * - https://developer.mozilla.org/en-US/docs/Web/API/Touch_events/Supporting_both_TouchEvent_and_MouseEvent
 * - https://github.com/w3c/pointerevents/issues/171
 */
export function onDblClickMatchElem(elem: EventTarget, selector: string, callback: EventCB): void {
  dom.onMatchElem(elem, selector, 'dblclick', (ev, _elem) => {
    callback(ev, _elem);
  });

  let lastTapTime = 0;
  dom.onMatchElem(elem, selector, 'touchend', (ev, _elem) => {
    const currentTime = Date.now();
    const tapLength = currentTime - lastTapTime;
    lastTapTime = currentTime;
    if (tapLength < DOUBLE_TAP_INTERVAL_MS && tapLength > 0) {
      ev.preventDefault();
      callback(ev, _elem);
    }
  });
}
