import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { BootProbeResult } from "app/common/BootProbe";
import { commonUrls } from "app/common/gristUrls";
import { InstallAPI } from "app/common/InstallAPI";

import { Disposable, dom, Observable, styled } from "grainjs";

const t = makeT("SandboxConfigurator");

/**
 * Sandbox flavor status as returned by the sandbox-availability probe.
 */
type FlavorStatus = "checking" | "available" | "unavailable";

interface FlavorInfo {
  name: string;
  status: FlavorStatus;
  error?: string;
}

const SANDBOX_CANDIDATES = ["gvisor", "pyodide", "macSandboxExec"];

const FLAVOR_META: Record<string, { label: string; desc: string; recommended?: boolean; warning?: boolean }> = {
  gvisor: {
    label: "gVisor",
    desc: t("Strong isolation via Google's container sandbox. Linux only, requires runsc."),
    recommended: true,
  },
  pyodide: {
    label: "Pyodide",
    desc: t("Runs Python in WebAssembly. Works on any platform, no extra install needed."),
  },
  macSandboxExec: {
    label: t("macOS Sandbox"),
    desc: t("Uses the built-in macOS sandbox-exec facility. macOS only."),
  },
  unsandboxed: {
    label: t("No Sandbox"),
    desc: t("Formulas run with full system access. Only use if you trust all document authors."),
    warning: true,
  },
};

/**
 * Shared component for probing and configuring sandbox flavors.
 * Used by both the setup wizard and the admin panel.
 */
export class SandboxConfigurator extends Disposable {
  public readonly flavors = Observable.create<FlavorInfo[]>(this, []);
  public readonly selected = Observable.create<string>(this, "");
  public readonly configured = Observable.create<string>(this, "");
  public readonly status = Observable.create<"idle" | "probing" | "ready" | "saving" | "saved" | "error">(this, "idle");
  public readonly error = Observable.create<string>(this, "");

  private _installAPI: InstallAPI;

  constructor(installAPI: InstallAPI) {
    super();
    this._installAPI = installAPI;
  }

  /**
   * Probe which sandbox flavors are available on this server.
   */
  public async probe(): Promise<void> {
    const s = this.status.get();
    if (s === "probing" || s === "ready") { return; }
    // Allow re-probing even when "saved" — we need the flavor list for
    // the UI cards. The configured state will be preserved from the probe.
    this.status.set("probing");
    this.error.set("");
    this.flavors.set(SANDBOX_CANDIDATES.map(name => ({ name, status: "checking" as FlavorStatus })));

    let serverConfigured = "";
    await Promise.all(SANDBOX_CANDIDATES.map(async (name) => {
      if (this.isDisposed()) { return; }
      try {
        const result: BootProbeResult = await this._installAPI.runCheck(
          `sandbox-availability?flavor=${name}` as any,
        );
        if (this.isDisposed()) { return; }
        const flavorResult = result.details?.flavors?.[0];
        this._updateFlavor(name,
          flavorResult?.available ? "available" : "unavailable",
          flavorResult?.error);
        // The probe includes the currently configured flavor.
        if (result.details?.configured) {
          serverConfigured = result.details.configured;
        }
      } catch (e) {
        if (this.isDisposed()) { return; }
        this._updateFlavor(name, "unavailable", (e as Error).message);
      }
    }));

    if (this.isDisposed()) { return; }
    this._appendUnsandboxedIfNeeded();

    // If a flavor is already configured on the server, restore that state.
    if (serverConfigured) {
      this.configured.set(serverConfigured);
      this.selected.set(serverConfigured);
      this.status.set("saved");
    } else {
      const firstAvailable = this.flavors.get().find(f => f.status === "available");
      if (firstAvailable) {
        this.selected.set(firstAvailable.name);
      }
      this.status.set("ready");
    }
  }

  /**
   * Persist the selected sandbox flavor to the server.
   */
  public async save(): Promise<void> {
    const flavor = this.selected.get();
    if (!flavor) { return; }
    this.status.set("saving");
    this.error.set("");
    try {
      const resp = await fetch(getHomeUrl() + "/api/admin/configure-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ GRIST_SANDBOX_FLAVOR: flavor }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${resp.status}`);
      }
      this.configured.set(flavor);
      this.status.set("saved");
    } catch (e) {
      this.error.set((e as Error).message);
      this.status.set("error");
    }
  }

  /**
   * Build the DOM for the sandbox configurator. Renders flavor cards
   * with radio buttons, status badges, and a configure/continue button.
   *
   * @param options.onContinue — called after successful configuration
   *   (e.g., wizard advances to the next step).
   * @param options.showAction — if false, no button is shown (for read-only contexts).
   */
  public buildDom(options: { onContinue?: () => void; showAction?: boolean } = {}) {
    const { onContinue, showAction = true } = options;

    return cssConfigurator(
      dom.domComputed(this.flavors, (flavors) => {
        if (flavors.length === 0 && this.status.get() === "probing") {
          return cssBadge(cssBadge.cls("-checking"), t("Checking sandbox availability..."));
        }
        if (flavors.length === 0) { return null; }
        return cssFlavorList(
          ...flavors.map(f => this._buildFlavorCard(f)),
        );
      }),
      dom.maybe(this.error, err => cssError(err, testId("sandbox-error"))),
      showAction ? this._buildActionButton(onContinue) : null,
      testId("sandbox-configurator"),
    );
  }

  /**
   * Build a compact read-only display of the current sandbox status,
   * suitable for use as an AdminSectionItem value.
   */
  public buildStatusDisplay() {
    return dom.domComputed(this.status, (status) => {
      if (status === "probing") { return t("checking..."); }
      const conf = this.configured.get();
      if (conf) {
        const meta = FLAVOR_META[conf];
        return meta ? meta.label : conf;
      }
      return t("not configured");
    });
  }

