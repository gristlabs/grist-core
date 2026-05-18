import { copyToClipboard } from "app/client/lib/clipboardUtils";
import { handleSubmit } from "app/client/lib/formUtils";
import { makeT } from "app/client/lib/localization";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { AppModel, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import {
  cssFadeUp,
  cssFadeUpGristLogo,
  cssFadeUpHeading,
  cssFadeUpSubHeading,
  cssFlexSpace,
} from "app/client/ui/AdminPanelCss";
import { App } from "app/client/ui/App";
import { BootAPI } from "app/client/ui/BootAPI";
import { textInput } from "app/client/ui/inputs";
import { buildLanguageMenu } from "app/client/ui/LanguageMenu";
import { pagePanels } from "app/client/ui/PagePanels";
import { textButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { ApiError } from "app/common/ApiError";
import { AdminPanelPage } from "app/common/gristUrls";
import { isEmail } from "app/common/gutil";
import { tokens } from "app/common/ThemePrefs";
import { getAdminConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("BootPage");

const testId = makeTestId("test-boot-page-");

type Tab = "enter-key" | "set-key" | "disable-check";

/**
 * Renders a page where a server operator can authenticate as the installation admin using a boot key.
 *
 * The page consists of three tabs:
 *
 *   1. "Enter boot key": Contains a form to submit a boot key and admin email. On valid submission,
 *     sets the submitted email as the installation admin, authenticates the user as the admin, and
 *     redirects to /admin.
 *   2. "Set your boot key": Contains instructions for setting a custom boot key and a randomly
 *     generated boot key to copy, for convenience.
 *   3. "Turn off this check": Contains instructions for disabling the boot key check.
 *
 * On fresh installations, this is the default landing page and used as an ownership check prior to taking
 * the server "live".
 */
export class BootPage extends Disposable {
  private _api = new BootAPI();

  private _activeTab = Observable.create<Tab>(this, "enter-key");
  private _bootKey = Observable.create(this, "");
  private _bootKeyPending = Observable.create(this, false);
  private _bootKeyError = Observable.create<string | null>(this, null);
  private _bootKeyVerified = Observable.create(this, false);
  private _email = Observable.create(this, "");
  private _loginPending = Observable.create(this, false);
  private _loginError = Observable.create<string | null>(this, null);
  private _savedEmail = Observable.create<string | null>(this, null);

  private _bootKeyDisabled = Computed.create(this, use =>
    !use(this._bootKey).trim() || use(this._bootKeyPending));

  private _loginDisabled = Computed.create(this, (use) => {
    const email = use(this._email).trim();
    return !isEmail(email) || use(this._loginPending);
  });

  constructor(private _appModel: AppModel, private _app: App) {
    super();

    document.title = t("Welcome to Grist");
  }

  public buildDom() {
    return pagePanels({
      headerMain: this._buildHeaderContent(),
      contentMain: this._buildMainContent(),
      app: this._app,
    });
  }

  private _buildHeaderContent() {
    return [
      cssFlexSpace(),
      buildLanguageMenu(this._appModel),
    ];
  }

  private _buildMainContent() {
    return cssMainContent(
      { tabIndex: "-1" },
      cssFadeUpGristLogo(),
      cssFadeUpHeading(t("Welcome to Grist")),
      cssFadeUpSubHeading(t("Verify that you have access to this server to continue.")),
      cssCard(
        cssTabs(
          this._buildTab("enter-key", t("Enter boot key")),
          this._buildTab("set-key", t("Set your boot key")),
          this._buildTab("disable-check", t("Turn off this check")),
        ),
        dom.domComputed(this._activeTab, (tab) => {
          switch (tab) {
            case "enter-key": {
              return this._buildEnterKeyContent();
            }
            case "set-key": {
              return this._buildSetKeyContent();
            }
            case "disable-check": {
              return this._buildDisableCheckContent();
            }
          }
        }),
      ),
      testId("content"),
    );
  }

  private _buildEnterKeyContent() {
    return cssTabContent(
      cssEnterKeyInstructions(
        t(`Look for this banner near the top of Grist's startup output\u2009—\u2009\
check your terminal, container logs, or hosting panel: {{exampleBootKeyBanner}}`, {
          exampleBootKeyBanner: cssBootKeyBannerPre(
            cssBootKeyBannerCode(
              "┌──────────────────────────────────────────┐\n" +
              "│                                          │\n" +
              "│   BOOT KEY: ••••••••••••••••••••••••••   │\n" +
              "│                                          │\n" +
              "└──────────────────────────────────────────┘",
            ),
          ),
        }),
      ),
      dom("form",
        dom.boolAttr("disabled", this._bootKeyVerified),
        handleSubmit({
          pending: this._bootKeyPending,
          disabled: this._bootKeyDisabled,
          onSubmit: ({ bootKey }) => this._api.verifyBootKey(bootKey.trim()),
          onSuccess: (result) => {
            if (this.isDisposed()) { return; }

            this._bootKeyVerified.set(true);

            if (result.adminEmail !== null) {
              this._email.set(result.adminEmail);
              this._savedEmail.set(result.adminEmail);
            }

            this._bootKeyError.set(null);

            window.requestAnimationFrame(() => {
              const emailInput = document.querySelector("#email");
              emailInput?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              (emailInput as HTMLInputElement | null)?.focus({ preventScroll: true });
            });
          },
          onError: (e) => {
            if (this.isDisposed()) { return; }

            if (e instanceof ApiError) {
              this._bootKeyError.set(e.details?.userError ?? e.message);
            } else {
              reportError(e as Error | string);
            }
          },
        }),
        cssInputLabel(t("Boot key"), { for: "bootKey" }),
        cssInput(
          this._bootKey,
          {
            id: "bootKey",
            name: "bootKey",
            placeholder: t("Paste boot key here"),
          },
          cssInput.cls("-error", use => !!use(this._bootKeyError)),
          dom.on("input", () => this._bootKeyError.set(null)),
          dom.prop("disabled", this._bootKeyVerified),
          testId("boot-key-input"),
        ),
        dom.maybe(this._bootKeyError, e => cssError(e, testId("boot-key-error"))),
        dom.maybe(this._bootKeyVerified, () => cssVerified(
          cssVerifiedIcon("Tick"),
          t("Valid boot key"),
          testId("boot-key-verified"),
        )),
        dom.maybe(use => !use(this._bootKeyVerified), () => cssHint(
          t("Can't find your boot key? You can {{setBootKeyButton}} or {{disableCheckButton}}.", {
            setBootKeyButton: textButton(
              t("set your own"),
              { type: "button" },
              dom.on("click", () => this._activeTab.set("set-key")),
            ),
            disableCheckButton: textButton(
              t("disable this check"),
              { type: "button" },
              dom.on("click", () => this._activeTab.set("disable-check")),
            ),
          }),
        )),
        cssBigPrimaryButton(
          { type: "submit" },
          dom.text(use => use(this._bootKeyPending) ? t("Checking key") : t("Check key")),
          dom.hide(this._bootKeyVerified),
          dom.prop("disabled", this._bootKeyDisabled),
          testId("check-key"),
        ),
      ),
      dom.maybe(this._bootKeyVerified, () => dom("form",
        handleSubmit({
          pending: this._loginPending,
          disabled: this._loginDisabled,
          onSubmit: ({ email }) => this._api.logIn(this._bootKey.get().trim(), email),
          onSuccess: () => {
            if (this.isDisposed()) { return; }

            this._loginError.set(null);

            const nextParam = new URLSearchParams(window.location.search).get("next");
            // Treat only an explicit `false` as out-of-service so a missing/cached config
            // doesn't redirect admins to /admin/setup unexpectedly.
            const fallback: AdminPanelPage = getAdminConfig().inService === false ? "setup" : "admin";
            const next = AdminPanelPage.parse(nextParam) || fallback;
            window.location.assign(urlState().makeUrl({ adminPanel: next }));
          },
          onError: (e) => {
            if (this.isDisposed()) { return; }

            if (e instanceof ApiError) {
              this._loginError.set(e.details?.userError ?? e.message);
            } else {
              reportError(e as Error | string);
            }
          },
        }),
        cssInputLabel(t("Administrator email"), { for: "email" }),
        cssInput(
          this._email,
          {
            id: "email",
            name: "email",
            placeholder: "you@example.com",
            type: "email",
          },
          testId("email-input"),
        ),
        cssHint(
          dom.domComputed(this._savedEmail, email => email ?
            t("Confirm or change the administrator email address.") :
            t("This will be your admin account for managing Grist."),
          ),
        ),
        cssBigPrimaryButton(
          { type: "submit" },
          t("Continue"),
          dom.prop("disabled", this._loginDisabled),
          testId("continue"),
        ),
      )),
    );
  }

  private _buildSetKeyContent() {
    const bootKey = getRandomBootKey();

    const copiedKey = Observable.create(null, false);
    let copiedKeyTimeout: number | undefined;

    return cssTabContent(
      dom.autoDispose(copiedKey),
      cssParagraph(
        cssMarkdownSpan(t(`If you cannot access server logs or cannot find your boot key, \
you can set it yourself. Add the environment variable \`GRIST_BOOT_KEY\` with a secret value \
to your Grist configuration, then restart Grist.`)),
      ),
      cssParagraph(t("Here's a random key you can use:")),
      cssRandomBootKey(
        cssRandomBootKeyValue(bootKey),
        cssCopyButton(
          dom.text(use => use(copiedKey) ? t("Copied!") : t("Copy")),
          dom.on("click", async () => {
            clearTimeout(copiedKeyTimeout);
            await copyToClipboard(bootKey);
            copiedKey.set(true);
            copiedKeyTimeout = window.setTimeout(() => {
              if (!copiedKey.isDisposed()) { copiedKey.set(false); }
            }, 2000);
          }),
        ),
      ),
      cssParagraph(
        cssMarkdownSpan(t(`For Docker, add \`-e GRIST_BOOT_KEY={{bootKey}}\` to \
your run command. For other setups, set it in your environment or configuration file.`, {
          bootKey,
        })),
      ),
      cssParagraph(
        t("After restarting, return to this page and enter your chosen key."),
      ),
    );
  }

  private _buildDisableCheckContent() {
    return cssTabContent(
      cssParagraph(
        cssMarkdownSpan(t(`Set \`GRIST_IN_SERVICE=true\` in your Grist configuration, \
then restart. Grist will start without requiring a boot key.`)),
      ),
      cssParagraph(
        cssMarkdownSpan(t(`For Docker, add \`-e GRIST_IN_SERVICE=true\` to \
your run command. For other setups, set it in your environment or configuration file.`)),
      ),
      cssParagraph(
        t("After restarting, Grist will be available without this sign-in step."),
      ),
      cssWarning(
        cssWarningTitle(t("Why does this check exist?")),
        cssWarningBody(
          cssParagraph(
            t(`The boot key proves you have access to the server running Grist\u2009—\u2009\
it keeps out anyone who can reach this page but isn't the administrator.`)),
          cssParagraph(
            t(`Skipping it is fine on a private, trusted network where only authorized people can connect.`)),
        ),
      ),
    );
  }

  private _buildTab(tab: Tab, label: string) {
    return cssTab(
      label,
      cssTab.cls("-active", use => use(this._activeTab) === tab),
      dom.on("click", () => this._activeTab.set(tab)),
      testId(`${tab}-tab`),
    );
  }
}

/**
 * Returns a random boot key in a format like "21a4b47f-df87-4131-a2be-c58b687503f6".
 */
function getRandomBootKey() {
  // Crypto in insecure contexts doesn't have randomUUID.
  if (window.isSecureContext) {
    return window.crypto.randomUUID();
  } else {
    return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx".replace(/x/g, () => {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }
}

const cssMainContent = styled("div", `
  color: ${tokens.body};
  margin: 0 auto;
  max-width: 580px;
  padding: 56px 24px 64px;
  width: 100%;
`);

const cssCard = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.24s both;
  background: ${tokens.bg};
  border: 1px solid ${tokens.decorationSecondary};
  border-radius: 12px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
  margin: 0 auto;
  padding: 32px;
`);

const cssTabs = styled("div", `
  background: ${tokens.bgTertiary};
  border-radius: 10px;
  display: flex;
  column-gap: 3px;
  margin-bottom: 16px;
  padding: 3px;
`);

const cssTab = styled(unstyledButton, `
  border-radius: 7px;
  color: ${tokens.secondary};
  cursor: pointer;
  flex: 1;
  font-weight: 500;
  padding: 8px 6px;
  text-align: center;
  transition: color 0.2s, background 0.2s, box-shadow 0.2s;

  &:hover, &-active {
    color: ${tokens.body};
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }

  &-active {
    background: ${tokens.bg};
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.15),
      0 1px 2px rgba(0, 0, 0, 0.1);
    font-weight: 600;
  }
`);

const cssTabContent = styled("div", `
  display: flex;
  flex-direction: column;
`);

const cssEnterKeyInstructions = styled("div", `
  line-height: 1.5;
  margin-bottom: 16px;
`);

const cssBootKeyBannerPre = styled("pre", `
  background: ${tokens.bgSecondary};
  border-radius: 8px;
  line-height: 1.5;
  overflow: auto;
  margin: 16px 0;
  padding: 16px;
`);

const cssBootKeyBannerCode = styled("code", `
  white-space: pre;
`);

const cssInput = styled(textInput, `
  width: 100%;
  padding: 12px 16px;
  border: 1px solid ${tokens.decoration};
  border-radius: 8px;
  background: ${tokens.bg};
  margin-bottom: 16px;
  transition: border-color 0.15s;

  &-error {
    border-color: ${theme.errorText};
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }

  &:disabled {
    background: ${tokens.bgSecondary};
    color: ${tokens.secondary};
  }

  &::placeholder {
    color: ${tokens.secondary};
  }
`);

const cssError = styled("div", `
  color: ${theme.errorText};
  margin-bottom: 8px;
`);

const cssParagraph = styled("p", `
  line-height: 1.5;
  margin: 0px 0px 16px 0px;
`);

const cssHint = styled(cssParagraph, `
  color: ${tokens.secondary};
`);

const cssVerified = styled("div", `
  --icon-color: ${tokens.primary};
  align-items: center;
  color: ${tokens.primary};
  column-gap: 4px;
  display: flex;
  margin-bottom: 16px;
`);

const cssVerifiedIcon = styled(icon, `
  flex-shrink: 0;
`);

const cssRandomBootKey = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid ${tokens.bgTertiary};
  border-radius: 8px;
  background: ${tokens.bgSecondary};
  margin-bottom: 16px;
`);

const cssRandomBootKeyValue = styled("div", `
  flex: 1;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssInputLabel = styled("label", `
  display: inline-block;
  font-size: ${tokens.smallFontSize};
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  text-transform: uppercase;
`);

const cssBigPrimaryButton = styled(unstyledButton, `
  width: 100%;
  font-size: 15px;
  padding: 12px 24px;
  margin-top: 12px;
  margin-bottom: 16px;
  border: none;
  border-radius: 8px;
  background: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.3px;
  transition: background-color 0.15s, opacity 0.3s;

  &:hover:not(:disabled) {
    background: ${theme.controlPrimaryHoverBg};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }
`);

const cssCopyButton = styled(unstyledButton, `
  padding: 4px 12px;
  border: 1px solid ${tokens.decoration};
  border-radius: 4px;
  background: ${tokens.bgSecondary};
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    background: ${theme.hover};
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }
`);

const cssWarning = styled("div", `
  border: 1px solid ${tokens.warningLight};
  border-radius: 8px;
  margin-bottom: 16px;
  padding: 16px;
`);

const cssWarningTitle = styled("div", `
  font-weight: 600;
  letter-spacing: 0.3px;
  margin-bottom: 8px;
  text-transform: uppercase;
`);

const cssWarningBody = styled("div", `
  line-height: 1.5;
`);
