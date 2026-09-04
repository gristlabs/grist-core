import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { getHomeUrl } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { ConfigSection, DraftChangesManager } from "app/client/ui/DraftChanges";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { buildBadge, buildCardList, buildHeroCard, buildItemCard, cssHeroActions } from "app/client/ui/SetupCard";
import { basicButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { BootProbeIds } from "app/common/BootProbe";
import { waitGrainObs } from "app/common/gutil";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { SandboxInfo, SandboxingStatus } from "app/common/SandboxInfo";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled, UseCB, UseCBOwner } from "grainjs";

const t = makeT("SandboxSection");
const testId = makeTestId("test-sandbox-section-");

export const SANDBOX_PROBE_ID: BootProbeIds = "sandbox-providers";

/**
 * Sandbox configuration section for QuickSetup. Fetches available sandbox
 * options through the shared {@link AdminChecks} (so the probe result is
 * memoized and can be pre-warmed by the wizard), shows them as cards, and
 * lets the user pick one. Conforms to {@link QuickSetupSection} by
 * delegating dirty/apply/restart through a {@link DraftChangesManager}
 * with a single registered {@link ConfigSection} adapter for the sandbox
 * flavor pref. This keeps the apply pipeline (persist + restart + wait,
 * with shared failure handling) the same as the Server step.
 */
export class SandboxSetupSection extends Disposable {
  public readonly canProceed: Computed<boolean>;
  public readonly isDirty: Computed<boolean>;
  public readonly isApplying: Observable<boolean>;

  private _installAPI = new InstallAPIImpl(getHomeUrl());
  // Data read from the server.
  private _model = Observable.create<SandboxingStatus | null>(this, null);
  // If there was error loading or saving.
  private _error = Observable.create<string>(this, "");
  // Observable for user selection.
  private _selected = Observable.create<string | null>(this, null);

  /** True when a different flavor is selected than what's currently active and not env-locked. */
  private readonly _needsRestart: Computed<boolean> =
    Computed.create(this, this._model, this._selected, (_, model, selected) => {
      if (model?.flavorInEnv) { return false; }
      return !!selected && selected !== model?.current;
    });

  private readonly _drafts = DraftChangesManager.create(this);
  private readonly _draftSection: ConfigSection = {
    isDirty: this._needsRestart,
    needsRestart: true,
    apply: () => this._save(),
    // Re-probe the restarted server so the step shows the flavor now running,
    // not the session-cached pre-restart state.
    afterApply: () => this._refresh(),
    describeChange: Computed.create(this, use =>
      [{ label: t("Sandbox"), value: sandboxLabel(use(this._selected) ?? "") }],
    ),
  };

  constructor(private _checks: AdminChecks, private _options: { inAdminPanel?: boolean } = {}) {
    super();
    this._drafts.addSection(this._draftSection);
    // Env-locked installs have nothing to choose (every radio is disabled), so the
    // step is passable as-is; otherwise proceeding takes an explicit selection.
    this.canProceed = Computed.create(this, this._model, this._selected,
      (_, model, s) => !!model?.flavorInEnv || !!s);
    this.isDirty = this._drafts.hasDraftChanges;
    this.isApplying = this._drafts.isApplying;
    this._loadStatus().catch((e) => {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    });
  }

  /** The ConfigSection adapter, for registering with an embedder's DraftChangesManager. */
  public get draftSection(): ConfigSection { return this._draftSection; }

  public buildDom(): DomContents {
    return dom("div",
      testId("sandboxing"),
      dom.maybe(this._error, err => cssError(err)),
      dom.domComputed(this._model, (s) => {
        if (!s) { return cssLoading(loadingSpinner(), t("Detecting sandbox options...")); }
        return dom("div", this._buildContent(s));
      }),
    );
  }

  public async apply(): Promise<void> {
    await this._drafts.applyAll();
  }

  /** Returns "Skip and Continue" when env-locked; otherwise null to use shared defaults. */
  public customLabel(use: UseCBOwner): string | null {
    return use(this._model)?.flavorInEnv ? t("Skip and Continue") : null;
  }

  private _isLockedByEnv() {
    return !!this._model.get()?.flavorInEnv;
  }

  /** Drop any cached probe result and re-read status from the server. */
  private async _refresh() {
    await this._checks.reloadChecks();
    await this._loadStatus();
  }

  /**
   * Revert a saved unsandboxed choice, unsetting it so the install returns to
   * the unconfigured state (no restart needed -- nothing running changes).
   */
  private async _revertChoice() {
    await this._installAPI.updateInstallPrefs({ envVars: { GRIST_SANDBOX_FLAVOR: null } });
    if (this.isDisposed()) { return; }
    await this._refresh();
  }

