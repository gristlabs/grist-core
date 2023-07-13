import {dom, Holder, IDisposable, MultiHolder} from 'grainjs';

/**
 * Overrides the cursor style for the entire document.
 * @returns {Disposable} - a Disposable that restores the cursor style to its original value.
 */
export function documentCursor(type: 'ns-resize' | 'grabbing'): IDisposable {
  const cursorStyle: HTMLStyleElement = document.createElement('style');
  cursorStyle.innerHTML = `*{cursor: ${type}!important;}`;
  cursorStyle.id = 'cursor-style';
  document.head.appendChild(cursorStyle);
  const cursorOwner = {
    dispose() {
      if (this.isDisposed()) { return; }
      document.head.removeChild(cursorStyle);
    },
    isDisposed() {
      return !cursorStyle.isConnected;
    }
  };
  return cursorOwner;
}


/**
 * Helper function to create a movable element.
 * @param options Handlers for the movable element.
 */
export function movable<T>(options: {
  onMove: (dx: number, dy: number, state: T) => void,
  onStart: () => T,
  onEnd?: () => void,
}) {
  return (el: HTMLElement) => {
    // Remember the initial position of the mouse.
    let startX = 0;
    let startY = 0;
    dom.onElem(el, 'mousedown', (md) => {
      // Only handle left mouse button.
      if (md.button !== 0) { return; }
      startX = md.clientX;
      startY = md.clientY;
      const state = options.onStart();

      // We create a holder first so that we can dispose elements earlier on mouseup, and have a fallback
      // in case of a situation when the dom is removed before mouseup.
      const holder = new Holder();
      const owner = MultiHolder.create(holder);
      dom.autoDisposeElem(el, holder);

      owner.autoDispose(dom.onElem(document, 'mousemove', (mv) => {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        options.onMove(dx, dy, state);
      }));
      owner.autoDispose(dom.onElem(document, 'mouseup', () => {
        options.onEnd?.();
        holder.clear();
      }));
      owner.autoDispose(documentCursor('ns-resize'));
      md.stopPropagation();
      md.preventDefault();
    }, { useCapture: true });
  };
}
