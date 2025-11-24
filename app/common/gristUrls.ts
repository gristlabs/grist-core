import ICommonUrlsTI from 'app/common/ICommonUrls-ti';
import {AssistantConfig} from 'app/common/Assistant';
import {BillingPage, BillingSubPage, BillingTask} from 'app/common/BillingAPI';
import {Document} from 'app/common/UserAPI';
import {encodeQueryParams, isAffirmative, removePrefix} from 'app/common/gutil';
import {EngineCode} from 'app/common/DocumentSettings';
import {Features as PlanFeatures} from 'app/common/Features';
import {getGristConfig} from 'app/common/urlUtils';
import {IAttachedCustomWidget} from "app/common/widgetTypes";
import {ICommonUrls} from 'app/common/ICommonUrls';
import {LocalPlugin} from 'app/common/plugin';
import {OpenDocMode} from 'app/common/DocListAPI';
import {StringUnion} from 'app/common/StringUnion';
import {TelemetryLevel} from 'app/common/Telemetry';
import {ThemeAppearance, themeAppearances, ThemeName, themeNames} from 'app/common/ThemePrefs';
import {UIRowId} from 'app/plugin/GristAPI';

import clone from 'lodash/clone';
import pickBy from 'lodash/pickBy';
import slugify from 'slugify';
import * as t from "ts-interface-checker";

const { ICommonUrls: ICommonUrlsChecker } = t.createCheckers(ICommonUrlsTI);

export const SpecialDocPage = StringUnion(
  'code', 'acl', 'data', 'GristDocTour',
  'settings', 'suggestions', 'webhook', 'timing',
);
type SpecialDocPage = typeof SpecialDocPage.type;
export type IDocPage = number | SpecialDocPage;

export type ViewDocPage = number | 'data';
/**
 * ViewDocPage is a page that shows table data (either normal or raw data view).
 */
export function isViewDocPage(docPage: IDocPage): docPage is ViewDocPage {
  return typeof docPage === 'number' || docPage === 'data';
}

// What page to show in the user's home area. Defaults to 'workspace' if a workspace is set, and
// to 'all' otherwise.
export const HomePage = StringUnion('all', 'workspace', 'templates', 'trash');
export type IHomePage = typeof HomePage.type;

export const HomePageTab = StringUnion('recent', 'pinned', 'all');
export type HomePageTab = typeof HomePageTab.type;

export const WelcomePage = StringUnion('teams', 'signup', 'verify', 'select-account');
export type WelcomePage = typeof WelcomePage.type;

export const AccountPage = StringUnion('account');
export type AccountPage = typeof AccountPage.type;

export const ActivationPage = StringUnion('activation');
export type ActivationPage = typeof ActivationPage.type;

export const AuditLogsPage = StringUnion('audit-logs');
export type AuditLogsPage = typeof AuditLogsPage.type;

export const LoginPage = StringUnion('signup', 'login', 'verified', 'forgot-password');
export type LoginPage = typeof LoginPage.type;

export const AdminPanelPage = StringUnion('admin', 'docs', 'users', 'workspaces', 'orgs');
export type AdminPanelPage = typeof AdminPanelPage.type;

export const AdminPanelTab = StringUnion('users', 'workspaces', 'docs', 'orgs', 'details');
export type AdminPanelTab = typeof AdminPanelTab.type;

export const PREFERRED_STORAGE_ANCHOR = 'preferredStorage';
export const PersistentAnchor = StringUnion(PREFERRED_STORAGE_ANCHOR);
export type PersistentAnchor = typeof PersistentAnchor.type;

// Overall UI style.  "full" is normal, "singlePage" is a single page focused, panels hidden experience.
export const InterfaceStyle = StringUnion('singlePage', 'full');
export type InterfaceStyle = typeof InterfaceStyle.type;

// Default subdomain for home api service if not otherwise specified.
export const DEFAULT_HOME_SUBDOMAIN = 'api';

// This is the minimum length a urlId may have if it is chosen
// as a prefix of the docId.
export const MIN_URLID_PREFIX_LENGTH = 12;

// Values meeting MIN_URLID_PREFIX_LENGTH that appear in non-document URLs and
// should not be recognized as urlId prefixes when decoding URLs.
const RESERVED_URLID_PREFIXES = new Set(['forgot-password']);

// A prefix that identifies a urlId as a share key.
// Important that this not be part of a valid docId.
export const SHARE_KEY_PREFIX = 's.';

/**
 * Form framing is used to control the way forms are rendered in Grist.
 * - 'border' adds a green border around the form, used to indicate that the forms can be created
 *   by untrusted users and it makes phishing attacks harder.
 * - 'minimal' doesn't show the border, used for trusted users.
 *
 * The default value is 'border', and it can be controlled by GRIST_FEATURE_FORM_FRAMING environment
 * variable.
 */
export type FormFraming = 'border' | 'minimal';

/**
 * Special ways to open a document, based on what the user intends to do.
 *   - view: Open document in read-only mode (even if user has edit rights)
 *   - fork: Open document in fork-ready mode.  This means that while edits are
 *           permitted, those edits should go to a copy of the document rather than
 *           the original.
 */

