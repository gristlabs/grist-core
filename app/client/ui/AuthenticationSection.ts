import { makeT } from "app/client/lib/localization";
import { localStorageBoolObs } from "app/client/lib/localStorageObs";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { redirectToLogin } from "app/client/lib/urlUtils";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel, getHomeUrl, reportError } from "app/client/models/AppModel";
import {
  cssIconWrapper,
  cssWell,
  cssWellContent,
  cssWellTitle,
} from "app/client/ui/AdminPanelCss";
import { ChangeAdminModal } from "app/client/ui/ChangeAdminModal";
import { ConfigSection, DraftChangeDescription } from "app/client/ui/DraftChanges";
import {
  armSetupReturnFromGetGristCom,
  clearSetupReturnFromGetGristCom,
  GetGristComProviderInfoModal,
  getGristComProviderMeta,
  peekSetupReturnFromGetGristCom,
} from "app/client/ui/GetGristComProvider";
import { ApplyResult } from "app/client/ui/QuickSetupContinueButton";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssCardSurface } from "app/client/ui/SettingsLayout";
import { cssHeroCard } from "app/client/ui/SetupCard";
import { basicButton, bigBasicButton, bigPrimaryButton, textButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { confirmModal, cssModalWidth, modal, saveModal } from "app/client/ui2018/modals";
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
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AuthenticationSection");

const testId = makeTestId("test-admin-auth-");

// Scope the acknowledgement to this installation, so the same browser used
// to administer multiple Grist installations doesn't carry the dismissal across.
const installationId = getGristConfig().activation?.installationId;
const noAuthAcknowledged = localStorageBoolObs(
  installationId ? `noAuthAcknowledged:${installationId}` : "noAuthAcknowledged",
);

interface AuthenticationSectionOptions {
  appModel: AppModel;
  loginSystemId?: Observable<string | undefined>;
  /**
   * True when rendered inside the admin panel; false in the setup wizard.
   * Controls admin-only affordances (the in-panel "Restart required"
   * warning with Change-admin-user controls). Restart routing happens
   * via the parent's DraftChangesManager regardless.
   */
  inAdminPanel?: boolean;
  installAPI?: InstallAPI;
}

export class AuthenticationSection extends Disposable implements ConfigSection {
  /**
   * True when authentication is in a state the user can proceed with:
   * a real provider is active, configured, or pending — or the user acknowledged no-auth.
   */
  public canProceed: Computed<boolean>;

  /**
   * True when there are saved changes that won't take effect until the
   * server restarts: a provider that will be active on next boot, or
   * deferred install-prefs (admin email changes). Drives the QuickSetup
   * "Apply and Continue" / "Continue" button label.
   */
  public isDirty: Computed<boolean>;

  /**
   * Per-section description shown in the restart banner. Reactive on
   * `_displayProviders`, `_draftConfigs`, and `_prefsPendingChanges`, so
   * a second sub-change while already-dirty (e.g. a queued admin email
   * change after a provider switch) refreshes the displayed bullets.
   */
  public describeChange: Computed<DraftChangeDescription[]>;

  /** Auth changes always require a restart to take effect. */
  public readonly needsRestart = true;

  private _appModel = this._options.appModel;
  private _installAPI = this._options.installAPI ?? new InstallAPIImpl(getHomeUrl());
  /** True when embedded in the admin panel (vs. the setup wizard). */
  private _inAdminPanel = Boolean(this._options.inAdminPanel);

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

  /**
   * Per-provider configuration drafts (currently only the getgrist.com
   * secret). The map's value is the body that will be PATCHed to
   * `/api/config/auth-providers` on apply. Drafts disappear once apply
   * has persisted them.
   */
  private _draftConfigs = Observable.create<Map<string, Record<string, string>>>(this, new Map());

  /**
   * Pending choice for the active authentication provider. `null` means
   * the user has not chosen one in this session; otherwise it is a
   * provider key (or `FALLBACK_PROVIDER_KEY` for "deactivate").
   */
  private _draftActiveProvider = Observable.create<string | null>(this, null);

  /**
   * Server providers merged with local drafts. Drafts win over server
   * state, so the user sees their pending choices reflected in the
   * hero card and the provider list before they apply.
   */
  private _displayProviders = Computed.create(
    this, this._providers, this._draftConfigs, this._draftActiveProvider,
    (_use, providers, draftConfigs, draftActive) => {
      return providers.map(p => mergeProviderWithDrafts(p, draftConfigs, draftActive));
    },
  );

  private _hasActiveOnRestartProvider = Computed.create(this, this._displayProviders, (_use, providers) => {
    return providers.some(p => p.willBeActive);
  });

  // Server-side state that needs a restart to settle: a provider switch
  // or a queued admin-email change. Distinct from `isDirty`, which also
  // counts purely local drafts.
  private _hasPersistedRestartChange = Computed.create(
    this, this._hasActiveOnRestartProvider, this._prefsPendingChanges,
    (_use, hasActive, prefs) => {
      return hasActive ||
        Boolean(prefs?.onRestartSetAdminEmail) ||
        Boolean(prefs?.onRestartReplaceEmailWithAdmin);
    },
  );

  private _getgristLoginOwner = Computed.create(this, this._providers, (_use, providers) => {
    const getgristLogin = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);
    return getgristLogin?.metadata?.owner ?? null;
  });

  constructor(private _options: AuthenticationSectionOptions) {
    super();

    this.canProceed = Computed.create(this, (use) => {
      if (use(noAuthAcknowledged)) { return true; }
      if (use(this._hasActiveOnRestartProvider)) { return true; }
      const providers = use(this._displayProviders);
      if (providers.some(p => (p.isActive || p.isConfigured) && isRealProvider(p.key))) { return true; }
      const loginSystemId = use(this._loginSystemId);
      return !!loginSystemId && isRealProvider(loginSystemId);
    });

    // Evaluate every branch: short-circuit returns drop subscriptions to
    // later deps, leaving `isDirty` stale once an early truthy branch flips.
    this.isDirty = Computed.create(this, (use) => {
      const hasDraftConfigs = use(this._draftConfigs).size > 0;
      const hasDraftActive = use(this._draftActiveProvider) !== null;
      const hasPersistedRestartChange = use(this._hasPersistedRestartChange);
      return hasDraftConfigs || hasDraftActive || hasPersistedRestartChange;
    });

    this.describeChange = Computed.create(this, (use) => {
      const entries: DraftChangeDescription[] = [];
      const providers = use(this._displayProviders);
      const willBeActive = providers.find(p => p.willBeActive);
      const willBeDisabled = providers.find(p => p.willBeDisabled);
      if (willBeActive) {
        entries.push({ label: t("Authentication"), value: willBeActive.name });
      } else if (willBeDisabled) {
        entries.push({ label: t("Authentication"), value: t("disabled") });
      } else if (use(this._draftConfigs).size > 0) {
        entries.push({ label: t("Authentication"), value: t("configuration updated") });
      }

      const prefs = use(this._prefsPendingChanges);
      if (prefs?.onRestartSetAdminEmail) {
        entries.push({ label: t("New admin email"), value: prefs.onRestartSetAdminEmail });
      }
      if (prefs?.onRestartReplaceEmailWithAdmin) {
        entries.push({
          label: t("Reassign login to admin"),
          value: prefs.onRestartReplaceEmailWithAdmin,
        });
      }

      // describeChange is only consulted when isDirty is true; one of the
      // above branches should have hit. Fall back rather than throw.
      if (entries.length === 0) {
        entries.push({ label: t("Authentication"), value: "" });
      }
      return entries;
    });

    this._fetchProviders().catch(reportError);
    this._fetchPrefsPendingChanges().catch(reportError);

    // Don't clear the breadcrumb here -- the AppModel re-initializes
    // during boot and may dispose+re-mount this section, and we want
    // the new mount to also reopen the modal.
    if (!this._inAdminPanel && peekSetupReturnFromGetGristCom() === "auth") {
      this._openGetGristComModal();
    }
  }

  /**
   * Persist drafts to the server. Configure calls go first because a
   * provider must be configured server-side before it can be set active.
   * Each draft is cleared once its API call succeeds, so a partial
   * failure leaves the remaining drafts in place for a retry. The
   * DraftChangesManager fires the restart afterwards; `afterApply` then
   * routes the now-signed-out admin through sign-in.
   */
  public async apply(): Promise<void> {
    for (const [providerKey, config] of this._draftConfigs.get()) {
      await this._configAPI.configureProvider(providerKey, config);
      this._updateDraftConfigs(draft => draft.delete(providerKey));
      this._recentlyConfigured.add(providerKey);
    }

    const activeChoice = this._draftActiveProvider.get();
    if (activeChoice !== null) {
      await this._configAPI.setActiveAuthProvider(activeChoice);
      this._draftActiveProvider.set(null);
      this._recentlyConfigured.add(activeChoice);
    }

    // Refresh `_providers` here so `isDirty` survives a restart failure --
    // `afterApply` only runs on success.
    if (!this.isDisposed()) {
      await this._fetchProviders();
    }
  }

  /**
   * Auth changes invalidate the admin's session, so once the manager has
   * restarted we redirect through sign-in rather than trying to refetch
   * (the API would 401 anyway). Returning `{ redirected: true }` tells the
   * manager and its caller to skip any post-apply work.
   */
  public async afterApply(): Promise<ApplyResult> {
    if (this.isDisposed()) { return; }
    redirectToLogin();
    return { redirected: true };
  }

  /**
   * Drop every contribution this section makes to the draft list:
   *   - clear local provider-config and active-provider drafts
   *   - null both on-restart admin-email prefs server-side
   * `willBeActive`/`willBeDisabled` rooted in env-var deltas aren't
   * cleared here -- the user can reverse those via the per-provider
   * controls in the section itself.
   */
  public async dismiss(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    this._draftConfigs.set(new Map());
    this._draftActiveProvider.set(null);
    this._recentlyConfigured.clear();
    const prefs = this._prefsPendingChanges.get();
    if (prefs?.onRestartSetAdminEmail || prefs?.onRestartReplaceEmailWithAdmin) {
      await this._installAPI.updateInstallPrefs({
        onRestartSetAdminEmail: null,
        onRestartReplaceEmailWithAdmin: null,
      });
      if (this.isDisposed()) { return; }
      await this._fetchPrefsPendingChanges();
    }
  }

  public buildDom() {
    return [
      this._inAdminPanel ? null : quickSetupStepHeader({
        icon: "AddUser",
        title: t("Authentication"),
        description: t("Choose how users sign in to Grist."),
      }),
      dom.domComputed((use) => {
        const providers = use(this._displayProviders);
        const loginSystemId = use(this._loginSystemId);
        return this._buildSection(providers, loginSystemId);
      }),
      this._inAdminPanel ?
        dom.maybe(this._hasPersistedRestartChange, () => this._buildAuthenticationChangeWarning()) : null,
    ];
  }

  /** Apply a mutation to the draft-configs map immutably. */
  private _updateDraftConfigs(mutate: (draft: Map<string, Record<string, string>>) => void) {
    const next = new Map(this._draftConfigs.get());
    mutate(next);
    this._draftConfigs.set(next);
  }

  private _makeLoginSystemId(): Observable<string | undefined> {
    const checks = new AdminChecks(this, this._installAPI);
    checks.fetchAvailableChecks().catch(reportError);
    return checks.buildLoginProviderObs(this);
  }

  private async _fetchProviders() {
    const providers = await this._configAPI.getAuthProviders();
    if (this.isDisposed()) {
      return;
    }
    this._providers.set(providers);
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
    return buildAuthSection(providers, {
      heroCtx: {
        adminEmail: this._currentUserEmail,
        onChangeAdmin: () => this._showChangeAdminModal(),
        onReconfigure: getgrist ? () => this._configureProvider(getgrist) : undefined,
        onDeactivate: getgrist ? () => this._deactivateProvider(getgrist) : undefined,
      },
      listCtx: {
        onSetActive: p => this._setActiveProvider(p),
        onConfigure: p => this._configureProvider(p),
      },
      recentlyConfigured: this._recentlyConfigured,
      loginSystemId,
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

  private _setActiveProvider(provider: AuthProvider) {
    confirmModal(
      t("Set as active method?"),
      t("Confirm"),
      async () => { this._draftActiveProvider.set(provider.key); },
      {
        explanation: dom("div",
          cssMarkdownSpan(
            t("Are you sure you want to set **{{name}}** as the active authentication method?",
              { name: provider.name }),
          ),
          dom("p",
            t("The change will be saved when you apply pending changes, and will go into \
effect after you restart Grist."),
          ),
        ),
      },
    );
  }

  private _openGetGristComModal() {
    const m = new GetGristComProviderInfoModal();
    if (!this._inAdminPanel) {
      armSetupReturnFromGetGristCom("auth");
    }
    const onUserClose = () => {
      if (!this._inAdminPanel) { clearSetupReturnFromGetGristCom(); }
    };
    m.show({
      onSubmit: (key: string) => {
        this._updateDraftConfigs(draft =>
          draft.set(GETGRIST_COM_PROVIDER_KEY, { GRIST_GETGRISTCOM_SECRET: key }));
        // Mirror the server's "first configured provider wins" behavior:
        // if nothing is currently active and the user has not chosen one
        // yet in this session, treat the just-configured provider as the
        // pending active. Saves the user an explicit "Set as active"
        // click in the simple zero-config-to-getgrist.com path.
        if (this._draftActiveProvider.get() === null && !this._providers.get().some(p => p.isActive)) {
          this._draftActiveProvider.set(GETGRIST_COM_PROVIDER_KEY);
        }
        this._recentlyConfigured.add(GETGRIST_COM_PROVIDER_KEY);
        onUserClose();
      },
      onCancel: onUserClose,
    });
    this.onDispose(() => m.isDisposed() ? void 0 : m.dispose());
  }

  private _configureProvider(provider: AuthProvider) {
    if (provider.key === GETGRIST_COM_PROVIDER_KEY) {
      this._openGetGristComModal();
    } else if (PROVIDER_META_BUILDERS[provider.key]) {
      const m = new InformationModal(provider);
      m.show();
      this.onDispose(() => m.isDisposed() ? void 0 : m.dispose());
    }
  }

  private _deactivateProvider(provider: AuthProvider) {
    confirmModal(
      t("Deactivate authentication?"),
      t("Deactivate"),
      async () => { this._draftActiveProvider.set(FALLBACK_PROVIDER_KEY); },
      {
        explanation: dom("div",
          cssMarkdownSpan(
            t("Are you sure you want to deactivate **{{name}}**?", { name: provider.name }),
          ),
          dom("p",
            t("Your configuration will be preserved. You can reactivate it later without reconfiguring."),
          ),
          dom("p",
            t("The change will be saved when you apply pending changes, and will take \
effect after you restart Grist."),
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
        defaultEmail: this._getgristLoginOwner.get()?.email,
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
  };

  private async _revertSetInstallAdmin() {
    await this._installAPI.updateInstallPrefs({
      onRestartSetAdminEmail: null,
      onRestartReplaceEmailWithAdmin: null,
    });
    if (this.isDisposed()) { return; }

    await this._fetchPrefsPendingChanges();
  };
}

/**
 * Merge a server-reported provider with any client-side drafts so the UI
 * reflects the user's pending choices.
 *
 * - A draft secret marks the provider as configured and (if the server
 *   has not pinned the active provider via env) able to be activated.
 * - A draft active-provider choice flips `willBeActive` on the chosen
 *   provider and `willBeDisabled` on the currently-active one. Choosing
 *   the fallback (deactivate) just sets `willBeDisabled` on the
 *   currently-active provider.
 */
function mergeProviderWithDrafts(
  provider: AuthProvider,
  draftConfigs: Map<string, Record<string, string>>,
  draftActive: string | null,
): AuthProvider {
  const merged: AuthProvider = { ...provider };

  if (draftConfigs.has(provider.key)) {
    merged.isConfigured = true;
    merged.configError = undefined;
    if (!provider.isSelectedByEnv) {
      merged.canBeActivated = !provider.isActive;
    }
  }

  if (draftActive !== null) {
    const wasActive = !!provider.isActive;
    // Mirror the server's `isActive = key === active && key === next` so
    // the ACTIVE badge clears on the outgoing provider as soon as the
    // user picks a new one.
    merged.isActive = wasActive && provider.key === draftActive;
    if (provider.key === draftActive) {
      merged.willBeActive = !wasActive;
      merged.willBeDisabled = false;
      merged.canBeActivated = false;
    } else {
      merged.willBeActive = false;
      if (wasActive) {
        merged.willBeDisabled = true;
        merged.canBeActivated = !provider.isSelectedByEnv;
      }
    }
  }
  return merged;
}

/**
 * Per-provider metadata used by both the auth section rendering and the
 * read-only configuration modal (`InformationModal`). Held as plain data --
 * no Disposable lifecycle, no subclasses -- so render functions can read it
 * without any object construction.
 */
interface ProviderMeta {
  /** Short description for provider cards. */
  description: string;
  /** Longer description for the hero card when this provider is active. */
  heroDesc: string;
  /** Link to setup documentation. */
  docsUrl: string;
  /** Paragraphs shown in the configuration modal. */
  modalDescription: string[];
  /** Instruction shown at the bottom of the configuration modal. */
  modalInstruction: string;
}

const DEFAULT_PROVIDER_META: ProviderMeta = {
  description: "",
  heroDesc: "",
  docsUrl: "",
  modalDescription: [],
  modalInstruction: "",
};

// Translation calls are deferred to first read so locale changes are picked up.
const PROVIDER_META_BUILDERS: Record<string, () => ProviderMeta> = {
  [OIDC_PROVIDER_KEY]: () => {
    const docsUrl = "https://support.getgrist.com/install/oidc";
    return {
      description: t("Works with most identity providers (Google, Azure AD, Keycloak, etc.)."),
      heroDesc: t("Your server is configured to authenticate users via OpenID Connect. \
Users sign in through your identity provider."),
      docsUrl,
      modalDescription: [
        t("**OIDC** allows users on your Grist server to sign in using an external identity provider that \
supports the OpenID Connect standard."),
        t("When signing in, users will be redirected to your chosen identity provider's login page to \
authenticate. After successful authentication, they'll be redirected back to your Grist server and \
signed in as the user verified by the provider."),
      ],
      modalInstruction: t("To set up **OIDC**, follow the instructions in \
[the Grist support article for OIDC]({{url}}).", { url: docsUrl }),
    };
  },
  [SAML_PROVIDER_KEY]: () => {
    const docsUrl = "https://support.getgrist.com/install/saml/";
    return {
      description: t("For enterprise identity providers (Okta, OneLogin, etc.)."),
      heroDesc: t("Your server is configured to authenticate users via SAML 2.0. \
Users sign in through your enterprise identity provider."),
      docsUrl,
      modalDescription: [
        t("**SAML** allows users on your Grist server to sign in using an external identity provider that \
supports the SAML 2.0 standard."),
        t("When signing in, users will be redirected to your chosen identity provider's login page to \
authenticate. After successful authentication, they'll be redirected back to your Grist server and \
signed in as the user verified by the provider."),
      ],
      modalInstruction: t("To set up **SAML**, follow the instructions in \
[the Grist support article for SAML]({{url}}).", { url: docsUrl }),
    };
  },
  [FORWARD_AUTH_PROVIDER_KEY]: () => {
    const docsUrl = "https://support.getgrist.com/install/forwarded-headers/";
    return {
      description: t("For reverse proxy setups (Traefik, Authelia, etc.)."),
      heroDesc: t("Your server trusts authentication from a reverse proxy. \
Make sure only your proxy can reach the Grist backend."),
      docsUrl,
      modalDescription: [
        t("**Forwarded headers** allows your Grist server to trust authentication performed by an external \
proxy (e.g. Traefik ForwardAuth)."),
        t("When a user accesses Grist, the proxy handles authentication and forwards verified user information \
through HTTP headers. Grist uses these headers to identify the user."),
      ],
      modalInstruction: t("To set up **forwarded headers**, follow the instructions in \
[the Grist support article for forwarded headers]({{url}}).", { url: docsUrl }),
    };
  },
  [GRIST_CONNECT_PROVIDER_KEY]: () => {
    const docsUrl = "https://support.getgrist.com/install/grist-connect/";
    return {
      description: t("Managed login solution by Grist Labs (deprecated)."),
      heroDesc: t("This login mechanism is deprecated."),
      docsUrl,
      modalDescription: [
        t("**Grist Connect** is a login solution built and maintained by Grist Labs that integrates seamlessly \
with your Grist server."),
        t("When signing in, users will be redirected to a Grist Connect login page where they can authenticate \
using various identity providers. After authentication, they'll be redirected back to your Grist server \
and signed in."),
      ],
      modalInstruction: t("To set up **Grist Connect**, follow the instructions in \
[the Grist support article for Grist Connect]({{url}}).", { url: docsUrl }),
    };
  },
  // The getgrist.com modal has its own custom UI; only the card/hero fields are needed here.
  [GETGRIST_COM_PROVIDER_KEY]: () => ({
    ...getGristComProviderMeta(),
    modalDescription: [],
    modalInstruction: "",
  }),
};

const _providerMetaCache = new Map<string, ProviderMeta>();

function getProviderMeta(provider: AuthProvider): ProviderMeta {
  const cached = _providerMetaCache.get(provider.key);
  if (cached) { return cached; }
  const builder = PROVIDER_META_BUILDERS[provider.key];
  const meta = builder ? builder() : DEFAULT_PROVIDER_META;
  _providerMetaCache.set(provider.key, meta);
  return meta;
}

/**
 * Read-only configuration modal for providers that just describe themselves
 * and link to setup docs (OIDC, SAML, ForwardAuth, Grist Connect). The
 * getgrist.com provider has its own modal (`GetGristComProviderInfoModal`).
 */
class InformationModal extends Disposable {
  constructor(private _provider: AuthProvider) {
    super();
  }

  public show() {
    const meta = getProviderMeta(this._provider);
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
        ...meta.modalDescription.map(desc => dom("p", cssMarkdownSpan(desc))),
      ),
      cssModalInstructions(
        dom("h3", t("Instructions")),
        cssMarkdownSpan(meta.modalInstruction),
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
}

// =========================================================================
// Rendering functions for auth UI elements, shared by the live admin
// panel (via AuthenticationSection) and Storybook (via buildAuthSectionPreview).
// =========================================================================

export interface HeroCardContext {
  adminEmail: string;
  onChangeAdmin?: () => void;
  onReconfigure?: () => void;
  onDeactivate?: () => void;
}

export interface ProviderListContext {
  onSetActive?: (provider: AuthProvider) => void;
  onConfigure?: (provider: AuthProvider) => void;
  collapsible?: boolean;
  /** When true, collapse the list when the no-auth checkbox is acknowledged. */
  collapseOnNoAuth?: boolean;
}

export interface AuthSectionContext {
  heroCtx: HeroCardContext;
  listCtx: ProviderListContext;
  recentlyConfigured?: ReadonlySet<string>;
  /** The login system ID from the boot probe (e.g. "minimal", "boot-key").
   *  When set to a non-real provider key, shows the no-auth hero. */
  loginSystemId?: string;
}

/**
 * Assembles the complete auth section: hero card + provider list.
 * Single code path shared by the live admin panel and the Storybook preview.
 */
export function buildAuthSection(
  providers: AuthProvider[],
  ctx: AuthSectionContext,
): HTMLElement {
  const recentlyConfigured = ctx.recentlyConfigured ?? new Set();

  const hero =
    providers.find(p => p.isActive && isRealProvider(p.key)) ??
    providers.find(p => p.willBeActive && isRealProvider(p.key)) ??
    null;

  // Show the no-auth hero when no real provider is active or pending. This covers:
  // - Boot probe reports a non-real provider (minimal, boot-key)
  // - A provider was just deactivated (willBeDisabled) with nothing replacing it
  const noRealPending = providers.some(p => p.willBeDisabled) &&
    !providers.some(p => p.willBeActive);
  const bootProbeNoAuth = !!ctx.loginSystemId && !isRealProvider(ctx.loginSystemId);
  const showNoAuth = !hero && (bootProbeNoAuth || noRealPending);
  // When deactivating, the boot probe still reports the old provider. Use the
  // fallback key so the hero shows the right language for what comes after restart.
  const effectiveLoginSystem = noRealPending ? FALLBACK_PROVIDER_KEY : ctx.loginSystemId;
  const heroEl = (hero || showNoAuth) ?
    buildHeroCard(hero, recentlyConfigured, ctx.heroCtx, effectiveLoginSystem) :
    dom("div");

  const listEl = buildProviderList(
    providers, recentlyConfigured, { ...ctx.listCtx, collapsible: !!hero, collapseOnNoAuth: showNoAuth },
  );

  return dom("div", heroEl, listEl);
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
  // Suppress activeError when it's likely stale.
  if (!provider.activeError) { return undefined; }
  if (recentlyConfigured.has(provider.key)) { return undefined; }
  if (provider.willBeActive && !provider.isActive) { return undefined; }
  return provider.activeError;
}

type BadgeVariant = "-primary" | "-warning" | "-error";

function badge(label: string, variant: BadgeVariant, extraTestId: string) {
  return cssMethodBadge(label, cssMethodBadge.cls(variant), testId("badge"), testId(extraTestId));
}

function buildHeroBadge(provider: AuthProvider, error: string | undefined) {
  if (error) { return badge(t("Error"), "-error", "badge-error"); }
  if (provider.isActive) { return badge(t("Active"), "-primary", "badge-active"); }
  if (provider.willBeActive) { return badge(t("Active on restart"), "-warning", "badge-active-on-restart"); }
  return null;
}

function buildHeroAdminRow(ctx: HeroCardContext) {
  return cssHeroAdminRow(
    dom("span",
      t("Installation admin: "),
      dom("strong", ctx.adminEmail),
    ),
    textButton(
      t("Change installation admin"),
      ctx.onChangeAdmin ? dom.on("click", ctx.onChangeAdmin) : null,
      testId("change-admin"),
    ),
  );
}

function buildHeroCard(
  hero: AuthProvider | null,
  recentlyConfigured: ReadonlySet<string>,
  ctx: HeroCardContext,
  loginSystemId?: string,
): HTMLElement {
  if (!hero) {
    const isBootKey = loginSystemId === BOOT_KEY_PROVIDER_KEY;
    return cssHeroCard(
      cssHeroCard.cls("-error", use => !use(noAuthAcknowledged)),
      cssHeroCard.cls("-warning", noAuthAcknowledged),
      testId("hero-card"),
      testId("hero-warning"),
      cssHeroHeader(
        cssHeroProviderName(isBootKey ?
          t("No authentication: using boot key") :
          t("No authentication"),
        ),
        badge(t("Not recommended"), "-warning", "badge-warning"),
      ),
      cssHeroDescription(
        isBootKey ?
          t("Your server is using a boot key as a fallback login method. \
Configure one of the authentication methods below.") :
          t("Anyone who can reach this server can access all data without signing in. \
Configure one of the authentication methods below."),
      ),
      cssNoAuthCheckbox(
        labeledSquareCheckbox(noAuthAcknowledged,
          t("I understand this server has no authentication"),
          testId("no-auth-acknowledge"),
        ),
      ),
      buildHeroAdminRow(ctx),
    );
  }

  const error = getVisibleError(hero, recentlyConfigured);
  const meta = getProviderMeta(hero);
  const variant = error ? "-error" : hero.isActive ? "-success" : "-pending";

  let descText: string | undefined;
  if (error) {
    descText = t("Authentication is misconfigured or unreachable. Users may not be able to sign in.");
  } else if (hero.isActive) {
    descText = meta.heroDesc;
  } else if (hero.willBeActive) {
    descText = t("Authentication has been configured and will become active when Grist is restarted.");
  }

  const hasActions = ctx.onReconfigure || ctx.onDeactivate;

  return cssHeroCard(
    cssHeroCard.cls(variant),
    testId("hero-card"),
    cssHeroHeader(
      cssHeroProviderName(hero.name),
      buildHeroBadge(hero, error),
    ),
    descText ? cssHeroDescription(descText) : null,
    error ? cssHeroError(error, testId("hero-error")) : null,
    hasActions ? cssHeroActions(
      ctx.onReconfigure ? basicButton(
        t("Reconfigure"),
        dom.on("click", ctx.onReconfigure),
        testId("hero-reconfigure"),
      ) : null,
      ctx.onDeactivate ? basicButton(
        t("Deactivate"),
        dom.on("click", ctx.onDeactivate),
        testId("hero-deactivate"),
      ) : null,
    ) : null,
    buildHeroAdminRow(ctx),
    testId(`hero-${variant.slice(1)}`),
  );
}

function buildProviderCard(
  provider: AuthProvider,
  recentlyConfigured: ReadonlySet<string>,
  ctx: ProviderListContext = {},
): HTMLElement {
  const error = getVisibleError(provider, recentlyConfigured);
  const meta = getProviderMeta(provider);
  let borderVariant: string | null = null;
  if (provider.isActive) {
    borderVariant = "-border-active";
  } else if (provider.isConfigured && !error) {
    borderVariant = "-border-configured";
  } else if (error) {
    borderVariant = "-border-error";
  }

  return cssMethodRow(
    borderVariant ? cssMethodRow.cls(borderVariant) : null,
    testId(`provider-row-${provider.key.replace(".", "-")}`),
    testId(`provider-row`),
    cssMethodContent(
      cssMethodLabel(provider.name),
      provider.isActive ? badge(t("Active"), "-primary", "badge-active") : null,
      provider.willBeActive ? badge(t("Active on restart"), "-warning", "badge-active-on-restart") : null,
      provider.willBeDisabled ? badge(t("Disabled on restart"), "-warning", "badge-disabled-on-restart") : null,
      error ? badge(t("Error"), "-error", "badge-error") : null,
      cssFlex(),
      provider.canBeActivated ?
        basicButton(
          t("Set as active method"),
          testId(`set-active-button`),
          ctx.onSetActive ? dom.on("click", () => ctx.onSetActive!(provider)) : null,
        ) : null,
      basicButton(
        t("Configure"),
        testId("configure-button"),
        testId(`configure-${provider.name.toLowerCase().replace(/\s+/g, "-")}`),
        dom.prop("disabled", Boolean(provider.isActive)),
        !provider.isActive && ctx.onConfigure ? dom.on("click", () => ctx.onConfigure!(provider)) : null,
      ),
    ),
    meta.description ? cssMethodHint(meta.description) : null,
    error ?
      dom("div",
        cssErrorHeader(t("Error details"), testId("error-header")),
        cssMethodError(error, testId("error-message")),
      ) : null,
    provider.isSelectedByEnv ?
      cssMethodInfo(
        t("Active method is controlled by an environment variable. Unset variable to change active method."),
      ) : null,
  );
}

function buildProviderList(
  providers: AuthProvider[],
  recentlyConfigured: ReadonlySet<string>,
  ctx: ProviderListContext = {},
): HTMLElement {
  const visible = providers.filter(p =>
    !DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive,
  );
  if (visible.length === 0) { return dom("div"); }

  const buildCards = () => cssMethodsContainer(
    visible.map(p => buildProviderCard(p, recentlyConfigured, ctx)),
  );

  if (!ctx.collapsible && !ctx.collapseOnNoAuth) {
    return dom("div",
      cssProviderListHeader(t("Available methods"), testId("provider-list-header")),
      buildCards(),
    );
  }

  const collapsed = Observable.create(null, ctx.collapsible || (ctx.collapseOnNoAuth && noAuthAcknowledged.get()));
  const noAuthListener = ctx.collapseOnNoAuth ?
    noAuthAcknowledged.addListener(val => collapsed.set(val)) : null;
  const toggle = () => collapsed.set(!collapsed.get());
  return dom("div",
    dom.autoDispose(collapsed),
    noAuthListener ? dom.autoDispose(noAuthListener) : null,
    cssProviderListHeaderClickable(
      dom.domComputed(collapsed, c => cssCollapseIcon(c ? "Expand" : "Collapse")),
      t("Other authentication methods"),
      dom.on("click", toggle),
      dom.on("keydown", (ev: KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      }),
      dom.attr("tabindex", "0"),
      dom.attr("role", "button"),
      dom.attr("aria-expanded", use => String(!use(collapsed))),
      testId("provider-list-header"),
    ),
    dom.maybe(use => !use(collapsed), buildCards),
  );
}

const cssHeroHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
`);

const cssHeroProviderName = styled("div", `
  font-size: ${vars.largeFontSize};
  font-weight: 600;
  color: ${theme.text};
`);

const cssHeroDescription = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
  line-height: 1.4;
  margin-bottom: 8px;
`);

const cssHeroError = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.mediumFontSize};
  margin-bottom: 8px;
`);

const cssHeroAdminRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${theme.menuBorder};
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
`);

const cssHeroActions = styled("div", `
  display: flex;
  gap: 8px;
  margin-top: 12px;
`);

const cssNoAuthCheckbox = styled("div", `
  margin-top: 12px;
`);

const cssProviderListHeader = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${theme.lightText};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`);

const cssProviderListHeaderClickable = styled(cssProviderListHeader, `
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
  &:hover {
    color: ${theme.text};
  }
  /* Inset the focus ring with box-shadow so it isn't clipped by ancestor
     overflow boundaries (the section sits inside a card with overflow:hidden). */
  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px ${theme.controlFg};
    border-radius: 4px;
    padding: 2px 4px;
    margin: -2px -4px;
  }
`);

const cssCollapseIcon = styled(icon, `
  width: 16px;
  height: 16px;
  --icon-color: ${theme.lightText};
`);

const cssMethodsContainer = styled(cssCardSurface, `
  display: flex;
  flex-direction: column;
  overflow: hidden;
`);

const cssMethodRow = styled("div", `
  display: flex;
  gap: 16px;
  flex-direction: column;
  padding: 16px;
  background-color: ${theme.mainPanelBg};
  border-bottom: 1px solid ${theme.menuBorder};
  border-left: 3px solid transparent;
  &:last-child {
    border-bottom: none;
  }
  &-border-active {
    border-left-color: ${theme.toastSuccessBg};
  }
  &-border-configured {
    border-left-color: ${theme.controlPrimaryBg};
  }
  &-border-error {
    border-left-color: ${theme.errorText};
  }
`);

const cssMethodContent = styled("div", `
  display: flex;
  flex-direction: row;
  align-items: center;
  flex: 1;
  gap: 12px;
`);

const cssMethodInfo = styled("div", `
  color: ${theme.lightText};
`);

const cssMethodHint = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
  & a {
    color: ${theme.controlFg};
  }
`);

const cssMethodError = styled("div", `
  color: ${theme.errorText};
  margin-top: 4px;
`);

const cssErrorHeader = styled("div", `
  color: ${theme.errorText};
  font-weight: 600;
  font-size: ${vars.smallFontSize};
  margin-top: 8px;
  margin-bottom: 4px;
`);

const cssMethodLabel = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
`);

const cssMethodBadge = styled("div", `
  padding: 2px 8px;
  color: ${theme.lightText};
  border: 1px solid ${theme.lightText};
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  border-radius: 16px;
  text-transform: uppercase;
  white-space: nowrap;
  &-primary {
    border-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryBg};
  }
  &-warning {
    border-color: #ffb535;
    color: ${theme.toastWarningBg}
  }
  &-error {
    border-color: ${theme.errorText};
    color: ${theme.errorText};
  }
`);

const cssFlex = styled("div", `
  flex: 1;
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
