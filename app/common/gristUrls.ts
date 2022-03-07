import {BillingPage, BillingSubPage, BillingTask} from 'app/common/BillingAPI';
import {OpenDocMode} from 'app/common/DocListAPI';
import {EngineCode} from 'app/common/DocumentSettings';
import {encodeQueryParams, isAffirmative} from 'app/common/gutil';
import {localhostRegex} from 'app/common/LoginState';
import {LocalPlugin} from 'app/common/plugin';
import {StringUnion} from 'app/common/StringUnion';
import {UIRowId} from 'app/common/UIRowId';
import {Document} from 'app/common/UserAPI';
import clone = require('lodash/clone');
import pickBy = require('lodash/pickBy');

export const SpecialDocPage = StringUnion('code', 'acl', 'data', 'GristDocTour');
type SpecialDocPage = typeof SpecialDocPage.type;
export type IDocPage = number | SpecialDocPage;

// What page to show in the user's home area. Defaults to 'workspace' if a workspace is set, and
// to 'all' otherwise.
export const HomePage = StringUnion('all', 'workspace', 'templates', 'trash');
export type IHomePage = typeof HomePage.type;

// TODO: Remove 'user' and 'info', since those pages are no longer part of any flow.
export const WelcomePage = StringUnion('teams', 'signup', 'verify', 'select-account');
export type WelcomePage = typeof WelcomePage.type;

export const AccountPage = StringUnion('account');
export type AccountPage = typeof AccountPage.type;

export const LoginPage = StringUnion('signup', 'verified', 'forgot-password');
export type LoginPage = typeof LoginPage.type;

// Overall UI style.  "full" is normal, "light" is a single page focused, panels hidden experience.
export const InterfaceStyle = StringUnion('light', 'full');
export type InterfaceStyle = typeof InterfaceStyle.type;

// Default subdomain for home api service if not otherwise specified.
export const DEFAULT_HOME_SUBDOMAIN = 'api';

// This is the minimum length a urlId may have if it is chosen
// as a prefix of the docId.
export const MIN_URLID_PREFIX_LENGTH = 12;

/**
 * Special ways to open a document, based on what the user intends to do.
 *   - view: Open document in read-only mode (even if user has edit rights)
 *   - fork: Open document in fork-ready mode.  This means that while edits are
 *           permitted, those edits should go to a copy of the document rather than
 *           the original.
 */

export const commonUrls = {
  help: "https://support.getgrist.com",
  plans: "https://www.getgrist.com/pricing",
  createTeamSite: "https://www.getgrist.com/create-team-site",

  efcrConnect: 'https://efc-r.com/connect',
  efcrHelp: 'https://www.nioxus.info/eFCR-Help',
};

/**
 * Values representable in a URL. The current state is available as urlState().state observable
 * in client. Updates to this state are expected by functions such as makeUrl() and setLinkUrl().
 */
export interface IGristUrlState {
  org?: string;
  homePage?: IHomePage;
  ws?: number;
  doc?: string;
  slug?: string;       // if present, this is based on the document title, and is not a stable id
  mode?: OpenDocMode;
  fork?: UrlIdParts;
  docPage?: IDocPage;
  account?: AccountPage;
  billing?: BillingPage;
  login?: LoginPage;
  welcome?: WelcomePage;
  welcomeTour?: boolean;
  docTour?: boolean;
  manageUsers?: boolean;
  params?: {
    billingPlan?: string;
    billingTask?: BillingTask;
    embed?: boolean;
    next?: string;
    style?: InterfaceStyle;
    compare?: string;
    linkParameters?: Record<string, string>;  // Parameters to pass as 'user.Link' in granular ACLs.
                                              // Encoded in URL as query params with extra '_' suffix.
  };
  hash?: HashLink;   // if present, this specifies an individual row within a section of a page.
}

