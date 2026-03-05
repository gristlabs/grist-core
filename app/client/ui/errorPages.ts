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

import { dom, DomContents, DomElementArg, makeTestId, Observable, observable, styled, UseCBOwner } from "grainjs";

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
              errPage === "setup" ? createSetupPage(appModel) :
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
 * Creates a setup page shown for fresh Grist installations that have
 * no authentication configured yet.
 */
export function createSetupPage(appModel: AppModel) {
  document.title = `Setup${getPageTitleSuffix(getGristConfig())}`;

  const bootKeyValue = observable("");
  const bootKeyStatus = observable<"idle" | "working" | "error">("idle");
  const bootKeyError = observable("");
  const authMode = observable<"getgrist" | "bootkey">("getgrist");
  const configKey = Observable.create(null, "");
  const configStatus = Observable.create<"idle" | "working" | "success" | "error">(null, "idle");
  const configError = Observable.create(null, "");

  // Step 2: Sandboxing state
  const storedBootKey = observable("");
  type FlavorStatus = "checking" | "available" | "unavailable";
  interface FlavorInfo { name: string; status: FlavorStatus; error?: string; }
  const sandboxFlavors = observable<FlavorInfo[]>([]);
  const selectedSandbox = observable("");
  const sandboxStatus = observable<"idle" | "loading" | "loaded" | "working" | "success" | "error">("idle");
  const sandboxError = observable("");

  // Step 3: External storage / backups state
  // "selectable" = not detected but user can configure it manually.
  type StorageBackendStatus = "checking" | "available" | "unavailable" | "selectable";
  interface StorageBackendInfo {
    name: string;
    status: StorageBackendStatus;
    error?: string;
    bucket?: string;
    endpoint?: string;
  }
  const storageBackends = observable<StorageBackendInfo[]>([]);
  const selectedStorage = observable("");
  const storageStatus = observable<"idle" | "loading" | "loaded">("idle");
  const storageError = observable("");

  // Step 4: Go Live state
  const goLiveStatus = observable<"idle" | "working" | "success" | "error">("idle");
  const goLiveError = observable("");

  // Tab navigation
  const activeStep = observable<1 | 2 | 3 | 4>(1);

  // --- State persistence across page refresh ---
  const STORAGE_KEY = "grist-setup-state";

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        bootKey: storedBootKey.get(),
        activeStep: activeStep.get(),
        sandboxStatus: sandboxStatus.get(),
        selectedSandbox: selectedSandbox.get(),
        selectedStorage: selectedStorage.get(),
      }));
    } catch { /* sessionStorage unavailable */ }
  }

  function restoreState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) { return; }
      const state = JSON.parse(raw);
      if (state.bootKey) {
        storedBootKey.set(state.bootKey);
        bootKeyValue.set(state.bootKey);
        // Re-trigger detection probes.
        void detectSandboxFlavors();
        void detectExternalStorage();
      }
      if (state.activeStep) { activeStep.set(state.activeStep); }
      if (state.sandboxStatus === "success" && state.selectedSandbox) {
        sandboxStatus.set("success");
        selectedSandbox.set(state.selectedSandbox);
      }
      if (state.selectedStorage) { selectedStorage.set(state.selectedStorage); }
    } catch { /* ignore parse errors */ }
  }

  // Note: saveState() is called explicitly at key transition points
  // (boot key accepted, sandbox configured, storage selected) rather
  // than via addListener, to avoid stale writes during page unload.

  // Build registration URL.
  const homeUrl = getGristConfig().homeUrl;
  const registerUrl = new URL(commonUrls.signInWithGristRegister);
  if (homeUrl) {
    registerUrl.searchParams.set("uri", new URL(homeUrl).origin);
  }

  async function handleConfigure() {
    const key = configKey.get();
    if (!key) { return; }
    configStatus.set("working");
    configError.set("");
    try {
      const resp = await fetch("/api/setup/configure-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ GRIST_GETGRISTCOM_SECRET: key }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || "Failed to configure authentication");
      }
      configStatus.set("success");
      // Store boot key returned from server for steps 2 and 3.
      if (result.bootKey) {
        storedBootKey.set(result.bootKey);
        activeStep.set(2);
        void detectSandboxFlavors();
        void detectExternalStorage();
      }
    } catch (e) {
      configError.set((e as Error).message);
      configStatus.set("error");
    }
  }

  async function submitBootKey() {
    const key = bootKeyValue.get().trim();
    if (!key) { return; }
    bootKeyStatus.set("working");
    bootKeyError.set("");
    try {
      // Validate the boot key by making a lightweight probe call.
      const resp = await fetch("/api/probes", {
        headers: { "X-Boot-Key": key },
      });
      if (!resp.ok) {
        throw new Error("Invalid boot key");
      }
      storedBootKey.set(key);
      bootKeyStatus.set("idle");
      activeStep.set(2);
      saveState();
      void detectSandboxFlavors();
      void detectExternalStorage();
    } catch (e) {
      bootKeyError.set((e as Error).message);
      bootKeyStatus.set("error");
    }
  }

  const PROBE_TIMEOUT_MS = 30_000;

  function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  // Ordered by preference: gvisor is most secure, pyodide is most portable.
  const SANDBOX_CANDIDATES = ["gvisor", "pyodide", "macSandboxExec"];

  async function detectSandboxFlavors() {
    const key = storedBootKey.get();
    if (!key) { return; }
    sandboxStatus.set("loading");
    sandboxError.set("");
    // Show all candidates immediately as "checking".
    sandboxFlavors.set(SANDBOX_CANDIDATES.map(name => ({ name, status: "checking" as FlavorStatus })));

    // Probe each flavor in parallel, updating the list as each resolves.
    await Promise.all(SANDBOX_CANDIDATES.map(async (name) => {
      try {
        const resp = await fetchWithTimeout(`/api/probes/sandbox-availability?flavor=${name}`, {
          headers: { "X-Boot-Key": key },
        });
        if (!resp.ok) {
          throw new Error(`Probe failed with status ${resp.status}`);
        }
        const result = await resp.json();
        const flavorResult = result.details?.flavors?.[0];
        updateFlavor(name,
          flavorResult?.available ? "available" : "unavailable",
          flavorResult?.error);
      } catch (e) {
        updateFlavor(name, "unavailable", (e as Error).message);
      }
    }));
    // Pre-select first available flavor.
    const firstAvailable = sandboxFlavors.get().find(f => f.status === "available");
    if (firstAvailable) {
      selectedSandbox.set(firstAvailable.name);
    }
    // Ensure "no sandbox" fallback is present (may already have been added by maybeAppendUnsandboxed).
    maybeAppendUnsandboxed();
    sandboxStatus.set("loaded");
  }

  const STORAGE_CANDIDATES = ["minio", "s3", "azure"];

  async function detectExternalStorage() {
    const key = storedBootKey.get();
    if (!key) { return; }
    storageStatus.set("loading");
    storageError.set("");
    // Show all candidates as "checking".
    storageBackends.set(STORAGE_CANDIDATES.map(name => ({ name, status: "checking" as StorageBackendStatus })));

    // Probe the server — currently only detects minio in grist-core.
    try {
      const resp = await fetchWithTimeout("/api/probes/external-storage", {
        headers: { "X-Boot-Key": key },
      });
      const body = await resp.json();
      const details = body.details;
      if (details?.configured && body.status === "success") {
        // Mark the detected backend as available.
        const backend = details.backend || "minio";
        updateStorageBackend(backend, "available", undefined, details.bucket, details.endpoint);
      } else if (details?.configured) {
        // Configured but validation failed.
        const backend = details.backend || "minio";
        updateStorageBackend(backend, "unavailable", details.error || "Validation failed");
      }
    } catch (e) {
      storageError.set((e as Error).message);
    }

    // Mark any still-checking backends as unavailable (not detected),
    // except minio which is always selectable (user can configure it).
    const current = storageBackends.get();
    storageBackends.set(current.map((b) => {
      if (b.status !== "checking") { return b; }
      if (b.name === "minio") {
        return { ...b, status: "selectable" as StorageBackendStatus };
      }
      return { ...b, status: "unavailable" as StorageBackendStatus, error: "Not available" };
    }));
    // Append "none" option.
    storageBackends.set([...storageBackends.get(), { name: "none", status: "available" }]);
    // Pre-select: first available real backend, otherwise nothing.
    const firstAvailable = storageBackends.get().find(b => b.status === "available" && b.name !== "none");
    if (firstAvailable) {
      selectedStorage.set(firstAvailable.name);
    }
    storageStatus.set("loaded");
  }

  function updateStorageBackend(
    name: string, status: StorageBackendStatus, error?: string, bucket?: string, endpoint?: string,
  ) {
    const current = storageBackends.get();
    storageBackends.set(current.map(b =>
      b.name === name ? { name, status, error, bucket, endpoint } : b,
    ));
  }

  function updateFlavor(name: string, status: FlavorStatus, error?: string) {
    const current = sandboxFlavors.get();
    sandboxFlavors.set(current.map(f =>
      f.name === name ? { name, status, error } : f,
    ));
    // Show "no sandbox" as soon as any real sandbox is confirmed available.
    if (status === "available") {
      maybeAppendUnsandboxed();
    }
  }

  function maybeAppendUnsandboxed() {
    const current = sandboxFlavors.get();
    if (current.some(f => f.name === "unsandboxed")) { return; }
    sandboxFlavors.set([...current, { name: "unsandboxed", status: "available" }]);
  }

  async function handleConfigureSandbox() {
    const key = storedBootKey.get();
    const flavor = selectedSandbox.get();
    if (!key || !flavor) { return; }
    sandboxStatus.set("working");
    sandboxError.set("");
    try {
      const resp = await fetch("/api/setup/configure-sandbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": key,
        },
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: flavor }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || "Failed to configure sandboxing");
      }
      sandboxStatus.set("success");
      activeStep.set(3);
      saveState();
    } catch (e) {
      sandboxError.set((e as Error).message);
      sandboxStatus.set("error");
    }
  }

  async function handleGoLive() {
    const key = storedBootKey.get();
    if (!key) { return; }
    goLiveStatus.set("working");
    goLiveError.set("");
    try {
      const resp = await fetch("/api/setup/go-live", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Boot-Key": key,
        },
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || "Failed to go live");
      }
      goLiveStatus.set("success");
    } catch (e) {
      goLiveError.set((e as Error).message);
      goLiveStatus.set("error");
    }
  }

  // Restore saved progress (boot key, active step, etc.) after a page refresh.
  restoreState();

  return pagePanels({
    headerMain: cssSetupHeaderMain(buildLanguageMenu(appModel)),
    contentMain: cssCenteredContent(cssCenteredContent.cls("-setup"), cssErrorContent(
      cssBigIcon(),
      cssErrorHeader("Set up your Grist installation", testId("error-header")),
      [
        cssTabBar(
          ...[
            { step: 1 as const, icon: "1", label: "Verify",
              done: (use: UseCBOwner) => !!use(storedBootKey) },
            { step: 2 as const, icon: "2", label: "Sandboxing",
              done: (use: UseCBOwner) => use(sandboxStatus) === "success" },
            { step: 3 as const, icon: "3", label: "Backups",
              done: (use: UseCBOwner) => !!use(selectedStorage) },
            { step: 4 as const, icon: "4", label: "Go live",
              done: (use: UseCBOwner) => use(goLiveStatus) === "success" },
          ].map(({ step, icon, label, done }) =>
            cssTab(
              cssTabNumber(icon),
              label,
              dom.maybe(done, () => cssTabCheck("\u2713")),
              cssTab.cls("-active", use => use(activeStep) === step),
              dom.on("click", () => activeStep.set(step)),
              testId(`setup-tab-${step}`),
            ),
          ),
        ),

        cssSetupSection(
          dom.show(use => use(activeStep) === 1),
          cssSetupSectionTitle("Verify you are the installer"),
          cssSetupDescription(
            "Before configuring anything, we need to confirm you're the person who installed ",
            "this server. Choose how to verify:",
          ),
          cssSegmentedControl(
            cssSegmentedOption(
              cssSegmentedOption.cls("-selected", use => use(authMode) === "getgrist"),
              dom.on("click", () => authMode.set("getgrist")),
              "Register on getgrist.com",
              testId("setup-toggle-env"),
            ),
            cssSegmentedOption(
              cssSegmentedOption.cls("-selected", use => use(authMode) === "bootkey"),
              dom.on("click", () => authMode.set("bootkey")),
              "Enter boot key",
              testId("setup-toggle-bootkey"),
            ),
          ),
          dom.domComputed(authMode, mode => mode === "getgrist" ? [
            cssSetupDescription(
              "Declare your admin email in the environment and restart:",
            ),
            cssSetupCode(
              "GRIST_ADMIN_EMAIL=you@example.com",
            ),
            cssSetupDescription(
              "Then register your Grist server on getgrist.com ",
              dom("b", "using that same email address"),
              ".",
            ),
            cssSetupDescription(
              cssLink(
                "Register your Grist server",
                { href: registerUrl.href, target: "_blank" },
                testId("setup-register-link"),
              ),
            ),
            cssSetupDescription(
              "Paste the configuration key you receive below:",
            ),
            cssSetupConfigTextarea(
              dom.prop("value", (use) => {
                const status = use(configStatus);
                const key = use(configKey);
                if (status === "success" && key) {
                  return key.replace(/./g, "*");
                }
                return key;
              }),
              dom.on("input", (_e: Event, elem: HTMLTextAreaElement) => configKey.set(elem.value)),
              { placeholder: "Paste configuration key here" },
              dom.prop("disabled", use =>
                use(configStatus) === "working" || use(configStatus) === "success",
              ),
              testId("setup-config-key"),
            ),
            dom.maybe(configError, err =>
              cssSetupError(err, testId("setup-config-error")),
            ),
            dom.domComputed(configStatus, status => status === "success" ? [
              cssSetupDescription(
                dom("b", "Authentication configured."),
                " Please restart your server to activate Sign in with getgrist.com.",
              ),
            ] : [
              cssBootKeySubmit(
                "Configure",
                dom.prop("disabled", use => !use(configKey) || use(configStatus) === "working"),
                dom.on("click", handleConfigure),
                testId("setup-configure-submit"),
              ),
            ]),
          ] : [
            cssSetupDescription(
              "When Grist starts, it prints a ",
              dom("b", "BOOT KEY"),
              " banner to the server output. ",
              "Check your server logs for a box that looks like this:",
            ),
            cssSetupCode("BOOT KEY: a1b2c3d4e5f6a1b2c3d4e5f6"),
            cssSetupDescription(
              "For Docker: ",
              dom("code", "docker logs <container>"),
              ". For systemd: ",
              dom("code", "journalctl -u grist"),
              ".",
            ),
            cssBootKeyRow(
              cssBootKeyInput(
                dom.prop("value", (use) => {
                  const key = use(bootKeyValue);
                  if (use(storedBootKey) && key) {
                    return key.replace(/./g, "*");
                  }
                  return key;
                }),
                dom.on("input", (_e: Event, elem: HTMLInputElement) => bootKeyValue.set(elem.value)),
                { placeholder: "Enter boot key from server logs" },
                dom.prop("disabled", use =>
                  use(bootKeyStatus) === "working" || !!use(storedBootKey),
                ),
                dom.on("keydown", (ev: KeyboardEvent) => {
                  if (ev.key === "Enter") { void submitBootKey(); }
                }),
                testId("setup-boot-key-input"),
              ),
              cssBootKeySubmit(
                "Submit",
                dom.prop("disabled", use =>
                  !use(bootKeyValue) || use(bootKeyStatus) === "working" || !!use(storedBootKey),
                ),
                dom.on("click", () => void submitBootKey()),
                testId("setup-boot-key-submit"),
              ),
            ),
            dom.maybe(bootKeyError, err =>
              cssSetupError(err, testId("setup-boot-key-error")),
            ),
            dom.maybe(storedBootKey, () =>
              cssSetupDescription(
                dom("b", "Boot key accepted."),
                " Detecting sandbox options below...",
              ),
            ),
          ]),
        ),

        cssSetupSection(
          dom.show(use => use(activeStep) === 2),
          cssSetupSectionTitle("Sandboxing"),
          cssSetupDescription(
            "Grist runs user formulas as Python code. Sandboxing isolates this execution ",
            "to protect your server. Without it, document formulas can access the full system.",
          ),
          dom.domComputed(sandboxStatus, (status) => {
            const flavorMeta: Record<string, {
              label: string; desc: string; recommended?: boolean; notRecommended?: boolean;
            }> = {
              gvisor: {
                label: "gVisor",
                desc: "Strong isolation via Google's container sandbox. Linux only, requires runsc.",
                recommended: true,
              },
              pyodide: {
                label: "Pyodide",
                desc: "Runs Python in WebAssembly. Works on any platform, no extra install needed.",
              },
              macSandboxExec: {
                label: "macOS Sandbox",
                desc: "Uses the built-in macOS sandbox-exec facility. macOS only.",
              },
              unsandboxed: {
                label: "No Sandbox",
                desc: "Formulas run with full system access. Only use if you trust all document authors.",
                notRecommended: true,
              },
            };

            function renderFlavorCard(
              name: string,
              opts: {
                radio?: boolean;
                disabled?: boolean;
                status?: FlavorStatus;
                error?: string;
                onSelect?: () => void;
              } = {},
            ) {
              const meta = flavorMeta[name] || { label: name, desc: "" };
              const isAvail = opts.status === "available";
              const isChecking = opts.status === "checking";
              const isUnavail = opts.status === "unavailable";
              const dimmed = opts.disabled && !isChecking;
              return cssSandboxCard(
                cssSandboxCard.cls("-disabled", Boolean(dimmed)),
                cssSandboxCard.cls("-selected", use => use(selectedSandbox) === name),
                cssSandboxCard.cls("-available", isAvail),
                opts.onSelect && !opts.disabled ?
                  dom.on("click", opts.onSelect) : null,
                opts.radio ? cssSandboxRadio(
                  { type: "radio", name: "sandbox-flavor", value: name },
                  dom.prop("checked", use => use(selectedSandbox) === name),
                  dom.prop("disabled", Boolean(opts.disabled)),
                  opts.onSelect ? dom.on("change", opts.onSelect) : null,
                ) : cssSandboxRadio(
                  { type: "radio", name: "sandbox-preview", disabled: true },
                ),
                cssSandboxCardBody(
                  cssSandboxNameRow(
                    cssSandboxName(meta.label),
                    meta.recommended ? cssSandboxRecommended("Recommended") : null,
                    meta.notRecommended ? cssSandboxBadge(cssSandboxBadge.cls("-warn"), "Not recommended") : null,
                    isAvail && !meta.notRecommended ?
                      cssSandboxBadge(cssSandboxBadge.cls("-ok"), "\u2713 Available") : null,
                    isUnavail ? cssSandboxBadge(cssSandboxBadge.cls("-fail"), "\u2717 Not available") : null,
                    isChecking ? cssSandboxBadge(cssSandboxBadge.cls("-checking"), "Checking\u2026") : null,
                  ),
                  cssSandboxCardDesc(meta.desc),
                  isUnavail && opts.error ?
                    cssSandboxErrorHint(opts.error) : null,
                ),
                testId(`setup-sandbox-option-${name}`),
              );
            }

            if (status === "idle") {
              return [
                cssSandboxPreview(
                  ...SANDBOX_CANDIDATES.map(name =>
                    renderFlavorCard(name, { disabled: true }),
                  ),
                ),
                cssSandboxPreviewHint(
                  "Complete step 1 to verify you are the installer.",
                ),
                cssBootKeySubmit(
                  "Configure",
                  dom.prop("disabled", true),
                  testId("setup-sandbox-submit"),
                ),
              ];
            }
            if (status === "success") {
              const meta = flavorMeta[selectedSandbox.get()];
              const label = meta ? meta.label : selectedSandbox.get();
              return [
                cssSandboxSuccessBox(
                  cssSandboxSuccessIcon("\u2713"),
                  dom("div",
                    dom("b", `Sandboxing set to ${label}.`),
                    dom("div", "This will take effect when you go live."),
                  ),
                  testId("setup-sandbox-success"),
                ),
              ];
            }
            if (status === "error" && sandboxFlavors.get().length === 0) {
              return [
                cssSetupError(
                  sandboxError.get() || "Failed to detect sandbox flavors",
                  testId("setup-sandbox-error"),
                ),
              ];
            }
            // "loading", "loaded", "working", or "error" after loading
            return [
              dom.domComputed(sandboxFlavors, (flavors) => {
                if (flavors.length === 0) {
                  return cssSetupDescription("No sandbox flavors detected.");
                }
                return cssSandboxList(
                  ...flavors.map((f) => {
                    const isAvailable = f.status === "available";
                    const canSelect = isAvailable && status !== "working";
                    return renderFlavorCard(f.name, {
                      radio: true,
                      disabled: !canSelect,
                      status: f.status,
                      error: f.error,
                      onSelect: () => selectedSandbox.set(f.name),
                    });
                  }),
                );
              }),
              dom.maybe(sandboxError, err =>
                cssSetupError(err, testId("setup-sandbox-error")),
              ),
              cssBootKeySubmit(
                "Configure",
                dom.prop("disabled", use =>
                  !use(selectedSandbox) ||
                  use(sandboxStatus) === "loading" ||
                  use(sandboxStatus) === "working" ||
                  use(sandboxStatus) === "success",
                ),
                dom.on("click", handleConfigureSandbox),
                testId("setup-sandbox-submit"),
              ),
            ];
          }),
        ),

        cssSetupSection(
          dom.show(use => use(activeStep) === 3),
          cssSetupSectionTitle("Backups"),
          cssSetupDescription(
            "Store document snapshots in S3-compatible external storage for backup and versioning. ",
            "Without this, documents are only stored on the local filesystem.",
          ),
          dom.domComputed(storageStatus, (status) => {
            const storageMeta: Record<string, {
              label: string; desc: string; recommended?: boolean; notRecommended?: boolean;
            }> = {
              minio: {
                label: "S3 (MinIO client)",
                desc: "S3-compatible storage via MinIO client library. Works with AWS S3, MinIO, and others.",
                recommended: true,
              },
              s3: {
                label: "S3 (AWS client)",
                desc: "S3-compatible storage via native AWS SDK. Supports IAM roles and AWS-native auth.",
              },
              azure: {
                label: "Azure Blob Storage",
                desc: "Microsoft Azure Blob Storage for document snapshots.",
              },
              none: {
                label: "No External Storage",
                desc: "Documents stored on local filesystem only. No off-server backups or versioning.",
                notRecommended: true,
              },
            };

            function renderStorageCard(
              backend: StorageBackendInfo,
              opts: { radio?: boolean; disabled?: boolean; } = {},
            ) {
              const meta = storageMeta[backend.name] || { label: backend.name, desc: "" };
              const isAvail = backend.status === "available";
              const isSelectable = backend.status === "selectable";
              const isChecking = backend.status === "checking";
              const isUnavail = backend.status === "unavailable";
              const effectiveDisabled = opts.disabled || isUnavail;
              const dimmed = effectiveDisabled && !isChecking;
              const canSelect = (isAvail || isSelectable) && !opts.disabled;
              return cssSandboxCard(
                cssSandboxCard.cls("-disabled", Boolean(dimmed)),
                cssSandboxCard.cls("-selected", use => use(selectedStorage) === backend.name),
                cssSandboxCard.cls("-available", isAvail || isSelectable),
                canSelect ? dom.on("click", () => { selectedStorage.set(backend.name); saveState(); }) : null,
                opts.radio ? cssSandboxRadio(
                  { type: "radio", name: "storage-backend", value: backend.name },
                  dom.prop("checked", use => use(selectedStorage) === backend.name),
                  dom.prop("disabled", !canSelect),
                  canSelect ? dom.on("change", () => { selectedStorage.set(backend.name); saveState(); }) : null,
                ) : cssSandboxRadio(
                  { type: "radio", name: "storage-preview", disabled: true },
                ),
                cssSandboxCardBody(
                  cssSandboxNameRow(
                    cssSandboxName(meta.label),
                    meta.recommended ? cssSandboxRecommended("Recommended") : null,
                    !opts.disabled && meta.notRecommended ?
                      cssSandboxBadge(cssSandboxBadge.cls("-warn"), "Not recommended") : null,
                    !opts.disabled && isAvail && !meta.notRecommended ?
                      cssSandboxBadge(cssSandboxBadge.cls("-ok"), "\u2713 Available") : null,
                    !opts.disabled && isSelectable ?
                      cssSandboxBadge(cssSandboxBadge.cls("-fail"), "Not configured") : null,
                    !opts.disabled && isUnavail ?
                      cssSandboxBadge(cssSandboxBadge.cls("-fail"), "\u2717 Not available") : null,
                    !opts.disabled && isChecking ?
                      cssSandboxBadge(cssSandboxBadge.cls("-checking"), "Checking\u2026") : null,
                  ),
                  cssSandboxCardDesc(meta.desc),
                  isAvail && backend.bucket ?
                    cssSandboxCardDesc(`Bucket: ${backend.bucket}` +
                      (backend.endpoint ? ` (${backend.endpoint})` : "")) : null,
                  isUnavail && backend.error && backend.error !== "Not available" ?
                    cssSandboxErrorHint(backend.error) : null,
                ),
                testId(`setup-storage-option-${backend.name}`),
              );
            }

            if (status === "idle") {
              return [
                cssSandboxPreview(
                  ...STORAGE_CANDIDATES.map(name =>
                    renderStorageCard({ name, status: "unavailable" }, { disabled: true }),
                  ),
                ),
                cssSandboxPreviewHint(
                  "Complete step 1 to verify you are the installer.",
                  testId("setup-storage-idle"),
                ),
                cssBootKeySubmit(
                  "Continue",
                  dom.prop("disabled", true),
                  testId("setup-storage-continue"),
                ),
              ];
            }
            // "loading" or "loaded"
            return [
              dom.domComputed(storageBackends, (backends) => {
                if (backends.length === 0) {
                  return cssSandboxBadge(cssSandboxBadge.cls("-checking"),
                    "Checking external storage\u2026",
                    testId("setup-storage-loading"),
                  );
                }
                return cssSandboxList(
                  ...backends.map(b => renderStorageCard(b, { radio: true })),
                  testId("setup-storage-not-configured"),
                );
              }),
              dom.domComputed((use) => {
                const sel = use(selectedStorage);
                const backends = use(storageBackends);
                const backend = backends.find(b => b.name === sel);
                if (backend?.status !== "selectable") { return null; }
                // Show setup instructions for the selected-but-unconfigured backend.
                if (sel === "minio") {
                  return dom("div",
                    cssSetupDescription(
                      "Set these environment variables and restart Grist to enable MinIO storage:",
                    ),
                    cssSetupCode(
                      "GRIST_DOCS_MINIO_BUCKET=my-grist-docs\n" +
                      "GRIST_DOCS_MINIO_ENDPOINT=s3.amazonaws.com\n" +
                      "GRIST_DOCS_MINIO_ACCESS_KEY=...\n" +
                      "GRIST_DOCS_MINIO_SECRET_KEY=...",
                    ),
                    cssSetupDescription(
                      "Works with AWS S3, MinIO, and any S3-compatible storage provider.",
                    ),
                    testId("setup-storage-instructions"),
                  );
                }
                return null;
              }),
              dom.maybe(storageError, err =>
                cssSetupError(err, testId("setup-storage-error")),
              ),
              cssBootKeySubmit(
                "Continue",
                dom.prop("disabled", use => !use(selectedStorage)),
                dom.on("click", () => activeStep.set(4)),
                testId("setup-storage-continue"),
              ),
            ];
          }),
        ),

        cssSetupSection(
          dom.show(use => use(activeStep) === 4),
          cssSetupSectionTitle("Go live"),
          cssSetupDescription(
            "Launch Grist for you, the installer. Use the admin panel to configure ",
            "authentication so other users can access it too.",
          ),
          cssSetupDescription(
            "Or skip this wizard entirely by setting ",
            dom("code", "GRIST_IN_SERVICE=true"),
            " and restarting.",
          ),
          dom.domComputed(use => ({
            status: use(goLiveStatus),
            key: use(storedBootKey),
            sandbox: use(sandboxStatus),
            storage: use(selectedStorage),
          }), ({ status, key, sandbox, storage }) => {
            if (status === "success") {
              return [
                cssSandboxSuccessBox(
                  cssSandboxSuccessIcon("\u2713"),
                  dom("div",
                    dom("b", "Grist is live!"),
                    dom("div",
                      "You are signed in as the installer. To let other people use this server, ",
                      "configure authentication (such as OIDC or SAML) in the admin panel. ",
                      "You can also bring Grist back out of service from there.",
                    ),
                  ),
                  testId("setup-go-live-success"),
                ),
                cssGoLiveAdminButton(
                  "Head to the admin panel",
                  dom.on("click", () => { window.location.href = `/admin?boot-key=${key}`; }),
                  testId("setup-go-live-admin-link"),
                ),
              ];
            }
            const stepsReady = !!key && sandbox === "success" && !!storage;
            return [
              !key ? cssSandboxPreviewHint("Complete step 1 to verify you are the installer.") :
                !stepsReady ? cssSandboxPreviewHint(
                  "Complete steps 2 and 3 first.",
                  testId("setup-go-live-blocked"),
                ) : null,
              dom.maybe(goLiveError, err =>
                cssSetupError(err, testId("setup-go-live-error")),
              ),
              cssBootKeySubmit(
                "Go live",
                dom.prop("disabled", !stepsReady || status === "working"),
                dom.on("click", () => void handleGoLive()),
                testId("setup-go-live-submit"),
              ),
            ];
          }),
        ),

        testId("setup-page"),

        // --- Mockup controls (for development/demo only) ---
        dom.create(buildMockupControls, {
          configKey, configStatus, configError, storedBootKey,
          sandboxFlavors, selectedSandbox, sandboxStatus, sandboxError,
          storageBackends, selectedStorage, storageStatus, storageError,
          goLiveStatus, goLiveError,
          authMode, bootKeyValue, bootKeyStatus, bootKeyError,
          activeStep,
          handleConfigure, detectSandboxFlavors,
        }),
      ],
      testId("error-content"),
    )),
  });
}

