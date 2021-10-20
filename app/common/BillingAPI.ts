import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {FullUser} from 'app/common/LoginSessionAPI';
import {StringUnion} from 'app/common/StringUnion';
import {addCurrentOrgToPath} from 'app/common/urlUtils';
import {BillingAccount, ManagerDelta, OrganizationWithoutAccessInfo} from 'app/common/UserAPI';

export const BillingSubPage = StringUnion('payment', 'plans');
export type BillingSubPage = typeof BillingSubPage.type;

export const BillingPage = StringUnion(...BillingSubPage.values, 'billing');
export type BillingPage = typeof BillingPage.type;

export const BillingTask = StringUnion('signUp', 'signUpLite', 'updatePlan', 'addCard',
                                       'updateCard', 'updateAddress', 'updateDomain');
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
}

// Stripe customer address information. Used to maintain the company address.
// For reference: https://stripe.com/docs/api/customers/object#customer_object-address
export interface IBillingAddress {
  line1: string|null;
  line2: string|null;
  city: string|null;
  state: string|null;
  postal_code: string|null;
  country: string|null;
}

// Utility type that requires all properties to be non-nullish.
type NonNullableProperties<T> = { [P in keyof T]: Required<NonNullable<T[P]>>; };

// Filled address info from the client. Fields can be blank strings.
export type IFilledBillingAddress = NonNullableProperties<IBillingAddress>;

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

export interface IBillingCard {
  funding?: string|null;
  brand?: string|null;
  country?: string|null;         // uppercase two-letter ISO country code
  last4?: string|null;           // last 4 digits of the card number
  name?: string|null;
}

export interface IBillingSubscription {
  // All standard plan options.
  plans: IBillingPlan[];
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
  // The payment card, or null if none is attached.
  card: IBillingCard|null;
  // The company address.
  address: IBillingAddress|null;
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
  // Whether there is a valid plan in effect
  isValidPlan: boolean;

  // Stripe status, documented at https://stripe.com/docs/api/subscriptions/object#subscription_object-status
  // such as "active", "trialing" (reflected in isInTrial), "incomplete", etc.
  status?: string;
  lastInvoiceUrl?: string;    // URL of the Stripe-hosted page with the last invoice.
  lastChargeError?: string;   // The last charge error, if any, to show in case of a bad status.
  lastChargeTime?: number;    // The time of the last charge attempt.
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
  getCoupon(promotionCode: string): Promise<IBillingCoupon>;
  getTaxRate(address: IBillingAddress): Promise<number>;
  getPlans(): Promise<IBillingPlan[]>;
  getSubscription(): Promise<IBillingSubscription>;
  getBillingAccount(): Promise<FullBillingAccount>;
  // The signUp function takes the tokenId generated when card data is submitted to Stripe.
  // See: https://stripe.com/docs/stripe-js/reference#stripe-create-token
  signUp(planId: string, tokenId: string, address: IBillingAddress,
         settings: IBillingOrgSettings, promotionCode?: string): Promise<OrganizationWithoutAccessInfo>;
  setCard(tokenId: string): Promise<void>;
  removeCard(): Promise<void>;
  setSubscription(planId: string, options: {
    tokenId?: string,
    address?: IBillingAddress,
    settings?: IBillingOrgSettings,
  }): Promise<void>;
  updateAddress(address?: IBillingAddress, settings?: IBillingOrgSettings): Promise<void>;
  updateBillingManagers(delta: ManagerDelta): Promise<void>;
}

export class BillingAPIImpl extends BaseAPI implements BillingAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async isDomainAvailable(domain: string): Promise<boolean> {
    const resp = await this.request(`${this._url}/api/billing/domain`, {
      method: 'POST',
      body: JSON.stringify({ domain })
    });
    return resp.json();
  }

  public async getCoupon(promotionCode: string): Promise<IBillingCoupon> {
    const resp = await this.request(`${this._url}/api/billing/coupon/${promotionCode}`, {
      method: 'GET',
    });
    return resp.json();
  }

  public async getTaxRate(address: IBillingAddress): Promise<number> {
    const resp = await this.request(`${this._url}/api/billing/tax`, {
      method: 'POST',
      body: JSON.stringify({ address })
    });
    return resp.json();
  }

  public async getPlans(): Promise<IBillingPlan[]> {
    const resp = await this.request(`${this._url}/api/billing/plans`, {method: 'GET'});
    return resp.json();
  }

  // Returns an IBillingSubscription
  public async getSubscription(): Promise<IBillingSubscription> {
    const resp = await this.request(`${this._url}/api/billing/subscription`, {method: 'GET'});
    return resp.json();
  }

  public async getBillingAccount(): Promise<FullBillingAccount> {
    const resp = await this.request(`${this._url}/api/billing`, {method: 'GET'});
    return resp.json();
  }

  // Returns the new Stripe customerId.
  public async signUp(
    planId: string,
    tokenId: string,
    address: IBillingAddress,
    settings: IBillingOrgSettings,
    promotionCode?: string,
  ): Promise<OrganizationWithoutAccessInfo> {
    const resp = await this.request(`${this._url}/api/billing/signup`, {
      method: 'POST',
      body: JSON.stringify({ tokenId, planId, address, settings, promotionCode }),
    });
    const parsed = await resp.json();
    return parsed.data;
  }

  public async setSubscription(planId: string, options: {
    tokenId?: string,
    address?: IBillingAddress,
  }): Promise<void> {
    await this.request(`${this._url}/api/billing/subscription`, {
      method: 'POST',
      body: JSON.stringify({ ...options, planId })
    });
  }

  public async removeSubscription(): Promise<void> {
    await this.request(`${this._url}/api/billing/subscription`, {method: 'DELETE'});
  }

  public async setCard(tokenId: string): Promise<void> {
    await this.request(`${this._url}/api/billing/card`, {
      method: 'POST',
      body: JSON.stringify({ tokenId })
    });
  }

  public async removeCard(): Promise<void> {
    await this.request(`${this._url}/api/billing/card`, {method: 'DELETE'});
  }

  public async updateAddress(address?: IBillingAddress, settings?: IBillingOrgSettings): Promise<void> {
    await this.request(`${this._url}/api/billing/address`, {
      method: 'POST',
      body: JSON.stringify({ address, settings })
    });
  }

  public async updateBillingManagers(delta: ManagerDelta): Promise<void> {
    await this.request(`${this._url}/api/billing/managers`, {
      method: 'PATCH',
      body: JSON.stringify({delta})
    });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
