import {AppModel, getHomeUrl, reportError} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {IFormData} from 'app/client/ui/BillingForm';
import {BillingAPI, BillingAPIImpl, BillingSubPage,
        BillingTask, IBillingPlan, IBillingSubscription} from 'app/common/BillingAPI';
import {FullUser} from 'app/common/LoginSessionAPI';
import {bundleChanges, Computed, Disposable, Observable} from 'grainjs';

export interface BillingModel {
  readonly error: Observable<string|null>;
  // Plans available to the user.
  readonly plans: Observable<IBillingPlan[]>;
  // Client-friendly version of the IBillingSubscription fetched from the server.
  // See ISubscriptionModel for details.
  readonly subscription: Observable<ISubscriptionModel|undefined>;

  readonly currentSubpage: Computed<BillingSubPage|undefined>;
  // The billingTask query param of the url - indicates the current operation, if any.
  // See BillingTask in BillingAPI for details.
  readonly currentTask: Computed<BillingTask|undefined>;
  // The planId of the plan to which the user is in process of signing up.
  readonly signupPlanId: Computed<string|undefined>;
  // The plan to which the user is in process of signing up.
  readonly signupPlan: Computed<IBillingPlan|undefined>;
  // Indicates whether the request for billing account information fails with unauthorized.
  // Initialized to false until the request is made.
  readonly isUnauthorized: Observable<boolean>;

  reportBlockingError(this: void, err: Error): void;

  // Fetch billing account managers.
  fetchManagers(): Promise<FullUser[]>;
  // Add billing account manager.
  addManager(email: string): Promise<void>;
  // Remove billing account manager.
  removeManager(email: string): Promise<void>;
  // Returns a boolean indicating if the org domain string is available.
  isDomainAvailable(domain: string): Promise<boolean>;
  // Fetches subscription data associated with the given org, if the pages are associated with an
  // org and the user is a plan manager. Otherwise, fetches available plans only.
  fetchData(forceReload?: boolean): Promise<void>;
  // Triggered when submit is clicked on the payment page. Performs the API billing account
  // management call based on currentTask, signupPlan and whether an address/tokenId was submitted.
  submitPaymentPage(formData?: IFormData): Promise<void>;
  // Cancels current subscription.
  cancelCurrentPlan(): Promise<void>;
  // Retrieves customer portal session URL.
  getCustomerPortalUrl(): string;
  // Renews plan (either by opening customer portal or creating Stripe Checkout session)
  renewPlan(): string;
}

export interface ISubscriptionModel extends IBillingSubscription {
  // The active plan.
  activePlan: IBillingPlan|null;
  // The upcoming plan, or null if the current plan is not set to end.
  upcomingPlan: IBillingPlan|null;
}

/**
 * Creates the model for the BillingPage. See app/client/ui/BillingPage for details.
 */
export class BillingModelImpl extends Disposable implements BillingModel {
  public readonly error = Observable.create<string|null>(this, null);
  // Plans available to the user.
  public readonly plans: Observable<IBillingPlan[]> = Observable.create(this, []);
  // Client-friendly version of the IBillingSubscription fetched from the server.
  // See ISubscriptionModel for details.
  public readonly subscription: Observable<ISubscriptionModel|undefined> = Observable.create(this, undefined);

  public readonly currentSubpage: Computed<BillingSubPage|undefined> =
    Computed.create(this, urlState().state, (use, s) => s.billing === 'billing' ? undefined : s.billing);
  // The billingTask query param of the url - indicates the current operation, if any.
  // See BillingTask in BillingAPI for details.
  public readonly currentTask: Computed<BillingTask|undefined> =
    Computed.create(this, urlState().state, (use, s) => s.params && s.params.billingTask);
  // The planId of the plan to which the user is in process of signing up.
  public readonly signupPlanId: Computed<string|undefined> =
    Computed.create(this, urlState().state, (use, s) => s.params && s.params.billingPlan);
  // The plan to which the user is in process of signing up.
  public readonly signupPlan: Computed<IBillingPlan|undefined> =
    Computed.create(this, this.plans, this.signupPlanId, (use, plans, pid) => plans.find(_p => _p.id === pid));


