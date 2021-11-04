import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {reportError} from 'app/client/models/AppModel';
import {BillingModel} from 'app/client/models/BillingModel';
import * as css from 'app/client/ui/BillingPageCss';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {IOption, select} from 'app/client/ui2018/menus';
import type {ApiError} from 'app/common/ApiError';
import {IBillingAddress, IBillingCard, IBillingCoupon, IBillingOrgSettings,
        IFilledBillingAddress} from 'app/common/BillingAPI';
import {checkSubdomainValidity} from 'app/common/orgNameUtils';
import * as roles from 'app/common/roles';
import {Organization} from 'app/common/UserAPI';
import {Computed, Disposable, dom, DomArg, IDisposableOwnerT, makeTestId, Observable, styled} from 'grainjs';
import sortBy = require('lodash/sortBy');

const G = getBrowserGlobals('Stripe', 'window');
const testId = makeTestId('test-bp-');
const states = [
  'AK', 'AL', 'AR', 'AS', 'AZ', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'FM', 'GA', 'GU', 'HI',
  'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MH', 'MI', 'MN', 'MO', 'MP',
  'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'PR',
  'PW', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VI', 'VT', 'WA', 'WI', 'WV', 'WY'
];

export interface IFormData {
  address?: IFilledBillingAddress;
  card?: IBillingCard;
  token?: string;
  settings?: IBillingOrgSettings;
  coupon?: IBillingCoupon;
}


// Optional autofill vales to pass in to the BillingForm constructor.
interface IAutofill {
  address?: Partial<IBillingAddress>;
  settings?: Partial<IBillingOrgSettings>;
  // Note that the card name is the only value that may be initialized, since the other card
  // information is sensitive.
  card?: Partial<IBillingCard>;
  coupon?: Partial<IBillingCoupon>;
}

// An object containing a function to check the validity of its observable value.
// The get function should return the observable value or throw an error if it is invalid.
interface IValidated<T> {
  value: Observable<T>;
  checkValidity: (value: T) => void|Promise<void>; // Should throw with message on invalid values.
  isInvalid: Observable<boolean>;
  get: () => T|Promise<T>;
}

export class BillingForm extends Disposable {
  private readonly _address: BillingAddressForm|null;
  private readonly _discount: BillingDiscountForm|null;
  private readonly _payment: BillingPaymentForm|null;
  private readonly _settings: BillingSettingsForm|null;

  constructor(
    org: Organization|null,
    billingModel: BillingModel,
    options: {payment: boolean, address: boolean, settings: boolean, domain: boolean, discount: boolean},
    autofill: IAutofill = {}
  ) {
    super();

    // Get the number of forms - if more than one is present subheaders should be visible.
    const count = [options.settings, options.address, options.payment]
      .reduce((acc, x) => acc + (x ? 1 : 0), 0);

    // Org settings form.
    this._settings = options.settings ? new BillingSettingsForm(billingModel, org, {
      showHeader: count > 1,
      showDomain: options.domain,
      autofill: autofill.settings
    }) : null;

    // Discount form.
    this._discount = options.discount ? new BillingDiscountForm(billingModel, {
      autofill: autofill.coupon
    }) : null;

    // Address form.
    this._address = options.address ? new BillingAddressForm({
      showHeader: count > 1,
      autofill: autofill.address
    }) : null;

    // Payment form.
    this._payment = options.payment ? new BillingPaymentForm({
      showHeader: count > 1,
      autofill: autofill.card
    }) : null;
  }

  public buildDom() {
    return [
      this._settings ? this._settings.buildDom() : null,
      this._discount ? this._discount.buildDom() : null,
      this._address ? this._address.buildDom() : null,
      this._payment ? this._payment.buildDom() : null
    ];
  }

  // Note that this will throw if any values are invalid.
  public async getFormData(): Promise<IFormData> {
    const settings = this._settings ? await this._settings.getSettings() : undefined;
    const address = this._address ? await this._address.getAddress() : undefined;
    const cardInfo = this._payment ? await this._payment.getCardAndToken() : undefined;
    const coupon = this._discount ? await this._discount.getCoupon() : undefined;
    return {
      settings,
      address,
      coupon,
      token: cardInfo ? cardInfo.token : undefined,
      card: cardInfo ? cardInfo.card : undefined
    };
  }

