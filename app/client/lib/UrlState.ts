/**
 * Generic support of observable state represented by the current page's URL. The state is
 * initialized on first use, and updated on navigation events, such as Back/Forward button clicks,
 * and on calls to pushUrl().
 *
 * Application-specific module should instantiate UrlState with the desired way to encode state in
 * URLs. Other code may then use the UrlState object exposed by that app-specific module.
 *
 * UrlState also provides functions to navigate: makeUrl(), pushUrl(), and setLinkUrl(). The
 * preferred option is to use actual <a> links for navigation, creating them like so:
 *
 *    import {urlState} from '...appUrlState';
 *    dom('a', urlState().setLinkUrl({org: 'foo'}))
 *    dom('a', urlState().setLinkUrl({docPage: pageId}))
 *
 * These will set actual hrefs (e.g. allowing links to be opened in a new tab), and also will
 * intercept clicks and update history (using pushUrl()) without reloading the page.
 */
import * as log from 'app/client/lib/log';
import {BaseObservable, Disposable, dom, DomElementMethod, observable} from 'grainjs';

export interface UrlStateSpec<IUrlState> {
  encodeUrl(state: IUrlState, baseLocation: Location | URL): string;
  decodeUrl(location: Location | URL): IUrlState;
  updateState(prevState: IUrlState, newState: IUrlState): IUrlState;

  // If present, the return value is checked by pushUrl() to decide if we can stay on the page or
  // need to load the new URL. The new URL is always loaded if origin changes.
  needPageLoad(prevState: IUrlState, newState: IUrlState): boolean;

  // Give the implementation a chance to complete outstanding work, e.g. if there is unsaved
  // data in the page state that would get destroyed.
  delayPushUrl(prevState: IUrlState, newState: IUrlState): Promise<void>;
}

export type UpdateFunc<IUrlState> = (prevState: IUrlState) => IUrlState;

/**
 * Represents the state of a page in browser history, as encoded in window.location URL.
 */
export class UrlState<IUrlState extends object> extends Disposable {
  // Current state. This gets initialized in the constructor, and updated on navigation events.
  public state = observable<IUrlState>(this._getState());

  constructor(private _window: HistWindow, private _stateImpl: UrlStateSpec<IUrlState>) {
    super();

    // Create a hook for navigation. It's exposed on the window for overriding in tests.
    if (!_window._urlStateLoadPage) {
      _window._urlStateLoadPage = (href) => { _window.location.href = href; };
    }

    // On navigation events, update our current state, including the observables.
    this.autoDispose(dom.onElem(this._window, 'popstate', (ev) => this.loadState()));
  }

  /**
   * Creates a new history entry (navigable with Back/Forward buttons), encoding the given state
   * in the URL. This is similar to navigating to a new URL, but does not reload the page.
   */
  public async pushUrl(urlState: IUrlState|UpdateFunc<IUrlState>,
                       options: {replace?: boolean, avoidReload?: boolean} = {}) {
    const prevState = this.state.get();
    const newState = this._mergeState(prevState, urlState);

    const newUrl = this._stateImpl.encodeUrl(newState, this._window.location);

    // Don't create a new history entry if nothing changed as it would only be annoying.
    if (newUrl === this._window.location.href) { return; }

    const oldOrigin = this._window.location.origin;
    const newOrigin = new URL(newUrl).origin;

    // We can only pushState() without reloading the page if going to a same-origin URL.
    const samePage = (oldOrigin === newOrigin &&
      (options.avoidReload || !this._stateImpl.needPageLoad(prevState, newState)));

    if (samePage) {
      await this._stateImpl.delayPushUrl(prevState, newState);
      try {
        if (options.replace) {
          this._window.history.replaceState(null, '', newUrl);
        } else {
          this._window.history.pushState(null, '', newUrl);
        }
        // pushState/replaceState above do not trigger 'popstate' event, so we call loadState() manually.
        this.loadState();
      } catch (e) {
        // If we fail, we may be in a context where Grist doesn't have
        // control over history, e.g. an iframe with srcdoc. Go ahead
        // and apply the application state change (e.g. switching to a
        // different Grist page). The back button won't work, but what
        // it should do in an embedded context is full of nuance anyway.
        log.debug(`pushUrl failure: ${e}`);
        this.state.set(this._stateImpl.decodeUrl(new URL(newUrl)));
      }
    } else {
      this._window._urlStateLoadPage!(newUrl);
    }
  }

  /**
   * Creates a URL (e.g. to use in a link's href) encoding the given state. The `use` argument
   * allows for this to be used in a computed, and is used by setLinkUrl() and setHref().
   *
   * If urlState is an object (such as IGristUrlState), it gets merged with previous state
   * according to rules (in gristUrlState's updateState). Alternatively, it can be a function that
   * takes previous state and returns the new one (without mutating the previous state).
   */
  public makeUrl(urlState: IUrlState|UpdateFunc<IUrlState>, use: UseCB = unwrap): string {
    const fullState = this._mergeState(use(this.state), urlState);
    return this._stateImpl.encodeUrl(fullState, this._window.location);
  }

  /**
   * Sets href on a dom element, e.g. dom('a', setHref({...})).
   * This is similar to {href: makeUrl(urlState)}, but the destination URL will reflect the
   * current url state (e.g. due to switching pages).
   */
  public setHref(urlState: IUrlState|UpdateFunc<IUrlState>): DomElementMethod {
    return dom.attr('href', (use) => this.makeUrl(urlState, use));
  }

  /**
   * Applies to an <a> element to create a smart link, e.g. dom('a', setLinkUrl({ws: wsId})). It
   * both sets the href (e.g. to allow the link to be opened to a new tab), AND intercepts plain
   * clicks on it to "follow" the link without reloading the page.
   */
  public setLinkUrl(urlState: IUrlState|UpdateFunc<IUrlState>): DomElementMethod[] {
    return [
      dom.attr('href', (use) => this.makeUrl(urlState, use)),
      dom.on('click', (ev) => {
        // Only override plain-vanilla clicks.
        if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }
        ev.preventDefault();
        return this.pushUrl(urlState);
      }),
    ];
  }

  /**
   * Reset the state from the current URL. This shouldn't normally need to get called. It's called
   * automatically when needed. It's also used by tests.
   */
  public loadState() {
    log.debug(`loadState ${this._window.location.href}`);
    this.state.set(this._getState());
  }

  private _getState(): IUrlState {
    return this._stateImpl.decodeUrl(this._window.location);
  }

  private _mergeState(prevState: IUrlState, newState: IUrlState|UpdateFunc<IUrlState>): IUrlState {
    return (typeof newState === 'object') ?
      this._stateImpl.updateState(prevState, newState) :
      newState(prevState);
  }
}

// This is what we expect from the global Window object. Tests may override with a mock.
export interface HistWindow extends EventTarget {
  history: History;
  location: Location;

  // This is a hook we create, to allow stubbing or overriding in tests.
  _urlStateLoadPage?: (href: string) => void;
}

// The type of a 'use' callback as used in a computed(). It's what makes a computed subscribe to
// its dependencies. The unwrap() helper allows using a dependency without any subscribing.
type UseCB = <T>(obs: BaseObservable<T>) => T;
const unwrap: UseCB = (obs) => obs.get();
