import {BehavioralPromptsManager} from 'app/client/components/BehavioralPromptsManager';
import {hooks} from 'app/client/Hooks';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {makeT} from 'app/client/lib/localization';
import {sessionStorageObs} from 'app/client/lib/localStorageObs';
import {error} from 'app/client/lib/log';
import {reportError, setErrorNotifier} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {Notifier} from 'app/client/models/NotifyModel';
import {getFlavor, ProductFlavor} from 'app/client/ui/CustomThemes';
import {buildNewSiteModal, buildUpgradeModal} from 'app/client/ui/ProductUpgrades';
import {SupportGristNudge} from 'app/client/ui/SupportGristNudge';
import {attachCssThemeVars, prefersDarkModeObs} from 'app/client/ui2018/cssVars';
import {OrgUsageSummary} from 'app/common/DocUsage';
import {Features, isLegacyPlan, Product} from 'app/common/Features';
import {GristLoadConfig, IGristUrlState} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import {LocalPlugin} from 'app/common/plugin';
import {DismissedPopup, DismissedReminder, UserPrefs} from 'app/common/Prefs';
import {isOwner, isOwnerOrEditor} from 'app/common/roles';
import {getTagManagerScript} from 'app/common/tagManager';
import {getDefaultThemePrefs, Theme, ThemeColors, ThemePrefs,
        ThemePrefsChecker} from 'app/common/ThemePrefs';
import {getThemeColors} from 'app/common/Themes';
import {getGristConfig} from 'app/common/urlUtils';
import {getOrgName, isTemplatesOrg, Organization, OrgError, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {getUserPrefObs, getUserPrefsObs, markAsSeen, markAsUnSeen} from 'app/client/models/UserPrefs';
import {bundleChanges, Computed, Disposable, Observable, subscribe} from 'grainjs';

const t = makeT('AppModel');

// Reexported for convenience.
export {reportError} from 'app/client/models/errors';

export type PageType =
  | "doc"
  | "home"
  | "billing"
  | "welcome"
  | "account"
  | "support-grist"
  | "activation";

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
  /**
   * Reloads orgs and accounts for current user.
   */
  fetchUsersAndOrgs(): Promise<void>;
}

/**
 * AppModel is specific to the currently loaded organization and active user. It gets rebuilt when
 * we switch the current organization or the current user.
 */
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
  isLegacySite: boolean;                // Is it a legacy site?
  isTemplatesSite: boolean;             // Is it the templates site?
  orgError?: OrgError;                  // If currentOrg is null, the error that caused it.
  lastVisitedOrgDomain: Observable<string|null>;

  currentProduct: Product|null;         // The current org's product.
  currentFeatures: Features;            // Features of the current org's product.

  userPrefsObs: Observable<UserPrefs>;
  themePrefs: Observable<ThemePrefs>;
  currentTheme: Computed<Theme>;
  /**
   * Popups that user has seen.
   */
  dismissedPopups: Observable<DismissedPopup[]>;
  dismissedWelcomePopups: Observable<DismissedReminder[]>;

  pageType: Observable<PageType>;
  needsOrg: Observable<boolean>;

  notifier: Notifier;
  planName: string|null;

  behavioralPromptsManager: BehavioralPromptsManager;

  supportGristNudge: SupportGristNudge;

  refreshOrgUsage(): Promise<void>;
  showUpgradeModal(): void;
  showNewSiteModal(): void;
  isBillingManager(): boolean;          // If user is a billing manager for this org
  isSupport(): boolean;                 // If user is a Support user
  isOwner(): boolean;                   // If user is an owner of this org
  isOwnerOrEditor(): boolean;           // If user is an owner or editor of this org
  /** Creates an computed observable to dismiss a popup or check if it was dismissed */
  dismissedPopup(name: DismissedPopup): Observable<boolean>;
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
    public readonly api: UserAPI = newUserAPIImpl(),
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

    this.fetchUsersAndOrgs().catch(reportError);
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

  public async fetchUsersAndOrgs() {
    const data = await this.api.getSessionAll();
    if (this.isDisposed()) { return; }
    bundleChanges(() => {
      this.users.set(data.users);
      this.orgs.set(data.orgs);
    });
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
            t("This team site is suspended. Documents can be read, but not modified."),
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
}

