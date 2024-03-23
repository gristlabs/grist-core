/**
 * This module provides a urlState() function returning a singleton UrlState, which represents
 * Grist application state as encoded into a URL, and navigation functions.
 *
 * For example, the current org is available as a value or as an observable:
 *
 *    urlState().state.get().org
 *    computed((use) => use(urlState().state).org);
 *
 * Creating a link which has an href but changes state without reloading page is possible with:
 *
 *    dom('a', urlState().setLinkUrl({ws: 10}), "...")
 *
 * Grist URLs have the form:
 *    <org-base>/
 *    <org-base>/ws/<ws>/
 *    <org-base>/doc/<doc>[/p/<docPage>]
 *
 * where <org-base> depends on whether subdomains are in use, i.e. one of:
 *    <org>.getgrist.com
 *    localhost:8080/o/<org>
 *
 * Note that the form of URLs depends on the settings in window.gristConfig object.
 */
import {unsavedChanges} from 'app/client/components/UnsavedChanges';
import {hooks} from 'app/client/Hooks';
import {UrlState} from 'app/client/lib/UrlState';
import {decodeUrl, encodeUrl, getSlugIfNeeded, GristLoadConfig, IGristUrlState,
        parseFirstUrlPart} from 'app/common/gristUrls';
import {addOrgToPath} from 'app/common/urlUtils';
import {Document} from 'app/common/UserAPI';
import isEmpty = require('lodash/isEmpty');
import isEqual = require('lodash/isEqual');
import {CellValue} from "app/plugin/GristData";

/**
 * Returns a singleton UrlState object, initializing it on first use.
 */
export function urlState(): UrlState<IGristUrlState> {
  return _urlState || (_urlState = new UrlState(window, new UrlStateImpl(window as any)));
}
let _urlState: UrlState<IGristUrlState>|undefined;

/**
 * Returns url parameters appropriate for the specified document.
 *
 * In addition to setting `doc` and `slug`, it sets additional parameters
 * from `params` if any are supplied.
 */
export function docUrl(doc: Document): IGristUrlState {
  const state: IGristUrlState = {
    doc: doc.urlId || doc.id,
    slug: getSlugIfNeeded(doc),
  };

  return state;
}

// Returns the home page for the current org.
export function getMainOrgUrl(): string { return urlState().makeUrl({}); }

// When on a document URL, returns the URL with just the doc ID, omitting other bits (like page).
export function getCurrentDocUrl(): string { return urlState().makeUrl({docPage: undefined}); }

export interface GetLoginOrSignupUrlOptions {
  srcDocId?: string | null;
  /** Defaults to the current URL. */
  nextUrl?: string | null;
}

// Get URL for the login page.
export function getLoginUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return _getLoginLogoutUrl('login', options);
}

// Get URL for the signup page.
export function getSignupUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return _getLoginLogoutUrl('signup', options);
}

// Get URL for the logout page.
export function getLogoutUrl(): string {
  return _getLoginLogoutUrl('logout');
}

// Get the URL that users are redirect to after deleting their account.
export function getAccountDeletedUrl(): string {
  return _getLoginLogoutUrl('account-deleted', {nextUrl: ''});
}

// Get URL for the signin page.
export function getLoginOrSignupUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return _getLoginLogoutUrl('signin', options);
}

export function getWelcomeHomeUrl() {
  return _buildUrl('welcome/home').href;
}

const FINAL_PATHS = ['/signed-out', '/account-deleted'];

// Returns the relative URL (i.e. path) of the current page, except when it's the
// "/signed-out" page or "/account-deleted", in which case it returns the home page ("/").
// This is a good URL to use for a post-login redirect.
function _getCurrentUrl(): string {
  const {hash, pathname, search} = new URL(window.location.href);
  if (FINAL_PATHS.some(final => pathname.endsWith(final))) { return '/'; }

  return parseFirstUrlPart('o', pathname).path + search + hash;
}

// Returns the URL for the given login page.
function _getLoginLogoutUrl(
  page: 'login'|'logout'|'signin'|'signup'|'account-deleted',
  options: GetLoginOrSignupUrlOptions = {}
): string {
  const {srcDocId, nextUrl = _getCurrentUrl()} = options;
  const startUrl = _buildUrl(page);
  if (srcDocId) { startUrl.searchParams.set('srcDocId', srcDocId); }
  if (nextUrl) { startUrl.searchParams.set('next', nextUrl); }
  return startUrl.href;
}

function _buildUrl(page?: string): URL {
  const startUrl = new URL(window.location.href);
  startUrl.pathname = addOrgToPath('', window.location.href, true) + '/' + (page ?? '');
  startUrl.search = '';
  startUrl.hash = '';
  return startUrl;
}

/**
 * Implements the interface expected by UrlState. It is only exported for the sake of tests; the
 * only public interface is the urlState() accessor.
 */
export class UrlStateImpl {
  constructor(private _window: {gristConfig?: Partial<GristLoadConfig>}) {}