// Subset of GristLoadConfig used by getOrgUrlInfo(), which affects the interpretation of the
// current URL.
export interface OrgUrlOptions {
  // The org associated with the current URL.
  org?: string;

  // Base domain for constructing new URLs, should start with "." and not include port, e.g.
  // ".getgrist.com". It should be unset for localhost operation and in single-org mode.
  baseDomain?: string;

  // In single-org mode, this is the single well-known org.
  singleOrg?: string;

  // Base URL used for accessing plugin material.
  pluginUrl?: string;
}

// Result of getOrgUrlInfo().
export interface OrgUrlInfo {
  hostname?: string;      // If hostname should be changed to access the requested org.
  orgInPath?: string;     // If /o/{orgInPath} should be used to access the requested org.
}

/**
 * Given host (optionally with port), baseDomain, and pluginUrl, determine whether to interpret host
 * as a custom domain, a native domain, or a plugin domain.
 */
export function getHostType(host: string, options: {
  baseDomain?: string, pluginUrl?: string
}): 'native' | 'custom' | 'plugin' {

  if (options.pluginUrl) {
    const url = new URL(options.pluginUrl);
    if (url.host.toLowerCase() === host.toLowerCase()) {
      return 'plugin';
    }
  }

  const hostname = host.split(":")[0];
  if (!options.baseDomain) { return 'native'; }
  if (hostname !== 'localhost' && !hostname.endsWith(options.baseDomain)) { return 'custom'; }
  return 'native';
}

export function getOrgUrlInfo(newOrg: string, currentHost: string, options: OrgUrlOptions): OrgUrlInfo {
  if (newOrg === options.singleOrg) {
    return {};
  }
  const hostType = getHostType(currentHost, options);
  if (hostType !== 'plugin') {
    const hostname = currentHost.split(":")[0];
    if (!options.baseDomain || hostname === 'localhost') {
      return {orgInPath: newOrg};
    }
  }
  if (newOrg === options.org && hostType !== 'native') {
    return {};
  }
  return {hostname: newOrg + options.baseDomain};
}

/**
 * The actual serialization of a url state into a URL. The URL has the form
 *    <org-base>/
 *    <org-base>/ws/<ws>/
 *    <org-base>/doc/<doc>[/p/<docPage>]
 *
 * where <org-base> depends on whether subdomains are in use, e.g.
 *    <org>.getgrist.com
 *    localhost:8080/o/<org>
 */
export function encodeUrl(gristConfig: Partial<GristLoadConfig>,
                          state: IGristUrlState, baseLocation: Location | URL): string {
  const url = new URL(baseLocation.href);
  const parts = ['/'];

  if (state.org) {
    // We figure out where to stick the org using the gristConfig and the current host.
    const {hostname, orgInPath} = getOrgUrlInfo(state.org, baseLocation.host, gristConfig);
    if (hostname) {
      url.hostname = hostname;
    }
    if (orgInPath) {
      parts.push(`o/${orgInPath}/`);
    }
  }

  if (state.ws) { parts.push(`ws/${state.ws}/`); }
  if (state.doc) {
    if (state.slug) {
      parts.push(`${encodeURIComponent(state.doc)}/${encodeURIComponent(state.slug)}`);
    } else {
      parts.push(`doc/${encodeURIComponent(state.doc)}`);
    }
    if (state.mode && OpenDocMode.guard(state.mode)) {
      parts.push(`/m/${state.mode}`);
    }
    if (state.docPage) {
      parts.push(`/p/${state.docPage}`);
    }
  } else if (state.homePage === 'trash' || state.homePage === 'templates') {
    parts.push(`p/${state.homePage}`);
  }

  if (state.account) {
    parts.push(state.account === 'account' ? 'account' : `account/${state.account}`);
  }

  if (state.billing) {
    parts.push(state.billing === 'billing' ? 'billing' : `billing/${state.billing}`);
  }

  if (state.login) { parts.push(state.login); }

  if (state.welcome) {
    parts.push(`welcome/${state.welcome}`);
  }

  const queryParams = pickBy(state.params, (v, k) => k !== 'linkParameters') as {[key: string]: string};
  for (const [k, v] of Object.entries(state.params?.linkParameters || {})) {
    queryParams[`${k}_`] = v;
  }
  const hashParts: string[] = [];
  if (state.hash && state.hash.rowId) {
    const hash = state.hash;
    hashParts.push(`a1`);
    for (const key of ['sectionId', 'rowId', 'colRef'] as Array<keyof HashLink>) {
      if (hash[key]) { hashParts.push(`${key[0]}${hash[key]}`); }
    }
  }
  const queryStr = encodeQueryParams(queryParams);
  url.pathname = parts.join('');
  url.search = queryStr;
  if (state.hash) {
    // Project tests use hashes, so only set hash if there is an anchor.
    url.hash = hashParts.join('.');
  } else if (state.welcomeTour) {
    url.hash = 'repeat-welcome-tour';
  } else if (state.docTour) {
    url.hash = 'repeat-doc-tour';
  } else if (state.manageUsers) {
    url.hash = 'manage-users';
  } else {
    url.hash = '';
  }
  return url.href;
}

