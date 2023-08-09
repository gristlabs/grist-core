import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {FullUser} from 'app/common/LoginSessionAPI';
import {StringUnion} from 'app/common/StringUnion';
import {addCurrentOrgToPath} from 'app/common/urlUtils';
import {BillingAccount, ManagerDelta, OrganizationWithoutAccessInfo} from 'app/common/UserAPI';

export const BillingSubPage = StringUnion('payment', 'scheduled');
export type BillingSubPage = typeof BillingSubPage.type;

export const BillingPage = StringUnion(...BillingSubPage.values, 'billing');
export type BillingPage = typeof BillingPage.type;

// updateDomain - it is a subpage for billing page, to update domain name.
// The rest are for payment page:
// signUpLite - it is a subpage for payment, to finalize (complete) signup process
// and set domain and team name when they are not set yet (currently only from landing pages).
// signUp - it is landing page for new team sites (it doesn't ask for the name of the team)
export const BillingTask = StringUnion('signUpLite', 'updateDomain', 'signUp', 'cancelPlan', 'upgraded');
export type BillingTask = typeof BillingTask.type;

// Note that IBillingPlan includes selected fields from the Stripe plan object along with
// custom metadata fields that are present on plans we store in Stripe.
// For reference: https://stripe.com/docs/api/plans/object
export interface IBillingPlan {
  id: string;                 // the Stripe plan id
  nickname: string;
  currency: string;           // lowercase three-letter ISO currency code
  interval: string;           // billing frequency - one of day, week, month or year
  amount: number;             // amount in cents charged at each interval
  metadata: {
    family?: string;          // groups plans for filtering by GRIST_STRIPE_FAMILY env variable
    isStandard: boolean;      // indicates that the plan should be returned by the API to be offered.
    supportAvailable: boolean;
    gristProduct: string;     // name of grist product that should be used with this plan.
    unthrottledApi: boolean;
    customSubdomain: boolean;
    workspaces: boolean;
    maxDocs?: number;         // if given, limit of docs that can be created
    maxUsersPerDoc?: number;  // if given, limit of users each doc can be shared with
  };
  trial_period_days: number|null;  // Number of days in the trial period, or null if there is none.
  product: string;         // the Stripe product id.
  active: boolean;
}

export interface ILimitTier {
  name?: string;
  volume: number;
  price: number;
  flatFee: number;
  type: string;
  planId: string;
  interval: string; // probably 'month'|'year';
}

// Utility type that requires all properties to be non-nullish.
// type NonNullableProperties<T> = { [P in keyof T]: Required<NonNullable<T[P]>>; };

// Stripe promotion code and coupon information. Used by client to apply signup discounts.
// For reference: https://stripe.com/docs/api/promotion_codes/object#promotion_code_object-coupon
export interface IBillingCoupon {
  id: string;
  promotion_code: string;
  name: string|null;
  percent_off: number|null;
  amount_off: number|null;
}

// Stripe subscription discount information.
// For reference: https://stripe.com/docs/api/discounts/object
export interface IBillingDiscount {
  name: string|null;
  percent_off: number|null;
  amount_off: number|null;
  end_timestamp_ms: number|null;
}


export interface IBillingSubscription {
  // All standard plan options.
  plans: IBillingPlan[];
  tiers: ILimitTier[];
  // Index in the plans array of the plan currently in effect.
  planIndex: number;
  // Index in the plans array of the plan to be in effect after the current period end.
  // Equal to the planIndex when the plan has not been downgraded or cancelled.
  upcomingPlanIndex: number;
  // Timestamp in milliseconds indicating when the current plan period ends.
  // Null if the account is not signed up with Stripe.
  periodEnd: number|null;
  // Whether the subscription is in the trial period.
  isInTrial: boolean;
  // Value in cents remaining for the current subscription. This indicates the amount that
  // will be discounted from a subscription upgrade.
  valueRemaining: number;
  // The effective tax rate of the customer for the given address.
  taxRate: number;
  // The current number of users with whom the paid org is shared.
  userCount: number;
  // The next total in cents that Stripe is going to charge (includes tax and discount).
  nextTotal: number;
  // Discount information, if any.
  discount: IBillingDiscount|null;
  // Last plan we had a subscription for, if any.
  lastPlanId: string|null;
  // Whether there is a valid plan in effect.
  isValidPlan: boolean;
  // A flag for when all is well with the user's subscription.
  inGoodStanding: boolean;
  // Whether there is a paying valid account (even on free plan). It this is set
  // user needs to upgrade the plan using Stripe Customer portal. In not, we need to
  // go though checkout process.
  activeSubscription: boolean;
  // Whether the plan is billable. Billable plans must be in Stripe.
  billable: boolean;
  // Whether we are waiting for upgrade to complete.
  upgradingPlanIndex: number;

