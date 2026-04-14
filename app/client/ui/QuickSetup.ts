import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { BadgeConfig, BadgeVariant, CardList, HeroCard, ItemCard } from "app/client/ui/SetupCard";
import { SetupWizard } from "app/client/ui/SetupWizard";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { ConfigAPI, SandboxingStatus } from "app/common/ConfigAPI";

import { Computed, Disposable, dom, DomContents, makeTestId, MultiHolder, Observable, styled, UseCB } from "grainjs";
import { loadingSpinner } from "app/client/ui2018/loaders";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

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
    const testResults = Observable.create<Map<string, {functional: boolean, error?: string}>>(null, new Map());
    const selected = Observable.create<string | null>(null, null);
    const error = Observable.create<string>(null, "");

    this._configAPI.getSandboxingStatus().then(s => {
      status.set(s);
      if (this._mode === "reconfigure") {
        selected.set(s.pendingRestart ?? s.current);
      } else {
        selected.set(s.recommended ?? "sandboxed");
      }

      // Test all available flavors in parallel.
      const flavorsToTest = s.available
        .filter(o => o.available && o.effective)
        .map(o => o.key);

      const testPromises = flavorsToTest.map(flavor =>
        this._configAPI.testSandbox(flavor).then(result => ({ flavor, result }))
      );

      Promise.all(testPromises).then(results => {
        const newMap = new Map(testResults.get());
        for (const { flavor, result } of results) {
          newMap.set(flavor, result);
        }
        testResults.set(newMap);
      });
    }).catch(e => {
      error.set(String(e));
    });

    return dom("div",
      dom.autoDispose(status),
      dom.autoDispose(testResults),
      dom.autoDispose(selected),
      dom.autoDispose(error),
      testId("sandboxing"),

      dom.maybe(error, (err) => cssError(err)),

      dom.domComputed(status, (s) => {
        if (!s) { return cssLoading(loadingSpinner(), t("Detecting sandbox options…")); }
        return this._buildSandboxingContent(s, testResults, selected, activeStep);
      }),
    );
  }

  private _buildSandboxingContent(
    status: SandboxingStatus,
    testResults: Observable<Map<string, TestResult>>,
    selected: Observable<string | null>,
    activeStep: Observable<number>,
  ): DomContents {
    const {available, recommended, isSelectedByEnv, current} = status;
    const locked = isSelectedByEnv;

    // Hero is fixed: in install mode show recommended, in reconfigure show current.
    const heroKey = this._mode === "reconfigure" ? current : (recommended ?? "unsandboxed");
    const heroOption = available.find(o => o.key === heroKey)!;
    const otherOptions = available.filter(o => o.key !== heroKey);
    const owner = new MultiHolder();
    const badges = (flavor: string): Computed<BadgeConfig[]> => {
      const option = available.find(o => o.key === flavor);
      return Computed.create(owner, use => {
        const result: BadgeConfig[] = [];
        if (option && !option.available) {
          result.push(makeBadge(t("Not available"), "error"));
        } else if (option && !option.effective) {
          result.push(makeBadge(t("Not recommended"), "warning"));
        } else {
          const test = use(testResults).get(flavor);
          if (!test) {
            result.push(makeBadge(t("Checking…"), "warning"));
          } else if (test.functional) {
            result.push(makeBadge(t("Ready"), "primary"));
          } else {
            result.push(makeBadge(t("Not working"), "error"));
          }
        }
        return result;
      });
    };

    const makeRadio = (key: string, disabled?: boolean) => ({
      checked: (use: UseCB) => use(selected) === key,
      onSelect: () => { if (!locked) { selected.set(key); } },
      name: "sandbox",
      disabled: disabled || locked,
    });

    return dom("div",
      dom.autoDispose(owner),
      cssStepTitle(t("Sandboxing")),
      cssStepDescription(
        t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
          "to protect your server. Without it, document formulas can access the full system."),
      ),

      locked ? cssEnvWarning(
        t("Sandbox type is set via the GRIST_SANDBOX_FLAVOR environment variable " +
          "and cannot be changed here. Remove the variable and restart to configure via this wizard."),
      ) : null,

      // Hero card — current selection.
      dom.create(HeroCard, {
        indicator: (use: UseCB) => use(selected) === heroKey ? "success" : "",
        radio: makeRadio(heroKey, !heroOption.available),
        header: heroOption.label,
        tags: heroKey === recommended ? [{ label: t("Recommended") }] : [],
        badges: badges(heroKey),
        text: sandboxDescription(heroKey),
        error: (use: UseCB) => {
          const test = use(testResults).get(heroKey);
          return test && !test.functional ? (test.error ?? "") : "";
        },
      }),

      // Other options.
      otherOptions.length > 0
        ? dom.create(CardList, {
            header: t("Other options"),
            collapsible: true,
            initiallyCollapsed: true,
            items: otherOptions.map(opt =>
              dom.create(ItemCard, {
                indicator: (use: UseCB) => {
                  return use(selected) === opt.key ? "active" : undefined;
                },
                radio: makeRadio(opt.key, !opt.available || locked),
                header: opt.label,
                tags: opt.key === recommended ? [{ label: t("Recommended") }] : [],
                badges: badges(opt.key),
                text: sandboxDescription(opt.key),
                info: !opt.available ? opt.unavailableReason : undefined,
                error: (use: UseCB) => {
                  const test = use(testResults).get(opt.key);
                  return test && !test.functional ? (test.error ?? "") : "";
                },
              }),
            ),
          })
        : null,

      cssContinueRow(
        bigPrimaryButton(t("Continue"),
          dom.on("click", async () => {
            const flavor = selected.get();
            if (flavor && !locked) {
              await this._configAPI.setSandboxFlavor(flavor);
            }
            activeStep.set(activeStep.get() + 1);
          }),
          testId("sandboxing-continue"),
        ),
      ),
    );
  }
}

interface TestResult {
  functional: boolean;
  error?: string;
}

function makeBadge(label: string, variant: BadgeVariant): BadgeConfig {
  return { label, variant };
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

// =========================================================================
// Styled components
// =========================================================================

const cssStepTitle = styled("div", `
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`);

const cssStepDescription = styled("div", `
  font-size: 14px;
  color: #666;
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
  color: #888;
`);

const cssError = styled("div", `
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  padding: 12px 16px;
  margin-bottom: 16px;
`);

const cssEnvWarning = styled("div", `
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #92400e;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 13px;
`);