export class AppModelImpl extends Disposable implements AppModel {
  public readonly api: UserAPI = this.topAppModel.api;

  // Compute currentValidUser, turning anonymous into null.
  public readonly currentValidUser: FullUser|null =
    this.currentUser && !this.currentUser.anonymous ? this.currentUser : null;

  // Figure out the org name, or blank if details are unavailable.
  public readonly currentOrgName = getOrgNameOrGuest(this.currentOrg, this.currentUser);

  public readonly currentOrgUsage: Observable<OrgUsageSummary|null> = Observable.create(this, null);

  public readonly lastVisitedOrgDomain = this.autoDispose(sessionStorageObs('grist-last-visited-org-domain'));

  public readonly currentProduct = this.currentOrg?.billingAccount?.product ?? null;
  public readonly currentFeatures = this.currentProduct?.features ?? {};

  public readonly isPersonal = Boolean(this.currentOrg?.owner);
  public readonly isTeamSite = Boolean(this.currentOrg) && !this.isPersonal;
  public readonly isLegacySite = Boolean(this.currentProduct && isLegacyPlan(this.currentProduct.name));
  public readonly isTemplatesSite = isTemplatesOrg(this.currentOrg);

  public readonly userPrefsObs = getUserPrefsObs(this);
  public readonly themePrefs = getUserPrefObs(this.userPrefsObs, 'theme', {
    defaultValue: getDefaultThemePrefs(),
    checker: ThemePrefsChecker,
  }) as Observable<ThemePrefs>;
  public readonly currentTheme = this._getCurrentThemeObs();

  public readonly dismissedPopups = getUserPrefObs(this.userPrefsObs, 'dismissedPopups',
    { defaultValue: [] }) as Observable<DismissedPopup[]>;
  public readonly dismissedWelcomePopups = getUserPrefObs(this.userPrefsObs, 'dismissedWelcomePopups',
    { defaultValue: [] }) as Observable<DismissedReminder[]>;

  // Get the current PageType from the URL.
  public readonly pageType: Observable<PageType> = Computed.create(this, urlState().state,
    (_use, state) => {
      if (state.doc) {
        return 'doc';
      } else if (state.billing) {
        return 'billing';
      } else if (state.welcome) {
        return 'welcome';
      } else if (state.account) {
        return 'account';
      } else if (state.supportGrist) {
        return 'support-grist';
      } else if (state.activation) {
        return 'activation';
      } else {
        return 'home';
      }
    });

  public readonly needsOrg: Observable<boolean> = Computed.create(
    this, urlState().state, (use, state) => {
      return !(
        Boolean(state.welcome) ||
        state.billing === 'scheduled' ||
        Boolean(state.account) ||
        Boolean(state.activation) ||
        Boolean(state.supportGrist)
      );
    });

  public readonly notifier = this.topAppModel.notifier;

  public readonly behavioralPromptsManager: BehavioralPromptsManager =
    BehavioralPromptsManager.create(this, this);

  public readonly supportGristNudge: SupportGristNudge = SupportGristNudge.create(this, this);

  constructor(
    public readonly topAppModel: TopAppModel,
    public readonly currentUser: FullUser|null,
    public readonly currentOrg: Organization|null,
    public readonly orgError?: OrgError,
  ) {
    super();

    this._applyTheme();
    this.autoDispose(this.currentTheme.addListener(() => this._applyTheme()));

    this._recordSignUpIfIsNewUser();

    const state = urlState().state.get();
    if (state.createTeam) {
      // Remove params from the URL.
      urlState().pushUrl({createTeam: false, params: {}}, {avoidReload: true, replace: true}).catch(() => {});
      this.showNewSiteModal(state.params?.planType);
    }

    G.window.resetDismissedPopups = (seen = false) => {
      this.dismissedPopups.set(seen ? DismissedPopup.values : []);
      this.behavioralPromptsManager.reset();
    };

    this.autoDispose(subscribe(urlState().state, this.topAppModel.orgs, async (_use, s, orgs) => {
      this._updateLastVisitedOrgDomain(s, orgs);
    }));
  }

  public get planName() {
    return this.currentProduct?.name ?? null;
  }

