import { TelemetryLevel } from "app/common/Telemetry";

export interface InstallPrefs extends PendingChanges {
  telemetry?: TelemetryPrefs;
  envVars?: Record<string, any>;
  checkForLatestVersion?: boolean;
  /**
   * Set once an install admin has confirmed that Grist's storage is persistent.
   * See {@link PersistenceAckPrefs}.
   */
  persistenceAck?: PersistenceAckPrefs;
}

export interface PendingChanges {
  /**
   * If set, saves this value to `GRIST_ADMIN_EMAIL` in `envVars` on server
   * restart.
   *
   * Applied during server initialization in `/stubs/app/server/server.ts`
   * and automatically removed after changes are successfully applied.
   *
   * Set this to `null` to remove this key and cancel a pending change.
   */
  onRestartSetAdminEmail?: string | null;
  /**
   * If set, looks up the user whose login email matches this value and updates
   * their login email to be equal to `GRIST_ADMIN_EMAIL` on server restart.
   *
   * This is primarily intended to be used in tandem with `onRestartSetAdminEmail`
   * to replace the current install admin without changing the user, to preserve
   * any resources they own or have access to. In contrast, setting only
   * `onRestartSetAdminEmail` changes the actual admin user. You can still
   * set `onRestartReplaceEmailWithAdmin` separately after previously setting
   * `onRestartSetAdminEmail` as a basic form of recovery from choosing the
   * wrong option initially.
   *
   * Applied during server initialization in `/stubs/app/server/server.ts`,
   * and automatically removed after changes are successfully applied.
   *
   * Set this to `null` to remove this key and cancel a pending change.
   */
  onRestartReplaceEmailWithAdmin?: string | null;
  /**
   * If set, clears all sessions on server restart.
   */
  onRestartClearSessions?: boolean;
}

/**
 * Records that an install admin confirmed that Grist's storage will survive a
 * restart. `faultKey` is the fingerprint of the fault state that was showing at
 * the time (see `getPersistenceFaultKey` in `app/common/BootProbe.ts`), or null
 * if no fault was showing. Storing the fingerprint means the warning comes back
 * if the deployment changes into a *different* fault state.
 */
export interface PersistenceAckPrefs {
  faultKey: string | null;
}

export interface TelemetryPrefs {
  /** Defaults to "off". */
  telemetryLevel?: TelemetryLevel;
}
