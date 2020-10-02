import * as billingPageCss from 'app/client/ui/BillingPageCss';
import { basicButton } from 'app/client/ui2018/buttons';
import { confirmModal } from 'app/client/ui2018/modals';

import { Disposable, dom, makeTestId, Observable, observable, styled } from "grainjs";

interface IWidgetOptions {
  apiKey: Observable<string>;
  onDelete: () => Promise<void>;
  onCreate: () => Promise<void>;
  anonymous?: boolean; // Configure appearance and available options for anonymous use.
                       // When anonymous, no modifications are permitted to profile information.
                       // TODO: add browser test for this option.
}

const testId = makeTestId('test-apikey-');

/**
 * ApiKey component shows an api key with controls to change it. Expects `options.apiKey` the api
 * key and shows it if value is truthy along with a 'Delete' button that triggers the
 * `options.onDelete` callback. When `options.apiKey` is falsy, hides it and show a 'Create' button
 * that triggers the `options.onCreate` callback. It is the responsability of the caller to update
 * the `options.apiKey` to its new value.
 */
export class ApiKey extends Disposable {
  private _apiKey: Observable<string>;
  private _onDeleteCB: () => Promise<void>;
  private _onCreateCB: () => Promise<void>;
  private _anonymous: boolean;
  private _loading = observable(false);

  constructor(options: IWidgetOptions) {
    super();
    this._apiKey = options.apiKey;
    this._onDeleteCB = options.onDelete;
    this._onCreateCB = options.onCreate;
    this._anonymous = Boolean(options.anonymous);
  }

  public buildDom() {
    return dom('div', testId('container'), dom.style('position', 'relative'),
      dom.maybe(this._apiKey, (apiKey) => dom('div',
        cssRow(
          cssInput(
            {readonly: true, value: this._apiKey.get()}, testId('key'),
            dom.on('click', (ev, el) => el.select())
          ),
          cssTextBtn(
            cssBillingIcon('Remove'), 'Remove',
            dom.on('click', () => this._showRemoveKeyModal()),
            testId('delete'),
            dom.boolAttr('disabled', (use) => use(this._loading) || this._anonymous)
          ),
        ),
        description(this._getDescription(), testId('description')),
      )),
      dom.maybe((use) => !(use(this._apiKey) || this._anonymous), () => [
        basicButton('Create', dom.on('click', () => this._onCreate()), testId('create'),
          dom.boolAttr('disabled', this._loading)),
        description('By generating an API key, you will be able to make API calls '
          + 'for your own account.', testId('description')),
      ]),
    );
  }

  // Switch the `_loading` flag to `true` and later, once promise resolves, switch it back to
  // `false`.
  private async _switchLoadingFlag(promise: Promise<any>) {
    this._loading.set(true);
    try {
      await promise;
    } finally {
      this._loading.set(false);
    }
  }

  private _onDelete(): Promise<void> {
    return this._switchLoadingFlag(this._onDeleteCB());
  }

  private _onCreate(): Promise<void> {
    return this._switchLoadingFlag(this._onCreateCB());
  }

  private _getDescription(): string {
    if (!this._anonymous) {
      return 'This API key can be used to access your account via the API. '
        + 'Don’t share your API key with anyone.';
    } else {
      return 'This API key can be used to access this account anonymously via the API.';
    }
  }

  private _showRemoveKeyModal(): void {
    confirmModal(
      `Remove API Key`, 'Remove',
      () => this._onDelete(),
      `You're about to delete an API key. This will cause all future ` +
      `requests using this API key to be rejected. Do you still want to delete?`
    );
  }
}

const description = styled('div', `
  color: #8a8a8a;
  font-size: 13px;
`);

const cssInput = styled('input', `
  outline: none;
  flex: 1 0 0;
`);

const cssRow = styled('div', `
  display: flex;
`);

const cssTextBtn = styled(billingPageCss.billingTextBtn, `
  width: 90px;
  margin-left: 16px;
`);

const cssBillingIcon = billingPageCss.billingIcon;
