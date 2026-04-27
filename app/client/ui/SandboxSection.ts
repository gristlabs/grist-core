import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { BadgeConfig, buildCardList, buildHeroCard, buildItemCard } from "app/client/ui/SetupCard";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { ConfigAPI } from "app/common/ConfigAPI";
import { delay } from "app/common/delay";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { SandboxInfo, SandboxingStatus } from "app/common/SandboxInfo";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled, UseCB, UseCBOwner } from "grainjs";

const t = makeT("SandboxSection");
const testId = makeTestId("test-sandbox-section-");

/**
 * Base sandbox configuration section. Fetches available sandbox options,
 * shows them as cards, and lets the user pick one.
 */
abstract class SandboxSectionBase extends Disposable {
  protected _configAPI = new ConfigAPI(getHomeUrl());
  protected _installAPI = new InstallAPIImpl(getHomeUrl());
  // Data read from the server.
  protected _model = Observable.create<SandboxingStatus | null>(this, null);
  // If there was error loading or saving.
  protected _error = Observable.create<string>(this, "");
  // Observable for user selection.
  protected _selected = Observable.create<string | null>(this, null);

  /** True when a different flavor is selected than what's currently active and not env-locked. */
  protected readonly _needsRestart: Computed<boolean> =
    Computed.create(this, this._model, this._selected, (_, model, selected) => {
      if (model?.flavorInEnv) { return false; }
      return !!selected && selected !== model?.current;
    });

  constructor() {
    super();
    this._loadStatus().catch((e) => {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    });
  }

  public buildDom(): DomContents {
    return dom("div",
      testId("sandboxing"),
      dom.maybe(this._error, err => cssError(err)),
      dom.domComputed(this._model, (s) => {
        if (!s) { return cssLoading(loadingSpinner(), t("Detecting sandbox options...")); }
        return dom("div",
          this._buildContent(s),
          this._buildFooter(),
        );
      }),
    );
  }

  protected _isLockedByEnv() {
    return !!this._model.get()?.flavorInEnv;
  }

  protected async _save() {
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

  protected _buildFooter(): DomContents {
    return null;
  }

  private async _loadStatus() {
    const result = await this._installAPI.runCheck("sandbox-providers");
    const model = sortedByPreference(result.details as SandboxingStatus);
    if (this.isDisposed()) { return; }

    this._model.set(model);
    if (model.flavorInEnv) {
      this._selected.set(model.current ?? "unsandboxed");
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

    // When locked by env, hero is the current one; otherwise the recommended one.
    const heroOption = isLockedByEnv ?
      options.find(o => o.flavor === current) ?? options[0] :
      options.find(o => o.flavor === recommended) ?? options[0];
    const otherOptions = options.filter(o => o !== heroOption);

    const canSelect = (opt: SandboxInfo) => opt.available && opt.functional !== false;

    const badgesFor = (opt: SandboxInfo): BadgeConfig[] => {
      if (opt.flavor === current && opt.functional && opt.effective) {
        return [{ label: t("Active"), variant: "primary" }];
      }
      if (!opt.available) {
        return [{ label: t("Not available"), variant: "warning" }];
      }
      if (opt.functional === false) {
        return [{ label: t("Error"), variant: "error" }];
      }
      if (!opt.effective) {
        return [{ label: t("Not recommended"), variant: "warning" }];
      }
      return [{ label: t("Ready"), variant: "primary" }];
    };

    const makeRadio = (key: string, disabled?: boolean) => ({
      checked: (use: UseCB) => use(this._selected) === key,
      onSelect: () => { if (!isLockedByEnv) { this._selected.set(key); } },
      name: "sandbox",
      disabled: disabled || isLockedByEnv,
    });

    return dom("div",
      quickSetupStepHeader({
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
}

/**
 * Sandbox section for QuickSetup. Conforms to {@link QuickSetupSection} so
 * the QuickSetup step builder can drop in a shared continue button.
 */
export class SandboxSetupSection extends SandboxSectionBase {
  /** Always true once the model has loaded — there's always a default selection. */
  public readonly canProceed: Computed<boolean> = Computed.create(this, this._selected, (_, s) => !!s);

  /** True when a different flavor is selected than what's currently active (and not env-locked). */
  public readonly isDirty = this._needsRestart;

  /** True while {@link apply} is in flight. */
  public readonly isApplying: Observable<boolean> = Observable.create(this, false);

  /** Persist the selected flavor and restart the server. No-op when env-locked or unchanged. */
  public async apply(): Promise<void> {
    if (this.isApplying.get()) { return; }
    const willRestart = this.isDirty.get();
    this.isApplying.set(true);
    try {
      await this._save();
      if (willRestart) {
        await this._configAPI.restartServer();
        // Brief delay so we don't catch the server before it's begun
        // restarting; waitUntilReady then polls.
        await delay(500);
        await this._configAPI.waitUntilReady();
      }
    } finally {
      if (!this.isDisposed()) { this.isApplying.set(false); }
    }
  }

  /** Returns "Skip and Continue" when env-locked; otherwise null to use shared defaults. */
  public customLabel(use: UseCBOwner): string | null {
    return use(this._model)?.flavorInEnv ? t("Skip and Continue") : null;
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
