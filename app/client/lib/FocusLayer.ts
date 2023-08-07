/**
 * FocusLayer addresses the issue of where focus goes "by default". In most of Grist operation,
 * the focus is on the special Clipboard element to support typing into cells, and copy-pasting.
 * When a modal is open, the focus is on the modal.
 *
 * When the focus moves to some specific element such as a textbox or a dropdown menu, the
 * FocusLayerManager will watch for this element to lose focus or to get disposed, and will
 * restore focus to the default element.
 */
import * as Mousetrap from 'app/client/lib/Mousetrap';
import {arrayRemove} from 'app/common/gutil';
import {RefCountMap} from 'app/common/RefCountMap';
import {Disposable, dom, DomMethod} from 'grainjs';

/**
 * The default focus is organized into layers. A layer determines when focus should move to the
 * default element, and what that element should be. Only the top (most recently created) layer is
 * active at any given time.
 */
export interface FocusLayerOptions {
  // The default element that should have focus while this layer is active.
  defaultFocusElem: HTMLElement;

  // When true for an element, that element may hold focus even while this layer is active.
  // Defaults to any element except document.body.
  allowFocus?: (elem: Element) => boolean;

  // If set, pause mousetrap keyboard shortcuts while this FocusLayer is active. Without it, arrow
  // keys will navigate in a grid underneath this layer, and Enter may open a cell there.
  pauseMousetrap?: boolean;

  // Called when the defaultFocusElem gets focused.
  onDefaultFocus?: () => void;

  // Called when the defaultFocusElem gets blurred.
  onDefaultBlur?: () => void;
}

// Use RefCountMap to have a reference-counted instance of the global FocusLayerManager. It will
// be active as long as at least one FocusLayer is active (i.e. not disposed).
const _focusLayerManager = new RefCountMap<null, FocusLayerManager>({
  create: (key) => FocusLayerManager.create(null),
  dispose: (key, value) => value.dispose(),
  gracePeriodMs: 10,
});

/**
 * The FocusLayerManager implements the functionality, using the top (most recently created) layer
 * to determine when and to what to move focus.
 */
class FocusLayerManager extends Disposable {
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _focusLayers: FocusLayer[] = [];

  constructor() {
    super();

    const grabFocus = this.grabFocus.bind(this);

    this.autoDispose(dom.onElem(window, 'focus', grabFocus));
    this.grabFocus();

    // The following block of code deals with what happens when the window is in the background.
    // When it is, focus and blur events are unreliable, and we'll watch explicitly for events which
    // may cause a change in focus. These wouldn't happen normally for a background window, but do
    // happen in Selenium Webdriver testing.
    function setBackgroundCapture(onOff: boolean) {
      const addRemove = onOff ? window.addEventListener : window.removeEventListener;
      // Note the third argument useCapture=true, which lets us notice these events before other
      // code that might call .stopPropagation on them.
      addRemove.call(window, 'click', grabFocus, true);
      addRemove.call(window, 'mousedown', grabFocus, true);
      addRemove.call(window, 'keydown', grabFocus, true);
    }
    this.autoDispose(dom.onElem(window, 'blur', setBackgroundCapture.bind(null, true)));
    this.autoDispose(dom.onElem(window, 'focus', setBackgroundCapture.bind(null, false)));
    setBackgroundCapture(!document.hasFocus());
  }

  public addLayer(layer: FocusLayer) {
    this.getCurrentLayer()?.onDefaultBlur();
    this._focusLayers.push(layer);
    // Move the focus to the new layer. Not just grabFocus, because if the focus is on the previous
    // layer's defaultFocusElem, the new layer might consider it "allowed" and never get the focus.
    setTimeout(() => layer.defaultFocusElem.focus({preventScroll: true}), 0);
  }

  public removeLayer(layer: FocusLayer) {
    arrayRemove(this._focusLayers, layer);
    // Give the remaining layers a chance to check focus.
    this.grabFocus();
  }

  public getCurrentLayer(): FocusLayer|undefined {
    return this._focusLayers[this._focusLayers.length - 1];
  }

  /**
   * Select the default focus element, or wait until the current element loses focus.
   */
  public grabFocus() {
    if (!this._timeoutId) {
      this._timeoutId = setTimeout(() => this._doGrabFocus(), 0);
    }
  }