  // Make a best-effort attempt to focus the element with the error.
  public focusOnError() {
    // We don't have a good way to do it, we just try to do better than nothing. Also we don't
    // have access to the form container, so look at css.inputError element in the full document.
    const elem = document.querySelector(`.${css.paymentBlock.className} .${css.inputError.className}:not(:empty)`);
    const parent = elem?.closest(`.${css.paymentBlock.className}`);
    if (parent) {
      const input: HTMLInputElement|null =
        parent.querySelector(`.${css.billingInput.className}-invalid`) ||
        parent.querySelector('input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }
}

// Abstract class which includes helper functions for creating a form whose values are verified.
abstract class BillingSubForm extends Disposable {
  protected readonly formError: Observable<string> = Observable.create(this, '');
  protected shouldAutoFocus = false;

  constructor() {
    super();
  }

  // Creates an input whose value is validated on blur. Input text turns red and the validation
  // error is shown on negative validation.
  protected billingInput(validated: IValidated<string>, ...args: Array<DomArg<any>>) {
    return css.billingInput(validated.value, {onInput: true},
      css.billingInput.cls('-invalid', validated.isInvalid),
      dom.on('blur', () => this._onBlur(validated)),
      ...args
    );
  }

  protected async _onBlur(validated: IValidated<string>): Promise<void> {
    // Do not show empty input errors on blur.
    if (validated.value.get().length === 0) { return; }
    try {
      await validated.get();
      this.formError.set('');
    } catch (e) {
      this.formError.set(e.message);
    }
  }

  protected maybeAutoFocus() {
    if (this.shouldAutoFocus) {
      this.shouldAutoFocus = false;
      return (elem: HTMLElement) => { setTimeout(() => elem.focus(), 0); };
    }
  }
}

/**
 * Creates the payment card entry form using Stripe Elements.
 */
class BillingPaymentForm extends BillingSubForm {
  private readonly _stripe: any;
  private readonly _elements: any;

  // Stripe Element fields. Set when the elements are mounted to the dom.
  private readonly _numberElement: Observable<any> = Observable.create(this, null);
  private readonly _expiryElement: Observable<any> = Observable.create(this, null);
  private readonly _cvcElement: Observable<any> = Observable.create(this, null);
  private readonly _name: IValidated<string> = createValidated(this, checkRequired('Name'));

  constructor(private readonly _options: {
    showHeader: boolean;
    autofill?: Partial<IBillingCard>;
  }) {
    super();
    const autofill = this._options.autofill;
    const stripeAPIKey = G.window.gristConfig.stripeAPIKey;
    try {
      this._stripe = G.Stripe(stripeAPIKey);
      this._elements = this._stripe.elements();
    } catch (err) {
      reportError(err);
    }
    if (autofill) {
      this._name.value.set(autofill.name || '');
    }
  }

  public buildDom() {
    return this._stripe ? css.paymentBlock(
        this._options.showHeader ? css.paymentSubHeader('Payment Method') : null,
        css.paymentRow(
          css.paymentField(
            css.paymentLabel('Cardholder Name'),
            this.billingInput(this._name, testId('card-name')),
          )
        ),
        css.paymentRow(
          css.paymentField(
            css.paymentLabel({for: 'number-element'}, 'Card Number'),
            css.stripeInput({id: 'number-element'}), // A Stripe Element will be inserted here.
            testId('card-number')
          )
        ),
        css.paymentRow(
          css.paymentField(
            css.paymentLabel({for: 'expiry-element'}, 'Expiry Date'),
            css.stripeInput({id: 'expiry-element'}), // A Stripe Element will be inserted here.
            testId('card-expiry')
          ),
          css.paymentSpacer(),
          css.paymentField(
            css.paymentLabel({for: 'cvc-element'}, 'CVC / CVV Code'),
            css.stripeInput({id: 'cvc-element'}), // A Stripe Element will be inserted here.
            testId('card-cvc')
          )
        ),
        css.inputError(
          dom.text(this.formError),
          testId('payment-form-error')
        ),
        () => { setTimeout(() => this._mountStripeUI(), 0); }
      ) : null;
  }

  public async getCardAndToken(): Promise<{card: IBillingCard, token: string}> {
    // Note that we call createToken using only the card number element as the first argument
    // in accordance with the Stripe API:
    //
    // "If applicable, the Element pulls data from other Elements you’ve created on the same
    // instance of elements to tokenize—you only need to supply one element as the parameter."
    //
    // Source: https://stripe.com/docs/stripe-js/reference#stripe-create-token
    try {
      const result = await this._stripe.createToken(this._numberElement.get(), {name: await this._name.get()});
      if (result.error) { throw new Error(result.error.message); }
      return {
        card: result.token.card,
        token: result.token.id
      };
    } catch (e) {
      this.formError.set(e.message);
      throw e;
    }
  }

  private _mountStripeUI() {
    // Mount Stripe Element fields.
    this._mountStripeElement(this._numberElement, 'cardNumber', 'number-element');
    this._mountStripeElement(this._expiryElement, 'cardExpiry', 'expiry-element');
    this._mountStripeElement(this._cvcElement, 'cardCvc', 'cvc-element');
  }

  private _mountStripeElement(elemObs: Observable<any>, stripeName: string, elementId: string): void {
    // For details on applying custom styles to Stripe Elements, see:
    // https://stripe.com/docs/stripe-js/reference#element-options
    const classes = {base: css.stripeInput.className};
    const style = {
      base: {
        '::placeholder': {
          color: colors.slate.value
        },
        'fontSize': vars.mediumFontSize.value,
        'fontFamily': vars.fontFamily.value
      }
    };
    if (!elemObs.get()) {
      const stripeInst = this._elements.create(stripeName, {classes, style});
      stripeInst.addEventListener('change', (event: any) => {
        if (event.error) { this.formError.set(event.error.message); }
      });
      elemObs.set(stripeInst);
    }
    elemObs.get().mount(`#${elementId}`);
  }
}

/**
 * Creates the company address entry form. Used by BillingPaymentForm when billing address is needed.
 */
class BillingAddressForm extends BillingSubForm {
  private readonly _address1: IValidated<string> = createValidated(this, checkRequired('Address'));
  private readonly _address2: IValidated<string> = createValidated(this, () => undefined);
  private readonly _city: IValidated<string> = createValidated(this, checkRequired('City'));
  private readonly _state: IValidated<string> = createValidated(this, checkFunc(
    (val) => !this._isUS.get() || Boolean(val), `State is required.`));
  private readonly _postal: IValidated<string> = createValidated(this, checkFunc(
    (val) => !this._isUS.get() || Boolean(val), 'Zip code is required.'));
  private readonly _countryCode: IValidated<string> = createValidated(this, checkRequired('Country'));

  private _isUS = Computed.create(this, this._countryCode.value, (use, code) => (code === 'US'));

  private readonly _countries: Array<IOption<string>> = getCountries();

  constructor(private readonly _options: {
    showHeader: boolean;
    autofill?: Partial<IBillingAddress>;
  }) {
    super();
    const autofill = this._options.autofill;
    if (autofill) {
      this._address1.value.set(autofill.line1 || '');
      this._address2.value.set(autofill.line2 || '');
      this._city.value.set(autofill.city || '');
      this._state.value.set(autofill.state || '');
      this._postal.value.set(autofill.postal_code || '');
    }
    this._countryCode.value.set(autofill?.country || 'US');
  }

  public buildDom() {
    return css.paymentBlock(
      this._options.showHeader ? css.paymentSubHeader('Company Address') : null,
      css.paymentRow(
        css.paymentField(
          css.paymentLabel('Street Address'),
          this.billingInput(this._address1, testId('address-street'))
        )
      ),
      css.paymentRow(
        css.paymentField(
          css.paymentLabel('Suite / Unit'),
          this.billingInput(this._address2, testId('address-suite'))
        )
      ),
      css.paymentRow(
        css.paymentField(
          css.paymentLabel('City'),
          this.billingInput(this._city, testId('address-city'))
        ),
        css.paymentSpacer(),
        css.paymentField({style: 'flex: 0.5 1 0;'},
          dom.domComputed(this._isUS, (isUs) =>
            isUs ? [
              css.paymentLabel('State'),
              cssSelect(this._state.value, states),
            ] : [
              css.paymentLabel('State / Region'),
              this.billingInput(this._state),
            ]
          ),
          testId('address-state')
        )
      ),
      css.paymentRow(
        css.paymentField(
          css.paymentLabel(dom.text((use) => use(this._isUS) ? 'Zip Code' : 'Postal Code')),
          this.billingInput(this._postal, testId('address-zip'))
        )
      ),
      css.paymentRow(
        css.paymentField(
          css.paymentLabel('Country'),
          cssSelect(this._countryCode.value, this._countries),
          testId('address-country')
        )
      ),
      css.inputError(
        dom.text(this.formError),
        testId('address-form-error')
      )
    );
  }

  // Throws if any value is invalid. Returns a customer address as accepted by the customer
  // object in stripe.
  // For reference: https://stripe.com/docs/api/customers/object#customer_object-address
  public async getAddress(): Promise<IFilledBillingAddress|undefined> {
    try {
      return {
        line1: await this._address1.get(),
        line2: await this._address2.get(),
        city: await this._city.get(),
        state: await this._state.get(),
        postal_code: await this._postal.get(),
        country: await this._countryCode.get(),
      };
    } catch (e) {
      this.formError.set(e.message);
      throw e;
    }
  }
}

/**
 * Creates the billing settings form, including the org name and the org subdomain values.
 */
class BillingSettingsForm extends BillingSubForm {
  private readonly _name: IValidated<string> = createValidated(this, checkRequired('Company name'));
  // Only verify the domain if it is shown.
  private readonly _domain: IValidated<string> = createValidated(this,
    this._options.showDomain ? d => this._verifyDomain(d) : () => undefined);

  constructor(
    private readonly _billingModel: BillingModel,
    private readonly _org: Organization|null,
    private readonly _options: {
      showHeader: boolean;
      showDomain: boolean;
      autofill?: Partial<IBillingOrgSettings>;
    }
  ) {
    super();
    const autofill = this._options.autofill;
    if (autofill) {
      this._name.value.set(autofill.name || '');
      this._domain.value.set(autofill.domain || '');
    }
  }

  public buildDom() {
    const noEditAccess = Boolean(this._org && !roles.canEdit(this._org.access));
    const initDomain = this._options.autofill?.domain;
    return css.paymentBlock(
      this._options.showHeader ? css.paymentSubHeader('Team Site') : null,
      css.paymentRow(
        css.paymentField(
          this.billingInput(this._name,
            dom.boolAttr('disabled', () => noEditAccess),
            testId('settings-name')
          ),
          noEditAccess ? css.paymentFieldInfo('Organization edit access is required',
            testId('settings-name-info')
          ) : null
        )
      ),
      this._options.showDomain ? css.paymentRow(
        css.paymentField(
          css.paymentLabel('URL'),
          this.billingInput(this._domain,
            dom.boolAttr('disabled', () => noEditAccess),
            testId('settings-domain')
          ),
          noEditAccess ? css.paymentFieldInfo('Organization edit access is required',
            testId('settings-domain-info')
          ) : null,
          dom.maybe((use) => initDomain && use(this._domain.value) !== initDomain, () =>
            css.paymentFieldDanger('Any saved links will need updating if the URL changes')
          ),
        ),
        css.paymentField({style: 'flex: 0 1 0;'},
          css.inputHintLabel('.getgrist.com')
        )
      ) : null,
      css.inputError(
        dom.text(this.formError),
        testId('settings-form-error')
      )
    );
  }

  // Throws if any value is invalid.
  public async getSettings(): Promise<IBillingOrgSettings|undefined> {
    try {
      return {
        name: await this._name.get(),
        domain: await this._domain.get()
      };
    } catch (e) {
      this.formError.set(e.message);
      throw e;
    }
  }

  // Throws if the entered domain contains any invalid characters or is already taken.
  private async _verifyDomain(domain: string): Promise<void> {
    // OK to retain current domain.
    if (domain === this._options.autofill?.domain) { return; }
    checkSubdomainValidity(domain);
    const isAvailable = await this._billingModel.isDomainAvailable(domain);
    if (!isAvailable) { throw new Error('Domain is already taken.'); }
  }
}

/**
 * Creates the billing discount form.
 */
class BillingDiscountForm extends BillingSubForm {
  private _isExpanded = Observable.create(this, false);
  private readonly _discountCode: IValidated<string> = createValidated(this, () => undefined);

  constructor(
    private readonly _billingModel: BillingModel,
    private readonly _options: { autofill?: Partial<IBillingCoupon>; }
  ) {
    super();
    if (this._options.autofill) {
      const { promotion_code } = this._options.autofill;
      this._discountCode.value.set(promotion_code ?? '');
      this._isExpanded.set(Boolean(promotion_code));
    }
  }

  public buildDom() {
    return dom.domComputed(this._isExpanded, isExpanded => [
      !isExpanded ?
        css.paymentBlock(
          css.paymentRow(
            css.billingText('Have a discount code?', testId('discount-code-question')),
            css.billingTextBtn(
              css.billingIcon('Settings'),
              'Apply',
              dom.on('click', () => { this.shouldAutoFocus = true; this._isExpanded.set(true); }),
              testId('apply-discount-code')
            )
          )
        ) :
        css.paymentBlock(
          css.paymentRow(
            css.paymentField(
              css.paymentLabel('Discount Code'),
              this.billingInput(this._discountCode, testId('discount-code'), this.maybeAutoFocus()),
            )
          ),
          css.inputError(
            dom.text(this.formError),
            testId('discount-form-error')
          )
        )
    ]);
  }

  public async getCoupon() {
    const discountCode = await this._discountCode.get();
    if (discountCode.trim() === '') { return undefined; }

    try {
      return await this._billingModel.fetchSignupCoupon(discountCode);
    } catch (e) {
      const message = (e as ApiError).details?.userError;
      this.formError.set(message || 'Invalid or expired discount code.');
      throw e;
    }
  }
}

function checkFunc(func: (val: string) => boolean, message: string) {
  return (val: string) => {
    if (!func(val)) { throw new Error(message); }
  };
}

function checkRequired(propertyName: string) {
  return checkFunc(Boolean, `${propertyName} is required.`);
}

// Creates a validated object, which includes an observable and a function to check
// if the current observable value is valid.
function createValidated(
  owner: IDisposableOwnerT<any>,
  checkValidity: (value: string) => void|Promise<void>,
): IValidated<string> {
  const value = Observable.create(owner, '');
  const isInvalid = Observable.create<boolean>(owner, false);
  owner.autoDispose(value.addListener(() => { isInvalid.set(false); }));
  return {
    value,
    isInvalid,
    checkValidity,
    get: async () => {
      const _value = value.get();
      try {
        await checkValidity(_value);
      } catch (e) {
        isInvalid.set(true);
        throw e;
      }
      isInvalid.set(false);
      return _value;
    }
  };
}

function getCountries(): Array<IOption<string>> {
  // Require just the one file because it has all the data we need and is substantially smaller
  // than requiring the whole module.
  const countryNames = require("i18n-iso-countries/langs/en.json").countries;
  const codes = Object.keys(countryNames);
  const entries = codes.map(code => {
    // The module provides names that are either a string or an array of names. If an array, pick
    // the first one.
    const names = countryNames[code];
    return {value: code, label: Array.isArray(names) ? names[0] : names};
  });
  return sortBy(entries, 'label');
}

const cssSelect = styled(select, `
  height: 42px;
  padding-left: 13px;
  align-items: center;
`);
