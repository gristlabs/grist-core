import {proxyAgentForTrustedRequests, proxyAgentForUntrustedRequests} from "app/server/lib/ProxyAgent";
import {getAvailablePort} from "app/server/lib/serverUtils";
import {assert} from "chai";
import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";
import fetch from 'node-fetch';
import {TestProxyServer} from 'test/server/lib/helpers/TestProxyServer';
import {serveSomething, Serving} from 'test/server/customUtil';
import {assertMatchArray, captureLog, EnvironmentSnapshot} from "test/server/testUtils";


describe("ProxyAgent", function () {
  let oldEnv: EnvironmentSnapshot;
  before(() => {
    oldEnv = new EnvironmentSnapshot();
  });

  after(() => {
    oldEnv.restore();
  });

  it("trusted and untrusted should be undefined if not configured", async function () {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.GRIST_HTTPS_PROXY;
    const trustedHttpProxy = proxyAgentForTrustedRequests(new URL("http://localhost:3000"));
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("https://localhost:3000"));
    const untrustedHttpProxy = proxyAgentForUntrustedRequests(new URL("http://localhost:3000"));
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("https://localhost:3000"));

    assert.equal(trustedHttpProxy, undefined);
    assert.equal(trustedHttpsProxy, undefined);
    assert.equal(untrustedHttpProxy, undefined);
    assert.equal(untrustedHttpsProxy, undefined);
  });

  it("untrusted should be undefined if no proxy and trusted should be proxied if configured", async function () {
    delete process.env.GRIST_HTTPS_PROXY;
    process.env.HTTPS_PROXY = "https://localhost:8080";
    process.env.https_proxy = "https://localhost:8080";
    const trustedHttpProxy = proxyAgentForTrustedRequests(new URL("http://localhost:3000"));
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("https://localhost:3000"));
    const untrustedHttpProxy = proxyAgentForUntrustedRequests(new URL("http://localhost:3000"));
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("https://localhost:3000"));

    assert.equal(untrustedHttpProxy, undefined);
    assert.equal(untrustedHttpsProxy, undefined);
    assert.instanceOf(trustedHttpProxy, HttpProxyAgent);
    assert.instanceOf(trustedHttpsProxy, HttpsProxyAgent);
  });

  it("untrusted should be undefined if direct proxy and trusted should be proxied if configured", async function () {
    process.env.GRIST_HTTPS_PROXY = "direct";
    process.env.HTTPS_PROXY = "https://localhost:8080";
    process.env.https_proxy = "https://localhost:8080";
    const trustedHttpProxy = proxyAgentForTrustedRequests(new URL("http://localhost:3000"));
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("https://localhost:3000"));
    const untrustedHttpProxy = proxyAgentForUntrustedRequests(new URL("http://localhost:3000"));
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("https://localhost:3000"));

    assert.equal(untrustedHttpProxy, undefined);
    assert.equal(untrustedHttpsProxy, undefined);
    assert.instanceOf(trustedHttpProxy, HttpProxyAgent);
    assert.instanceOf(trustedHttpsProxy, HttpsProxyAgent);
  });

  it("should be https proxy if grist proxy is configured and trusted undefined if no proxy", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("https://localhost:3000"));
    assert.equal(trustedHttpsProxy, undefined);
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("https://localhost:3000"));
    assert.instanceOf(untrustedHttpsProxy, HttpsProxyAgent);
  });

  it("should be http proxy if grist proxy is configured and trusted undefined if no proxy", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("http://localhost:3000"));
    assert.equal(trustedHttpsProxy, undefined);
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("http://localhost:3000"));
    assert.instanceOf(untrustedHttpsProxy, HttpProxyAgent);
  });

  it("should be https proxy if trusted and untrusted proxy are configured and address is https", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    process.env.HTTPS_PROXY = "https://localhost:8080";
    process.env.https_proxy = "https://localhost:8080";
    const trustedHttpsProxy = proxyAgentForTrustedRequests(new URL("https://localhost:3000"));
    assert.instanceOf(trustedHttpsProxy, HttpsProxyAgent);
    const untrustedHttpsProxy = proxyAgentForUntrustedRequests(new URL("https://localhost:3000"));
    assert.instanceOf(untrustedHttpsProxy, HttpsProxyAgent);
  });

  it("should be https proxy if trusted and untrusted proxy are configured and address is http", async function () {
    process.env.GRIST_HTTPS_PROXY = "https://localhost:9000";
    process.env.HTTPS_PROXY = "https://localhost:8080";
    process.env.https_proxy = "https://localhost:8080";
    const trustedHttpProxy = proxyAgentForTrustedRequests(new URL("http://localhost:3000"));
    assert.instanceOf(trustedHttpProxy, HttpProxyAgent);
    const untrustedHttpProxy = proxyAgentForUntrustedRequests(new URL("http://localhost:3000"));
    assert.instanceOf(untrustedHttpProxy, HttpProxyAgent);
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