  /**
   * The actual serialization of a url state into a URL. The URL has the form
   *    <org-base>/
   *    <org-base>/ws/<ws>/
   *    <org-base>/doc/<doc>[/p/<docPage>]
   *    <org-base>/doc/<doc>[/m/fork][/p/<docPage>]
   *
   * where <org-base> depends on whether subdomains are in use, e.g.
   *    <org>.getgrist.com
   *    localhost:8080/o/<org>
   */
  public encodeUrl(state: IGristUrlState, baseLocation: Location | URL): string {
    const gristConfig = this._window.gristConfig || {};
    return encodeUrl(gristConfig, state, baseLocation, {
      tweaks: hooks.urlTweaks,
    });
  }

  /**
   * Parse a URL location into an IGristUrlState object. See encodeUrl() documentation.
   */
  public decodeUrl(location: Location | URL): IGristUrlState {
    const gristConfig = this._window.gristConfig || {};
    return decodeUrl(gristConfig, location, {
      tweaks: hooks.urlTweaks,
    });
  }

  /**
   * Updates existing state with new state, with attention to Grist-specific meanings.
   * E.g. setting 'docPage' will reuse previous 'doc', but setting 'org' or 'ws' will ignore it.
   */
  public updateState(prevState: IGristUrlState, newState: IGristUrlState): IGristUrlState {
    const keepState = (newState.org || newState.ws || newState.homePage || newState.doc || isEmpty(newState) ||
                       newState.account || newState.billing  || newState.activation || newState.welcome ||
                       newState.adminPanel) ?
      (prevState.org ? {org: prevState.org} : {}) :
      prevState;
    return {...keepState, ...newState};
  }

  /**
   * The account page, billing pages, and doc-specific pages for now require a page load.
   * TODO: Make it so doc pages do NOT require a page load, since we are actually serving the same
   * single-page app for home and for docs, and should only need a reload triggered if it's
   * a matter of DocWorker requiring a different version (e.g. /v/OTHER/doc/...).
   */
  public needPageLoad(prevState: IGristUrlState, newState: IGristUrlState): boolean {
    // If we have an API URL we can't use it to switch the state, so we need a page load.
    if (newState.api || prevState.api) { return true; }

    const gristConfig = this._window.gristConfig || {};
    const orgReload = prevState.org !== newState.org;
    // Reload when moving to/from a document or between doc and non-doc.
    const docReload = prevState.doc !== newState.doc;
    // Reload when moving to/from the account page.
    const accountReload = Boolean(prevState.account) !== Boolean(newState.account);
    // Reload when moving to/from a billing page.
    const billingReload = Boolean(prevState.billing) !== Boolean(newState.billing);
    // Reload when moving to/from an activation page.
    const activationReload = Boolean(prevState.activation) !== Boolean(newState.activation);
    // Reload when moving to/from a welcome page.
    const welcomeReload = Boolean(prevState.welcome) !== Boolean(newState.welcome);
    // Reload when link keys change, which changes what the user can access
    const linkKeysReload = !isEqual(prevState.params?.linkParameters, newState.params?.linkParameters);
    // Reload when moving to/from the Grist sign-up page.
    const signupReload = [prevState.login, newState.login].includes('signup')
      && prevState.login !== newState.login;
    // Reload when moving to/from the support Grist page.
    const adminPanelReload = Boolean(prevState.adminPanel) !== Boolean(newState.adminPanel);
    return Boolean(orgReload || accountReload || billingReload || activationReload ||
      gristConfig.errPage || docReload || welcomeReload || linkKeysReload || signupReload ||
      adminPanelReload);
  }

  /**
   * Complete outstanding work before changes that would destroy page state, e.g. if there are
   * edits to be saved.
   */
  public async delayPushUrl(prevState: IGristUrlState, newState: IGristUrlState): Promise<void> {
    if (newState.docPage !== prevState.docPage) {
      return unsavedChanges.saveChanges();
    }
  }
}

/**
 * Given value like `foo bar baz`, constructs URL by checking if `baz` is a valid URL and,
 * if not, prepending `http://`.
 */
export function constructUrl(value: CellValue): string {
  if (typeof value !== 'string') {
    return '';
  }
  const url = value.slice(value.lastIndexOf(' ') + 1);
  try {
    // Try to construct a valid URL
    return (new URL(url)).toString();
  } catch (e) {
    // Not a valid URL, so try to prefix it with http
    return 'http://' + url;
  }
}

/**
 * If urlValue contains a URL to the current document that can be navigated to without a page reload,
 * returns a parsed IGristUrlState that can be passed to urlState().pushState() to do that navigation.
 * Otherwise, returns null.
 */
export function sameDocumentUrlState(urlValue: CellValue): IGristUrlState | null {
  const urlString = constructUrl(urlValue);
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const oldOrigin = window.location.origin;
  const newOrigin = url.origin;
  if (oldOrigin !== newOrigin) {
    return null;
  }

  const urlStateImpl = new UrlStateImpl(window as any);
  const result = urlStateImpl.decodeUrl(url);
  if (urlStateImpl.needPageLoad(urlState().state.get(), result)) {
    return null;
  } else {
    return result;
  }
}