interface MockupState {
  configKey: Observable<string>;
  configStatus: Observable<string>;
  configError: Observable<string>;
  storedBootKey: Observable<string>;
  sandboxFlavors: Observable<{ name: string; status: string; error?: string }[]>;
  selectedSandbox: Observable<string>;
  sandboxStatus: Observable<string>;
  sandboxError: Observable<string>;
  storageBackends: Observable<{ name: string; status: string; error?: string }[]>;
  selectedStorage: Observable<string>;
  storageStatus: Observable<string>;
  storageError: Observable<string>;
  goLiveStatus: Observable<string>;
  goLiveError: Observable<string>;
  authMode: Observable<"getgrist" | "bootkey">;
  bootKeyValue: Observable<string>;
  bootKeyStatus: Observable<string>;
  bootKeyError: Observable<string>;
  activeStep: Observable<1 | 2 | 3 | 4>;
  handleConfigure: () => Promise<void>;
  detectSandboxFlavors: () => Promise<void>;
}

function buildMockupControls(owner: any, state: MockupState) {
  const mockupEmail = observable("admin@example.com");
  const mockupLog = observable("");

  function log(msg: string) {
    mockupLog.set(msg);
  }

  // Build a config key the same way tests do — base64-encoded JSON with OIDC fields + owner.
  function buildConfigKey(email: string): string {
    const payload = {
      oidcClientId: "mock-client-id",
      oidcClientSecret: "mock-client-secret",
      oidcIssuer: "https://login.getgrist.com",
      owner: { name: "Setup Admin", email },
    };
    return btoa(JSON.stringify(payload));
  }

  async function fetchBootKey() {
    log("Fetching boot key...");
    try {
      const resp = await fetch("/api/setup/mockup-boot-key");
      const body = await resp.json();
      if (body.bootKey) {
        state.authMode.set("bootkey");
        state.bootKeyValue.set(body.bootKey);
        state.activeStep.set(1);
        log(`Boot key filled in`);
      } else {
        log("No bootKey returned (server may be in service)");
      }
    } catch (e) {
      log(`Error: ${(e as Error).message}`);
    }
  }

  async function doGetgristComAuth() {
    const email = mockupEmail.get().trim();
    if (!email) {
      log("Enter an email first");
      return;
    }
    // Set GRIST_ADMIN_EMAIL on the server so configure-auth will accept the key.
    log("Setting admin email...");
    try {
      const resp = await fetch("/api/setup/mockup-set-admin-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!resp.ok) {
        throw new Error("Failed to set admin email");
      }
    } catch (e) {
      log(`Error: ${(e as Error).message}`);
      return;
    }
    const key = buildConfigKey(email);
    state.authMode.set("getgrist");
    state.configKey.set(key);
    state.activeStep.set(1);
    log(`Admin email set, config key filled in`);
  }

  async function doBootKeyAuth() {
    await fetchBootKey();
  }

  function resetAll() {
    state.configStatus.set("idle");
    state.configError.set("");
    state.configKey.set("");
    state.storedBootKey.set("");
    state.sandboxFlavors.set([]);
    state.selectedSandbox.set("");
    state.sandboxStatus.set("idle");
    state.sandboxError.set("");
    state.bootKeyStatus.set("idle");
    state.bootKeyError.set("");
    state.storageBackends.set([]);
    state.selectedStorage.set("");
    state.storageStatus.set("idle");
    state.storageError.set("");
    state.goLiveStatus.set("idle");
    state.goLiveError.set("");
    state.activeStep.set(1);
    log("Reset");
  }

  return cssMockupPanel(
    cssMockupTitle("Mockup controls"),

    // --- Step 1 ---
    cssMockupSection("Step 1: Verify identity"),
    cssMockupRow(
      cssMockupLabel("Email:"),
      cssMockupInput(
        dom.prop("value", mockupEmail),
        dom.on("input", (_e: Event, el: HTMLInputElement) => mockupEmail.set(el.value)),
        { placeholder: "admin@example.com" },
      ),
    ),
    cssMockupRow(
      cssMockupButton(
        "Fill in config key",
        dom.on("click", () => doGetgristComAuth()),
        { title: "Build a config key for this email and paste it into the textarea" },
      ),
      cssMockupButton(
        "Fill in boot key",
        dom.on("click", () => void doBootKeyAuth()),
        { title: "Fetch boot key from mockup endpoint, then detect sandboxes" },
      ),
    ),

    // --- Utilities ---
    cssMockupSection("Utilities"),
    cssMockupRow(
      cssMockupButton("Reset all", dom.on("click", resetAll)),
    ),
    cssMockupRow(
      dom.domComputed(state.storedBootKey, key =>
        key ? cssMockupInfo(`Boot key: ${key.slice(0, 12)}...`) : cssMockupInfo("No boot key yet"),
      ),
    ),
    dom.maybe(mockupLog, msg => cssMockupLog(msg)),
  );
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

const cssSetupSection = styled("div", `
  text-align: left;
  max-width: 500px;
  margin: 0 auto 24px auto;
  padding: 16px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 4px;
`);

const cssTabBar = styled("div", `
  display: flex;
  justify-content: center;
  gap: 4px;
  max-width: 500px;
  margin: 0 auto 16px auto;
`);

const cssTab = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: ${vars.mediumFontSize};
  cursor: pointer;
  color: ${theme.lightText};
  border-bottom: 2px solid transparent;
  user-select: none;
  transition: color 0.15s, border-color 0.15s;
  &:hover {
    color: ${theme.text};
  }
  &-active {
    color: ${theme.text};
    font-weight: 600;
    border-bottom-color: ${theme.controlPrimaryBg};
  }
`);

const cssTabNumber = styled("span", `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${theme.pagePanelsBorder};
  font-size: ${vars.smallFontSize};
  font-weight: bold;
  flex-shrink: 0;
  .${cssTab.className}-active > & {
    background: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
  }
`);

const cssTabCheck = styled("span", `
  color: ${theme.controlFg};
  font-weight: bold;
  font-size: ${vars.smallFontSize};
`);

const cssSetupSectionTitle = styled("div", `
  font-weight: ${vars.headerControlTextWeight};
  font-size: ${vars.largeFontSize};
  color: ${theme.text};
`);

const cssSetupDescription = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
  margin-bottom: 12px;
`);