  private async _save() {
    const flavor = this._selected.get();
    const isSelectedByEnv = this._isLockedByEnv();
    if (flavor && !isSelectedByEnv) {
      try {
        await this._installAPI.updateInstallPrefs({ envVars: { GRIST_SANDBOX_FLAVOR: flavor } });
      } catch (e) {
        this._error.set(String(e));
        throw e;
      }
    }
  }

  private async _fetchSandboxingStatus(): Promise<SandboxingStatus> {
    // The host fetches the probe list asynchronously; wait for it rather than
    // racing it (the admin panel constructs this section before the fetch lands).
    const probes = await waitGrainObs(this._checks.probes, ps => ps.length > 0);
    const probe = probes.find(p => p.id === SANDBOX_PROBE_ID);
    if (!probe) { throw new Error(`${SANDBOX_PROBE_ID} probe not available`); }
    const req = this._checks.requestCheck(probe);
    const result = await waitGrainObs(req.result, r => r.status !== "none");
    if (result.status === "fault") { throw new Error(result.details?.error ?? "probe failed"); }
    return result.details as SandboxingStatus;
  }

  private async _loadStatus() {
    const status = await this._fetchSandboxingStatus();
    const model = sortedByPreference(status);
    if (this.isDisposed()) { return; }

    this._model.set(model);

    // The initial selection: normally the configured sandbox. If 'unsandboxed' is configured,
    // show it in the admin panel, but not in the wizard -- have the user make that choice again.
    let selection: string | null = null;
    const unsandboxedConfigured = isUnsandboxedConfigured(model);
    if (isRealConfigured(model) || (unsandboxedConfigured && this._options.inAdminPanel)) {
      selection = model.current || null;
    } else if (!unsandboxedConfigured && !this._options.inAdminPanel) {
      // In wizard, with no explicit configuration (not even 'unsandboxed'), select the
      // recommended sandbox, so that "Continue" applies that one.
      selection = model.options.find(o => o.functional && o.effective)?.flavor ?? null;
    }
    this._selected.set(selection);

    function sortedByPreference(status: SandboxingStatus): SandboxingStatus {
      const goodOnes = status.options.filter(o => o.functional && o.effective);

      goodOnes.sort((a, b) => {
        const order = ["gvisor", "macSandboxExec", "pyodide", "unsandboxed"];
        return order.indexOf(a.flavor) - order.indexOf(b.flavor);
      });

      const sortedOptions = [
        ...goodOnes,
        ...status.options.filter(o => o.functional && !o.effective),
        ...status.options.filter(o => !o.functional),
      ];
      return { ...status, options: sortedOptions };
    }
  }

