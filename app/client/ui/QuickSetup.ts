import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AppModel, getHomeUrl, reportError } from "app/client/models/AppModel";
import {
  AdminPanelControls,
  cssFadeUp,
  cssFadeUpGristLogo,
  cssFadeUpHeading,
  cssFadeUpSubHeading,
} from "app/client/ui/AdminPanelCss";
import { AuthenticationSection } from "app/client/ui/AuthenticationSection";
import { Stepper } from "app/client/ui2018/Stepper";
import { ConfigAPI } from "app/common/ConfigAPI";
import { InstallAPI, InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";

import { Computed, Disposable, dom, DomContents, observable, Observable, styled } from "grainjs";

const t = makeT("QuickSetup");

interface Step {
  completed: Observable<boolean>;
  label: string;
  /** When true, step content card has no border or padding. */
  plain?: boolean;
  buildDom(): DomContents;
}

export class QuickSetup extends Disposable implements AdminPanelControls {
  // --- Shared plumbing (same pattern as AdminInstallationPanel) -----------
  public needsRestart = Observable.create(this, false);

  private _installAPI: InstallAPI = new InstallAPIImpl(getHomeUrl());
  private _configAPI: ConfigAPI = new ConfigAPI(getHomeUrl());
  private _checks: AdminChecks = new AdminChecks(this, this._installAPI);
  private _authCheck = Computed.create(this, (use) => {
    return this._checks.requestCheckById(use, "authentication");
  });

  private _loginProvider = Computed.create(this, (use) => {
    const req = use(this._authCheck);
    const result = req ? use(req.result) : undefined;
    if (result?.status === "success") {
      return result.details?.provider;
    }
    return undefined;
  });

  // --- Steps -------------------------------------------------------------
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
      buildDom: () => this._buildAuthStep(),
      plain: true,
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

  constructor(private _appModel: AppModel) {
    super();
  }

  public async restartGrist(): Promise<void> {
    await this._configAPI.restartServer();
  }

  public buildDom() {
    this._checks.fetchAvailableChecks().catch(reportError);

    return cssMainContent(
      cssFadeUpGristLogo(),
      cssFadeUpHeading(t("Quick setup")),
      cssFadeUpSubHeading(t("Configure Grist for your environment.")),
      cssStepper(
        dom.create(Stepper, { activeStep: this._activeStep, steps: this._steps }),
      ),
      dom.domComputed(this._activeStep, i => cssStepContent(
        cssStepContent.cls("-plain", Boolean(this._steps[i].plain)),
        this._steps[i].buildDom(),
      )),
    );
  }

  // --- Step builders -----------------------------------------------------

  private _buildAuthStep(): DomContents {
    return dom.create(AuthenticationSection, {
      appModel: this._appModel,
      loginSystemId: this._loginProvider,
      controls: this,
      installAPI: this._installAPI,
      showRestartWarning: false,
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
