import { makeT } from "app/client/lib/localization";
import { getLoginUrl, getSignupUrl } from "app/client/lib/urlUtils";
import { AppModel } from "app/client/models/AppModel";
import { getMainOrgUrl, urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import { buildLanguageMenu } from "app/client/ui/LanguageMenu";
import { leftPanelBasic } from "app/client/ui/LeftPanelCommon";
import { pagePanels } from "app/client/ui/PagePanels";
import { createTopBarHome } from "app/client/ui/TopBar";
import { bigBasicButtonLink, bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { commonUrls, getPageTitleSuffix } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

import { dom, DomContents, DomElementArg, makeTestId, observable, styled } from "grainjs";

const testId = makeTestId("test-");

const t = makeT("errorPages");

function signInAgainButton() {
  return cssButtonWrap(bigPrimaryButtonLink(
    t("Sign in again"), { href: getLoginUrl() }, testId("error-signin"),
  ));
}

export function createErrPage(appModel: AppModel) {
  const { errMessage, errDetails, errPage, errTargetUrl } = getGristConfig();
  if (errTargetUrl) {
    // In case the error page was reached via a redirect (typically during sign-in),
    // replace the current URL with the target URL, so that the user can retry their
    // action by simply refreshing the page.
    history.replaceState(null, "", errTargetUrl);
  }
  return errPage === "signed-out" ? createSignedOutPage(appModel) :
    errPage === "not-found" ? createNotFoundPage(appModel, errMessage) :
      errPage === "access-denied" ? createForbiddenPage(appModel, errMessage) :
        errPage === "account-deleted" ? createAccountDeletedPage(appModel) :
          errPage === "signin-failed" ? createSigninFailedPage(appModel, errMessage) :
            errPage === "unsubscribed" ? createUnsubscribedPage(appModel, errMessage, errDetails) :
              errPage === "boot-key-login" ? createBootKeyLoginPage(appModel) :
                createOtherErrorPage(appModel, errMessage);
}

/**
 * Creates a page to show that the user has no access to this org.
 */
export function createForbiddenPage(appModel: AppModel, message?: string) {
  document.title = t("Access denied{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });

  const isAnonym = () => !appModel.currentValidUser;
  const isExternal = () => appModel.currentValidUser?.loginMethod === "External";
  return pagePanelsError(appModel, t("Access denied{{suffix}}", { suffix: "" }), [
    dom.domComputed(appModel.currentValidUser, user => user ? [
      cssErrorText(message || t("You do not have access to this organization's documents.")),
      cssErrorText(t("You are signed in as {{email}}. You can sign in with a different \
account, or ask an administrator for access.", { email: dom("b", user.email) })),
    ] : [
      // This page is not normally shown because a logged out user with no access will get
      // redirected to log in. But it may be seen if a user logs out and returns to a cached
      // version of this page or is an external user (connected through GristConnect).
      cssErrorText(t("Sign in to access this organization's documents.")),
    ]),
    cssButtonWrap(bigPrimaryButtonLink(
      isExternal() ? t("Go to main page") :
        isAnonym() ? t("Sign in") :
          t("Add account"),
      { href: isExternal() ? getMainOrgUrl() : getLoginUrl() },
      testId("error-signin"),
    )),
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createSignedOutPage(appModel: AppModel) {
  document.title = t("Signed out{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });

  return pagePanelsError(appModel, t("Signed out{{suffix}}", { suffix: "" }), [
    cssErrorText(t("You are now signed out.")),
    signInAgainButton(),
  ]);
}

/**
 * Creates a page that shows the user is logged out.
 */
export function createAccountDeletedPage(appModel: AppModel) {
  document.title = t("Account deleted{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });

  return pagePanelsError(appModel, t("Account deleted{{suffix}}", { suffix: "" }), [
    cssErrorText(t("Your account has been deleted.")),
    cssButtonWrap(bigPrimaryButtonLink(
      t("Sign up"), { href: getSignupUrl() }, testId("error-signin"),
    )),
  ]);
}

export function createUnsubscribedPage(
  appModel: AppModel,
  errMessage: string | undefined,
  errDetails: Record<string, string | undefined> | undefined,
) {
  document.title = t("Unsubscribed{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });
  const docUrl = errDetails?.docUrl;

  if (errMessage) {
    return pagePanelsError(appModel, t("We could not unsubscribe you"), [
      cssErrorText(
        cssErrorText.cls("-narrow"),
        t("There was an error"), ": ", addPeriod(errMessage),
      ),
      docUrl && cssErrorText(
        cssErrorText.cls("-narrow"),
        addPeriod(
          t("You can still unsubscribe from this document by updating your preferences in the document settings"),
        ),
      ),
      docUrl && cssButtonWrap(bigBasicButtonLink(t("Manage settings"), { href: `${docUrl}/p/settings` })),
      cssContactSupportDiv(
        t("Need Help?"), " ", cssLink(
          t("Contact support"), { href: commonUrls.contactSupport },
        ),
      ),
    ]);
  }

  // Extract details from errDetails
  const docName = errDetails?.docName || t("this document");
  const notification = errDetails?.notification;
  const mode = errDetails?.mode;
  const email = errDetails?.email;

  let message: DomContents;
  let description: DomContents;
  if (notification === "docChanges") {
    message = t(
      "You will no longer receive email notifications about {{changes}} in {{docName}} at {{email}}.",
      {
        changes: dom("b", t("changes")),
        docName: dom("b", docName),
        email: dom("b", email || t("your email")),
      },
    );

    description = t(
      "You have been unsubscribed from notifications about changes to {{docName}}. You can update " +
      "your preferences anytime in the document settings.",
      {
        docName: dom("b", docName),
      },
    );
  } else if (notification === "suggestions") {
    message = t(
      "You will no longer receive email notifications about {{suggestions}} in {{docName}} at {{email}}.",
      {
        suggestions: dom("b", t("suggestions")),
        docName: dom("b", docName),
        email: dom("b", email || t("your email")),
      },
    );

    description = t(
      "You have been unsubscribed from notifications about suggestions to {{docName}}. You can update " +
      "your preferences anytime in the document settings.",
      {
        docName: dom("b", docName),
      },
    );
  } else if (mode === "full") {
    message = t(
      "You will no longer receive email notifications about {{comments}} in {{docName}} at {{email}}.",
      {
        comments: dom("b", t("comments")),
        docName: dom("b", docName),
        email: dom("b", email || t("your email")),
      },
    );

    description = t(
      "You have been unsubscribed from notifications about any comments in {{docName}}, including mentions " +
      "of you and replies to your comments. You can update your preferences anytime in the document settings.",
      {
        docName: dom("b", docName),
      },
    );
  } else {
    message = t(
      "You will no longer receive email notifications about {{comments}} in {{docName}} at {{email}}.",
      {
        comments: dom("b", t("comments")),
        docName: dom("b", docName),
        email: dom("b", email || t("your email")),
      },
    );

    description = t(
      "You have been unsubscribed from notifications about comments in {{docName}}, " +
      "except for mentions of you and replies to your comments. You can update your " +
      "preferences anytime in the document settings.",
      {
        docName: dom("b", docName),
      },
    );
  }

  return pagePanelsError(appModel, t("You are unsubscribed"), [
    cssErrorText(
      cssErrorText.cls("-narrow"),
      dom("p", message),
      description && dom("p", description),
    ),
    cssButtonWrap(bigBasicButtonLink(t("Manage settings"), { href: `${docUrl}/p/settings` })),
    cssContactSupportDiv(
      t("Need Help?"), " ", cssLink(
        t("Contact support"), { href: commonUrls.contactSupport },
      ),
    ),
  ]);
}

/**
 * Creates a "Page not found" page.
 */
export function createNotFoundPage(appModel: AppModel, message?: string) {
  document.title = t("Page not found{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });

  return pagePanelsError(appModel, t("Page not found{{suffix}}", { suffix: "" }), [
    cssErrorText(message ||
      t("The requested page could not be found.{{separator}}Please check the URL and try again.", {
        separator: dom("br"),
      })),
    cssButtonWrap(bigPrimaryButtonLink(t("Go to main page"), testId("error-primary-btn"),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(t("Contact support"), { href: commonUrls.contactSupport })),
  ]);
}

export function createSigninFailedPage(appModel: AppModel, message?: string) {
  document.title = t("Sign-in failed{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });
  return pagePanelsError(appModel, t("Sign-in failed{{suffix}}", { suffix: "" }), [
    cssErrorText(message ??
      t("Failed to log in.{{separator}}Please try again or contact support.", {
        separator: dom("br"),
      })),
    signInAgainButton(),
    cssButtonWrap(bigBasicButtonLink(t("Contact support"), { href: commonUrls.contactSupport })),
  ]);
}
/**
 * Boot-key login page — styled to match Grist's look and feel.
 * Shown after Go Live when GRIST_ADMIN_EMAIL is set but no real auth is configured.
 */
export function createBootKeyLoginPage(appModel: AppModel) {
  document.title = `Welcome to Grist${getPageTitleSuffix(getGristConfig())}`;

  const { errDetails } = getGristConfig();
  const next = errDetails?.next || "/";
  const BOOT_KEY_ERRORS: Record<string, string> = {
    "invalid-key": "Invalid boot key. Please try again.",
  };
  const serverError = BOOT_KEY_ERRORS[errDetails?.error || ""] || "";
  // Step "email" means the boot key was already validated (server stored
  // a session flag) and we just need the admin email.
  const isEmailStep = errDetails?.step === "email";

  const bootKeyValue = observable("");
  const emailValue = observable("");
  const tipsOpen = observable(false);
  const status = observable<"idle" | "working" | "error">("idle");
  const errorMsg = observable(serverError);

  // If the user navigates back after submitting, the browser restores the
  // page from bfcache with status still "working". Reset it.
  window.addEventListener("pageshow", () => status.set("idle"));

  async function submit() {
    if (isEmailStep) {
      if (!emailValue.get().trim()) { return; }
    } else {
      if (!bootKeyValue.get().trim()) { return; }
    }
    status.set("working");
    errorMsg.set("");
    try {
      // POST as a form submission and follow the redirect.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/auth/boot-key";
      form.style.display = "none";
      const addField = (name: string, value: string) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };
      addField("next", next);
      if (isEmailStep) {
        addField("email", emailValue.get().trim());
      } else {
        addField("bootKey", bootKeyValue.get().trim());
      }
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      errorMsg.set((e as Error).message);
      status.set("error");
    }
  }

  return pagePanels({
    headerMain: cssSetupHeaderMain(buildLanguageMenu(appModel)),
    contentMain: cssBootLoginPage(
      cssBootLoginGlow(),
      cssBootLoginCenter(
        // Staggered entrance: logo → heading → card
        cssBigIcon({ style: "animation: bootFadeUp 0.5s ease both;" }),
        cssBootLoginHeading(
          "Welcome to Grist",
          { style: "animation: bootFadeUp 0.5s ease 0.1s both;" },
        ),
        cssBootLoginSubheading(
          "Let's get you set up.",
          { style: "animation: bootFadeUp 0.5s ease 0.2s both;" },
        ),
        cssBootLoginCard(
          { style: "animation: bootFadeUp 0.5s ease 0.3s both;" },

          // Step 1: Boot key field (hidden on email step)
          ...(isEmailStep ? [] : [
            cssBootFieldGroup(
              cssBootLoginLabel("Boot key"),
              cssBootKeyInput(
                dom.prop("value", bootKeyValue),
                dom.on("input", (_e: Event, elem: HTMLInputElement) => {
                  bootKeyValue.set(elem.value);
                  if (elem.value.trim()) { tipsOpen.set(false); }
                }),
                { placeholder: "Paste boot key here", autofocus: true },
                dom.on("keydown", (ev: KeyboardEvent) => {
                  if (ev.key === "Enter") { void submit(); }
                }),
                testId("boot-key-login-input"),
              ),
              cssBootFieldCaption(
                "Find ",
                dom("b", "BOOT KEY"),
                " in your server logs. ",
                dom("span",
                  cssBootHelpLink.cls(""),
                  dom.on("click", (ev: MouseEvent) => {
                    const tips = (ev.currentTarget as HTMLElement)
                      .closest("." + cssBootFieldGroup.className)
                      ?.querySelector("." + cssBootTips.className) as HTMLElement | null;
                    if (tips) {
                      const open = tipsOpen.get();
                      tipsOpen.set(!open);
                      tips.setAttribute("data-open", String(!open));
                      if (open) {
                        tips.style.maxHeight = tips.scrollHeight + "px";
                        requestAnimationFrame(() => { tips.style.maxHeight = "0"; });
                      } else {
                        tips.style.maxHeight = "none";
                      }
                    }
                  }),
                  dom.text(use => use(tipsOpen) ? "Hide help" : "Need help?"),
                ),
              ),
              cssBootHelpWrap(
                dom.cls("collapsed", use => !!use(bootKeyValue).trim()),
                dom("div",
                  cssBootTips(
                    { "data-open": "false" },
                    cssBootTip(
                      cssBootTipTitle("What to look for"),
                      dom("pre", cssBootBannerPre.cls(""),
                        "┌──────────────────────────────────────────┐\n" +
                        "│                                          │\n" +
                        "│   BOOT KEY: abc123-your-key-here...      │\n" +
                        "│                                          │\n" +
                        "└──────────────────────────────────────────┘",
                      ),
                      cssBootTipCaption("This banner appears near the top of the server output."),
                    ),
                    cssBootTip(
                      cssBootTipTitle("Or set your own"),
                      cssBootTipBody(
                        "Set the environment variable ",
                        dom("code", cssBootCode.cls(""), "GRIST_BOOT_KEY"),
                        " to any value you choose, then restart Grist.",
                      ),
                    ),
                    cssBootTip(
                      cssBootTipTitle("Why boot keys?"),
                      cssBootTipBody(
                        "Entering a boot key proves that you are the person installing Grist, " +
                        "and not someone nefarious. If you are in a private trusted network, " +
                        "you can set ",
                        dom("code", cssBootCode.cls(""), "GRIST_IN_SERVICE"),
                        " to turn off this check.",
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ]),

          dom.maybe(errorMsg, err =>
            cssSetupError(err, testId("boot-key-login-error")),
          ),

          // Step 2: Email field (only after boot key validation)
          ...(isEmailStep ? [
            cssBootFieldGroup(
              cssBootLoginLabel("Administrator email"),
              cssBootEmailInput(
                dom.prop("value", emailValue),
                dom.on("input", (_e: Event, elem: HTMLInputElement) => emailValue.set(elem.value)),
                { placeholder: "you@example.com", type: "email", autofocus: true },
                dom.on("keydown", (ev: KeyboardEvent) => {
                  if (ev.key === "Enter") { void submit(); }
                }),
                testId("boot-key-login-email"),
              ),
              cssBootFieldCaption(
                "This will be your admin account for managing Grist.",
              ),
            ),
          ] : []),

          // — Submit —
          cssBootSubmitButton(
            dom.domComputed(status, s =>
              s === "working" ? "Signing in\u2026" :
              isEmailStep ? "Continue" : "Sign in"),
            dom.prop("disabled", use =>
              (isEmailStep ? !use(emailValue).trim() : !use(bootKeyValue).trim()) ||
              use(status) === "working"),
            dom.on("click", () => void submit()),
            testId("boot-key-login-submit"),
          ),
        ),
      ),

      // MOCKUP ONLY — auto-fill the boot key for reviewers.
      cssMockupPanel(
        cssMockupTitle("Mockup controls"),
        cssMockupSection("Boot key login"),
        cssMockupRow(
          cssMockupButton("Fill in boot key", dom.on("click", async () => {
            try {
              const resp = await fetch("/api/setup/mockup-boot-key-login");
              const body = await resp.json();
              if (body.bootKey) {
                bootKeyValue.set(body.bootKey);
              }
            } catch (e) {
              errorMsg.set((e as Error).message);
            }
          })),
        ),
        cssMockupRow(
          cssMockupButton("Reset admin email", dom.on("click", async () => {
            try {
              await fetch("/api/setup/mockup-reset-admin-email", { method: "POST" });
              window.location.reload();
            } catch (e) {
              errorMsg.set((e as Error).message);
            }
          })),
        ),
      ),

      testId("boot-key-login-content"),
    ),
  });
}

/**
 * Creates a generic error page with the given message.
 */
export function createOtherErrorPage(appModel: AppModel, message?: string) {
  document.title = t("Error{{suffix}}", { suffix: getPageTitleSuffix(getGristConfig()) });

  return pagePanelsError(appModel, t("Something went wrong"), [
    cssErrorText(message ? t("There was an error: {{message}}", { message: addPeriod(message) }) :
      t("There was an unknown error.")),
    cssButtonWrap(bigPrimaryButtonLink(t("Go to main page"), testId("error-primary-btn"),
      urlState().setLinkUrl({}))),
    cssButtonWrap(bigBasicButtonLink(t("Contact support"), { href: commonUrls.contactSupport })),
  ]);
}

function addPeriod(msg: string): string {
  return msg.endsWith(".") ? msg : msg + ".";
}

function pagePanelsError(appModel: AppModel, header: string, content: DomElementArg) {
  const panelOpen = observable(false);
  return pagePanels({
    leftPanel: {
      panelWidth: observable(240),
      panelOpen,
      hideOpener: true,
      header: dom.create(AppHeader, appModel),
      content: leftPanelBasic(appModel, panelOpen),
    },
    headerMain: createTopBarHome(appModel),
    contentMain: cssCenteredContent(cssErrorContent(
      cssBigIcon(),
      cssErrorHeader(header, testId("error-header")),
      content,
      testId("error-content"),
    )),
  });
}

const cssCenteredContent = styled("div", `
  width: 100%;
  height: 100%;
  overflow-y: auto;

  &-setup {
    background-color: ${theme.mainPanelBg};
  }
`);

const cssErrorContent = styled("div", `
  text-align: center;
  margin: 64px 0 64px;
`);

const cssBigIcon = styled("div", `
  display: inline-block;
  width: 100%;
  height: 64px;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssErrorHeader = styled("div", `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.xxxlargeFontSize};
  margin: 24px;
  text-align: center;
  color: ${theme.text};
`);

const cssErrorText = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  margin: 0 auto 24px auto;
  max-width: 400px;
  text-align: center;
`);

const cssButtonWrap = styled("div", `
  margin-bottom: 8px;
`);

const cssContactSupportDiv = styled("div", `
  margin-top: 24px;
`);

const cssSetupHeaderMain = styled("div", `
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
`);

// -- Boot login page: full-page layout with atmospheric background ----------

const cssBootLoginPage = styled("div", `
  width: 100%;
  height: 100%;
  overflow-y: auto;
  position: relative;
  background: ${theme.mainPanelBg};

  @keyframes bootFadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`);

// Subtle radial glow behind the card — gives depth without being flashy.
const cssBootLoginGlow = styled("div", `
  position: absolute;
  top: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 400px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    ${theme.controlPrimaryBg}11 0%,
    transparent 70%
  );
  pointer-events: none;
`);

const cssBootLoginCenter = styled("div", `
  position: relative;
  text-align: center;
  padding: 80px 24px 64px;
  max-width: 520px;
  margin: 0 auto;
`);

const cssBootLoginHeading = styled("div", `
  font-weight: 700;
  font-size: 32px;
  letter-spacing: -0.5px;
  color: ${theme.text};
  margin-top: 20px;
  margin-bottom: 8px;
`);

const cssBootLoginSubheading = styled("div", `
  font-size: 15px;
  color: ${theme.lightText};
  margin-bottom: 36px;
  line-height: 1.5;
`);

const cssBootLoginCard = styled("div", `
  text-align: left;
  max-width: 460px;
  margin: 0 auto;
  padding: 32px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 12px;
  background: ${theme.mainPanelBg};
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
`);

const cssBootLoginLabel = styled("label", `
  display: block;
  font-weight: 600;
  font-size: 13px;
  color: ${theme.text};
  margin-bottom: 6px;
`);

const cssBootFieldGroup = styled("div", `
  margin-bottom: 4px;
  &:not(:first-child) {
    margin-top: 20px;
  }
`);

const cssBootHelpWrap = styled("div", `
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition: grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.3s ease;
  &.collapsed {
    grid-template-rows: 0fr;
    opacity: 0;
    pointer-events: none;
  }
  & > * {
    overflow: hidden;
  }
`);

const cssBootFieldCaption = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 4px;
`);

const cssBootHelpLink = styled("span", `
  color: ${theme.controlPrimaryBg};
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  &:hover {
    color: ${theme.controlPrimaryHoverBg};
    text-decoration-style: solid;
  }
`);

const cssBootTips = styled("div", `
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.25s ease;
  &[data-open="true"] {
    max-height: none;
    opacity: 1;
    overflow: visible;
  }
`);

const cssBootTip = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.5;
  padding: 6px 0;
  &:last-child {
    padding-bottom: 0;
  }
`);

const cssBootTipTitle = styled("div", `
  font-weight: 600;
  font-size: 13px;
  color: ${theme.text};
  margin-bottom: 4px;
`);

const cssBootTipBody = styled("div", `
  line-height: 1.5;
`);

const cssBootTipCaption = styled("div", `
  margin-top: 6px;
  color: ${theme.lightText};
`);

const cssBootBannerPre = styled("pre", `
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  font-size: 10.5px;
  line-height: 1.4;
  color: ${theme.text};
  background: ${theme.mainPanelBg};
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 4px;
  padding: 8px 10px;
  margin: 0;
  overflow-x: auto;
  white-space: pre;
`);

const cssBootCode = styled("code", `
  background: ${theme.pagePanelsBorder};
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
`);

const cssBootKeyInput = styled("input", `
  width: 100%;
  font-size: 15px;
  padding: 10px 14px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 8px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  letter-spacing: 1px;
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus {
    border-color: ${theme.controlPrimaryBg};
    box-shadow: 0 0 0 3px ${theme.controlPrimaryBg}22;
  }
  &::placeholder {
    font-family: inherit;
    letter-spacing: normal;
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssBootEmailInput = styled("input", `
  width: 100%;
  font-size: 15px;
  padding: 10px 14px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 8px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  margin-bottom: 8px;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus {
    border-color: ${theme.controlPrimaryBg};
    box-shadow: 0 0 0 3px ${theme.controlPrimaryBg}22;
  }
`);

const cssBootSubmitButton = styled("button", `
  width: 100%;
  font-size: 15px;
  padding: 12px 24px;
  margin-top: 12px;
  border: none;
  border-radius: 8px;
  background: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.3px;
  transition: background-color 0.15s, transform 0.1s;
  &:hover:not(:disabled) {
    background: ${theme.controlPrimaryHoverBg};
  }
  &:active:not(:disabled) {
    transform: scale(0.99);
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`);

const cssSetupError = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.errorText};
  margin-bottom: 8px;
`);

const cssMockupPanel = styled("div", `
  position: fixed;
  bottom: 16px;
  right: 16px;
  background: ${theme.pagePanelsBorder};
  border: 2px dashed ${theme.controlFg};
  border-radius: 8px;
  padding: 10px 14px;
  z-index: 1000;
  max-width: 420px;
`);

const cssMockupTitle = styled("div", `
  font-size: ${vars.smallFontSize};
  font-weight: bold;
  color: ${theme.controlFg};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
`);

const cssMockupRow = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
  &:last-child {
    margin-bottom: 0;
  }
`);

const cssMockupButton = styled("button", `
  font-size: 11px;
  padding: 3px 8px;
  border: 1px solid ${theme.controlFg};
  border-radius: 3px;
  background: transparent;
  color: ${theme.controlFg};
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    background: ${theme.controlFg};
    color: ${theme.controlPrimaryFg};
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
    &:hover {
      background: transparent;
      color: ${theme.controlFg};
    }
  }
`);

const cssMockupSection = styled("div", `
  font-size: 10px;
  font-weight: bold;
  color: ${theme.lightText};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 6px;
  margin-bottom: 4px;
  &:first-of-type {
    margin-top: 0;
  }
`);

