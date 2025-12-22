import { parseFirstUrlPart } from "app/common/gristUrls";
import { addOrgToPath } from "app/common/urlUtils";

export interface URLOptions {
  /**
   * The base component of the URL.
   *
   * If an org is present in the path, it will be included in the path of
   * the constructed URL.
   *
   * Defaults to `window.location.href`.
   */
  base?: string;
  /**
   * The hash component of the URL.
   *
   * If not set, the hash from {@link URLOptions.base} will be included
   * in the constructed URL. A value of `null` or `""` may be set to
   * ensure the constructed URL does not include a hash.
   */
  hash?: string | null;
  /**
   * Params to include in the query string component of the URL.
   *
   * If not set, the query string from {@link URLOptions.base} will be
   * included in the constructed URL. A value of `null` may be set to
   * ensure the constructed URL does not include a query string.
   */
  searchParams?: URLSearchParams | null;
}

/**
 * Returns a URL to the given `path`.
 *
 * If {@link URLOptions.base} is not specified, the constructed URL will be
 * relative to the window location.
 *
 * Path accepts values with or without a leading "/". If {@link URLOptions.base}
 * includes an org in the path, it will be included in the constructed URL.
 *
 * Note: You should use `urlState` in `gristUrlState.ts` when constructing URLs
 * that should avoid reloading the page when not necessary. The URLs returned by
 * this function are only intended to be used in contexts involving a page reload
 * (e.g. login pages).
 */
export function buildURL(path: string, options: URLOptions = {}): URL {
  const { base = window.location.href, hash, searchParams } = options;
  const url = new URL(base);
  url.pathname = addOrgToPath('', base, true) + '/' + path.replace(/^\//, '');
  if (hash !== undefined) {
    url.hash = hash ?? '';
  }
  if (searchParams !== undefined) {
    url.search = searchParams?.toString() ?? '';
  }
  return url;
}

export interface GetLoginOrSignupUrlOptions {
  srcDocId?: string | null;
  /** Defaults to the current URL. */
  nextUrl?: string | null;
}

// Get URL for the login page.
export function getLoginUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return getLoginPageUrl('login', options);
}

// Get URL for the signup page.
export function getSignupUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return getLoginPageUrl('signup', options);
}

// Get URL for the logout page.
export function getLogoutUrl(): string {
  return getLoginPageUrl('logout');
}

// Get the URL that users are redirect to after deleting their account.
export function getAccountDeletedUrl(): string {
  return getLoginPageUrl('account-deleted', { nextUrl: '' });
}

// Get URL for the signin page.
export function getLoginOrSignupUrl(options: GetLoginOrSignupUrlOptions = {}): string {
  return getLoginPageUrl('signin', options);
}

export function getWelcomeHomeUrl() {
  const url = buildURL('/welcome/home', {
    hash: null,
    searchParams: null,
  });
  return url.href;
}

const FINAL_PATHS = ['/signed-out', '/account-deleted'];

// Returns the relative URL (i.e. path) of the current page, except when it's the
// "/signed-out" page or "/account-deleted", in which case it returns the home page ("/").
// This is a good URL to use for a post-login redirect.
function _getCurrentUrl(): string {
  const { hash, pathname, search } = new URL(window.location.href);
  if (FINAL_PATHS.some(final => pathname.endsWith(final))) { return '/'; }

  return parseFirstUrlPart('o', pathname).path + search + hash;
}

// Returns the URL for the given login page.
function getLoginPageUrl(
  page: 'login' | 'logout' | 'signin' | 'signup' | 'account-deleted',
  options: GetLoginOrSignupUrlOptions = {},
): string {
  const { srcDocId, nextUrl = _getCurrentUrl() } = options;
  const startUrl = buildURL(`/${page}`, {
    hash: null,
    searchParams: null,
  });
  if (srcDocId) { startUrl.searchParams.set('srcDocId', srcDocId); }
  if (nextUrl) { startUrl.searchParams.set('next', nextUrl); }
  return startUrl.href;
}
