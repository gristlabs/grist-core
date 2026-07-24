import { appSettings } from "app/server/lib/AppSettings";
import log from "app/server/lib/log";
import { isUrlAllowed } from "app/server/lib/requestUtils";

import ipAddr from "ipaddr.js";
import fetch, { RequestInit } from "node-fetch";
import { ProxyAgent, ProxyAgentOptions } from "proxy-agent";
import requestFilteringAgent from "request-filtering-agent";

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

export function isIpAddrOrRange(destination: string): boolean {
  return ipAddr.isValid(destination) || ipAddr.isValidCIDR(destination);
}

export interface DestinationAllowlist {
  allowedIps: string[];
  allowedIpCIDRRanges: string[];
  allowedDomains: string[];
}

export function getEgressDestinationAllowlist(): DestinationAllowlist {
  const rawAllowlist = appSettings.section("proxy").flag("egressDestinationAllowlist").requireString({
    envVar: "GRIST_EGRESS_ALLOW",
    defaultValue: "",
  });

  const entries = rawAllowlist.split(",").map(entry => entry.trim());

  return {
    allowedIps: entries.filter(ipAddr.isValid),
    allowedIpCIDRRanges: entries.filter(ipAddr.isValidCIDR),
    allowedDomains: entries.filter(entry => !isIpAddrOrRange(entry)),
  };
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
 * request AND for every redirect target it follows.
 * This enforces the destination follows these egress destination rules:
 *   1. Domains must be in the allowlist or be a subdomain of a domain in the allowlist.
 *     - The wildcard (*) permits all domains, but not all IPs.
 *   2. IPs must be in the allowlist or be contained in one of the allowed CIDR ranges
 *   3. The destination's IP must not be a meta/internal IP, unless an untrusted proxy is in use or in the allowlist.
 *     - An explicit IP or range in the allowlist bypasses this check, to allow access to private hosts.
 *     - IPs aren't filtered in the proxy case as:
 *       - Domains may resolve differently on the proxy,
 *       - Allowlisting private IPs would require compatible config in two places (proxy, Grist)
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
  allowlistOverride?: DestinationAllowlist,
) {
  const allowlist = allowlistOverride ?? getEgressDestinationAllowlist();
  const allowIPAddressList = allowlist.allowedIps.concat(allowlist.allowedIpCIDRRanges);
  const agentFactory = (parsedUrl: URL) => {
    // node-fetch v2 hands the factory a legacy url.parse() object (which has
    // `href` but no `origin`), so normalize to a WHATWG URL for reliable access.
    const url = new URL(parsedUrl.href);
    // Filter domains here - request-filtering-agent is responsible for IPs, as it handles DNS lookups
    if (!ipAddr.isValid(url.hostname) && !isUrlAllowed(allowlist.allowedDomains, url.href)) {
      throw new UntrustedUrlBlockedError(`URL rejected by validator: ${url.origin}`);
    }

    // No IP filtering if proxy agent is in use - proxy is responsible
    const proxyAgent = agents.untrusted;
    if (proxyAgent) {
      return proxyAgent;
    }

    return requestFilteringAgent.useAgent(url.href, { allowIPAddressList });
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
