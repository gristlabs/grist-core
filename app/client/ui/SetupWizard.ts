import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel, getHomeUrl } from "app/client/models/AppModel";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { GoLiveControl } from "app/client/ui/GoLiveControl";
import { SandboxConfigurator } from "app/client/ui/SandboxConfigurator";
import { StorageConfigurator } from "app/client/ui/StorageConfigurator";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { Computed, Disposable, dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("SetupWizard");

const STORAGE_KEY = "grist-setup-wizard";

type Step = 1 | 2 | 3 | 4;

interface WizardState {
  activeStep: Step;
  sandboxConfigured: string;   // flavor name, or "" if not done
  sandboxConfirmed: boolean;   // admin clicked Configure or Continue
  authConfirmed: boolean;      // admin clicked Continue or Skip
  storageSelected: string;     // backend name, or "" if not done
  storageConfirmed: boolean;   // admin clicked Continue
}

interface StepDef {
  step: Step;
  label: string;
  done: (use: (obs: Observable<any>) => any) => boolean;
}

/**
 * Setup wizard for first-time Grist configuration.
 * Composes SandboxConfigurator, StorageConfigurator, and GoLiveControl
 * into a three-step guided flow.
 */
export class SetupWizard extends Disposable {
  private _activeStep = Observable.create<Step>(this, 1);
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  private _sandbox = SandboxConfigurator.create(this, this._installAPI);
  private _storage = StorageConfigurator.create(this, this._installAPI);
  private _goLive = GoLiveControl.create(this);
  private _authSkipped = Observable.create<boolean>(this, false);
  // Explicit confirmation flags — checkmarks require admin action, not just detection.
  private _sandboxConfirmed = Observable.create<boolean>(this, false);
  private _authConfirmed = Observable.create<boolean>(this, false);
  private _storageConfirmed = Observable.create<boolean>(this, false);

  // Auth section needs loginSystemId from the authentication probe.
  private _checks = new AdminChecks(this, this._installAPI);
  private _authCheck = Computed.create(this, (use) => {
    return this._checks.requestCheckById(use, "authentication");
  });

  private _loginProvider = Computed.create<string | undefined>(this, (use) => {
    const req = use(this._authCheck);
    const result = req ? use(req.result) : undefined;
    if (result?.status === "success") {
      return result.details?.provider as string | undefined;
    }
    return undefined;
  });

  private _hasRealAuth = Computed.create(this, (use) => {
    const provider = use(this._loginProvider);
    return !!provider && provider !== "no-logins" && provider !== "boot-key" && provider !== "minimal";
  });

  private _steps: StepDef[] = [
    {
      step: 1,
      label: t("Sandboxing"),
      done: use => use(this._sandboxConfirmed),
    },
    {
      step: 2,
      label: t("Authentication"),
      done: use => use(this._authConfirmed),
    },
    {
      step: 3,
      label: t("Backups"),
      done: use => use(this._storageConfirmed),
    },
    {
      step: 4,
      label: t("Apply & Restart"),
      done: use => use(this._goLive.status) === "success",
    },
  ];

  private _appModel: AppModel;

  constructor(appModel: AppModel) {
    super();
    this._appModel = appModel;

    // Restore progress from sessionStorage so checkmarks and
    // active step survive page reloads.
    this._restoreState();

    // Auto-start probes (user is already authenticated via session).
    void this._sandbox.probe();
    void this._storage.probe();
    void this._checks.fetchAvailableChecks();

    // Save progress whenever meaningful state changes.
    this.autoDispose(this._activeStep.addListener(() => this._saveState()));
    this.autoDispose(this._sandboxConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._authConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._storageConfirmed.addListener(() => this._saveState()));
  }

  public buildDom() {
    const hideMockup = new URLSearchParams(window.location.search).has("no-mockup");

    return cssWizardPage(
      cssWizardGlow(),
      cssWizardContent(
        cssLogo({ style: "animation: wizFadeUp 0.5s ease both;" }),
        cssTitle(
          t("Quick Setup"),
          { style: "animation: wizFadeUp 0.5s ease 0.08s both;" },
          testId("setup-title"),
        ),
        cssSubtitle(
          t("Configure Grist for your environment."),
          { style: "animation: wizFadeUp 0.5s ease 0.14s both;" },
        ),

        // Progress rail — horizontal track with connected step dots.
        cssProgressRail(
          { style: "animation: wizFadeUp 0.5s ease 0.2s both;" },
          // Filled portion of the rail, width tracks active step.
          cssProgressFill(
            dom.style("width", (use) => {
              const step = use(this._activeStep);
              // 0% at step 1, 33% at step 2, 67% at step 3, 100% at step 4.
              return `${((step - 1) / 3) * 100}%`;
            }),
          ),
          ...this._steps.map(({ step, label, done }) =>
            cssProgressStep(
              dom.style("left", `${((step - 1) / 3) * 100}%`),
              cssProgressDot(
                cssProgressDot.cls("-active", use => use(this._activeStep) === step),
                cssProgressDot.cls("-done", done),
                dom.domComputed(done, isDone =>
                  isDone ?
                    cssProgressDotCheck("\u2713") :
                    cssProgressDotNumber(String(step)),
                ),
                dom.on("click", () => this._activeStep.set(step)),
              ),
              cssProgressLabel(
                label,
                cssProgressLabel.cls("-active", use => use(this._activeStep) === step),
              ),
              testId(`setup-tab-${step}`),
            ),
          ),
        ),

        // Step panels — cards with entrance animation.
        // Step 1: Sandboxing
        cssStepCard(
          dom.show(use => use(this._activeStep) === 1),
          cssStepHeader(
            cssStepIcon("\uD83D\uDEE1\uFE0F"),
            cssStepTitle(t("Sandboxing")),
          ),
          cssStepDesc(
            t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
              "to protect your server. Without it, document formulas can access the full system."),
          ),
          this._sandbox.buildDom({
            onContinue: () => {
              this._sandboxConfirmed.set(true);
              this._activeStep.set(2);
            },
          }),
          testId("setup-step-sandbox"),
        ),

        // Step 2: Authentication
        cssStepCard(
          dom.show(use => use(this._activeStep) === 2),
          cssStepHeader(
            cssStepIcon("\uD83D\uDD10"),
            cssStepTitle(t("Authentication")),
          ),
          cssStepDesc(
            t("Configure how users sign in to Grist. Without authentication, anyone who " +
              "can reach your server gets unrestricted access as an admin user."),
          ),
          this._buildAuthStep(),
          testId("setup-step-auth"),
        ),

        // Step 3: Backups / External Storage
        cssStepCard(
          dom.show(use => use(this._activeStep) === 3),
          cssStepHeader(
            cssStepIcon("\uD83D\uDCBE"),
            cssStepTitle(t("Backups")),
          ),
          cssStepDesc(
            t("Configure external storage to back up document snapshots off-server. " +
              "This enables versioning and protects against data loss."),
          ),
          this._storage.buildDom({
            onContinue: () => {
              this._storageConfirmed.set(true);
              this._activeStep.set(4);
            },
          }),
          testId("setup-step-storage"),
        ),

        // Step 4: Apply & Restart
        cssStepCard(
          dom.show(use => use(this._activeStep) === 4),
          cssStepHeader(
            cssStepIcon("\uD83D\uDE80"),
            cssStepTitle(t("Apply & Restart")),
          ),
          cssStepDesc(
            t("Restart Grist to apply any configuration changes made in the previous steps."),
          ),
          this._goLive.buildDom({
            mode: "restart",
            canProceed: Observable.create(this, true),
          }),
          testId("setup-step-go-live"),
        ),

        testId("setup-page"),
      ),
      hideMockup ? null : this._buildMockupControls(),
    );
  }

  private _saveState() {
    const state: WizardState = {
      activeStep: this._activeStep.get(),
      sandboxConfigured: this._sandbox.configured.get(),
      sandboxConfirmed: this._sandboxConfirmed.get(),
      authConfirmed: this._authConfirmed.get(),
      storageSelected: this._storage.selected.get(),
      storageConfirmed: this._storageConfirmed.get(),
    };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ok */ }
  }

  private _restoreState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) { return; }
      const state: WizardState = JSON.parse(raw);
      if (state.activeStep >= 1 && state.activeStep <= 4) {
        this._activeStep.set(state.activeStep);
      }
      if (state.sandboxConfigured) {
        this._sandbox.configured.set(state.sandboxConfigured);
        this._sandbox.selected.set(state.sandboxConfigured);
        this._sandbox.status.set("saved");
      }
      if (state.sandboxConfirmed) {
        this._sandboxConfirmed.set(true);
      }
      if (state.authConfirmed) {
        this._authConfirmed.set(true);
        // Restore authSkipped too — it was set when auth was confirmed via skip.
        // The exact value doesn't matter for the checkmark, but it keeps
        // the auth step UI consistent (showing "Continue" vs "Skip").
        this._authSkipped.set(true);
      }
      if (state.storageSelected) {
        this._storage.selected.set(state.storageSelected);
      }
      if (state.storageConfirmed) {
        this._storageConfirmed.set(true);
      }
    } catch (_) { /* ok — corrupted or unavailable */ }
  }

  /**
   * Build the authentication step content. Mounts the shared
   * AuthenticationSection (same component used by the admin panel)
   * with a "Continue" button. If auth is already configured,
   * the step shows as done.
   */
  private _buildAuthStep(): DomContents {
    return cssAuthStepContent(
      dom.create(AuthenticationSection, {
        appModel: this._appModel,
        loginSystemId: this._loginProvider,
        installAPI: this._installAPI,
      }),
      dom.domComputed((use) => {
        if (use(this._hasRealAuth) || use(this._authSkipped)) {
          return primaryButton(
            t("Continue"),
            dom.on("click", () => {
              this._authConfirmed.set(true);
              this._activeStep.set(3);
            }),
            testId("auth-submit"),
          );
        }
        return cssSkipRow(
          basicButton(
            t("Skip for now"),
            dom.on("click", () => {
              this._authSkipped.set(true);
              this._authConfirmed.set(true);
              this._activeStep.set(3);
            }),
            testId("auth-skip"),
          ),
        );
      }),
    );
  }

  /**
   * DEV/TESTING ONLY — Mockup controls panel.
   * Shown when ?mockup is in the URL. Lets user testers manipulate
   * wizard state without server access. Will be removed before merge.
   */
  private _buildMockupControls(): DomContents {
    return cssMockupPanel(
      cssMockupTitle("Mockup controls"),
      cssMockupDesc("For user testing only. Append ?no-mockup to the URL to hide this panel."),

      // --- Reset ---
      cssMockupSection("State"),
      cssMockupRow(
        cssMockupButton("Reset all", dom.on("click", () => {
          try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* ok */ }
          this._sandbox.flavors.set([]);
          this._sandbox.selected.set("");
          this._sandbox.configured.set("");
          this._sandbox.status.set("idle");
          this._sandbox.error.set("");
          this._sandboxConfirmed.set(false);
          this._authSkipped.set(false);
          this._authConfirmed.set(false);
          this._storageConfirmed.set(false);
          this._storage.backends.set([]);
          this._storage.selected.set("");
          this._storage.status.set("idle");
          this._storage.error.set("");
          this._goLive.status.set("idle");
          this._goLive.error.set("");
          this._activeStep.set(1);
          void this._sandbox.probe();
          void this._storage.probe();
        })),
      ),

      // --- Force sandbox results ---
      cssMockupSection("Force sandbox probes"),
      cssMockupDesc("Override probe results without running real sandboxes."),
      cssMockupRow(
        cssMockupButton("All available", dom.on("click", () => {
          this._sandbox.flavors.set([
            { name: "gvisor", status: "available" },
            { name: "pyodide", status: "available" },
            { name: "macSandboxExec", status: "available" },
            { name: "unsandboxed", status: "available" },
          ]);
          this._sandbox.selected.set("gvisor");
          this._sandbox.status.set("ready");
        })),
        cssMockupButton("Only gvisor", dom.on("click", () => {
          this._sandbox.flavors.set([
            { name: "gvisor", status: "available" },
            { name: "pyodide", status: "unavailable", error: "Pyodide not installed" },
            { name: "macSandboxExec", status: "unavailable", error: "Not macOS" },
            { name: "unsandboxed", status: "available" },
          ]);
          this._sandbox.selected.set("gvisor");
          this._sandbox.status.set("ready");
        })),
        cssMockupButton("None available", dom.on("click", () => {
          this._sandbox.flavors.set([
            { name: "gvisor", status: "unavailable", error: "runsc not found" },
            { name: "pyodide", status: "unavailable", error: "Pyodide not installed" },
            { name: "macSandboxExec", status: "unavailable", error: "Not macOS" },
            { name: "unsandboxed", status: "available" },
          ]);
          this._sandbox.selected.set("unsandboxed");
          this._sandbox.status.set("ready");
        })),
      ),

      // --- Force storage results ---
      cssMockupSection("Force storage probes"),
      cssMockupRow(
        cssMockupButton("MinIO configured", dom.on("click", () => {
          this._storage.backends.set([
            { name: "minio", status: "available", bucket: "my-grist-docs", endpoint: "s3.amazonaws.com" },
            { name: "s3", status: "unavailable" },
            { name: "azure", status: "unavailable" },
            { name: "none", status: "available" },
          ]);
          this._storage.selected.set("minio");
          this._storage.status.set("ready");
        })),
        cssMockupButton("Nothing configured", dom.on("click", () => {
          this._storage.backends.set([
            { name: "minio", status: "selectable" },
            { name: "s3", status: "unavailable" },
            { name: "azure", status: "unavailable" },
            { name: "none", status: "available" },
          ]);
          this._storage.selected.set("");
          this._storage.status.set("ready");
        })),
      ),
    );
  }
}