export const getCommonUrls = () => withAdminDefinedUrls({
  help: getHelpCenterUrl(),
  helpAccessRules: "https://support.getgrist.com/access-rules",
  helpAssistant: "https://support.getgrist.com/assistant",
  helpAssistantDataUse: "https://support.getgrist.com/assistant/#data-use-policy",
  helpFormulaAssistantDataUse: "https://support.getgrist.com/ai-assistant/#data-use-policy",
  helpColRefs: "https://support.getgrist.com/col-refs",
  helpConditionalFormatting: "https://support.getgrist.com/conditional-formatting",
  helpFilterButtons: "https://support.getgrist.com/search-sort-filter/#filter-buttons",
  helpLinkingWidgets: "https://support.getgrist.com/linking-widgets",
  helpRawData: "https://support.getgrist.com/raw-data",
  helpSuggestions: "https://support.getgrist.com/sharing/#suggestions",
  helpUnderstandingReferenceColumns: "https://support.getgrist.com/col-refs/#understanding-reference-columns",
  helpTriggerFormulas: "https://support.getgrist.com/formulas/#trigger-formulas",
  helpTryingOutChanges: "https://support.getgrist.com/copying-docs/#trying-out-changes",
  helpWidgets: "https://support.getgrist.com/page-widgets/#widgets",
  helpCustomWidgets: "https://support.getgrist.com/widget-custom",
  helpInstallAuditLogs: "https://support.getgrist.com/install/audit-logs",
  helpTeamAuditLogs: "https://support.getgrist.com/teams/audit-logs",
  helpTelemetryLimited: "https://support.getgrist.com/telemetry-limited",
  helpEnterpriseOptIn: "https://support.getgrist.com/self-managed/#how-do-i-activate-grist-enterprise",
  helpCalendarWidget: "https://support.getgrist.com/widget-calendar",
  helpLinkKeys: "https://support.getgrist.com/examples/2021-04-link-keys",
  helpFilteringReferenceChoices: "https://support.getgrist.com/col-refs/#filtering-reference-choices-in-dropdown",
  helpSandboxing: "https://support.getgrist.com/self-managed/#how-do-i-sandbox-documents",
  helpAPI: 'https://support.getgrist.com/api',
  helpStateStore: 'https://support.getgrist.com/self-managed/#what-is-a-state-store',
  helpSummaryFormulas: 'https://support.getgrist.com/summary-tables/#summary-formulas',
  helpAdminControls: "https://support.getgrist.com/admin-controls",
  helpFiddleMode: 'https://support.getgrist.com/glossary/#fiddle-mode',
  helpSharing: 'https://support.getgrist.com/sharing',
  helpFormUrlValues: 'https://support.getgrist.com/widget-form/#accept-value-from-url',
  freeCoachingCall: getFreeCoachingCallUrl(),
  contactSupport: getContactSupportUrl(),
  termsOfService: getTermsOfServiceUrl(),
  onboardingTutorialVideoId: getOnboardingVideoId(),
  plans: "https://www.getgrist.com/pricing",
  contact: "https://www.getgrist.com/contact",
  templates: 'https://www.getgrist.com/templates',
  webinars: getWebinarsUrl(),
  community: 'https://community.getgrist.com',
  functions: 'https://support.getgrist.com/functions',
  formulaSheet: 'https://support.getgrist.com/formula-cheat-sheet',
  formulas: 'https://support.getgrist.com/formulas',
  forms: 'https://www.getgrist.com/forms/?utm_source=grist-forms&utm_medium=grist-forms&utm_campaign=forms-footer',
  openGraphPreviewImage: 'https://grist-static.com/icons/opengraph-preview-image.png',

  gristLabsCustomWidgets: 'https://gristlabs.github.io/grist-widget/',
  gristLabsWidgetRepository: 'https://github.com/gristlabs/grist-widget/releases/download/latest/manifest.json',
  githubGristCore: 'https://github.com/gristlabs/grist-core',
  githubSponsorGristLabs: 'https://github.com/sponsors/gristlabs',

  versionCheck: 'https://api.getgrist.com/api/version',
  attachmentStorage: 'https://support.getgrist.com/document-settings/#external-attachments',
});

export const commonUrls = getCommonUrls();


/**
 * Values representable in a URL. The current state is available as urlState().state observable
 * in client. Updates to this state are expected by functions such as makeUrl() and setLinkUrl().
 */
