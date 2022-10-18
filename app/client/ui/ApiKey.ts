import { basicButton, textButton } from 'app/client/ui2018/buttons';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { confirmModal } from 'app/client/ui2018/modals';
import { Disposable, dom, IDomArgs, makeTestId, Observable, observable, styled } from 'grainjs';
import {t} from 'app/client/lib/localization';

const translate = (x: string, args?: any): string => t(`ApiKey.${x}`, args);

interface IWidgetOptions {
  apiKey: Observable<string>;
  onDelete: () => Promise<void>;
  onCreate: () => Promise<void>;
  anonymous?: boolean; // Configure appearance and available options for anonymous use.
                       // When anonymous, no modifications are permitted to profile information.
                       // TODO: add browser test for this option.
  inputArgs?: IDomArgs<HTMLInputElement>;
}

const testId = makeTestId('test-apikey-');

/**
 * ApiKey component shows an api key with controls to change it. Expects `options.apiKey` the api
 * key and shows it if value is truthy along with a 'Delete' button that triggers the
 * `options.onDelete` callback. When `options.apiKey` is falsy, hides it and show a 'Create' button
 * that triggers the `options.onCreate` callback. It is the responsibility of the caller to update
 * the `options.apiKey` to its new value.
 */
export class ApiKey extends Disposable {
  private _apiKey: Observable<string>;
  private _onDeleteCB: () => Promise<void>;
  private _onCreateCB: () => Promise<void>;
  private _anonymous: boolean;
  private _inputArgs: IDomArgs<HTMLInputElement>;
  private _loading = observable(false);
  private _isHidden: Observable<boolean> = Observable.create(this, true);

  constructor(options: IWidgetOptions) {
    super();
    this._apiKey = options.apiKey;
    this._onDeleteCB = options.onDelete;
    this._onCreateCB = options.onCreate;
    this._anonymous = Boolean(options.anonymous);
    this._inputArgs = options.inputArgs ?? [];
  }

  public buildDom() {
    return dom('div', testId('container'), dom.style('position', 'relative'),
      dom.maybe(this._apiKey, (apiKey) => dom('div',
        cssRow(
          cssInput(
            {
              readonly: true,
              value: this._apiKey.get(),
            },
            dom.attr('type', (use) => use(this._isHidden) ? 'password' : 'text'),
            testId('key'),
            {title: translate('Clicktoshow')},
            dom.on('click', (_ev, el) => {
              this._isHidden.set(false);
              setTimeout(() => el.select(), 0);
            }),
            dom.on('blur', (ev) => {
              // Hide the key when it is no longer selected.
              if (ev.target !== document.activeElement) { this._isHidden.set(true); }
            }),
            this._inputArgs
          ),
          cssTextBtn(
            cssTextBtnIcon('Remove'), translate('Remove'),
            dom.on('click', () => this._showRemoveKeyModal()),
            testId('delete'),
            dom.boolAttr('disabled', (use) => use(this._loading) || this._anonymous)
          ),
        ),
        description(this._getDescription(), testId('description')),
      )),
      dom.maybe((use) => !(use(this._apiKey) || this._anonymous), () => [
        basicButton(translate('Create'), dom.on('click', () => this._onCreate()), testId('create'),
          dom.boolAttr('disabled', this._loading)),
        description(translate('ByGenerating'), testId('description')),
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
    return translate(
      !this._anonymous ? 'OwnAPIKey' : 'AnonymousAPIkey'
    );
  }

  private _showRemoveKeyModal(): void {
    confirmModal(
      translate('RemoveAPIKey'), translate('Remove'),
      () => this._onDelete(),
      translate("AboutToDeleteAPIKey")
    );
  }
}

const description = styled('div', `
  margin-top: 8px;
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
`);

const cssInput = styled('input', `
  background-color: transparent;
  color: ${theme.inputFg};
  border: 1px solid ${theme.inputBorder};
  padding: 4px;
  border-radius: 3px;
  outline: none;
  flex: 1 0 0;
`);

const cssRow = styled('div', `
  display: flex;
`);

const cssTextBtn = styled(textButton, `
  text-align: left;
  width: 90px;
  margin-left: 16px;
`);

const cssTextBtnIcon = styled(icon, `
  margin: 0 4px 2px 0;
`);