/**
 * Top-level builder for use in AdminPanel routing.
 */
export function buildSetupWizard(owner: Disposable, appModel: AppModel) {
  return dom.create(SetupWizard, appModel);
}

// --- Styles ---

const cssWizardPage = styled("div", `
  width: 100%;
  height: 100%;
  overflow-y: auto;
  position: relative;
  background-color: ${theme.mainPanelBg};

  @keyframes wizFadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`);

// Subtle radial glow — matches the boot key login page atmosphere.
const cssWizardGlow = styled("div", `
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    ${theme.controlPrimaryBg}0a 0%,
    transparent 70%
  );
  pointer-events: none;
`);

const cssWizardContent = styled("div", `
  position: relative;
  text-align: center;
  padding: 56px 24px 64px;
  max-width: 580px;
  margin: 0 auto;
`);

const cssLogo = styled("div", `
  display: inline-block;
  width: 100%;
  height: 56px;
  background-image: var(--icon-GristLogo);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssTitle = styled("div", `
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.5px;
  margin-top: 16px;
  margin-bottom: 4px;
  text-align: center;
  color: ${theme.text};
`);

const cssSubtitle = styled("div", `
  font-size: 14px;
  color: ${theme.lightText};
  margin-bottom: 40px;
  line-height: 1.5;
`);

// --- Progress rail: horizontal track connecting step dots ---

const cssProgressRail = styled("div", `
  position: relative;
  height: 68px;
  max-width: 480px;
  margin: 0 auto 32px auto;

  /* The grey track line. */
  &::before {
    content: "";
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    height: 3px;
    background: ${theme.pagePanelsBorder};
    border-radius: 2px;
  }
`);

const cssProgressFill = styled("div", `
  position: absolute;
  top: 16px;
  left: 16px;
  height: 3px;
  background: ${theme.controlPrimaryBg};
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
`);

const cssProgressStep = styled("div", `
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  user-select: none;
  z-index: 2;
`);

const cssProgressDot = styled("div", `
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: ${theme.lightText};
  background: ${theme.mainPanelBg};
  border: 3px solid ${theme.pagePanelsBorder};
  transition: border-color 0.3s, background 0.3s, color 0.3s, transform 0.2s;

  &:hover {
    transform: scale(1.08);
  }
  &-active {
    border-color: ${theme.controlPrimaryBg};
    color: ${theme.controlPrimaryBg};
  }
  &-done {
    border-color: #1e7e34;
    background: #1e7e34;
    color: white;
  }
`);

const cssProgressDotNumber = styled("span", ``);

const cssProgressDotCheck = styled("span", `
  font-size: 15px;
`);

const cssProgressLabel = styled("div", `
  margin-top: 6px;
  font-size: 11px;
  font-weight: 500;
  color: ${theme.lightText};
  white-space: nowrap;
  transition: color 0.2s;
  letter-spacing: 0.2px;

  &-active {
    color: ${theme.text};
    font-weight: 600;
  }
`);

// --- Step cards ---

const cssStepCard = styled("div", `
  text-align: left;
  max-width: 520px;
  margin: 0 auto 24px auto;
  padding: 28px 32px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 12px;
  background: ${theme.mainPanelBg};
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 6px 20px rgba(0, 0, 0, 0.05);
  animation: wizFadeUp 0.35s ease both;
`);

const cssStepHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
`);

