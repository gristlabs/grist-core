import { makeT } from "app/client/lib/localization";
import { markdown } from "app/client/lib/markdown";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { cssWell, cssWellContent, cssWellTitle } from "app/client/ui/AdminPanelCss";
import { cssCodeBlock } from "app/client/ui/CodeHighlight";
import { textInput } from "app/client/ui/inputs";
import { shadowScroll } from "app/client/ui/shadowScroll";
import { bigBasicButton, bigPrimaryButton, textButton } from "app/client/ui2018/buttons";
import { cssLabelText, cssRadioCheckboxOptions, radioCheckboxOption } from "app/client/ui2018/checkbox";
import { testId, theme } from "app/client/ui2018/cssVars";
import { cssIconButton, icon } from "app/client/ui2018/icons";
import { cssNestedLinks } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { menu, menuDivider, menuIcon, menuItem, menuText } from "app/client/ui2018/menus";
import { cssModalBody, cssModalButtons, cssModalTitle, cssModalWidth, modal } from "app/client/ui2018/modals";
import { BaseAPI } from "app/common/BaseAPI";

import { Disposable, dom, DomElementArg, IDisposableOwner, Observable, styled } from "grainjs";

const t = makeT("AirtableImport");

export function startImport() {
  return modal((ctl, owner) => {
    const importUI = AirtableImport.create(owner);
    return [
      cssModalStyle.cls(""),
      cssModalWidth("normal"),
      cssModalTitle(t("Import from Airtable")),
      importUI.buildDom(() => ctl.close()),
    ];
  });
}

interface AirtableBase {
  id: string;                    // Base ID (e.g., "appXXXXXXXXXXXXXX")
  name: string;                  // Base name
  permissionLevel: string;       // Permission level (e.g., "owner", "create", "edit", "comment", "read", "none")
}

interface TokenPayload {
  access_token?: string;
  expires_at?: number;
  error?: string;
};

class AirtableImport extends Disposable {
  // Check for a base URL override, for use in tests.
  public static AIRTABLE_API_BASE = (window as any).testAirtableImportBaseUrlOverride ||
    "https://api.airtable.com/v0";

  private _authMethod = Observable.create<"oauth" | "pat" | null>(this, null);
  private _showPATInput = Observable.create(this, false);
  private _patToken = Observable.create(this, "");
  private _accessToken = Observable.create<string | null>(this, null);
  private _bases = Observable.create<AirtableBase[]>(this, []);
  private _loading = Observable.create(this, 0);    // Positive values mean we should show a spinner.
  private _error = Observable.create<string | null>(this, null);
  private _oauth2ClientsApi = new OAuth2ClientsAPI();

  constructor() {
    super();
    this._checkForToken();
  }

  public buildDom(close: () => void) {
    return dom.domComputed(this._accessToken,
      token => token ? dom.create(this._basesList.bind(this), close) : this._authDialog());
  }

  // Auth Dialog Component
  private _authDialog() {
    // TODO: fetch getToken from server: if 401, no token, but if 400, then not configured so don't
    // offer "Connect" button (but show that not configured).
    const isOAuthConfigured = true;

    return cssNestedLinks(cssMainContent(
      dom("div", t("Connect your Airtable account to access your bases.")),

      dom.maybe(this._error, err => cssError(err)),

      dom.maybe(use => !isOAuthConfigured && !use(this._showPATInput), () =>
        cssWarning(
          cssWellTitle(t("Grist configuration required")),
          cssWellContent(t(`OAuth credentials not configured. Please set OAUTH_CLIENT_ID and \
OAUTH_CLIENT_SECRET, or use Personal Access Token.`)),
        ),
      ),

      dom.domComputed(this._showPATInput, (showPAT) => {
        if (!showPAT) {
          return [
            bigPrimaryButton(
              dom.text(use => use(this._loading) ? t("Connecting...") : t("Connect with Airtable")),
              dom.prop("disabled", use => Boolean(!isOAuthConfigured || use(this._loading))),
              dom.on("click", this._handleOAuthLogin.bind(this)),
              testId("import-airtable-connect"),
            ),
            cssDivider(cssDividerLine(), t("or"), cssDividerLine()),
            bigBasicButton(
              t("Use Personal Access Token instead"),
              dom.on("click", () => this._showPATInput.set(true)),
              testId("import-airtable-use-pat"),
            ),
          ];
        } else {
          return [
            cssInputGroup(
              cssLabel(t("Personal Access Token")),
              cssTextInput(this._patToken, { type: "password", placeholder: "patXXXXXXXXXXXXXXXX" },
                dom.onKeyPress({ Enter: this._handlePATLogin.bind(this) }),
              ),
              cssHelperText(markdown(
                t(`[Generate a token]({{airtableCreateTokens}}) in your Airtable \
account with scopes that include at least **\`schema.bases:read\`** and **\`data.records:read\`**.`,
                { airtableCreateTokens: "https://airtable.com/create/tokens" }),
              )),
            ),
            bigPrimaryButton(
              dom.text(use => use(this._loading) ? t("Connecting...") : t("Connect")),
              dom.prop("disabled", use => Boolean(use(this._loading) || !use(this._patToken).trim())),
              dom.on("click", this._handlePATLogin.bind(this)),
            ),
            cssTextButton(
              t("Back"),
              dom.on("click", () => {
                this._showPATInput.set(false);
                this._patToken.set("");
                this._error.set(null);
              }),
            ),
          ];
        }
      }),
    ));
  }

