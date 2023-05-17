import {proxyAgent} from "app/server/lib/ProxyAgent";
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
        agent: proxyAgent(new URL(url)),
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
      const logMessages2 = await captureLog('warn', async () => {
        await assert.isRejected(testFetch('/200'), /ECONNREFUSED/);
        await assert.isRejected(testFetch('/404'), /ECONNREFUSED/);
      });

      // We rely on "ProxyAgent error" message to detect issues with the proxy server.
      assertMatchArray(logMessages2, [
        /warn: ProxyAgent error.*ECONNREFUSED/,
        /warn: ProxyAgent error.*ECONNREFUSED/,
      ]);
    });
  });
});
