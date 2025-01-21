import {proxyAgentForTrustedRequests, proxyAgentForUntrustedRequests} from "app/server/lib/ProxyAgent";
import {getAvailablePort} from "app/server/lib/serverUtils";
import {assert} from "chai";
import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import fetch from 'node-fetch';
import {TestProxyServer} from 'test/server/lib/helpers/TestProxyServer';
import {serveSomething, Serving} from 'test/server/customUtil';
import {assertMatchArray, captureLog, EnvironmentSnapshot} from "test/server/testUtils";

type CheckProxyVariables = 'trustedHttpProxy' | 'trustedHttpsProxy' | 'untrustedHttpProxy' | 'untrustedHttpsProxy';

describe("ProxyAgent", function () {
  let oldEnv: EnvironmentSnapshot;
  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  after(() => {
    oldEnv.restore();
  });

  function checkProxy(env: NodeJS.ProcessEnv, expectedProxies: Array<CheckProxyVariables>) {
    Object.assign(process.env, {
      // By default, the proxy env variables are unset
      GRIST_HTTPS_PROXY: '',
      HTTPS_PROXY: '',
      https_proxy: '',
      // inject the env variables passed in argument
      ...env
    });

    // Instanciate the Proxies
    const proxies: Record<CheckProxyVariables, {
      ctorIfDefined: Function,
      proxy: HttpProxyAgent|HttpsProxyAgent|undefined
    }> = {
      trustedHttpProxy: { ctorIfDefined: HttpProxyAgent, proxy: proxyAgentForTrustedRequests(new URL("http://localhost:3000")) },
      trustedHttpsProxy: { ctorIfDefined: HttpsProxyAgent, proxy: proxyAgentForTrustedRequests(new URL("https://localhost:3000")) },
      untrustedHttpProxy: { ctorIfDefined: HttpProxyAgent, proxy: proxyAgentForUntrustedRequests(new URL("http://localhost:3000")) },
      untrustedHttpsProxy: { ctorIfDefined: HttpsProxyAgent, proxy: proxyAgentForUntrustedRequests(new URL("https://localhost:3000")) }
    };

    // Test whether the proxies are defined and compare with what is expected
    for (const [varName, { ctorIfDefined, proxy }] of Object.entries(proxies)) {
      if (expectedProxies.includes(varName as CheckProxyVariables)) {
        assert.instanceOf(proxy, ctorIfDefined, `${varName} is not an instance of ${ctorIfDefined.name}`);
      } else {
        assert.isUndefined(proxy, `${varName} is defined and it should not be`);
      }
    }
  }

  it("trusted and untrusted should be undefined if not configured", async function () {
    checkProxy({}, []);
  });

  it("untrusted should be undefined if no proxy and trusted should be proxied if configured", async function () {
    checkProxy({HTTPS_PROXY: "https://localhost:8080", https_proxy: "https://localhost:8080"}, ['trustedHttpsProxy', 'trustedHttpProxy']);
  });

  it("untrusted should be undefined if direct proxy and trusted should be proxied if configured", async function () {
    checkProxy({GRIST_HTTPS_PROXY: "direct", HTTPS_PROXY: "https://localhost:8080", https_proxy: "https://localhost:8080"}, ['trustedHttpsProxy', 'trustedHttpProxy']);
  });

  it("should be https proxy if grist proxy is configured and trusted undefined if no proxy", async function () {
    checkProxy({GRIST_HTTPS_PROXY: "https://localhost:9000"}, ['untrustedHttpsProxy']);
  });

  it("should be http proxy if grist proxy is configured and trusted undefined if no proxy", async function () {
    checkProxy({GRIST_HTTPS_PROXY: "https://localhost:9000"}, ['untrustedHttpProxy']);
  });

  it("should be https proxy if trusted and untrusted proxy are configured and address is https", async function () {
    checkProxy({GRIST_HTTPS_PROXY: "https://localhost:9000", HTTPS_PROXY: "https://localhost:8080", https_proxy: "https://localhost:8080"}, ['trustedHttpsProxy', 'untrustedHttpsProxy']);
  });

  it("should be https proxy if trusted and untrusted proxy are configured and address is http", async function () {
    checkProxy({GRIST_HTTPS_PROXY: "https://localhost:9000", HTTPS_PROXY: "https://localhost:8080", https_proxy: "https://localhost:8080"}, ['trustedHttpProxy', 'untrustedHttpProxy']);
  });

  describe('proxy error handling', async function() {
    // Handling requests
    let serving: Serving;
    // Proxy server emulation to test possible behaviours of real life server
    let testProxyServer: TestProxyServer;

    // Simple fetch using a proxy.
    function testFetch(relativePath: string) {
      const url = serving.url + relativePath;
      return fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        agent: proxyAgentForTrustedRequests(new URL(url)),
      });
    }

    beforeEach(async function () {
      // Set up a server and a proxy.
      const port = await getAvailablePort(22340);
      testProxyServer = await TestProxyServer.Prepare(port);
      serving = await serveSomething(app => {
        app.post('/200', (_, res) => { res.sendStatus(200); res.end(); });
        app.post('/404', (_, res) => { res.sendStatus(404); res.end(); });
      });
      process.env.GRIST_HTTPS_PROXY = `http://localhost:${port}`;
      process.env.HTTPS_PROXY = `http://localhost:${port}`;
      process.env.https_proxy = `http://localhost:${port}`;
    });

    afterEach(async function() {
      await serving.shutdown();
      await testProxyServer.dispose().catch(() => {});
    });

    it("should not report error when proxy is working", async function() {
      // Normally fetch through proxy works and produces no errors, even for failing status.
      const logMessages1 = await captureLog('warn', async () => {
        assert.equal((await testFetch('/200')).status, 200);
        assert.equal((await testFetch('/404')).status, 404);
      });
      assert.deepEqual(logMessages1, []);
    });

    it("should report error when proxy fails", async function() {
      // if the proxy isn't listening, fetches produces error messages.
      await testProxyServer.dispose();
      // Error message depends a little on node version.
      const logMessages2 = await captureLog('warn', async () => {
        await assert.isRejected(testFetch('/200'), /(request.*failed)|(ECONNREFUSED)/);
        await assert.isRejected(testFetch('/404'), /(request.*failed)|(ECONNREFUSED)/);
      });

      // We rely on "ProxyAgent error" message to detect issues with the proxy server.
      // Error message depends a little on node version.
      assertMatchArray(logMessages2, [
        /warn: ProxyAgent error.*((request.*failed)|(ECONNREFUSED)|(AggregateError))/,
        /warn: ProxyAgent error.*((request.*failed)|(ECONNREFUSED)|(AggregateError))/,
      ]);
    });
  });
});