const cssSetupCode = styled("div", `
  font-family: monospace;
  font-size: ${vars.mediumFontSize};
  background: ${theme.pagePanelsBorder};
  padding: 8px 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  margin-bottom: 8px;
  word-break: break-all;
`);

const cssSegmentedControl = styled("div", `
  display: inline-flex;
  border: 1px solid ${theme.inputBorder};
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
  margin-bottom: 12px;
`);

const cssSegmentedOption = styled("div", `
  padding: 6px 16px;
  font-size: ${vars.mediumFontSize};
  cursor: pointer;
  color: ${theme.lightText};
  user-select: none;
  transition: background-color 0.15s, color 0.15s;
  &:not(:last-child) {
    border-right: 1px solid ${theme.inputBorder};
  }
  &:hover:not(&-selected) {
    background: ${theme.controlSecondaryHoverBg};
  }
  &-selected {
    background: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryFg};
  }
`);

const cssBootKeyRow = styled("div", `
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`);

const cssBootKeyInput = styled("input", `
  flex: 1;
  font-size: ${vars.mediumFontSize};
  padding: 6px 10px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  &:focus {
    border-color: ${theme.controlFg};
  }
`);

const cssBootKeySubmit = styled("button", `
  font-size: ${vars.mediumFontSize};
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  cursor: pointer;
  &:hover {
    background: ${theme.controlPrimaryHoverBg};
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`);

