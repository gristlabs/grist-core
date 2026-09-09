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

/**
 * Calls the callback once elem is in the document, or straight away if it already is.
 *
 * An element is built before its caller inserts it, and focus() does nothing to a detached one,
 * so taking the focus has to wait. A timer is the wrong thing to wait on: its callback runs only
 * between tasks, so a busy main thread holds it off however short the delay. This runs on the
 * insertion itself, at the end of the task that does it, which nothing can push back.
 */
export function onceAttached(elem: Element, callback: () => void): void {
  if (elem.isConnected) {
    callback();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!elem.isConnected) { return; }
    observer.disconnect();
    callback();
  });
  observer.observe(document, { childList: true, subtree: true });
  dom.onDisposeElem(elem, () => observer.disconnect());
}

export function autoFocus() {
  return (el: HTMLElement) => onceAttached(el, () => el.focus());
}

export function autoSelect() {
  return (el: HTMLElement) => onceAttached(el, () => (el as any).select?.());
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

/**
 * Whether a mouse event landed on a link.
 *
 * The event's own target is not enough for a double click. A double click made of two clicks on
 * different elements is dispatched on the closest ancestor the two share, so selecting a cell and
 * then clicking the link icon inside it reports the cell, not the link. What is under the pointer
 * is the second click's element either way.
 */
export function isEventOnLink(event: Event): boolean {
  if ((event.target as HTMLElement | null)?.closest("a")) { return true; }
  const { clientX, clientY } = event as MouseEvent;
  return Boolean(document.elementFromPoint(clientX, clientY)?.closest("a"));
}