  public async showUpgradeModal() {
    if (this.planName && this.currentOrg) {
      if (this.isPersonal) {
        this.showNewSiteModal();
      } else if (this.isTeamSite) {
        buildUpgradeModal(this, this.planName);
      } else {
        throw new Error("Unexpected state");
      }
    }
  }

  public showNewSiteModal(selectedPlan?: string) {
    if (this.planName) {
      buildNewSiteModal(this, {
        planName: this.planName,
        selectedPlan,
        onCreate: () => this.topAppModel.fetchUsersAndOrgs().catch(reportError)
      });
    }
  }

  public isSupport() {
    return Boolean(this.currentValidUser?.isSupport);
  }

  public isBillingManager() {
    return Boolean(this.currentOrg?.billingAccount?.isManager);
  }

  public isOwner() {
    return Boolean(this.currentOrg && isOwner(this.currentOrg));
  }

  public isOwnerOrEditor() {
    return Boolean(this.currentOrg && isOwnerOrEditor(this.currentOrg));
  }

  /**
   * Fetch and update the current org's usage.
   */
  public async refreshOrgUsage() {
    if (!this.isOwner()) {
      // Note: getOrgUsageSummary already checks for owner access; we do an early return
      // here to skip making unnecessary API calls.
      return;
    }

    const usage = await this.api.getOrgUsageSummary(this.currentOrg!.id);
    if (!this.isDisposed()) {
      this.currentOrgUsage.set(usage);
    }
  }

  public dismissedPopup(name: DismissedPopup): Computed<boolean> {
    const computed = Computed.create(null, use => use(this.dismissedPopups).includes(name));
    computed.onWrite(value => {
      if (value) {
        markAsSeen(this.dismissedPopups, name);
      } else {
        markAsUnSeen(this.dismissedPopups, name);
      }
    });
    return computed;
  }

  private _updateLastVisitedOrgDomain({doc, org}: IGristUrlState, availableOrgs: Organization[]) {
    if (
      !org ||
      // Invalid or inaccessible sites shouldn't be counted as visited.
      !this.currentOrg ||
      // Visits to a document shouldn't be counted either.
      doc
    ) {
      return;
    }

    // Only count sites that a user has access to (i.e. those listed in the Site Switcher).
    if (!availableOrgs.some(({domain}) => domain === org)) { return; }

    this.lastVisitedOrgDomain.set(org);
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

  private _getCurrentThemeObs() {
    return Computed.create(this, this.themePrefs, prefersDarkModeObs(),
      (_use, themePrefs, prefersDarkMode) => {
        let {appearance, syncWithOS} = themePrefs;

        const urlParams = urlState().state.get().params;
        if (urlParams?.themeAppearance) {
          appearance = urlParams?.themeAppearance;
        }

        if (urlParams?.themeSyncWithOs !== undefined) {
          syncWithOS = urlParams?.themeSyncWithOs;
        }

        if (syncWithOS) {
          appearance = prefersDarkMode ? 'dark' : 'light';
        }

        let nameOrColors = themePrefs.colors[appearance];
        if (urlParams?.themeName) {
          nameOrColors = urlParams?.themeName;
        }

        let colors: ThemeColors;
        if (typeof nameOrColors === 'string') {
          colors = getThemeColors(nameOrColors);
        } else {
          colors = nameOrColors;
        }

        return {appearance, colors};
      },
    );
  }

  /**
   * Applies a theme based on the user's current theme preferences.
   */
  private _applyTheme() {
    // Custom CSS is incompatible with custom themes.
    if (getGristConfig().enableCustomCss) { return; }

    attachCssThemeVars(this.currentTheme.get());
  }
}

export function getHomeUrl(): string {
  const {host, protocol} = window.location;
  const gristConfig: any = (window as any).gristConfig;
  return (gristConfig && gristConfig.homeUrl) || `${protocol}//${host}`;
}

export function newUserAPIImpl(): UserAPIImpl {
  return new UserAPIImpl(getHomeUrl(), {
    fetch: hooks.fetch,
  });
}

export function getOrgNameOrGuest(org: Organization|null, user: FullUser|null) {
  if (!org) { return ''; }
  if (user && user.anonymous && org.owner && org.owner.id === user.id) {
    return "@Guest";
  }
  return getOrgName(org);
}
