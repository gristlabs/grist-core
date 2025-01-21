import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import log from 'app/server/lib/log';

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
  const httpsProxy = process.env.HTTPS_PROXY ? process.env.HTTPS_PROXY : process.env.https_proxy;
  if (!httpsProxy) {
    return undefined;
  }
  return proxyAgent(requestUrl, httpsProxy);
}

export function proxyAgentForUntrustedRequests(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {
  const gristProxy = process.env.GRIST_HTTPS_PROXY;
  if (gristProxy === "direct" || !gristProxy) {
    return undefined;
  }
  return proxyAgent(requestUrl, gristProxy);
}
