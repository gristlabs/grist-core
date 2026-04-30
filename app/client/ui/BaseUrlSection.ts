import { makeT } from "app/client/lib/localization";
import { getHomeUrl, reportError } from "app/client/models/AppModel";
import {
  buildConfirmedRow,
  cssHappyText,
  cssSectionButtonRow,
  cssSectionContainer,
  cssSectionDescription,
} from "app/client/ui/AdminPanelCss";
import { cssValueLabel } from "app/client/ui/SettingsLayout";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { InstallAPIImpl } from "app/common/InstallAPI";

import { bundleChanges, Computed, Disposable, dom, DomContents, input, makeTestId,
  Observable, styled } from "grainjs";

const t = makeT("BaseUrlSection");
const testId = makeTestId("test-base-url-");

type UrlStatus = "loading" | "loaded" | "saving" | "saved" | "error";
type TestResult = "idle" | "testing" | "passed" | "failed";

interface BaseUrlSectionOptions {
  /** True when rendered in the admin panel; false / absent in the wizard. */
  inAdminPanel?: boolean;
}

export class BaseUrlSection extends Disposable {
  /**
   * True when the URL has been confirmed (saved or skipped). Used by the wizard
   * to gate the Continue button.
   */
  public canProceed: Computed<boolean>;

  /** True when current state differs from what the server has. */
  public isDirty: Computed<boolean>;

  /** Base URL changes require a server restart to take effect safely. */
  public readonly needsRestart = true;

  private _detectedUrl = window.location.origin;
  // Empty string means the server has no APP_HOME_URL set (client auto-detects).
  private _serverUrl = Observable.create<string>(this, "");
  private _isManuallySet = Computed.create<boolean>(this, use => Boolean(use(this._serverUrl)));
  private _editedUrl = Observable.create<string>(this, "");
  private _status = Observable.create<UrlStatus>(this, "loading");
  private _error = Observable.create<string>(this, "");
  private _urlConfirmed = Observable.create<boolean>(this, false);
  private _urlSkipped = Observable.create<boolean>(this, false);
  private _testedUrlValue = "";
  private _isGrist = false;
  private _testResult = Observable.create<TestResult>(this, "idle");
  private _testError = Observable.create<string>(this, "");
  private _testDetailOpen = Observable.create<boolean>(this, false);
  private _testAbort?: AbortController;

  private _installAPI = new InstallAPIImpl(getHomeUrl());

  constructor(_options: BaseUrlSectionOptions = {}) {
    super();

    this.canProceed = Computed.create(this, use => use(this._urlConfirmed));
    this.isDirty = Computed.create(this, (use) => {
      if (!use(this._urlConfirmed)) { return false; }
      // "Leave automatic" is dirty only when the server currently has a
      // manually-set URL that needs clearing.
      if (use(this._urlSkipped)) { return use(this._isManuallySet); }
      const current = use(this._editedUrl).trim();
      if (!current) { return false; }
      if (current === use(this._serverUrl)) { return false; }
      return true;
    });

    this._editedUrl.addListener((url) => {
      if (this._testResult.get() === "passed" && url.trim() !== this._testedUrlValue) {
        this._testResult.set("idle");
        this._testError.set("");
      }
    });

    this.onDispose(() => this._testAbort?.abort());
    this._load().catch(reportError);
  }

  public async apply() {
    if (!this.isDirty.get()) { return; }
    const skipped = this._urlSkipped.get();
    const url = skipped ? null : this._editedUrl.get().trim();
    await this._persist(url);
    this._serverUrl.set(skipped ? "" : url!);
  }

  public describeChange() {
    if (this._urlSkipped.get()) {
      return [{ label: t("Base URL"), value: t("automatic") }];
    }
    return [{ label: t("Base URL"), value: this._editedUrl.get().trim() }];
  }

  public async dismiss(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    bundleChanges(() => {
      this._resetEdits();
      this._editedUrl.set(this._serverUrl.get());
    });
  }

