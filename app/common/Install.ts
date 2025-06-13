import {TelemetryLevel} from 'app/common/Telemetry';

export interface InstallPrefs {
  telemetry?: TelemetryPrefs;
  checkForLatestVersion?: boolean;
}

export interface TelemetryPrefs {
  /** Defaults to "off". */
  telemetryLevel?: TelemetryLevel;
}
