import { makeT } from "app/client/lib/localization";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { redirectToLogin } from "app/client/lib/urlUtils";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel, getHomeUrl, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
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
  getGetGristComKeyOwner,
  GetGristComProviderInfoModal,
  getGristComProviderMeta,
  peekSetupReturnFromGetGristCom,
} from "app/client/ui/GetGristComProvider";
import { buildInstallationIdBlock } from "app/client/ui/InstallationIdBlock";
import { ApplyResult } from "app/client/ui/QuickSetupContinueButton";
import {
  buildBadge,
  buildCardList,
  buildItemCard,
  buildItemContent,
  buildItemRadio,
  cssHeroActions,
  cssHeroCard,
  cssItemError,
  cssItemInfo,
} from "app/client/ui/SetupCard";
import { basicButton, bigBasicButton, bigPrimaryButton, textButton } from "app/client/ui2018/buttons";
import { bigBasicButtonLink, bigPrimaryButtonLink } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { confirmModal, cssModalWidth, modal, saveModal } from "app/client/ui2018/modals";
import { AuthProvider, ConfigAPI } from "app/common/ConfigAPI";
import { ADMIN_PANEL_EDITION_ANCHOR, commonUrls } from "app/common/gristUrls";
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
import { getAdminConfig, getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AuthenticationSection");

const testId = makeTestId("test-admin-auth-");

/**
 * Prompt the admin to acknowledge that the server has no authentication
 * before continuing past the Quick Setup auth step without configuring a
 * provider (i.e. choosing the last-resort 'no-auth' option).
 */
export function confirmNoAuthAcknowledgement(onConfirm: () => void): void {
  saveModal((_ctl, owner) => {
    const ack = Observable.create(owner, false);
    const saveDisabled = Computed.create(owner, use => !use(ack));
    return {
      title: t("Skip authentication setup?"),
      body: dom("div",
        cssWell(
          cssWell.cls("-warning"),
          cssIconWrapper(icon("Warning")),
          cssWellContent(
            dom("p",
              t("Anyone who can reach this server can access all data without signing in. \
You can configure authentication later from the admin panel."),
            ),
          ),
        ),
        cssNoAuthCheckbox(
          labeledSquareCheckbox(ack,
            t("I understand this server will run with no authentication"),
            testId("no-auth-acknowledge"),
          ),
        ),
      ),
      saveLabel: t("Continue without authentication"),
      saveDisabled,
      saveFunc: async () => onConfirm(),
      width: "fixed-wide" as const,   // wider, so that long buttons don't wrap.
    };
  });
}

/** True for a provider that requires an activation key on an install that has none. */
function isMissingRequiredKey(p: AuthProvider): boolean {
  return (p.key === OIDC_PROVIDER_KEY || p.key === SAML_PROVIDER_KEY) && !getGristConfig().activation?.key;
}

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
   * True when a real auth provider is active or pending (will be active after restart).
   */
  public hasConfiguredAuth: Computed<boolean>;

  /**
   * True when authentication is in a state the user can proceed with:
   * a real provider is active or pending, or the user acknowledged no-auth.
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

  /** True when this visit holds unsaved state; shows Revert, which discards it all. */
  private _hasUnsavedChanges = Computed.create<boolean>(this, use =>
    use(this._draftConfigs).size > 0 || use(this._draftActiveProvider) !== null);

  private _hasNoAuthChosen = Computed.create<boolean>(this, use =>
    (use(this._draftActiveProvider) === FALLBACK_PROVIDER_KEY));

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

  private _getgristLoginOwner = Computed.create(
    this, this._providers, this._draftConfigs,
    (_use, providers, draftConfigs) => {
      const draftSecret = draftConfigs.get(GETGRIST_COM_PROVIDER_KEY)?.GRIST_GETGRISTCOM_SECRET;
      const draftOwner = draftSecret ? getGetGristComKeyOwner(draftSecret) : null;
      if (draftOwner) { return draftOwner; }

      const getgristLogin = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);
      return getgristLogin?.metadata?.owner ?? null;
    },
  );

  // Set by apply() to communicate to afterApply() whether the restart it just
  // triggered will kill the operator's session, in which case afterApply
  // redirects through sign-in.
  private _willInvalidateSession = false;

  constructor(private _options: AuthenticationSectionOptions) {
    super();

    this.hasConfiguredAuth = Computed.create(this, (use) => {
      if (use(this._hasActiveOnRestartProvider)) { return true; }
      const providers = use(this._displayProviders);
      if (providers.some(p => p.isActive && isRealProvider(p.key))) { return true; }
      const loginSystemId = use(this._loginSystemId);
      return !!loginSystemId && isRealProvider(loginSystemId);
    });

    this.canProceed = Computed.create(this, this._hasNoAuthChosen, this.hasConfiguredAuth,
      (use, hasNoAuthChosen, hasConfiguredAuth) => hasNoAuthChosen || hasConfiguredAuth);

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
    // Decide once, up front, whether the upcoming restart will kill the
    // operator's session: any provider draft sets `onRestartClearSessions`
    // server-side (configureProvider / setActiveAuthProvider), and a queued
    // admin-email change is staged with the same flag (see _setInstallAdmin).
    const draftConfigs = this._draftConfigs.get();
    const activeChoice = this._draftActiveProvider.get();
    const prefs = this._prefsPendingChanges.get();
    this._willInvalidateSession =
      draftConfigs.size > 0 ||
      activeChoice !== null ||
      Boolean(prefs?.onRestartSetAdminEmail) ||
      Boolean(prefs?.onRestartReplaceEmailWithAdmin);

    for (const [providerKey, config] of draftConfigs) {
      await this._configAPI.configureProvider(providerKey, config);
      this._updateDraftConfigs(draft => draft.delete(providerKey));
      this._recentlyConfigured.add(providerKey);
    }

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
   * When the upcoming restart will invalidate the operator's session
   * (provider config/switch, or a queued admin transfer), redirect
   * through sign-in once the manager has restarted -- the API would 401
   * anyway, and in the Quick Setup wizard the operator needs to come
   * back as the new admin to reach the next step. Returning
   * `{ redirected: true }` tells the manager and its caller to skip
   * any post-apply work. When nothing session-clearing applied, we let
   * the manager continue with its normal post-apply.
   */
  public async afterApply(): Promise<ApplyResult> {
    if (this.isDisposed()) { return; }
    if (!this._willInvalidateSession) { return; }
    // A boot-key session is kept across the restart, so the operator may well still be
    // signed in and able to carry on. Ask the server rather than assume: the session is
    // also kept when it no longer belongs to the admin (after an admin transfer), and
    // then signing in again is the only way forward.
    if (await this._isStillInstallAdmin()) { return; }
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
      this._inAdminPanel ? null : cssAuthIntro(
        t("Choose how people sign in. You can change this anytime after setup."),
      ),
      dom.domComputed((use) => {
        const providers = use(this._displayProviders);
        const loginSystemId = use(this._loginSystemId);
        return this._buildSection(providers, use(this._hasNoAuthChosen), loginSystemId);
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

  /** Whether the restarted server still accepts this session as the install admin. */
  private async _isStillInstallAdmin(): Promise<boolean> {
    try {
      const { user } = await this._appModel.api.getSessionActive();
      return Boolean(user.isInstallAdmin);
    } catch (err) {
      // An unreachable or rejected session is the case sign-in exists for.
      return false;
    }
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

  private _buildSection(providers: AuthProvider[], noAuthChosen: boolean, loginSystemId?: string) {
    const activeGetgrist = providers.find(p =>
      p.key === GETGRIST_COM_PROVIDER_KEY && (p.isActive || p.willBeActive),
    );
    const getgrist = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);

    return buildAuthSection(providers, {
      adminEmail: this._currentUserEmail,
      onChangeAdmin: () => this._showChangeAdminModal(),
      onReconfigure: activeGetgrist ? () => this._configureProvider(activeGetgrist) : undefined,
      revertButton: () => maybeRevertButton(this._hasUnsavedChanges, () => this._revertChoice()),
      onConfigureRecommended: getgrist ? () => this._configureProvider(getgrist) : undefined,
      onActivateRecommended: getgrist ? () => this._setActiveProvider(getgrist) : undefined,
      onSetActive: p => this._setActiveProvider(p),
      onConfigure: p => this._configureProvider(p),
      onChooseNoAuth: () => this._chooseNoAuth(),
      recentlyConfigured: this._recentlyConfigured,
      loginSystemId,
      inAdminPanel: this._inAdminPanel,
      noAuthChosen,
    });
  }

  private _buildAuthenticationChangeWarning() {
    return cssWell(
      dom.style("margin-top", "16px"),
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
          testId("change-warning-content"),
        ),
        dom.domComputed((use) => {
          const prefs = use(this._prefsPendingChanges);
          if (prefs?.onRestartSetAdminEmail) {
            return bigBasicButton(
              t("Revert change of admin user"),
              dom.style("margin-top", "16px"),
              dom.on("click", () => this._revertSetInstallAdmin()),
              testId("revert-change-admin"),
            );
          } else {
            return bigPrimaryButton(
              t("Change admin user"),
              dom.style("margin-top", "16px"),
              dom.on("click", () => this._showChangeAdminModal()),
              testId("change-admin"),
            );
          }
        }),
      ),
    );
  }

  /**
   * Discard this visit's unsaved state -- selection, acknowledgement, configuration
   * drafts -- exactly as reloading the page would. Never touches the server.
   */
  private _revertChoice() {
    this._draftActiveProvider.set(null);
    this._draftConfigs.set(new Map());
    this._recentlyConfigured.clear();
  }

  /**
   * Choosing the no-auth card: stage the fallback as this visit's selection, to be
   * saved on apply like any other choice. The acknowledgement modal runs first, once
   * per page load. A no-op when no-auth is already the staged choice.
   */
  private _chooseNoAuth() {
    if (this._draftActiveProvider.get() !== FALLBACK_PROVIDER_KEY) {
      confirmNoAuthAcknowledgement(() => { this._draftActiveProvider.set(FALLBACK_PROVIDER_KEY); });
    }
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
        // Configuring means choosing: the staged configuration always travels with a
        // staged selection, so applying can never save a configuration that boot would
        // then pick up without an explicitly saved choice.
        this._draftActiveProvider.set(GETGRIST_COM_PROVIDER_KEY);
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

  private _showChangeAdminModal() {
    const currentUserEmail = this._appModel.currentValidUser?.email;
    if (!currentUserEmail) {
      throw new Error("Current user is not defined");
    }

    saveModal((_ctl, owner) => {
      const changeAdminModal = ChangeAdminModal.create(owner, {
        currentUserEmail,
        installAPI: this._installAPI,
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
    // The operator is handing off admin, so their current session needs
    // to die at the upcoming restart. Otherwise they reload as a stripped
    // -of-admin ghost (or, in the Quick Setup wizard, can't reach the
    // next step at all). Mirrors what configureProvider /
    // setActiveAuthProvider already do server-side.
    await this._installAPI.updateInstallPrefs({
      onRestartSetAdminEmail: email,
      onRestartReplaceEmailWithAdmin,
      onRestartClearSessions: true,
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
  /** A security caveat worth flagging when this method is chosen (card + activate modal). */
  caveat?: string;
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
      caveat: t("Only your reverse proxy should be able to reach the Grist backend directly, \
or users could bypass sign-in."),
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
// Rendering functions for auth UI elements: pure functions of the provider
// list and an AuthSectionContext assembled by AuthenticationSection.
// =========================================================================

export interface AuthSectionContext {
  adminEmail: string;
  onChangeAdmin?: () => void;
  onReconfigure?: () => void;
  revertButton: () => DomContents,
  /** Configure the recommended method (getgrist.com), from the wizard's recommendation hero. */
  onConfigureRecommended?: () => void;
  /** Activate the recommended method once it's already configured. */
  onActivateRecommended?: () => void;
  onSetActive?: (provider: AuthProvider) => void;
  onConfigure?: (provider: AuthProvider) => void;
  /** Select the no-auth card: acknowledge, and stage deactivation if a method is pending. */
  onChooseNoAuth?: () => void;
  /** Providers configured this session; suppresses their likely-stale startup errors. */
  recentlyConfigured?: ReadonlySet<string>;
  /** True in the admin panel, false in the setup wizard — picks the nothing-configured hero
   * and collapses "Other methods" once a valid method is active. */
  inAdminPanel?: boolean;
  /** The admin explicitly acknowledged no-auth — show the no-auth hero as their choice. */
  noAuthChosen?: boolean;
  /** From the boot probe: the login system actually running (distinguishes boot-key no-auth). */
  loginSystemId?: string;
}

/**
 * Assembles the complete auth section: hero card + provider list.
 * Single code path shared by the live admin panel and the Storybook preview.
 */
export function buildAuthSection(
  providers: AuthProvider[],
  ctx: AuthSectionContext,
): DomContents {
  const pending = providers.find(p => p.willBeActive && isRealProvider(p.key));
  const switchingFrom = providers.find(p => p.willBeDisabled && isRealProvider(p.key));
  const active = providers.find(p => p.isActive && isRealProvider(p.key) && !p.willBeDisabled);
  let hero = pending || active;

  // getgrist.com stops being "the recommendation" once a real method is active or pending
  // in good standing (no error, not an activation-key-less SSO). A staged method is held to
  // the same standard: an SSO that cannot sign anyone in must not hide the alternatives.
  const inGoodStanding = (p: AuthProvider) =>
    !getVisibleError(p, ctx.recentlyConfigured) && !isMissingRequiredKey(p);
  const hasValidAuth = Boolean(
    (pending && inGoodStanding(pending)) || (active && inGoodStanding(active)));

  // In the wizard, if nothing else takes the hero spot, show our getgrist.com recommendation.
  const showRec = !ctx.inAdminPanel && !hero && !switchingFrom && !ctx.noAuthChosen;
  if (!hero && showRec) {
    hero = providers.find(p => p.key === GETGRIST_COM_PROVIDER_KEY);
  }

  const heroCard = () => {
    if (!hero) { return buildNoAuthHero(ctx, switchingFrom); }
    if (showRec) { return buildRecommendedCard(hero, ctx); }
    return buildHeroCard(hero, ctx, switchingFrom);
  };
  const otherProviders = providers.filter(p => (p !== hero));
  return dom("div",
    heroCard(),
    buildProviderList(otherProviders, ctx, { hasValidAuth, includeNoAuth: Boolean(hero) }),
  );
}

/**
 * Returns the effective error text for a provider, suppressing stale
 * `activeError` values that came from a previous server startup.
 */
function getVisibleError(
  provider: AuthProvider,
  recentlyConfigured?: ReadonlySet<string>,
): string | undefined {
  if (provider.configError) { return provider.configError; }
  // Suppress activeError when it's likely stale.
  if (!provider.activeError) { return undefined; }
  if (recentlyConfigured?.has(provider.key)) { return undefined; }
  if (provider.willBeActive && !provider.isActive) { return undefined; }
  return provider.activeError;
}

/** One description per method, shared by the card and the hero. */
function descriptionOf(provider: AuthProvider): string {
  return provider.key === GETGRIST_COM_PROVIDER_KEY ?
    getGristComProviderMeta().recommendedHint : getProviderMeta(provider).description;
}

/** The standard warning well inside the hero body: warning icon + a <p> of the given content. */
function heroWarnWell(testIdName: string, ...content: DomElementArg[]): HTMLElement {
  return cssHeroWell(cssWell.cls("-warning"),
    cssIconWrapper(icon("Warning")),
    cssWellContent(dom("p", ...content)),
    testId(testIdName),
  );
}

function buildHeroAdminRow(ctx: AuthSectionContext) {
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

/** The wizard's recommendation hero: getgrist.com with a Configure (or Activate) call to action. */
function buildRecommendedCard(
  provider: AuthProvider,
  ctx: AuthSectionContext,
): HTMLElement {
  const cta = () => {
    // Once the recommended method is configured, the call to action becomes Activate.
    const ready = Boolean(provider.isConfigured && !provider.willBeActive);
    if (ready && ctx.onActivateRecommended) {
      return bigPrimaryButton(t("Activate"), dom.on("click", ctx.onActivateRecommended), testId("hero-activate"));
    } else if (ctx.onConfigureRecommended) {
      return bigPrimaryButton(t("Configure"), dom.on("click", ctx.onConfigureRecommended), testId("hero-configure"));
    }
  };

  return buildHeroCardCommon({
    ...ctx,
    itemRadio: buildItemRadio({ checked: false }),
    itemContent: buildItemContent({
      header: provider.name,
      badges: (provider.isConfigured ?
        buildBadge(t("Configured"), "grey", testId("configured-tag")) :
        buildBadge(getGristComProviderMeta().recommendedBadge, "accent", testId("badge-recommended"))
      ),
      text: descriptionOf(provider),
      extra: cssHeroActions(cta()),
    }),
  });
}

function maybeRevertButton(showRevert: Observable<boolean>, onRevert: () => void) {
  return dom.maybe(showRevert, () =>
    basicButton(t("Revert"), dom.on("click", onRevert), testId("hero-revert")));
}

/**
 * Hero for the active or becoming-active method: the same card layout as a method card
 * (check glyph + name + chips + description) in an accent frame, plus any error or
 * activation-key warning, an action button, and the admin row. A staged switch names the
 * outgoing method (`switchingFrom`) in a "Was: …" lead-in.
 */
function buildHeroCard(
  provider: AuthProvider, ctx: AuthSectionContext, switchingFrom?: AuthProvider,
): HTMLElement {
  const pending = Boolean(provider.willBeActive);
  const error = getVisibleError(provider, ctx.recentlyConfigured);

  const name = () => {
    if (!pending) { return provider.name; }
    if (switchingFrom) { return t("Switch to: {{name}}", { name: provider.name }); }
    return t("Activate: {{name}}", { name: provider.name });
  };

  const statusBadge = () => {
    if (error) { return buildBadge(t("Error"), "error", testId("badge-error")); }
    if (pending) { return buildBadge(t("Active on restart"), "pending", testId("badge-active-on-restart")); }
    return buildBadge(t("Active"), "primary", testId("badge-active"));
  };

  const descText = () => {
    if (error) { return t("Authentication is misconfigured or unreachable. Users may not be able to sign in."); }
    if (pending) { return descriptionOf(provider); }
    return getProviderMeta(provider).heroDesc || descriptionOf(provider);
  };

  // An active SSO method with no activation key is outside the supported set: flag it
  // with a chip and a warning well linking to the key-request modal.
  const missingKey = isMissingRequiredKey(provider);

  // A method's security caveat is a setup-time reminder, shown while it is staged.
  const caveat = pending ? getProviderMeta(provider).caveat : undefined;

  return buildHeroCardCommon({
    ...ctx,
    switchingFrom,
    itemRadio: buildItemRadio({ checked: true, disabled: pending }),
    itemContent: buildItemContent({
      header: name(),
      badges: statusBadge(),
      rightBadges: missingKey ? buildBadge(t("Missing activation key"), "warning", testId("missing-key")) : null,
      text: descText(),
      extra: [
        error ? cssItemError(error, testId("hero-error")) : null,
        caveat ? heroWarnWell("caveat", caveat) : null,
        missingKey ? heroWarnWell("hero-unsupported",
          t(`{{name}} is active but is outside the supported set without a Full Grist activation key. `,
            { name: provider.name }),
          cssAddressLink(t("Address this."),
            dom.on("click", () => showKeyRequestModal(provider, { email: ctx.adminEmail, omitMeanwhile: true })),
            testId("hero-address-unsupported")),
        ) : null,
        cssHeroActions(pending ? ctx.revertButton() :
          // For a steady state, allow "Reconfigure" button.
          (ctx.onReconfigure ?
            basicButton(t("Reconfigure"), dom.on("click", ctx.onReconfigure), testId("hero-reconfigure")) :
            null
          ),
        ),
      ],
    }),
  });
}

function buildHeroCardCommon(ctx: AuthSectionContext & {
  switchingFrom?: AuthProvider,
  itemRadio: DomContents,
  itemContent: DomContents,
}) {
  return cssHero(
    testId("hero-card"),
    ctx.switchingFrom ? cssHeroWasLine(t("Was: {{name}}", { name: ctx.switchingFrom.name })) : null,
    cssHeroTop(ctx.itemRadio, ctx.itemContent),
    buildHeroAdminRow(ctx),
  );
}

/**
 * Hero when no method is, or will be, active: the amber no-auth warning. Revert shows
 * when this visit holds unsaved choices to discard (a staged deactivation also adds
 * the "Was: …" lead-in).
 */
function buildNoAuthHero(ctx: AuthSectionContext, switchingFrom?: AuthProvider): HTMLElement {
  const bootKey = !switchingFrom && ctx.loginSystemId === BOOT_KEY_PROVIDER_KEY;
  const descText = bootKey ?
    t(`Your server is using a boot key as a fallback login method. \
Configure one of the authentication methods below.`) :
    t(`Anyone who can reach this server can access all data without signing in. \
Choose a sign-in method below.`);

  return buildHeroCardCommon({
    ...ctx,
    switchingFrom,
    itemRadio: buildItemRadio({ checked: true, disabled: true }),
    itemContent: buildItemContent({
      header: bootKey ? t("No authentication: using boot key") : t("No authentication"),
      rightBadges: [
        cssHeroWarnIcon(icon("Warning")),
        buildBadge(t("Not recommended"), "warning", testId("badge-warning")),
      ],
      text: descText,
      extra: cssHeroActions(ctx.revertButton()),
    }),
  });
}

/**
 * A method as a full card in the expanded ("change") view: status circle, name + chips,
 * description. The whole card is the click target, forking by state — configured → activate,
 * SSO missing its key → the activation-key modal, unconfigured → configure. Hover highlights the border.
 */
function buildProviderCard(
  provider: AuthProvider, ctx: AuthSectionContext, hasValidAuth: boolean,
): HTMLElement {
  const needsKey = isMissingRequiredKey(provider) &&
    !(provider.isActive || provider.willBeActive || provider.isSelectedByEnv);
  const isGetgrist = provider.key === GETGRIST_COM_PROVIDER_KEY;
  const error = getVisibleError(provider, ctx.recentlyConfigured);
  const pendingChange = provider.isActive || provider.willBeActive || provider.willBeDisabled;
  const selectable = Boolean(provider.isConfigured && !needsKey && !pendingChange);
  const onClick =
    provider.isActive || provider.willBeActive ? undefined :
      selectable ? () => ctx.onSetActive?.(provider) :
        needsKey ? () => showKeyRequestModal(provider, { email: ctx.adminEmail }) :
          () => ctx.onConfigure?.(provider);

  const badges: DomContents = [
    isGetgrist && !pendingChange && !hasValidAuth ?
      buildBadge(getGristComProviderMeta().recommendedBadge, "accent", testId("badge-recommended")) : null,
    provider.isActive ? buildBadge(t("Active"), "primary", testId("badge-active")) : null,
    provider.willBeActive ?
      buildBadge(t("Active on restart"), "pending", testId("badge-active-on-restart")) : null,
    provider.willBeDisabled ?
      buildBadge(t("Disabled on restart"), "pending", testId("badge-disabled-on-restart")) : null,
  ];

  const rightBadges: DomContents = [
    selectable ? buildBadge(t("Configured"), "grey", testId("configured-tag")) : null,
    needsKey ? buildBadge(t("Requires activation key"), "warning", testId("requires-key")) : null,
  ];

  return buildItemCard({
    radio: {
      checked: Boolean(provider.isActive || provider.willBeActive),
      disabled: Boolean(provider.willBeActive || provider.willBeDisabled || needsKey),
    },
    onClick,
    header: provider.name,
    badges,
    rightBadges,
    text: descriptionOf(provider),
    extra: [
      error ? cssItemError(error, testId("error-message")) : null,
      provider.isSelectedByEnv ? cssItemInfo(
        t("Active method is controlled by an environment variable. Unset variable to change active method."),
        testId("env-note")) : null,
    ],
    args: [testId(`provider-row-${provider.key.replace(".", "-")}`), testId("provider-row")],
  });
}

/**
 * No authentication as a card in the expanded view: an option, but muted — a plain
 * background, no accent. It's an alternative to pick, not the current state (no-auth is the
 * current state only as the hero), so its radio is always the empty "available" circle.
 * Clicking runs the acknowledgement and stages deactivation of the active method.
 */
function buildNoAuthCard(ctx: AuthSectionContext): HTMLElement {
  return buildItemCard({
    muted: true,
    onClick: () => ctx.onChooseNoAuth?.(),
    radio: { checked: false },
    header: t("No authentication"),
    text: t("Anyone can access all data without signing in. Only suitable for \
private networks and temporary setups."),
    args: [testId("provider-row"), testId("provider-row-no-auth")],
  });
}

/**
 * The "Other methods" list: a full card per method, plus no-auth as a muted last resort
 * when `includeNoAuth`. Deprecated providers are hidden unless configured or active. The
 * wizard shows the list open; the admin panel collapses it once a valid method is active.
 */
function buildProviderList(
  providers: AuthProvider[],
  ctx: AuthSectionContext,
  opts: { hasValidAuth: boolean, includeNoAuth: boolean },
): DomContents {
  const visible = providers.filter(p =>
    !DEPRECATED_PROVIDERS.includes(p.key) || p.isConfigured || p.isActive,
  );
  if (visible.length === 0 && !opts.includeNoAuth) { return null; }
  return cssOthersGroup(buildCardList({
    header: t("Other methods"),
    collapsible: ctx.inAdminPanel,
    initiallyCollapsed: opts.hasValidAuth,
    items: [
      ...visible.map(p => buildProviderCard(p, ctx, opts.hasValidAuth)),
      ...(opts.includeNoAuth ? [buildNoAuthCard(ctx)] : []),
    ],
    args: [testId("provider-list-header")],
  }));
}

/**
 * The activation-key modal has two jobs, in any order: get the key request started (with the
 * Installation ID the form requires), and reassure the user that finishing setup with an
 * interim sign-in method is the right move while the key is in the mail.
 */
function showKeyRequestModal(
  provider: AuthProvider,
  opts: { email?: string, omitMeanwhile?: boolean } = {},
) {
  const installationId = getAdminConfig().installationId;
  // The request-activation-key redirect passes these prefill params through to the form
  // (FormRenderer reads `?<colId>=value`). With the ID prefilled, it can stay behind a
  // reveal — it's only needed by someone who reaches the form another way (e.g. via the
  // learn-more FAQ).
  const params = new URLSearchParams({
    ...(opts.email ? { Email: opts.email } : {}),
    ...(installationId ? { Installation_ID: installationId } : {}),
  });
  const formUrl = commonUrls.activationKeyRequestForm + (String(params) ? `?${params}` : "");
  return modal((ctl, owner) => {
    const showId = Observable.create(owner, false);
    return [
      cssModalWidth("fixed-wide"),
      cssModalHeader(
        dom("span", t("{{name}} requires an activation key", { name: provider.name })),
        testId("key-modal"),
      ),
      cssModalDescription(
        dom("p", cssMarkdownSpan(
          t("Single sign-on with **OIDC** or **SAML** is officially supported in the full \
Grist edition, and requires an activation key — see [pricing]({{pricingLink}}). Individuals \
and small organizations may request a [free Grist activation key]({{faqLink}}).",
          { pricingLink: commonUrls.plansSelfManaged, faqLink: commonUrls.freeActivationKeyFaq }))),
        cssKeyModalBlock(
          cssKeyModalBlockTitle(t("Start your key request")),
          dom("p", t("You will receive an email response, typically within 5 business days. \
Your key will be tied to this installation.")),
          cssKeyModalCtaRow(
            bigPrimaryButtonLink(
              t("Request activation key"),
              { href: formUrl, target: "_blank" },
              testId("request-key"),
            ),
            textButton(
              dom.text(use => use(showId) ? t("Hide installation ID") : t("Show installation ID")),
              dom.on("click", () => showId.set(!showId.get())),
              testId("toggle-installation-id"),
            ),
          ),
          dom.maybe(showId, () => buildInstallationIdBlock()),
        ),
        opts.omitMeanwhile ? null : cssKeyModalBlock(
          cssKeyModalBlockTitle(t("Meanwhile, finish setting up")),
          dom("p", t("Pick a supported sign-in method that works today: Sign in with \
getgrist.com (simple and recommended), Forwarded headers (for reverse proxy setups), or \
continue without authentication for now.")),
          dom("p", cssMarkdownSpan(
            t("When your key arrives, enter it in the **Edition** section, then switch to \
**{{name}}** here.", { name: provider.name }))),
        ),
      ),
      cssModalButtons(
        bigBasicButtonLink(
          t("I have a key"),
          { href: urlState().makeUrl({ adminPanel: "admin", hash: { anchor: ADMIN_PANEL_EDITION_ANCHOR } }) },
          // From the admin panel this is same-page hash navigation, which doesn't
          // reload the page, so the modal must close itself.
          dom.on("click", () => ctl.close()),
          testId("key-modal-go-edition"),
        ),
        bigBasicButton(
          t("Close"),
          dom.on("click", () => ctl.close()),
          testId("key-modal-close"),
        ),
      ),
    ];
  });
}

const cssKeyModalBlock = styled("div", `
  border: 1px solid ${theme.menuBorder};
  border-radius: 8px;
  padding: 12px 16px;
  margin: 12px 0;
`);

const cssKeyModalCtaRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`);

const cssKeyModalBlockTitle = styled("div", `
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 4px;
`);

const cssHeroAdminRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${theme.menuBorder};
  font-size: ${vars.mediumFontSize};
`);

// The caveat well inside the hero body — a top margin separates it from the description.
const cssHeroWell = styled(cssWell, `
  margin-top: 8px;
`);

const cssHeroWarnIcon = styled("div", `
  flex: none;
  --icon-color: #ffb535;
  display: flex;
  align-items: center;
`);

// The hero reuses the card's layout: a full 2px border (green — it frames the active
// selection) and the same radio + body row as a method card, with actions/admin tacked on.
const cssHero = styled(cssHeroCard, `
  border: 2px solid ${theme.controlPrimaryBg};
`);

const cssHeroTop = styled("div", `
  display: flex;
  gap: 12px;
`);

// "Was: …" lead-in above the name; padded to line up with the name, distinguished by color.
const cssHeroWasLine = styled("div", `
  padding-left: 28px;
  margin-bottom: 4px;
  color: ${theme.lightText};
  font-weight: 600;
`);

// An inline "Address this." link inside the unsupported-SSO well; opens the address-it modal.
const cssAddressLink = styled("span", `
  color: ${theme.controlFg};
  cursor: pointer;
  text-decoration: underline;
`);

const cssAuthIntro = styled("div", `
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;
  margin-bottom: 20px;
`);

const cssNoAuthCheckbox = styled("div", `
  margin-top: 12px;
`);

const cssOthersGroup = styled("div", `
  margin-top: 20px;
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
