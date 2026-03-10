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

// Preference order for auto-selecting the hero recommendation.
const PREFERENCE_ORDER = ["gvisor", "pyodide", "macSandboxExec"];

const FLAVOR_META: Record<string, {
  label: string;
  desc: string;
  heroDesc: string;
  recommended?: boolean;
  warning?: boolean;
}> = {
  gvisor: {
    label: "gVisor",
    desc: t("Fast, battle-tested isolation. Each document's formulas run in their own " +
      "container, separated from each other and the network."),
    heroDesc: t("Your system supports gVisor — the fastest and most battle-tested sandbox. " +
      "Each document's formulas run in their own isolated container, separated from " +
      "each other and the network."),
    recommended: true,
  },
  pyodide: {
    label: "Pyodide",
    desc: t("Works on any platform. Formulas run in WebAssembly — fully compatible " +
      "but slower than gVisor."),
    heroDesc: t("Pyodide runs Python formulas in WebAssembly — it works on any platform with " +
      "no extra setup. Fully compatible with all Grist formulas, though slower than gVisor."),
  },
  macSandboxExec: {
    label: t("macOS Sandbox"),
    desc: t("Uses the built-in macOS sandbox. Good isolation for local use on a Mac."),
    heroDesc: t("Your Mac's built-in sandbox provides good formula isolation. " +
      "Fine for local use — for a production server, gVisor is recommended."),
  },
  unsandboxed: {
    label: t("No Sandbox"),
    desc: t("Formulas have full system access. Only appropriate when you trust " +
      "every document and its authors."),
    heroDesc: "",
    warning: true,
  },
};

/**
 * Shared component for probing and configuring sandbox flavors.
 * Used by both the setup wizard and the admin panel.
 *
 * The UI leads with a "hero" recommendation (the best available sandbox)
 * and collapses alternatives behind a disclosure toggle. This keeps the
 * common case (gVisor available in Docker) to a single click.
 */
export class SandboxConfigurator extends Disposable {
  public readonly flavors = Observable.create<FlavorInfo[]>(this, []);
  public readonly selected = Observable.create<string>(this, "");
  public readonly configured = Observable.create<string>(this, "");
  public readonly status = Observable.create<"idle" | "probing" | "ready" | "saving" | "saved" | "error">(this, "idle");
  public readonly error = Observable.create<string>(this, "");

