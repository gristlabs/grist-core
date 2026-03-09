import { makeT } from "app/client/lib/localization";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { BootProbeResult } from "app/common/BootProbe";
import { InstallAPI } from "app/common/InstallAPI";

import { Disposable, dom, Observable, styled } from "grainjs";

const t = makeT("StorageConfigurator");

type StorageStatus = "checking" | "available" | "unavailable" | "selectable";

interface StorageBackend {
  name: string;
  status: StorageStatus;
  error?: string;
  bucket?: string;
  endpoint?: string;
}

const STORAGE_CANDIDATES = ["minio", "s3", "azure"];

const STORAGE_META: Record<string, { label: string; desc: string; recommended?: boolean }> = {
  minio: {
    label: t("S3 (MinIO client)"),
    desc: t("S3-compatible storage via MinIO client library. Works with AWS S3, MinIO, and others."),
    recommended: true,
  },
  s3: {
    label: t("S3 (AWS client)"),
    desc: t("S3-compatible storage via native AWS SDK. Supports IAM roles and AWS-native auth."),
  },
  azure: {
    label: t("Azure Blob Storage"),
    desc: t("Microsoft Azure Blob Storage for document snapshots."),
  },
  none: {
    label: t("No External Storage"),
    desc: t("Documents stored on local filesystem only. No off-server backups or versioning."),
  },
};

/**
 * Shared component for probing and selecting external storage.
 * Used by both the setup wizard and the admin panel.
 */
export class StorageConfigurator extends Disposable {
  public readonly backends = Observable.create<StorageBackend[]>(this, []);
  public readonly selected = Observable.create<string>(this, "");
  public readonly status = Observable.create<"idle" | "probing" | "ready">(this, "idle");
  public readonly error = Observable.create<string>(this, "");

  private _installAPI: InstallAPI;

  constructor(installAPI: InstallAPI) {
    super();
    this._installAPI = installAPI;
  }

  /**
   * Probe which external storage backends are available.
   */
  public async probe(): Promise<void> {
    const s = this.status.get();
    if (s === "probing" || s === "ready") { return; }
    this.status.set("probing");
    this.error.set("");
    this.backends.set(STORAGE_CANDIDATES.map(name => ({ name, status: "checking" as StorageStatus })));

    try {
      const result: BootProbeResult = await this._installAPI.runCheck("external-storage");
      if (this.isDisposed()) { return; }
      const details = result.details;
      if (details?.configured && result.status === "success") {
        const backend = details.backend || "minio";
        this._updateBackend(backend, "available", undefined, details.bucket, details.endpoint);
      } else if (details?.configured) {
        const backend = details.backend || "minio";
        this._updateBackend(backend, "unavailable", details.error || t("Validation failed"));
      }
    } catch (e) {
      if (this.isDisposed()) { return; }
      this.error.set((e as Error).message);
    }

    if (this.isDisposed()) { return; }
    // Mark still-checking backends: minio is always selectable, others are unavailable.
    const current = this.backends.get();
    this.backends.set(current.map((b) => {
      if (b.status !== "checking") { return b; }
      if (b.name === "minio") {
        return { ...b, status: "selectable" as StorageStatus };
      }
      return { ...b, status: "unavailable" as StorageStatus };
    }));

    // Append "none" option.
    this.backends.set([...this.backends.get(), { name: "none", status: "available" }]);

    // Pre-select first available real backend.
    const firstAvailable = this.backends.get().find(b => b.status === "available" && b.name !== "none");
    if (firstAvailable) {
      this.selected.set(firstAvailable.name);
    }
    this.status.set("ready");
  }

  /**
   * Build the DOM for the storage configurator. Renders backend cards
   * with radio buttons, status badges, and inline setup instructions.
   *
   * @param options.onContinue — called when the user clicks Continue.
   * @param options.showAction — if false, no button is shown.
   */
  public buildDom(options: { onContinue?: () => void; showAction?: boolean } = {}) {
    const { onContinue, showAction = true } = options;

    return cssConfigurator(
      dom.domComputed(this.backends, (backends) => {
        if (backends.length === 0 && this.status.get() === "probing") {
          return cssBadge(cssBadge.cls("-checking"), t("Checking external storage..."));
        }
        if (backends.length === 0) { return null; }
        return cssBackendList(
          ...backends.map(b => this._buildBackendCard(b)),
        );
      }),
      // Inline setup instructions for selected-but-unconfigured backends.
      dom.domComputed((use) => {
        const sel = use(this.selected);
        const backend = use(this.backends).find(b => b.name === sel);
        if (backend?.status !== "selectable") { return null; }
        return this._buildSetupInstructions(sel);
      }),
      dom.maybe(this.error, err => cssError(err, testId("storage-error"))),
      showAction ? this._buildActionButton(onContinue) : null,
      testId("storage-configurator"),
    );
  }

