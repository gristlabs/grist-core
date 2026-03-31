import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { cssFadeUp, cssFadeUpGristLogo, cssFadeUpHeading, cssFadeUpSubHeading } from "app/client/ui/AdminPanelCss";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { BackupsSection } from "app/client/ui/BackupsSection";
import { PermissionsSetupSection } from "app/client/ui/PermissionsSetupSection";
import { QuickSetupServerStep } from "app/client/ui/QuickSetupServerStep";
import { SandboxSetupSection } from "app/client/ui/SandboxSection";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { Stepper } from "app/client/ui2018/Stepper";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";

import { Disposable, dom, DomContents, makeTestId, observable, Observable, styled } from "grainjs";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

interface Step {
  completed: Observable<boolean>;
  label: string;
  /** When true, step content card has no border or padding. */
  plain?: boolean;
  buildDom(): DomContents;
}

export class QuickSetup extends Disposable {
  private _activeStep = Observable.create<number>(this, 0);
  private _checks = new AdminChecks(this, new InstallAPIImpl(getHomeUrl()));
  private _steps: Step[] = [
    {
      label: t("Server"),
      completed: Observable.create(this, false),
      buildDom: () => this._buildServerStep(),
    },
    {
      label: t("Sandboxing"),
      completed: observable(false),
      plain: true,
      buildDom: () => {
        const section = SandboxSetupSection.create(
          this, () => this._activeStep.set(this._activeStep.get() + 1),
        );
        return section.buildDom();
      },
    },
    {
      label: t("Authentication"),
      completed: observable(false),
      plain: true,
      buildDom: () => this._buildAuthStep(),
    },
    {
      label: t("Backups"),
      completed: observable(false),
      plain: true,
      buildDom: () => this._buildBackupsStep(),
    },
    {
      label: t("Apply & restart"),
      completed: observable(false),
      plain: true,
      buildDom: () => this._buildApplyStep(),
    },
  ];

  constructor(private _appModel: AppModel) {
    super();
    this._checks.fetchAvailableChecks().catch(reportError);
  }

  public buildDom() {
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
        cssStepContent.cls("-plain", Boolean(this._steps[i].plain)),
        this._steps[i].buildDom(),
      )),
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

  private _buildAuthStep(): DomContents {
    return dom.create((owner) => {
      const section = AuthenticationSection.create(owner, {
        appModel: this._appModel,
        showRestartWarning: false,
      });
      return dom("div",
        section.buildDom(),
        cssContinueRow(
          bigPrimaryButton(
            t("Continue"),
            dom.boolAttr("disabled", use => !use(section.canProceed)),
            dom.on("click", () => {
              const activeStepIndex = this._activeStep.get();
              this._steps[activeStepIndex].completed.set(true);
              this._activeStep.set(activeStepIndex + 1);
            }),
            testId("auth-continue"),
          ),
        ),
      );
    });
  }

  private _buildBackupsStep(): DomContents {
    return dom.create((owner) => {
      const section = BackupsSection.create(owner, { checks: this._checks });
      return dom("div",
        section.buildDom(),
        cssContinueRow(
          bigPrimaryButton(
            t("Continue"),
            dom.boolAttr("disabled", use => !use(section.canProceed)),
            dom.on("click", () => {
              const activeStepIndex = this._activeStep.get();
              this._steps[activeStepIndex].completed.set(true);
              this._activeStep.set(activeStepIndex + 1);
            }),
          ),
        ),
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
  background: ${tokens.bg};
  border: 1px solid ${tokens.decorationSecondary};
  border-radius: 12px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
  margin: 24px auto;
  max-width: 520px;
  padding: 28px 32px;
  &-plain {
    border: none;
    box-shadow: none;
    padding: 0;
    background: none;
  }
`);

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
`);
