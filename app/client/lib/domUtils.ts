import {useBindable} from 'app/common/gutil';
import {BindableValue, Computed, dom, IDisposableOwner, Observable, UseCB} from 'grainjs';

/**
 * Version of makeTestId that can be appended conditionally.
 */
export function makeTestId(prefix: string) {
  return (id: BindableValue<string>, obs?: BindableValue<boolean>) => {
    return dom.cls(use => {
      if (obs !== undefined && !useBindable(use, obs)) {
        return '';
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
    const backend: Observable<T|undefined> = Observable.create(owner, undefined);
    const dirty = Observable.create(owner, true);
    const computed: Computed<Promise<T>> = Computed.create(owner, cb as any);
    let ticket = 0;
    const listener = (prom: Promise<T>): void => {
      dirty.set(true);
      const myTicket = ++ticket;
      prom.then(v => {
        if (ticket !== myTicket) { return; }
        if (backend.isDisposed()) { return; }
        dirty.set(false);
        backend.set(v);
      }).catch(reportError);
    };
    owner?.autoDispose(computed.addListener(listener));
    listener(computed.get());
    return Object.assign(backend, {
      dirty
    });
  }
};
export interface AsyncComputed<T> extends Observable<T|undefined> {
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
    detail: args
  }));
}