  public buildStatusDisplay(): DomContents {
    return dom.domComputed((use) => {
      if (use(this._status) === "loading") {
        return cssValueLabel(t("checking"), testId("status"));
      }
      if (use(this._isManuallySet)) {
        return cssValueLabel(cssHappyText(t("set")), testId("status"));
      }
      return cssValueLabel(t("not set"), testId("status"));
    });
  }

  public buildDom(): DomContents { return this._buildSection({ allowSkip: false }); }
  public buildWizardDom(): DomContents { return this._buildSection({ allowSkip: true }); }

  /**
   * Reset draft state back to "not yet confirmed" with a clean test slate.
   * Called both from dismiss and from the Edit button on the confirmed row.
   * Does not touch `_editedUrl` -- the Edit-row case wants to keep what the
   * user typed.
   */
  private _resetEdits() {
    this._urlConfirmed.set(false);
    this._urlSkipped.set(false);
    this._testResult.set("idle");
    this._testError.set("");
    this._testDetailOpen.set(false);
  }

  // allowSkip=true shows a "Leave automatic" button alongside Confirm;
  // in admin-panel mode we don't offer it.
  private _buildSection(opts: { allowSkip: boolean }): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      buildConfirmedRow(this._urlConfirmed, () => this._resetEdits(),
        { skipped: this._urlSkipped, skippedLabel: t("Automatic"), testPrefix: "base-url" }),
      dom.maybe(use => !use(this._urlConfirmed), () => [
        dom.domComputed(this._testResult, result => this._buildTestStatus(result)),
        cssSectionButtonRow(
          dom.domComputed(this._testResult, (result) => {
            if (result !== "passed") {
              return primaryButton(
                t("Test URL"),
                dom.on("click", () => this._testUrl()),
                dom.boolAttr("disabled", use =>
                  use(this._editedUrl).trim() === "" || use(this._testResult) === "testing",
                ),
                testId("test"),
              );
            }
            return primaryButton(
              t("Confirm URL"),
              dom.on("click", () => this._urlConfirmed.set(true)),
              testId("save"),
            );
          }),
          opts.allowSkip ? basicButton(
            t("Leave automatic"),
            dom.on("click", () => {
              this._urlSkipped.set(true);
              this._urlConfirmed.set(true);
            }),
            testId("skip"),
          ) : null,
        ),
      ]),
      testId("section"),
    );
  }

  private _buildCore(): DomContents {
    return [
      cssSectionDescription(
        t("The URL where users and integrations reach this Grist server. \
Auth callbacks, API links, and email notifications all depend on this being correct."),
      ),
      cssUrlRow(
        cssUrlInput(
          this._editedUrl,
          { onInput: true },
          { placeholder: t("https://grist.example.com") },
          dom.boolAttr("disabled", use =>
            use(this._status) === "saving" || use(this._urlConfirmed),
          ),
          testId("input"),
        ),
      ),
      dom.domComputed((use) => {
        if (use(this._status) !== "loaded") { return null; }
        const current = use(this._editedUrl).trim();
        if (!current) { return null; }
        if (current === use(this._serverUrl)) {
          return cssSavedMsg(
            icon("Tick"),
            t("Already set on this server."),
            testId("current-hint"),
          );
        }
        if (!use(this._isManuallySet) && current === this._detectedUrl) {
          return cssWarning(
            icon("Warning"),
            t("This URL was auto-detected — confirm it is correct, then save."),
            testId("not-saved-warning"),
          );
        }
        return null;
      }),
      dom.maybe(
        use => use(this._status) === "error",
        () => cssErrorMsg(
          dom.text(this._error),
          testId("error"),
        ),
      ),
    ];
  }

  private _buildTestStatus(result: TestResult): DomContents {
    if (result === "testing") {
      return cssHint(t("Testing..."), testId("test-status"));
    }
    if (result === "passed") {
      return cssSavedMsg(
        icon("Tick"),
        this._isGrist ? t("Grist is reachable") : t("URL is reachable"),
        testId("test-status"),
      );
    }
    if (result === "failed") {
      // Reset on each render so a fresh failure shows the detail collapsed;
      // the observable is reused (instance field) so we don't leak across
      // repeated failures.
      this._testDetailOpen.set(false);
      const showDetail = this._testDetailOpen;
      const detailId = "base-url-test-error-detail";
      return cssErrorMsg(
        dom("div",
          t("Could not reach server at this URL. "),
          cssDisclosureButton(
            dom.attr("type", "button"),
            dom.attr("aria-expanded", use => use(showDetail) ? "true" : "false"),
            dom.attr("aria-controls", detailId),
            dom.text(use => use(showDetail) ? "\u25BC" : "\u25B6"),
            dom.on("click", () => showDetail.set(!showDetail.get())),
          ),
        ),
        dom.maybe(showDetail, () =>
          dom("div",
            dom.attr("id", detailId),
            dom.style("margin-top", "4px"),
            dom.text(this._testError),
          ),
        ),
        testId("test-status"),
      );
    }
    return null;
  }

  private async _testUrl() {
    const url = this._editedUrl.get().trim();
    if (!url) { return; }
    this._testResult.set("testing");
    this._testError.set("");
    this._testedUrlValue = url;
    // Replace any in-flight test's abort controller so only the latest
    // one's result is applied. Also aborts on disposal via onDispose below.
    this._testAbort?.abort();
    const controller = this._testAbort = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const statusUrl = new URL("status", url.endsWith("/") ? url : url + "/").href;
      const resp = await fetch(statusUrl, { signal: controller.signal });
      if (!resp.ok) { throw new Error(`${resp.status} ${resp.statusText}`); }
      const body = await resp.text();
      if (this.isDisposed() || controller.signal.aborted) { return; }
      this._isGrist = /grist/i.test(body);
      this._testResult.set("passed");
    } catch (err) {
      // Aborted by a superseding call (not by our own timeout): drop the
      // stale error. isDisposed() catches teardown-mid-flight.
      if (this.isDisposed() || (controller.signal.aborted && this._testAbort !== controller)) { return; }
      this._testError.set((err as Error).message || t("Could not reach server"));
      this._testResult.set("failed");
    } finally {
      clearTimeout(timeoutId);
      if (this._testAbort === controller) { this._testAbort = undefined; }
    }
  }

  private async _load() {
    try {
      const result = await this._installAPI.runCheck("home-url");
      if (this.isDisposed()) { return; }
      const value = (result.details?.value as string | null | undefined) ?? "";
      this._serverUrl.set(value);
      this._editedUrl.set(value || this._detectedUrl);
      this._status.set("loaded");
    } catch (err) {
      // Silently continue on error (probe may not exist during early startup).
      if (this.isDisposed()) { return; }
      this._editedUrl.set(this._detectedUrl);
      this._status.set("loaded");
    }
  }

  // url=null clears APP_HOME_URL (revert to auto-detect); url=string pins it.
  private async _persist(url: string | null) {
    this._status.set("saving");
    this._error.set("");
    try {
      await this._installAPI.updateInstallPrefs({ envVars: { APP_HOME_URL: url } });
      if (this.isDisposed()) { return; }
      if (url === null) { this._editedUrl.set(this._detectedUrl); }
      this._status.set("loaded");
    } catch (err) {
      if (this.isDisposed()) { return; }
      this._error.set((err as Error).message || t("Failed to save"));
      this._status.set("error");
      throw err;
    }
  }
}

const cssUrlRow = styled("div", `
  display: flex;
  gap: 8px;
`);

const cssUrlInput = styled(input, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  font-size: ${vars.mediumFontSize};
  height: 42px;
  line-height: 16px;
  width: 100%;
  padding: 13px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  outline: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssHint = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
`);

const cssWarning = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlFg};
  font-size: ${vars.smallFontSize};
`);

const cssErrorMsg = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.smallFontSize};
`);

const cssSavedMsg = styled("div", `
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${theme.controlPrimaryBg};
  font-size: ${vars.smallFontSize};
`);

const cssDisclosureButton = styled(unstyledButton, `
  cursor: pointer;
`);