  private _showAlternatives = Observable.create<boolean>(this, false);
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
    this._showAlternatives.set(false);
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
    } else if (this.status.get() !== "ready") {
      // _updateFlavor may have already set status to "ready" when a
      // top-preference flavor was found. Only finalize if still probing.
      const best = this._bestAvailable();
      if (best) {
        this.selected.set(best);
      } else {
        const hero = this._getHeroFlavor(this.flavors.get());
        if (hero) { this.selected.set(hero.name); }
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
   * Build the DOM for the sandbox configurator.
   *
   * Layout: a hero card for the best available sandbox, with collapsed
   * alternatives beneath. If no real sandbox is available, unsandboxed
   * is shown with a warning.
   */
  public buildDom(options: {
    onContinue?: () => void;
    showAction?: boolean;
    compact?: boolean;
  } = {}) {
    const { onContinue, showAction = true, compact = false } = options;

    if (compact) {
      return this._buildCompactDom();
    }

    return cssConfigurator(
      dom.domComputed((use) => {
        const flavors = use(this.flavors);
        const status = use(this.status);

        if (flavors.length === 0 && status !== "probing") { return null; }

        // While probing, show per-flavor progress.
        if (status === "probing") {
          return this._buildProbingProgress(flavors);
        }

        const hero = this._getHeroFlavor(flavors);
        const alternatives = flavors.filter(f => f.name !== hero?.name);

        return [
          hero ? this._buildHeroCard(hero) : null,
          alternatives.length > 0 ? this._buildAlternativesSection(alternatives) : null,
        ];
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

  /**
   * Compact read-only layout for the admin panel expanded content.
   * Shows a flat list of flavors with status — no cards, no radio
   * buttons, no nested borders.
   */
  private _buildCompactDom() {
    return cssCompactList(
      dom.domComputed((use) => {
        const flavors = use(this.flavors);
        const status = use(this.status);
        const configured = use(this.configured);

        if (flavors.length === 0 && status === "probing") {
          return cssCompactRow(
            cssProbingDot(),
            cssCompactLabel(t("Checking sandbox availability...")),
          );
        }
        if (flavors.length === 0) { return null; }

        // Only show real sandbox flavors (not "unsandboxed") plus the
        // configured one if it's unsandboxed.
        const relevant = flavors.filter(f =>
          f.name !== "unsandboxed" || configured === "unsandboxed",
        );

        return relevant.map((f) => {
          const meta = FLAVOR_META[f.name] || { label: f.name, desc: "" };
          const isCurrent = f.name === configured;
          const isAvailable = f.status === "available";
          const isChecking = f.status === "checking";

          return cssCompactRow(
            cssCompactDot(
              cssCompactDot.cls("-current", isCurrent),
              cssCompactDot.cls("-available", isAvailable && !isCurrent),
              cssCompactDot.cls("-unavailable", !isAvailable && !isChecking),
              cssCompactDot.cls("-checking", isChecking),
            ),
            cssCompactLabel(
              meta.label,
              cssCompactLabel.cls("-current", isCurrent),
            ),
            isCurrent ? cssCompactTag(t("active")) : null,
            isAvailable && !isCurrent ? cssCompactTag(
              cssCompactTag.cls("-available"), t("available"),
            ) : null,
            !isAvailable && !isChecking ?
              cssCompactTag(cssCompactTag.cls("-unavailable"), t("not available")) : null,
            isChecking ? cssCompactTag(cssCompactTag.cls("-checking"), t("checking...")) : null,
          );
        });
      }),
      testId("sandbox-configurator"),
    );
  }

  /**
   * Progress display shown during probing. Each flavor gets a row
   * that updates from "checking" to "available" or "not available"
   * as results arrive.
   */
  private _buildProbingProgress(flavors: FlavorInfo[]) {
    const checked = flavors.filter(f => f.status !== "checking").length;
    const total = flavors.length;
    return cssProbingBox(
      cssProbingHeader(
        cssProbingDot(),
        t("Checking your system ({{checked}} of {{total}})...", { checked, total }),
      ),
      cssProbingList(
        ...flavors.map((f) => {
          const meta = FLAVOR_META[f.name] || { label: f.name };
          return cssProbingRow(
            cssProbingIcon(
              f.status === "checking" ? "\u2022" :
                f.status === "available" ? "\u2713" : "\u2717",
              cssProbingIcon.cls("-checking", f.status === "checking"),
              cssProbingIcon.cls("-ok", f.status === "available"),
              cssProbingIcon.cls("-fail", f.status === "unavailable"),
            ),
            cssProbingLabel(meta.label),
            f.status === "checking" ?
              cssProbingStatus(t("checking...")) :
              f.status === "available" ?
                cssProbingStatus(cssProbingStatus.cls("-ok"), t("available")) :
                cssProbingStatus(cssProbingStatus.cls("-fail"), t("not available")),
          );
        }),
      ),
      cssSkipChecksButton(
        t("Skip checks"),
        dom.on("click", () => this._skipProbing()),
        testId("sandbox-skip-checks"),
      ),
    );
  }

  /**
   * Skip probing and show all options immediately.
   * Marks any still-checking flavors as unavailable.
   */
  private _skipProbing() {
    const current = this.flavors.get();
    this.flavors.set(current.map(f =>
      f.status === "checking" ? { ...f, status: "unavailable" as FlavorStatus } : f,
    ));
    this._appendUnsandboxedIfNeeded();
    const best = this._bestAvailable();
    if (best) {
      this.selected.set(best);
    } else {
      const hero = this._getHeroFlavor(this.flavors.get());
      if (hero) { this.selected.set(hero.name); }
    }
    this.status.set("ready");
  }

  /**
   * Return the best available flavor, but only if every higher-preference
   * flavor has already been resolved.  Returns null if any higher-preference
   * flavor is still "checking" — we can't recommend yet.
   */
  private _bestAvailableIfDecided(): string | null {
    const flavors = this.flavors.get();
    for (const name of PREFERENCE_ORDER) {
      const f = flavors.find(fl => fl.name === name);
      if (!f || f.status === "checking") { return null; }  // still pending — wait
      if (f.status === "available") { return name; }        // resolved and available — recommend
      // "unavailable" — continue to next preference
    }
    return null;
  }

  /** The best available sandbox by preference order, or null. */
  private _bestAvailable(): string | null {
    const flavors = this.flavors.get();
    for (const name of PREFERENCE_ORDER) {
      const f = flavors.find(fl => fl.name === name);
      if (f?.status === "available") { return name; }
    }
    return null;
  }

  /**
   * Pick the flavor to feature as the hero card.
   * Priority: best real sandbox > unsandboxed (only if nothing else).
   */
  private _getHeroFlavor(flavors: FlavorInfo[]): FlavorInfo | null {
    // If a real sandbox is available, hero it.
    for (const name of PREFERENCE_ORDER) {
      const f = flavors.find(fl => fl.name === name);
      if (f?.status === "available") { return f; }
    }
    // Nothing available — hero the unsandboxed option.
    return flavors.find(f => f.name === "unsandboxed") || null;
  }

  private _updateFlavor(name: string, status: FlavorStatus, error?: string) {
    const current = this.flavors.get();
    this.flavors.set(current.map(f =>
      f.name === name ? { name, status, error } : f,
    ));
    if (status === "available") {
      this._appendUnsandboxedIfNeeded();
      if (this.status.get() === "probing") {
        // We can recommend early only if every higher-preference flavor
        // has already been resolved as unavailable.  E.g. if gvisor is
        // still checking, don't jump to pyodide yet.
        const best = this._bestAvailableIfDecided();
        if (best) {
          this.selected.set(best);
          this.status.set("ready");
        }
      }
    }
  }

  private _appendUnsandboxedIfNeeded() {
    const current = this.flavors.get();
    if (current.some(f => f.name === "unsandboxed")) { return; }
    this.flavors.set([...current, { name: "unsandboxed", status: "available" }]);
  }

  /**
   * The hero card — a prominent, pre-selected card for the recommended
   * sandbox. Shows the richer heroDesc text and a colored left accent.
   */
  private _buildHeroCard(f: FlavorInfo) {
    const meta = FLAVOR_META[f.name] || { label: f.name, desc: "", heroDesc: "" };
    const isWarning = !!meta.warning;

    return cssHeroCard(
      cssHeroCard.cls("-warning", isWarning),
      cssHeroCard.cls("-selected", use => use(this.selected) === f.name),
      dom.on("click", () => this.selected.set(f.name)),
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "sandbox-flavor"),
        dom.attr("value", f.name),
        dom.prop("checked", use => use(this.selected) === f.name),
        dom.on("change", () => this.selected.set(f.name)),
      ),
      cssHeroBody(
        cssHeroNameRow(
          cssHeroName(meta.label),
          meta.recommended ? cssBadge(cssBadge.cls("-recommended"), t("Recommended")) : null,
          isWarning ? cssBadge(cssBadge.cls("-warn"), t("Not recommended")) : null,
          f.status === "available" && !isWarning ?
            cssBadge(cssBadge.cls("-ok"), t("Ready")) : null,
        ),
        cssHeroDesc(isWarning && !meta.heroDesc ? meta.desc : (meta.heroDesc || meta.desc)),
      ),
      testId(`sandbox-option-${f.name}`),
    );
  }

  /**
   * Collapsible section listing alternative flavors.
   */
  private _buildAlternativesSection(alternatives: FlavorInfo[]) {
    return cssAlternativesSection(
      cssAlternativesToggle(
        dom.on("click", () => this._showAlternatives.set(!this._showAlternatives.get())),
        dom.text(use => use(this._showAlternatives) ? "\u25BC" : "\u25B6"),
        cssAlternativesToggleText(
          dom.text(use => use(this._showAlternatives) ?
            t("Hide other options") :
            t("Other options...")),
        ),
        testId("sandbox-show-alternatives"),
      ),
      dom.maybe(this._showAlternatives, () =>
        cssAlternativesList(
          ...alternatives.map(f => this._buildAlternativeCard(f)),
        ),
      ),
    );
  }

  /**
   * A compact card for a non-hero alternative.
   */
  private _buildAlternativeCard(f: FlavorInfo) {
    const meta = FLAVOR_META[f.name] || { label: f.name, desc: "", heroDesc: "" };
    const isAvailable = f.status === "available";
    const isChecking = f.status === "checking";
    const isUnavailable = f.status === "unavailable";
    const isWarning = !!meta.warning;
    const isBusy = ["saving"].includes(this.status.get());

    return cssAltCard(
      cssAltCard.cls("-selected", use => use(this.selected) === f.name),
      cssAltCard.cls("-disabled", isChecking || isBusy),
      cssAltCard.cls("-warning", isWarning),
      (!isChecking && !isBusy) ? dom.on("click", () => this.selected.set(f.name)) : null,
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "sandbox-flavor"),
        dom.attr("value", f.name),
        dom.prop("checked", use => use(this.selected) === f.name),
        dom.prop("disabled", isChecking || isBusy),
        (!isChecking && !isBusy) ? dom.on("change", () => this.selected.set(f.name)) : null,
      ),
      cssAltBody(
        cssAltNameRow(
          cssAltName(meta.label),
          isWarning ? cssBadge(cssBadge.cls("-warn"), t("Not recommended")) : null,
          isAvailable && !isWarning ? cssBadge(cssBadge.cls("-ok"), t("Available")) : null,
          isUnavailable ? cssBadge(cssBadge.cls("-fail"), t("Not available")) : null,
          isChecking ? cssBadge(cssBadge.cls("-checking"), t("Checking...")) : null,
        ),
        cssAltDesc(meta.desc),
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
  gap: 16px;
`);

// --- Probing progress ---

const cssProbingBox = styled("div", `
  padding: 18px 22px;
  border: 1.5px solid ${theme.inputBorder};
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`);

const cssProbingHeader = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: ${theme.lightText};
`);

const cssProbingDot = styled("div", `
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${theme.controlFg};
  opacity: 0.5;
  flex-shrink: 0;
  animation: sbxPulse 1.2s ease-in-out infinite;

  @keyframes sbxPulse {
    0%, 100% { opacity: 0.3; transform: scale(0.9); }
    50% { opacity: 0.8; transform: scale(1.1); }
  }
`);

const cssProbingList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 18px;
`);

const cssProbingRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
`);

const cssProbingIcon = styled("span", `
  width: 16px;
  text-align: center;
  font-size: 14px;
  flex-shrink: 0;

  &-checking { color: ${theme.lightText}; }
  &-ok { color: #1e7e34; }
  &-fail { color: #999; }
`);

const cssProbingLabel = styled("span", `
  font-weight: 500;
  min-width: 100px;
`);

const cssProbingStatus = styled("span", `
  font-size: 12px;
  color: ${theme.lightText};

  &-ok { color: #1e7e34; }
  &-fail { color: #999; }
`);

const cssSkipChecksButton = styled("button", `
  align-self: flex-start;
  background: none;
  border: none;
  padding: 2px 0;
  font-size: 12px;
  color: ${theme.lightText};
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition: color 0.15s;

  &:hover {
    color: ${theme.text};
    text-decoration-style: solid;
  }
`);

// --- Hero card: the recommended/best-available option ---

const cssHeroCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 22px;
  border: 1.5px solid ${theme.inputBorder};
  border-left: 4px solid #1a73e8;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: ${theme.controlFg};
    border-left-color: #1a73e8;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  }
  &-selected {
    border-color: ${theme.controlFg};
    border-left-color: #1a73e8;
    background-color: ${theme.lightHover};
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  }
  &-warning {
    border-left-color: #b45309;
  }
  &-warning:hover {
    border-left-color: #b45309;
  }
  &-warning&-selected {
    border-left-color: #b45309;
  }
`);

const cssHeroBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`);

const cssHeroNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`);

const cssHeroName = styled("span", `
  font-weight: 700;
  font-size: 15px;
`);

const cssHeroDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.45;
`);

// --- Alternatives disclosure ---

const cssAlternativesSection = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssAlternativesToggle = styled("button", `
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 2px;
  font-size: 12px;
  color: ${theme.lightText};
  transition: color 0.15s;

  &:hover {
    color: ${theme.controlFg};
  }
`);

const cssAlternativesToggleText = styled("span", `
  font-size: 12px;
`);

const cssAlternativesList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
`);

// --- Alternative cards: compact, visually quieter ---

const cssAltCard = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;

  &:hover:not(&-disabled) {
    border-color: ${theme.controlFg};
  }
  &-selected {
    border-color: ${theme.controlFg};
    background-color: ${theme.lightHover};
  }
  &-disabled {
    opacity: 0.5;
    cursor: default;
    pointer-events: none;
  }
  &-warning {
    border-left: 3px solid #d97706;
  }
`);

const cssAltBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`);

const cssAltNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssAltName = styled("span", `
  font-weight: 600;
  font-size: ${vars.mediumFontSize};
`);

const cssAltDesc = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  line-height: 1.4;
`);

// --- Shared elements ---

const cssRadio = styled("input", `
  margin-top: 3px;
  flex-shrink: 0;
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

// --- Compact mode (admin panel expanded content) ---

const cssCompactList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
`);

const cssCompactRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1;
`);

const cssCompactDot = styled("div", `
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background-color: ${theme.lightText};

  &-current {
    background-color: #1a73e8;
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
  }
  &-available {
    background-color: #1e7e34;
  }
  &-unavailable {
    background-color: #ccc;
  }
  &-checking {
    background-color: ${theme.lightText};
    opacity: 0.4;
    animation: sbxPulse 1.2s ease-in-out infinite;
  }
`);

const cssCompactLabel = styled("span", `
  &-current {
    font-weight: 600;
  }
`);

const cssCompactTag = styled("span", `
  font-size: 11px;
  color: #1a73e8;
  font-weight: 600;

  &-available {
    color: #1e7e34;
  }
  &-unavailable {
    color: #999;
    font-weight: 400;
  }
  &-checking {
    color: ${theme.lightText};
    font-weight: 400;
  }
`);
