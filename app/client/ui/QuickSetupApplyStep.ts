import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import { getHomeUrl } from "app/client/models/homeUrl";
import { ConfigSection, DraftChangeDescription, DraftChangesManager } from "app/client/ui/DraftChanges";
import { HelpUsImproveSection } from "app/client/ui/HelpUsImproveSection";
import { PermissionsSetupSection } from "app/client/ui/PermissionsSetupSection";
import { cssShadowedPrimaryButton } from "app/client/ui/SettingsLayout";
import { bigBasicButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { ApiError } from "app/common/ApiError";
import { commonUrls } from "app/common/gristUrls";
import { not } from "app/common/gutil";
import { HelpUsImproveResponse, HelpUsImproveSubmission } from "app/common/HelpUsImproveAPI";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("QuickSetupApplyStep");
// Kept on the wizard's old prefix so existing .test-permissions-setup-{section,go-live}
// selectors in test/nbrowser/QuickSetupApply.ts continue to find this step's
// container and Go Live button.
const testId = makeTestId("test-permissions-setup-");

type SurveyStatus = "ok" | "retryable" | "unrecoverable";

/**
 * Orchestrates the wizard's "Apply & restart" step: assembles the
 * permissions card and the "Help us improve Grist" survey, owns the
 * Go Live action (apply drafts -> restart -> success page), and
 * fires the survey POST after a successful restart, with a retry
 * button on the success page if the POST fails.
 *
 * Restart logic lives here (not in PermissionsSetupSection) so the
 * permissions section can stay a pure renderer, mirroring how the
 * admin panel consumes the same model via DraftChangesManager.
 */
export class QuickSetupApplyStep extends Disposable {
  private _drafts = DraftChangesManager.create(this);
  private _permissions = PermissionsSetupSection.create(this);
  private _improveForm: HelpUsImproveSection;
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  private _error = Observable.create<string>(this, "");
  // Whether the server has been restarted after saving. Used to switch to the success page.
  private _restarted = Observable.create<boolean>(this, false);

  // Drives the retry section on the success page:
  //  - 'ok'            → section hidden
  //  - 'retryable'     → message + retry button
  //  - 'unrecoverable' → message only, no retry (retrying wouldn't do anything)
  private _surveyStatus = Observable.create<SurveyStatus>(this, "ok");
  // Disables the retry button while a POST is in flight.
  private _surveyRetrying = Observable.create<boolean>(this, false);
  // Tracks response from last attempt to avoid retrying parts that already
  // succeeded or unrecoverably failed. null means the last attempt had no
  // structured response (network error / non-parseable body).
  private _lastResponse = Observable.create<HelpUsImproveResponse | null>(this, null);
  // Cached survey contents to avoid re-fetching any data (e.g. oidc client id)
  private _surveyPayload: HelpUsImproveSubmission | null = null;
  // Guards against resubmitting when the user retries a Go Live that can't restart.
  private _surveySent = false;
  private _surveyMessage = Computed.create(this, (use) => {
    const resp = use(this._lastResponse);
    // No structured response (network / unknown error): both parts retry.
    if (!resp) {
      return t("We couldn't submit your details or your request to be kept up to date. Please try again.");
    }

    const tryAgainMessage = (use(this._surveyStatus) === "unrecoverable") ?
      t("Our servers may be experiencing issues. Please try again later.") :
      t("Please try again.");

    if (resp.persistFailed && !resp.subscribeFailed) {
      return t("We subscribed you for product updates, but couldn't save your other details.") + " " + tryAgainMessage;
    }
    if (!resp.persistFailed && resp.subscribeFailed) {
      return t("We saved your details, but couldn't subscribe you to updates.") + " " + tryAgainMessage;
    }
    return t("We couldn't save your details or subscribe you to updates.") + " " + tryAgainMessage;
  });

  // The auth step has already applied any queued admin-email change (and
  // signed the operator back in as the new admin), so currentValidUser
  // is definitively the install admin by the time we reach this step.
  constructor(appModel: AppModel) {
    super();
    this._improveForm = HelpUsImproveSection.create(this, appModel.currentValidUser?.email ?? "");
    this._drafts.addSection(this._permissions.model);
    // The wizard's Go Live click is what clears the post-setup gate.
    // Modelled as its own ConfigSection so DraftChangesManager always
    // restarts (even when the user changed no permissions) and so the
    // wizard-completion side effect is plainly visible in the drafts list.
    this._drafts.addSection(this._completeSetupSection());
  }

  public buildDom(): DomContents {
    return dom("div",
      testId("section"),
      dom.domComputed(this._restarted, (done) => {
        if (done) { return this._buildSuccessPage(); }
        return dom("div",
          dom.maybe(this._error, err => cssError(err)),
          this._permissions.buildDom({ disabled: this._drafts.isApplying }),
          dom.maybe(commonUrls.helpUsImproveSurvey, () => this._improveForm.buildDom()),
          dom.maybe(this._drafts.isApplying, () =>
            cssRestartingRow(
              loadingSpinner(),
              t("Applying settings and restarting…"),
            ),
          ),
          dom.maybe(not(this._drafts.isApplying), () =>
            cssBottomRow(
              cssGoLiveButton(t("Apply and go live!"),
                dom.boolAttr("disabled", not(this._improveForm.isValid)),
                dom.on("click", () => this._handleGoLive()),
                testId("go-live"),
              ),
            ),
          ),
        );
      }),
    );
  }

  private _completeSetupSection(): ConfigSection {
    return {
      // Always dirty: the wizard step exists to mark setup complete.
      isDirty: Computed.create(this, () => true),
      needsRestart: true,
      describeChange: Computed.create<DraftChangeDescription[]>(this, () => [
        { label: t("Setup completion"), value: "" },
      ]),
      apply: async () => {
        await this._installAPI.updateInstallPrefs({ envVars: { GRIST_IN_SERVICE: "true" } });
      },
    };
  }

  private async _handleGoLive() {
    if (this._drafts.isApplying.get()) { return; }
    this._error.set("");
    try {
      // Applies all sections and restarts the server
      await this._drafts.applyAll();
    } catch (e) {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
      // Sections are applied before the restart is attempted, so a server that can't
      // restart itself has still saved everything else. Send the survey anyway, since
      // the user won't reach the success page that normally sends it.
      if (e instanceof ApiError && e.details?.code === "RestartUnavailable" && !this._surveySent) {
        this._surveySent = true;
        await this._captureSurveyPayload();
        if (this.isDisposed()) { return; }
        void this._submitSurvey();
      }
      return;
    }
    if (this.isDisposed()) { return; }
    // Cache the survey payload while the form is still mounted, then switch
    // to the success page. Retry re-uses this cached payload.
    await this._captureSurveyPayload();
    if (this.isDisposed()) { return; }
    this._surveySent = true;
    this._restarted.set(true);
    void this._submitSurvey();
  }

  private async _captureSurveyPayload() {
    if (!commonUrls.helpUsImproveSurvey) { return; }
    this._surveyPayload = await this._improveForm.getSubmissionData();
  }

  private async _submitSurvey() {
    const surveyUrl = commonUrls.helpUsImproveSurvey ? new URL(commonUrls.helpUsImproveSurvey) : undefined;
    if (!surveyUrl || !this._surveyPayload) { return; }
    this._surveyRetrying.set(true);
    this._surveyStatus.set("ok");
    // Ask the server to skip whatever the last response reported either
    // succeeded OR unrecoverably failed — retry should only re-attempt parts
    // that could still succeed.
    const prev = this._lastResponse.get();
    if (prev && (!prev.persistFailed || prev.persistUnrecoverable)) {
      surveyUrl.searchParams.set("skipPersist", "1");
    }
    if (prev && !prev.subscribeFailed) { surveyUrl.searchParams.set("skipSubscribe", "1"); }
    try {
      const resp = await fetch(surveyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this._surveyPayload),
      });
      // A direct 400 means the client sent something the endpoint refuses
      // (bad payload shape, etc.). Retrying with the same payload won't help.
      // 429 stays retryable so a rate-limited user can try again later.
      if (resp.status === 400) {
        if (this.isDisposed()) { return; }
        this._lastResponse.set(null);
        this._surveyStatus.set("unrecoverable");
        return;
      }
      const body = await resp.json();
      if (this.isDisposed()) { return; }

      const persistFailed = body.persistFailed !== false;
      const persistUnrecoverable = Boolean(body.persistUnrecoverable);
      const subscribeFailed = body.subscribeFailed !== false;
      if (resp.ok && !persistFailed && !subscribeFailed) {
        // Fully done: clear payload so future retries are no-ops.
        this._surveyPayload = null;
        this._lastResponse.set(null);
        return;
      }
      this._lastResponse.set({ persistFailed, persistUnrecoverable, subscribeFailed });
      const persistRetryable = persistFailed && !persistUnrecoverable;
      const subscribeRetryable = subscribeFailed;
      // If any part is still retryable, offer retry; otherwise all failures
      // are unrecoverable and we just tell the user something went wrong.
      this._surveyStatus.set(persistRetryable || subscribeRetryable ? "retryable" : "unrecoverable");
    } catch (e) {
      if (this.isDisposed()) { return; }
      console.warn("Help-us-improve form submission failed", e);
      // Network error / bad JSON: we don't know what the server did. Retry both parts.
      this._lastResponse.set(null);
      this._surveyStatus.set("retryable");
    } finally {
      if (!this.isDisposed()) { this._surveyRetrying.set(false); }
    }
  }

  private _buildSuccessPage(): DomContents {
    return cssSuccessPage(
      cssSparks(),
      cssSuccessTitle(t("Grist is live!")),
      cssSuccessSubtitle(t("Your configuration changes have been applied and the server has been restarted. \
Grist is now in service and available to users.")),
      dom.maybe(use => use(this._surveyStatus) !== "ok", () =>
        cssSurveyRetryBox(
          cssSurveyRetryText(dom.text(this._surveyMessage), testId("survey-retry-message")),
          dom.maybe(use => use(this._surveyStatus) === "retryable", () =>
            bigBasicButton(t("Retry submission"),
              dom.on("click", () => this._submitSurvey()),
              dom.boolAttr("disabled", this._surveyRetrying),
              testId("survey-retry"),
            ),
          ),
        ),
      ),
      bigBasicButton(t("Back to installation"),
        dom.on("click", () => this._goHome()),
        testId("back-to-install"),
      ),
    );
  }

  private _goHome() {
    window.location.href = getHomeUrl(); // avoid using urlState here, as it is meant for team navigation.
  }
}

