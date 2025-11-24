import {appSettings} from "app/server/lib/AppSettings";
import log from 'app/server/lib/log';

import fetch, { RequestInit } from 'node-fetch';
import {ProxyAgent, ProxyAgentOptions} from "proxy-agent";

/**
 * GristProxyAgent derives from ProxyAgent which is a class that is responsible for proxying the request using either
 * HttpProxyAgent or HttpsProxyAgent (or other supported proxy agents)
 * depending on the URL requested when using fetch().
 *
 * We configure the getProxyForUrl to not let ProxyAgent magically read the env variables
 * itself (using `proxy-from-env` module), we already do that ourselves and need to keep the control for that.
 */
export class GristProxyAgent extends ProxyAgent {
  constructor(public readonly proxyUrl: string, opts?: Omit<ProxyAgentOptions, 'getProxyForUrl'>) {
    super({
      ...opts,
      getProxyForUrl: () => this.proxyUrl
    });
  }
}

function getProxyAgentConfiguration() {
  const proxyForTrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['HTTPS_PROXY', 'https_proxy'],
    preferredEnvVar: 'HTTPS_PROXY',
  });

  const proxyForUntrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['GRIST_PROXY_FOR_UNTRUSTED_URLS', 'GRIST_HTTPS_PROXY'],
    preferredEnvVar: 'GRIST_PROXY_FOR_UNTRUSTED_URLS'
  });

  return {
    proxyForTrustedRequestsUrl,
    proxyForUntrustedRequestsUrl,
  };
}

function generateProxyAgents() {
  const {proxyForTrustedRequestsUrl, proxyForUntrustedRequestsUrl} = getProxyAgentConfiguration();

  if (process.env.GRIST_HTTPS_PROXY) {
    log.warn('GRIST_HTTPS_PROXY is deprecated in favor of GRIST_PROXY_FOR_UNTRUSTED_URLS. ' +
      `Please rather set GRIST_PROXY_FOR_UNTRUSTED_URLS="${proxyForUntrustedRequestsUrl}"`);
  }

  return {
    trusted: proxyForTrustedRequestsUrl ? new GristProxyAgent(proxyForTrustedRequestsUrl) : undefined,
    untrusted: (proxyForUntrustedRequestsUrl && proxyForUntrustedRequestsUrl !== "direct")
      ? new GristProxyAgent(proxyForUntrustedRequestsUrl) : undefined
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
 * If configured using GRIST_PROXY_FOR_UNTRUSTED_URLS env var, use node-fetch with configured proxy agent
 * Otherwise just use fetch without agent.
 *
 * If the request failed with agent, log a warning with relevant information.
 *
 * FIXME: Remove it and rather let the caller log a warning?
 * The original function has been introduced by this commit:
 * https://github.com/gristlabs/grist-core/commit/be5cb9124a5d1fec8c2ed6dff5cdbf786fac2991
 * Here are written thoughts and doubts about this function:
 * https://github.com/gristlabs/grist-core/pull/1363#discussion_r2034871615
 */
export async function fetchUntrustedWithAgent(requestUrl: URL|string, options?: Omit<RequestInit, 'agent'>) {
  const agent = agents.untrusted;
  if (!agent) {
    // No proxy is configured, just use the default agent.
    return await fetch(requestUrl, options);
  }
  requestUrl = new URL(requestUrl);

  try {
    return await fetch(requestUrl, {...options, agent});
  } catch(e) {
    // Include info helpful for diagnosing issues (but not the potentially sensitive full requestUrl).
    log.rawWarn(`ProxyAgent error ${e}`,
      {proxy: agent.proxyUrl, reqProtocol: requestUrl.protocol, requestHost: requestUrl.origin});
    throw e;
  }
}
