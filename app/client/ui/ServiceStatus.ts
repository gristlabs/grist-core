import { makeT } from "app/client/lib/localization";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { AdminChecks } from "app/client/models/AdminChecks";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { saveModal } from "app/client/ui2018/modals";
import { InstallAPI } from "app/common/InstallAPI";

import { Disposable, dom, makeTestId, styled } from "grainjs";

const t = makeT("ServiceStatus");

const testId = makeTestId("test-service-status-");

interface ServiceStatusOptions {
  adminChecks: AdminChecks;
  installAPI: InstallAPI;
}

export class ServiceStatus extends Disposable {
  private _adminChecks = this._options.adminChecks;
  private _installAPI = this._options.installAPI;

  constructor(private _options: ServiceStatusOptions) {
    super();
  }

  public buildDom() {
    return dom.domComputed(
      (use) => {
        const req = this._adminChecks.requestCheckById(use, "service-status");
        const result = req ? use(req.result) : undefined;
        if (!result) {
          return cssCenteredFlexGrow(loadingSpinner());
        }

        const source = result.details?.source;

        return [
          source !== "env" ? [result.details?.inService ?
            bigPrimaryButton(
              t("Enter maintenance mode"),
              dom.on("click", () => this._handleEnterMaintenanceMode()),
              testId("enter-maintenance-mode"),
            ) :
            bigPrimaryButton(
              t("Restore service"),
              dom.on("click", () => this._handleRestoreService()),
              testId("restore-service"),
            ),
          ] : dom("div",
            dom("p",
              cssMarkdownSpan(
                t("This setting is currently being managed by an environment variable (`GRIST_IN_SERVICE`)."),
              ),
            ),
            dom("p",
              cssMarkdownSpan(t("Unset the environment variable to manage this setting via the Admin Panel.")),
            ),
            testId("env-variable-notice"),
          ),
        ];
      },
    );
  }

  private _handleRestoreService() {
    saveModal(() => ({
      title: t("Restore service?"),
      body: [
        dom("p",
          t("Non-admin users will no longer be blocked."),
        ),
      ],
      saveFunc: () => this._toggleServiceStatus(true),
      width: "normal" as const,
      saveLabel: t("Restore service"),
    }));
  }

  private _handleEnterMaintenanceMode() {
    saveModal(() => ({
      title: t("Enter maintenance mode?"),
      body: [
        dom("p",
          t("Non-admin users will be blocked until service is restored."),
        ),
      ],
      saveFunc: () => this._toggleServiceStatus(false),
      width: "normal" as const,
      saveLabel: t("Enter maintenance mode"),
    }));
  }

  private async _toggleServiceStatus(inService: boolean) {
    await this._installAPI.updateInstallPrefs({ envVars: { GRIST_IN_SERVICE: inService } });
    if (this.isDisposed()) { return; }

    await this._adminChecks.reloadChecks();
  }
}

const cssCenteredFlexGrow = styled("div", `
  flex-grow: 1;
  display: flex;
  justify-content: center;
  align-items: center;
`);
