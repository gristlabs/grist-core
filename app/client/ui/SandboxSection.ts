import { makeT } from "app/client/lib/localization";
import { AdminChecks, probeDetails } from "app/client/models/AdminChecks";
import { getHomeUrl } from "app/client/models/AppModel";
import { cssErrorText, cssHappyText } from "app/client/ui/AdminPanelCss";
import { ConfigSection, DraftChangeDescription } from "app/client/ui/DraftChanges";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssValueLabel } from "app/client/ui/SettingsLayout";
import { BadgeConfig, buildCardList, buildHeroCard, buildItemCard } from "app/client/ui/SetupCard";
import { theme, vars } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { BootProbeIds, SandboxingBootProbeDetails } from "app/common/BootProbe";
import { commonUrls } from "app/common/gristUrls";
import { waitGrainObs } from "app/common/gutil";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { SandboxInfo, SandboxingStatus } from "app/common/SandboxInfo";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled, UseCB, UseCBOwner } from "grainjs";

const t = makeT("SandboxSection");
const testId = makeTestId("test-sandbox-section-");

export const SANDBOX_PROBE_ID: BootProbeIds = "sandbox-providers";

interface SandboxSetupSectionOptions {
  checks: AdminChecks;
  /**
   * True when rendered inside the admin panel; false / absent in the wizard.
   * Suppresses the wizard step header so the section fits inside a
   * SectionItem's expanded-content slot.
   */
  inAdminPanel?: boolean;
}

/**
 * Sandbox configuration section. Used in both the QuickSetup wizard and the
 * Admin Panel. Implements {@link ConfigSection} so the caller registers it
 * with their own {@link DraftChangesManager}, which keeps the apply pipeline
 * (persist + restart + wait, with shared failure handling) the same as the
 * other configurable sections (Auth, Base URL, Edition).
 *
 * The full provider list is loaded lazily via the heavy `sandbox-providers`
 * probe -- spawned only when `buildDom()` runs, so the admin panel's
 * sandboxing row paints fast and only pays for the probe if the admin
 * actually expands it. `buildStatusDisplay()` uses the cheap `sandboxing`
 * probe for the badge.
 */
export class SandboxSetupSection extends Disposable implements ConfigSection {
  public readonly canProceed: Computed<boolean>;
  public readonly isDirty: Computed<boolean>;
  public readonly needsRestart = true;
  public readonly describeChange: Computed<DraftChangeDescription[]>;

  private _checks = this._options.checks;
  private _inAdminPanel = Boolean(this._options.inAdminPanel);
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  // Data read from the server. Loaded lazily on first buildDom().
  private _model = Observable.create<SandboxingStatus | null>(this, null);
  // If there was error loading or saving.
  private _error = Observable.create<string>(this, "");
  // Observable for user selection.
  private _selected = Observable.create<string | null>(this, null);
  // Tracks whether the provider list has been requested yet. The admin
  // panel constructs the section eagerly (it needs isDirty to register
  // with the drafts manager) but we don't want to fire the heavy probe
  // until the user expands the row.
  private _loadStarted = false;

  constructor(private _options: SandboxSetupSectionOptions) {
    super();
    this.isDirty = Computed.create(this, this._model, this._selected, (_, model, selected) => {
      if (model?.flavorInEnv) { return false; }
      return !!selected && selected !== model?.current;
    });
    this.canProceed = Computed.create(this, this._selected, (_, s) => !!s);
    this.describeChange = Computed.create(this, use =>
      [{ label: t("Sandbox"), value: sandboxLabel(use(this._selected) ?? "") }],
    );
  }

  public buildDom(): DomContents {
    this._ensureLoadStarted();
    return dom("div",
      testId("sandboxing"),
      dom.maybe(this._error, err => cssError(err)),
      dom.domComputed(this._model, (s) => {
        if (!s) { return cssLoading(loadingSpinner(), t("Detecting sandbox options...")); }
        return dom("div", this._buildContent(s));
      }),
      this._inAdminPanel ? this._buildAdminPanelFooter() : null,
    );
  }

