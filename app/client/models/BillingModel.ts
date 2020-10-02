import {AppModel, getHomeUrl, reportError} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {IFormData} from 'app/client/ui/BillingForm';
import {BillingAPI, BillingAPIImpl, BillingSubPage, BillingTask} from 'app/common/BillingAPI';
import {IBillingCard, IBillingPlan, IBillingSubscription} from 'app/common/BillingAPI';
import {FullUser} from 'app/common/LoginSessionAPI';
import {bundleChanges, Computed, Disposable, Observable} from 'grainjs';
import isEqual = require('lodash/isEqual');
import omit = require('lodash/omit');

export interface BillingModel {
  readonly error: Observable<string|null>;
  // Plans available to the user.
  readonly plans: Observable<IBillingPlan[]>;
  // Client-friendly version of the IBillingSubscription fetched from the server.
  // See ISubscriptionModel for details.
  readonly subscription: Observable<ISubscriptionModel|undefined>;
  // Payment card fetched from the server.
  readonly card: Observable<IBillingCard|null>;

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
  // The tax rate to use for the sign up charge. Initialized by calling fetchSignupTaxRate.
  signupTaxRate: number|undefined;

  reportBlockingError(this: void, err: Error): void;

  // Fetch billing account managers.
  fetchManagers(): Promise<FullUser[]>;
  // Add billing account manager.
  addManager(email: string): Promise<void>;
  // Remove billing account manager.
  removeManager(email: string): Promise<void>;
  // Remove the payment card from the account.
  removeCard(): Promise<void>;
  // Returns a boolean indicating if the org domain string is available.
  isDomainAvailable(domain: string): Promise<boolean>;
  // Triggered when submit is clicked on the payment page. Performs the API billing account
  // management call based on currentTask, signupPlan and whether an address/tokenId was submitted.
  submitPaymentPage(formData?: IFormData): Promise<void>;
  // Fetches the effective tax rate for the address in the given form.
  fetchSignupTaxRate(formData: IFormData): Promise<void>;
  // Fetches subscription data associated with the given org, if the pages are associated with an
  // org and the user is a plan manager. Otherwise, fetches available plans only.
  fetchData(forceReload?: boolean): Promise<void>;
}

export interface ISubscriptionModel extends Omit<IBillingSubscription, 'plans'|'card'> {
  // The active plan.
  activePlan: IBillingPlan;
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
  // Payment card fetched from the server.
  public readonly card: Observable<IBillingCard|null> = Observable.create(this, null);

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
  // The tax rate to use for the sign up charge. Initialized by calling fetchSignupTaxRate.
  public signupTaxRate: number|undefined;

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

  // Remove the payment card from the account.
  public async removeCard(): Promise<void> {
    try {
      await this._billingAPI.removeCard();
      this.card.set(null);
    } catch (err) {
      reportError(err);
    }
  }

  public isDomainAvailable(domain: string): Promise<boolean> {
    return this._billingAPI.isDomainAvailable(domain);
  }

  public async submitPaymentPage(formData: IFormData = {}): Promise<void> {
    const task = this.currentTask.get();
    const planId = this.signupPlanId.get();
    // TODO: The server should prevent most of the errors in this function from occurring by
    // redirecting improper urls.
    try {
      if (task === 'signUp') {
        // Sign up from an unpaid plan to a paid plan.
        if (!planId) { throw new Error('BillingPage _submit error: no plan selected'); }
        if (!formData.token) { throw new Error('BillingPage _submit error: no card submitted'); }
        if (!formData.address) { throw new Error('BillingPage _submit error: no address submitted'); }
        if (!formData.settings) { throw new Error('BillingPage _submit error: no settings submitted'); }
        const o = await this._billingAPI.signUp(planId, formData.token, formData.address, formData.settings);
        if (o && o.domain) {
          await urlState().pushUrl({ org: o.domain, billing: 'billing', params: undefined });
        } else {
          // TODO: show problems nicely
          throw new Error('BillingPage _submit error: problem creating new organization');
        }
      } else {
        // Any task after sign up.
        if (task === 'updatePlan') {
          // Change plan from a paid plan to another paid plan or to the free plan.
          if (!planId) { throw new Error('BillingPage _submit error: no plan selected'); }
          await this._billingAPI.setSubscription(planId, formData.token);
        } else if (task === 'addCard' || task === 'updateCard') {
          // Add or update payment card.
          if (!formData.token) { throw new Error('BillingPage _submit error: missing card info token'); }
          await this._billingAPI.setCard(formData.token);
        } else if (task === 'updateAddress') {
          const org = this._appModel.currentOrg;
          const sub = this.subscription.get();
          const name = formData.settings && formData.settings.name;
          // Get the values of the new address and settings if they have changed.
          const newAddr = sub && !isEqual(formData.address, sub.address) && formData.address;
          const newSettings = org && (name !== org.name) && formData.settings;
          // If the address or settings have a new value, run the update.
          if (newAddr || newSettings) {
            await this._billingAPI.updateAddress(newAddr || undefined, newSettings || undefined);
          }
          // If there is an org update, re-initialize the org in the client.
          if (newSettings) { await this._appModel.topAppModel.initialize(); }
        } else {
          throw new Error('BillingPage _submit error: no task in progress');
        }
        // Show the billing summary page after submission
        await urlState().pushUrl({ billing: 'billing', params: undefined });
      }
    } catch (err) {
      // TODO: These errors may need to be reported differently since they're not user-friendly
      reportError(err);
      throw err;
    }
  }

  public async fetchSignupTaxRate(formData: IFormData): Promise<void> {
    try {
      if (this.currentTask.get() !== 'signUp') {
        throw new Error('fetchSignupTaxRate only available during signup');
      }
      if (!formData.address) {
        throw new Error('Signup form data must include address');
      }
      this.signupTaxRate = await this._billingAPI.getTaxRate(formData.address);
    } catch (err) {
      // TODO: These errors may need to be reported differently since they're not user-friendly
      reportError(err);
      throw err;
    }
  }

  // If forceReload is set, re-fetches and updates already fetched data.
  public async fetchData(forceReload: boolean = false): Promise<void> {
    if (this.currentSubpage.get() === 'plans' && !this._appModel.currentOrg) {
      // If these are billing sign up pages, fetch the plan options only.
      await this._fetchPlans();
    } else {
      // If these are billing settings pages for an existing org, fetch the subscription data.
      await this._fetchSubscription(forceReload);
    }
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
        const sub = await this._billingAPI.getSubscription();
        bundleChanges(() => {
          this.plans.set(sub.plans);
          const subModel: ISubscriptionModel = {
            activePlan: sub.plans[sub.planIndex],
            upcomingPlan: sub.upcomingPlanIndex !== sub.planIndex ? sub.plans[sub.upcomingPlanIndex] : null,
            ...omit(sub, 'plans', 'card'),
          };
          this.subscription.set(subModel);
          this.card.set(sub.card);
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

  // Fetches the plans only - used when the billing pages are not associated with an org.
  private async _fetchPlans(): Promise<void> {
    if (this.plans.get().length === 0) {
      this.plans.set(await this._billingAPI.getPlans());
    }
  }
}
