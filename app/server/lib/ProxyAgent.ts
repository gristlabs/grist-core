import { appSettings } from "app/server/lib/AppSettings";
import log from "app/server/lib/log";

import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";

import fetch, { RequestInit } from "node-fetch";
import { ProxyAgent, ProxyAgentOptions } from "proxy-agent";
import { useAgent } from "request-filtering-agent";

/**
 * GristProxyAgent derives from ProxyAgent which is a class that is responsible for proxying the request using either
 * HttpProxyAgent or HttpsProxyAgent (or other supported proxy agents)
 * depending on the URL requested when using fetch().
 *
 * We configure the getProxyForUrl to not let ProxyAgent magically read the env variables
 * itself (using `proxy-from-env` module), we already do that ourselves and need to keep the control for that.
 */
export class GristProxyAgent extends ProxyAgent {
  constructor(public readonly proxyUrl: string, opts?: Omit<ProxyAgentOptions, "getProxyForUrl">) {
    super({
      ...opts,
      getProxyForUrl: () => this.proxyUrl,
    });
  }
}

export function getProxyAgentConfiguration() {
  const proxyForTrustedRequestsUrl = appSettings.section("proxy").readString({
    envVar: ["HTTPS_PROXY", "https_proxy"],
    preferredEnvVar: "HTTPS_PROXY",
  });

  const proxyForUntrustedRequestsUrl = appSettings.section("proxy").readString({
    envVar: ["GRIST_PROXY_FOR_UNTRUSTED_URLS", "GRIST_HTTPS_PROXY"],
    preferredEnvVar: "GRIST_PROXY_FOR_UNTRUSTED_URLS",
  });

  return {
    proxyForTrustedRequestsUrl,
    proxyForUntrustedRequestsUrl,
  };
}

function generateProxyAgents() {
  const { proxyForTrustedRequestsUrl, proxyForUntrustedRequestsUrl } = getProxyAgentConfiguration();

  if (process.env.GRIST_HTTPS_PROXY) {
    log.warn("GRIST_HTTPS_PROXY is deprecated in favor of GRIST_PROXY_FOR_UNTRUSTED_URLS. " +
      `Please rather set GRIST_PROXY_FOR_UNTRUSTED_URLS="${proxyForUntrustedRequestsUrl}"`);
  }

  return {
    trusted: proxyForTrustedRequestsUrl ? new GristProxyAgent(proxyForTrustedRequestsUrl) : undefined,
    untrusted: (proxyForUntrustedRequestsUrl && proxyForUntrustedRequestsUrl !== "direct") ?
      new GristProxyAgent(proxyForUntrustedRequestsUrl) : undefined,
  };
}

/**
 *
 * Check whether there is explicit proxy configuration for untrusted
 * requests (regardless of whether it is to set a proxy, or to use
 * direct requests)
 *
 */
export function isUntrustedRequestBehaviorSet() {
  const config = getProxyAgentConfiguration();
  return config.proxyForUntrustedRequestsUrl !== undefined;
}

export const test_generateProxyAgents = generateProxyAgents;

// Instantiate all the possible agents at startup.
export const agents = generateProxyAgents();

/**
 * Thrown when a request to a user-supplied URL is refused by our own
 * safeguards: either a caller-supplied validator rejected the URL, or the
 * target resolved to an internal-network address that we block by default.
 *
 * Distinct from ordinary transport errors so callers (notably the webhook
 * retry loop) can treat it as terminal rather than retrying.
 */
export class UntrustedUrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntrustedUrlBlockedError";
  }
}

/**
 * Whether requests to internal-network targets (loopback, link-local,
 * private, CGNAT, reserved addresses) are permitted. Off by default; an
 * operator opts in explicitly. Evaluated per call so a DB-backed setting
 * update is respected without a restart.
 */
export function isPrivateNetworkTargetAllowed(): boolean {
  return Boolean(appSettings.section("proxy").flag("allowPrivateNetworkTargets").readBool({
    envVar: "GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS",
    defaultValue: false,
  }));
}

