import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import {appSettings} from "app/server/lib/AppSettings";
import log from 'app/server/lib/log';

function generateProxyConfigFromEnv() {
  const proxyForTrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['HTTPS_PROXY', 'https_proxy'],
    preferredEnvVar: 'HTTPS_PROXY',
  });

  const proxyForUntrustedRequestsUrl = appSettings.section('proxy').readString({
    envVar: ['HTTPS_PROXY_FOR_UNTRUSTED_URLS', 'GRIST_HTTPS_PROXY'],
    preferredEnvVar: 'HTTPS_PROXY_FOR_UNTRUSTED_URLS'
  });

  if (process.env.GRIST_HTTPS_PROXY) {
    log.warn('GRIST_HTTPS_PROXY is deprecated in favor of HTTPS_PROXY_FOR_UNTRUSTED_URLS. ' +
      `Please rather rather set HTTPS_PROXY_FOR_UNTRUSTED_URLS="${proxyForTrustedRequestsUrl}"`);
  }

  return {proxyForTrustedRequestsUrl, proxyForUntrustedRequestsUrl};
}

export const test_generateProxyConfigFromEnv = generateProxyConfigFromEnv;

// Read configuration from env on module load.
export const Deps = generateProxyConfigFromEnv();

function proxyAgent(requestUrl: URL, proxy: string): HttpProxyAgent | HttpsProxyAgent | undefined {
  const ProxyAgent = requestUrl.protocol === "https:" ? HttpsProxyAgent : HttpProxyAgent;
  const agent = new ProxyAgent(proxy);

  // Wrap the main method of ProxyAgent into a wrapper that logs errors.
  const callback = agent.callback;
  agent.callback = async function () {
    try {
      return await callback.apply(this, arguments as any);
    } catch (e) {
      // Include info helpful for diagnosing issues (but not the potentially sensitive full requestUrl).
      log.rawWarn(`ProxyAgent error ${e}`,
        {proxy, reqProtocol: requestUrl.protocol, requestOrigin: requestUrl.origin});
      throw e;
    }
  };
  return agent;
}

export function proxyAgentForTrustedRequests(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {
  if (!Deps.proxyForTrustedRequestsUrl) {
    return undefined;
  }
  return proxyAgent(requestUrl, Deps.proxyForTrustedRequestsUrl);
}

export function proxyAgentForUntrustedRequests(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {

  if (Deps.proxyForUntrustedRequestsUrl === "direct" || !Deps.proxyForUntrustedRequestsUrl) {
    return undefined;
  }
  return proxyAgent(requestUrl, Deps.proxyForUntrustedRequestsUrl);
}
