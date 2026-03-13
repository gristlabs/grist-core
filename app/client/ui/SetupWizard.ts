import { makeT } from "app/client/lib/localization";
import { AppModel, getHomeUrl } from "app/client/models/AppModel";
import { AuthConfigurator } from "app/client/ui/AuthConfigurator";
import { GoLiveControl } from "app/client/ui/GoLiveControl";
import {
  buildMockupPanel, cssMockupButton, cssMockupDesc, cssMockupRow, cssMockupSection,
} from "app/client/ui/MockupPanel";
import { PermissionsConfigurator } from "app/client/ui/PermissionsConfigurator";
import { SandboxConfigurator } from "app/client/ui/SandboxConfigurator";
import { ServerConfigurator } from "app/client/ui/ServerConfigurator";
import { StorageConfigurator } from "app/client/ui/StorageConfigurator";
import { testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { Disposable, dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("SetupWizard");

const STORAGE_KEY = "grist-setup-wizard";

type StepId = string;

interface WizardState {
  activeStep: StepId;
  serverConfirmed: boolean;
  urlConfirmed?: boolean;
  urlSkipped?: boolean;
  editionConfirmed?: boolean;
  editionSkipped?: boolean;
  selectedEdition?: "full" | "community";
  sandboxConfigured: string;
  sandboxConfirmed: boolean;
  authConfirmed: boolean;
  storageSelected: string;
  storageConfirmed: boolean;
}

interface StepDef {
  id: StepId;
  label: string;
  iconName: string;
  desc: string;
  done: (use: (obs: Observable<any>) => any) => boolean;
  buildContent: () => DomContents;
  onEnter?: () => void;
}

/**
 * Setup wizard for first-time Grist configuration.
 * Composes SandboxConfigurator, StorageConfigurator, and GoLiveControl
 * into a three-step guided flow.
 */
export class SetupWizard extends Disposable {
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  private _server: ServerConfigurator;
  private _sandbox = SandboxConfigurator.create(this, this._installAPI);
  private _storage = StorageConfigurator.create(this, this._installAPI);
  private _goLive = GoLiveControl.create(this);
  private _auth: AuthConfigurator;
  // Explicit confirmation flags — checkmarks require admin action, not just detection.
  private _serverConfirmed = Observable.create<boolean>(this, false);
  private _sandboxConfirmed = Observable.create<boolean>(this, false);
  private _authConfirmed = Observable.create<boolean>(this, false);
  private _storageConfirmed = Observable.create<boolean>(this, false);
  private _permissions = new PermissionsConfigurator(this, this._installAPI);

  /**
   * Step definitions — the single source of truth for ordering, labels, icons,
   * content, and lifecycle hooks. Reorder, add, or remove entries here and
   * the progress rail, navigation, and save/restore all adapt automatically.
   */
  private _steps: StepDef[] = [
    {
      id: "server",
      label: t("Server"),
      iconName: "Home",
      desc: t("Set your server's base URL and choose which edition of Grist to run."),
      done: use => use(this._serverConfirmed),
      buildContent: () => this._server.buildDom({
        onContinue: () => {
          this._serverConfirmed.set(true);
          this._goToNextStep("server");
        },
      }),
      onEnter: () => { void this._server.load(); },
    },
    {
      id: "sandbox",
      label: t("Sandboxing"),
      iconName: "Code",
      desc: t("Grist runs user formulas as Python code. Sandboxing isolates this execution " +
        "to protect your server. Without it, document formulas can access the full system."),
      done: use => use(this._sandboxConfirmed),
      buildContent: () => this._sandbox.buildDom({
        onContinue: () => {
          this._sandboxConfirmed.set(true);
          this._goToNextStep("sandbox");
        },
      }),
      onEnter: () => { void this._sandbox.probe(); },
    },
    {
      id: "auth",
      label: t("Authentication"),
      iconName: "Lock",
      desc: t("Configure how users sign in to Grist. Without authentication, anyone who " +
        "can reach your server gets unrestricted access as an admin user."),
      done: use => use(this._authConfirmed),
      buildContent: () => this._auth.buildDom({
        onContinue: () => {
          this._authConfirmed.set(true);
          this._goToNextStep("auth");
        },
      }),
      onEnter: () => { void this._auth.probe(); },
    },
    {
      id: "storage",
      label: t("Backups"),
      iconName: "Database",
      desc: t("Store document backups on an external service like S3 or Azure. " +
        "This protects against data loss if the server's disk fails."),
      done: use => use(this._storageConfirmed),
      buildContent: () => this._storage.buildDom({
        onContinue: () => {
          this._storageConfirmed.set(true);
          this._goToNextStep("storage");
        },
      }),
      onEnter: () => { void this._storage.probe(); },
    },
    {
      id: "apply",
      label: t("Apply & Restart"),
      iconName: "Settings",
      desc: t("Review these defaults before going live. You can change them later from the admin panel."),
      done: use => use(this._goLive.status) === "success",
      buildContent: () => [
        this._permissions.buildDom(),
        this._goLive.buildDom({
          mode: "go-live",
          canProceed: Observable.create(this, true),
          getBody: () => ({
            permissions: this._permissions.getEnvVars(),
            ...this._server.getEnvVars(),
          }),
        }),
      ],
    },
  ];

  private _activeStep = Observable.create<StepId>(this, this._steps[0].id);
  constructor(appModel: AppModel) {
    super();
    this._server = ServerConfigurator.create(this, this._installAPI);
    this._auth = AuthConfigurator.create(this, this._installAPI, appModel);

    // Restore progress from sessionStorage so checkmarks and
    // active step survive page reloads.
    this._restoreState();

    // Fire onEnter for the initial step and all preceding steps
    // (so probes for earlier steps are triggered on reload mid-wizard).
    const activeIdx = this._stepIndex(this._activeStep.get());
    for (let i = 0; i <= activeIdx; i++) {
      this._steps[i].onEnter?.();
    }

    // Load current permission env vars so toggles reflect server state.
    void this._permissions.load();

    this.autoDispose(this._activeStep.addListener((newStep, oldStep) => {
      // Fire onEnter hooks for all steps up to and including the new step
      // that haven't been triggered yet (i.e. steps between old and new).
      const oldIdx = this._stepIndex(oldStep);
      const newIdx = this._stepIndex(newStep);
      for (let i = oldIdx + 1; i <= newIdx; i++) {
        this._steps[i].onEnter?.();
      }
      this._saveState();
    }));

    // Save progress whenever meaningful state changes.
    this.autoDispose(this._serverConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._server.urlConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._server.urlSkipped.addListener(() => this._saveState()));
    this.autoDispose(this._server.editionConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._server.editionSkipped.addListener(() => this._saveState()));
    this.autoDispose(this._server.selectedEdition.addListener(() => this._saveState()));
    this.autoDispose(this._sandboxConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._authConfirmed.addListener(() => this._saveState()));
    this.autoDispose(this._storageConfirmed.addListener(() => this._saveState()));
  }

  public buildDom() {
    const hideMockup = new URLSearchParams(window.location.search).has("no-mockup");
    const lastIdx = this._steps.length - 1;

    return cssWizardPage(
      cssWizardGlow(),
      cssWizardContent(
        cssLogo({ style: "animation: wizFadeUp 0.5s ease both;" }),
        cssTitle(
          t("Quick setup"),
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
          cssProgressFill(
            dom.style("width", (use) => {
              const idx = this._stepIndex(use(this._activeStep));
              return `${(idx / lastIdx) * 100}%`;
            }),
          ),
          ...this._steps.map(({ id, label, done }, i) =>
            cssProgressStep(
              dom.style("left", `${(i / lastIdx) * 100}%`),
              cssProgressDot(
                cssProgressDot.cls("-active", use => use(this._activeStep) === id),
                cssProgressDot.cls("-done", done),
                dom.domComputed(done, isDone =>
                  isDone ?
                    cssProgressDotCheck("\u2713") :
                    cssProgressDotNumber(String(i + 1)),
                ),
                dom.on("click", () => this._activeStep.set(id)),
              ),
              cssProgressLabel(
                label,
                cssProgressLabel.cls("-active", use => use(this._activeStep) === id),
              ),
              testId(`setup-tab-${id}`),
            ),
          ),
        ),

        // Step panels — one card per step definition.
        ...this._steps.map(stepDef =>
          cssStepCard(
            dom.show(use => use(this._activeStep) === stepDef.id),
            cssStepHeader(
              cssStepIcon(icon(stepDef.iconName as any)),
              cssStepTitle(stepDef.label),
            ),
            cssStepDesc(stepDef.desc),
            stepDef.buildContent(),
            testId(`setup-step-${stepDef.id}`),
          ),
        ),

        testId("setup-page"),
      ),
      hideMockup ? null : this._buildMockupControls(),
    );
  }

  /** Get the array index of a step by its ID. */
  private _stepIndex(id: StepId): number {
    const idx = this._steps.findIndex(s => s.id === id);
    return idx >= 0 ? idx : 0;
  }

  /** Navigate to the step after the given one, if any. */
  private _goToNextStep(currentId: StepId) {
    const idx = this._stepIndex(currentId);
    if (idx < this._steps.length - 1) {
      this._activeStep.set(this._steps[idx + 1].id);
    }
  }

  private _saveState() {
    const state: WizardState = {
      activeStep: this._activeStep.get(),
      serverConfirmed: this._serverConfirmed.get(),
      urlConfirmed: this._server.urlConfirmed.get(),
      urlSkipped: this._server.urlSkipped.get(),
      editionConfirmed: this._server.editionConfirmed.get(),
      editionSkipped: this._server.editionSkipped.get(),
      selectedEdition: this._server.selectedEdition.get(),
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
      if (state.activeStep && this._steps.some(s => s.id === state.activeStep)) {
        this._activeStep.set(state.activeStep);
      }
      if (state.serverConfirmed) {
        this._serverConfirmed.set(true);
      }
      if (state.urlConfirmed) {
        this._server.urlConfirmed.set(true);
      }
      if (state.urlSkipped) {
        this._server.urlSkipped.set(true);
      }
      if (state.editionConfirmed) {
        this._server.editionConfirmed.set(true);
      }
      if (state.editionSkipped) {
        this._server.editionSkipped.set(true);
      }
      if (state.selectedEdition) {
        this._server.selectedEdition.set(state.selectedEdition);
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
   * DEV/TESTING ONLY — Mockup controls panel.
   * Shown when ?mockup is in the URL. Lets user testers manipulate
   * wizard state without server access. Will be removed before merge.
   */
  private _buildMockupControls(): DomContents {
    return buildMockupPanel("Mockup controls",
      cssMockupDesc("For user testing only. Append ?no-mockup to the URL to hide this panel."),

      // --- Reset ---
      cssMockupSection("State"),
      cssMockupRow(
        cssMockupButton("Reset all", dom.on("click", () => {
          try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* ok */ }
          this._serverConfirmed.set(false);
          this._server.urlConfirmed.set(false);
          this._server.urlSkipped.set(false);
          this._server.editionConfirmed.set(false);
          this._server.editionSkipped.set(false);
          this._server.selectedEdition.set("community");
          this._sandbox.flavors.set([]);
          this._sandbox.selected.set("");
          this._sandbox.configured.set("");
          this._sandbox.status.set("idle");
          this._sandbox.error.set("");
          this._sandboxConfirmed.set(false);
          this._auth.noAuthAcknowledged.set(false);
          this._auth.status.set("idle");
          this._authConfirmed.set(false);
          this._storageConfirmed.set(false);
          this._storage.backends.set([]);
          this._storage.selected.set("");
          this._storage.status.set("idle");
          this._storage.error.set("");
          this._goLive.status.set("idle");
          this._goLive.error.set("");
          this._activeStep.set(this._steps[0].id);
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

      // --- Force auth results ---
      cssMockupSection("Force auth provider"),
      cssMockupDesc("Simulate an auth provider being configured."),
      cssMockupRow(
        cssMockupButton("OIDC", dom.on("click", () => {
          this._auth.activeProvider.set("oidc");
          this._auth.status.set("ready");
        })),
        cssMockupButton("SAML", dom.on("click", () => {
          this._auth.activeProvider.set("saml");
          this._auth.status.set("ready");
        })),
        cssMockupButton("Forward auth", dom.on("click", () => {
          this._auth.activeProvider.set("forward-auth");
          this._auth.status.set("ready");
        })),
        cssMockupButton("None (boot-key)", dom.on("click", () => {
          this._auth.activeProvider.set("boot-key");
          this._auth.status.set("ready");
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

      // --- Full Grist availability ---
      cssMockupSection("Edition availability"),
      cssMockupDesc("Control whether Full Grist appears as available in the edition selector."),
      cssMockupRow(
        cssMockupButton(
          "Make available",
          dom.on("click", () => this._server.mockFullGristAvailable.set(true)),
        ),
        cssMockupButton(
          "Make unavailable",
          dom.on("click", () => this._server.mockFullGristAvailable.set(false)),
        ),
        cssMockupButton(
          "Use real",
          dom.on("click", () => this._server.mockFullGristAvailable.set(null)),
        ),
      ),

      // --- Single org toggle ---
      cssMockupSection("Single org"),
      cssMockupDesc("Toggle GRIST_SINGLE_ORG note on the pre-launch checklist."),
      cssMockupRow(
        cssMockupButton(
          dom.domComputed(this._permissions.hasSingleOrg, on => on ? "Disable single org" : "Enable single org"),
          dom.on("click", () => this._permissions.hasSingleOrg.set(!this._permissions.hasSingleOrg.get())),
        ),
      ),
    );
  }
}

/**
 * Top-level builder for use in AdminPanel routing.
 * Checks admin auth before rendering the wizard — if the session is
 * invalid, shows a "sign in with boot key" prompt instead of a broken wizard.
 */
export function buildSetupWizard(owner: Disposable, appModel: AppModel) {
  const installAPI = new InstallAPIImpl(getHomeUrl());
  const authed = Observable.create<boolean | null>(owner, null); // null = checking
  installAPI.getInstallPrefs().then(
    () => { if (!authed.isDisposed()) { authed.set(true); } },
    () => { if (!authed.isDisposed()) { authed.set(false); } },
  );
  return dom.domComputed(authed, (ok) => {
    if (ok === null) { return null; } // loading
    if (!ok) {
      return cssSessionExpired(
        dom("p", t("Your session has expired or you are not signed in as an administrator.")),
        dom("p",
          dom("a",
            { href: "/auth/boot-key", style: "font-weight: 600;" },
            t("Sign in with boot key"),
          ),
        ),
        testId("setup-session-expired"),
      );
    }
    return dom.create(SetupWizard, appModel);
  });
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
    background: ${theme.controlPrimaryBg};
    color: white;
    box-shadow: 0 0 0 4px ${theme.controlPrimaryBg}33;
  }
  &-done {
    border-color: #1e7e34;
    background: #e6f4ea;
    color: #1e7e34;
  }
  &-done&-active {
    border-color: ${theme.controlPrimaryBg};
    background: ${theme.controlPrimaryBg};
    color: white;
    box-shadow: 0 0 0 4px ${theme.controlPrimaryBg}33;
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

const cssStepIcon = styled("div", `
  display: flex;
  align-items: center;
  --icon-color: ${theme.controlPrimaryBg};
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

const cssSessionExpired = styled("div", `
  padding: 40px 32px;
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
  color: ${theme.text};
`);
