import { makeT } from "app/client/lib/localization";
import { AppModel, getHomeUrl } from "app/client/models/AppModel";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { AuthProvider, ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { InstallAPI } from "app/common/InstallAPI";
import { DEPRECATED_PROVIDERS, MINIMAL_PROVIDER_KEY } from "app/common/loginProviders";

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
}> = {
  "oidc": {
    label: "OIDC",
    desc: t("OpenID Connect — works with most identity providers."),
    heroDesc: t("Your server is configured to authenticate users via OpenID Connect. " +
      "Users sign in through your identity provider and are redirected back to Grist."),
    docsUrl: "https://support.getgrist.com/install/oidc",
  },
  "saml": {
    label: "SAML",
    desc: t("SAML 2.0 — for enterprise identity providers."),
    heroDesc: t("Your server is configured to authenticate users via SAML 2.0. " +
      "Users sign in through your identity provider and are redirected back to Grist."),
    docsUrl: "https://support.getgrist.com/install/saml/",
  },
  "forward-auth": {
    label: t("Forwarded headers"),
    desc: t("Authentication handled by a reverse proxy (Traefik, Authelia, etc)."),
    heroDesc: t("Your server trusts authentication from a reverse proxy. " +
      "The proxy handles login and passes verified user information to Grist via HTTP headers."),
    docsUrl: "https://support.getgrist.com/install/forwarded-headers/",
  },
  "grist-connect": {
    label: "Grist Connect",
    desc: t("Managed login service from Grist Labs."),
    heroDesc: t("Your server uses Grist Connect, a managed login service from Grist Labs. " +
      "Users authenticate through Grist Connect and are signed into your server."),
    docsUrl: "https://support.getgrist.com/install/grist-connect/",
  },
  "getgrist.com": {
    label: "getgrist.com",
    desc: t("Sign in with getgrist.com account."),
    heroDesc: t("Your server uses getgrist.com authentication. " +
      "Users sign in with their getgrist.com account."),
  },
};

/**
 * Shared component for displaying authentication status and guiding
 * the admin through auth configuration.
 *
 * In the wizard, shows the current auth state as a hero card (matching
 * the sandbox step's visual language), with alternative providers listed
 * below. When no auth is configured, requires explicit acknowledgment
 * before continuing — like the sandbox step's "No Sandbox" warning.
 *
 * Used by the setup wizard. The admin panel continues to use
 * AuthenticationSection directly (which has Configure buttons and
 * provider management).
 */
export class AuthConfigurator extends Disposable {
  // Current auth probe status.
  public readonly status = Observable.create<"idle" | "checking" | "ready">(this, "idle");

  // The active provider key from the auth probe (e.g. "oidc", "minimal").
  public readonly activeProvider = Observable.create<string>(this, "");

  // Whether the user has acknowledged running without auth.
  public readonly noAuthAcknowledged = Observable.create<boolean>(this, false);

  // Auth providers from the config API (for the alternatives list).
  public readonly providers = Observable.create<AuthProvider[]>(this, []);

  // Whether real auth is configured (not minimal/boot-key/no-auth).
  public readonly hasRealAuth: Computed<boolean> = Computed.create(this, (use) => {
    const p = use(this.activeProvider);
    return !!p && p !== "minimal" && p !== "boot-key" && p !== "no-logins" && p !== "no-auth";
  });

  // Ready to continue: either has real auth, or explicitly acknowledged.
  public readonly authReady: Computed<boolean> = Computed.create(this, use =>
    use(this.hasRealAuth) || use(this.noAuthAcknowledged));

  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(
    private _installAPI: InstallAPI,
    _appModel: AppModel,
  ) {
    super();
  }