  private _doGrabFocus() {
    if (this.isDisposed()) { return; }
    this._timeoutId = null;
    const layer = this.getCurrentLayer();
    if (!layer || document.activeElement === layer.defaultFocusElem) {
      layer?.onDefaultFocus();
      return;
    }
    // If the window doesn't have focus, don't rush to grab it, or we can interfere with focus
    // outside the frame when embedded. We'll grab focus when setBackgroundCapture tells us to.
    if (!document.hasFocus()) {
      return;
    }
    if (document.activeElement && layer.allowFocus(document.activeElement)) {
      watchElementForBlur(document.activeElement, () => this.grabFocus());
      layer.onDefaultBlur();
    } else {
      layer.defaultFocusElem.focus({preventScroll: true});
      layer.onDefaultFocus();
    }
  }
}

/**
 * An individual FocusLayer determines where focus should default to while this layer is active.
 */
export class FocusLayer extends Disposable implements FocusLayerOptions {
  // FocusLayer.grabFocus() allows triggering the focus check manually.
  public static grabFocus() {
    _focusLayerManager.get(null)?.grabFocus();
  }

  /**
   * Creates a new FocusLayer and attaches it to the given element. The layer will be disposed
   * automatically when the element is removed from the DOM.
   */
  public static attach(options: Partial<FocusLayerOptions>): DomMethod<HTMLElement> {
    return (element: HTMLElement) => {
      const layer = FocusLayer.create(null, {defaultFocusElem: element, ...options});
      dom.autoDisposeElem(element, layer);
    };
  }

  public defaultFocusElem: HTMLElement;
  public allowFocus: (elem: Element) => boolean;
  public _onDefaultFocus?: () => void;
  public _onDefaultBlur?: () => void;
  private _isDefaultFocused: boolean|null = null;

  constructor(options: FocusLayerOptions) {
    super();
    this.defaultFocusElem = options.defaultFocusElem;
    this.allowFocus = options.allowFocus || (elem => elem !== document.body);
    this._onDefaultFocus = options.onDefaultFocus;
    this._onDefaultBlur = options.onDefaultBlur;

    // Make sure the element has a tabIndex attribute, to make it focusable.
    if (!this.defaultFocusElem.hasAttribute('tabindex')) {
      this.defaultFocusElem.setAttribute('tabindex', '-1');
    }

    if (options.pauseMousetrap) {
      Mousetrap.setPaused(true);
      this.onDispose(() => Mousetrap.setPaused(false));
    }

    const managerRefCount = this.autoDispose(_focusLayerManager.use(null));
    const manager = managerRefCount.get();
    manager.addLayer(this);
    this.onDispose(() => manager.removeLayer(this));
    this.autoDispose(dom.onElem(this.defaultFocusElem, 'blur', () => manager.grabFocus()));
  }

  public onDefaultFocus() {
    // Only trigger onDefaultFocus() callback when the focus status actually changed.
    if (this._isDefaultFocused) { return; }
    this._isDefaultFocused = true;
    this._onDefaultFocus?.();
  }

  public onDefaultBlur() {
    // Only trigger onDefaultBlur() callback when the focus status actually changed.
    if (this._isDefaultFocused === false) { return; }
    this._isDefaultFocused = false;
    this._onDefaultBlur?.();
  }
}

/**
 * Helper to watch a focused element to lose focus, at which point callback() will get called.
 * Because elements getting removed from the DOM don't always trigger 'blur' event, this also
 * uses MutationObserver to watch for the element to get removed from DOM.
 */
export function watchElementForBlur(elem: Element, callback: () => void) {
  const maybeDone = () => {
    if (document.activeElement !== elem) {
      lis.dispose();
      observer.disconnect();
      callback();
    }
  };
  const lis = dom.onElem(elem, 'blur', maybeDone);

  // Watch for the removal of elem by observing the childList of all its ancestors.
  // (Just guessing that it is more efficient than watching document.body with {subtree: true}).
  const observer = new MutationObserver(maybeDone);
  let parent = elem.parentNode;
  while (parent) {
    observer.observe(parent, {childList: true});
    parent = parent.parentNode;
  }
}
