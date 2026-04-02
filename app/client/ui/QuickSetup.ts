import { makeT } from "app/client/lib/localization";
import { cssFadeUp, cssFadeUpGristLogo, cssFadeUpHeading, cssFadeUpSubHeading } from "app/client/ui/AdminPanelCss";
import { Stepper } from "app/client/ui2018/Stepper";
import { tokens } from "app/common/ThemePrefs";

import { Disposable, dom, DomContents, observable, Observable, styled } from "grainjs";

const t = makeT("QuickSetup");

interface Step {
  completed: Observable<boolean>;
  label: string;
  buildDom(): DomContents;
}

export class QuickSetup extends Disposable {
  private _activeStep = Observable.create<number>(this, 0);
  private _steps: Step[] = [
    {
      label: t("Server"),
      completed: observable(false),
      buildDom: () => null,
    },
    {
      label: t("Sandboxing"),
      completed: observable(false),
      buildDom: () => null,
    },
    {
      label: t("Authentication"),
      completed: observable(false),
      buildDom: () => null,
    },
    {
      label: t("Backups"),
      completed: observable(false),
      buildDom: () => null,
    },
    {
      label: t("Apply & restart"),
      completed: observable(false),
      buildDom: () => null,
    },
  ];

  constructor() {
    super();
  }

  public buildDom() {
    return cssMainContent(
      cssFadeUpGristLogo(),
      cssFadeUpHeading(t("Quick setup")),
      cssFadeUpSubHeading(t("Configure Grist for your environment.")),
      cssStepper(
        dom.create(Stepper, { activeStep: this._activeStep, steps: this._steps }),
      ),
      dom.domComputed(this._activeStep, i => cssStepContent(
        this._steps[i].buildDom(),
      )),
    );
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
`);
