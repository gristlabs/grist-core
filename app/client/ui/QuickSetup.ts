import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { reportError } from "app/client/models/errors";
import { getHomeUrl } from "app/client/models/homeUrl";
import { cssFadeUp, cssFadeUpGristLogo, cssFadeUpHeading, cssFadeUpSubHeading } from "app/client/ui/AdminPanelCss";
import { BackupsSection } from "app/client/ui/BackupsSection";
import { BaseUrlSection } from "app/client/ui/BaseUrlSection";
import { EditionSection } from "app/client/ui/EditionSection";
import { PendingChangesManager } from "app/client/ui/PendingChanges";
import { PermissionsSetupSection } from "app/client/ui/PermissionsSetupSection";
import { SandboxSetupSection } from "app/client/ui/SandboxSection";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { Stepper } from "app/client/ui2018/Stepper";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";

import { Computed, Disposable, dom, DomContents, makeTestId, observable, Observable, styled } from "grainjs";

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
      completed: Observable.create(this, false),
      buildDom: () => null,
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

  constructor() {
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
      const baseUrl = BaseUrlSection.create(owner);
      const edition = EditionSection.create(owner);
      const pending = PendingChangesManager.create(owner);
      pending.addSection(baseUrl);
      pending.addSection(edition);
      const canProceed = Computed.create(owner, use =>
        use(baseUrl.canProceed) && use(edition.canProceed),
      );
      return dom("div",
        cssStepHeading(
          cssStepHeadingIcon(icon("Home")),
          t("Server"),
        ),
        cssStepDescription(
          t("Set your server's base URL and choose which edition of Grist to run."),
        ),
        cssStepSection(
          cssStepSectionTitle(t("Base URL")),
          baseUrl.buildWizardDom(),
        ),
        cssStepSection(
          cssStepSectionTitle(t("Edition")),
          edition.buildWizardDom(),
        ),
        cssContinueRow(
          bigPrimaryButton(
            dom.text((use) => {
              const urlOk = use(baseUrl.canProceed);
              const edOk = use(edition.canProceed);
              if (!urlOk && !edOk) { return t("Confirm base URL and edition to continue"); }
              if (!urlOk) { return t("Confirm base URL to continue"); }
              if (!edOk) { return t("Confirm edition to continue"); }
              return use(pending.hasPendingChanges) ? t("Apply and Continue") : t("Continue");
            }),
            dom.boolAttr("disabled", use => !use(canProceed) || use(pending.isApplying)),
            dom.on("click", async () => {
              try {
                await pending.applyAll();
                const activeStepIndex = this._activeStep.get();
                this._steps[activeStepIndex].completed.set(true);
                this._activeStep.set(activeStepIndex + 1);
              } catch (err) {
                reportError(err as Error);
              }
            }),
            testId("server-continue"),
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

const cssStepHeading = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
`);

const cssStepHeadingIcon = styled("div", `
  display: flex;
  --icon-color: ${theme.controlPrimaryBg};
`);

const cssStepDescription = styled("div", `
  color: ${tokens.secondary};
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 20px;
`);

const cssStepSection = styled("div", `
  margin-bottom: 24px;
`);

const cssStepSectionTitle = styled("h3", `
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px 0;
`);

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
`);
