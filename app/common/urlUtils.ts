import {extractOrgParts, GristLoadConfig} from 'app/common/gristUrls';

export function getGristConfig(): GristLoadConfig {
  return (window as any).gristConfig || {};
}

/**
 *
 * Adds /o/ORG to the supplied path, with ORG extracted from current URL if possible.
 * If not, path is returned as is, but with any trailing / removed for consistency.
 *
 */
export function addCurrentOrgToPath(path: string, skipIfInDomain: boolean = false) {
  if (typeof window === 'undefined' || !window) { return path; }
  return addOrgToPath(path, window.location.href, skipIfInDomain);
}

/**
 *
 * Adds /o/ORG to the supplied path, with ORG extracted from the page URL if possible.
 * If not, path is returned as is, but with any trailing / removed for consistency.
 *
 */
export function addOrgToPath(path: string, page: string, skipIfInDomain: boolean = false) {
  if (typeof window === 'undefined' || !window) { return path; }
  if (path.includes('/o/')) { return path; }
  const src = new URL(page);
  const srcParts = extractOrgParts(src.host, src.pathname);
  if (srcParts.mismatch) {
    throw new Error('Cannot figure out what organization the URL is for.');
  }
  path = path.replace(/\/$/, '');
  if (!srcParts.subdomain) {
    return path;
  }
  if (skipIfInDomain && srcParts.orgFromHost) {
    return path;
  }
  return `${path}/o/${srcParts.subdomain}`;
}

/**
 * Expands an endpoint path to a full url anchored to the given doc worker base url.
 */
export function docUrl(docWorkerUrl: string|null|undefined, path?: string) {
  const base = document.querySelector('base');
  const baseHref = base && base.href;
  const baseUrl = new URL(docWorkerUrl || baseHref || window.location.origin);
  return baseUrl.toString().replace(/\/$/, '') + (path ? `/${path}` : '');
}

// Get a url on the same webserver as the current page, adding a prefix to encode
// the current organization if necessary.
export function getOriginUrl(path: string) {
  return `${window.location.origin}${addCurrentOrgToPath('/', true)}${path}`;
}

// Return a string docId if server has provided one (as in hosted Grist), otherwise null
// (as in classic Grist).
export function getInitialDocAssignment(): string|null {
  return getGristConfig().assignmentId || null;
}

// Return true if we are on a page that can supply a doc list.
// TODO: the doclist object isn't relevant to hosted grist and should be factored out.
export function pageHasDocList(): boolean {
  // No doc list support on hosted grist.
  return !getGristConfig().homeUrl;
}

// Return true if we are on a page that has access to home api.
export function pageHasHome(): boolean {
  return Boolean(getGristConfig().homeUrl);
}

// Construct a url by adding `path` to the home url (adding in the part to the current
// org if needed), and fetch from it.
export function fetchFromHome(path: string, opts: RequestInit): Promise<Response> {
  const baseUrl = addCurrentOrgToPath(getGristConfig().homeUrl!);
  return window.fetch(`${baseUrl}${path}`, opts);
}