  private _connectionMenu() {
    return menu(() => [
      cssMenuText(
        menuIcon("Info"),
        dom.text(use =>
          t("Connected via {{method}}", { method: use(this._authMethod) === "oauth" ? "OAuth" : "PAT" }),
        ),
      ),
      menuDivider(),
      menuItem(this._handleRefresh.bind(this), menuIcon("Convert"), t("Refresh")),
      menuItem(this._handleLogout.bind(this), menuIcon("Remove"), t("Disconnect")),
    ]);
  }

  private _basesList(owner: IDisposableOwner, closeModal: () => void) {
    const selected = Observable.create<string | null>(owner, null);
    return [
      cssChooseBase(t("Choose an Airtable base to import from"),
        cssSettingsButton(icon("Settings"), this._connectionMenu(), testId("import-airtable-settings")),
      ),
      dom.maybe(this._error, err => cssError(err)),

      cssScrollableContent(
        dom.domComputed(use => [use(this._loading), use(this._bases)] as const, ([isLoading, basesList]) => [
          (isLoading ?
            cssLoading(
              loadingSpinner(),
              cssHelperText(t("loading your bases...")),
            ) :
            (basesList.length === 0 ?
              cssWarning(
                t("No bases found"),
                cssHelperText(t("Make sure your token has the correct permissions.")),
              ) :
              cssRadioOptions(
                basesList.map(base =>
                  radioCheckboxOption(selected, base.id, [
                    cssBaseName(base.name, testId("import-airtable-name")),
                    cssBaseId(base.id, testId("import-airtable-id")),
                  ]),
                ),
              )
            )
          ),
        ]),
        testId("import-airtable-bases"),
      ),
      cssFooterButtons(
        bigPrimaryButton(t("Continue")),
        bigBasicButton(t("Cancel"), dom.on("click", closeModal)),
      ),
    ];
  }

  private _checkForToken() {
    this._voidAsyncWork(async () => {
      try {
        const payload = await this._oauth2ClientsApi.fetchToken();
        if (this.isDisposed()) { return; }
        this._handleTokenPayload(payload);
      } catch (err) {
        if (this.isDisposed()) { return; }
        this._accessToken.set(null);
        this._authMethod.set(null);
        if (err.status === 400) {
          // TODO: disable "Connect" button with a grey message "not configured". Not really a
          // problem, totally fine for self-hosters to be in this state; the message is mainly for the
          // admin to know that configuration IS possible.
        } else if (err.status === 401) {
          // No tokens. That's not an error!
        } else {
          this._error.set(String(err));
        }
      }
    });
  }

  private _handleOAuthLogin() {
    const authUrl = new URL("/oauth2/airtable/authorize", getHomeUrl());
    const lis = dom.onElem(window, "message", (event: Event) => {
      if ((event as MessageEvent).origin !== window.location.origin) {
        return;
      }
      lis.dispose();
      this._handleTokenPayload((event as MessageEvent).data);
    });
    window.open(authUrl, "_blank");
  }

  private _handleTokenPayload(payload: TokenPayload) {
    if (payload.error) {
      console.error("OAuth error:", payload.error);
      this._error.set(String(payload.error));
    } else {
      this._accessToken.set(payload.access_token!);
      this._authMethod.set("oauth");
      this._fetchBases(payload.access_token!);
    }
  }