const cssGoLiveAdminButton = styled("button", `
  display: block;
  margin-top: 12px;
  font-size: ${vars.mediumFontSize};
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  background: ${theme.controlPrimaryBg};
  color: ${theme.controlPrimaryFg};
  cursor: pointer;
  font-weight: 600;
  &:hover {
    background: ${theme.controlPrimaryHoverBg};
  }
`);

const cssSetupConfigTextarea = styled("textarea", `
  width: 100%;
  min-height: 80px;
  font-size: ${vars.mediumFontSize};
  font-family: monospace;
  padding: 8px 10px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  resize: vertical;
  margin-bottom: 8px;
  box-sizing: border-box;
  &:focus {
    border-color: ${theme.controlFg};
  }
`);

const cssSetupError = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.errorText};
  margin-bottom: 8px;
`);

const cssSandboxList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
`);

const cssSandboxCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 6px;
  transition: border-color 0.15s, background-color 0.15s;
  cursor: pointer;
  &-disabled {
    opacity: 0.5;
    cursor: default;
  }
  &-selected {
    border-color: ${theme.controlFg};
    background: ${theme.controlSecondaryHoverBg};
  }
  &-available:not(&-selected):hover {
    border-color: ${theme.controlSecondaryFg};
  }
`);

const cssSandboxRadio = styled("input", `
  margin-top: 4px;
  flex-shrink: 0;
