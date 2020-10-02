import {reportError, setErrorNotifier} from 'app/client/models/errors';
import {urlState} from 'app/client/models/gristUrlState';
import {Notifier} from 'app/client/models/NotifyModel';
import {getFlavor, ProductFlavor} from 'app/client/ui/CustomThemes';
import {Features} from 'app/common/Features';
import {GristLoadConfig} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import {getOrgName, Organization, OrgError, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {Computed, Disposable, Observable, subscribe} from 'grainjs';

export {reportError} from 'app/client/models/errors';

export type PageType = "doc" | "home" | "billing" | "welcome";

// TopAppModel is the part of the app model that persists across org and user switches.
export interface TopAppModel {
  api: UserAPI;
  isSingleOrg: boolean;
  productFlavor: ProductFlavor;
  currentSubdomain: Observable<string|undefined>;

  notifier: Notifier;

  // Everything else gets fully rebuilt when the org/user changes. This is to ensure that
  // different parts of the code aren't using different users/orgs while the switch is pending.
  appObs: Observable<AppModel|null>;

  // Reinitialize the app. This is called when org or user changes.
  initialize(): void;

  // Rebuilds the AppModel and consequently the AppUI, without changing the user or the org.
  reload(): void;
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
  orgError?: OrgError;                  // If currentOrg is null, the error that caused it.

  currentFeatures: Features;            // features of the current org's product.

  pageType: Observable<PageType>;

  notifier: Notifier;
}

export class TopAppModelImpl extends Disposable implements TopAppModel {
  public readonly isSingleOrg: boolean;
  public readonly productFlavor: ProductFlavor;

  public readonly currentSubdomain = Computed.create(this, urlState().state, (use, s) => s.org);
  public readonly notifier = Notifier.create(this);
  public readonly appObs = Observable.create<AppModel|null>(this, null);

  constructor(
    window: {gristConfig?: GristLoadConfig},
    public readonly api: UserAPI = new UserAPIImpl(getHomeUrl()),
  ) {
    super();
    setErrorNotifier(this.notifier);
    this.isSingleOrg = Boolean(window.gristConfig && window.gristConfig.singleOrg);
    this.productFlavor = getFlavor(window.gristConfig && window.gristConfig.org);

    // Initially, and on any change to subdomain, call initialize() to get the full Organization
    // and the FullUser to use for it (the user may change when switching orgs).
    this.autoDispose(subscribe(this.currentSubdomain, (use) => this.initialize()));
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
          this.notifier.createUserError(
            'This team site is suspended. Documents can be read, but not modified.',
            {actions: ['renew']}
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

  public readonly currentFeatures = (this.currentOrg && this.currentOrg.billingAccount) ?
    this.currentOrg.billingAccount.product.features : {};

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