  private async _handlePATLogin() {
    const token = this._patToken.get().trim();
    if (!token) {
      this._error.set(t("Please enter a Personal Access Token"));
    } else {
      this._accessToken.set(token);
      this._authMethod.set("pat");
      this._fetchBases(token);
    }
  }

  private async _doAsyncWork(doWork: () => Promise<void>) {
    // Use a counter for _loading, so that multiple things loading at the same time keep the
    // spinner going. We don't try too hard for the error: later errors override earlier ones.
    this._loading.set(this._loading.get() + 1);
    this._error.set(null);
    try {
      await doWork();
    } catch (err) {
      if (!this.isDisposed()) {
        this._error.set(err.message);
      }
    } finally {
      if (!this.isDisposed()) {
        this._loading.set(this._loading.get() - 1);
      }
    }
  }

  private _voidAsyncWork(doWork: () => Promise<void>): void {
    void this._doAsyncWork(doWork);
  }

  private _fetchBases(token: string) {
    this._voidAsyncWork(async () => {
      const response = await fetch(`${AirtableImport.AIRTABLE_API_BASE}/meta/bases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) { throw new Error(t("Failed to fetch bases")); }
      const data = await response.json();
      if (this.isDisposed()) { return; }
      this._bases.set(data.bases || []);
    });
  }

  private _handleLogout() {
    this._oauth2ClientsApi.deleteToken().catch(reportError);
    this._accessToken.set(null);
    this._authMethod.set(null);
    this._bases.set([]);
    this._patToken.set("");
    this._showPATInput.set(false);
    this._error.set(null);
  }

  private _handleRefresh() {
    const token = this._accessToken.get();
    if (token) { this._fetchBases(token); }
  }
}

/**
 * Helper to make requests to OAuth2Clients API endpoints.
 * TODO This should be moved to a shared place once there is other code that may benefit.
 */
class OAuth2ClientsAPI extends BaseAPI {
  private _homeUrl: string;   // Home URL, guaranteed to be without trailing slashes.
  constructor(homeUrl: string = getHomeUrl()) {
    super();
    this._homeUrl = homeUrl.replace(/\/+$/, "");
  }

  public fetchToken(): Promise<TokenPayload> { return this.requestJson(`${this._homeUrl}/oauth2/airtable/token`); }
  public deleteToken() { return this.requestJson(`${this._homeUrl}/oauth2/airtable/token`, { method: "DELETE" }); }
}

function cssWarning(...args: DomElementArg[]) {
  return cssWell(cssWell.cls("-warning"), cssIcon(icon("Warning")), dom("div", ...args),
    testId("import-airtable-warning"));
}

function cssError(...args: DomElementArg[]) {
  return cssWell(cssWell.cls("-error"), cssIcon(icon("Warning")), dom("div", ...args),
    testId("import-airtable-error"));
}

// Styled Components

const cssModalStyle = styled("div", `
  max-height: 90vh;
  display: flex;
  flex-direction: column;
`);

const cssMainContent = styled(cssModalBody, `
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssIcon = styled("div", `
  flex-shrink: 0;
`);

const cssDivider = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssDividerLine = styled("div", `
  border-bottom: 1px solid ${theme.menuBorder};
  flex-grow: 1;
`);

const cssInputGroup = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssLabel = styled("label", `
  font-weight: bold;
`);

const cssTextInput = styled(textInput, `
  height: 28px;
`);

const cssHelperText = styled("div", `
  color: ${theme.lightText};
`);

const cssTextButton = styled(textButton, `
  align-self: center;
`);

const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
`);

const cssScrollableContent = styled(shadowScroll, `
  flex: 1 1 auto;
  width: auto;
  margin: 0 -64px;
  padding: 16px 64px 24px 64px;
  border-bottom: 1px solid ${theme.modalBorderDark};
`);

const cssChooseBase = styled("div", `
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
`);

const cssSettingsButton = styled(cssIconButton, `
  --icon-color: ${theme.controlFg};
`);

const cssMenuText = styled(menuText, `
  font-size: revert;
  --icon-color: ${theme.lightText};
`);

const cssRadioOptions = styled(cssRadioCheckboxOptions, `
  & .${cssLabelText.className} {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
  }
`);

const cssBaseName = styled("span", `
  font-weight: bold;
`);

const cssBaseId = styled(cssCodeBlock, `
  color: ${theme.lightText};
`);

const cssFooterButtons = styled(cssModalButtons, `
  margin: 16px 0 -16px 0;
`);