  /**
   * Compact status display for the admin panel's `SectionItem` value cell.
   * Reads the cheap `sandboxing` probe (current-flavor status only) so it
   * paints fast without triggering the heavy provider enumeration.
   */
  public buildStatusDisplay(): DomContents {
    return dom.domComputed((use) => {
      const req = this._checks.requestCheckById(use, "sandboxing");
      const result = req ? use(req.result) : undefined;
      // AdminChecks initializes the result observable with status "none" and
      // keeps it there until the probe lands -- treat that as "checking",
      // not "unknown" (which would imply the probe answered but with no info).
      const isPending = !result || result.status === "none";
      if (isPending) { return cssValueLabel(t("checking")); }
      const details = result.details as SandboxingBootProbeDetails | undefined;
      if (!details) { return cssValueLabel(t("unknown")); }
      if (!details.configured) {
        return cssValueLabel(cssErrorText(t("unconfigured")));
      }
      const { flavor } = details;
      return cssValueLabel(result.status === "success" ?
        cssHappyText(t("OK") + `: ${flavor}`) :
        cssErrorText(t("Error") + `: ${flavor}`));
    });
  }

  public async apply(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    const flavor = this._selected.get();
    if (!flavor) { return; }
    try {
      await this._installAPI.updateInstallPrefs({ envVars: { GRIST_SANDBOX_FLAVOR: flavor } });
      // Drop `isDirty` -- the chosen flavor is now persisted. The running
      // server still uses the old flavor until restart, but the restart
      // banner is driven by the parent (its `_awaitingManualRestart` flag
      // or `_drafts.needsRestart`), not by us re-reporting dirty.
      const model = this._model.get();
      if (model) { this._model.set({ ...model, current: flavor }); }
    } catch (e) {
      this._error.set(String(e));
      throw e;
    }
  }

  /** Clear the user's pending selection so the row no longer reads as dirty. */
  public async dismiss(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    this._selected.set(this._model.get()?.current ?? null);
  }

  /** Returns "Skip and Continue" when env-locked; otherwise null to use shared defaults. */
  public customLabel(use: UseCBOwner): string | null {
    return use(this._model)?.flavorInEnv ? t("Skip and Continue") : null;
  }

  private _ensureLoadStarted() {
    if (this._loadStarted) { return; }
    this._loadStarted = true;
    this._loadStatus().catch((e) => {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    });
  }

  private _isLockedByEnv() {
    return !!this._model.get()?.flavorInEnv;
  }