`);

const cssSandboxCardBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`);

const cssSandboxNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssSandboxName = styled("span", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${theme.text};
`);

const cssSandboxRecommended = styled("span", `
  font-size: ${vars.smallFontSize};
  font-weight: 600;
  color: ${theme.controlFg};
  background: ${theme.controlSecondaryHoverBg};
  padding: 1px 6px;
  border-radius: 3px;
`);

const cssSandboxBadge = styled("span", `
  font-size: ${vars.smallFontSize};
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  &-ok {
    color: ${theme.controlFg};
    background: ${theme.controlSecondaryHoverBg};
    font-weight: 600;
  }
  &-fail {
    color: ${theme.lightText};
  }
  &-warn {
    color: ${theme.errorText};
    font-weight: 600;
  }
  &-checking {
    color: ${theme.lightText};
    font-style: italic;
    animation: sandbox-checking-pulse 1.5s ease-in-out infinite;
  }
  @keyframes sandbox-checking-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`);

const cssSandboxCardDesc = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  line-height: 1.4;
`);

const cssSandboxErrorHint = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
`);

const cssSandboxPreview = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
  opacity: 0.45;
  pointer-events: none;
`);

const cssSandboxPreviewHint = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  font-style: italic;
  margin-bottom: 8px;
`);

const cssSandboxSuccessBox = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid ${theme.controlFg};
  border-radius: 6px;
  background: ${theme.controlSecondaryHoverBg};
  color: ${theme.controlFg};
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
`);

const cssSandboxSuccessIcon = styled("div", `
  font-size: 20px;
  font-weight: bold;
  line-height: 1;
  flex-shrink: 0;
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

const cssMockupLabel = styled("span", `
  font-size: 11px;
  color: ${theme.lightText};
  white-space: nowrap;
  align-self: center;
`);

const cssMockupInput = styled("input", `
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  background: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;
  flex: 1;
  min-width: 0;
  &:focus {
    border-color: ${theme.controlFg};
  }
`);

const cssMockupInfo = styled("div", `
  font-size: 10px;
  color: ${theme.lightText};
  font-family: monospace;
`);

const cssMockupLog = styled("div", `
  font-size: 10px;
  color: ${theme.controlFg};
  font-family: monospace;
  margin-top: 4px;
  padding: 3px 6px;
  background: ${theme.inputBg};
  border-radius: 2px;
  word-break: break-all;
`);
