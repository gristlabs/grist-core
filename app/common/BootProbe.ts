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
  "host-header" |
  "sandboxing" |
  "system-user" |
  "authentication" |
  "websockets" |
  "session-secret" |
  "service-status" |
  "backups" |
  "sandbox-providers" |
  "persist-data" |
  "outgoing-requests" |
  "multi-server"
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

export type MultiServerKind =
  // One server does everything; no pool to coordinate.
  "single-server" |
  // Documents are assigned to a pool of doc workers, reached by their own urls.
  "worker-pool" |
  // Any server answers for any document, proxying to the one holding it.
  "fleet";

export interface MultiServerEntry {
  id: string;
  internalUrl: string;
  group?: string;
  // Whether the worker is taking new documents, as last recorded. Whether it is still around to
  // take them is `alive`.
  available: boolean;
  documentCount: number;
  // How loaded the worker is, from 0 to 1. Absent for a worker that is not taking documents.
  load?: number;
  // Whether this is the server answering the request.
  self: boolean;
  // Whether the server has said it is still running, within the time it said it would.
  alive: boolean;
  // Ids of other workers with the same address as this one (as compared by findSharedAddresses).
  workerIdsSharingAddress?: string[];
}

export interface MultiServerDescription {
  kind: MultiServerKind;
  // How many servers are registered to hold documents.
  registeredServerCount: number;
  // Whether the server answering is one of those registered. False for a home server that holds no
  // documents. Other home servers do not register, so they cannot be counted.
  selfRegistered: boolean;
  // The registered servers. Absent if the activation key does not include Grist Fleet, or if
  // there is no worker pool.
  servers?: MultiServerEntry[];
  fleet: {
    // Whether the activation key includes Grist Fleet, whether or not GRIST_FLEET is set.
    included: boolean;
    // Whether documents are proxied between servers. Needs Grist Fleet in the activation key,
    // GRIST_FLEET set, and a build that includes the proxy.
    active: boolean;
  };
}

/** A description with the verdict attached, which is what the probe answers with. */
export interface MultiServerBootProbeDetails extends MultiServerDescription {
  situation: MultiServerSituation;
}

export type ServerHealthReason =
  // Another worker has the same address, so requests meant for one reach the other.
  "shared-address" |
  // Has not reported that it is running for too long. The process may be gone, or unable to reach
  // Redis. Its documents cannot be opened meanwhile.
  "stale" |
  // Running, but not taking new documents. Normal mid-shutdown.
  "unavailable" |
  "ok";

/**
 * The health of one server. Used by both the `multi-server` probe and the admin panel.
 */
export function describeServerHealth(server: MultiServerEntry): ServerHealthReason {
  // Checked first: with a shared address, the rest of what is recorded may be about another server.
  if (server.workerIdsSharingAddress?.length) { return "shared-address"; }
  if (!server.alive) { return "stale"; }
  if (!server.available) { return "unavailable"; }
  return "ok";
}

/** How many servers each health reason applies to. */
export function countServerHealth(
  servers: MultiServerEntry[] = [],
): (reason: ServerHealthReason) => number {
  const tally = new Map<ServerHealthReason, number>();
  for (const server of servers) {
    const reason = describeServerHealth(server);
    tally.set(reason, (tally.get(reason) ?? 0) + 1);
  }
  return reason => tally.get(reason) ?? 0;
}

/**
 * The most important thing to tell an admin about the servers. Worked out once here, so that the
 * probe and the admin panel agree.
 */
export type MultiServerSituation =
  // One server does everything, so there is nothing to report on.
  "single-server" |
  // A worker pool, but the activation key does not include Grist Fleet, so servers aren't listed.
  "unlicensed" |
  // A worker pool with no servers registered, so no document can be opened.
  "no-workers" |
  // Some servers share an address.
  "shared-addresses" |
  // Some servers have stopped reporting that they are running.
  "stale-registrations" |
  // GRIST_FLEET is set, but the build has no proxy. Such a server should fail to start, so this is
  // not expected in practice.
  "no-proxy" |
  // Every server registered and taking work.
  "healthy";

/**
 * Picks the situation to report. Checks are ordered so that a fault that could cause others is
 * reported first.
 */
export function diagnoseMultiServer(details: MultiServerDescription): MultiServerSituation {
  if (details.kind === "single-server") { return "single-server"; }
  // Checked before licensing, since it is a fault either way.
  if (details.registeredServerCount === 0) { return "no-workers"; }
  if (!details.fleet.included) { return "unlicensed"; }

  const count = countServerHealth(details.servers);
  if (count("shared-address")) { return "shared-addresses"; }
  if (count("stale")) { return "stale-registrations"; }
  // Draining servers are normal during a rolling restart, so are not reported as a situation.

  // Grist Fleet is included by now, so if it is not active, the build has no proxy.
  if (details.kind === "fleet" && !details.fleet.active) { return "no-proxy"; }
  return "healthy";
}

/**
 * How many servers this installation is known to run: the registered ones, plus the server
 * answering if it is not one of them. A lower bound, since other home servers cannot be counted.
 */
export function knownServerCount(details: MultiServerDescription): number {
  return details.registeredServerCount + (details.selfRegistered ? 0 : 1);
}

/**
 * Whether the installation has more than one server, or a worker pool with none registered.
 * Having Redis alone is not enough, since many single-server installations use it for caching.
 */
export function isMultiServerInstallation(details: MultiServerBootProbeDetails): boolean {
  if (details.kind === "single-server") { return false; }
  return knownServerCount(details) > 1 || details.situation === "no-workers";
}

/**
 * The status and a one-sentence verdict for a situation. Servers are not named here, since
 * `details.servers` lists them.
 */
export function judgeSituation(
  situation: MultiServerSituation, details: MultiServerDescription,
): Pick<BootProbeResult, "status" | "verdict"> {
  const total = details.servers?.length ?? 0;
  const count = countServerHealth(details.servers);
  switch (situation) {
    case "single-server":
      return { status: "none", verdict: "This installation runs one server, with no worker pool." };
    case "unlicensed":
      return {
        status: "none",
        verdict: details.registeredServerCount === 1 ?
          "One server is registered to hold documents, in a worker pool." :
          `${details.registeredServerCount} servers are registered to hold documents, but reporting on ` +
          `them needs an activation key that includes Grist Fleet.`,
      };
    case "no-workers":
      return {
        status: "fault",
        verdict: "A worker pool is configured but no document workers are registered, so no " +
          "document can be opened.",
      };
    case "shared-addresses":
      return {
        status: "fault",
        verdict: `${count("shared-address")} servers share an address with another, so ` +
          `requests for their documents may reach the wrong server and fail.`,
      };
    // Worded so that it reads correctly for any number.
    case "stale-registrations":
      return {
        status: "fault",
        verdict: `${count("stale")} of ${total} registered servers stopped reporting. Their ` +
          `documents cannot be opened.`,
      };
    case "no-proxy":
      return {
        status: "warning",
        verdict: "GRIST_FLEET is set, but this build cannot proxy documents between servers, so " +
          "each one can serve only the documents assigned to it.",
      };
    case "healthy":
      return { status: "success" };
  }
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
