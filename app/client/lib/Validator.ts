import { theme } from 'app/client/ui2018/cssVars';
import { Disposable, dom, Observable, styled } from 'grainjs';

/**
 * Simple validation controls. Renders as a red text with a validation message.
 *
 * Sample usage:
 *
 *    const group = new ValidationGroup();
 *    async function save() {
 *     if (await group.validate()) {
 *       api.save(....)
 *     }
 *    }
 *    ....
 *    dom('div',
 *     dom('Login', 'Enter login', input(login), group.resetInput()),
 *     dom.create(Validator, accountGroup, 'Login is required', () => Boolean(login.get()) === true)),
 *     dom.create(Validator, accountGroup, 'Login must by unique', async () => await throwsIfLoginIsTaken(login.get())),
 *     dom('button', dom.on('click', save))
 *    )
 */

/**
 * Validation function. Can return either boolean value or throw an error with a message that will be displayed
 * in a validator instance.
 */
type ValidationFunction = () => (boolean | Promise<boolean> | void | Promise<void>)

/**
 * Validation groups allow you to organize validator controls on a page as a set.
 * Each validation group can perform validation independently from other validation groups on the page.
 */
export class ValidationGroup {
  // List of attached validators.
  private _validators: Validator[] = [];
  /**
   * Runs all validators check functions. Returns result of the validation.
   */
  public async validate() {
    let valid = true;
    for (const val of this._validators) {
      try {
        const result = await val.check();
        // Validator can either return boolean, Promise<boolean> or void. Booleans are straightforwards.
        // When validator has a void/Promise<void> result it means that it just asserts certain invariant, and should
        // throw an exception when this invariant is not met. Error message can be used to amend the message in the
        // validator instance.
        const isValid = typeof result === 'boolean' ? result : true;
        val.set(isValid);
        if (!isValid) { valid = false; break; }
      } catch (err) {
        valid = false;
        val.set((err as Error).message);
        break;
      }
    }
    return valid;
  }
  /**
   * Attaches single validator instance to this group. Validator can be in multiple groups
   * at the same time.
   */
  public add(validator: Validator) {
    this._validators.push(validator);
  }
  /**
   * Helper that can be attached to the input element to reset validation status.
   */
  public inputReset() {
    return dom.on('input', this.reset.bind(this));
  }
  /**
   * Reset all validators statuses.
   */
  public reset() {
    this._validators.forEach(val => val.set(true));
  }
}

/**
 * Validator instance. When triggered shows a red text with an error message.
 */
export class Validator extends Disposable {
  private _isValid = Observable.create(this, true);
  private _message = Observable.create(this, '');
  constructor(public group: ValidationGroup, message: string, public check: ValidationFunction) {
    super();
    group.add(this);
    this._message.set(message);
  }
  /**
   * Helper that can be attached to the input element to reset validation status.
   */
  public inputReset() {
    return dom.on('input', this.set.bind(this, true));
  }
  /**
   * Sets the validation status. If isValid is a string it is treated as a falsy value, and will
   * mark this validator as invalid.
   */
  public set(isValid: boolean | string) {
    if (this.isDisposed()) { return; }
    if (typeof isValid === 'string') {
      this._message.set(isValid);
      this._isValid.set(!isValid);
    } else {
      this._isValid.set(isValid ? true : false);
    }
  }
  public buildDom() {
    return cssError(
      dom.text(this._message),
      dom.hide(this._isValid),
    );
  }
}

const cssError = styled('div.validator', `
  color: ${theme.errorText};
`);
