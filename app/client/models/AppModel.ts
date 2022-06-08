import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {error} from 'app/client/lib/log';
import {reportError, setErrorNotifier} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {Notifier} from 'app/client/models/NotifyModel';
import {getFlavor, ProductFlavor} from 'app/client/ui/CustomThemes';
import {OrgUsageSummary} from 'app/common/DocUsage';
import {Features} from 'app/common/Features';
import {GristLoadConfig} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import {LocalPlugin} from 'app/common/plugin';
import {UserPrefs} from 'app/common/Prefs';
import {isOwner} from 'app/common/roles';
import {getTagManagerScript} from 'app/common/tagManager';
import {getGristConfig} from 'app/common/urlUtils';
import {getOrgName, Organization, OrgError, SUPPORT_EMAIL, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {getUserPrefObs, getUserPrefsObs} from 'app/client/models/UserPrefs';
import {bundleChanges, Computed, Disposable, Observable, subscribe} from 'grainjs';
import {buildNewSiteModal, buildUpgradeModal} from 'app/client/ui/ProductUpgrades';

export {reportError} from 'app/client/models/errors';

export type PageType = "doc" | "home" | "billing" | "welcome";
const G = getBrowserGlobals('document', 'window');

// TopAppModel is the part of the app model that persists across org and user switches.
export interface TopAppModel {
  api: UserAPI;
  isSingleOrg: boolean;
  productFlavor: ProductFlavor;
  currentSubdomain: Observable<string|undefined>;

  notifier: Notifier;
  plugins: LocalPlugin[];

  // Everything else gets fully rebuilt when the org/user changes. This is to ensure that
  // different parts of the code aren't using different users/orgs while the switch is pending.
  appObs: Observable<AppModel|null>;

  orgs: Observable<Organization[]>;
  users: Observable<FullUser[]>;

  // Reinitialize the app. This is called when org or user changes.
  initialize(): void;

  // Rebuilds the AppModel and consequently the AppUI, without changing the user or the org.
  reload(): void;

  /**
   * Returns the UntrustedContentOrigin use settings. Throws if not defined.
   */
  getUntrustedContentOrigin(): string;
}

// AppModel is specific to the currently loaded organization and active user. It gets rebuilt when
// we switch the current organization or the current user.
export interface AppModel {
  topAppModel: TopAppModel;
  api: UserAPI;

  currentUser: FullUser|null;
  currentValidUser: FullUser|null;      // Like currentUser, but null when anonymous

  currentOrg: Organization|null;        // null if no access to currentSubdomain
  currentOrgName: string;               // Our best guess for human-friendly name.
  currentOrgUsage: Observable<OrgUsageSummary|null>;
  isPersonal: boolean;                  // Is it a personal site?
  isTeamSite: boolean;                  // Is it a team site?
  orgError?: OrgError;                  // If currentOrg is null, the error that caused it.

  currentFeatures: Features;            // features of the current org's product.
  userPrefsObs: Observable<UserPrefs>;

  pageType: Observable<PageType>;

  notifier: Notifier;
  planName: string|null;

  refreshOrgUsage(): Promise<void>;
  showUpgradeModal(): void;
  showNewSiteModal(): void;
  isBillingManager(): boolean;          // If user is a billing manager for this org
  isSupport(): boolean;                 // If user is a Support user
}

export class TopAppModelImpl extends Disposable implements TopAppModel {
  public readonly isSingleOrg: boolean;
  public readonly productFlavor: ProductFlavor;

  public readonly currentSubdomain = Computed.create(this, urlState().state, (use, s) => s.org);
  public readonly notifier = Notifier.create(this);
  public readonly appObs = Observable.create<AppModel|null>(this, null);
  public readonly orgs = Observable.create<Organization[]>(this, []);
  public readonly users = Observable.create<FullUser[]>(this, []);
  public readonly plugins: LocalPlugin[] = [];
  private readonly _gristConfig?: GristLoadConfig;

  constructor(
    window: {gristConfig?: GristLoadConfig},
    public readonly api: UserAPI = new UserAPIImpl(getHomeUrl()),
  ) {
    super();
    setErrorNotifier(this.notifier);
    this.isSingleOrg = Boolean(window.gristConfig && window.gristConfig.singleOrg);
    this.productFlavor = getFlavor(window.gristConfig && window.gristConfig.org);
    this._gristConfig = window.gristConfig;

    // Initially, and on any change to subdomain, call initialize() to get the full Organization
    // and the FullUser to use for it (the user may change when switching orgs).
    this.autoDispose(subscribe(this.currentSubdomain, (use) => this.initialize()));
    this.plugins = this._gristConfig?.plugins || [];

    this._fetchUsersAndOrgs().catch(reportError);
  }

  public initialize(): void {
    this._doInitialize().catch(reportError);
  }

  // Rebuilds the AppModel and consequently the AppUI, etc, without changing the user or the org.
  public reload(): void {
    const app = this.appObs.get();
    if (app) {
      const {currentUser, currentOrg, orgError} = app;
      AppModelImpl.create(this.appObs, this, currentUser, currentOrg, orgError);
    }
  }

  public getUntrustedContentOrigin() {
    if (G.window.isRunningUnderElectron) {
      // when loaded within webviews it is safe to serve plugin's content from the same domain
      return "";
    }

    const origin =  this._gristConfig?.pluginUrl;
    if (!origin) {
      throw new Error("Missing untrustedContentOrigin configuration");
    }
    if (origin.match(/:[0-9]+$/)) {
      // Port number already specified, no need to add.
      return origin;
    }
    return origin + ":" + G.window.location.port;
  }

  private async _doInitialize() {
    this.appObs.set(null);
    try {
      const {user, org, orgError} = await this.api.getSessionActive();
      if (this.isDisposed()) { return; }
      if (org) {
        // Check that our domain matches what the api returns.
        const state = urlState().state.get();
        if (state.org !== org.domain && org.domain !== null) {
          // If not, redirect.  This is to allow vanity domains
          // to "stick" only if paid for.
          await urlState().pushUrl({...state, org: org.domain});
        }
        if (org.billingAccount && org.billingAccount.product &&
            org.billingAccount.product.name === 'suspended') {
          this.notifier.createUserMessage(
            'This team site is suspended. Documents can be read, but not modified.',
            {actions: ['renew', 'personal']}
          );
        }
      }
      AppModelImpl.create(this.appObs, this, user, org, orgError);
    } catch (err) {
      // tslint:disable-next-line:no-console
      console.log(`getSessionActive() failed: ${err}`);
      if (this.isDisposed()) { return; }
      AppModelImpl.create(this.appObs, this, null, null, {error: err.message, status: err.status || 500});
    }
  }

  private async _fetchUsersAndOrgs() {
    const data = await this.api.getSessionAll();
    if (this.isDisposed()) { return; }
    bundleChanges(() => {
      this.users.set(data.users);
      this.orgs.set(data.orgs);
    });
  }
}

export class AppModelImpl extends Disposable implements AppModel {
  public readonly api: UserAPI = this.topAppModel.api;

  // Compute currentValidUser, turning anonymous into null.
  public readonly currentValidUser: FullUser|null =
    this.currentUser && !this.currentUser.anonymous ? this.currentUser : null;

  // Figure out the org name, or blank if details are unavailable.
  public readonly currentOrgName = getOrgNameOrGuest(this.currentOrg, this.currentUser);

  public readonly currentOrgUsage: Observable<OrgUsageSummary|null> = Observable.create(this, null);

  public readonly isPersonal = Boolean(this.currentOrg?.owner);
  public readonly isTeamSite = Boolean(this.currentOrg) && !this.isPersonal;

  public readonly currentFeatures = (this.currentOrg && this.currentOrg.billingAccount) ?
    this.currentOrg.billingAccount.product.features : {};

  public readonly userPrefsObs = getUserPrefsObs(this);

  // Get the current PageType from the URL.
  public readonly pageType: Observable<PageType> = Computed.create(this, urlState().state,
    (use, state) => (state.doc ? "doc" : (state.billing ? "billing" : (state.welcome ? "welcome" : "home"))));

  public readonly notifier = this.topAppModel.notifier;

  constructor(
    public readonly topAppModel: TopAppModel,
    public readonly currentUser: FullUser|null,
    public readonly currentOrg: Organization|null,
    public readonly orgError?: OrgError,
  ) {
    super();
    this._recordSignUpIfIsNewUser();
  }

  public get planName() {
    return this.currentOrg?.billingAccount?.product.name ?? null;
  }

  public async showUpgradeModal() {
    if (this.planName && this.currentOrg) {
      buildUpgradeModal(this, this.planName);
    }
  }

  public async showNewSiteModal() {
    if (this.planName) {
      buildNewSiteModal(this, this.planName);
    }
  }

  public isSupport() {
    return this.currentValidUser?.email === SUPPORT_EMAIL;
  }

  public isBillingManager() {
    return Boolean(this.currentOrg?.billingAccount?.isManager);
  }

  /**
   * Fetch and update the current org's usage.
   */
  public async refreshOrgUsage() {
    const currentOrg = this.currentOrg;
    if (!isOwner(currentOrg)) {
      // Note: getOrgUsageSummary already checks for owner access; we do an early return
      // here to skip making unnecessary API calls.
      return;
    }

    const usage = await this.api.getOrgUsageSummary(currentOrg.id);
    if (!this.isDisposed()) {
      this.currentOrgUsage.set(usage);
    }
  }

  /**
   * If the current user is a new user, record a sign-up event via Google Tag Manager.
   */
  private _recordSignUpIfIsNewUser() {
    const isNewUser = this.userPrefsObs.get().recordSignUpEvent;
    if (!isNewUser) { return; }

    // If Google Tag Manager isn't configured, don't record anything.
    const {tagManagerId} = getGristConfig();
    if (!tagManagerId) { return; }

    let dataLayer = (window as any).dataLayer;
    if (!dataLayer) {
      // Load the Google Tag Manager script into the document.
      const script = document.createElement('script');
      script.innerHTML = getTagManagerScript(tagManagerId);
      document.head.appendChild(script);
      dataLayer = (window as any).dataLayer;
      if (!dataLayer) {
        error(`_recordSignUpIfIsNewUser() failed to load Google Tag Manager`);
      }
    }

    // Send the sign-up event, and remove the recordSignUpEvent flag from preferences.
    dataLayer.push({event: 'new-sign-up'});
    getUserPrefObs(this.userPrefsObs, 'recordSignUpEvent').set(undefined);
  }
}

export function getHomeUrl(): string {
  const {host, protocol} = window.location;
  const gristConfig: any = (window as any).gristConfig;
  return (gristConfig && gristConfig.homeUrl) || `${protocol}//${host}`;
}

export function getOrgNameOrGuest(org: Organization|null, user: FullUser|null) {
  if (!org) { return ''; }
  if (user && user.anonymous && org.owner && org.owner.id === user.id) {
    return "@Guest";
  }
  return getOrgName(org);
}