  /**
   * Probe the server for the active auth provider and available providers.
   */
  public async probe(): Promise<void> {
    this.status.set("checking");
    try {
      // Run the authentication boot probe directly.
      const result = await this._installAPI.runCheck("authentication");
      if (!this.isDisposed()) {
        if (result?.status === "success" || result?.status === "warning") {
          this.activeProvider.set(String(result.details?.provider || ""));
        }
      }

      // Fetch provider list for alternatives.
      try {
        const providers = await this._configAPI.getAuthProviders();
        if (!this.isDisposed()) {
          this.providers.set(providers);
        }
      } catch (_) { /* ok — provider list not available */ }

      if (!this.isDisposed()) {
        this.status.set("ready");
      }
    } catch (_) {
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
    const { onContinue } = options;

    return cssConfigurator(
      dom.domComputed(this.status, (status) => {
        if (status === "idle" || status === "checking") {
          return cssCheckingBox(
            cssCheckingDot(),
            cssCheckingLabel(t("Checking authentication...")),
            testId("auth-checking"),
          );
        }
        return this._buildReadyContent(onContinue);
      }),
      testId("auth-configurator"),
    );
  }

  /**
   * Build a compact status display for the admin panel summary line.
   */
  public buildStatusDisplay(): DomContents {
    return dom.domComputed(this.status, (status) => {
      if (status === "checking") { return t("checking..."); }
      const provider = this.activeProvider.get();
      if (!provider || provider === "minimal" || provider === "boot-key") {
        return cssNoAuthLabel(t("no authentication"));
      }
      const meta = PROVIDER_META[provider];
      return meta ? meta.label : provider;
    });
  }

  private _buildReadyContent(onContinue?: () => void | Promise<void>): DomContents {
    return [
      dom.domComputed(this.activeProvider, (provider) => {
        const hasReal = this.hasRealAuth.get();
        if (hasReal) {
          return this._buildActiveHero(provider);
        }
        return this._buildNoAuthHero();
      }),
      this._buildAlternativesSection(),
      onContinue ? this._buildActionButton(onContinue) : null,
    ];
  }

  /**
   * Hero card when real auth is active — green accent, shows provider name.
   */
  private _buildActiveHero(provider: string): DomContents {
    const meta = PROVIDER_META[provider] || {
      label: provider,
      desc: "",
      heroDesc: t("Your server has authentication configured."),
    };
    return cssHeroCard(
      cssHeroCard.cls("-ok"),
      cssHeroBody(
        cssHeroNameRow(
          cssHeroName(meta.label),
          cssBadge(cssBadge.cls("-ok"), t("Active")),
        ),
        cssHeroDesc(meta.heroDesc),
        meta.docsUrl ? dom("div",
          dom.style("margin-top", "4px"),
          cssLink({ href: meta.docsUrl, target: "_blank" }, t("Documentation")),
        ) : null,
      ),
      testId("auth-hero"),
    );
  }

  /**
   * Hero card when no auth — amber warning accent, like sandbox's "No Sandbox".
   */
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
        dom("div",
          dom.style("margin-top", "10px"),
          labeledSquareCheckbox(
            this.noAuthAcknowledged,
            t("I understand this server has no authentication"),
            testId("auth-acknowledge"),
          ),
        ),
      ),
      testId("auth-hero"),
    );
  }

  /**
   * Alternatives section listing available auth providers with docs links.
   */
  private _buildAlternativesSection(): DomContents {
    return dom.domComputed(this.providers, (providers) => {
      // Filter to relevant providers — hide deprecated unless active, hide minimal.
      const visible = providers.filter(p =>
        p.key !== MINIMAL_PROVIDER_KEY &&
        p.key !== "boot-key" &&
        (!DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive),
      );
      if (visible.length === 0) {
        // No provider list available — show static guidance.
        return this._buildStaticGuidance();
      }
      return cssAlternativesSection(
        cssAlternativesHeader(
          cssAlternativesIcon(icon("Expand")),
          t("Available methods"),
        ),
        cssAlternativesList(
          ...visible.map(p => this._buildProviderCard(p)),
        ),
      );
    });
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

  /**
   * A compact card for a single auth provider.
   */
  private _buildProviderCard(provider: AuthProvider): DomContents {
    const meta = PROVIDER_META[provider.key];
    const label = meta?.label || provider.name;
    const desc = meta?.desc || "";
    const docsUrl = meta?.docsUrl;

    return cssProviderCard(
      cssProviderCard.cls("-active", provider.isActive),
      cssProviderCard.cls("-configured", provider.isConfigured && !provider.isActive),
      cssProviderCard.cls("-error", !!(provider.configError || provider.activeError)),
      cssProviderBody(
        cssProviderNameRow(
          cssProviderName(label),
          provider.isActive ?
            cssBadge(cssBadge.cls("-ok"), t("Active")) : null,
          provider.isConfigured && !provider.isActive ?
            cssBadge(cssBadge.cls("-checking"), t("Configured")) : null,
          provider.willBeActive ?
            cssBadge(cssBadge.cls("-recommended"), t("Active on restart")) : null,
          (provider.configError || provider.activeError) ?
            cssBadge(cssBadge.cls("-fail"), t("Error")) : null,
        ),
        cssProviderDesc(desc),
        (provider.configError || provider.activeError) ?
          cssProviderError(provider.configError || provider.activeError || "") : null,
        docsUrl ? dom("div",
          dom.style("margin-top", "4px"),
          cssLink({ href: docsUrl, target: "_blank" }, t("Documentation")),
        ) : null,
      ),
      testId(`auth-provider-${provider.key}`),
    );
  }

  /**
   * Continue button — disabled until auth is ready.
   */
  private _buildActionButton(onContinue: () => void | Promise<void>): DomContents {
    return dom.domComputed(this.authReady, ready =>
      bigPrimaryButton(
        t("Continue"),
        dom.prop("disabled", !ready),
        dom.on("click", () => { void onContinue(); }),
        testId("auth-submit"),
      ),
    );
  }
}

// --- Styles ---
// Visual language matches SandboxConfigurator: hero card + alternatives,
// filled badges, left accent stripe, same spacing and typography.

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

// Hero card — matches SandboxConfigurator's cssHeroCard pattern.
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
  &-warning {
    border-left-color: #b45309;
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

// Alternatives section — matches SandboxConfigurator's alternatives pattern.
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

// Provider card — matches SandboxConfigurator's cssAltCard pattern.
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

// Static guidance fallback (when provider API isn't available).
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

// Badge — same as SandboxConfigurator's cssBadge.
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