export interface IGristUrlState {
  org?: string;
  homePage?: IHomePage;
  homePageTab?: HomePageTab;
  ws?: number;
  doc?: string;
  slug?: string;       // if present, this is based on the document title, and is not a stable id
  mode?: OpenDocMode;
  fork?: UrlIdParts;
  docPage?: IDocPage;
  account?: AccountPage;
  billing?: BillingPage;
  activation?: ActivationPage;
  auditLogs?: AuditLogsPage;
  login?: LoginPage;
  welcome?: WelcomePage;
  adminPanel?: AdminPanelPage;
  adminPanelTab?: AdminPanelTab;
  welcomeTour?: boolean;
  docTour?: boolean;
  manageUsers?: boolean;
  createTeam?: boolean;
  upgradeTeam?: boolean;
  params?: {
    billingPlan?: string; // priceId
    planType?: string;
    billingTask?: BillingTask;
    embed?: boolean;
    state?: string;
    srcDocId?: string;
    style?: InterfaceStyle;
    compare?: string;
    linkParameters?: Record<string, string>;  // Parameters to pass as 'user.Link' in granular ACLs.
                                              // Encoded in URL as query params with extra '_' suffix.
    themeSyncWithOs?: boolean;
    themeAppearance?: ThemeAppearance;
    themeName?: ThemeName;
    details?: boolean; // Used on admin pages to show details tab.
    assistantPrompt?: string;
    assistantState?: string;
  };
  hash?: HashLink;   // if present, this specifies an individual row within a section of a page.
  api?: boolean;     // indicates that the URL should be encoded as an API URL, not as a landing page.
                     // But this barely works, and is suitable only for documents. For decoding it
                     // indicates that the URL probably points to an API endpoint.
  viaShare?: boolean; // Accessing document via a special share.
  form?: {
    vsId: number;      // a view section id of a form.
    shareKey?: string; // only one of shareKey or doc should be set.
  },
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

  // If set, org is expected to be encoded in the path, not domain.
  pathOnly?: boolean;
}

// Result of getOrgUrlInfo().
export interface OrgUrlInfo {
  hostname?: string;      // If hostname should be changed to access the requested org.
  orgInPath?: string;     // If /o/{orgInPath} should be used to access the requested org.
}

function hostMatchesUrl(host?: string, url?: string) {
  return host !== undefined && url !== undefined && new URL(url).host === host;
}

/**
 * Returns true if:
 *  - the server is a home worker and the host matches APP_HOME_INTERNAL_URL;
 *  - or the server is a doc worker and the host matches APP_DOC_INTERNAL_URL;
 *
 * @param {string?} host The host to check
 */
function isOwnInternalUrlHost(host?: string) {
  // Note: APP_HOME_INTERNAL_URL may also be defined in doc worker as well as in home worker
  if (process.env.APP_HOME_INTERNAL_URL && hostMatchesUrl(host, process.env.APP_HOME_INTERNAL_URL)) {
    return true;
  }
  return Boolean(process.env.APP_DOC_INTERNAL_URL) && hostMatchesUrl(host, process.env.APP_DOC_INTERNAL_URL);
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
  if (
    hostname === 'localhost' ||
    isOwnInternalUrlHost(host) ||
    hostname.endsWith(options.baseDomain)
  ) {
    return 'native';
  }
  return 'custom';
}

