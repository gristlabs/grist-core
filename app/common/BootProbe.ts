import { StorageBackendName } from "app/common/ExternalStorage";
import { SandboxInfo } from "app/common/SandboxInfo";

export type BootProbeStatus = "success" | "fault" | "warning" | "hmm" | "none";

// Lower rank = more urgent. `worstStatus` uses this to roll up sub-checks.
const _STATUS_RANK: Record<BootProbeStatus, number> = {
  fault: 0,
  warning: 1,
  hmm: 2,
  none: 3,
  success: 4,
};

export function worstStatus(statuses: BootProbeStatus[]): BootProbeStatus {
  return statuses.reduce<BootProbeStatus>(
    (acc, s) => (_STATUS_RANK[s] < _STATUS_RANK[acc] ? s : acc),
    "success",
  );
}

export type BootProbeIds =
  "admins" |
  "boot-key" |
  "health-check" |
  "reachable" |
  "host-header" |
  "sandboxing" |
  "system-user" |
  "authentication" |
  "websockets" |
  "session-secret" |
  "service-status" |
  "backups" |
  "outgoing-requests"
;

export interface BootProbeResult {
  verdict?: string;
  // Result of check.
  // "success" is a positive outcome.
  // "none" means no fault detected (but that the test is not exhaustive
  // enough to claim "success").
  // "fault" is a bad error, "warning" a ... warning, "hmm" almost a debug message.
  status: BootProbeStatus;
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

/**
 * Authoritative state of a single outgoing-request feature as reported
 * by the probe. The client renders these verbatim; it does not recompute.
 */
export type OutgoingRequestsFeatureState =
  "off" |
  "on-proxied" |
  "on-unproxied" |
  "on-direct";

export type OutgoingRequestsFeatureId =
  "request-function" |
  "webhooks" |
  "import-from-url";

export interface OutgoingRequestsFeatureCheck {
  id: OutgoingRequestsFeatureId;
  status: BootProbeStatus;
  state: OutgoingRequestsFeatureState;
  allowedDomains?: string[];
  wildcardAllowed?: boolean;
}

export interface OutgoingRequestsProbeDetails {
  proxy: {
    untrustedConfigured: boolean;
    untrustedDirect: boolean;
    trustedConfigured: boolean;
  };
  checks: OutgoingRequestsFeatureCheck[];
}