  /**
   * Build a compact read-only display of the current storage status.
   */
  public buildStatusDisplay() {
    return dom.domComputed(this.status, (status) => {
      if (status === "probing") { return t("checking..."); }
      const sel = this.selected.get();
      if (sel) {
        const meta = STORAGE_META[sel];
        return meta ? meta.label : sel;
      }
      return t("not configured");
    });
  }

  private _updateBackend(
    name: string, status: StorageStatus, error?: string, bucket?: string, endpoint?: string,
  ) {
    const current = this.backends.get();
    this.backends.set(current.map(b =>
      b.name === name ? { name, status, error, bucket, endpoint } : b,
    ));
  }

  private _buildBackendCard(b: StorageBackend) {
    const meta = STORAGE_META[b.name] || { label: b.name, desc: "" };
    const isAvailable = b.status === "available";
    const isSelectable = b.status === "selectable";
    const isChecking = b.status === "checking";
    const isUnavailable = b.status === "unavailable";
    const canSelect = isAvailable || isSelectable;

    return cssBackendCard(
      cssBackendCard.cls("-selected", use => use(this.selected) === b.name),
      cssBackendCard.cls("-disabled", !canSelect && !isChecking),
      canSelect ? dom.on("click", () => this.selected.set(b.name)) : null,
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "storage-backend"),
        dom.attr("value", b.name),
        dom.prop("checked", use => use(this.selected) === b.name),
        dom.prop("disabled", !canSelect),
        canSelect ? dom.on("change", () => this.selected.set(b.name)) : null,
      ),
      cssBackendBody(
        cssBackendNameRow(
          cssBackendName(meta.label),
          meta.recommended ? cssBadge(cssBadge.cls("-recommended"), t("Recommended")) : null,
          isAvailable && b.name !== "none" ? cssBadge(cssBadge.cls("-ok"), t("Available")) : null,
          isSelectable ? cssBadge(cssBadge.cls("-fail"), t("Not configured")) : null,
          isUnavailable ? cssBadge(cssBadge.cls("-fail"), t("Not available")) : null,
          isChecking ? cssBadge(cssBadge.cls("-checking"), t("Checking...")) : null,
        ),
        cssBackendDesc(meta.desc),
        isAvailable && b.bucket ?
          cssBackendDesc(`Bucket: ${b.bucket}${b.endpoint ? ` (${b.endpoint})` : ""}`) : null,
        isUnavailable && b.error ? cssBackendError(b.error) : null,
      ),
      testId(`storage-option-${b.name}`),
    );
  }

  private _buildSetupInstructions(backend: string) {
    if (backend === "minio") {
      return cssInstructions(
        dom("div", t("Set these environment variables and restart Grist to enable MinIO storage:")),
        cssCodeBlock(
          "GRIST_DOCS_MINIO_BUCKET=my-grist-docs\n" +
          "GRIST_DOCS_MINIO_ENDPOINT=s3.amazonaws.com\n" +
          "GRIST_DOCS_MINIO_ACCESS_KEY=...\n" +
          "GRIST_DOCS_MINIO_SECRET_KEY=...",
        ),
        dom("div", t("Works with AWS S3, MinIO, and any S3-compatible storage provider.")),
        testId("storage-instructions"),
      );
    }
    return null;
  }

  private _buildActionButton(onContinue?: () => void) {
    return cssActionButton(
      t("Continue"),
      dom.prop("disabled", use => !use(this.selected)),
      dom.on("click", () => { if (onContinue) { onContinue(); } }),
      testId("storage-continue"),
    );
  }
}

// --- Styles ---

const cssConfigurator = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssBackendList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssBackendCard = styled("div", `
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

const cssBackendBody = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`);

const cssBackendNameRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`);

const cssBackendName = styled("span", `
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

const cssBackendDesc = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
`);

const cssBackendError = styled("div", `
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

const cssInstructions = styled("div", `
  padding: 14px 18px;
  background-color: ${theme.lightHover};
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.5;
`);

const cssCodeBlock = styled("pre", `
  margin: 0;
  padding: 10px 14px;
  background-color: ${theme.inputBg};
  border: 1px solid ${theme.inputBorder};
  border-radius: 6px;
  font-size: 12px;
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  overflow-x: auto;
  line-height: 1.5;
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
