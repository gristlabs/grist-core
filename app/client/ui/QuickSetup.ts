import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { BadgeConfig, buildCardList, buildHeroCard, buildItemCard } from "app/client/ui/SetupCard";
import { SetupWizard } from "app/client/ui/SetupWizard";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { ConfigAPI, SandboxingStatus, SandboxOption } from "app/common/ConfigAPI";

import { Disposable, dom, DomContents, makeTestId, Observable, styled, UseCB } from "grainjs";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

// TODO: this is probably not needed.
export type SetupMode = "install" | "reconfigure";

export class QuickSetup extends Disposable {
  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(private _mode: SetupMode = "install") {
    super();
  }

  public buildDom() {
    return dom.create(SetupWizard, {
      title: t("Quick setup"),
      subtitle: t("Configure Grist for your environment."),
      steps: [
        {
          label: t("Server"),
          buildDom: (activeStep) => dom("div",
            dom("p", t("Server settings...")),
            cssContinueRow(
              bigPrimaryButton(t("Continue"),
                dom.on("click", () => activeStep.set(activeStep.get() + 1)),
              ),
            ),
          ),
        },
        {
          label: t("Sandboxing"),
          plain: true,
          buildDom: (activeStep) => this._buildSandboxingStep(activeStep),
        },
        {
          label: t("Authentication"),
          buildDom: () => dom("div", t("Auth settings...")),
        },
        {
          label: t("Backups"),
          buildDom: () => dom("div", t("Backup settings...")),
        },
        {
          label: t("Apply & restart"),
          buildDom: () => dom("div", t("Ready to apply.")),
        },
      ],
    });
  }

  private _buildSandboxingStep(activeStep: Observable<number>): DomContents {
    const status = Observable.create<SandboxingStatus | null>(null, null);
    const selected = Observable.create<string | null>(null, null);
    const error = Observable.create<string>(null, "");

    this._configAPI.getSandboxingStatus().then(s => {
      if (this.isDisposed()) { return; }
      status.set(s);
      // Always select the first option — backend sorts best-available first.
      selected.set(s.available[0]?.key ?? "unsandboxed");
    }).catch(e => {
      if (this.isDisposed()) { return; }
      error.set(String(e));
    });

    return dom("div",
      dom.autoDispose(status),
      dom.autoDispose(selected),
      dom.autoDispose(error),
      testId("sandboxing"),
      dom.maybe(error, (err) => cssError(err)),
      dom.domComputed(status, (s) => {
        if (!s) { return cssLoading(loadingSpinner(), t("Detecting sandbox options…")); }
        return this._buildSandboxingContent(s, selected, activeStep, error);
      }),
    );
  }

  private _buildSandboxingContent(
    status: SandboxingStatus,
    selected: Observable<string | null>,
    activeStep: Observable<number>,
    error: Observable<string>,
  ): DomContents {
    const {available, recommended, isSelectedByEnv} = status;

    // Hero is always the first option from the backend list; the rest go into "Other options".
    const heroOption = available[0];
    const heroKey = heroOption.key;
    const otherOptions = available.slice(1);

    const canSelect = (opt: SandboxOption) => opt.available && opt.functional !== false;

    const badgesFor = (opt: SandboxOption): BadgeConfig[] => {
      const badges: BadgeConfig[] = [];
      if (opt.isActive && this._mode === "reconfigure") {
        badges.push({label: t("Active"), variant: "primary"});
      }
      if (!opt.available) {
        badges.push({label: t("Not available"), variant: "error"});
        return badges; // Notice quick returns here.
      } else if (opt.functional === false) {
        badges.push({label: t("Not working"), variant: "error"});
        return badges;
      } else if (!opt.effective) {
        badges.push({label: t("Not recommended"), variant: "warning"});
        return badges;
      } else {
        badges.push({label: t("Ready"), variant: "primary"});
        return badges;
      }
    };

    const makeRadio = (key: string, disabled?: boolean) => ({
      checked: (use: UseCB) => use(selected) === key,
      onSelect: () => { if (!isSelectedByEnv) { selected.set(key); } },
      name: "sandbox",
      disabled: disabled || isSelectedByEnv,
    });

    return dom("div",
      cssStepTitle(t("Sandboxing")),
      cssStepDescription(
        t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
          "to protect your server. Without it, document formulas can access the full system."),
      ),

      isSelectedByEnv ? cssEnvWarning(
        t("Sandbox type is set via the GRIST_SANDBOX_FLAVOR environment variable " +
          "and cannot be changed here. Remove the variable and restart to configure via this wizard."),
      ) : null,

      // Hero card — first option from the backend.
      buildHeroCard( {
        indicator: (use: UseCB) => use(selected) === heroKey ? (heroKey === recommended ? "success" : "warning") : "",
        radio: makeRadio(heroKey, !canSelect(heroOption)),
        header: heroOption.label,
        tags: heroKey === recommended ? [{ label: t("Recommended") }] : [],
        badges: badgesFor(heroOption),
        text: sandboxDescription(heroKey),
        error: heroOption.functional === false ? (heroOption.testError ?? "") : undefined,
      }),

      // Other options — expanded by default when hero is not the selected option.
      otherOptions.length > 0
        ? buildCardList( {
            header: t("Other options"),
            collapsible: true,
            initiallyCollapsed: selected.get() === heroKey,
            items: otherOptions.map(opt =>
              buildItemCard({
                indicator: (use: UseCB) => {
                  if (use(selected) !== opt.key) { return undefined; }
                  return opt.key === recommended ? "active" : "warning";
                },
                radio: makeRadio(opt.key, !canSelect(opt) || isSelectedByEnv),
                header: opt.label,
                tags: opt.key === recommended ? [{ label: t("Recommended") }] : [],
                badges: badgesFor(opt),
                text: sandboxDescription(opt.key),
                info: !opt.available ? opt.unavailableReason : undefined,
                error: opt.functional === false ? (opt.testError ?? "") : undefined,
              }),
            ),
          })
        : null,

      cssContinueRow(
        bigPrimaryButton(t("Continue"),
          dom.on("click", async () => {
            const flavor = selected.get();
            if (flavor && !isSelectedByEnv) {
              try {
                await this._configAPI.setSandboxFlavor(flavor);
              } catch (e) {
                error.set(String(e));
                return;
              }
            }
            activeStep.set(activeStep.get() + 1);
          }),
          testId("sandboxing-continue"),
        ),
      ),
    );
  }
}

function sandboxDescription(key: string): string {
  switch (key) {
    case "gvisor":
      return t("Your system supports gVisor — the fastest and most battle-tested sandbox. " +
        "Each document's formulas run in their own isolated container.");
    case "pyodide":
      return t("Formulas run in WebAssembly — fully compatible but slower than gVisor. " +
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

const cssStepTitle = styled("div", `
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`);

const cssStepDescription = styled("div", `
  font-size: 14px;
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 20px;
`);

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: stretch;
  margin-top: 24px;
  gap: 12px;
  & > * {
    flex: 1;
  }
`);

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
  background: ${theme.toastErrorBg};
  border-radius: 8px;
  color: white;
  padding: 12px 16px;
  margin-bottom: 16px;
`);

const cssEnvWarning = styled("div", `
  background: ${theme.toastWarningBg};
  border-radius: 8px;
  color: white;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: ${vars.smallFontSize};
`);
