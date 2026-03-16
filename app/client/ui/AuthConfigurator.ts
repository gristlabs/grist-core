import { makeT } from "app/client/lib/localization";
import { AppModel, getHomeUrl, reportError } from "app/client/models/AppModel";
import { AdminPanelControls } from "app/client/ui/AdminPanelCss";
import { ChangeAdminModal } from "app/client/ui/ChangeAdminModal";
import { GetGristComProviderInfoModal } from "app/client/ui/GetGristComProvider";
import { basicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { confirmModal, saveModal } from "app/client/ui2018/modals";
import { AuthProvider, ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { PendingChanges } from "app/common/Install";
import { InstallAPI } from "app/common/InstallAPI";
import {
  BOOT_KEY_PROVIDER_KEY,
  DEPRECATED_PROVIDERS,
  GETGRIST_COM_PROVIDER_KEY,
  MINIMAL_PROVIDER_KEY,
} from "app/common/loginProviders";

import { Computed, Disposable, dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("AuthConfigurator");

/**
 * Human-readable metadata for known auth providers.
 * Order here determines display order in the alternatives list.
 */
const PROVIDER_META: Record<string, {
  label: string;
  desc: string;
  heroDesc: string;
  docsUrl?: string;
  requiredVars?: string[];
}> = {
  "oidc": {
    label: "OIDC",
    desc: t("OpenID Connect — works with most identity providers."),
    heroDesc: t("Your server is configured to authenticate users via OpenID Connect. " +
      "Users sign in through your identity provider and are redirected back to Grist."),
    docsUrl: "https://support.getgrist.com/install/oidc",
    requiredVars: ["GRIST_OIDC_IDP_ISSUER", "GRIST_OIDC_IDP_CLIENT_ID", "GRIST_OIDC_IDP_CLIENT_SECRET"],
  },
  "saml": {
    label: "SAML",
    desc: t("SAML 2.0 — for enterprise identity providers."),
    heroDesc: t("Your server is configured to authenticate users via SAML 2.0. " +
      "Users sign in through your identity provider and are redirected back to Grist."),
    docsUrl: "https://support.getgrist.com/install/saml/",
    requiredVars: [
      "GRIST_SAML_SP_HOST", "GRIST_SAML_SP_KEY", "GRIST_SAML_SP_CERT",
      "GRIST_SAML_IDP_LOGIN", "GRIST_SAML_IDP_LOGOUT", "GRIST_SAML_IDP_CERTS",
    ],
  },
  "forward-auth": {
    label: t("Forwarded headers"),
    desc: t("Authentication handled by a reverse proxy (Traefik, Authelia, etc)."),
    heroDesc: t("Your server trusts authentication from a reverse proxy. " +
      "The proxy handles login and passes verified user information to Grist via HTTP headers."),
    docsUrl: "https://support.getgrist.com/install/forwarded-headers/",
    requiredVars: ["GRIST_FORWARD_AUTH_HEADER", "GRIST_FORWARD_AUTH_LOGOUT_PATH"],
  },
  "grist-connect": {
    label: "Grist Connect",
    desc: t("Managed login service from Grist Labs."),
    heroDesc: t("Your server uses Grist Connect, a managed login service from Grist Labs. " +
      "Users authenticate through Grist Connect and are signed into your server."),
    docsUrl: "https://support.getgrist.com/install/grist-connect/",
    requiredVars: ["GRIST_GETGRISTCOM_SECRET"],
  },
  "getgrist.com": {
    label: "getgrist.com",
    desc: t("Sign in with getgrist.com account."),
    heroDesc: t("Your server uses getgrist.com authentication. " +
      "Users sign in with their getgrist.com account."),
    requiredVars: ["GRIST_GETGRISTCOM_SECRET"],
  },
};

/** Providers that aren't "real" auth — boot-key, minimal, no-logins, no-auth. */
function isRealProvider(key: string): boolean {
  return !!key && key !== "minimal" && key !== "boot-key" && key !== "no-logins" && key !== "no-auth";
}

/** Filter provider list to visible entries (hide minimal, boot-key, deprecated-unless-active). */
function visibleProviders(providers: AuthProvider[]): AuthProvider[] {
  return providers.filter(p =>
    p.key !== MINIMAL_PROVIDER_KEY &&
    p.key !== BOOT_KEY_PROVIDER_KEY &&
    (!DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive),
  );
}

export interface AuthConfiguratorOptions {
  mode?: "wizard" | "panel";
  controls?: AdminPanelControls;
}

/**
 * Unified component for authentication status and configuration.
 *
 * Two modes:
 * - **wizard**: Hero card + alternatives + Continue button. Requires
 *   explicit acknowledgment when no auth is configured.
 * - **panel**: Hero card with admin email + provider cards with env
 *   var guidance, "Set as active" buttons, and "Change admin" action.
 *
 * Both modes share the same data fetching, provider metadata, hero/card
 * builders, and badge styles. Mode only affects which action elements appear.
 */
export class AuthConfigurator extends Disposable {
  // Current auth probe status.
  public readonly status = Observable.create<"idle" | "checking" | "ready">(this, "idle");

  // The active provider key (e.g. "oidc", "minimal").
  public readonly activeProvider = Observable.create<string>(this, "");

  // Whether the user has acknowledged running without auth (wizard mode).
  public readonly noAuthAcknowledged = Observable.create<boolean>(this, false);

  // Auth providers from the config API.
  public readonly providers = Observable.create<AuthProvider[]>(this, []);

  // Whether real auth is active or will be active after restart.
  public readonly hasRealAuth: Computed<boolean> = Computed.create(this, (use) => {
    if (isRealProvider(use(this.activeProvider))) { return true; }
    // A provider configured and pending activation counts too.
    return use(this.providers).some(p => isRealProvider(p.key) && (p.isActive || p.willBeActive));
  });

  // Ready to continue: either has real auth, or explicitly acknowledged.
  public readonly authReady: Computed<boolean> = Computed.create(this, use =>
    use(this.hasRealAuth) || use(this.noAuthAcknowledged));

  private _configAPI = new ConfigAPI(getHomeUrl());
  private _mode: "wizard" | "panel";
  private _controls: AdminPanelControls | null;

  // Providers reconfigured this session. Their activeError is stale
  // (from before the config change) and should be suppressed until restart.
  private _recentlyConfigured = new Set<string>();

  // Panel-mode state for pending restart changes.
  private _pendingChanges = Observable.create<PendingChanges | null>(this, null);

  private _hasPendingRestart = Computed.create(this, (use) => {
    const providers = use(this.providers);
    const hasProviderChange = providers.some(p => p.willBeActive) ||
      this._recentlyConfigured.size > 0;
    const pending = use(this._pendingChanges);
    const hasAdminChange = Boolean(
      pending?.onRestartSetAdminEmail || pending?.onRestartReplaceEmailWithAdmin,
    );
    return hasProviderChange || hasAdminChange;
  });

  constructor(
    private _installAPI: InstallAPI,
    private _appModel: AppModel,
    options?: AuthConfiguratorOptions,
  ) {
    super();
    this._mode = options?.mode ?? "wizard";
    this._controls = options?.controls ?? null;

    // In panel mode, notify AdminPanel when restart is needed.
    if (this._controls) {
      this.autoDispose(this._hasPendingRestart.addListener((needs) => {
        if (needs && this._controls) {
          this._controls.needsRestart.set(true);
        }
      }));
    }
  }

  /**
   * Probe the server for the active auth provider and available providers.
   */
  public async probe(): Promise<void> {
    this.status.set("checking");
    try {
      // Boot probe — always reports provider in details, even on fault.
      const result = await this._installAPI.runCheck("authentication");
      console.log("AuthConfigurator: boot probe:", JSON.stringify(result));
      if (!this.isDisposed() && result?.details?.provider) {
        this.activeProvider.set(String(result.details.provider));
      }

      // Provider list — authoritative source for config/error state.
      try {
        const providers = await this._configAPI.getAuthProviders();
        console.log("AuthConfigurator: providers:", JSON.stringify(providers));
        if (!this.isDisposed()) {
          this.providers.set(providers);
        }
      } catch (e) {
        console.warn("AuthConfigurator: failed to fetch provider list:", e);
      }

      // Fetch pending admin changes (panel mode needs these for restart banner).
      if (this._mode === "panel") {
        await this._fetchPendingChanges();
      }

      if (!this.isDisposed()) {
        this.status.set("ready");
      }
    } catch (e) {
      console.warn("AuthConfigurator: probe failed:", e);
      if (!this.isDisposed()) {
        this.status.set("ready");
      }
    }
  }

  /**
   * Build the full DOM for the auth configurator.
   */
  public buildDom(options: {
    onContinue?: () => void | Promise<void>;
  } = {}): DomContents {
    return cssConfigurator(
      dom.domComputed(this.status, (status) => {
        if (status === "idle" || status === "checking") {
          return cssCheckingBox(
            cssCheckingDot(),
            cssCheckingLabel(t("Checking authentication...")),
            testId("auth-checking"),
          );
        }
        return this._buildReadyContent(options.onContinue);
      }),
      testId("auth-configurator"),
    );
  }

  /**
   * Compact status display for the admin panel summary line.
   */
  public buildStatusDisplay(): DomContents {
    return dom.domComputed((use) => {
      if (use(this.status) === "checking") { return t("checking..."); }

      // Prefer provider list (has error info).
      const providers = use(this.providers);
      const activeInfo = providers.find(p => p.isActive);
      if (activeInfo && isRealProvider(activeInfo.key)) {
        const meta = PROVIDER_META[activeInfo.key];
        const label = meta ? meta.label : activeInfo.name;
        const suppressActiveError = this._recentlyConfigured.has(activeInfo.key);
        const hasError = suppressActiveError ? !!activeInfo.configError :
          !!(activeInfo.activeError || activeInfo.configError);
        if (hasError) {
          return cssErrorLabel(label + " — " + t("error"));
        }
        return suppressActiveError ? label + " — " + t("restart needed") : label;
      }
      if (providers.length > 0) {
        return cssNoAuthLabel(t("no authentication"));
      }

      // Fall back to boot probe data (provider list unavailable).
      const provider = use(this.activeProvider);
      if (!isRealProvider(provider)) {
        return cssNoAuthLabel(t("no authentication"));
      }
      const meta = PROVIDER_META[provider];
      return meta ? meta.label : provider;
    });
  }

  // --- Content (shared by both modes) ---

  private _buildReadyContent(onContinue?: () => void | Promise<void>): DomContents {
    return [
      // Hero card — derive from provider list when available.
      dom.domComputed((use) => {
        const providers = use(this.providers);
        const activeInfo = providers.find(p => p.isActive) ||
          providers.find(p => p.willBeActive && isRealProvider(p.key));
        const hasReal = activeInfo ? isRealProvider(activeInfo.key) :
          isRealProvider(use(this.activeProvider));
        if (hasReal) {
          const key = activeInfo?.key || use(this.activeProvider);
          const isPending = !activeInfo?.isActive && !!activeInfo?.willBeActive;
          const justReconfigured = this._recentlyConfigured.has(key);
          // Suppress stale activeError when provider is pending activation or
          // was just reconfigured this session (error predates the config change).
          const suppressActiveError = isPending || justReconfigured;
          const hasError = suppressActiveError ? !!activeInfo?.configError :
            !!(activeInfo?.activeError || activeInfo?.configError);
          return this._buildActiveHero(key, hasError, activeInfo, isPending || justReconfigured);
        }
        return this._buildNoAuthHero();
      }),
      // Restart banner (panel only).
      this._mode === "panel" ?
        dom.domComputed(this._hasPendingRestart, pending =>
          pending ? this._buildRestartBanner() : null,
        ) : null,
      // Provider cards.
      this._buildProviderCards(),
      // Continue button (wizard only).
      onContinue ? this._buildContinueButton(onContinue) : null,
    ];
  }

  // --- Hero cards ---

  private _buildActiveHero(
    provider: string, hasError: boolean, activeInfo?: AuthProvider, isPending?: boolean,
  ): DomContents {
    const meta = PROVIDER_META[provider] || {
      label: provider, desc: "", heroDesc: t("Your server has authentication configured."),
    };
    const errorMsg = activeInfo?.activeError || activeInfo?.configError || "";

    return cssHeroCard(
      cssHeroCard.cls(hasError ? "-error" : isPending ? "-pending" : "-ok"),
      cssHeroBody(
        cssHeroNameRow(
          cssHeroName(meta.label),
          hasError ?
            cssBadge(cssBadge.cls("-fail"), t("Error")) :
            isPending ?
              cssBadge(cssBadge.cls("-recommended"), t("Active on restart")) :
              cssBadge(cssBadge.cls("-ok"), t("Active")),
        ),
        hasError ?
          cssHeroDesc(
            t("Authentication is configured but reporting an error. " +
              "Users may not be able to sign in."),
          ) :
          isPending ?
            cssHeroDesc(
              t("Authentication has been configured and will become active when Grist is restarted."),
            ) :
            cssHeroDesc(meta.heroDesc),
        hasError && errorMsg ? cssProviderError(errorMsg) : null,
        this._mode === "panel" ? this._buildAdminRow() : null,
        cssProviderActions(
          meta.docsUrl ? cssSmallLink(
            cssLink({ href: meta.docsUrl, target: "_blank" }, t("Documentation")),
          ) : null,
          provider === GETGRIST_COM_PROVIDER_KEY ?
            basicButton(t("Reconfigure"),
              dom.on("click", () => this._configureGetGristCom()),
              cssSmallButton.cls(""),
              testId("auth-configure-getgrist"),
            ) : null,
        ),
      ),
      testId("auth-hero"),
    );
  }

  private _buildNoAuthHero(): DomContents {
    return cssHeroCard(
      cssHeroCard.cls("-warning"),
      cssHeroBody(
        cssHeroNameRow(
          cssHeroName(t("No authentication")),
          cssBadge(cssBadge.cls("-warn"), t("Not recommended")),
        ),
        cssHeroDesc(
          t("Anyone who can reach this server gets unrestricted access as a default user. " +
            "If Grist is accessible on your network or the internet, configure one of the " +
            "authentication methods below."),
        ),
        this._mode === "wizard" ? dom("div",
          dom.style("margin-top", "10px"),
          labeledSquareCheckbox(
            this.noAuthAcknowledged,
            t("I understand this server has no authentication"),
            testId("auth-acknowledge"),
          ),
        ) : null,
        this._mode === "panel" ? this._buildAdminRow() : null,
      ),
      testId("auth-hero"),
    );
  }

  private _buildAdminRow(): DomContents {
    const adminEmail = this._appModel.currentValidUser?.email;
    if (!adminEmail) { return null; }
    return cssAdminRow(
      cssAdminLabel(t("Admin:")),
      cssAdminEmail(adminEmail),
      basicButton(t("Change admin"),
        dom.on("click", () => this._showChangeAdminModal()),
        cssSmallButton.cls(""),
        testId("auth-change-admin"),
      ),
    );
  }

  // --- Provider cards ---

  private _buildProviderCards(): DomContents {
    return dom.domComputed(this.providers, (providers) => {
      // Exclude the provider shown in the hero card.
      const heroProvider = providers.find(p => p.isActive) ||
        providers.find(p => p.willBeActive && isRealProvider(p.key));
      const visible = visibleProviders(providers)
        .filter(p => !heroProvider || p.key !== heroProvider.key);
      if (visible.length === 0) {
        return this._buildStaticGuidance();
      }
      return cssAlternativesSection(
        cssAlternativesHeader(
          cssAlternativesIcon(icon("Expand")),
          heroProvider ? t("Other methods") : t("Available methods"),
        ),
        cssAlternativesList(
          ...visible.map(p => this._buildProviderCard(p)),
        ),
      );
    });
  }

  private _buildProviderCard(provider: AuthProvider): DomContents {
    const meta = PROVIDER_META[provider.key];
    const label = meta?.label || provider.name;
    const desc = meta?.desc || "";
    const docsUrl = meta?.docsUrl;
    const requiredVars = meta?.requiredVars;
    const isPanel = this._mode === "panel";

    // Suppress stale activeError for providers pending activation or just reconfigured.
    const suppressActiveError = provider.willBeActive || this._recentlyConfigured.has(provider.key);
    const relevantError = suppressActiveError ?
      provider.configError :
      (provider.configError || provider.activeError);

    return cssProviderCard(
      cssProviderCard.cls("-active", provider.isActive),
      cssProviderCard.cls("-configured", provider.isConfigured && !provider.isActive),
      cssProviderCard.cls("-error", !!relevantError),
      cssProviderBody(
        cssProviderNameRow(
          cssProviderName(label),
          provider.isActive ?
            cssBadge(cssBadge.cls("-ok"), t("Active")) : null,
          provider.isConfigured && !provider.isActive ?
            cssBadge(cssBadge.cls("-checking"), t("Configured")) : null,
          provider.willBeActive ?
            cssBadge(cssBadge.cls("-recommended"), t("Active on restart")) : null,
          isPanel && provider.willBeDisabled ?
            cssBadge(cssBadge.cls("-warn"), t("Disabled on restart")) : null,
          relevantError ?
            cssBadge(cssBadge.cls("-fail"), t("Error")) : null,
        ),
        cssProviderDesc(desc),
        relevantError ? cssProviderError(relevantError) : null,
        // Env vars guidance (panel only, unconfigured providers).
        isPanel && requiredVars && !provider.isConfigured && !provider.isActive ?
          cssEnvVarBox(
            cssEnvVarLabel(t("Set these environment variables and restart:")),
            cssEnvVarList(requiredVars.join(", ")),
          ) : null,
        // Env-controlled notice (panel only).
        isPanel && provider.isSelectedByEnv ?
          cssEnvVarNote(
            t("Active method is controlled by an environment variable."),
          ) : null,
        // Action row — panel shows actions, wizard just shows docs link.
        cssProviderActions(
          docsUrl ? cssSmallLink(
            cssLink({ href: docsUrl, target: "_blank" },
              isPanel ? t("Setup guide") : t("Documentation")),
          ) : null,
          // getgrist.com has a real Configure/Reconfigure action.
          provider.key === GETGRIST_COM_PROVIDER_KEY ?
            basicButton(
              provider.isActive || provider.isConfigured ? t("Reconfigure") : t("Configure"),
              dom.on("click", () => this._configureGetGristCom()),
              cssSmallButton.cls(""),
              testId("auth-configure-getgrist"),
            ) : null,
          // Set as active (panel only).
          isPanel && provider.canBeActivated ?
            basicButton(t("Set as active"),
              dom.on("click", () => this._setActiveProvider(provider)),
              cssSmallButton.cls(""),
              testId("auth-set-active"),
            ) : null,
        ),
      ),
      testId(`auth-provider-${provider.key}`),
    );
  }

  /**
   * Fallback when the provider list API isn't available.
   */
  private _buildStaticGuidance(): DomContents {
    return cssGuidanceBox(
      cssGuidanceTitle(t("How to configure authentication")),
      cssGuidanceDesc(
        t("Authentication is configured through environment variables before starting Grist. " +
          "The most common options are:"),
      ),
      cssGuidanceList(
        cssGuidanceItem(
          dom("strong", "OIDC"),
          " — ",
          t("OpenID Connect, works with most identity providers. "),
          cssLink({ href: "https://support.getgrist.com/install/oidc", target: "_blank" },
            t("See docs.")),
        ),
        cssGuidanceItem(
          dom("strong", "SAML"),
          " — ",
          t("SAML 2.0, for enterprise identity providers. "),
          cssLink({ href: "https://support.getgrist.com/install/saml/", target: "_blank" },
            t("See docs.")),
        ),
        cssGuidanceItem(
          dom("strong", t("Forwarded headers")),
          " — ",
          t("for reverse proxy setups (Traefik, Authelia). "),
          cssLink({
            href: "https://support.getgrist.com/install/forwarded-headers/",
            target: "_blank",
          }, t("See docs.")),
        ),
      ),
      dom("div",
        dom.style("margin-top", "8px"),
        cssLink({ href: commonUrls.helpSharing, target: "_blank" }, t("Learn more.")),
      ),
    );
  }

  // --- Wizard-only elements ---

  private _buildContinueButton(onContinue: () => void | Promise<void>): DomContents {
    return dom.domComputed(this.authReady, ready =>
      bigPrimaryButton(
        t("Continue"),
        dom.prop("disabled", !ready),
        dom.on("click", () => { void onContinue(); }),
        testId("auth-submit"),
      ),
    );
  }

  // --- Panel-only elements ---

  private _buildRestartBanner(): DomContents {
    return cssBanner(
      cssBanner.cls("-warning"),
      cssBannerIcon(icon("Warning")),
      cssBannerBody(
        cssBannerTitle(t("Restart required")),
        dom.domComputed(this._pendingChanges, (pending) => {
          if (pending?.onRestartSetAdminEmail) {
            return cssBannerDesc(
              t("After restart, the admin will change to {{email}}.",
                { email: pending.onRestartSetAdminEmail }),
            );
          }
          return cssBannerDesc(
            t("Authentication changes will take effect after restart."),
          );
        }),
        dom.domComputed(this._pendingChanges, (pending) => {
          if (pending?.onRestartSetAdminEmail) {
            return cssProviderActions(
              basicButton(t("Revert admin change"),
                dom.on("click", () => this._revertAdminChange()),
                cssSmallButton.cls(""),
                testId("auth-revert-admin"),
              ),
            );
          }
          return null;
        }),
      ),
    );
  }

  // --- Panel actions ---

  private async _fetchPendingChanges() {
    try {
      const prefs = await this._installAPI.getInstallPrefs();
      if (!this.isDisposed()) {
        const { onRestartSetAdminEmail, onRestartReplaceEmailWithAdmin } = prefs;
        this._pendingChanges.set({ onRestartSetAdminEmail, onRestartReplaceEmailWithAdmin });
      }
    } catch (_) { /* ok */ }
  }

  private async _setActiveProvider(provider: AuthProvider) {
    confirmModal(
      t("Set as active method?"),
      t("Confirm"),
      async () => {
        await this._configAPI.setActiveAuthProvider(provider.key);
        this._recentlyConfigured.add(provider.key);
        await this._refreshProviders();
      },
      {
        explanation: dom("div",
          dom("p", t("Are you sure you want to set {{name}} as the active authentication method?",
            { name: provider.name })),
          dom("p", t("The new method will take effect after you restart Grist.")),
        ),
      },
    );
  }

  private _configureGetGristCom() {
    const configModal = new GetGristComProviderInfoModal();
    configModal.show(() => {
      this._recentlyConfigured.add(GETGRIST_COM_PROVIDER_KEY);
      return this._refreshProviders().catch(reportError);
    });
    this.onDispose(() => configModal.isDisposed() ? void 0 : configModal.dispose());
  }

  private _showChangeAdminModal() {
    const currentUserEmail = this._appModel.currentValidUser?.email;
    if (!currentUserEmail) { return; }

    const providers = this.providers.get();
    const getgristProvider = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);
    const defaultEmail = getgristProvider?.metadata?.owner?.email;

    saveModal((_ctl, owner) => {
      const changeAdminModal = ChangeAdminModal.create(owner, {
        currentUserEmail,
        defaultEmail,
        onSave: async ({ email, replace }) => {
          const onRestartReplaceEmailWithAdmin = replace ? currentUserEmail : undefined;
          await this._installAPI.updateInstallPrefs({
            onRestartSetAdminEmail: email,
            onRestartReplaceEmailWithAdmin,
          });
          if (!this.isDisposed()) {
            await this._fetchPendingChanges();
          }
        },
      });
      return {
        title: t("Change admin user"),
        body: changeAdminModal.buildDom(),
        saveFunc: () => changeAdminModal.save(),
        saveDisabled: changeAdminModal.saveDisabled,
        width: "normal" as const,
        saveLabel: t("Prepare changes"),
      };
    });
  }

  private async _revertAdminChange() {
    await this._installAPI.updateInstallPrefs({
      onRestartSetAdminEmail: null,
      onRestartReplaceEmailWithAdmin: null,
    });
    if (!this.isDisposed()) {
      await this._fetchPendingChanges();
    }
  }

  private async _refreshProviders() {
    try {
      const providers = await this._configAPI.getAuthProviders();
      if (!this.isDisposed()) {
        this.providers.set(providers);
      }
    } catch (e) {
      console.warn("AuthConfigurator: failed to refresh providers:", e);
    }
    if (this._mode === "panel") {
      await this._fetchPendingChanges();
    }
  }
}

// --- Styles ---

const cssConfigurator = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssCheckingBox = styled("div", `
  padding: 18px 22px;
  border: 1.5px solid ${theme.inputBorder};
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
`);

const cssCheckingDot = styled("div", `
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${theme.controlFg};
  opacity: 0.5;
  flex-shrink: 0;
  animation: authPulse 1.2s ease-in-out infinite;

  @keyframes authPulse {
    0%, 100% { opacity: 0.3; transform: scale(0.9); }
    50% { opacity: 0.8; transform: scale(1.1); }
  }
`);

const cssCheckingLabel = styled("span", `
  font-size: 13px;
  color: ${theme.lightText};
`);

const cssNoAuthLabel = styled("span", `
  color: #b45309;
  font-weight: 500;
`);

const cssErrorLabel = styled("span", `
  color: #c5221f;
  font-weight: 500;
`);

const cssHeroCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 22px;
  border: 1.5px solid ${theme.inputBorder};
  border-left: 4px solid #1a73e8;
  border-radius: 8px;

  &-ok {
    border-left-color: #1e7e34;
  }
  &-pending {
    border-left-color: #1a73e8;
  }
  &-warning {
    border-left-color: #b45309;
  }
  &-error {
    border-left-color: #c5221f;
  }
`);

const cssHeroBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`);

const cssHeroNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`);

const cssHeroName = styled("span", `
  font-weight: 700;
  font-size: 15px;
`);

const cssHeroDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.45;
`);

const cssAdminRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
`);

const cssAdminLabel = styled("span", `
  font-size: 13px;
  color: ${theme.lightText};
`);

const cssAdminEmail = styled("span", `
  font-size: 13px;
  font-weight: 600;
`);

const cssAlternativesSection = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssAlternativesHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: ${theme.lightText};
  text-transform: uppercase;
  letter-spacing: 0.4px;
  --icon-color: ${theme.lightText};
`);

const cssAlternativesIcon = styled("div", `
  display: flex;
  --icon-color: ${theme.lightText};
`);

const cssAlternativesList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
`);

const cssProviderCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 6px;

  &-active {
    border-left: 3px solid #1e7e34;
  }
  &-configured {
    border-left: 3px solid #1a73e8;
  }
  &-error {
    border-left: 3px solid #c5221f;
  }
`);

const cssProviderBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
`);

const cssProviderNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssProviderName = styled("span", `
  font-weight: 600;
  font-size: ${vars.mediumFontSize};
`);

const cssProviderDesc = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  line-height: 1.4;
`);

const cssProviderError = styled("div", `
  font-size: ${vars.smallFontSize};
  color: #c5221f;
  margin-top: 4px;
`);

const cssProviderActions = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
`);

const cssEnvVarBox = styled("div", `
  margin-top: 6px;
  padding: 8px 12px;
  background-color: ${theme.pageBg};
  border-radius: 4px;