// Shared plain agents for the opt-out ("allow private targets") path, where we
// want ordinary transport with no connection filtering.
const httpPassthrough = new HttpAgent();
const httpsPassthrough = new HttpsAgent();

/**
 * Choose the transport agent for a single request hop.
 * - With a configured proxy, the proxy owns egress policy, so we route
 *   through it and apply no internal-network block of our own.
 * - When internal-network targets are explicitly allowed, use a plain agent.
 * - Otherwise, wrap the connection in request-filtering-agent, whose
 *   socket-level DNS check blocks internal targets (and catches DNS-rebinding
 *   that a URL-string check can't see).
 */
function pickTransportAgent(url: URL) {
  const proxyAgent = agents.untrusted;
  if (proxyAgent) {
    return proxyAgent;
  }
  if (isPrivateNetworkTargetAllowed()) {
    return url.protocol === "https:" ? httpsPassthrough : httpPassthrough;
  }
  return useAgent(url.href);
}

// request-filtering-agent signals a blocked target by throwing an Error whose
// message looks like "DNS lookup <addr> is not allowed. Because, ...". It
// exposes no error class or code, so we detect it by that shape. Anchored on
// both "DNS lookup" and "is not allowed" so it also covers deny-list wording,
// and won't silently break if the trailing reason text changes.
function isRequestFilteringBlockError(e: unknown): e is Error {
  return e instanceof Error && /DNS lookup .* is not allowed/.test(e.message);
}

/**
 * Fetch a user-supplied ("untrusted") URL with our egress safeguards applied.
 *
 * node-fetch v2 accepts `agent` as a function and calls it for the initial
 * request AND for every redirect target it follows. We use that to enforce,
 * per hop:
 *  1. the optional caller-supplied `validate(url)` policy, and
 *  2. the transport choice from pickTransportAgent (proxy / passthrough /
 *     internal-network filter).
 * There is therefore no redirect that can bypass either check.
 *
 * Throws {@link UntrustedUrlBlockedError} when a hop is rejected by the
 * validator or blocked as an internal-network target.
 *
 * The original function was introduced by this commit:
 * https://github.com/gristlabs/grist-core/commit/be5cb9124a5d1fec8c2ed6dff5cdbf786fac2991
 * Here are written thoughts and doubts about this function:
 * https://github.com/gristlabs/grist-core/pull/1363#discussion_r2034871615
 */
export async function fetchUntrustedWithAgent(
  requestUrl: URL | string,
  options?: Omit<RequestInit, "agent">,
  validate?: (url: string) => boolean,
) {
  const agentFactory = (parsedUrl: URL) => {
    // node-fetch v2 hands the factory a legacy url.parse() object (which has
    // `href` but no `origin`), so normalize to a WHATWG URL for reliable access.
    const url = new URL(parsedUrl.href);
    if (validate && !validate(url.href)) {
      throw new UntrustedUrlBlockedError(`URL rejected by validator: ${url.origin}`);
    }
    return pickTransportAgent(url);
  };

  try {
    return await fetch(requestUrl, { ...options, agent: agentFactory });
  } catch (e) {
    if (isRequestFilteringBlockError(e)) {
      throw new UntrustedUrlBlockedError(`URL blocked (internal network target): ${e.message}`);
    }
    // Preserve the existing proxy diagnostic when a proxy is in use, but not
    // for our own block errors (which are self-explanatory and unrelated to
    // the proxy). Include info helpful for diagnosing issues, but not the
    // potentially sensitive full requestUrl.
    const proxyAgent = agents.untrusted;
    if (proxyAgent && !(e instanceof UntrustedUrlBlockedError)) {
      const urlObj = new URL(requestUrl);
      log.rawWarn(`ProxyAgent error ${e}`,
        { proxy: proxyAgent.proxyUrl, reqProtocol: urlObj.protocol, requestHost: urlObj.origin });
    }
    throw e;
  }
}
