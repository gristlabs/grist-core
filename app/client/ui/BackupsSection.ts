import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { AdminPanelControls, cssDangerText, cssHappyText } from "app/client/ui/AdminPanelCss";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssCardSurface, cssValueLabel } from "app/client/ui/SettingsLayout";
import { colors } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { BackupsBootProbeDetails } from "app/common/BootProbe";
import { StorageBackendName } from "app/common/ExternalStorage";
import { commonUrls } from "app/common/gristUrls";
import { StringUnion } from "app/common/StringUnion";
import { components, tokens } from "app/common/ThemePrefs";

import { Computed, Disposable, dom, DomContents, Observable, styled, UseCBOwner } from "grainjs";

const t = makeT("BackupsSection");

const BackendName = StringUnion(...StorageBackendName.values, "none");
type BackendName = typeof BackendName.type;

interface BackendInfo {
  label: () => DomContents;
  description: () => DomContents;
  disabledTag?: () => DomContents;
}

const STORAGE_BACKENDS: Record<BackendName, BackendInfo> = {
  minio: {
    label: () => t("S3 (MinIO client)"),
    description: () => t("AWS S3-compatible service via MinIO client library. Works with AWS S3, MinIO, and others."),
  },
  s3: {
    label: () => t("S3 (AWS client)"),
    description: () => t("AWS S3 via native AWS SDK. Supports IAM roles and AWS-native auth."),
    disabledTag: () => t("Available in full edition"),
  },
  azure: {
    label: () => t("Azure Blob Storage"),
    description: () => t("Microsoft Azure Blob Storage via native Azure SDK."),
    disabledTag: () => t("Available in full edition"),
  },
  none: {
    label: () => t("No external storage"),
    description: () => t("Documents stored on local disk only."),
  },
};

export interface BackupsSectionProps {
  checks: AdminChecks;
  /**
   * Present when this section is rendered inside the admin panel. Absent in the
   * setup wizard. Sections use this as the single signal for "am I in the admin
   * panel?" -- it's also the channel through which they report needsRestart.
   *
   * BackupsSection has no restart-required settings of its own, but accepts the
   * option so all sections share one mode flag.
   */
  controls?: AdminPanelControls;
}

/**
 * Renders a list of storage backends for document backups.
 *
 * Enumerates {@link STORAGE_BACKENDS} and builds a selectable card for each backend, showing instructions
 * on how to enable the selected backend. If backups are enabled, the active backend will be marked with an
 * "Active" tag. If a backend is unavailable in the current edition of Grist, it will be disabled and
 * marked with an upgrade required tag (e.g. "Only available in full edition").
 *
 * At this point in time, the list of backends is purely informational: the operator is expected to manually
 * complete the steps to enable a particular backend based on the instructions shown. Typically, this involves
 * setting some environment variables and restarting the Grist server for them to take effect.
 *
 * This component is shared by both AdminPanel and QuickSetup.
 */
export class BackupsSection extends Disposable {
  public readonly canProceed: Computed<boolean>;

  /**
   * Backups is currently informational -- enabling a backend is done out of
   * band by setting env vars and restarting. So nothing is ever pending here
   * and {@link apply} is a no-op. Both are kept as part of the
   * shared {@link QuickSetupSection} shape across all setup steps.
   */
  public readonly isDirty = Computed.create(this, () => false);
  public readonly isApplying = Observable.create<boolean>(this, false);

  private readonly _backupsProbeDetails = Computed.create(this, use => this._getBackupsProbeDetails(use));
  private readonly _activeBackend = Computed.create(this, use => use(this._backupsProbeDetails)?.backend);
  private readonly _availableBackends = Computed.create(this, use => use(this._backupsProbeDetails)?.availableBackends);
  private readonly _selectedBackend = Observable.create<BackendName | undefined>(this, undefined);

  constructor(private _props: BackupsSectionProps) {
    super();

    this.canProceed = Computed.create(this, this._selectedBackend, (_use, backend) => !!backend);
  }

  public async apply(): Promise<void> { /* no-op */ }

  public buildDom() {
    return cssSection(
      this._props.controls ? cssDescription(
        t("Store document backups on an external service like S3 or Azure. \
          This protects against data loss if the server's disk fails."),
      ) : quickSetupStepHeader({
        icon: "Database",
        title: t("Backups"),
        description: t("Store document backups on an external service like S3 or Azure. " +
          "This protects against data loss if the server's disk fails."),
      }),
      this._buildBackendCards(),
    );
  }

  public buildStatusDisplay() {
    return dom.domComputed((use) => {
      const backend = use(this._activeBackend);
      if (backend) {
        return cssValueLabel(cssHappyText(STORAGE_BACKENDS[backend].label));
      } else {
        return cssValueLabel(cssDangerText(t("Off")));
      }
    });
  }

  private _buildBackendCards() {
    return dom.domComputed((use) => {
      const availableBackends = use(this._availableBackends);
      if (availableBackends === undefined) {
        return cssLoading(
          loadingSpinner(),
          t("Loading backup providers..."),
        );
      }

      const enabledBackends = StorageBackendName.values.filter(name => availableBackends.includes(name));
      const disabledBackends = StorageBackendName.values.filter(name => !availableBackends.includes(name));
      return [
        cssBackendCards(
          enabledBackends.map(name => this._buildBackendCard(name)),
          disabledBackends.map(name => this._buildBackendCard(name, true)),
          this._buildBackendCard("none"),
        ),
        this._buildBackendInstructions(),
      ];
    });
  }

