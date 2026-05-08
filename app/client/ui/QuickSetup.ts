import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { buildAdminAccessDeniedCard } from "app/client/ui/AdminAccessDeniedCard";
import { cssFadeUp, cssFadeUpGristLogo, cssFadeUpHeading, cssFadeUpSubHeading } from "app/client/ui/AdminPanelCss";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { BackupsSection } from "app/client/ui/BackupsSection";
import { DraftChangesManager } from "app/client/ui/DraftChanges";
import { peekSetupReturnFromGetGristCom, SetupReturnStep } from "app/client/ui/GetGristComProvider";
import { PermissionsSetupSection } from "app/client/ui/PermissionsSetupSection";
import { quickSetupContinueButton, QuickSetupSection } from "app/client/ui/QuickSetupContinueButton";
import { QuickSetupServerStep } from "app/client/ui/QuickSetupServerStep";
import { SandboxSetupSection } from "app/client/ui/SandboxSection";
import { Stepper } from "app/client/ui2018/Stepper";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { Disposable, dom, DomContents, makeTestId, observable, Observable, styled } from "grainjs";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

type StepId = SetupReturnStep | "server" | "sandbox" | "backups" | "apply";

interface Step {
  id: StepId;
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
      id: "server",
      label: t("Server"),
      completed: Observable.create(this, false),
      buildDom: () => this._buildServerStep(),
    },
    {
      id: "sandbox",
      label: t("Sandboxing"),
      completed: observable(false),
      buildDom: () => this._buildSandboxStep(),
    },
    {
      id: "auth",
      label: t("Authentication"),
      completed: observable(false),
      buildDom: () => this._buildAuthStep(),
    },
    {
      id: "backups",
      label: t("Backups"),
      completed: observable(false),
      buildDom: () => this._buildBackupsStep(),
    },
    {
      id: "apply",
      label: t("Apply & restart"),
      completed: observable(false),
      buildDom: () => this._buildApplyStep(),
    },
  ];

  constructor(private _appModel: AppModel) {
    super();
    const returnStep = peekSetupReturnFromGetGristCom();
    if (returnStep) { this._jumpToStep(returnStep); }
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
    return cssMainContent(
      cssFadeUpGristLogo(),
      cssFadeUpHeading(t("Quick setup")),
      cssFadeUpSubHeading(
        t("Configure Grist for your environment."),
      ),
      cssStepper(
        dom.create(Stepper, { activeStep: this._activeStep, steps: this._steps }),
      ),
      dom.domComputed(this._activeStep, i => cssStepContent(
        this._steps[i].buildDom(),
      )),
    );
  }

  private _jumpToStep(id: StepId) {
    const target = this._steps.findIndex(s => s.id === id);
    if (target < 0) { return; }
    for (let i = 0; i < target; i++) {
      this._steps[i].completed.set(true);
    }
    this._activeStep.set(target);
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
      // Per-step DraftChangesManager so Continue drives apply+restart like
      // Server/Sandbox steps. In admin panel mode, the section registers
      // with the panel-level manager instead.
      const drafts = DraftChangesManager.create(owner);
      drafts.addSection(section);
      const step: QuickSetupSection = {
        canProceed: section.canProceed,
        isDirty: drafts.hasDraftChanges,
        isApplying: drafts.isApplying,
        apply: () => drafts.applyAll(),
      };
      return dom("div",
        section.buildDom(),
        quickSetupContinueButton(step, () => this._advanceStep(), testId("auth-continue")),
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