  private _updateFlavor(name: string, status: FlavorStatus, error?: string) {
    const current = this.flavors.get();
    this.flavors.set(current.map(f =>
      f.name === name ? { name, status, error } : f,
    ));
    if (status === "available") {
      this._appendUnsandboxedIfNeeded();
    }
  }

  private _appendUnsandboxedIfNeeded() {
    const current = this.flavors.get();
    if (current.some(f => f.name === "unsandboxed")) { return; }
    this.flavors.set([...current, { name: "unsandboxed", status: "available" }]);
  }

  private _buildFlavorCard(f: FlavorInfo) {
    const meta = FLAVOR_META[f.name] || { label: f.name, desc: "" };
    const isAvailable = f.status === "available";
    const isChecking = f.status === "checking";
    const isUnavailable = f.status === "unavailable";
    const canSelect = isAvailable && !["saving"].includes(this.status.get());

    return cssFlavorCard(
      cssFlavorCard.cls("-selected", use => use(this.selected) === f.name),
      cssFlavorCard.cls("-disabled", !canSelect && !isChecking),
      canSelect ? dom.on("click", () => this.selected.set(f.name)) : null,
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "sandbox-flavor"),
        dom.attr("value", f.name),
        dom.prop("checked", use => use(this.selected) === f.name),
        dom.prop("disabled", !canSelect),
        canSelect ? dom.on("change", () => this.selected.set(f.name)) : null,
      ),
      cssFlavorBody(
        cssFlavorNameRow(
          cssFlavorName(meta.label),
          meta.recommended ? cssBadge(cssBadge.cls("-recommended"), t("Recommended")) : null,
          meta.warning ? cssBadge(cssBadge.cls("-warn"), t("Not recommended")) : null,
          isAvailable && !meta.warning ? cssBadge(cssBadge.cls("-ok"), t("Available")) : null,
          isUnavailable ? cssBadge(cssBadge.cls("-fail"), t("Not available")) : null,
          isChecking ? cssBadge(cssBadge.cls("-checking"), t("Checking...")) : null,
        ),
        cssFlavorDesc(meta.desc),
        isUnavailable && f.error ? cssFlavorError(f.error) : null,
      ),
      testId(`sandbox-option-${f.name}`),
    );
  }

  private _buildActionButton(onContinue?: () => void) {
    return dom.domComputed((use) => {
      const status = use(this.status);
      const selected = use(this.selected);
      const configured = use(this.configured);

      if (!selected) { return null; }

      const needsSave = status !== "saved" || selected !== configured;
      const busy = status === "saving" || status === "probing";

      return cssActionButton(
        needsSave ? t("Configure") : t("Continue"),
        dom.prop("disabled", busy || !selected),
        dom.on("click", async () => {
          if (needsSave) {
            await this.save();
            if (this.status.get() === "saved" && onContinue) {
              onContinue();
            }
          } else if (onContinue) {
            onContinue();
          }
        }),
        testId("sandbox-submit"),
      );
    });
  }
}

/**
 * Build a static description of sandboxing for use in expandedContent.
 * Includes a link to the help docs.
 */
export function buildSandboxingInfo() {
  return [
    dom("div",
      t("Grist allows for very powerful formulas, using Python. \
We recommend setting the environment variable \
GRIST_SANDBOX_FLAVOR to gvisor if your hardware \
supports it (most will), to run formulas in each document \
within a sandbox isolated from other documents and isolated \
from the network."),
    ),
    dom("div", { style: "margin-top: 8px" },
      cssLink({ href: commonUrls.helpSandboxing, target: "_blank" }, t("Learn more.")),
    ),
  ];
}

// --- Styles ---

const cssConfigurator = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssFlavorList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssFlavorCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border: 1.5px solid ${theme.inputBorder};
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;

  &:hover:not(&-disabled) {
    border-color: ${theme.controlFg};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  &-selected {
    border-color: ${theme.controlFg};
    background-color: ${theme.lightHover};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  &-disabled {
    opacity: 0.45;
    cursor: default;
  }
`);

const cssRadio = styled("input", `
  margin-top: 2px;
  flex-shrink: 0;
`);

const cssFlavorBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`);

const cssFlavorNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssFlavorName = styled("span", `
  font-weight: 600;
  font-size: ${vars.mediumFontSize};
`);

const cssBadge = styled("span", `
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;

  &-ok {
    background-color: #e6f4ea;
    color: #1e7e34;
  }
  &-fail {
    background-color: #fce8e6;
    color: #c5221f;
  }
  &-warn {
    background-color: #fef7e0;
    color: #b45309;
  }
  &-checking {
    background-color: #e8eaed;
    color: #5f6368;
  }
  &-recommended {
    background-color: #e8f0fe;
    color: #1a73e8;
  }
`);

const cssFlavorDesc = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
`);

const cssFlavorError = styled("div", `
  font-size: ${vars.smallFontSize};
  color: #c5221f;
  margin-top: 4px;
`);

const cssError = styled("div", `
  padding: 8px 12px;
  background-color: #fce8e6;
  color: #c5221f;
  border-radius: 4px;
  font-size: ${vars.mediumFontSize};
`);

const cssActionButton = styled("button", `
  align-self: flex-start;
  padding: 10px 28px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  color: white;
  background-color: ${theme.controlPrimaryBg};
  letter-spacing: 0.2px;
  transition: background-color 0.15s, transform 0.1s;

  &:hover:not(:disabled) {
    background-color: ${theme.controlPrimaryHoverBg};
  }
  &:active:not(:disabled) {
    transform: scale(0.98);
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`);