/**
 * Parse a URL location into an IGristUrlState object. See encodeUrl() documentation.
 */
export function decodeUrl(gristConfig: Partial<GristLoadConfig>, location: Location | URL): IGristUrlState {
  const parts = location.pathname.slice(1).split('/');
  const map = new Map<string, string>();
  for (let i = 0; i < parts.length; i += 2) {
    map.set(parts[i], decodeURIComponent(parts[i + 1]));
  }
  // When the urlId is a prefix of the docId, documents are identified
  // as "<urlId>/slug" instead of "doc/<urlId>".  We can detect that because
  // the minimum length of a urlId prefix is longer than the maximum length
  // of any of the valid keys in the url.
  for (const key of map.keys()) {
    if (key.length >= MIN_URLID_PREFIX_LENGTH && !LoginPage.guard(key)) {
      map.set('doc', key);
      map.set('slug', map.get(key)!);
      map.delete(key);
      break;
    }
  }

  const state: IGristUrlState = {};
  const subdomain = parseSubdomain(location.host);
  if (gristConfig.org || gristConfig.singleOrg) {
    state.org = gristConfig.org || gristConfig.singleOrg;
  } else if (!gristConfig.pathOnly && subdomain.org) {
    state.org = subdomain.org;
  }
  const sp = new URLSearchParams(location.search);
  if (location.search) { state.params = {}; }
  if (map.has('o')) { state.org = map.get('o'); }
  if (map.has('ws')) { state.ws = parseInt(map.get('ws')!, 10); }
  if (map.has('doc')) {
    state.doc = map.get('doc');
    const fork = parseUrlId(map.get('doc')!);
    if (fork.forkId) { state.fork = fork; }
    if (map.has('slug')) { state.slug = map.get('slug'); }
    if (map.has('p')) { state.docPage = parseDocPage(map.get('p')!); }
  } else {
    if (map.has('p')) {
      const p = map.get('p')!;
      state.homePage = HomePage.parse(p);
    }
  }
  if (map.has('m')) { state.mode = OpenDocMode.parse(map.get('m')); }
  if (map.has('account')) { state.account = AccountPage.parse(map.get('account')) || 'account'; }
  if (map.has('billing')) { state.billing = BillingSubPage.parse(map.get('billing')) || 'billing'; }
  if (map.has('welcome')) { state.welcome = WelcomePage.parse(map.get('welcome')); }
  if (sp.has('billingPlan')) { state.params!.billingPlan = sp.get('billingPlan')!; }
  if (sp.has('billingTask')) {
    state.params!.billingTask = BillingTask.parse(sp.get('billingTask'));
  }

  if (map.has('signup')) {
    state.login = 'signup';
  } else if (map.has('verified')) {
    state.login = 'verified';
  } else if (map.has('forgot-password')) {
    state.login = 'forgot-password';
  }

  if (sp.has('next')) { state.params!.next = sp.get('next')!; }

  if (sp.has('style')) {
    state.params!.style = InterfaceStyle.parse(sp.get('style'));
  }
  if (sp.has('embed')) {
    const embed = state.params!.embed = isAffirmative(sp.get('embed'));
    // Turn view mode on if no mode has been specified, and not a fork.
    if (embed && !state.mode && !state.fork) { state.mode = 'view'; }
    // Turn on light style if no style has been specified.
    if (embed && !state.params!.style) { state.params!.style = 'light'; }
  }
  if (sp.has('compare')) {
    state.params!.compare = sp.get('compare')!;
  }
  for (const [k, v] of sp.entries()) {
    if (k.endsWith('_')) {
      if (!state.params!.linkParameters) { state.params!.linkParameters = {}; }
      state.params!.linkParameters[k.slice(0, k.length - 1)] = v;
    }
  }
  if (location.hash) {
    const hash = location.hash;
    const hashParts = hash.split('.');
    const hashMap = new Map<string, string>();
    for (const part of hashParts) {
      hashMap.set(part.slice(0, 1), part.slice(1));
    }
    if (hashMap.has('#') && hashMap.get('#') === 'a1') {
      const link: HashLink = {};
      for (const key of ['sectionId', 'rowId', 'colRef'] as Array<keyof HashLink>) {
        const ch = key.substr(0, 1);
        if (!hashMap.has(ch)) { continue; }
        const value = hashMap.get(ch);
        if (key === 'rowId' && value === 'new') {
          link[key] = 'new';
        } else {
          link[key] = parseInt(value!, 10);
        }
      }
      state.hash = link;
    }
    state.welcomeTour = hashMap.get('#') === 'repeat-welcome-tour';
    state.docTour = hashMap.get('#') === 'repeat-doc-tour';
    state.manageUsers = hashMap.get('#') === 'manage-users';
  }
  return state;
}

