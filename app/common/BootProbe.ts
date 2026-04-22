import { StorageBackendName } from "app/common/ExternalStorage";
import { SandboxInfo } from "app/common/SandboxInfo";

export type BootProbeIds =
  "admins" |
  "boot-key" |
  "health-check" |
  "home-url" |
  "reachable" |
  "host-header" |
  "sandboxing" |
  "system-user" |
  "authentication" |
  "websockets" |
  "session-secret" |
  "service-status" |
  "backups" |
  "sandbox-providers"
;

export interface HomeUrlBootProbeDetails {
  // Effective APP_HOME_URL, or null if unset (server auto-detects from request).
  value: string | null;
  // Where the value came from: "env" (process.env), "db" (activation prefs), or null if unset.
  source: "env" | "db" | null;
}

export interface BootProbeResult {
  verdict?: string;
  // Result of check.
  // "success" is a positive outcome.
  // "none" means no fault detected (but that the test is not exhaustive
  // enough to claim "success").
  // "fault" is a bad error, "warning" a ... warning, "hmm" almost a debug message.
  status: "success" | "fault" | "warning" | "hmm" | "none";
  details?: Record<string, any>;
}

export interface BootProbeInfo {
  id: BootProbeIds;
  name: string;
}

export type SandboxingBootProbeDetails = SandboxInfo;

export interface BackupsBootProbeDetails {
  active: boolean;
  availableBackends: StorageBackendName[];
  backend?: StorageBackendName;
}