const cssStepIcon = styled("span", `
  font-size: 20px;
  line-height: 1;
`);

const cssStepTitle = styled("div", `
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.2px;
  color: ${theme.text};
`);

const cssStepDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  margin-bottom: 16px;
  line-height: 1.55;
`);

const cssAuthStepContent = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 16px;
`);

const cssSkipRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
`);

// --- Mockup panel styles (DEV/TESTING ONLY) ---

const cssMockupPanel = styled("div", `
  position: fixed;
  bottom: 0;
  right: 0;
  width: 360px;
  max-height: 60vh;
  overflow-y: auto;
  background: #1a1a2e;
  color: #e0e0e0;
  padding: 12px;
  border-top-left-radius: 8px;
  font-size: 12px;
  z-index: 1000;
  box-shadow: -2px -2px 12px rgba(0, 0, 0, 0.4);
`);

const cssMockupTitle = styled("div", `
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 4px;
  color: #fff;
`);

const cssMockupDesc = styled("div", `
  color: #888;
  margin-bottom: 8px;
`);

const cssMockupSection = styled("div", `
  font-weight: 600;
  margin-top: 10px;
  margin-bottom: 4px;
  color: #aaa;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.5px;
`);

const cssMockupRow = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
`);

const cssMockupButton = styled("button", `
  padding: 4px 8px;
  border: 1px solid #444;
  border-radius: 3px;
  background: #2a2a4a;
  color: #ccc;
  cursor: pointer;
  font-size: 11px;
  &:hover {
    background: #3a3a5a;
    color: #fff;
  }
`);
