import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import {appSettings} from "app/server/lib/AppSettings";
import log from 'app/server/lib/log';
import { StringUnion } from "app/common/StringUnion";

const SupportedProtocols = StringUnion("http:", "https:");
type SupportedProtocols = typeof SupportedProtocols.type;

interface Deps {
  trusted: {
    "http:": HttpProxyAgent;
    "https:": HttpsProxyAgent;
  } | undefined;
  untrusted: {
    "http:": HttpProxyAgent;
    "https:": HttpsProxyAgent;
  } | undefined;
}

function buildProxyAgent<ProxyAgent extends HttpProxyAgent|HttpsProxyAgent>(
  proxy: string, proxyAgentCtor: { new(proxy: string): ProxyAgent }
): ProxyAgent {
  const agent = new proxyAgentCtor(proxy);

  // Wrap the main method of ProxyAgent into a wrapper that logs errors.
  const callback = agent.callback;
  agent.callback = async function (...args: Parameters<HttpProxyAgent["callback"]>) {
    const req = args[0];
    try {
      return await callback.call(this, ...args);
    } catch (e) {
      // Include info helpful for diagnosing issues (but not the potentially sensitive full requestUrl).
      log.rawWarn(`ProxyAgent error ${e}`,
        {proxy, reqProtocol: req.protocol, requestHost: req.host});
      throw e;
    }
  };
  return agent;
}

function generateProxyAgents(): Deps {
  const proxyForTrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['HTTPS_PROXY', 'https_proxy'],
    preferredEnvVar: 'HTTPS_PROXY',
  });

  const proxyForUntrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['GRIST_PROXY_FOR_UNTRUSTED_URLS', 'GRIST_HTTPS_PROXY'],
    preferredEnvVar: 'GRIST_PROXY_FOR_UNTRUSTED_URLS'
  });

  if (process.env.GRIST_HTTPS_PROXY) {
    log.warn('GRIST_HTTPS_PROXY is deprecated in favor of GRIST_PROXY_FOR_UNTRUSTED_URLS. ' +
      `Please rather set GRIST_PROXY_FOR_UNTRUSTED_URLS="${proxyForTrustedRequestsUrl}"`);
  }

  return {
    trusted: proxyForTrustedRequestsUrl ? {
      "http:": buildProxyAgent(proxyForTrustedRequestsUrl, HttpProxyAgent),
      "https:": buildProxyAgent(proxyForTrustedRequestsUrl, HttpsProxyAgent),
    } : undefined,
    untrusted: proxyForUntrustedRequestsUrl && proxyForUntrustedRequestsUrl !== "direct" ? {
      "http:": buildProxyAgent(proxyForUntrustedRequestsUrl, HttpProxyAgent),
      "https:": buildProxyAgent(proxyForUntrustedRequestsUrl, HttpsProxyAgent)
    } : undefined
  };
}

export const test_generateProxyAgents = generateProxyAgents;

// Instantiate all the possible agents at startup.
export const Deps = {
  agents: generateProxyAgents()
};

export function proxyAgentForTrustedRequests(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {
  const protocol = SupportedProtocols.check(requestUrl.protocol);
  return Deps.agents.trusted?.[protocol];
}

export function proxyAgentForUntrustedRequests(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {
  const protocol = SupportedProtocols.check(requestUrl.protocol);
  return Deps.agents.untrusted?.[protocol];
}
