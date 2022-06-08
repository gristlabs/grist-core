import {BillingModel} from 'app/client/models/BillingModel';
import * as css from 'app/client/ui/BillingPageCss';
import {IBillingOrgSettings} from 'app/common/BillingAPI';
import {checkSubdomainValidity} from 'app/common/orgNameUtils';
import * as roles from 'app/common/roles';
import {Organization} from 'app/common/UserAPI';
import {Disposable, dom, DomArg, IDisposableOwnerT, makeTestId, Observable} from 'grainjs';

const testId = makeTestId('test-bp-');

export interface IFormData {
  settings?: IBillingOrgSettings;
}


// Optional autofill vales to pass in to the BillingForm constructor.
interface IAutofill {
  settings?: Partial<IBillingOrgSettings>;
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
  private readonly _settings: BillingSettingsForm|null;

  constructor(
    org: Organization|null,
    billingModel: BillingModel,
    options: {settings: boolean, domain: boolean},
    autofill: IAutofill = {}
  ) {
    super();
    // Org settings form.
    this._settings = options.settings ? new BillingSettingsForm(billingModel, org, {
      showHeader: true,
      showDomain: options.domain,
      autofill: autofill.settings
    }) : null;
  }

  public buildDom() {
    return [
      this._settings ? this._settings.buildDom() : null,
    ];
  }

  // Note that this will throw if any values are invalid.
  public async getFormData(): Promise<IFormData> {
    const settings = this._settings ? await this._settings.getSettings() : undefined;
    return {
      settings,
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
      this._options.showHeader ? css.paymentLabel('Team name') : null,
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
          css.paymentLabel('Team subdomain'),
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
