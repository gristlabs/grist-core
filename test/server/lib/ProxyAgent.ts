import {proxyAgent} from "app/server/utils/ProxyAgent";
import {assert} from "chai";
import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import {EnvironmentSnapshot} from "test/server/testUtils";


describe("ProxyAgent", function () {
  let oldEnv: EnvironmentSnapshot;
  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  after(() => {
    oldEnv.restore();
  });

  it("should be undefined if no proxy is configured", async function () {
    delete process.env.GRIST_HTTPS_PROXY;
    const httpProxy = proxyAgent(new URL("http://localhost:3000"));
    const httpsProxy = proxyAgent(new URL("https://localhost:3000"));

    assert.equal(httpProxy, undefined);
    assert.equal(httpsProxy, undefined);
  });

  it("should be https proxy if proxy is configured and address is https", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    const httpsProxy = proxyAgent(new URL("https://localhost:3000"));
    assert.instanceOf(httpsProxy, HttpsProxyAgent);
  });

  it("should be https proxy if proxy is configured and address is https", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    const httpsProxy = proxyAgent(new URL("http://localhost:3000"));
    assert.instanceOf(httpsProxy, HttpProxyAgent);
  });
});
