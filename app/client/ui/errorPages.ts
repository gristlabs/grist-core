import { makeT } from "app/client/lib/localization";
import { getLoginUrl, getSignupUrl } from "app/client/lib/urlUtils";
import { AppModel } from "app/client/models/AppModel";
import { getMainOrgUrl, urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import { buildLanguageMenu } from "app/client/ui/LanguageMenu";
import { leftPanelBasic } from "app/client/ui/LeftPanelCommon";
import { buildMockupPanel, cssMockupButton, cssMockupRow, cssMockupSection } from "app/client/ui/MockupPanel";
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

  const bootKeyValue = observable("");
  const emailValue = observable("");
  // "idle" → "checking" → "key-ok" → "signing-in"
  const status = observable<"idle" | "checking" | "key-ok" | "signing-in" | "error">("idle");
  const errorMsg = observable(serverError);
  const keyConfirmed = observable(false);
  const activeTab = observable<"find" | "own" | "skip">("find");

  // If the user navigates back after submitting, the browser restores the
  // page from bfcache with status still "signing-in". Reset it.
  window.addEventListener("pageshow", () => {
    if (status.get() === "signing-in") { status.set("key-ok"); }
  });

  // Step 1: validate boot key against the server, get admin email.
  async function checkKey() {
    if (!bootKeyValue.get().trim()) { return; }
    status.set("checking");
    errorMsg.set("");
    try {
      const resp = await fetch("/auth/boot-key/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bootKey: bootKeyValue.get().trim() }),
      });
      const body = await resp.json();
      if (!body.valid) {
        errorMsg.set("Invalid boot key. Please try again.");
        status.set("error");
        return;
      }
      keyConfirmed.set(true);
      if (body.email) {
        emailValue.set(body.email);
      }
      status.set("key-ok");
    } catch (e) {
      errorMsg.set((e as Error).message);
      status.set("error");
    }
  }

  // Step 2: submit boot key + email to complete login.
  function submitLogin() {
    if (!bootKeyValue.get().trim() || !emailValue.get().trim()) { return; }
    status.set("signing-in");
    errorMsg.set("");
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
    addField("bootKey", bootKeyValue.get().trim());
    addField("email", emailValue.get().trim());
    document.body.appendChild(form);
    form.submit();
  }

  function buildTab(id: "find" | "own" | "skip", label: string) {
    return cssBootTab(
      label,
      dom.cls("active", use => use(activeTab) === id),
      dom.on("click", () => activeTab.set(id)),
      testId(`boot-key-tab-${id}`),
    );
  }

  function buildFindPanel() {
    return cssBootTabContent(
      cssBootFindGuidance(
        cssBootFindText(
          "Look for this banner near the top of Grist's startup output\u2009—\u2009" +
          "check your terminal, container logs, or hosting panel:",
        ),
        dom("pre", cssBootBannerPre.cls(""),
          "┌──────────────────────────────────────────┐\n" +
          "│                                          │\n" +
          "│   BOOT KEY: •••••••••••••••••••••        │\n" +
          "│                                          │\n" +
          "└──────────────────────────────────────────┘",
        ),
      ),
      cssBootFieldGroup(
        cssBootKeyInput(
          dom.prop("value", bootKeyValue),
          dom.on("input", (_e: Event, elem: HTMLInputElement) => bootKeyValue.set(elem.value)),
          dom.prop("disabled", keyConfirmed),
          { placeholder: "Paste boot key here", autofocus: true },
          dom.on("keydown", (ev: KeyboardEvent) => {
            if (ev.key === "Enter" && !keyConfirmed.get()) { void checkKey(); }
          }),
          testId("boot-key-login-input"),
        ),
        dom.maybe(keyConfirmed, () =>
          cssBootFieldCaption(
            { style: "color: #1e7e34;" },
            "\u2713 Boot key verified",
          ),
        ),
        dom.maybe(use => !use(keyConfirmed), () =>
          cssBootFieldCaption(
            "Can't find your boot key? You can ",
            cssBootTabLink(
              "set your own",
              dom.on("click", () => activeTab.set("own")),
            ),
            " or ",
            cssBootTabLink(
              "turn off this check",
              dom.on("click", () => activeTab.set("skip")),
            ),
            ".",
          ),
        ),
      ),
    );
  }

  function buildOwnPanel() {
    return cssBootTabContent(
      cssBootPanelText(
        "If you cannot access server logs or cannot find your boot key, " +
        "you can set it yourself.",
        dom("br"),
        dom("br"),
        "Add the environment variable ",
        dom("code", cssBootCode.cls(""), "GRIST_BOOT_KEY"),
        " with any secret value you choose to your Grist configuration, " +
        "then restart Grist.",
      ),
      cssBootPanelCaption(
        "For Docker, add ",
        dom("code", cssBootCode.cls(""), "-e GRIST_BOOT_KEY=\u2026"),
        " to your run command. For other setups, " +
        "set it in your environment or configuration file.",
      ),
      cssBootRestartNote(
        cssBootRestartIcon("\u21bb"),
        "After restarting, return to this page and enter your chosen key.",
      ),
    );
  }

  function buildSkipPanel() {
    return cssBootTabContent(
      cssBootPanelText(
        "Set ",
        dom("code", cssBootCode.cls(""), "GRIST_IN_SERVICE=true"),
        " in your Grist configuration, then restart. " +
        "Grist will start without requiring a boot key.",
      ),
      cssBootPanelCaption(
        "For Docker, add ",
        dom("code", cssBootCode.cls(""), "-e GRIST_IN_SERVICE=true"),
        " to your run command. For other setups, " +
        "set it in your environment or configuration file.",
      ),
      cssBootWarningBox(
        cssBootWarningTitle("Why does this check exist?"),
        cssBootWarningBody(
          "The boot key proves you have access to the server " +
          "running Grist\u2009—\u2009it keeps out anyone who can reach this page " +
          "but isn't the administrator. ",
          "Skipping it is fine on a private, trusted network where only " +
          "authorized people can connect.",
        ),
      ),
      cssBootRestartNote(
        cssBootRestartIcon("\u21bb"),
        "After restarting, Grist will be available without this sign-in step.",
      ),
    );
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
          { style: "animation: bootFadeUp 0.5s ease 0.08s both;" },
        ),
        cssBootLoginSubheading(
          "Verify that you have access to this server to continue.",
          { style: "animation: bootFadeUp 0.5s ease 0.14s both;" },
        ),
        cssBootLoginCard(
          { style: "animation: bootFadeUp 0.5s ease 0.22s both;" },

          // Tab bar
          cssBootTabBar(
            buildTab("find", "Enter boot key"),
            buildTab("own", "Set your boot key"),
            buildTab("skip", "Turn off this check"),
          ),

          // Tab content (reactive)
          dom.domComputed(activeTab, (tab) => {
            if (tab === "find") { return buildFindPanel(); }
            if (tab === "own") { return buildOwnPanel(); }
            return buildSkipPanel();
          }),

          // Error, email field, and submit button — padded to match tab content.
          cssBootCardSection(
            dom.maybe(errorMsg, err =>
              cssSetupError(err, testId("boot-key-login-error")),
            ),

            // Email field — revealed after boot key is verified (only on "find" tab).
            dom.maybe(use => use(keyConfirmed) && use(activeTab) === "find", () =>
              cssBootFieldGroup(
                cssBootLoginLabel("Administrator email"),
                cssBootEmailInput(
                  dom.prop("value", emailValue),
                  dom.on("input", (_e: Event, elem: HTMLInputElement) => emailValue.set(elem.value)),
                  { placeholder: "you@example.com", type: "email", autofocus: true },
                  dom.on("keydown", (ev: KeyboardEvent) => {
                    if (ev.key === "Enter") { submitLogin(); }
                  }),
                  testId("boot-key-login-email"),
                ),
                cssBootFieldCaption(
                  dom.domComputed(emailValue, val =>
                    val ? "Confirm or change the administrator email address." :
                      "This will be your admin account for managing Grist.",
                  ),
                ),
              ),
            ),

            // Submit button — only on "find" tab.
            dom.maybe(use => use(activeTab) === "find", () =>
              dom.domComputed(keyConfirmed, (confirmed) => {
                if (!confirmed) {
                  return cssBootSubmitButton(
                    dom.domComputed(status, s =>
                      s === "checking" ? "Checking\u2026" : "Check key"),
                    dom.prop("disabled", use =>
                      !use(bootKeyValue).trim() || use(status) === "checking"),
                    dom.on("click", () => void checkKey()),
                    testId("boot-key-login-submit"),
                  );
                }
                return cssBootSubmitButton(
                  dom.domComputed(status, s =>
                    s === "signing-in" ? "Signing in\u2026" : "Continue"),
                  dom.prop("disabled", use =>
                    !use(emailValue).trim() || use(status) === "signing-in"),
                  dom.on("click", () => submitLogin()),
                  testId("boot-key-login-submit"),
                );
              }),
            ),
          ),
        ),
      ),

      // MOCKUP ONLY — auto-fill the boot key for reviewers.
      buildMockupPanel("Mockup controls",
        cssMockupSection("Boot key login"),
        cssMockupRow(
          cssMockupButton("Fill in boot key", dom.on("click", async () => {
            try {
              const resp = await fetch("/api/setup/mockup-boot-key-login");
              const body = await resp.json();
              if (body.bootKey) {
                bootKeyValue.set(body.bootKey);
                activeTab.set("find");
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
  top: 12%;
  left: 50%;
  transform: translateX(-50%);
  width: 700px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    ${theme.controlPrimaryBg}0d 0%,
    transparent 70%
  );
  pointer-events: none;
`);

const cssBootLoginCenter = styled("div", `
  position: relative;
  text-align: center;
  padding: 56px 24px 64px;
  max-width: 580px;
  margin: 0 auto;
`);

const cssBootLoginHeading = styled("div", `
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.5px;
  color: ${theme.text};
  margin-top: 16px;
  margin-bottom: 6px;
`);

const cssBootLoginSubheading = styled("div", `
  font-size: 15px;
  color: ${theme.lightText};
  margin-bottom: 28px;
  line-height: 1.5;
`);

const cssBootLoginCard = styled("div", `
  text-align: left;
  margin: 0 auto;
  padding: 0;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 12px;
  background: ${theme.mainPanelBg};
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
`);

// -- Segmented control --------------------------------------------------------

const cssBootTabBar = styled("div", `
  display: flex;
  margin: 24px 28px 0;
  padding: 3px;
  border-radius: 10px;
  background: ${theme.inputBorder};
  gap: 3px;
`);

const cssBootTab = styled("div", `
  flex: 1;
  text-align: center;
  padding: 8px 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${theme.lightText};
  cursor: pointer;
  border-radius: 7px;
  transition: color 0.2s, background 0.2s, box-shadow 0.2s;
  user-select: none;

  &:hover:not(.active) {
    color: ${theme.text};
  }

  &.active {
    color: ${theme.text};
    font-weight: 600;
    background: ${theme.mainPanelBg};
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
  }
`);

// -- Tab content area ---------------------------------------------------------

const cssBootTabContent = styled("div", `
  padding: 24px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssBootCardSection = styled("div", `
  padding: 0 28px 28px;
`);

const cssBootTabLink = styled("span", `
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

// -- Find-in-logs guidance ----------------------------------------------------

const cssBootFindGuidance = styled("div", `
  & > pre {
    display: block;
    width: fit-content;
    margin: 10px auto 0;
  }
`);

const cssBootFindText = styled("div", `
  font-size: 13px;
  line-height: 1.5;
  color: ${theme.lightText};
  margin-bottom: 10px;
`);

// -- Plain text for tab panels (no card wrapper) -----------------------------

const cssBootPanelText = styled("div", `
  font-size: 14px;
  line-height: 1.6;
  color: ${theme.text};
`);

const cssBootPanelCaption = styled("div", `
  font-size: 12.5px;
  line-height: 1.5;
  color: ${theme.lightText};
  margin-top: -8px;
`);

// -- Warning box (used in the "skip" tab) ------------------------------------

const cssBootWarningBox = styled("div", `
  border-radius: 8px;
  background: #fef7e0;
  border: 1px solid #f5e6b8;
  padding: 14px 16px;
`);

const cssBootWarningTitle = styled("div", `
  font-weight: 600;
  font-size: 12.5px;
  color: #92400e;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
`);

const cssBootWarningBody = styled("div", `
  font-size: 13px;
  line-height: 1.6;
  color: #78350f;
`);

// -- Restart note (tabs 2 & 3) -----------------------------------------------

const cssBootRestartNote = styled("div", `
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  color: ${theme.text};
  line-height: 1.5;
  padding: 16px 18px;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    ${theme.controlPrimaryBg}0a 0%,
    ${theme.controlPrimaryBg}06 100%
  );
  border: 1px solid ${theme.controlPrimaryBg}1a;
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background: linear-gradient(
      180deg,
      ${theme.controlPrimaryBg}66 0%,
      ${theme.controlPrimaryBg}22 100%
    );
    border-radius: 3px 0 0 3px;
  }
`);

const cssBootRestartIcon = styled("span", `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: ${theme.controlPrimaryBg}14;
  font-size: 18px;
  color: ${theme.controlPrimaryBg};
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  .${cssBootRestartNote.className}:hover & {
    transform: rotate(180deg);
  }
`);

// -- Shared form elements (used in "find" tab) --------------------------------

const cssBootLoginLabel = styled("label", `
  display: block;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${theme.lightText};
  margin-bottom: 6px;
`);

const cssBootFieldGroup = styled("div", `
`);

const cssBootFieldCaption = styled("div", `
  font-size: 12.5px;
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 4px;
`);

const cssBootBannerPre = styled("pre", `
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  font-size: 10.5px;
  line-height: 1.4;
  color: ${theme.text};
  background: ${theme.pagePanelsBorder}33;
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
  font-size: 16px;
  padding: 14px 16px;
  border: 1.5px solid ${theme.inputBorder};
  border-radius: 8px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  letter-spacing: 1px;
  margin-bottom: 8px;
  box-shadow: 0 0 0 3px ${theme.controlPrimaryBg}0d;
  transition: border-color 0.2s, box-shadow 0.2s;
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
