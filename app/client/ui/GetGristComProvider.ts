import { makeT } from "app/client/lib/localization";
import { inlineMarkdown } from "app/client/lib/markdown";
import { getHomeUrl, reportError } from "app/client/models/AppModel";
import { cssTextArea } from "app/client/ui/AdminPanelCss";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { cssModalWidth, modal } from "app/client/ui2018/modals";
import { AsyncFlow, CancelledError, FlowRunner } from "app/common/AsyncFlow";
import { ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { components } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AdminPanel");

const testId = makeTestId("test-admin-auth-");

/**
 * Modal for configuring "Sign in with getgrist.com" login system.
 */
export class GetGristComProviderInfoModal extends Disposable {
  private _onConfigure: (() => void) | undefined;
  private readonly _configKey: Observable<string> = Observable.create(this, "");
  private readonly _working: Observable<boolean> = Observable.create(this, false);
  private readonly _error: Observable<boolean> = Observable.create(this, false);
  private readonly _configAPI: ConfigAPI = new ConfigAPI(getHomeUrl());

  constructor() {
    super();
    this.autoDispose(this._configKey.addListener(() => {
      const timeout = setTimeout(() => {
        if (this.isDisposed()) {
          return;
        }
        this._error.set(false);
      });
      this.onDispose(() => clearTimeout(timeout));
    }));
  }

  public show(
    onConfigure?: () => void,
  ): void {
    this._onConfigure = onConfigure;
    const homeUrl = getGristConfig().homeUrl;
    if (!homeUrl) {
      throw new Error(t("Home URL is not set; cannot configure Sign in with getgrist.com"));
    }

    modal((ctl, owner) => {
      this.onDispose(() => ctl.close());
      const registerUrlObs: Observable<string> = Observable.create<string>(owner, "");
      const runner = FlowRunner.create(owner, async (flow: AsyncFlow) => {
        const providerConfig = await this._configAPI.getAuthProviderConfig(GETGRIST_COM_PROVIDER_KEY);
        flow.checkIfCancelled();
        const spHost = providerConfig.GRIST_GETGRISTCOM_SP_HOST || homeUrl;
        const registerUrl = new URL(commonUrls.signInWithGristRegister);
        registerUrl.searchParams.set("uri", spHost);
        registerUrlObs.set(registerUrl.href);
      });
      runner.resultPromise.catch((err) => {
        if (err instanceof CancelledError) {
          return;
        }
        reportError(err);
      });
      return [
        cssModalWidth("fixed-wide"),
        cssModalHeader(
          dom("span", t("Configure Sign in with getgrist.com")),
          testId("modal-header"),
        ),
        cssModalDescription(
          dom("p",
            inlineMarkdown(t("**Sign in with getgrist.com** \
allows users on your Grist server to sign in using their account on \
getgrist.com, the cloud version of Grist managed by Grist Labs.")),
          ),
          dom("p",
            t("When signing in, users will be redirected to the getgrist.com login page \
to log in or register. After authenticating on getgrist.com, they'll be redirected \
back to your Grist server and signed in as the user they authenticated as."),
          ),
        ),
        cssModalInstructions(
          dom("h3", t("Instructions")),
          dom("p", t(
            "To set up {{provider}}, you need to register your Grist server on \
getgrist.com and paste the configuration key you receive below.", {
              provider: dom("b", t("Sign in with getgrist.com")),
            })),
        ),
        cssLink(
          dom.attr("href", registerUrlObs),
          dom.on("click", (ev, el) => {
            // Make sure we have a URL to go to.
            if (!registerUrlObs.get()) {
              ev.preventDefault();
            }
          }),
          { target: "_blank" },
          { style: "margin-bottom: 16px; display: block;" },
          t("Register your Grist server"),
        ),
        cssLargerTextArea(
          this._configKey,
          { onInput: true },
          { placeholder: t("Paste configuration key here") },
          cssLargerTextArea.cls("-error", use => use(this._error)),
          testId("config-key-textarea"),
        ),
        // Uncomment when we have proper help page
        // cssLearnMoreLink(
        //   {href: commonUrls.signInWithGristHelp, target: '_blank'},
        //   t('Learn more about Sign in with getgrist.com'),
        // ),
        cssModalButtons(
          bigBasicButton(
            t("Cancel"),
            dom.on("click", () => this.dispose()),
            testId("modal-cancel"),
          ),
          bigPrimaryButton(
            t("Configure"),
            dom.prop("disabled", use => use(this._working) || !use(this._configKey)),
            dom.on("click", () => this._handleConfigure()),
            testId("modal-configure"),
          ),
        ),
      ];
    });
  }

  private async _handleConfigure() {
    if (!this._configKey.get()) {
      this._error.set(true);
      return;
    }
    this._working.set(true);
    try {
      await this._configAPI.configureProvider(
        GETGRIST_COM_PROVIDER_KEY,
        { GRIST_GETGRISTCOM_SECRET: this._configKey.get() },
      );
      this._onConfigure?.();
      this.dispose();
    }
    catch (e) {
      if (this.isDisposed()) {
        return;
      }
      reportError(e as Error);
      this._error.set(true);
    }
    finally {
      if (!this.isDisposed()) {
        this._working.set(false);
      }
    }
  }
}

const cssLargerTextArea = styled(cssTextArea, `
  font-size: ${vars.mediumFontSize};
  height: calc(1.5em * 4);
  transition: border-color 0.2s ease;
  &-error {
    border-color: ${components.errorText};
  }
`);

const cssModalHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  font-size: ${vars.xxxlargeFontSize};
  font-weight: 500;
  color: ${theme.text};
`);

const cssModalDescription = styled("div", `
  margin-bottom: 24px;
  color: ${theme.text};
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;

  & > p {
    margin: 0 0 12px 0;
  }

  & > p:last-child {
    margin-bottom: 0;
  }
`);

const cssModalInstructions = styled("div", `
  margin-bottom: 16px;

  & > h3 {
    margin: 0 0 12px 0;
    font-size: ${vars.largeFontSize};
    font-weight: 600;
    color: ${theme.text};
  }

  & > p {
    margin: 0;
    color: ${theme.text};
    font-size: ${vars.mediumFontSize};
    line-height: 1.5;
  }
`);

// const cssLearnMoreLink = styled(cssLink, `
//   margin-top: 16px;
//   margin-bottom: 24px;
//   display: block;
// `);

const cssModalButtons = styled("div", `
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
`);
