import { detectCurrentLang, makeT } from "app/client/lib/localization";
import { markdown } from "app/client/lib/markdown";
import { checkName } from "app/client/lib/nameUtils";
import { AppModel, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import { buildAccountLeftPanel, getAccountSettingsName, getPageName } from "app/client/ui/AccountLeftPanel";
import { areOAuthAppsAvailable } from "app/client/ui/AccountLeftPanel";
import * as css from "app/client/ui/AccountPageCss";
import { ApiKey } from "app/client/ui/ApiKey";
import { App } from "app/client/ui/App";
import { buildChangePasswordDialog } from "app/client/ui/ChangePasswordDialog";
import { DeleteAccountDialog } from "app/client/ui/DeleteAccountDialog";
import { translateLocale } from "app/client/ui/LanguageMenu";
import { MFAConfig } from "app/client/ui/MFAConfig";
import { OAuthAppsUI } from "app/client/ui/OAuthApps";
import { pagePanels } from "app/client/ui/PagePanels";
import { ScreenReaderConfig } from "app/client/ui/ScreenReaderConfig";
import { cssSectionTag, SectionCard, SettingsPage } from "app/client/ui/SettingsLayout";
import { ThemeConfig } from "app/client/ui/ThemeConfig";
import { createTopBarHome } from "app/client/ui/TopBar";
import { transientInput } from "app/client/ui/transientInput";
import { fullBreadcrumbs } from "app/client/ui2018/breadcrumbs";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { cssLink, cssNestedLinks } from "app/client/ui2018/links";
import { select } from "app/client/ui2018/menus";
import { commonUrls, getPageTitleSuffix, isFeatureEnabled } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";
import { FullUser } from "app/common/UserAPI";

import { Computed, Disposable, dom, domComputed, makeTestId, Observable, styled, subscribe } from "grainjs";

const testId = makeTestId("test-account-page-");
const t = makeT("AccountPage");

/**
 * Creates the account page where a user can manage their profile settings.
 */
export class AccountPage extends Disposable {
  private readonly _currentPage = Computed.create(this, urlState().state,
    (_use, s) => (s.account || "account"),
  );

  private _apiKey = Observable.create<string>(this, "");
  private _userObs = Observable.create<FullUser | null>(this, null);
  private _isEditingName = Observable.create(this, false);
  private _nameEdit = Observable.create<string>(this, "");
  private _isNameValid = Computed.create(this, this._nameEdit, (_use, val) => checkName(val));
  private _allowGoogleLogin = Computed.create(this, use => use(this._userObs)?.allowGoogleLogin ?? false)
    .onWrite(val => this._updateAllowGooglelogin(val));

  constructor(private _appModel: AppModel, private _appObj: App) {
    super();
    this._setPageTitle();
    this._fetchAll().catch(reportError);
  }

  public buildDom() {
    return pagePanels({
      leftPanel: buildAccountLeftPanel(this, this._appModel),
      headerMain: this._buildHeaderMain(),
      contentMain: this._buildContentMain(),
      testId,
      app: this._appObj,
    });
  }

  private _buildContentMain() {
    return domComputed(this._currentPage, (page) => {
      switch (page) {
        case "developer":
          return dom.create(OAuthAppsUI.developerPageOverride, this._appModel, () => this._buildDeveloperContent());
        case "authorized-apps":
          return dom.create(OAuthAppsUI.authorizedAppsPageContent, this._appModel);
        default: return this._buildProfileContent();
      }
    });
  }

  private _buildProfileContent() {
    const supportedLngs = getGristConfig().supportedLngs ?? ["en"];
    const languageOptions = supportedLngs
      .map(lng => ({ value: lng, label: translateLocale(lng)! }))
      .sort((a, b) => a.value.localeCompare(b.value));

    const userLocale = Computed.create(this, (use) => {
      const selected = detectCurrentLang();
      if (!supportedLngs.includes(selected)) { return "en"; }
      return selected;
    });
    userLocale.onWrite(async (value) => {
      await this._appModel.api.updateUserLocale(value || null);
      // Reload the page to apply the new locale.
      window.location.reload();
    });

    return dom.maybe(this._userObs, user => SettingsPage(t("Profile"), [
      SectionCard(t("Basic info"), [
        css.dataRow(
          css.inlineSubHeader(t("Email")),
          css.email(user.email),
        ),
        css.dataRow(
          css.inlineSubHeader(t("Name")),
          domComputed(this._isEditingName, isEditing => (
            isEditing ? [
              transientInput(
                {
                  initialValue: user.name,
                  save: async (val) => {
                    if (this._isNameValid.get()) {
                      await this._updateUserName(val);
                    }
                  },
                  close: () => { this._isEditingName.set(false); this._nameEdit.set(""); },
                },
                { size: "5" }, // Lower size so that input can shrink below ~152px.
                dom.on("input", (_ev, el) => this._nameEdit.set(el.value)),
                css.flexGrow.cls(""),
              ),
              css.textBtn(
                css.icon("Settings"), t("Save"),
                // No need to save on 'click'. The transient input already does it on close.
              ),
            ] : [
              css.name(user.name),
              css.textBtn(
                css.icon("Settings"), t("Edit"),
                dom.on("click", () => this._isEditingName.set(true)),
              ),
            ]
          )),
          testId("username"),
        ),
        // show warning for invalid name but not for the empty string
        dom.maybe(use => use(this._nameEdit) && !use(this._isNameValid), this._buildNameWarningsDom.bind(this)),
      ]),
      SectionCard(t("Password & security"), [
        css.dataRow(
          css.inlineSubHeader(t("Login method")),
          css.loginMethod(user.loginMethod),
          user.loginMethod === "Email + Password" ? css.textBtn(t("Change password"),
            dom.on("click", () => this._showChangePasswordDialog()),
          ) : null,
          testId("login-method"),
        ),
        user.loginMethod !== "Email + Password" ? null : dom.frag(
          css.dataRow(
            labeledSquareCheckbox(
              this._allowGoogleLogin,
              t("Allow signing in to this account with Google"),
              testId("allow-google-login-checkbox"),
            ),
            testId("allow-google-login"),
          ),
          css.subHeader(t("Two-factor authentication")),
          css.description(
            t("Two-factor authentication is an extra layer of security for your Grist account \
designed to ensure that you're the only person who can access your account, even if someone knows your password."),
          ),
          dom.create(MFAConfig, user),
        ),
      ]),
      SectionCard(t("Theme"), [
        isFeatureEnabled("themes") ? dom.create(ThemeConfig, this._appModel) : null,
        css.subHeader(t("Language")),
        css.dataRow({ style: "width: 300px" },
          select(userLocale, languageOptions, {
            renderOptionArgs: () => {
              return dom.cls(cssFirstUpper.className);
            },
          }),
          testId("language"),
        ),
      ]),
      SectionCard(t("Accessibility"), [
        dom.create(ScreenReaderConfig, this._appModel),
      ]),
      !getGristConfig().canCloseAccount ? null : [
        dom.create(DeleteAccountDialog, user),
      ],
      testId("body"),
    ]));
  }

  private _buildDeveloperContent() {
    return SettingsPage(t("Developer"), [
      SectionCard(t("API Key"), [
        css.header(t("API")),
        css.dataRow(css.inlineSubHeader(t("API Key")), css.content(
          dom.create(ApiKey, {
            apiKey: this._apiKey,
            onCreate: () => this._createApiKey(),
            onDelete: () => this._deleteApiKey(),
            anonymous: false,
            inputArgs: [{ size: "5" }], // Lower size so that input can shrink below ~152px.
          }),
        )),
      ]),
      (areOAuthAppsAvailable() === "hidden" ? null :
        dom.create(owner =>
          OAuthAppsUI.oauthAppsSection(owner, this._appModel) ||
          SectionCard([t("OAuth apps"), cssSectionTag(t("Enterprise"))], [
            css.description(cssNestedLinks(
              markdown(t(`\
OAuth apps let you connect external integrations to this Grist server with more security and \
convenience than when using API keys.

OAuth apps are available with the [full version of Grist]({{fullGrist}}).`,
              { fullGrist: commonUrls.helpEnterpriseOptIn },
              )),
            )),
          ]))
      ),
    ]);
  }

  private _buildHeaderMain() {
    return [
      fullBreadcrumbs(
        cssLink(urlState().setLinkUrl({}), t("Home"), testId("home")),
        getAccountSettingsName(),
        dom.domComputed(this._currentPage, page => getPageName(page)),
      ),
      createTopBarHome(this._appModel),
    ];
  }

  private async _fetchApiKey() {
    this._apiKey.set(await this._appModel.api.fetchApiKey());
  }

  private async _createApiKey() {
    this._apiKey.set(await this._appModel.api.createApiKey());
  }

  private async _deleteApiKey() {
    await this._appModel.api.deleteApiKey();
    this._apiKey.set("");
  }

  private async _fetchUserProfile() {
    this._userObs.set(await this._appModel.api.getUserProfile());
  }

  private async _fetchAll() {
    await Promise.all([
      this._fetchApiKey(),
      this._fetchUserProfile(),
    ]);
  }

  private async _updateUserName(val: string) {
    const user = this._userObs.get();
    if (user && val && val === user.name) { return; }

    await this._appModel.api.updateUserName(val);
    await this._fetchAll();
  }

  private async _updateAllowGooglelogin(allowGoogleLogin: boolean) {
    await this._appModel.api.updateAllowGoogleLogin(allowGoogleLogin);
    await this._fetchUserProfile();
  }

  private _showChangePasswordDialog() {
    return buildChangePasswordDialog();
  }

  /**
  * Builds dom to show warning messages to the user.
  */
  private _buildNameWarningsDom() {
    return cssWarnings(
      t("Names only allow letters, numbers and certain special characters"),
      testId("username-warning"),
    );
  }

  private _setPageTitle() {
    this.autoDispose(subscribe(this._currentPage, (_use, page): void => {
      const suffix = getPageTitleSuffix(getGristConfig());
      document.title = `${getPageName(page)} - ${getAccountSettingsName()}${suffix}`;
    }));
  }
}

const cssWarnings = styled(css.warning, `
  margin: -8px 0 0 110px;
`);

const cssFirstUpper = styled("div", `
  & > div::first-letter {
    text-transform: capitalize;
  }
`);