  // Stripe status, documented at https://stripe.com/docs/api/subscriptions/object#subscription_object-status
  // such as "active", "trialing" (reflected in isInTrial), "incomplete", etc.
  status?: string;
  lastInvoiceUrl?: string;    // URL of the Stripe-hosted page with the last invoice.
  lastChargeError?: string;   // The last charge error, if any, to show in case of a bad status.
  lastChargeTime?: number;    // The time of the last charge attempt.
  limit?: ILimit|null;
}

export interface ILimit {
  limitValue: number;
  currentUsage: number;
  type: string; // Limit type, for now only assistant is supported.
  price: number; // If this is 0, it means it is a free plan.
}

export interface IBillingOrgSettings {
  name: string;
  domain: string;
}

// Full description of billing account, including nested list of orgs and managers.
export interface FullBillingAccount extends BillingAccount {
  orgs: OrganizationWithoutAccessInfo[];
  managers: FullUser[];
}

export interface BillingAPI {
  isDomainAvailable(domain: string): Promise<boolean>;
  getPlans(): Promise<IBillingPlan[]>;
  getSubscription(): Promise<IBillingSubscription>;
  getBillingAccount(): Promise<FullBillingAccount>;
  updateBillingManagers(delta: ManagerDelta): Promise<void>;
  updateSettings(settings: IBillingOrgSettings): Promise<void>;
  subscriptionStatus(planId: string): Promise<boolean>;
  createFreeTeam(name: string, domain: string): Promise<string>;
  createTeam(name: string, domain: string): Promise<string>;
  upgrade(): Promise<string>;
  cancelCurrentPlan(): Promise<void>;
  downgradePlan(planName: string): Promise<void>;
  renewPlan(): string;
  customerPortal(): string;
  updateAssistantPlan(tier: number): Promise<void>;
}

export class BillingAPIImpl extends BaseAPI implements BillingAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async isDomainAvailable(domain: string): Promise<boolean> {
    return this.requestJson(`${this._url}/api/billing/domain`, {
      method: 'POST',
      body: JSON.stringify({ domain })
    });
  }
  public async getPlans(): Promise<IBillingPlan[]> {
    return this.requestJson(`${this._url}/api/billing/plans`, {method: 'GET'});
  }

  // Returns an IBillingSubscription
  public async getSubscription(): Promise<IBillingSubscription> {
    return this.requestJson(`${this._url}/api/billing/subscription`, {method: 'GET'});
  }

  public async getBillingAccount(): Promise<FullBillingAccount> {
    return this.requestJson(`${this._url}/api/billing`, {method: 'GET'});
  }

  public async cancelCurrentPlan() {
    await this.request(`${this._url}/api/billing/cancel-plan`, {
      method: 'POST',
    });
  }

  public async downgradePlan(planName: string): Promise<void> {
    await this.request(`${this._url}/api/billing/downgrade-plan`, {
      method: 'POST',
      body: JSON.stringify({ planName })
    });
  }

  public async updateSettings(settings?: IBillingOrgSettings): Promise<void> {
    await this.request(`${this._url}/api/billing/settings`, {
      method: 'POST',
      body: JSON.stringify({ settings })
    });
  }

  public async updateBillingManagers(delta: ManagerDelta): Promise<void> {
    await this.request(`${this._url}/api/billing/managers`, {
      method: 'PATCH',
      body: JSON.stringify({delta})
    });
  }

  public async createFreeTeam(name: string, domain: string): Promise<string> {
    const data = await this.requestJson(`${this._url}/api/billing/team-free`, {
      method: 'POST',
      body: JSON.stringify({
        domain,
        name
      })
    });
    return data.orgUrl;
  }

  public async createTeam(name: string, domain: string): Promise<string> {
    const data = await this.requestJson(`${this._url}/api/billing/team`, {
      method: 'POST',
      body: JSON.stringify({
        domain,
        name,
        planType: 'team',
        next: window.location.href
      })
    });
    return data.checkoutUrl;
  }

  public async upgrade(): Promise<string> {
    const data = await this.requestJson(`${this._url}/api/billing/upgrade`, {
      method: 'POST',
    });
    return data.checkoutUrl;
  }

  public customerPortal(): string {
    return `${this._url}/api/billing/customer-portal`;
  }

  public renewPlan(): string {
    return `${this._url}/api/billing/renew`;
  }

  public async updateAssistantPlan(tier: number): Promise<void> {
    await this.request(`${this._url}/api/billing/upgrade-assistant`, {
      method: 'POST',
      body: JSON.stringify({ tier })
    });
  }

  /**
   * Checks if current org has active subscription for a Stripe plan.
   */
  public async subscriptionStatus(planId: string): Promise<boolean> {
    const data = await this.requestJson(`${this._url}/api/billing/status`, {
      method: 'POST',
      body: JSON.stringify({planId})
    });
    return data.active;
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
