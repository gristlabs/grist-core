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
  "sandbox-providers" |
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

/**
 * Authoritative roll-up of the outgoing-request posture. The client maps
 * this to banner and summary-pill presentation verbatim; it never recomputes
 * from `status` or the proxy fields. "bypassed" means a feature is enabled
 * but GRIST_PROXY_FOR_UNTRUSTED_URLS is "direct", so traffic is sent straight
 * out -- distinct from "filtered".
 */
export type OutgoingRequestsPosture =
  "inactive" |
  "filtered" |
  "bypassed" |
  "review" |
  "unfiltered";

export interface OutgoingRequestsProbeDetails {
  proxy: {
    untrustedConfigured: boolean;
    untrustedDirect: boolean;
    trustedConfigured: boolean;
  };
  checks: OutgoingRequestsFeatureCheck[];
  posture: OutgoingRequestsPosture;
}

/**
 * Env-free inputs to {@link summarizeOutgoingRequests}, gathered from process
 * env by the server probe (BootProbes.ts) or from fixtures by Storybook.
 * Keeping the roll-up pure lets the real probe and the stories share one
 * implementation so the two can't drift.
 */
export interface OutgoingRequestsInput {
  // Whether GRIST_PROXY_FOR_UNTRUSTED_URLS is set at all (including "direct").
  proxyConfigured: boolean;
  // Whether it is set to the explicit "direct" bypass.
  untrustedDirect: boolean;
  // Whether HTTPS_PROXY (for Grist's own requests) is set.
  trustedConfigured: boolean;
  requestFunctionEnabled: boolean;
  allowedWebhookDomains: string[];
  webhookWildcard: boolean;
}

function _featureState(
  enabled: boolean, input: OutgoingRequestsInput,
): OutgoingRequestsFeatureState {
  if (!enabled) { return "off"; }
  if (input.untrustedDirect) { return "on-direct"; }
  return input.proxyConfigured ? "on-proxied" : "on-unproxied";
}

function _requestFunctionCheck(input: OutgoingRequestsInput): OutgoingRequestsFeatureCheck {
  const state = _featureState(input.requestFunctionEnabled, input);
  return {
    id: "request-function",
    state,
    status: state === "on-unproxied" ? "fault" : "success",
  };
}

function _webhooksCheck(input: OutgoingRequestsInput): OutgoingRequestsFeatureCheck {
  const wildcard = input.webhookWildcard;
  const enabled = wildcard || input.allowedWebhookDomains.length > 0;
  const status: BootProbeStatus =
    !enabled ? "success" :
      (wildcard && !input.proxyConfigured) ? "fault" :
        (!wildcard && !input.proxyConfigured) ? "warning" :
          "success";
  return {
    id: "webhooks",
    state: _featureState(enabled, input),
    status,
    allowedDomains: input.allowedWebhookDomains,
    wildcardAllowed: wildcard,
  };
}

// ActiveDoc.fetchURL self-gates on the proxy, so "enabled" here is just
// "a proxy is configured at all". Included for admin visibility of the full
// outgoing-request surface.
function _importFromUrlCheck(input: OutgoingRequestsInput): OutgoingRequestsFeatureCheck {
  return {
    id: "import-from-url",
    state: _featureState(input.proxyConfigured, input),
    status: "success",
  };
}

/**
 * Pure roll-up shared by the server probe and Storybook. Produces the
 * per-feature checks, the overall status, the authoritative posture (the
 * client renders this verbatim), and a human verdict. Reports nothing the
 * runtime doesn't enforce -- a "direct" bypass surfaces as "bypassed", never
 * as "filtered".
 */
export function summarizeOutgoingRequests(input: OutgoingRequestsInput): {
  status: BootProbeStatus;
  verdict: string;
  details: OutgoingRequestsProbeDetails;
} {
  const checks = [_requestFunctionCheck(input), _webhooksCheck(input), _importFromUrlCheck(input)];
  const status = worstStatus(checks.map(c => c.status));
  const anyEnabled = checks.some(c => c.state !== "off");
  const posture: OutgoingRequestsPosture =
    status === "fault" ? "unfiltered" :
      status === "warning" ? "review" :
        !anyEnabled ? "inactive" :
          input.untrustedDirect ? "bypassed" :
            "filtered";
  const verdict =
    posture === "unfiltered" ? "Outgoing-request vectors are enabled without a proxy gate." :
      posture === "review" ? "Outgoing-request vectors are enabled; review proxy configuration." :
        posture === "bypassed" ?
          "Outgoing-request vectors are enabled, but URL filtering is off \
(GRIST_PROXY_FOR_UNTRUSTED_URLS=\"direct\")." :
          "No unprotected outgoing-request vectors detected.";
  return {
    status,
    verdict,
    details: {
      proxy: {
        untrustedConfigured: input.proxyConfigured,
        untrustedDirect: input.untrustedDirect,
        trustedConfigured: input.trustedConfigured,
      },
      checks,
      posture,
    },
  };
}
