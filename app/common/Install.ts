import {TelemetryLevel} from 'app/common/Telemetry';

export interface InstallPrefs {
  telemetry?: TelemetryPrefs;
}

export interface TelemetryPrefs {
  /** Defaults to "off". */
  telemetryLevel?: TelemetryLevel;
}