const cssError = styled("div", `
  background: ${theme.toastErrorBg};
  border-radius: 8px;
  color: white;
  padding: 12px 16px;
  margin-bottom: 16px;
`);

const cssBottomRow = styled("div", `
  display: flex;
  justify-content: stretch;
  margin-top: 24px;
  & > * {
    flex: 1;
  }
`);

const cssRestartingRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 8px;
  font-size: 14px;
`);

const cssGoLiveButton = styled(cssShadowedPrimaryButton, `
  background-color: ${theme.toastSuccessBg};
  border-color: ${theme.toastSuccessBg};
  &:hover {
    background-color: ${theme.toastSuccessBg};
    filter: brightness(0.95);
  }
  &:disabled {
    background-color: ${theme.controlDisabledBg};
    border-color: ${theme.controlDisabledBg};
  }
`);

const cssSuccessPage = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 32px;
  gap: 12px;
`);

const cssSparks = styled("div", `
  height: 48px;
  width: 48px;
  background-image: var(--icon-Sparks);
  display: inline-block;
  background-repeat: no-repeat;
`);

const cssSuccessTitle = styled("div", `
  font-size: 18px;
  font-weight: 600;
`);

const cssSuccessSubtitle = styled("div", `
  font-size: 14px;
  margin-bottom: 16px;
`);

const cssSurveyRetryBox = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 8px;
`);

const cssSurveyRetryText = styled("div", `
  font-size: 13px;
`);