  // Indicates whether the request for billing account information fails with unauthorized.
  // Initialized to false until the request is made.
  public readonly isUnauthorized: Observable<boolean> = Observable.create(this, false);

  public readonly reportBlockingError = this._reportBlockingError.bind(this);

  private readonly _billingAPI: BillingAPI = new BillingAPIImpl(getHomeUrl());

  constructor(private _appModel: AppModel) {
    super();
  }

  // Fetch billing account managers to initialize the dom.
  public async fetchManagers(): Promise<FullUser[]> {
    const billingAccount = await this._billingAPI.getBillingAccount();
    return billingAccount.managers;
  }

  public async addManager(email: string): Promise<void> {
    await this._billingAPI.updateBillingManagers({
      users: {[email]: 'managers'}
    });
  }

  public async removeManager(email: string): Promise<void> {
    await this._billingAPI.updateBillingManagers({
      users: {[email]: null}
    });
  }

  public isDomainAvailable(domain: string): Promise<boolean> {
    return this._billingAPI.isDomainAvailable(domain);
  }

  public getCustomerPortalUrl() {
    return this._billingAPI.customerPortal();
  }

  public renewPlan() {
    return this._billingAPI.renewPlan();
  }

  public async cancelCurrentPlan() {
    const data = await this._billingAPI.cancelCurrentPlan();
    return data;
  }

  public async submitPaymentPage(formData: IFormData = {}): Promise<void> {
    const task = this.currentTask.get();
    // TODO: The server should prevent most of the errors in this function from occurring by
    // redirecting improper urls.
    try {
      if (task === 'signUpLite' || task === 'updateDomain') {
        // All that can change here is company name, and domain.
        const org = this._appModel.currentOrg;
        const name = formData.settings && formData.settings.name;
        const domain = formData.settings && formData.settings.domain;
        const newDomain = domain !== org?.domain;
        const newSettings = org && (name !== org.name || newDomain) && formData.settings;
        // If the address or settings have a new value, run the update.
        if (newSettings) {
          await this._billingAPI.updateSettings(newSettings || undefined);
        }
        // If the domain has changed, should redirect page.
        if (newDomain) {
          window.location.assign(urlState().makeUrl({ org: domain, billing: 'billing', params: undefined }));
          return;
        }
        // If there is an org update, re-initialize the org in the client.
        if (newSettings) { this._appModel.topAppModel.initialize(); }
      } else {
        throw new Error('BillingPage _submit error: no task in progress');
      }
      // Show the billing summary page after submission
      await urlState().pushUrl({ billing: 'billing', params: undefined });
    } catch (err) {
      // TODO: These errors may need to be reported differently since they're not user-friendly
      reportError(err);
      throw err;
    }
  }

  // If forceReload is set, re-fetches and updates already fetched data.
  public async fetchData(forceReload: boolean = false): Promise<void> {
    // If these are billing settings pages for an existing org, fetch the subscription data.
    await this._fetchSubscription(forceReload);
  }

  private _reportBlockingError(err: Error) {
    // TODO billing pages don't instantiate notifications UI (they probably should).
    reportError(err);
    const details = (err as any).details;
    const message = (details && details.userError) || err.message;
    this.error.set(message);
  }

  private async _fetchSubscription(forceReload: boolean = false): Promise<void> {
    if (forceReload || this.subscription.get() === undefined) {
      try {
        // Unset while fetching for forceReload, so that the user (and tests) can tell that a
        // fetch is pending.
        this.subscription.set(undefined);
        const sub = await this._billingAPI.getSubscription();
        bundleChanges(() => {
          this.plans.set(sub.plans);
          const subModel: ISubscriptionModel = {
            activePlan: sub.plans[sub.planIndex],
            upcomingPlan: sub.upcomingPlanIndex !== sub.planIndex ? sub.plans[sub.upcomingPlanIndex] : null,
            ...sub
          };
          this.subscription.set(subModel);
          // Clear the fetch errors on success.
          this.isUnauthorized.set(false);
          this.error.set(null);
        });
      } catch (e) {
        if (e.status === 401 || e.status === 403) { this.isUnauthorized.set(true); }
        throw e;
      }
    }
  }
}
