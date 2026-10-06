import { makeT } from "app/client/lib/localization";
import { AdminChecks } from "app/client/models/AdminChecks";
import { getHomeUrl } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { buildConfirmedRow, cssDangerText, cssErrorText, cssHappyText } from "app/client/ui/AdminPanelCss";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssValueLabel } from "app/client/ui/SettingsLayout";
import { buildBadge, buildHeroCard, buildItemCard, cssHeroActions, cssItemsContainer } from "app/client/ui/SetupCard";
import { basicButton } from "app/client/ui2018/buttons";
import { testId } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { BackupsBootProbeDetails, getStorageRisks, PersistDataBootProbeDetails } from "app/common/BootProbe";
import { StorageBackendName } from "app/common/ExternalStorage";
import { commonUrls } from "app/common/gristUrls";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { StringUnion } from "app/common/StringUnion";
import { components, tokens } from "app/common/ThemePrefs";

import { Computed, Disposable, dom, DomContents, Observable, styled, UseCBOwner } from "grainjs";

const t = makeT("BackupsSection");

const BackendName = StringUnion(...StorageBackendName.values, "none");
type BackendName = typeof BackendName.type;

interface BackendInfo {
  label: () => string;
  description: () => string;
  disabledTag?: () => string;
}

const STORAGE_BACKENDS: Record<BackendName, BackendInfo> = {
  minio: {
    label: () => t("S3-compatible"),
    description: () => t("Any S3-compatible store with bucket versioning, such as RustFS, or AWS S3 itself."),
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
  filesystem: {
    label: () => t("Local filesystem (test only)"),
    description: () => t("Stores document snapshots on the local filesystem. For tests only, not production."),
  },
  none: {
    label: () => t("No external storage"),
    description: () => t("Documents stored on local disk only."),
  },
};

export interface BackupsSectionProps {
  checks: AdminChecks;
  /** True when rendered in the admin panel; false / absent in the wizard. */
  inAdminPanel?: boolean;
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
 * Renders the storage-persistence card above the backend list, which asks the operator to confirm
 * that Grist's data survives a restart, and shows in red when the "persist-data" probe reports a fault.
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
  private readonly _persistResult = Computed.create(this, (use) => {
    const req = this._props.checks.requestCheckById(use, "persist-data");
    return req ? use(req.result) : undefined;
  });

  private readonly _installAPI = new InstallAPIImpl(getHomeUrl());
  private readonly _prefsLoaded = Observable.create<boolean>(this, false);
  private readonly _adminConfirmed = Observable.create<boolean>(this, false);
  private readonly _checkingLater = Observable.create<boolean>(this, false);

  /**
   * What the persistence card and the Continue button need, derived in plain code in one place.
   * (A chain of computeds that read their inputs conditionally can see stale values in grainjs.)
   * `card` is what to show, if any: a row with the answer ("answered"), or a red ("fault") or
   * grey ("ask") card.
   */
  private readonly _persist = Computed.create(this, (use) => {
    // A failed check request has only an error in its details, so no facts and no risks.
    const details = use(this._persistResult)?.details as PersistDataBootProbeDetails | undefined;
    const risks = details ? getStorageRisks(details) : {};
    const fault = Boolean(risks.docs || risks.home);
    const inMemory = risks.docs === "in-memory" || risks.home === "in-memory";
    // Documents in external storage and a Postgres home database leave nothing on local disk.
    const byConfig = Boolean(details?.externalStorageActive && details?.usesPostgres);
    const confirmed = byConfig || use(this._adminConfirmed);
    // The initial probe value is `{status: "none"}` with no details, so details arriving is
    // what tells us the probe actually ran.
    const loading = !use(this._prefsLoaded) || !details;
    const answered = confirmed || use(this._checkingLater);
    const card = loading || byConfig ? null : answered ? "answered" : fault ? "fault" : "ask";
    return { card, answered, confirmed, fault, inMemory };
  });

  private readonly _persistAnswered = Computed.create(this, use => use(this._persist).answered);

  constructor(private _props: BackupsSectionProps) {
    super();

    this.canProceed = Computed.create(this, use =>
      Boolean(use(this._selectedBackend)) && use(this._persist).answered,
    );

    this._installAPI.getInstallPrefs()
      .then((prefs) => {
        if (this.isDisposed()) { return; }
        this._adminConfirmed.set(Boolean(prefs.persistenceConfirmed));
        this._prefsLoaded.set(true);
      })
      .catch((err) => {
        reportError(err as Error);
        if (this.isDisposed()) { return; }
        this._prefsLoaded.set(true);
      });
  }

  /** Nag shown on the QuickSetup continue button while persistence is unconfirmed. */
  public customLabel(use: UseCBOwner): string | null {
    if (!use(this._selectedBackend)) { return null; }
    return use(this._persist).answered ? null : t("Check storage to continue");
  }

  public async apply(): Promise<void> { /* no-op */ }

  public buildDom() {
    return cssSection(
      this._props.inAdminPanel ? cssDescription(
        t("Store document backups on an external service like S3 or Azure. \
          This protects against data loss if the server's disk fails."),
      ) : quickSetupStepHeader({
        icon: "Database",
        title: t("Backups"),
        description: t("Store document backups on an external service like S3 or Azure. " +
          "This protects against data loss if the server's disk fails."),
      }),
      this._buildPersistenceCard(),
      this._buildBackendCards(),
    );
  }

  public buildStatusDisplay() {
    return dom.domComputed((use) => {
      // Storage that isn't known to be persistent matters more than which backup backend is set.
      const { card, confirmed, fault } = use(this._persist);
      if (card && !confirmed) {
        const verdict = use(this._persistResult)?.verdict;
        return fault ?
          cssValueLabel(
            cssErrorText(t("at risk")),
            verdict ? { title: verdict } : undefined,
            testId("admin-panel-value-label-error"),
          ) :
          cssValueLabel(cssDangerText(t("unconfirmed")), testId("admin-panel-value-label-danger"));
      }
      const backend = use(this._activeBackend);
      if (backend) {
        return cssValueLabel(cssHappyText(STORAGE_BACKENDS[backend].label));
      } else {
        return cssValueLabel(cssDangerText(t("Off")));
      }
    });
  }

  /**
   * The persistence card: red when the probe finds a likely problem, otherwise grey, asking
   * whether storage is persistent (we can never be certain it is). Either answer replaces the
   * card with a row whose pencil brings it back.
   */
  private _buildPersistenceCard() {
    return dom.domComputed(use => use(this._persist).card, (card) => {
      if (!card) { return null; }
      if (card === "answered") {
        return buildConfirmedRow(
          this._persistAnswered,
          () => this._reopenQuestion(),
          {
            skipped: this._checkingLater,
            skippedLabel: t("Will check storage later"),
            confirmedLabel: t("Persistent storage confirmed"),
            testPrefix: "backups-persist",
          },
        );
      }
      const buttons = cssHeroActions(
        basicButton(
          t("My storage is persistent"),
          dom.on("click", () => this._setConfirmed(true)),
          testId("backups-persist-confirm"),
        ),
        basicButton(
          t("I will check later"),
          dom.on("click", () => this._checkingLater.set(true)),
          testId("backups-persist-later"),
        ),
      );
      return card === "fault" ?
        buildHeroCard({
          indicator: "error",
          header: t("Your data may be lost."),
          // Memory is the more urgent of the two risks.
          text: use => use(this._persist).inMemory ?
            t("Grist is storing data in memory. Move it to a disk or volume.") :
            t("Mount a volume at /persist to keep your data."),
          extra: buttons,
          args: [testId("backups-persist-warning")],
        }) :
        buildHeroCard({
          header: t("Is your data on persistent storage?"),
          text: t("Grist can't check this for itself."),
          extra: buttons,
          args: [testId("backups-persist-verify")],
        });
    });
  }

  private _reopenQuestion() {
    this._checkingLater.set(false);
    if (this._adminConfirmed.get()) { void this._setConfirmed(false); }
  }

  private async _setConfirmed(confirmed: boolean) {
    try {
      await this._installAPI.updateInstallPrefs({ persistenceConfirmed: confirmed });
    } catch (err) {
      reportError(err as Error);
      return;
    }
    if (this.isDisposed()) { return; }
    this._adminConfirmed.set(confirmed);
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
        cssItemsContainer(
          enabledBackends.map(name => this._buildBackendCard(name)),
          disabledBackends.map(name => this._buildBackendCard(name, true)),
          this._buildBackendCard("none"),
        ),
        this._buildBackendInstructions(),
      ];
    });
  }

  private _buildBackendCard(name: BackendName, disabled = false): DomContents {
    const disabledTag = disabled ? STORAGE_BACKENDS[name].disabledTag : undefined;
    return buildItemCard({
      radio: {
        checked: use => use(this._selectedBackend) === name,
        onSelect: () => this._selectedBackend.set(name),
        disabled,
      },
      header: STORAGE_BACKENDS[name].label,
      badges: [
        dom.maybe(use => ((use(this._activeBackend) ?? "none") === name), () =>
          buildBadge(t("Active"), "primary")),
        disabledTag ? buildBadge(disabledTag(), "warning") : null,
      ],
      text: STORAGE_BACKENDS[name].description,
    });
  }

  private _buildBackendInstructions() {
    return dom.domComputed((use) => {
      const selected = use(this._selectedBackend);
      if (!selected) { return null; }

      switch (selected) {
        case "minio": {
          return cssInstructions(
            dom("div", t("Set these environment variables and restart Grist to enable S3-compatible storage:")),
            cssCodeBlock(
              "GRIST_DOCS_S3_BUCKET=my-grist-docs\n" +
              "GRIST_DOCS_S3_ENDPOINT=s3.example.com\n" +
              "GRIST_DOCS_S3_ACCESS_KEY=...\n" +
              "GRIST_DOCS_S3_SECRET_KEY=...",
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