export function getOrgUrlInfo(newOrg: string, currentHost: string, options: OrgUrlOptions): OrgUrlInfo {
  if (newOrg === options.singleOrg) {
    return {};
  }
  if (options.pathOnly) {
    return {orgInPath: newOrg};
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
                          state: IGristUrlState, baseLocation: Location | URL,
                          options: {
                            tweaks?: UrlTweaks,
                          } = {}): string {
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

  if (state.api) {
    parts.push(`api/`);
  }
  if (state.ws) { parts.push(`ws/${state.ws}/`); }
  if (state.doc) {
    if (state.api) {
      parts.push(`docs/${encodeURIComponent(state.doc)}`);
    } else if (state.viaShare) {
      // Use a special path, and remove SHARE_KEY_PREFIX from id.
      let id = state.doc;
      if (id.startsWith(SHARE_KEY_PREFIX)) {
        id = id.substring(SHARE_KEY_PREFIX.length);
      }
      parts.push(`s/${encodeURIComponent(id)}`);
    } else if (state.slug) {
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
    if (state.form) {
      parts.push(`/f/${state.form.vsId}`);
    }
  } else if (state.form?.shareKey) {
    parts.push(`forms/${encodeURIComponent(state.form.shareKey)}/${encodeURIComponent(state.form.vsId)}`);
  } else if (state.homePage === 'trash' || state.homePage === 'templates') {
    parts.push(`p/${state.homePage}`);
  }

  if (state.account) {
    parts.push(state.account === 'account' ? 'account' : `account/${state.account}`);
  }

  if (state.billing) {
    parts.push(state.billing === 'billing' ? 'billing' : `billing/${state.billing}`);
  }

  if (state.activation) { parts.push(state.activation); }

  if (state.auditLogs) { parts.push(state.auditLogs); }

  if (state.login) { parts.push(state.login); }

  if (state.welcome) {
    parts.push(`welcome/${state.welcome}`);
  }

  if (state.adminPanel) {
    parts.push(state.adminPanel === 'admin' ? 'admin' : `admin/${state.adminPanel}`);
  }

  const queryParams = pickBy(state.params, (v, k) => k !== 'linkParameters') as {[key: string]: string};
  for (const [k, v] of Object.entries(state.params?.linkParameters || {})) {
    queryParams[`${k}_`] = v;
  }
  if (state.params?.details) {
    queryParams.details = 'true';
  }
  const queryStr = encodeQueryParams(queryParams);

  url.pathname = parts.join('');
  url.search = queryStr;

  if (state.homePageTab) {
    url.hash = state.homePageTab;
  } else if (state.hash && state.hash.anchor) {
    url.hash = state.hash.anchor;
  } else if (state.hash) {
    // Project tests use hashes, so only set hash if there is an anchor.
    url.hash = makeAnchorLinkValue(state.hash);
  } else if (state.welcomeTour) {
    url.hash = 'repeat-welcome-tour';
  } else if (state.docTour) {
    url.hash = 'repeat-doc-tour';
  } else if (state.manageUsers) {
    url.hash = 'manage-users';
  } else if (state.createTeam) {
    url.hash = 'create-team';
  } else if (state.upgradeTeam) {
    url.hash = 'upgrade-team';
  } else if (state.adminPanelTab) {
    url.hash = state.adminPanelTab;
  } else {
    url.hash = '';
  }
  options.tweaks?.postEncode?.({
    url,
    parts,
    state,
    baseLocation,
  });
  return url.href;
}

/**
 * Parse a URL location into an IGristUrlState object. See encodeUrl() documentation.
 */
export function decodeUrl(gristConfig: Partial<GristLoadConfig>, location: Location | URL, options?: {
  tweaks?: UrlTweaks,
}): IGristUrlState {
  location = new URL(location.href);  // Make sure location is a URL.
  options?.tweaks?.preDecode?.({ url: location });
  const parts = location.pathname.slice(1).split('/');
  const state: IGristUrlState = {};

  // Bare minimum we can do to detect API URLs: if it starts with /api/ or /o/{org}/api/...
  if (parts[0] === 'api' || (parts[0] === 'o' && parts[2] === 'api')) {
    state.api = true;
    parts.splice(parts[0] === 'api' ? 0 : 2, 1);
  }

  // Bare minimum we can do to detect form URLs with share keys: if it starts with /forms/ or /o/{org}/forms/...
  if (parts[0] === 'forms' || (parts[0] === 'o' && parts[2] === 'forms')) {
    const startIndex = parts[0] === 'forms' ? 0 : 2;
    // Form URLs have two parts to extract: the share key and the view section id.
    state.form = {
      shareKey: parts[startIndex + 1],
      vsId: parseInt(parts[startIndex + 2], 10),
    };
    parts.splice(startIndex, 3);
  }

  const map = new Map<string, string>();
  for (let i = 0; i < parts.length; i += 2) {
    map.set(parts[i], decodeURIComponent(parts[i + 1]));
  }

  // For the API case, we need to map "docs" to "doc" (as this is what we did in encodeUrl and what API expects).
  if (state.api && map.has('docs')) {
    map.set('doc', map.get('docs')!);
  }

  // /s/<key> is accepted as another way to write -> /doc/<share-prefix><key>
  if (map.has('s')) {
    const key = map.get('s');
    map.set('doc', `${SHARE_KEY_PREFIX}${key}`);
    state.viaShare = true;
  }

  // When the urlId is a prefix of the docId, documents are identified
  // as "<urlId>/slug" instead of "doc/<urlId>".  We can detect that because
  // the minimum length of a urlId prefix is longer than the maximum length
  // of any of the valid keys in the url.
  for (const key of map.keys()) {
    if (
      key.length >= MIN_URLID_PREFIX_LENGTH &&
      !RESERVED_URLID_PREFIXES.has(key)
    ) {
      map.set('doc', key);
      map.set('slug', map.get(key)!);
      map.delete(key);
      break;
    }
  }

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
    if (map.has('f')) { state.form = {vsId: parseInt(map.get('f')!, 10)}; }
  } else {
    if (map.has('p')) {
      const p = map.get('p')!;
      state.homePage = HomePage.parse(p);
    }
  }
  if (map.has('m')) { state.mode = OpenDocMode.parse(map.get('m')); }
  if (map.has('account')) { state.account = AccountPage.parse(map.get('account')) || 'account'; }
  if (map.has('billing')) { state.billing = BillingSubPage.parse(map.get('billing')) || 'billing'; }
  if (map.has('activation')) {
    state.activation = ActivationPage.parse(map.get('activation')) || 'activation';
  }
  if (map.has('audit-logs')) {
    state.auditLogs = AuditLogsPage.parse(map.get('audit-logs')) || 'audit-logs';
  }
  if (map.has('welcome')) { state.welcome = WelcomePage.parse(map.get('welcome')); }
  if (map.has('admin')) {
    state.adminPanel = AdminPanelPage.parse(map.get('admin')) || 'admin';
  }
  if (sp.has('planType')) { state.params!.planType = sp.get('planType')!; }
  if (sp.has('billingPlan')) { state.params!.billingPlan = sp.get('billingPlan')!; }
  if (sp.has('billingTask')) {
    state.params!.billingTask = BillingTask.parse(sp.get('billingTask'));
  }
  if (map.has('signup')) {
    state.login = 'signup';
  } else if (map.has('login')) {
    state.login = 'login';
  } else if (map.has('verified')) {
    state.login = 'verified';
  } else if (map.has('forgot-password')) {
    state.login = 'forgot-password';
  }
  if (sp.has('state')) {
    state.params!.state = sp.get('state')!;
  }
  if (sp.has('srcDocId')) {
    state.params!.srcDocId = sp.get('srcDocId')!;
  }
  if (sp.has('style')) {
    let style = sp.get('style');
    if (style === 'light') {
      style = 'singlePage';
    }

    state.params!.style = InterfaceStyle.parse(style);
  }
  if (sp.has('embed')) {
    const embed = state.params!.embed = isAffirmative(sp.get('embed'));
    // Turn view mode on if no mode has been specified, and not a fork.
    if (embed && !state.mode && !state.fork) { state.mode = 'view'; }
    // Turn on single page style if no style has been specified.
    if (embed && !state.params!.style) { state.params!.style = 'singlePage'; }
  }

  // Theme overrides
  if (sp.has('themeSyncWithOs')) {
    state.params!.themeSyncWithOs = isAffirmative(sp.get('themeSyncWithOs'));
  }

  if (sp.has('themeAppearance')) {
    const appearance = sp.get('themeAppearance');
    if (appearance && themeAppearances.includes(appearance as ThemeAppearance)) {
      state.params!.themeAppearance = appearance as ThemeAppearance;
    }
  }

  if (sp.has('themeName')) {
    const themeName = sp.get('themeName');
    if (themeName && themeNames.includes(themeName as ThemeName)) {
      state.params!.themeName = themeName as ThemeName;
    }
  }

  if (sp.has('details')) {
    state.params!.details = isAffirmative(sp.get('details'));
  }

  if (sp.has('compare')) {
    state.params!.compare = sp.get('compare')!;
  }
  const linkParameters = decodeLinkParameters(sp);
  if (linkParameters) {
    state.params!.linkParameters = linkParameters;
  }

  if (sp.has('assistantPrompt')) {
    state.params!.assistantPrompt = sp.get('assistantPrompt')!;
  }

  if (sp.has('assistantState')) {
    state.params!.assistantState = sp.get('assistantState')!;
  }

  if (location.hash) {
    const hash = location.hash;
    const hashParts = hash.split('.');
    const hashMap = new Map<string, string>();
    for (const part of hashParts) {
      if (part.startsWith('rr')) {
        hashMap.set(part.slice(0, 2), part.slice(2));
      } else {
        hashMap.set(part.slice(0, 1), part.slice(1));
      }
    }
    state.homePageTab = HomePageTab.parse(hashMap.get('#'));
    state.adminPanelTab = AdminPanelTab.parse(hashMap.get('#'));
    const anchor = PersistentAnchor.parse(hashMap.get('#'));
    if (anchor) {
      state.hash = {
        anchor,
      };
    } else if (hashMap.has('#') && ['a1', 'a2', 'a3', 'a4'].includes(hashMap.get('#') || '')) {
      const link: HashLink = {};
      const keys = [
        'sectionId',
        'rowId',
        'colRef',
      ] as Array<'sectionId'|'rowId'|'colRef'>;
      for (const key of keys) {
        let ch: string;
        if (key === 'rowId' && hashMap.has('rr')) {
          ch = 'rr';
          link.rickRow = true;
        } else {
          ch = key.substr(0, 1);
          if (!hashMap.has(ch)) { continue; }
        }
        const value = hashMap.get(ch);
        if (key === 'rowId' && value === 'new') {
          link[key] = 'new';
        } else if (key === 'rowId' && value && value.includes("-")) {
          const rowIdParts = value.split("-").map(p => (p === 'new' ? p : parseInt(p, 10)));
          link[key] = rowIdParts[0];
          link.linkingRowIds = rowIdParts.slice(1);
        } else {
          link[key] = parseInt(value!, 10);
        }
      }
      if (hashMap.get('#') === 'a2') {
        link.popup = true;
      } else if (hashMap.get('#') === 'a3') {
        link.recordCard = true;
      } else if (hashMap.get('#') === 'a4') {
        link.comments = true;
      }
      state.hash = link;
    }
    state.welcomeTour = hashMap.get('#') === 'repeat-welcome-tour';
    state.docTour = hashMap.get('#') === 'repeat-doc-tour';
    state.manageUsers = hashMap.get('#') === 'manage-users';
    state.createTeam = hashMap.get('#') === 'create-team';
    state.upgradeTeam = hashMap.get('#') === 'upgrade-team';
  }
  return state;
}

export function decodeLinkParameters(sp: URLSearchParams) {
  let linkParameters: Record<string, string>|undefined = undefined;
  for (const [k, v] of sp.entries()) {
    if (k.endsWith('_')) {
      if (!linkParameters) { linkParameters = {}; }
      linkParameters[k.slice(0, k.length - 1)] = v;
    }
  }
  return linkParameters;
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

// Allowed localhost addresses.
const localhostRegex = /^localhost(?::(\d+))?$/i;

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
 * For a packaged version of Grist that requires activation, this
 * summarizes the current state. Not applicable to grist-core.
 * This is the thing that is send via sendAppPage (so this is embedded in HTML).
 */
export interface ActivationState {
  installationId: string;    // Unique identifier for this installation.
  key?: {                    // Set when Grist is activated.
    expirationDate?: string; // ISO8601 date that Grist will need reactivation.
    daysLeft?: number;       // Number of days until Grist will need reactivation.
  },
  trial?: {                  // Present when installation has not yet been activated.
    days: number;            // Max number of days allowed prior to activation.
    expirationDate: string;  // ISO8601 date that Grist will get cranky.
    daysLeft: number;        // Number of days left until Grist will get cranky.
  },
  needKey?: boolean;         // Set when Grist is cranky and demanding activation.
  error?: string;            // Present when there is an error reading the key.
  features?: PlanFeatures;   // Features available in this installation.
  current?: Partial<PlanFeatures>; // Usage of features in this installation.
  grace?: {
    daysLeft: number;       // Number of days left in grace period.
    graceStarted: string;   // ISO8601 date when grace period started.
  }
}

export interface LatestVersionAvailable {
  version: string;
  isNewer: boolean;
  isCritical: boolean;
  dateChecked: number;
  releaseUrl?: string;
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

  // Makes the Grist frontend access the Grist instance using its current URL in the browser, rather than APP_HOME_URL.
  // Used to simplify setup of single-domain (no subdomain / doc worker) installations.
  serveSameOrigin?: boolean;

  // Base domain for constructing new URLs, should start with "." and not include port, e.g.
  // ".getgrist.com". It should be unset for localhost operation and in single-org mode.
  baseDomain?: string;

  // In single-org mode, this is the single well-known org. Suppress any org selection UI.
  singleOrg?: string;

  // Url for support for the browser client to use.
  helpCenterUrl?: string;

  // Url for terms of service for the browser client to use
  termsOfServiceUrl?: string;

  // Url for free coaching call scheduling for the browser client to use.
  freeCoachingCallUrl?: string;

  // Url for "contact support" button on Grist's "not found" error page
  contactSupportUrl?: string;

  // Url for webinars.
  webinarsUrl?: string;

  // When set, this directs the client to encode org information in path, not in domain.
  pathOnly?: boolean;

  // Type of error page to show. This is used for pages such as "signed-out" and "not-found",
  // which don't include the full app.
  errPage?: string;

  // When errPage is a generic "other-error", this is the message to show.
  errMessage?: string;

  // When errPage is a generic page, not an error, this is additional details to show.
  errDetails?: Record<string, string>;

  // When an error page is shown in response to a request for an URL, this is the URL that was
  // originally requested — this may not be the URL we're responding to, because of an
  // intermediate redirect in case of e.g. an OIDC sign-in.
  // The error page will set the browser's current URL to that, so that the user can
  // retry by simply refreshing the page.
  errTargetUrl?: string;

  // URL for client to use for untrusted content.
  pluginUrl?: string;

  // Stripe API key for use on the client.
  stripeAPIKey?: string;

  // BeaconID for the support widget from HelpScout.
  helpScoutBeaconId?: string;

  // If set, enable anonymous sharing UI elements.
  supportAnon?: boolean;

  // If set, enable anonymous playground.
  enableAnonPlayground?: boolean;

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

  // If additional custom widgets (besides the Custom URL widget) should be shown in
  // the custom widget gallery.
  enableWidgetRepository?: boolean;

  // Whether there is somewhere for survey data to go.
  survey?: boolean;

  // Google Tag Manager id. Currently only used to load tag manager for reporting new sign-ups.
  tagManagerId?: string;

  activation?: ActivationState;

  // Latest Grist release available
  latestVersionAvailable?: LatestVersionAvailable;

  // Is automatic version checking allowed?
  automaticVersionCheckingAllowed?: boolean;

  // List of enabled features.
  features?: IFeature[];

  // String to append to the end of the HTML document.title
  pageTitleSuffix?: string;

  // If custom CSS should be included in the head of each page.
  enableCustomCss?: boolean;

  // Supported languages for the UI. By default only english (en) is supported.
  supportedLngs?: readonly string[];

  // Loaded namespaces for translations.
  namespaces?: readonly string[];

  assistant?: AssistantConfig;

  permittedCustomWidgets?: IAttachedCustomWidget[];

  // Email address of the support user.
  supportEmail?: string;

  // Current user locale, read from the user options;
  userLocale?: string;

  // Telemetry config.
  telemetry?: TelemetryConfig;

  // The Grist deployment type (e.g. core, enterprise).
  deploymentType?: GristDeploymentType;

  // Force enterprise deployment? For backwards compatibility with grist-ee Docker image
  forceEnableEnterprise?: boolean;

  // The org containing public templates and tutorials.
  templateOrg?: string|null;

  // The doc id of the tutorial shown during onboarding.
  onboardingTutorialDocId?: string;

  // The id of the Youtube video to show for the onboarding
  onboardingTutorialVideoId?: string;

  // Whether to show the "Delete Account" button in the account page.
  canCloseAccount?: boolean;

  experimentalPlugins?: boolean;

  // If backend has an email service for sending notifications.
  notifierEnabled?: boolean;

  // Set on /admin pages only, when AdminControls are available and should be enabled in UI.
  adminControls?: boolean;

  formFraming?: FormFraming;

  adminDefinedUrls?: string;

  // Maximum users to display for user presence features (e.g. active user list)
  userPresenceMaxUsers?: number;
}

export const Features = StringUnion(
  "helpCenter",
  "billing",
  "templates",
  "createSite",
  "multiSite",
  "multiAccounts",
  "sendToDrive",
  "tutorials",
  "supportGrist",
  "themes",
);
export type IFeature = typeof Features.type;

export function isFeatureEnabled(feature: IFeature): boolean {
  return (getGristConfig().features || []).includes(feature);
}

export function getPageTitleSuffix(config?: GristLoadConfig) {
  return config?.pageTitleSuffix ?? " - Grist";
}

export interface TelemetryConfig {
  telemetryLevel: TelemetryLevel;
}

export const GristDeploymentTypes = StringUnion('saas', 'core', 'enterprise', 'electron', 'static');
export type GristDeploymentType = typeof GristDeploymentTypes.type;


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

function getCustomizableValue(
  clientSideConfigKey: keyof GristLoadConfig,
  serverSideEnvVar: keyof NodeJS.ProcessEnv
) {
  return isClient() ? (window as any).gristConfig?.[clientSideConfigKey] : process.env[serverSideEnvVar];
}

/**
 * Returns a known org "subdomain" if Grist is configured in single-org mode
 * (GRIST_SINGLE_ORG=<org> on the server) or if the page includes an org in gristConfig.
 */
export function getSingleOrg(): string|null {
  return getCustomizableValue('singleOrg', 'GRIST_SINGLE_ORG') || null;
}

export function getHelpCenterUrl(): string {
  const defaultUrl = 'https://support.getgrist.com';
  return getCustomizableValue('helpCenterUrl', 'GRIST_HELP_CENTER') || defaultUrl;
}

export function getOnboardingVideoId(): string {
  const defaultId = '56AieR9rpww';
  return getCustomizableValue('onboardingTutorialVideoId', 'GRIST_ONBOARDING_VIDEO_ID') || defaultId;
}

export function getTermsOfServiceUrl(): string|undefined {
  return getCustomizableValue('termsOfServiceUrl', 'GRIST_TERMS_OF_SERVICE_URL') || undefined;
}

export function getFreeCoachingCallUrl(): string {
  const defaultUrl = 'https://calendly.com/grist-team/grist-free-coaching-call';
  return getCustomizableValue('freeCoachingCallUrl', 'FREE_COACHING_CALL_URL') || defaultUrl;
}

export function getContactSupportUrl(): string {
  const defaultUrl = 'https://www.getgrist.com/contact';
  return getCustomizableValue('contactSupportUrl', 'GRIST_CONTACT_SUPPORT_URL') || defaultUrl;
}

export function getWebinarsUrl(): string {
  const defaultUrl = 'https://www.getgrist.com/webinars';
  return getCustomizableValue('webinarsUrl', 'GRIST_WEBINARS_URL') || defaultUrl;
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
    if (host && host.match(localhostRegex)) { return true; }
    return (process.env.GRIST_ORG_IN_PATH === 'true');
  }
}

// Extract an organization name from the host.  Returns null if an organization name
// could not be recovered.  Organization name may be overridden by server configuration.
export function getOrgFromHost(reqHost: string): string|null {
  const singleOrg = getSingleOrg();
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
  let orgFromHost: string|null = getSingleOrg();

  if (!orgFromHost && reqHost) {
    orgFromHost = getOrgFromHost(reqHost);
    if (orgFromHost) {
      // Some subdomains are shared, and do not reflect the name of an organization.
      // See /documentation/urls.md for a list.
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
 * The internal structure of a UrlId. There is no internal structure,
 * except in the following cases. The id may be for a fork, in which
 * case the fork has a separate id, and a user id may also be embedded
 * to track ownership. The id may be a share key, in which case it
 * has some special syntax to identify it as so.
 */
export interface UrlIdParts {
  trunkId: string;
  forkId?: string;
  forkUserId?: number;
  snapshotId?: string;
  shareKey?: string;
}

// Parse a string of the form trunkId or trunkId~forkId or trunkId~forkId~forkUserId
// or trunkId[....]~v=snapshotId
// or <SHARE-KEY-PREFIX>shareKey
export function parseUrlId(urlId: string): UrlIdParts {
  let snapshotId: string|undefined;
  const parts = urlId.split('~');
  const bareParts = parts.filter(part => !part.includes('v='));
  for (const part of parts) {
    if (part.startsWith('v=')) {
      snapshotId = decodeURIComponent(part.substr(2).replace(/_/g, '%'));
    }
  }
  const trunkId = bareParts[0];
  // IDs starting with SHARE_KEY_PREFIX are in fact shares.
  const shareKey = removePrefix(trunkId, SHARE_KEY_PREFIX) || undefined;
  return {
    trunkId: bareParts[0],
    forkId: bareParts[1],
    forkUserId: (bareParts[2] !== undefined) ? parseInt(bareParts[2], 10) : undefined,
    snapshotId,
    shareKey,
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
      .replace(/[_.!~*'()-]/g, ch => `_${ch.charCodeAt(0).toString(16).toUpperCase()}`)
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
  popup?: boolean;
  comments?: boolean; // Whether to show comments in the popup.
  rickRow?: boolean;
  recordCard?: boolean;
  linkingRowIds?: UIRowId[];
  anchor?: string;
}

/**
 * Encode a HashLink as a string to include as the URL fragment (hash prooperty). For example,
 * in https://templates.getgrist.com/doc/lightweight-crm#a1.s1.r7.c2, the "a1.s1.r7.c2" portion is
 * the anchor link. The parts have the following meaning:
 *    a = identifies the type of link (1 is normal, 2 for popup, 3 for record-card)
 *    s = sectionId (rowId of the page-widget)
 *    r = rowId (of the actual row in the user table)
 *    c = colRef (rowId of the column's metadata record)
 */
export function makeAnchorLinkValue(hash: HashLink): string {
  const hashParts: string[] = [];
  if (hash.rowId || hash.popup || hash.recordCard) {
    if (hash.comments) {
      hashParts.push('a4');
    } else if (hash.recordCard) {
      hashParts.push('a3');
    } else if (hash.popup) {
      hashParts.push('a2');
    } else if (hash.anchor) {
      hashParts.push(hash.anchor);
    } else {
      hashParts.push('a1');
    }
    for (const key of ['sectionId', 'rowId', 'colRef'] as Array<keyof HashLink>) {
      let enhancedRowId: string|undefined;
      if (key === 'rowId' && hash.linkingRowIds?.length) {
        enhancedRowId = [hash.rowId, ...hash.linkingRowIds].join("-");
      }
      const partValue = enhancedRowId ?? hash[key];
      if (partValue) {
        const partKey = key === 'rowId' && hash.rickRow ? 'rr' : key[0];
        hashParts.push(`${partKey}${partValue}`);
      }
    }
  }
  return hashParts.join('.');
}

// Check whether a urlId is a prefix of the docId, and adequately long to be
// a candidate for use in prettier urls.
function shouldIncludeSlug(doc: {id: string, urlId: string|null}): boolean {
  if (!doc.urlId || doc.urlId.length < MIN_URLID_PREFIX_LENGTH) { return false; }
  return doc.id.startsWith(doc.urlId) || doc.urlId.startsWith(SHARE_KEY_PREFIX);
}

// Convert the name of a document into a slug. The slugify library normalizes unicode characters,
// replaces those with a reasonable ascii representation. Only alphanumerics are retained, and
// spaces are replaced with hyphens.
function nameToSlug(name: string): string {
  return slugify(name, {strict: true});
}

// Returns a slug for the given docId/urlId/name, or undefined if a slug should
// not be used.
export function getSlugIfNeeded(doc: {id: string, urlId: string|null, name: string}): string|undefined {
  if (!shouldIncludeSlug(doc)) { return; }
  return nameToSlug(doc.name);
}

/**
 * It is possible we want to remap Grist URLs in some way - specifically,
 * grist-static does this. We allow for a hook that is called after
 * encoding state as a URL, and a hook that is called before decoding
 * state from a URL.
 */
export interface UrlTweaks {
  /**
   * Tweak an encoded URL. Operates on the URL directly, in place.
   */
  postEncode?(options: {
    url: URL,
    parts: string[],
    state: IGristUrlState,
    baseLocation: Location | URL,
  }): void;

  /**
   * Tweak a URL prior to decoding it. Operates on the URL directly, in place.
   */
  preDecode?(options: {
    url: URL,
  }): void;
}

function withAdminDefinedUrls(defaultUrls: ICommonUrls): ICommonUrls {
  const adminDefinedUrlsStr = getCustomizableValue('adminDefinedUrls', "GRIST_CUSTOM_COMMON_URLS");
  if (!adminDefinedUrlsStr) {
    return defaultUrls;
  }

  let adminDefinedUrls;
  try {
    adminDefinedUrls = JSON.parse(adminDefinedUrlsStr);
  } catch(e) {
    throw new Error("The JSON passed to GRIST_CUSTOM_COMMON_URLS is malformed");
  }

  const merged = {
    ...defaultUrls,
    ...(adminDefinedUrls)
  };
  ICommonUrlsChecker.strictCheck(merged);
  return merged;
}
