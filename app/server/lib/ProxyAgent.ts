import { appSettings } from "app/server/lib/AppSettings";
import log from "app/server/lib/log";
import { isUrlAllowed } from "app/server/lib/requestUtils";

import ipAddr from "ipaddr.js";
import memoize from "lodash/memoize";
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

export class DestinationAllowlist {
  public static fromRaw(rawAllowlist: string): DestinationAllowlist {
    const entries = rawAllowlist.split(",").map(entry => entry.trim());

    return new DestinationAllowlist({
      allowedIps: entries.filter(ipAddr.isValid),
      allowedCIDRRanges: entries.filter(ipAddr.isValidCIDR),
      allowedDomains: entries.filter(entry => !isIpAddrOrRange(entry)),
    });
  }

  public readonly ips: readonly string[];
  public readonly rangesInCIDRFormat: readonly string[];
  public readonly domains: readonly string[];
  public readonly rangesWithPrefixLength: readonly [ipAddr.IPv4 | ipAddr.IPv6, number][];
  public readonly ipsAndRanges: readonly string[];
  public readonly allowsAccessToSpecialIps: boolean;

  constructor(options: { allowedIps: string[], allowedCIDRRanges: string[], allowedDomains: string[] }) {
    this.ips = options.allowedIps;
    this.rangesInCIDRFormat = options.allowedCIDRRanges;
    this.domains = options.allowedDomains;
    this.rangesWithPrefixLength = this.rangesInCIDRFormat.map(ipAddr.parseCIDR);
    this.ipsAndRanges = this.ips.concat(this.rangesInCIDRFormat);

    this.allowsAccessToSpecialIps =
      this.ips.some(ip => isIpInSpecialRange(ip)) || this.rangesInCIDRFormat.some(range => isIpInSpecialRange(range));
  }
}

export const getEgressDestinationAllowlist = memoize(() => {
  const rawAllowlist = appSettings.section("proxy").flag("egressDestinationAllowlist").requireString({
    envVar: "GRIST_EGRESS_ALLOW",
    defaultValue: "",
  });

  return DestinationAllowlist.fromRaw(rawAllowlist);
});

// Returns true if the IP is in a special range, false if it isn't or isn't a valid IP.
export function isIpInSpecialRange(ip: string) {
  try {
    if (ipAddr.isValid(ip)) {
      return ipAddr.parse(ip).range() !== "unicast";
    }
    if (ipAddr.isValidCIDR(ip)) {
      return ipAddr.parseCIDR(ip)[0].range() !== "unicast";
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Check if an untrusted egress URL can be accessed.
 * This check passing doesn't guarantee the URL won't be blocked.
 * It doesn't resolve domains or check redirects, so doesn't have all the checks the agent does.
 * However, it's a reasonable first pass for early user feedback.
 *
 * See { @link fetchUntrustedWithAgent } comment for the exact rules.
 */
export function isEgressUrlAllowed(url: string | URL, allowlistOverride?: DestinationAllowlist) {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;

  // Don't allow non-HTTP requests to be attempted
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return false;
  }

  const allowlist = allowlistOverride ?? getEgressDestinationAllowlist();

  if (ipAddr.isValid(parsedUrl.hostname)) {
    // Untrusted proxy in use - no IP filtering to be applied.
    if (agents.untrusted) { return true; }
    const destIp = ipAddr.parse(parsedUrl.hostname);
    const isAllowlisted =
      allowlist.ips.some(allowedIp => allowedIp === parsedUrl.hostname) ||
      allowlist.rangesWithPrefixLength.some(range => destIp.match(range));
    // All non-special ranges show as "unicast". Private, link local, meta, reserved all have their own names.
    const isSpecialRange = destIp.range() !== "unicast";
    return isAllowlisted || !isSpecialRange;
  }

  // Not an IP - must be a domain
  return isUrlAllowed(allowlist.domains, parsedUrl.href);
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
  const agentFactory = (parsedUrl: URL) => {
    // node-fetch v2 hands the factory a legacy url.parse() object (which has
    // `href` but no `origin`), so normalize to a WHATWG URL for reliable access.
    const url = new URL(parsedUrl.href);
    if (!isEgressUrlAllowed(url, allowlist)) {
      throw new UntrustedUrlBlockedError(`URL rejected by allowlist: ${url.origin}`);
    }

    // No IP filtering if proxy agent is in use - proxy is responsible
    const proxyAgent = agents.untrusted;
    if (proxyAgent) {
      return proxyAgent;
    }

    // request-filtering-agent is more thorough than isEgressUrlAllowed, resolving
    // DNS entries to ensure they aren't hitting a protected IP.
    return requestFilteringAgent.useAgent(url.href, {
      // Needs string cast to remove readonly - library doesn't mutate, just doesn't support readonly.
      allowIPAddressList: allowlist.ipsAndRanges as string[]
    });
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
