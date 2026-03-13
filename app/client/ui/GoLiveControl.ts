import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { testId, theme, vars } from "app/client/ui2018/cssVars";

import { Disposable, dom, Observable, styled } from "grainjs";

const t = makeT("GoLiveControl");

type GoLiveStatus = "idle" | "working" | "restarting" | "success" | "error";

/**
 * Shared component for the "apply & restart" / "go live" flow.
 * Used by the setup wizard (final step) and the admin panel
 * (maintenance section, when Grist is not yet in service).
 */
export class GoLiveControl extends Disposable {
  public readonly status = Observable.create<GoLiveStatus>(this, "idle");
  public readonly error = Observable.create<string>(this, "");

  /**
   * Restart the server to apply configuration changes.
   * Polls `/status?ready=1` until the server is back.
   */
  public async restart(): Promise<void> {
    this.status.set("working");
    this.error.set("");
    try {
      const resp = await fetch(getHomeUrl() + "/api/admin/restart", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${resp.status}`);
      }
      this.status.set("restarting");
      await this._waitForReady();
      this.status.set("success");
    } catch (e) {
      this.error.set((e as Error).message);
      this.status.set("error");
    }
  }

  /**
   * Bring Grist into service by setting GRIST_IN_SERVICE=true,
   * then restart to apply.
   */
  public async goLive(body?: Record<string, any>): Promise<void> {
    this.status.set("working");
    this.error.set("");
    try {
      const resp = await fetch(getHomeUrl() + "/api/admin/go-live", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `Server returned ${resp.status}`);
      }
      const result = await resp.json();
      if (result.restarting) {
        this.status.set("restarting");
        await this._waitForReady();
      }
      this.status.set("success");
    } catch (e) {
      this.error.set((e as Error).message);
      this.status.set("error");
    }
  }

  /**
   * Build DOM for the go-live / restart control.
   *
   * @param options.mode — "restart" just restarts; "go-live" persists
   *   GRIST_IN_SERVICE and restarts.
   * @param options.canProceed — observable or function returning whether the
   *   action button should be enabled (e.g. "previous steps complete").
   * @param options.onSuccess — called after a successful restart.
   */
  public buildDom(options: {
    mode: "restart" | "go-live";
    canProceed?: Observable<boolean> | (() => boolean);
    onSuccess?: () => void;
    /** Called before go-live to collect extra data for the request body. */
    getBody?: () => Record<string, any>;
  }) {
    const { mode, canProceed, onSuccess, getBody } = options;
    const action = mode === "go-live" ?
      () => this.goLive(getBody?.()) :
      () => this.restart();
    const buttonLabel = mode === "go-live" ? t("Go Live") : t("Apply & Restart");

    return cssGoLiveContainer(
      dom.domComputed(this.status, (status) => {
        if (status === "restarting") {
          return cssStatusMessage(
            cssSpinner(),
            t("Applying settings and restarting..."),
            testId("go-live-restarting"),
          );
        }
        if (status === "success") {
          return [
            cssSuccessBox(
              cssSuccessIcon("\u2713"),
              dom("div",
                dom("b", t("Grist has been restarted.")),
                dom("div", t("Your configuration changes have been applied.")),
              ),
              testId("go-live-success"),
            ),
            onSuccess ? null : bigBasicButton(
              t("Back to installation"),
              dom.on("click", () => { void urlState().pushUrl({ adminPanel: "admin" }); }),
              testId("go-live-admin-link"),
            ),
          ];
        }
        return null;
      }),
      dom.maybe(this.error, err => cssError(err, testId("go-live-error"))),
      dom.domComputed(this.status, (status) => {
        if (status === "success" || status === "restarting") { return null; }
        const busy = status === "working";
        return bigPrimaryButton(
          buttonLabel,
          dom.prop("disabled", (use) => {
            if (busy) { return true; }
            if (!canProceed) { return false; }
            if (canProceed instanceof Observable) { return !use(canProceed); }
            return !canProceed();
          }),
          dom.on("click", async () => {
            await action();
            if (this.status.get() === "success" && onSuccess) {
              onSuccess();
            }
          }),
          testId("go-live-submit"),
        );
      }),
      testId("go-live-control"),
    );
  }

  /**
   * Poll /status?ready=1 until the server is back up.
   */
  private async _waitForReady(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 2000));
    for (let i = 0; i < 30; i++) {
      try {
        const resp = await fetch(getHomeUrl() + "/status?ready=1");
        if (resp.ok) { return; }
      } catch (_) {
        // Network error — server still down, keep polling.
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(t("Timed out waiting for Grist to restart"));
  }
}

// --- Styles ---

const cssGoLiveContainer = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssStatusMessage = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  background-color: ${theme.lightHover};
  border-radius: 8px;
  font-size: 14px;
  color: ${theme.lightText};
`);

const cssSpinner = styled("div", `
  width: 16px;
  height: 16px;
  border: 2px solid ${theme.lightText};
  border-top-color: transparent;
  border-radius: 50%;
  animation: go-live-spin 0.8s linear infinite;

  @keyframes go-live-spin {
    to { transform: rotate(360deg); }
  }
`);

const cssSuccessBox = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background-color: #e6f4ea;
  border-radius: 8px;
  font-size: 14px;
  color: #1e7e34;
`);

const cssSuccessIcon = styled("span", `
  font-size: 20px;
  font-weight: bold;
  flex-shrink: 0;
`);

const cssError = styled("div", `
  padding: 8px 12px;
  background-color: #fce8e6;
  color: #c5221f;
  border-radius: 4px;
  font-size: ${vars.mediumFontSize};
`);
