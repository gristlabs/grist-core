import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { SetupWizard } from "app/client/ui/SetupWizard";
import { bigPrimaryButton } from "app/client/ui2018/buttons";

import { Disposable, dom, DomContents, makeTestId } from "grainjs";

const t = makeT("QuickSetup");
const testId = makeTestId("test-quick-setup-");

export class QuickSetup extends Disposable {
  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    return dom.create(SetupWizard, {
      title: t("Quick setup"),
      subtitle: t("Configure Grist for your environment."),
      steps: [
        {
          label: t("Server"),
          buildDom: () => null,
        },
        {
          label: t("Sandboxing"),
          buildDom: () => null,
        },
        {
          label: t("Authentication"),
          plain: true,
          buildDom: (activeStep) => this._buildAuthStep(activeStep),
        },
        {
          label: t("Backups"),
          buildDom: () => null,
        },
        {
          label: t("Apply & restart"),
          buildDom: () => null,
        },
      ],
    });
  }

  private _buildAuthStep(activeStep: import("grainjs").Observable<number>): DomContents {
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
            dom.on("click", () => activeStep.set(activeStep.get() + 1)),
            testId("auth-continue"),
          ),
        ),
      );
    });
  }
}

import { styled } from "grainjs";

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
`);
