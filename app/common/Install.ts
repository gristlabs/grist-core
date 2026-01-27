import { TelemetryLevel } from "app/common/Telemetry";

export interface InstallPrefs {
  telemetry?: TelemetryPrefs;
  envVars?: Record<string, any>;
  checkForLatestVersion?: boolean;
  onRestartSetDefaultEmail?: string;
  onRestartReplaceEmailWithAdmin?: string;
}

export interface TelemetryPrefs {
  /** Defaults to "off". */
  telemetryLevel?: TelemetryLevel;
}
