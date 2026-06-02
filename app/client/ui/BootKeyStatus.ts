import { makeT } from "app/client/lib/localization";
import { cssMarkdownSpan } from "app/client/lib/markdown";
import { AdminChecks } from "app/client/models/AdminChecks";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { saveModal } from "app/client/ui2018/modals";
import { InstallAPI } from "app/common/InstallAPI";

import { Disposable, dom, makeTestId, styled } from "grainjs";

const t = makeT("BootKeyStatus");

const testId = makeTestId("test-boot-key-status-");

interface BootKeyStatusOptions {
  adminChecks: AdminChecks;
  installAPI: InstallAPI;
}

export class BootKeyStatus extends Disposable {
  private _adminChecks = this._options.adminChecks;
  private _installAPI = this._options.installAPI;

  constructor(private _options: BootKeyStatusOptions) {
    super();
  }

  public buildDom() {
    return dom.domComputed(
      (use) => {
        const req = this._adminChecks.requestCheckById(use, "boot-key");
        const result = req ? use(req.result) : undefined;
        if (!result) {
          return cssCenteredFlexGrow(loadingSpinner());
        }

        const source = result.details?.source;

        return [
          dom("p",
            t(`Every new Grist installation includes a random boot key: a secret whose value is only \
obtainable by an installation operator.`),
          ),
          dom("p",
            t(`The boot key should only be used as a temporary means of authentication until a more secure and \
robust authentication method is configured via Security Settings → Authentication. We recommend removing the \
boot key once you've finished setting up Grist.`),
          ),
          source !== "env" ? [
            result.details?.disabled ? null :
              bigPrimaryButton(
                t("Remove boot key"),
                dom.on("click", () => this._handleRemoveBootKey()),
                testId("remove-boot-key"),
              ),
          ] : dom("div",
            dom("p",
              cssMarkdownSpan(
                t("This setting is currently being managed by an environment variable (`GRIST_BOOT_KEY`)."),
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

  private _handleRemoveBootKey() {
    saveModal(() => ({
      title: t("Remove boot key?"),
      body: [
        dom("p",
          cssMarkdownSpan(
            t("You will no longer be able to authenticate as the install admin on the `/boot-key` page."),
          ),
        ),
        dom("p",
          cssMarkdownSpan(t("Make sure you have configured an authentication system that lets you sign in as an \
admin before removing the boot key.")),
        ),
      ],
      saveFunc: () => this._removeBootKey(),
      width: "normal" as const,
      saveLabel: t("Remove boot key"),
    }));
  }

  private async _removeBootKey() {
    await this._installAPI.updateInstallPrefs({ envVars: { GRIST_BOOT_KEY: null } });
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