// Returns a function suitable for user with makeUrl/setHref/etc, which updates aclAsUser*
// linkParameters in the current state, unsetting them if email is null. Optional extraState
// allows setting other properties (e.g. 'docPage') at the same time.
export function userOverrideParams(email: string|null, extraState?: IGristUrlState) {
  return function(prevState: IGristUrlState): IGristUrlState {
    const combined = {...prevState, ...extraState};
    const linkParameters = clone(combined.params?.linkParameters) || {};
    if (email) {
      linkParameters.aclAsUser = email;
    } else {
      delete linkParameters.aclAsUser;
    }
    delete linkParameters.aclAsUserId;
    return {...combined, params: {...combined.params, linkParameters}};
  };
}

/**
 * parseDocPage is a noop for special pages, otherwise parse to integer
 */
function parseDocPage(p: string): IDocPage {
  if (SpecialDocPage.guard(p)) {
    return p;
  }
  return parseInt(p, 10);
}

/**
 * Parses the URL like "foo.bar.baz" into the pair {org: "foo", base: ".bar.baz"}.
 * Port is allowed and included into base.
 *
 * The "base" part is required to have at least two periods.  The "org" part must pass
 * the subdomainRegex test.
 *
 * If there's no way to parse the URL into such a pair, then an empty object is returned.
 */
export function parseSubdomain(host: string|undefined): {org?: string, base?: string} {
  if (!host) { return {}; }
  const match = /^([^.]+)(\..+\..+)$/.exec(host.toLowerCase());
  if (match) {
    const org = match[1];
    const base = match[2];
    if (subdomainRegex.exec(org)) {
      return {org, base};
    }
  }
  // Host has nowhere to put a subdomain.
  return {};
}

/**
 * Like parseSubdomain, but throws an error if neither of these cases apply:
 *   - host can be parsed into a valid subdomain and a valid base domain.
 *   - host is localhost:NNNN
 * An empty object is only returned when host is localhost:NNNN.
 */
