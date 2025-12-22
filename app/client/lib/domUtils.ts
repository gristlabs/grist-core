import { useBindable } from "app/common/gutil";

import { BindableValue, Computed, dom, EventCB, IDisposable, IDisposableOwner, Observable, UseCB } from "grainjs";

/**
 * Version of makeTestId that can be appended conditionally.
 */
export function makeTestId(prefix: string) {
  return (id: BindableValue<string>, obs?: BindableValue<boolean>) => {
    return dom.cls((use) => {
      if (obs !== undefined && !useBindable(use, obs)) {
        return "";
      }
      return `${useBindable(use, prefix)}${useBindable(use, id)}`;
    });
  };
}

export function autoFocus() {
  return (el: HTMLElement) => void setTimeout(() => el.focus(), 10);
}

export function autoSelect() {
  return (el: HTMLElement) => void setTimeout(() => (el as any).select?.(), 10);
}

/**
 * Async computed version of Computed.
 */
export const AsyncComputed = {
  create<T>(owner: IDisposableOwner, cb: (use: UseCB) => Promise<T>): AsyncComputed<T> {
    const backend: Observable<T | undefined> = Observable.create(owner, undefined);
    const dirty = Observable.create(owner, true);
    const computed: Computed<Promise<T>> = Computed.create(owner, cb as any);
    let ticket = 0;
    const listener = (prom: Promise<T>): void => {
      dirty.set(true);
      const myTicket = ++ticket;
      prom.then((v) => {
        if (ticket !== myTicket) { return; }
        if (backend.isDisposed()) { return; }
        dirty.set(false);
        backend.set(v);
      }).catch(reportError);
    };
    owner?.autoDispose(computed.addListener(listener));
    listener(computed.get());
    return Object.assign(backend, {
      dirty,
    });
  },
};
export interface AsyncComputed<T> extends Observable<T | undefined> {
  /**
   * Whether computed wasn't updated yet.
   */
  dirty: Observable<boolean>;
}

/**
 * Stops propagation of the event, and prevents default action.
 */
export function stopEvent(ev: Event) {
  ev.stopPropagation();
  ev.preventDefault();
  ev.stopImmediatePropagation();
}

/**
 * Adds a handler for a custom event triggered by `domDispatch` function below.
 */
export function domOnCustom(name: string, handler: (args: any, event: Event, element: Element) => void) {
  return (el: Element) => {
    dom.onElem(el, name, (ev, target) => {
      const cv = ev as CustomEvent;
      handler(cv.detail, ev, target);
    });
  };
}

/**
 * Triggers a custom event on an element.
 */
export function domDispatch(element: Element, name: string, args?: any) {
  element.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail: args,
  }));
}

/**
 * Helper function to bind a click handler that will be called when the user clicks outside.
 * NOTE: There is a similar mechanism available in GristDoc/App, which should be used when a
 * component is tightly integrated with the one of the basic views.
 * ```
 * gristDoc.app.on('clipboard_focus', handler);
 * ```
 */
export function onClickOutside(click: () => void) {
  return (content: HTMLElement) => {
    dom.autoDisposeElem(content, onClickOutsideElem(content, click));
  };
}

/**
 * Helper function to bind a click handler that will be called when the user clicks outside.
 * NOTE: There is a similar mechanism available in GristDoc/App, which should be used when a
 * component is tightly integrated with the one of the basic views.
 * ```
 * gristDoc.app.on('clipboard_focus', handler);
 * ```
 */
export function onClickOutsideElem(elem: Node, click: () => void) {
  const onClick = (evt: MouseEvent) => {
    const target: Node | null = evt.target as Node;
    if (target && !elem.contains(target)) {
      // Check if any parent of target has class grist-floating-menu, if so, don't close.
      if (target.parentElement?.closest(".grist-floating-menu")) {
        return;
      }
      click();
    }
  };
  return dom.onElem(document, "click", onClick, { useCapture: true });
}

/**
 * Helper function which returns the direct child of ancestor which is an ancestor of elem, or
 * null if elem is not a descendant of ancestor.
 */
export function findAncestorChild(ancestor: Element, elem: Element | null): Element | null {
  while (elem && elem.parentElement !== ancestor) {
    elem = elem.parentElement;
  }
  return elem;
}

/**
 * A version of dom.onElem('mouseover') that doesn't start firing until there is first a 'mousemove'.
 * This way if an element is created under the mouse cursor (triggered by the keyboard, for
 * instance) it's not immediately highlighted, but only when a user moves the mouse.
 * Returns an object with a reset() method, which restarts the wait for mousemove.
 */
export function attachMouseOverOnMove<T extends EventTarget>(elem: T, callback: EventCB<MouseEvent, T>) {
  let lis: IDisposable | undefined;
  function setListener(eventType: "mouseover" | "mousemove", cb: EventCB<MouseEvent, T>) {
    if (lis) { lis.dispose(); }
    lis = dom.onElem(elem, eventType, cb);
  }
  function reset() {
    setListener("mousemove", (ev, _elem) => {
      setListener("mouseover", callback);
      callback(ev, _elem);
    });
  }
  reset();
  return { reset };
}