`);

const cssEnvVarLabel = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  margin-bottom: 4px;
`);

const cssEnvVarList = styled("div", `
  font-size: 12px;
  font-family: monospace;
  color: ${theme.text};
  word-break: break-all;
  line-height: 1.5;
`);

const cssEnvVarNote = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  font-style: italic;
  margin-top: 4px;
`);

const cssSmallLink = styled("div", `
  font-size: ${vars.smallFontSize};
`);

const cssSmallButton = styled("div", `
  font-size: ${vars.smallFontSize};
  padding: 2px 10px;
`);

const cssGuidanceBox = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 8px;
`);

const cssGuidanceTitle = styled("div", `
  font-weight: 600;
  font-size: 13px;
`);

const cssGuidanceDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.45;
`);

const cssGuidanceList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 4px;
`);

const cssGuidanceItem = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.45;
`);

const cssBadge = styled("span", `
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;

  &-ok {
    background-color: #e6f4ea;
    color: #1e7e34;
  }
  &-fail {
    background-color: #fce8e6;
    color: #c5221f;
  }
  &-warn {
    background-color: #fef7e0;
    color: #b45309;
  }
  &-checking {
    background-color: #e8eaed;
    color: #5f6368;
  }
  &-recommended {
    background-color: #e8f0fe;
    color: #1a73e8;
  }
`);

const cssBanner = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 8px;
  border: 1px solid ${theme.inputBorder};

  &-warning {
    border-color: #b45309;
    background-color: #fef7e0;
  }
`);

const cssBannerIcon = styled("div", `
  flex-shrink: 0;
  margin-top: 1px;
  --icon-color: #b45309;
`);

const cssBannerBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`);

const cssBannerTitle = styled("div", `
  font-weight: 600;
  font-size: 13px;
`);

const cssBannerDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.4;
`);