export function parseSubdomainStrictly(host: string|undefined): {org?: string, base?: string} {
  if (!host) { throw new Error('host not known'); }
  const result = parseSubdomain(host);
  if (result.org) { return result; }
  if (!host.match(localhostRegex)) {
    throw new Error(`host not understood: ${host}`);
  }
  // Host is localhost[:NNNN], no org available.
  return {};
}

/**
 * These settings get sent to the client along with the loaded page. At the minimum, the browser
 * needs to know the URL of the home API server (e.g. api.getgrist.com).
 */
export interface GristLoadConfig {
  // URL of the Home API server for the browser client to use.
  homeUrl: string|null;

  // When loading /doc/{docId}, we include the id used to assign the document (this is the docId).
  assignmentId?: string;

  // Org or "subdomain". When present, this overrides org information from the hostname. We rely
  // on this for custom domains, but set it generally for all pages.
  org?: string;

  // Base domain for constructing new URLs, should start with "." and not include port, e.g.
  // ".getgrist.com". It should be unset for localhost operation and in single-org mode.
  baseDomain?: string;

  // In single-org mode, this is the single well-known org. Suppress any org selection UI.
  singleOrg?: string;

  // When set, this directs the client to encode org information in path, not in domain.
  pathOnly?: boolean;

  // Type of error page to show. This is used for pages such as "signed-out" and "not-found",
  // which don't include the full app.
  errPage?: string;

  // When errPage is a generic "other-error", this is the message to show.
  errMessage?: string;

  // URL for client to use for untrusted content.
  pluginUrl?: string;

  // Stripe API key for use on the client.
  stripeAPIKey?: string;

  // BeaconID for the support widget from HelpScout.
  helpScoutBeaconId?: string;

  // If set, enable anonymous sharing UI elements.
  supportAnon?: boolean;

  // If set, allow selection of the specified engines.
  // TODO: move this list to a separate endpoint.
  supportEngines?: EngineCode[];

  // Max upload allowed for imports (except .grist files), in bytes; 0 or omitted for unlimited.
  maxUploadSizeImport?: number;

  // Max upload allowed for attachments, in bytes; 0 or omitted for unlimited.
  maxUploadSizeAttachment?: number;

  // Pre-fetched call to getDoc for the doc being loaded.
  getDoc?: {[id: string]: Document};

  // Pre-fetched call to getWorker for the doc being loaded.
  getWorker?: {[id: string]: string|null};

  // The timestamp when this gristConfig was generated.
  timestampMs: number;

  // Google Client Id, used in Google integration (ex: Google Drive Plugin)
  googleClientId?: string;

  // Max scope we can request for accessing files from Google Drive.
  // Default used by Grist is https://www.googleapis.com/auth/drive.file:
  // View and manage Google Drive files and folders that you have opened or created with this app.
  // More on scopes: https://developers.google.com/identity/protocols/oauth2/scopes#drive
  googleDriveScope?: string;

  // List of registered plugins (used by HomePluginManager and DocPluginManager)
  plugins?: LocalPlugin[];

  // If custom widget list is available.
  enableWidgetRepository?: boolean;

  // Whether there is somewhere for survey data to go.
  survey?: boolean;
}

// Acceptable org subdomains are alphanumeric (hyphen also allowed) and of
// non-zero length.
const subdomainRegex = /^[-a-z0-9]+$/i;

export interface OrgParts {
  subdomain: string|null;
  orgFromHost: string|null;
  orgFromPath: string|null;
  pathRemainder: string;
  mismatch: boolean;
}

/**
 * Returns true if code is running in client, false if running in server.
 */
export function isClient() {
  return (typeof window !== 'undefined') && window && window.location && window.location.hostname;
}

/**
 * Returns a known org "subdomain" if Grist is configured in single-org mode
 * (GRIST_SINGLE_ORG=<org> on the server) or if the page includes an org in gristConfig.
 */
