import { makeT } from "app/client/lib/localization";
import { localStorageBoolObs } from "app/client/lib/localStorageObs";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel, getHomeUrl, reportError } from "app/client/models/AppModel";
import {
  AdminPanelControls,
  cssIconWrapper,
  cssWell,
  cssWellContent,
  cssWellTitle,
} from "app/client/ui/AdminPanelCss";
import { ChangeAdminModal } from "app/client/ui/ChangeAdminModal";
import { GetGristComProviderInfoModal } from "app/client/ui/GetGristComProvider";
import {
  buildBadge,
  buildCardList,
  buildHeroCard,
  buildItemCard,
  HeroVariant,
  ItemBorderVariant,
} from "app/client/ui/SetupCard";
import { basicButton, bigBasicButton, bigPrimaryButton, textButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { icon } from "app/client/ui2018/icons";
import { confirmModal, cssModalWidth, modal, saveModal } from "app/client/ui2018/modals";
import { theme, vars } from "app/client/ui2018/cssVars";
import { AuthProvider, ConfigAPI } from "app/common/ConfigAPI";
import { PendingChanges } from "app/common/Install";
import { InstallAPI, InstallAPIImpl } from "app/common/InstallAPI";
import {
  BOOT_KEY_PROVIDER_KEY,
  DEPRECATED_PROVIDERS,
  FALLBACK_PROVIDER_KEY,
  FORWARD_AUTH_PROVIDER_KEY,
  GETGRIST_COM_PROVIDER_KEY,
  GRIST_CONNECT_PROVIDER_KEY,
  isRealProvider,
  OIDC_PROVIDER_KEY,
  SAML_PROVIDER_KEY,
} from "app/common/loginProviders";

import { Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AdminPanel");

const testId = makeTestId("test-admin-auth-");

const noAuthAcknowledged = localStorageBoolObs("noAuthAcknowledged");

interface AuthenticationSectionOptions {
  appModel: AppModel;
  loginSystemId?: Observable<string | undefined>;
  controls?: AdminPanelControls;
  installAPI?: InstallAPI;
  /** When false, suppress the restart warning banner and needsRestart signal.
   *  Used by the setup wizard where a single restart happens at the end. */
  showRestartWarning?: boolean;
}

export class AuthenticationSection extends Disposable {
  /**
   * True when authentication is in a state the user can proceed with:
   * a real provider is active, configured, or pending — or the user acknowledged no-auth.
   */
  public canProceed: Computed<boolean>;

  private _appModel = this._options.appModel;
  private _installAPI = this._options.installAPI ?? new InstallAPIImpl(getHomeUrl());
  private _controls = this._options.controls ?? {
    needsRestart: Observable.create(this, false),
    restartGrist: async () => { await new ConfigAPI(getHomeUrl()).restartServer(); },
  };

  private _loginSystemId = this._options.loginSystemId ?? this._makeLoginSystemId();

  private _prefsPendingChanges = Observable.create<PendingChanges | null>(this, null);

  private _providers = Observable.create<AuthProvider[]>(this, []);
  private _configAPI = new ConfigAPI(getHomeUrl());
  private _currentUserEmail = this._appModel.currentValidUser!.email;

  /**
   * Provider keys that were configured or activated during this browser session.
   * Used to suppress stale `activeError` values that came from the previous
   * server startup and may no longer apply.
   */
  private _recentlyConfigured = new Set<string>();

  private _hasActiveOnRestartProvider = Computed.create(this, this._providers, (_use, providers) => {
    return providers.some(p => p.willBeActive);
  });

  private _getgristLoginOwner = Computed.create(this, this._providers, (_use, providers) => {
    const getgristLogin = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);
    return getgristLogin?.metadata?.owner ?? null;
  });

  constructor(private _options: AuthenticationSectionOptions) {
    super();

    this.canProceed = Computed.create(this, (use) => {
      if (use(noAuthAcknowledged)) { return true; }
      if (use(this._hasActiveOnRestartProvider)) { return true; }
      const providers = use(this._providers);
      if (providers.some(p => (p.isActive || p.isConfigured) && isRealProvider(p.key))) { return true; }
      const loginSystemId = use(this._loginSystemId);
      return !!loginSystemId && isRealProvider(loginSystemId);
    });

    this._fetchProviders().catch(reportError);
    this._fetchPrefsPendingChanges().catch(reportError);
  }

  public buildDom() {
    return [
      dom.domComputed((use) => {
        const providers = use(this._providers);
        const loginSystemId = use(this._loginSystemId);
        return this._buildSection(providers, loginSystemId);
      }),
      this._options.showRestartWarning !== false ?
        dom.maybe(this._hasActiveOnRestartProvider, () => this._buildAuthenticationChangeWarning()) : null,
    ];
  }

  private _makeLoginSystemId(): Observable<string | undefined> {
    const checks = new AdminChecks(this, this._installAPI);
    checks.fetchAvailableChecks().catch(reportError);
    return checks.getLoginProvider();
  }

  private async _fetchProviders() {
    const providers = await this._configAPI.getAuthProviders();
    if (this.isDisposed()) {
      return;
    }
    this._providers.set(providers);
    this._checkIfRestartNeeded();
  }

  private async _fetchPrefsPendingChanges() {
    // TODO: This class, `TelemetryModel`, and`AdminInstallationPanel._buildUpdates`
    // each call this endpoint when a single call should suffice.
    const prefs = await this._installAPI.getInstallPrefs();
    if (this.isDisposed()) { return; }

    const { onRestartSetAdminEmail, onRestartReplaceEmailWithAdmin } = prefs;
    this._prefsPendingChanges.set({ onRestartSetAdminEmail, onRestartReplaceEmailWithAdmin });
  }

  private _buildSection(providers: AuthProvider[], loginSystemId?: string): HTMLElement {
    const getgrist = providers.find(p =>
      p.key === GETGRIST_COM_PROVIDER_KEY && (p.isActive || p.willBeActive),
    );

    const hero =
      providers.find(p => p.isActive && isRealProvider(p.key)) ??
      providers.find(p => p.willBeActive && isRealProvider(p.key)) ??
      null;

    const noRealPending = providers.some(p => p.willBeDisabled) &&
      !providers.some(p => p.willBeActive);
    const bootProbeNoAuth = !!loginSystemId && !isRealProvider(loginSystemId);
    const showNoAuth = !hero && (bootProbeNoAuth || noRealPending);
    const effectiveLoginSystem = noRealPending ? FALLBACK_PROVIDER_KEY : loginSystemId;

    const heroEl = (hero || showNoAuth)
      ? this._buildHeroCard(hero, effectiveLoginSystem, getgrist)
      : dom("div");

    const listEl = this._buildProviderList(providers, {
      collapsible: !!hero,
      collapseOnNoAuth: showNoAuth,
    });

    return dom("div", heroEl, listEl);
  }

  private _buildHeroCard(
    hero: AuthProvider | null,
    loginSystemId?: string,
    getgrist?: AuthProvider,
  ): HTMLElement {
    if (!hero) {
      return this._buildNoAuthHeroCard(loginSystemId);
    }

    const opts = buildActiveHeroOpts(hero, this._recentlyConfigured);

    return buildHeroCard({
      ...opts,
      error: opts.error ? dom("span", opts.error, testId("hero-error")) : undefined,
      actions: (getgrist) ? dom.frag(
        basicButton(
          t("Reconfigure"),
          dom.on("click", () => this._configureProvider(getgrist)),
          testId("hero-reconfigure"),
        ),
        basicButton(
          t("Deactivate"),
          dom.on("click", () => this._deactivateProvider(getgrist)),
          testId("hero-deactivate"),
        ),
      ) : undefined,
      footer: this._buildAdminRow(),
      args: [
        testId("hero-card"),
        testId(`hero-${opts.variant}`),
      ],
    });
  }

  private _buildNoAuthHeroCard(loginSystemId?: string): HTMLElement {
    const isBootKey = loginSystemId === BOOT_KEY_PROVIDER_KEY;

    const variant = Computed.create(null, noAuthAcknowledged,
      (_use, ack) => (ack ? "warning" : "error") as HeroVariant);

    return buildHeroCard({
      variant,
      title: isBootKey
        ? t("No authentication: using boot key")
        : t("No authentication"),
      badges: buildBadge(t("Not recommended"), "warning", testId("badge"), testId("badge-warning")),
      description: isBootKey
        ? t("Your server is using a boot key as a fallback login method. \
Configure one of the authentication methods below.")
        : t("Anyone who can reach this server can access all data without signing in. \
Configure one of the authentication methods below."),
      footer: dom.frag(
        cssNoAuthCheckbox(
          labeledSquareCheckbox(noAuthAcknowledged,
            t("I understand this server has no authentication"),
            testId("no-auth-acknowledge"),
          ),
        ),
        this._buildAdminRow(),
      ),
      args: [
        dom.autoDispose(variant),
        testId("hero-card"),
        testId("hero-warning"),
      ],
    });
  }

  private _buildAdminRow(): DomContents {
    return cssAdminRow(
      dom("span", t("Installation admin: "), dom("strong", this._currentUserEmail)),
      textButton(t("Change installation admin"),
        dom.on("click", () => this._showChangeAdminModal()),
        testId("change-admin"),
      ),
    );
  }

  private _buildProviderList(
    providers: AuthProvider[],
    opts: { collapsible: boolean; collapseOnNoAuth: boolean },
  ): HTMLElement {
    const visible = providers.filter(p =>
      !DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive,
    );

    const items = visible.map(p => this._buildProviderCard(p));
    const isCollapsible = opts.collapsible || opts.collapseOnNoAuth;

    return buildCardList({
      header: isCollapsible ? t("Other authentication methods") : t("Available methods"),
      items,
      collapsible: isCollapsible,
      initiallyCollapsed: opts.collapsible || (opts.collapseOnNoAuth && noAuthAcknowledged.get()),
      collapseObs: opts.collapseOnNoAuth ? noAuthAcknowledged : undefined,
      args: [testId("provider-list-header")],
    });
  }

  private _buildProviderCard(provider: AuthProvider): HTMLElement {
    return buildProviderItemCard(provider, this._recentlyConfigured, {
      onSetActive: p => this._setActiveProvider(p),
      onConfigure: p => this._configureProvider(p),
      args: [
        testId(`provider-row-${provider.key.replace(".", "-")}`),
        testId("provider-row"),
      ],
    });
  }

  private _buildAuthenticationChangeWarning() {
    return cssWell(
      dom.style("margin-bottom", "24px"),
      cssWell.cls("-warning"),
      cssIconWrapper(icon("Warning")),
      dom("div",
        cssWellTitle(t("Restart required. Authentication change may affect your access")),
        cssWellContent(
          dom.domComputed((use) => {
            const prefs = use(this._prefsPendingChanges);
            if (prefs?.onRestartSetAdminEmail) {
              return dom("p",
                t("You are signed in as {{email}}. \
After restart, the new administrative user will be {{newEmail}}.",
                {
                  email: dom("strong", this._currentUserEmail),
                  newEmail: dom("strong", prefs.onRestartSetAdminEmail),
                }),
              );
            } else {
              return dom("p",
                t("You are signed in as {{email}}. \
You may lose access to this server if you cannot sign in as this user after switching the \
authentication system.",
                { email: dom("strong", this._currentUserEmail) }),
              );
            }
          }),
          dom("p", t('See "Restart Grist" section on top of this page to restart.')),
        ),
        dom.domComputed((use) => {
          const prefs = use(this._prefsPendingChanges);
          if (prefs?.onRestartSetAdminEmail) {
            return bigBasicButton(
              t("Revert change of admin user"),
              dom.style("margin-top", "16px"),
              dom.on("click", () => this._revertSetInstallAdmin()),
            );
          } else {
            return bigPrimaryButton(
              t("Change admin user"),
              dom.style("margin-top", "16px"),
              dom.on("click", () => this._showChangeAdminModal()),
            );
          }
        }),
      ),
    );
  }

  private async _setActiveProvider(provider: AuthProvider) {
    confirmModal(
      t("Set as active method?"),
      t("Confirm"),
      async () => {
        await this._configAPI.setActiveAuthProvider(provider.key);
        this._recentlyConfigured.add(provider.key);
        await this._fetchProviders();
      },
      {
        explanation: dom("div",
          cssMarkdownSpan(
            t("Are you sure you want to set **{{name}}** as the active authentication method?",
              { name: provider.name }),
          ),
          dom("p",
            t("The new method will go into effect after you restart Grist."),
          ),
        ),
      },
    );
  }

  private _configureProvider(provider: AuthProvider) {
    const configModal = BaseInformationModal.for(provider);
    if (configModal) {
      configModal.show(() => {
        this._recentlyConfigured.add(provider.key);
        this._fetchProviders().catch(reportError);
      });
      this.onDispose(() => configModal.isDisposed() ? void 0 : configModal.dispose());
    }
  }

  private _deactivateProvider(provider: AuthProvider) {
    confirmModal(
      t("Deactivate authentication?"),
      t("Deactivate"),
      async () => {
        await this._configAPI.setActiveAuthProvider(FALLBACK_PROVIDER_KEY);
        this._recentlyConfigured.add(provider.key);
        await this._fetchProviders();
      },
      {
        explanation: dom("div",
          cssMarkdownSpan(
            t("Are you sure you want to deactivate **{{name}}**?", { name: provider.name }),
          ),
          dom("p",
            t("Your configuration will be preserved. You can reactivate it later without reconfiguring."),
          ),
          dom("p",
            t("The change will take effect after you restart Grist."),
          ),
        ),
      },
    );
  }

  private _showChangeAdminModal() {
    const currentUserEmail = this._appModel.currentValidUser?.email;
    if (!currentUserEmail) {
      throw new Error("Current user is not defined");
    }

    saveModal((_ctl, owner) => {
      const changeAdminModal = ChangeAdminModal.create(owner, {
        currentUserEmail,
        defaultEmail: this._getgristLoginOwner.get().email,
        onSave: async ({ email, replace }) => {
          await this._setInstallAdmin(email, replace);
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

  private async _setInstallAdmin(email: string, replace: boolean) {
    const onRestartReplaceEmailWithAdmin = replace ? this._currentUserEmail : undefined;
    await this._installAPI.updateInstallPrefs({
      onRestartSetAdminEmail: email,
      onRestartReplaceEmailWithAdmin,
    });
    if (this.isDisposed()) { return; }

    await this._fetchPrefsPendingChanges();
    this._checkIfRestartNeeded();
  };

  private async _revertSetInstallAdmin() {
    await this._installAPI.updateInstallPrefs({
      onRestartSetAdminEmail: null,
      onRestartReplaceEmailWithAdmin: null,
    });
    if (this.isDisposed()) { return; }

    await this._fetchPrefsPendingChanges();
  };

  private _checkIfRestartNeeded() {
    if (this._options.showRestartWarning === false) { return; }

    const hasActiveOnRestartProvider = this._hasActiveOnRestartProvider.get();

    const prefsPendingChanges = this._prefsPendingChanges.get();
    const hasUnappliedRestartPrefs = Boolean(
      prefsPendingChanges?.onRestartSetAdminEmail ||
      prefsPendingChanges?.onRestartReplaceEmailWithAdmin,
    );
    const needsRestart = hasActiveOnRestartProvider || hasUnappliedRestartPrefs;
    if (needsRestart) {
      this._controls.needsRestart.set(true);
    }
  }
}

/**
 * Returns the effective error text for a provider, suppressing stale
 * `activeError` values that came from a previous server startup.
 */
function getVisibleError(
  provider: AuthProvider,
  recentlyConfigured: ReadonlySet<string>,
): string | undefined {
  if (provider.configError) { return provider.configError; }
  if (!provider.activeError) { return undefined; }
  if (recentlyConfigured.has(provider.key)) { return undefined; }
  if (provider.willBeActive && !provider.isActive) { return undefined; }
  return provider.activeError;
}

function buildHeroBadge(provider: AuthProvider, error: string | undefined): DomContents {
  if (error) { return buildBadge(t("Error"), "error", testId("badge"), testId("badge-error")); }
  if (provider.isActive) { return buildBadge(t("Active"), "primary", testId("badge"), testId("badge-active")); }
  if (provider.willBeActive) {
    return buildBadge(t("Active on restart"), "warning", testId("badge"), testId("badge-active-on-restart"));
  }
  return null;
}

/**
 * Builds the hero card options (variant, title, badges, description, error)
 * for an active/pending provider. Shared by live panel and Storybook preview.
 */
function buildActiveHeroOpts(
  hero: AuthProvider,
  recentlyConfigured: ReadonlySet<string>,
): Pick<import("app/client/ui/SetupCard").HeroCardOptions, "variant" | "title" | "badges" | "description" | "error"> {
  const error = getVisibleError(hero, recentlyConfigured);
  const meta = BaseInformationModal.metaFor(hero);
  const variant: HeroVariant = error ? "error" : hero.isActive ? "success" : "pending";

  let descText: string | undefined;
  if (error) {
    descText = t("Authentication is misconfigured or unreachable. Users may not be able to sign in.");
  } else if (hero.isActive) {
    descText = meta.heroDesc;
  } else if (hero.willBeActive) {
    descText = t("Authentication has been configured and will become active when Grist is restarted.");
  }

  return {
    variant,
    title: hero.name,
    badges: buildHeroBadge(hero, error),
    description: descText,
    error: error ? dom("span", error) : undefined,
  };
}

/**
 * Builds an item card for a provider with badges, buttons, hints, and errors.
 * Shared by live panel and Storybook preview. Callers can pass extra `args`
 * for test IDs or event handlers.
 */
function buildProviderItemCard(
  provider: AuthProvider,
  recentlyConfigured: ReadonlySet<string>,
  opts: {
    onSetActive?: (p: AuthProvider) => void;
    onConfigure?: (p: AuthProvider) => void;
    args?: DomElementArg[];
  } = {},
): HTMLElement {
  const error = getVisibleError(provider, recentlyConfigured);
  let meta: ProviderMeta;
  try { meta = BaseInformationModal.metaFor(provider); } catch { meta = { description: "", heroDesc: "", docsUrl: "" }; }

  let borderVariant: ItemBorderVariant | undefined;
  if (provider.isActive) {
    borderVariant = "active";
  } else if (provider.isConfigured && !error) {
    borderVariant = "configured";
  } else if (error) {
    borderVariant = "error";
  }

  return buildItemCard({
    borderVariant,
    title: provider.name,
    badges: dom.frag(
      provider.isActive ? buildBadge(t("Active"), "primary", testId("badge"), testId("badge-active")) : null,
      provider.willBeActive
        ? buildBadge(t("Active on restart"), "warning", testId("badge"), testId("badge-active-on-restart"))
        : null,
      provider.willBeDisabled
        ? buildBadge(t("Disabled on restart"), "warning", testId("badge"), testId("badge-disabled-on-restart"))
        : null,
      error ? buildBadge(t("Error"), "error", testId("badge"), testId("badge-error")) : null,
    ),
    buttons: dom.frag(
      provider.canBeActivated
        ? basicButton(
            t("Set as active method"),
            testId("set-active-button"),
            opts.onSetActive ? dom.on("click", () => opts.onSetActive!(provider)) : null,
          )
        : null,
      basicButton(
        t("Configure"),
        testId("configure-button"),
        testId(`configure-${provider.name.toLowerCase().replace(/\s+/g, "-")}`),
        dom.prop("disabled", Boolean(provider.isActive)),
        !provider.isActive && opts.onConfigure ? dom.on("click", () => opts.onConfigure!(provider)) : null,
      ),
    ),
    hint: meta.description || undefined,
    error: error ? {
      header: dom("span", t("Error details"), testId("error-header")),
      message: dom("span", error, testId("error-message")),
    } : undefined,
    info: provider.isSelectedByEnv
      ? t("Active method is controlled by an environment variable. Unset variable to change active method.")
      : undefined,
    args: opts.args,
  });
}

// ---------------------------------------------------------------------------
// Provider metadata (description, heroDesc, docsUrl)
// ---------------------------------------------------------------------------

interface ProviderMeta {
  description: string;
  heroDesc: string;
  docsUrl: string;
}

/**
 * Base class for authentication provider info/configuration modals.
 *
 * Each subclass holds per-provider metadata (description, heroDesc, docsUrl)
 * used by both the modal and the hero/card rendering. The `for()` factory
 * creates the right subclass for a given provider key.
 */
abstract class BaseInformationModal extends Disposable {
  /**
   * Factory method to create the appropriate modal for a provider.
   */
  public static for(provider: AuthProvider) {
    switch (provider.key) {
      case OIDC_PROVIDER_KEY:
        return new OIDCInformationModal(provider);
      case SAML_PROVIDER_KEY:
        return new SAMLInformationModal(provider);
      case FORWARD_AUTH_PROVIDER_KEY:
        return new ForwardedHeadersInfoModal(provider);
      case GRIST_CONNECT_PROVIDER_KEY:
        return new GristConnectInfoModal(provider);
      case GETGRIST_COM_PROVIDER_KEY:
        return new GetGristComProviderInfoModal();
      default:
        throw new Error(`No configuration modal available for provider key: ${provider.key}`);
    }
  }

  /**
   * Returns provider metadata without creating a Disposable modal instance.
   * Results are cached — safe to call from render functions.
   */
  public static metaFor(provider: AuthProvider): ProviderMeta {
    let meta = BaseInformationModal._metaCache.get(provider.key);
    if (!meta) {
      const instance = BaseInformationModal.for(provider);
      meta = {
        description: instance.description,
        heroDesc: instance.heroDesc,
        docsUrl: instance.docsUrl,
      };
      instance.dispose();
      BaseInformationModal._metaCache.set(provider.key, meta);
    }
    return meta;
  }

  private static _metaCache = new Map<string, ProviderMeta>();

  /** Short description for provider cards. */
  public description: string = "";
  /** Longer description for the hero card when this provider is active. */
  public heroDesc: string = t("Your server has authentication configured.");
  /** Link to setup documentation. */
  public docsUrl: string = "";

  constructor(protected _provider: AuthProvider) {
    super();
  }

  public show() {
    return modal((ctl, owner) => [
      () => {
        this.onDispose(() => {
          if (owner.isDisposed()) {
            return;
          }
          ctl.close();
        });
        return null;
      },
      cssModalWidth("fixed-wide"),
      cssModalHeader(
        dom("span", t(`Configure ${this._provider.name}`)),
        testId("modal-header"),
      ),
      cssModalDescription(
        ...this.getDescription().map(desc => dom("p", cssMarkdownSpan(desc))),
      ),
      cssModalInstructions(
        dom("h3", t("Instructions")),
        cssMarkdownSpan(this.getInstruction()),
      ),
      cssModalButtons(
        bigPrimaryButton(
          t("Close"),
          dom.on("click", () => this.dispose()),
          testId("modal-cancel"),
          testId("modal-close"),
        ),
      ),
    ]);
  }

  protected abstract getDescription(): string[];
  protected abstract getInstruction(): string;
}

/**
 * Modal for configuring OIDC authentication.
 */
class OIDCInformationModal extends BaseInformationModal {
  public description = t("Works with most identity providers (Google, Azure AD, Keycloak, etc.).");
  public heroDesc = t("Your server is configured to authenticate users via OpenID Connect. \
Users sign in through your identity provider.");

  public docsUrl = "https://support.getgrist.com/install/oidc";

  protected getDescription(): string[] {
    return [
      t("**OIDC** allows users on your Grist server to sign in using an external identity provider that \
supports the OpenID Connect standard."),
      t("When signing in, users will be redirected to your chosen identity provider's login page to \
authenticate. After successful authentication, they'll be redirected back to your Grist server and \
signed in as the user verified by the provider."),
    ];
  }

  protected getInstruction(): string {
    return t("To set up **OIDC**, follow the instructions in \
[the Grist support article for OIDC]({{url}}).", { url: this.docsUrl });
  }
}

/**
 * Modal for configuring SAML authentication.
 */
class SAMLInformationModal extends BaseInformationModal {
  public description = t("For enterprise identity providers (Okta, OneLogin, etc.).");
  public heroDesc = t("Your server is configured to authenticate users via SAML 2.0. \
Users sign in through your enterprise identity provider.");

  public docsUrl = "https://support.getgrist.com/install/saml/";

  protected getDescription(): string[] {
    return [
      t("**SAML** allows users on your Grist server to sign in using an external identity provider that \
supports the SAML 2.0 standard."),
      t("When signing in, users will be redirected to your chosen identity provider's login page to \
authenticate. After successful authentication, they'll be redirected back to your Grist server and \
signed in as the user verified by the provider."),
    ];
  }

  protected getInstruction(): string {
    return t("To set up **SAML**, follow the instructions in \
[the Grist support article for SAML]({{url}}).", { url: this.docsUrl });
  }
}

/**
 * Modal for configuring forwarded headers authentication.
 */
class ForwardedHeadersInfoModal extends BaseInformationModal {
  public description = t("For reverse proxy setups (Traefik, Authelia, etc.).");
  public heroDesc = t("Your server trusts authentication from a reverse proxy. \
Make sure only your proxy can reach the Grist backend.");

  public docsUrl = "https://support.getgrist.com/install/forwarded-headers/";

  protected getDescription(): string[] {
    return [
      t("**Forwarded headers** allows your Grist server to trust authentication performed by an external \
proxy (e.g. Traefik ForwardAuth)."),
      t("When a user accesses Grist, the proxy handles authentication and forwards verified user information \
through HTTP headers. Grist uses these headers to identify the user."),
    ];
  }

  protected getInstruction(): string {
    return t("To set up **forwarded headers**, follow the instructions in \
[the Grist support article for forwarded headers]({{url}}).", { url: this.docsUrl });
  }
}

/**
 * Modal for configuring Grist Connect authentication.
 */
class GristConnectInfoModal extends BaseInformationModal {
  public description = t("Managed login solution by Grist Labs (deprecated).");
  public heroDesc = t("This login mechanism is deprecated.");
  public docsUrl = "https://support.getgrist.com/install/grist-connect/";

  protected getDescription(): string[] {
    return [
      t("**Grist Connect** is a login solution built and maintained by Grist Labs that integrates seamlessly \
with your Grist server."),
      t("When signing in, users will be redirected to a Grist Connect login page where they can authenticate \
using various identity providers. After authentication, they'll be redirected back to your Grist server \
and signed in."),
    ];
  }

  protected getInstruction(): string {
    return t("To set up **Grist Connect**, follow the instructions in \
[the Grist support article for Grist Connect]({{url}}).", { url: this.docsUrl });
  }
}

// =========================================================================
// Storybook preview helper
// =========================================================================

/**
 * Renders a static preview of the authentication section for a given
 * list of providers. Used by Storybook to visualize every hero/card
 * state without needing the full app model or API layer.
 */
export function buildAuthSectionPreview(providers: AuthProvider[]): HTMLElement {
  const recentlyConfigured = new Set<string>();

  const hero =
    providers.find(p => p.isActive && isRealProvider(p.key)) ??
    providers.find(p => p.willBeActive && isRealProvider(p.key)) ??
    null;

  const dummyAdminFooter = cssAdminRow(
    dom("span", t("Installation admin: "), dom("strong", "admin@example.com")),
    textButton(t("Change installation admin")),
  );

  let heroEl: HTMLElement;
  if (hero) {
    const opts = buildActiveHeroOpts(hero, recentlyConfigured);
    heroEl = buildHeroCard({
      ...opts,
      actions: dom.frag(
        basicButton(t("Reconfigure")),
        basicButton(t("Deactivate")),
      ),
      footer: dummyAdminFooter,
    });
  } else {
    heroEl = buildHeroCard({
      variant: "error",
      title: t("No authentication"),
      badges: buildBadge(t("Not recommended"), "warning"),
      description: t("Anyone who can reach this server can access all data without signing in. \
Configure one of the authentication methods below."),
      footer: dom.frag(
        cssNoAuthCheckbox(
          labeledSquareCheckbox(noAuthAcknowledged,
            t("I understand this server has no authentication"),
          ),
        ),
        dummyAdminFooter,
      ),
    });
  }

  const visible = providers.filter(p =>
    !DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive,
  );

  const items = visible.map(p => buildProviderItemCard(p, recentlyConfigured));

  const listEl = buildCardList({
    header: hero ? t("Other authentication methods") : t("Available methods"),
    items,
    collapsible: !!hero,
    initiallyCollapsed: !!hero,
  });

  return cssPreviewContainer(dom("div", heroEl, listEl));
}

// ---------------------------------------------------------------------------
// Styled components (auth-specific, not moved to SetupCard)
// ---------------------------------------------------------------------------

const cssPreviewContainer = styled("div", `
  max-width: 700px;
`);

const cssAdminRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
`);

const cssNoAuthCheckbox = styled("div", `
  margin-top: 12px;
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