  private async _fetchSandboxingStatus(): Promise<SandboxingStatus> {
    const probe = this._checks.probes.get().find(p => p.id === SANDBOX_PROBE_ID);
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
    if (model.flavorInEnv) {
      this._selected.set(model.current ?? "unsandboxed");
    } else if (this._inAdminPanel) {
      // Match the current server state so opening the section in the admin
      // panel doesn't immediately flag a draft change. The user explicitly
      // picks a flavor by clicking a radio. In the wizard we instead
      // pre-select the recommended option because the user got there to
      // configure a sandbox.
      this._selected.set(model.current ?? null);
    } else {
      const best = model.options[0];
      this._selected.set(best.flavor ?? "unsandboxed");
    }
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

    // The recommended sandbox is the first functional and effective option.
    // (status.options is already sorted by preference in _loadStatus.)
    const options = status.options;
    const recommended = options.find(o => o.functional && o.effective)?.flavor;

    // Both the env-locked case and the admin panel show the running flavor
    // as the hero (the user wants to see what's running, not a suggestion
    // to switch). The wizard shows the recommended one, since the operator
    // is being onboarded.
    const showCurrentAsHero = isLockedByEnv || this._inAdminPanel;
    const heroOption = showCurrentAsHero ?
      options.find(o => o.flavor === current) ?? options[0] :
      options.find(o => o.flavor === recommended) ?? options[0];
    const otherOptions = options.filter(o => o !== heroOption);

    const canSelect = (opt: SandboxInfo) => opt.available && opt.functional !== false;

    const badgesFor = (opt: SandboxInfo): BadgeConfig[] => {
      // "Active" wins even when the boot probe couldn't verify functionality
      // (it has a tight test timeout) -- if the server reports a flavor as
      // current, it's actually serving documents with it. Layer Error/Not-
      // recommended on top so the diagnostic still shows.
      const badges: BadgeConfig[] = [];
      if (opt.flavor === current) {
        badges.push({ label: t("Active"), variant: "primary" });
      }
      if (!opt.available) {
        badges.push({ label: t("Not available"), variant: "warning" });
      } else if (opt.functional === false) {
        badges.push({ label: t("Error"), variant: "error" });
      } else if (!opt.effective) {
        badges.push({ label: t("Not recommended"), variant: "warning" });
      } else if (badges.length === 0) {
        badges.push({ label: t("Ready"), variant: "primary" });
      }
      return badges;
    };

    const makeRadio = (key: string, disabled?: boolean) => ({
      checked: (use: UseCB) => use(this._selected) === key,
      onSelect: () => { if (!isLockedByEnv) { this._selected.set(key); } },
      name: "sandbox",
      disabled: disabled || isLockedByEnv,
    });

    return dom("div",
      this._inAdminPanel ? null : quickSetupStepHeader({
        icon: "Lock",
        title: t("Sandboxing"),
        description: t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
          "to protect your server. Without it, document formulas can access the full system."),
      }),

      isLockedByEnv ? cssEnvWarning(
        t("Sandbox type is set via the GRIST_SANDBOX_FLAVOR environment variable " +
          "and cannot be changed here. Remove the variable and restart to configure it here."),
        testId("env-warning"),
      ) : null,

      buildHeroCard({
        indicator: (use: UseCB) =>
          use(this._selected) === heroOption.flavor ?
            (heroOption.flavor === recommended ? "success" : "warning") : "",
        radio: makeRadio(heroOption.flavor, !canSelect(heroOption)),
        header: sandboxLabel(heroOption.flavor),
        tags: heroOption.flavor === recommended ? [{ label: t("Recommended") }] : [],
        badges: badgesFor(heroOption),
        text: sandboxDescription(heroOption.flavor),
        error: heroOption.functional === false ? (heroOption.error ?? "") : undefined,
        args: [testId(`flavor-${heroOption.flavor}`), testId("flavor-0")],
      }),

      otherOptions.length > 0 ?
        buildCardList({
          header: t("Other options"),
          collapsible: true,
          initiallyCollapsed: this._selected.get() === heroOption.flavor,
          items: otherOptions.map((opt, i) =>
            buildItemCard({
              indicator: (use: UseCB) => {
                if (use(this._selected) !== opt.flavor) { return undefined; }
                return opt.flavor === recommended ? "active" : "warning";
              },
              radio: makeRadio(opt.flavor, !canSelect(opt) || isLockedByEnv),
              header: sandboxLabel(opt.flavor),
              tags: opt.flavor === recommended ? [{ label: t("Recommended") }] : [],
              badges: badgesFor(opt),
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

  // Admin-panel-only footer reusing the AdminChecks sandbox blurb plus a
  // help link. Lives at the bottom of the expanded content so admins can
  // still find the docs that the old read-only row surfaced.
  private _buildAdminPanelFooter(): DomContents {
    return cssAdminPanelFooter(
      probeDetails.sandboxing.info,
      dom("div", cssLink({ href: commonUrls.helpSandboxing, target: "_blank" }, t("Learn more."))),
    );
  }
}

function sandboxLabel(flavor: string): string {
  switch (flavor) {
    case "gvisor": return "gVisor";
    case "pyodide": return "Pyodide";
    case "macSandboxExec": return t("macOS Sandbox");
    case "unsandboxed": return t("No Sandbox");
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

const cssAdminPanelFooter = styled("div", `
  margin-top: 16px;
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};

  & > div {
    margin-top: 8px;
  }
`);