export function getKnownOrg(): string|null {
  if (isClient()) {
    const gristConfig: GristLoadConfig = (window as any).gristConfig;
    return (gristConfig && gristConfig.singleOrg) || null;
  } else {
    return process.env.GRIST_SINGLE_ORG || null;
  }
}

/**
 * Like getKnownOrg, but respects singleOrg/GRIST_SINGLE_ORG strictly.
 * The main difference in behavior would be for orgs with custom domains
 * served from a shared pool of servers, for which gristConfig.org would
 * be set, but not gristConfig.singleOrg.
 */
export function getSingleOrg(): string|null {
  if (isClient()) {
    const gristConfig: GristLoadConfig = (window as any).gristConfig;
    return (gristConfig && gristConfig.singleOrg) || null;
  } else {
    return process.env.GRIST_SINGLE_ORG || null;
  }
}

/**
 * Returns true if org must be encoded in path, not in domain.  Determined from
 * gristConfig on the client.  On the server, returns true if the host is
 * supplied and is 'localhost', or if GRIST_ORG_IN_PATH is set to 'true'.
 */
export function isOrgInPathOnly(host?: string): boolean {
  if (isClient()) {
    const gristConfig: GristLoadConfig = (window as any).gristConfig;
    return (gristConfig && gristConfig.pathOnly) || false;
  } else {
    if (host && host.match(/^localhost(:[0-9]+)?$/)) { return true; }
    return (process.env.GRIST_ORG_IN_PATH === 'true');
  }
}

// Extract an organization name from the host.  Returns null if an organization name
// could not be recovered.  Organization name may be overridden by server configuration.
export function getOrgFromHost(reqHost: string): string|null {
  const singleOrg = getKnownOrg();
  if (singleOrg) { return singleOrg; }
  if (isOrgInPathOnly()) { return null; }
  return parseSubdomain(reqHost).org || null;
}

/**
 * Get any information about an organization that is embedded in the host name or the
 * path.
 * For example, on nasa.getgrist.com, orgFromHost and subdomain will be set to "nasa".
 * On localhost:8000/o/nasa, orgFromPath and subdomain will be set to "nasa".
 * On nasa.getgrist.com/o/nasa, orgFromHost, orgFromPath, and subdomain will all be "nasa".
 * On spam.getgrist.com/o/nasa, orgFromHost will be "spam", orgFromPath will be "nasa",
 * subdomain will be null, and mismatch will be true.
 */
export function extractOrgParts(reqHost: string|undefined, reqPath: string): OrgParts {
  let orgFromHost: string|null = getKnownOrg();

  if (!orgFromHost && reqHost) {
    orgFromHost = getOrgFromHost(reqHost);
    if (orgFromHost) {
      // Some subdomains are shared, and do not reflect the name of an organization.
      // See https://phab.getgrist.com/w/hosting/v1/urls/ for a list.
      if (/^(api|v1-.*|doc-worker-.*)$/.test(orgFromHost)) {
        orgFromHost = null;
      }
    }
  }

  const part = parseFirstUrlPart('o', reqPath);
  if (part.value) {
    const orgFromPath = part.value.toLowerCase();
    const mismatch = Boolean(orgFromHost && orgFromPath && (orgFromHost !== orgFromPath));
    const subdomain = mismatch ? null : orgFromPath;
    return {orgFromHost, orgFromPath, pathRemainder: part.path, mismatch, subdomain};
  }
  return {orgFromHost, orgFromPath: null, pathRemainder: reqPath, mismatch: false, subdomain: orgFromHost};
}

/**
 * When a prefix is extracted from the path, the remainder of the path may be empty.
 * This method makes sure there is at least a "/".
 */
export function sanitizePathTail(path: string|undefined) {
  path = path || '/';
  return (path.startsWith('/') ? '' : '/') + path;
}