  private _buildBackendCard(name: BackendName, disabled = false) {
    return cssBackendCard(
      cssBackendCard.cls("-selected", use => use(this._selectedBackend) === name),
      cssBackendCard.cls("-disabled", disabled),
      disabled ? null : dom.on("click", () => this._selectedBackend.set(name)),
      cssRadio(
        dom.attr("type", "radio"),
        dom.attr("name", "backend"),
        dom.attr("value", name),
        dom.prop("disabled", disabled),
        dom.prop("checked", use => use(this._selectedBackend) === name),
        disabled ? null : dom.on("change", () => this._selectedBackend.set(name)),
      ),
      cssBackendBody(
        cssBackendNameRow(
          cssBackendName(STORAGE_BACKENDS[name].label),
          dom.maybe(use => (use(this._activeBackend) ?? "none") === name, () =>
            cssBackendTag(cssBackendTag.cls("-active"), t("Active")),
          ),
          disabled ? cssBackendTag(cssBackendTag.cls("-disabled"), STORAGE_BACKENDS[name].disabledTag?.()) : null,
        ),
        cssBackendDescription(STORAGE_BACKENDS[name].description),
      ),
    );
  }

  private _buildBackendInstructions() {
    return dom.domComputed((use) => {
      const selected = use(this._selectedBackend);
      if (!selected) { return null; }

      switch (selected) {
        case "minio": {
          return cssInstructions(
            dom("div", t("Set these environment variables and restart Grist to enable MinIO storage:")),
            cssCodeBlock(
              "GRIST_DOCS_MINIO_BUCKET=my-grist-docs\n" +
              "GRIST_DOCS_MINIO_ENDPOINT=s3.amazonaws.com\n" +
              "GRIST_DOCS_MINIO_ACCESS_KEY=...\n" +
              "GRIST_DOCS_MINIO_SECRET_KEY=...",
            ),
            dom("div",
              cssLink(
                { href: commonUrls.helpCloudStorage, target: "_blank" },
                t("Learn more."),
              ),
            ),
          );
        }
        case "s3": {
          return cssInstructions(
            dom("div", t("Set these environment variables and restart Grist to enable S3 storage:")),
            cssCodeBlock(
              "GRIST_DOCS_S3_BUCKET=my-grist-docs\n" +
              "GRIST_DOCS_S3_PREFIX=v1/\n",
            ),
            dom("div",
              cssLink(
                { href: commonUrls.helpCloudStorage, target: "_blank" },
                t("Learn more."),
              ),
            ),
          );
        }
        case "azure": {
          return cssInstructions(
            dom("div", t("Set these environment variables and restart Grist to enable Azure storage:")),
            cssCodeBlock(
              "AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...\n" +
              "GRIST_AZURE_CONTAINER=my-grist-docs\n" +
              "GRIST_AZURE_PREFIX=v1/\n",
            ),
            dom("div",
              cssLink(
                { href: commonUrls.helpCloudStorage, target: "_blank" },
                t("Learn more."),
              ),
            ),
          );
        }
      }
    });
  }

  private _getBackupsProbeDetails(use: UseCBOwner): BackupsBootProbeDetails | undefined {
    const req = this._props.checks.requestCheckById(use, "backups");
    const result = req ? use(req.result) : undefined;
    if (!result) { return undefined; }

    return result.details as BackupsBootProbeDetails | undefined;
  }
}

const cssSection = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 12px;
`);

const cssDescription = styled("div", `
  color: ${tokens.secondary};
  line-height: 1.55;
  margin-bottom: 16px;
`);

const cssLoading = styled("div", `
  align-items: center;
  color: ${tokens.secondary};
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  padding: 48px 32px;
`);

const cssBackendCards = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssBackendCard = styled(cssCardSurface, `
  align-items: flex-start;
  cursor: pointer;
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  transition: border-color 0.2s, background-color 0.2s;

  &:hover {
    border-color: ${tokens.primary};
  }
  &-selected {
    background-color: ${components.lightHover};
    border-color: ${tokens.primary};
  }
  &-disabled {
    border-color: ${tokens.decorationSecondary};
    cursor: not-allowed;
  }
  &-disabled:hover {
    border-color: ${tokens.decorationSecondary};
    box-shadow: none;
  }
`);

const cssRadio = styled("input", `
  cursor: pointer;
  flex-shrink: 0;

  &:disabled {
    cursor: not-allowed;
  }
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

  .${cssBackendCard.className}-disabled & {
    color: ${tokens.secondary};
  }
`);

const cssBackendTag = styled("span", `
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: ${tokens.smallFontSize};
  font-weight: 600;
  letter-spacing: 0.2px;

  &-active {
    background-color: ${tokens.primary};
    color: ${tokens.white};
  }
  &-disabled {
    background-color: ${colors.orange};
    color: white;
  }
`);

const cssBackendDescription = styled("div", `
  color: ${tokens.secondary};
  font-size: ${tokens.smallFontSize};
`);

const cssInstructions = styled("div", `
  padding: 14px 18px;
  background-color: ${components.lightHover};
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  line-height: 1.5;
`);

const cssCodeBlock = styled("pre", `
  margin: 0;
  padding: 10px 14px;
  background-color: ${tokens.bg};
  border: 1px solid ${tokens.decorationTertiary};
  border-radius: 6px;
  font-size: 12px;
  font-family: "SFMono-Regular", "Consolas", "Liberation Mono", "Menlo", monospace;
  overflow-x: auto;
  line-height: 1.5;
`);
