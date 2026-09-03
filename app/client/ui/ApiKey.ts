import { makeT } from "app/client/lib/localization";
import { basicButton, textButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { confirmModal } from "app/client/ui2018/modals";

import { Disposable, dom, IDomArgs, makeTestId, Observable, observable, styled } from "grainjs";

const t = makeT("ApiKey");

interface IWidgetOptions {
  apiKey: Observable<string>;
  onDelete: () => Promise<void>;
  onCreate: () => Promise<void>;
  anonymous?: boolean; // Configure appearance and available options for anonymous use.
  // When anonymous, no modifications are permitted to profile information.
  // TODO: add browser test for this option.
  inputArgs?: IDomArgs<HTMLInputElement>;
  // Base URL used to build a sample curl command showing how to call the API. When omitted,
  // the curl command is not shown.
  apiUrl?: string;
}

const testId = makeTestId("test-apikey-");

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
  private _apiUrl?: string;
  private _loading = observable(false);
  private _isHidden: Observable<boolean> = Observable.create(this, true);
  private _showCurl: Observable<boolean> = Observable.create(this, false);

  constructor(options: IWidgetOptions) {
    super();
    this._apiKey = options.apiKey;
    this._onDeleteCB = options.onDelete;
    this._onCreateCB = options.onCreate;
    this._anonymous = Boolean(options.anonymous);
    this._inputArgs = options.inputArgs ?? [];
    this._apiUrl = options.apiUrl;
  }

  public buildDom() {
    return dom("div", testId("container"), dom.style("position", "relative"),
      dom.maybe(this._apiKey, apiKey => dom("div",
        cssRow(
          cssInput(
            {
              readonly: true,
              value: this._apiKey.get(),
            },
            dom.attr("type", use => use(this._isHidden) ? "password" : "text"),
            testId("key"),
            { title: t("Click to show") },
            dom.on("click", (_ev, el) => {
              this._isHidden.set(false);
              setTimeout(() => el.select(), 0);
            }),
            dom.on("blur", (ev) => {
              // Hide the key when it is no longer selected.
              if (ev.target !== document.activeElement) { this._isHidden.set(true); }
            }),
            this._inputArgs,
          ),
          cssTextBtn(
            textButton.cls("-hover-bg-padding-none"),
            cssTextBtnIcon("Remove"), t("Remove"),
            dom.on("click", () => this._showRemoveKeyModal()),
            testId("delete"),
            dom.boolAttr("disabled", use => use(this._loading) || this._anonymous),
          ),
        ),
        description(this._getDescription(), testId("description")),
        this._apiUrl ? [
          cssCurlToggle(
            dom.text(use => use(this._showCurl) ? t("Hide Curl command") : t("Show Curl command")),
            dom.on("click", () => this._showCurl.set(!this._showCurl.get())),
            testId("curl-toggle"),
          ),
          dom.maybe(this._showCurl, () => cssCurlCommand(
            dom.text(use => this._getCurlCommand(use(this._isHidden))),
            testId("curl-command"),
          )),
        ] : null,
      )),
      dom.maybe(use => !(use(this._apiKey) || this._anonymous), () => [
        basicButton(t("Create"), dom.on("click", () => this._onCreate()), testId("create"),
          dom.boolAttr("disabled", this._loading)),
        description(t("By generating an API key, you will be able to \
make API calls for your own account."), testId("description")),
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
    return t(
      !this._anonymous ?
        "This API key can be used to access your account via the API. Don’t share your API key with anyone." :
        "This API key can be used to access this account anonymously via the API.",
    );
  }

  private _getCurlCommand(hideKey: boolean): string {
    const key = hideKey ? "…" : this._apiKey.get();
    return `curl -H "Authorization: Bearer ${key}" ${this._apiUrl}/api/orgs`;
  }

  private _showRemoveKeyModal(): void {
    confirmModal(
      t("Remove API Key"), t("Remove"),
      () => this._onDelete(),
      {
        explanation: t(
          "You're about to delete an API key. This will cause all future requests \
using this API key to be rejected. Do you still want to delete?",
        ),
        defaultCancel: true,
      },
    );
  }
}

const description = styled("div", `
  margin-top: 8px;
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
`);

const cssCurlToggle = styled("div", `
  display: inline-block;
  margin-top: 8px;
  color: ${theme.controlFg};
  font-size: ${vars.mediumFontSize};
  cursor: pointer;
  &:hover {
    color: ${theme.controlHoverFg};
  }
`);

const cssCurlCommand = styled("div", `
  margin-top: 8px;
  padding: 8px;
  color: ${theme.inputFg};
  background-color: ${theme.hover};
  border-radius: 3px;
  font-family: monospace;
  font-size: ${vars.mediumFontSize};
  white-space: pre-wrap;
  word-break: break-all;
`);

const cssInput = styled("input", `
  background-color: transparent;
  color: ${theme.inputFg};
  border: 1px solid ${theme.inputBorder};
  padding: 4px;
  border-radius: 3px;
  outline: none;
  flex: 1 0 0;
`);

const cssRow = styled("div", `
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
