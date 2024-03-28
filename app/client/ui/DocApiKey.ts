import { makeT } from 'app/client/lib/localization';
import { basicButton, textButton } from 'app/client/ui2018/buttons';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { confirmModal } from 'app/client/ui2018/modals';
import { Disposable, dom, IDomArgs, makeTestId, Observable, observable, styled } from 'grainjs';

const t = makeT('DocApiKey');

interface IWidgetOptions {
  docApiKey: Observable<string>;
  onDelete: () => Promise<void>;
  onCreate: () => Promise<void>;
  inputArgs?: IDomArgs<HTMLInputElement>;
}

const testId = makeTestId('test-docapikey-');

/**
 * DocApiKey component shows an api key with controls to change it. Expects `options.docApiKey` the api
 * key and shows it if value is truthy along with a 'Delete' button that triggers the
 * `options.onDelete` callback. When `options.docApiKey` is falsy, hides it and show a 'Create' button
 * that triggers the `options.onCreate` callback. It is the responsibility of the caller to update
 * the `options.docApiKey` to its new value.
 */
export class DocApiKey extends Disposable {
  // TODO : user actually logged in, and value if the user is owner of the document.
  private _docApiKey: Observable<string>;
  private _onDeleteCB: () => Promise<void>;
  private _onCreateCB: () => Promise<void>;
  private _inputArgs: IDomArgs<HTMLInputElement>;
  private _loading = observable(false);
  private _isHidden: Observable<boolean> = Observable.create(this, true);

  constructor(options: IWidgetOptions) {
    super();
    this._docApiKey = options.docApiKey;
    this._onDeleteCB = options.onDelete;
    this._onCreateCB = options.onCreate;
    this._inputArgs = options.inputArgs ?? [];
  }

  public buildDom() {
    return dom('div', testId('container'), dom.style('position', 'relative'),
      dom.maybe(this._docApiKey, (docApiKey) => dom('div',
        cssRow(
          cssInput(
            {
              readonly: true,
              value: this._docApiKey.get(),
            },
            dom.attr('type', (use) => use(this._isHidden) ? 'password' : 'text'),
            testId('key'),
            {title: t("Click to show")},
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
            cssTextBtnIcon('Remove'), t("Remove"),
            dom.on('click', () => this._showRemoveKeyModal()),
            testId('delete'),
            dom.boolAttr('disabled', (use) => use(this._loading)) // or is not owner
          ),
        ),
        description('This doc API key can be used to access this document via the API. \
Don’t share this API key.', testId('description')),
      )),
      dom.maybe((use) => !use(this._docApiKey), () => [
        basicButton(t("Create"), dom.on('click', () => this._onCreate()), testId('create'),
          dom.boolAttr('disabled', this._loading)),
        description(t("By generating a doc API key, you will be able to \
make API calls for this particular document."), testId('description')),
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

  private _showRemoveKeyModal(): void {
    confirmModal(
      t("Remove API Key"), t("Remove"),
      () => this._onDelete(),
      {
        explanation: t(
          "You're about to delete a doc API key. This will cause all future requests \
using this doc API key to be rejected. Do you still want to delete?"
        ),
      }
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
