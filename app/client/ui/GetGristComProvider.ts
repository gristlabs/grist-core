import { makeT } from "app/client/lib/localization";
import { inlineMarkdown } from "app/client/lib/markdown";
import { getHomeUrl, reportError } from "app/client/models/AppModel";
import { cssTextArea } from "app/client/ui/AdminPanelCss";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { cssLink, cssNestedLinks } from "app/client/ui2018/links";
import { cssModalWidth, modal } from "app/client/ui2018/modals";
import { AsyncFlow, CancelledError, FlowRunner } from "app/common/AsyncFlow";
import { ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { components } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

/**
 * Validate a getgrist.com configuration key at the level the server's
 * `readGetGristComConfigFromSettings` does: must be base64 of a JSON
 * object containing `oidcClientId`, `oidcClientSecret`, and `oidcIssuer`.
 * Returns null when valid, or a short reason string when not.
 *
 * Apply-time still revalidates server-side, so this only catches the
 * obvious paste mistakes (truncation, wrong format) early.
 */
export function validateGetGristComKey(key: string): string | null {
  let decoded: string;
  try {
    decoded = atob(key);
  } catch {
    return "Configuration key is not valid base64";
  }
  let parsed: any;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return "Configuration key does not decode to JSON";
  }
  if (!parsed || typeof parsed !== "object") {
    return "Configuration key is not a JSON object";
  }
  for (const field of ["oidcClientId", "oidcClientSecret", "oidcIssuer"]) {
    if (typeof parsed[field] !== "string" || !parsed[field]) {
      return `Configuration key is missing ${field}`;
    }
  }
  return null;
}

import { Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("GetGristComProvider");

const testId = makeTestId("test-admin-auth-");

/**
 * Static metadata for the getgrist.com login provider, shared with the auth
 * section rendering. Translations are deferred so locale changes are picked up.
 */
export function getGristComProviderMeta() {
  return {
    description: t("Managed authentication by Grist Labs."),
    heroDesc: t("Your server uses getgrist.com authentication. \
Users sign in with their getgrist.com account."),
    docsUrl: commonUrls.signInWithGristDocs,
  };
}

/**
 * Modal for configuring "Sign in with getgrist.com". Validates the pasted
 * key client-side, then hands it to the caller's `onSubmit` -- the modal
 * does not talk to the server itself. `AuthenticationSection` stores the
 * key in its draft state and persists it through the apply pipeline.
 */
export class GetGristComProviderInfoModal extends Disposable {
  private _onSubmit: ((key: string) => void) | undefined;
  private readonly _configKey: Observable<string> = Observable.create(this, "");
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

  public show(onSubmit: (key: string) => void): void {
    this._onSubmit = onSubmit;
    modal((ctl, owner) => {
      this.onDispose(() => ctl.close());
      const registerUrlObs: Observable<string> = Observable.create<string>(owner, "");
      const runner = FlowRunner.create(owner, async (flow: AsyncFlow) => {
        const providerConfig = await this._configAPI.getAuthProviderConfig(GETGRIST_COM_PROVIDER_KEY);
        flow.checkIfCancelled();
        const registerUrl = new URL(commonUrls.signInWithGristRegister);
        const spHost = providerConfig.GRIST_GETGRISTCOM_SP_HOST || getGristConfig().homeUrl;
        if (spHost) {
          const callBackUrl = new URL(spHost).origin;
          registerUrl.searchParams.set("uri", callBackUrl);
        }
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
            cssNestedLinks(inlineMarkdown(t(`**Sign in with getgrist.com** \
allows users on your Grist server to sign in using their account on \
getgrist.com, which is the cloud version of Grist managed by Grist Labs. \
User registration and authentication are fully handled by Grist Labs, \
while your documents and data stay on your server. [Learn more.](${commonUrls.signInWithGristHelp})`)))),
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
          { style: "margin-bottom: 16px; display: inline-block;" },
          t("Register your Grist server"),
        ),
        cssLargerTextArea(
          this._configKey,
          { onInput: true },
          { placeholder: t("Paste configuration key here") },
          cssLargerTextArea.cls("-error", use => use(this._error)),
          testId("config-key-textarea"),
        ),
        cssModalButtons(
          bigBasicButton(
            t("Cancel"),
            dom.on("click", () => this.dispose()),
            testId("modal-cancel"),
          ),
          bigPrimaryButton(
            t("Configure"),
            dom.prop("disabled", use => !use(this._configKey)),
            dom.on("click", () => this._handleConfigure()),
            testId("modal-configure"),
          ),
        ),
      ];
    });
  }

  private _handleConfigure() {
    const key = this._configKey.get().split(/\s+/).join("");
    const reason = validateGetGristComKey(key);
    if (reason !== null) {
      this._error.set(true);
      reportError(new Error(t("Error configuring provider with the provided key: {{reason}}", { reason })));
      return;
    }
    this._onSubmit?.(key);
    this.dispose();
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

const cssModalButtons = styled("div", `
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
`);
