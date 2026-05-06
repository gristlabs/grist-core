import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { buildAdminAccessDeniedCard } from "app/client/ui/AdminAccessDeniedCard";
import { cssFadeUp, cssFadeUpGristLogo, cssFadeUpHeading, cssFadeUpSubHeading } from "app/client/ui/AdminPanelCss";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { BackupsSection } from "app/client/ui/BackupsSection";
import {
  buildMockupPanel, cssMockupButton, cssMockupDesc, cssMockupRow, cssMockupSection,
} from "app/client/ui/MockupPanel";
import { mockupState, resetMockupState } from "app/client/ui/MockupState";
import { PermissionsSetupSection } from "app/client/ui/PermissionsSetupSection";
import { quickSetupContinueButton } from "app/client/ui/QuickSetupContinueButton";
import { QuickSetupServerStep } from "app/client/ui/QuickSetupServerStep";
import { SandboxSetupSection } from "app/client/ui/SandboxSection";
import { Stepper } from "app/client/ui2018/Stepper";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { Disposable, dom, DomContents, makeTestId, observable, Observable, styled } from "grainjs";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

interface Step {
  completed: Observable<boolean>;
  label: string;
  buildDom(): DomContents;
}

export class QuickSetup extends Disposable {
  private _activeStep = Observable.create<number>(this, 0);
  private _checks = new AdminChecks(this, new InstallAPIImpl(getHomeUrl()));
  // True once `_checks.fetchAvailableChecks()` has settled. Prevents a flash
  // of the access-denied card while probes are still `[]` from initialization.
  private _checksLoaded = Observable.create<boolean>(this, false);
  private _steps: Step[] = [
    {
      label: t("Server"),
      completed: Observable.create(this, false),
      buildDom: () => this._buildServerStep(),
    },
    {
      label: t("Sandboxing"),
      completed: observable(false),
      buildDom: () => this._buildSandboxStep(),
    },
    {
      label: t("Authentication"),
      completed: observable(false),
      buildDom: () => this._buildAuthStep(),
    },
    {
      label: t("Backups"),
      completed: observable(false),
      buildDom: () => this._buildBackupsStep(),
    },
    {
      label: t("Apply & restart"),
      completed: observable(false),
      buildDom: () => this._buildApplyStep(),
    },
  ];

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    if (!this._appModel.currentValidUser) {
      return buildAdminAccessDeniedCard();
    }
    this._checks.fetchAvailableChecks()
      .catch(reportError)
      .finally(() => {
        if (!this.isDisposed()) { this._checksLoaded.set(true); }
      });
    return dom.maybe(this._checksLoaded, () =>
      this._checks.probes.get().length > 0 ?
        this._buildSetupContent() :
        buildAdminAccessDeniedCard(),
    );
  }

  private _buildSetupContent() {
    const hideMockup = new URLSearchParams(window.location.search).has("no-mockup");
    return cssMainContent(
      cssFadeUpGristLogo(),
      cssFadeUpHeading(t("Quick setup")),
      cssFadeUpSubHeading(
        t("Configure Grist for your environment."),
      ),
      cssStepper(
        dom.create(Stepper, { activeStep: this._activeStep, steps: this._steps }),
      ),
      dom.domComputed(this._activeStep, (i) => {
        const step = this._steps[i];
        if (!step) { return null; }
        return cssStepContent(step.buildDom());
      }),
      hideMockup ? null : this._buildMockupControls(),
    );
  }

  /**
   * Marketing-demo controls. Append `?no-mockup` to the URL to hide.
   * Drives the wizard's visible state, the mockup-state singleton (for
   * forcing probe/provider results), and the /api/setup/mockup-* endpoints.
   */
  private _buildMockupControls(): DomContents {
    const bootKeyDisplay = Observable.create<string>(this, "");
    const lastError = Observable.create<string>(this, "");

    const goToStep = (i: number) => {
      // Mark all earlier steps complete so the stepper renders them as done.
      for (let s = 0; s < this._steps.length; s++) {
        this._steps[s].completed.set(s < i);
      }
      this._activeStep.set(i);
    };

    // Re-render the active step so a section picks up new mockup overrides.
    const refreshCurrentStep = () => {
      const i = this._activeStep.get();
      // Toggle to a different value and back to force dom.domComputed to re-fire.
      this._activeStep.set(-1 as any);
      setTimeout(() => this._activeStep.set(i), 0);
    };

    const reset = () => {
      resetMockupState();
      for (const step of this._steps) { step.completed.set(false); }
      this._activeStep.set(0);
    };

    const callMockupApi = async (path: string, options: RequestInit = {}) => {
      try {
        const resp = await fetch(path, {
          headers: { "Content-Type": "application/json", ...(options.headers || {}) },
          ...options,
        });
        if (!resp.ok) {
          const body = await resp.text();
          lastError.set(`${resp.status}: ${body.slice(0, 200)}`);
          return null;
        }
        lastError.set("");
        return resp.json();
      } catch (e) {
        lastError.set(String(e));
        return null;
      }
    };

    // Helper: build a SandboxingStatus override.
    const sandboxOption = (flavor: string, ok: boolean, errorMsg?: string) => ({
      flavor,
      configured: true,
      available: ok,
      effective: ok,
      functional: ok,
      error: errorMsg,
      lastSuccessfulStep: (ok ? "all" : "none") as "all" | "none" | "create" | "use",
    });

    return buildMockupPanel("Mockup controls",
      cssMockupDesc("For user testing only. Append ?no-mockup to the URL to hide this panel."),

      cssMockupSection("Wizard state"),
      cssMockupRow(
        cssMockupButton("Reset all", dom.on("click", reset)),
        cssMockupButton("Mark all done", dom.on("click", () => {
          for (const step of this._steps) { step.completed.set(true); }
          this._activeStep.set(this._steps.length - 1);
        })),
      ),

      cssMockupSection("Jump to step"),
      cssMockupRow(
        ...this._steps.map((step, i) =>
          cssMockupButton(`${i + 1}. ${step.label}`, dom.on("click", () => goToStep(i))),
        ),
      ),

      cssMockupSection("Force sandbox probes"),
      cssMockupDesc(
        "Override probe results without running real sandboxes. Re-enter the Sandbox step to see the effect.",
      ),
      cssMockupRow(
        cssMockupButton("All available", dom.on("click", () => {
          mockupState.sandboxStatus.set({
            current: "gvisor",
            options: [
              sandboxOption("gvisor", true),
              sandboxOption("pyodide", true),
              sandboxOption("macSandboxExec", true),
              sandboxOption("unsandboxed", true),
            ],
          });
          refreshCurrentStep();
        })),
        cssMockupButton("Only gvisor", dom.on("click", () => {
          mockupState.sandboxStatus.set({
            current: "gvisor",
            options: [
              sandboxOption("gvisor", true),
              sandboxOption("pyodide", false, "Pyodide not installed"),
              sandboxOption("macSandboxExec", false, "Not macOS"),
              sandboxOption("unsandboxed", true),
            ],
          });
          refreshCurrentStep();
        })),
        cssMockupButton("None available", dom.on("click", () => {
          mockupState.sandboxStatus.set({
            current: "unsandboxed",
            options: [
              sandboxOption("gvisor", false, "runsc not found"),
              sandboxOption("pyodide", false, "Pyodide not installed"),
              sandboxOption("macSandboxExec", false, "Not macOS"),
              sandboxOption("unsandboxed", true),
            ],
          });
          refreshCurrentStep();
        })),
        cssMockupButton("Use real", dom.on("click", () => {
          mockupState.sandboxStatus.set(null);
          refreshCurrentStep();
        })),
      ),

      cssMockupSection("Force auth provider"),
      cssMockupDesc("Simulate an auth provider being configured. Re-enter the Auth step to see the effect."),
      cssMockupRow(
        cssMockupButton("OIDC", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "OIDC", key: "oidc", isActive: true, isConfigured: true,
          } as any]);
          mockupState.loginSystemId.set("oidc");
          refreshCurrentStep();
        })),
        cssMockupButton("SAML", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "SAML", key: "saml", isActive: true, isConfigured: true,
          } as any]);
          mockupState.loginSystemId.set("saml");
          refreshCurrentStep();
        })),
        cssMockupButton("Forward auth", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "Forwarded headers", key: "forward-auth", isActive: true, isConfigured: true,
          } as any]);
          mockupState.loginSystemId.set("forward-auth");
          refreshCurrentStep();
        })),
        cssMockupButton("None (boot-key)", dom.on("click", () => {
          mockupState.authProviders.set([]);
          mockupState.loginSystemId.set("boot-key");
          refreshCurrentStep();
        })),
      ),
      cssMockupDesc("Simulate getgrist.com states."),
      cssMockupRow(
        cssMockupButton("ggc active", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "Sign in with getgrist.com", key: "getgrist.com",
            isActive: true, isConfigured: true,
          } as any]);
          mockupState.loginSystemId.set("getgrist.com");
          refreshCurrentStep();
        })),
        cssMockupButton("ggc active+error", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "Sign in with getgrist.com", key: "getgrist.com",
            isActive: true, isConfigured: true,
            activeError: "The Identity provider does not propose end_session_endpoint",
          } as any]);
          mockupState.loginSystemId.set("getgrist.com");
          refreshCurrentStep();
        })),
        cssMockupButton("ggc pending", dom.on("click", () => {
          mockupState.authProviders.set([{
            name: "Sign in with getgrist.com", key: "getgrist.com",
            willBeActive: true, isConfigured: true,
          } as any]);
          mockupState.loginSystemId.set("boot-key");
          refreshCurrentStep();
        })),
        cssMockupButton("Use real", dom.on("click", () => {
          mockupState.authProviders.set(null);
          mockupState.loginSystemId.set(null);
          refreshCurrentStep();
        })),
      ),

      cssMockupSection("Force backups probe"),
      cssMockupDesc("Override the backups probe. Re-enter the Backups step to see the effect."),
      cssMockupRow(
        cssMockupButton("MinIO active", dom.on("click", () => {
          mockupState.backups.set({
            active: true,
            availableBackends: ["minio"],
            backend: "minio",
          });
          refreshCurrentStep();
        })),
        cssMockupButton("Nothing configured", dom.on("click", () => {
          mockupState.backups.set({
            active: false,
            availableBackends: ["minio"],
          });
          refreshCurrentStep();
        })),
        cssMockupButton("Use real", dom.on("click", () => {
          mockupState.backups.set(null);
          refreshCurrentStep();
        })),
      ),

      cssMockupSection("Edition availability"),
      cssMockupDesc(
        "Override Full Grist availability. Re-enter the Server step (or Installation page) to see the effect.",
      ),
      cssMockupRow(
        cssMockupButton("Make available", dom.on("click", () => {
          mockupState.fullGristAvailable.set(true);
          refreshCurrentStep();
        })),
        cssMockupButton("Make unavailable", dom.on("click", () => {
          mockupState.fullGristAvailable.set(false);
          refreshCurrentStep();
        })),
        cssMockupButton("Use real", dom.on("click", () => {
          mockupState.fullGristAvailable.set(null);
          refreshCurrentStep();
        })),
      ),

      cssMockupSection("Single org"),
      cssMockupDesc("Toggle the GRIST_SINGLE_ORG warning on the Apply step."),
      cssMockupRow(
        cssMockupButton("Enable", dom.on("click", () => {
          mockupState.singleOrg.set("docs");
          refreshCurrentStep();
        })),
        cssMockupButton("Disable", dom.on("click", () => {
          mockupState.singleOrg.set("");
          refreshCurrentStep();
        })),
        cssMockupButton("Use real", dom.on("click", () => {
          mockupState.singleOrg.set(null);
          refreshCurrentStep();
        })),
      ),

      cssMockupSection("Service status"),
      cssMockupDesc("Flip GRIST_IN_SERVICE on the server. Reload to see the gate appear/disappear."),
      cssMockupRow(
        cssMockupButton("Put in service", dom.on("click", async () => {
          await callMockupApi("/api/setup/mockup-set-in-service", {
            method: "POST",
            body: JSON.stringify({ inService: true }),
          });
        })),
        cssMockupButton("Take out of service", dom.on("click", async () => {
          await callMockupApi("/api/setup/mockup-set-in-service", {
            method: "POST",
            body: JSON.stringify({ inService: false }),
          });
        })),
      ),

      cssMockupSection("Admin email"),
      cssMockupDesc("Sets/clears GRIST_ADMIN_EMAIL on the server (pre-Go-Live only)."),
      cssMockupRow(
        cssMockupButton("Set admin@example.com", dom.on("click", async () => {
          await callMockupApi("/api/setup/mockup-set-admin-email", {
            method: "POST",
            body: JSON.stringify({ email: "admin@example.com" }),
          });
        })),
        cssMockupButton("Clear", dom.on("click", async () => {
          await callMockupApi("/api/setup/mockup-reset-admin-email", { method: "POST" });
        })),
      ),

      cssMockupSection("Boot key"),
      cssMockupRow(
        cssMockupButton("Show boot key", dom.on("click", async () => {
          // Use the variant that's available pre- and post-Go-Live so the
          // demo works regardless of service state.
          const result = await callMockupApi("/api/setup/mockup-boot-key-login");
          if (result) { bootKeyDisplay.set(result.bootKey || "(none)"); }
        })),
      ),
      cssMockupRow(
        dom.maybe(bootKeyDisplay, key => cssMockupDesc(`Boot key: ${key}`)),
      ),

      cssMockupRow(
        dom.maybe(lastError, e => cssMockupDesc(`Error: ${e}`)),
      ),
    );
  }

  private _buildServerStep(): DomContents {
    return dom.create((owner) => {
      const step = QuickSetupServerStep.create(owner, () => this._advanceStep());
      return step.buildDom();
    });
  }

  private _advanceStep() {
    const i = this._activeStep.get();
    this._steps[i].completed.set(true);
    this._activeStep.set(i + 1);
  }

  private _buildSandboxStep(): DomContents {
    return dom.create((owner) => {
      const section = SandboxSetupSection.create(owner);
      return dom("div",
        section.buildDom(),
        quickSetupContinueButton(section, () => this._advanceStep(), testId("sandbox-continue")),
      );
    });
  }

  private _buildAuthStep(): DomContents {
    return dom.create((owner) => {
      const section = AuthenticationSection.create(owner, { appModel: this._appModel });
      return dom("div",
        section.buildDom(),
        quickSetupContinueButton(section, () => this._advanceStep(), testId("auth-continue")),
      );
    });
  }

  private _buildBackupsStep(): DomContents {
    return dom.create((owner) => {
      const section = BackupsSection.create(owner, { checks: this._checks });
      return dom("div",
        section.buildDom(),
        quickSetupContinueButton(section, () => this._advanceStep(), testId("backups-continue")),
      );
    });
  }

  private _buildApplyStep(): DomContents {
    return dom.create((owner) => {
      const section = PermissionsSetupSection.create(owner);
      return section.buildDom();
    });
  }
}

const cssMainContent = styled("div", `
  margin: 0 auto;
  max-width: 640px;
  padding: 56px 24px 64px;
  width: 100%;
`);

const cssStepper = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.24s both;
`);

const cssStepContent = styled("div", `
  animation: ${cssFadeUp} 0.5s ease 0.24s both;
  margin: 24px auto;
  max-width: 520px;
`);
