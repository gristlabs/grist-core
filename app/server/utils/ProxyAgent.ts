import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";

export function proxyAgent(requestUrl: URL): HttpProxyAgent | HttpsProxyAgent | undefined {
    const proxy = process.env.GRIST_HTTPS_PROXY;
    if (!proxy) {
        return undefined;
    }
    const ProxyAgent = requestUrl.protocol === "https:" ? HttpsProxyAgent : HttpProxyAgent;
    return new ProxyAgent(proxy);
}
