import { TelemetryLevel } from "app/common/Telemetry";

export interface InstallPrefs extends RestartPrefs {
  telemetry?: TelemetryPrefs;
  envVars?: Record<string, any>;
  checkForLatestVersion?: boolean;
}

export interface RestartPrefs {
  /**
   * If set, saves this value to `GRIST_DEFAULT_EMAIL` in `envVars` on server
   * restart.
   *
   * Automatically removed after the changes above are successfully applied.
   *
   * Note: This preference only applies to grist-core.
   */
  onRestartSetDefaultEmail?: string;
  /**
   * If set, looks up the user whose login email matches this value and updates
   * their login email to `onRestartSetDefaultEmail` on server restart. Has
   * no effect if `onRestartSetDefaultEmail` is unset.
   *
   * Automatically removed after the changes above are successfully applied.
   *
   * Note: This preference only applies to grist-core.
   */
  onRestartReplaceEmailWithAdmin?: string;
}

export interface TelemetryPrefs {
  /** Defaults to "off". */
  telemetryLevel?: TelemetryLevel;
}