  private _buildContent(status: SandboxingStatus): DomContents {
    const { current } = status;
    const isLockedByEnv = this._isLockedByEnv();

    // The recommended option: the best functional and effective one, if any.
    // (status.options is already sorted by preference in _loadStatus.)
    const options = status.options;
    const recommended = options.find(o => o.functional && o.effective);

    // The hero: the admin panel (state surface) leads with the running flavor;
    // the wizard (guidance surface) leads with it only when it's a real one --
    // over a fallback, chosen or not, the wizard re-offers the recommendation.
    const configured = isRealConfigured(status) || isUnsandboxedConfigured(status);
    const heroCurrent = current !== "unknown" &&
      (this._options.inAdminPanel || current !== "unsandboxed");
    const heroOption = (heroCurrent && options.find(o => o.flavor === current)) || recommended || options[0];

    // "No sandbox" renders as a muted last-resort card at the end of the list,
    // as Auth's no-auth does; the sorted alternatives come first.
    const otherOptions = [
      ...options.filter(o => o !== heroOption && o.flavor !== "unsandboxed"),
      ...options.filter(o => o !== heroOption && o.flavor === "unsandboxed"),
    ];

    const canSelect = (opt: SandboxInfo) => opt.available && opt.functional !== false;

    const badgesFor = (opt: SandboxInfo) => {
      const recommendedBadge: DomContents[] = opt === recommended ?
        [buildBadge(t("Recommended"), "accent")] : [];
      // "Active" marks a configured answer; a fallback nobody chose stays quiet.
      if (opt.flavor === current && opt.functional && configured) {
        return [...recommendedBadge, buildBadge(t("Active"), "primary")];
      }
      if (!opt.available) {
        return buildBadge(t("Not available"), "warning");
      }
      if (!opt.functional) {
        return buildBadge(t("Error"), "error");
      }
      if (!opt.effective) {
        return [];  // Its "Not recommended" chip is right-aligned (see rightBadges).
      }
      return [...recommendedBadge, buildBadge(t("Ready"), "primary")];
    };

    // Ineffective-but-working flavors carry "Not recommended" pushed right, as in Auth.
    const rightBadgesFor = (opt: SandboxInfo) =>
      (!opt.effective && opt.available && opt.functional) ?
        buildBadge(t("Not recommended"), "warning") : null;

    const makeRadio = (key: string, disabled?: boolean) => ({
      checked: (use: UseCB) => use(this._selected) === key,
      onSelect: () => { if (!isLockedByEnv) { this._selected.set(key); } },
      disabled: disabled || isLockedByEnv,
    });

    return dom("div",
      // The admin panel's section row carries its own name and description.
      this._options.inAdminPanel ? null : quickSetupStepHeader({
        icon: "Lock",
        title: t("Sandboxing"),
        description: t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
          "to protect your server. Without it, document formulas can access the full system."),
      }),

      isLockedByEnv ? cssEnvWarning(
        t("Sandbox type is set via the GRIST_SANDBOX_FLAVOR environment variable " +
          "and cannot be changed here. Remove the variable and restart to configure via this wizard."),
        testId("env-warning"),
      ) : null,

      buildHeroCard({
        indicator: (use: UseCB) =>
          use(this._selected) === heroOption.flavor ?
            (heroOption.effective ? "active" : "warning") : undefined,
        radio: makeRadio(heroOption.flavor, !canSelect(heroOption)),
        header: sandboxLabel(heroOption.flavor),
        badges: badgesFor(heroOption),
        rightBadges: rightBadgesFor(heroOption),
        text: sandboxDescription(heroOption.flavor),
        error: heroOption.functional === false ? (heroOption.error ?? "") : undefined,
        // A saved unsandboxed choice can be taken back, returning to the
        // unconfigured state. A state operation, so it lives on the state
        // surface only; the wizard's way back is picking the recommendation.
        // Hidden when the env var also forces unsandboxed: clearing the saved
        // choice would change nothing after a restart.
        extra: this._options.inAdminPanel && !isLockedByEnv &&
          heroOption.flavor === "unsandboxed" && status.flavorInDB === "unsandboxed" ?
          cssHeroActions(basicButton(t("Revert"),
            dom.on("click", () => this._revertChoice().catch(reportError)),
            testId("revert"))) : null,
        args: [testId(`flavor-${heroOption.flavor}`), testId("flavor-0")],
      }),

      otherOptions.length > 0 ?
        buildCardList({
          // As in Authentication: static in the wizard (choosing is the task);
          // collapsible in the panel, starting collapsed when the state is settled.
          header: t("Other options"),
          collapsible: this._options.inAdminPanel,
          initiallyCollapsed: configured,
          args: [testId("others-header")],
          items: otherOptions.map((opt, i) =>
            buildItemCard({
              // No sandboxing is the muted last resort, as Auth renders no-auth.
              muted: opt.flavor === "unsandboxed",
              indicator: (use: UseCB) => {
                if (use(this._selected) !== opt.flavor) { return undefined; }
                return opt.effective ? "active" : "warning";
              },
              radio: makeRadio(opt.flavor, !canSelect(opt) || isLockedByEnv),
              header: sandboxLabel(opt.flavor),
              badges: badgesFor(opt),
              rightBadges: rightBadgesFor(opt),
              text: sandboxDescription(opt.flavor),
              info: !opt.available ? opt.unavailableReason : undefined,
              error: opt.functional === false ? (opt.error ?? "") : undefined,
              args: [testId(`flavor-${opt.flavor}`), testId(`flavor-${i + 1}`)],
            }),
          ),
        }) :
        null,
    );
  }
}

function isRealConfigured(status: SandboxingStatus): boolean {
  return status.current !== "unknown" && status.current !== "unsandboxed";
}

function isUnsandboxedConfigured(status: SandboxingStatus): boolean {
  return status.current === "unsandboxed" &&
    (status.flavorInEnv === "unsandboxed" || status.flavorInDB === "unsandboxed");
}

function sandboxLabel(flavor: string): string {
  switch (flavor) {
    case "gvisor": return "gVisor";
    case "pyodide": return "Pyodide";
    case "macSandboxExec": return t("macOS sandbox");
    case "unsandboxed": return t("No sandbox");
    default: return flavor;
  }
}

function sandboxDescription(key: string): string {
  switch (key) {
    case "gvisor":
      return t("The fastest and most battle-tested sandbox. " +
        "Each document's formulas run in their own isolated container.");
    case "pyodide":
      return t("Formulas run in WebAssembly, fully compatible but slower than gVisor. " +
        "Works on any platform.");
    case "macSandboxExec":
      return t("Uses the built-in macOS sandbox. Good isolation for local use on a Mac.");
    case "unsandboxed":
      return t("Formulas have full system access. Only appropriate when you trust every " +
        "document and its authors.");
    default:
      return "";
  }
}

const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 32px;
  color: ${theme.lightText};
`);

const cssError = styled("div", `
  border: 2px solid ${theme.toastErrorBg};
  border-radius: 8px;
  color: ${theme.errorText};
  padding: 12px 16px;
  margin-bottom: 16px;
`);

const cssEnvWarning = styled("div", `
  border: 2px solid ${theme.toastWarningBg};
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: ${vars.smallFontSize};
`);