/*
 * If path starts with /{tag}/{value}{/rest}, returns value and the remaining path (/rest).
 * Otherwise, returns value of undefined and the path unchanged.
 * E.g. parseFirstUrlPart('o', '/o/foo/bar') returns {value: 'foo', path: '/bar'}.
 */
export function parseFirstUrlPart(tag: string, path: string): {value?: string, path: string} {
  const match = path.match(/^\/([^/?#]+)\/([^/?#]+)(.*)$/);
  if (match && match[1] === tag) {
    return {value: match[2], path: sanitizePathTail(match[3])};
  } else {
    return {path};
  }
}

/**
 * The internal structure of a UrlId.  There is no internal structure. unless the id is
 * for a fork, in which case the fork has a separate id, and a user id may also be
 * embedded to track ownership.
 */
export interface UrlIdParts {
  trunkId: string;
  forkId?: string;
  forkUserId?: number;
  snapshotId?: string;
}

// Parse a string of the form trunkId or trunkId~forkId or trunkId~forkId~forkUserId
// or trunkId[....]~v=snapshotId
export function parseUrlId(urlId: string): UrlIdParts {
  let snapshotId: string|undefined;
  const parts = urlId.split('~');
  const bareParts = parts.filter(part => !part.includes('='));
  for (const part of parts) {
    if (part.startsWith('v=')) {
      snapshotId = decodeURIComponent(part.substr(2).replace(/_/g, '%'));
    }
  }
  return {
    trunkId: bareParts[0],
    forkId: bareParts[1],
    forkUserId: (bareParts[2] !== undefined) ? parseInt(bareParts[2], 10) : undefined,
    snapshotId,
  };
}

// Construct a string of the form trunkId or trunkId~forkId or trunkId~forkId~forkUserId
// or trunkId[....]~v=snapshotId
export function buildUrlId(parts: UrlIdParts): string {
  let token = [parts.trunkId, parts.forkId, parts.forkUserId].filter(x => x !== undefined).join('~');
  if (parts.snapshotId) {
    // This could be an S3 VersionId, about which AWS makes few promises.
    // encodeURIComponent leaves untouched the following:
    //   alphabetic; decimal; any of: - _ . ! ~ * ' ( )
    // We further encode _.!~*'() to fit within existing limits on what characters
    // may be in a docId (leaving just the hyphen, which is permitted).  The limits
    // could be loosened, but without much benefit.
    const codedSnapshotId = encodeURIComponent(parts.snapshotId)
      .replace(/[_.!~*'()]/g, ch => `_${ch.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(/%/g, '_');
    token = `${token}~v=${codedSnapshotId}`;
  }
  return token;
}

/**
 * Values that may be encoded in a hash in a document url.
 */
export interface HashLink {
  sectionId?: number;
  rowId?: UIRowId;
  colRef?: number;
}

// Check whether a urlId is a prefix of the docId, and adequately long to be
// a candidate for use in prettier urls.
function shouldIncludeSlug(doc: {id: string, urlId: string|null}): boolean {
  if (!doc.urlId || doc.urlId.length < MIN_URLID_PREFIX_LENGTH) { return false; }
  return doc.id.startsWith(doc.urlId);
}

// Convert the name of a document into a slug.  Only alphanumerics are retained,
// and spaces are replaced with hyphens.
// TODO: investigate whether there's a better option with unicode than just
// deleting it, seems unfair to languages using anything other than unaccented
// Latin characters.
function nameToSlug(name: string): string {
  return name.trim().replace(/ /g, '-').replace(/[^-a-zA-Z0-9]/g, '').replace(/---*/g, '-');
}

// Returns a slug for the given docId/urlId/name, or undefined if a slug should
// not be used.
export function getSlugIfNeeded(doc: {id: string, urlId: string|null, name: string}): string|undefined {
  if (!shouldIncludeSlug(doc)) { return; }
  return nameToSlug(doc.name);
}
