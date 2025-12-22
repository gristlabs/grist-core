import {assertMatchArray, captureLog, EnvironmentSnapshot} from "test/server/testUtils";
import {getAvailablePort} from "app/server/lib/serverUtils";
import log from "app/server/lib/log";
import {
  agents, fetchUntrustedWithAgent, GristProxyAgent, test_generateProxyAgents,
} from "app/server/lib/ProxyAgent";
import {serveSomething, Serving} from 'test/server/customUtil';
import {TestProxyServer} from 'test/server/lib/helpers/TestProxyServer';

import sinon from "sinon";
import {assert} from "chai";

describe("ProxyAgent", function () {
  let oldEnv: EnvironmentSnapshot;
  let warnStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;

  const proxyForTrustedUrlExample = 'https://localhost:9000';
  const proxyForUntrustedUrlExample = 'https://localhost:9001';
  beforeEach(function () {
    oldEnv = new EnvironmentSnapshot();
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox?.restore();
    oldEnv.restore();
  });

  describe('configuration', function () {
    beforeEach(() => {
      warnStub = sandbox.stub(log, 'warn');
    });

    it('should create a proxy agent for trusted URLs when using https_proxy env var', function () {
      process.env.https_proxy = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.untrusted);
      sinon.assert.notCalled(warnStub);
    });

    it('should create a proxy agent for trusted URLs when using HTTPS_PROXY env var', function () {
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.untrusted);
      sinon.assert.notCalled(warnStub);
    });

    it('should create a proxy agent for untrusted URLs when using GRIST_PROXY_FOR_UNTRUSTED_URLS env var', function () {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.trusted);
      sinon.assert.notCalled(warnStub);
    });

    it('should create both proxy agents for untrusted and trusted URLS using ' +
      'GRIST_PROXY_FOR_UNTRUSTED_URLS and HTTPS_PROXY', function () {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      sinon.assert.notCalled(warnStub);
    });

    it('should create a proxy agent for untrusted URLs when using GRIST_HTTPS_PROXY env var ' +
      'and show a deprecation message', function () {
      process.env.GRIST_HTTPS_PROXY = proxyForUntrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.trusted);
      sinon.assert.calledWithMatch(
        warnStub, /GRIST_HTTPS_PROXY.*GRIST_PROXY_FOR_UNTRUSTED_URLS="https:\/\/localhost:9001/,
      );
    });

    it('should create no proxy agent when GRIST_PROXY_FOR_UNTRUSTED_URLS is set to "direct"', function () {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "direct";

      const proxyAgents = test_generateProxyAgents();

      assert.isUndefined(proxyAgents.untrusted);
    });
  });

  describe('proxy error handling', async function() {
    // Handling requests
    let serving: Serving;
    // Proxy server emulation to test possible behaviours of real life server
    let testProxyServer: TestProxyServer;

    beforeEach(async function () {
      // Set up a server and a proxy.
      const port = await getAvailablePort(22340);
      testProxyServer = await TestProxyServer.Prepare(port);
      serving = await serveSomething((app) => {
        app.post('/200', (_, res) => { res.sendStatus(200); res.end(); });
        app.post('/404', (_, res) => { res.sendStatus(404); res.end(); });
      });
      const proxyUrl = `http://localhost:${testProxyServer.portNumber}`;
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyUrl;
      sandbox.stub(agents, 'untrusted').value(test_generateProxyAgents().untrusted);
    });

    afterEach(async function() {
      await serving.shutdown();
      await testProxyServer.dispose().catch(() => {});
    });

    it("should not report error when proxy is working", async function() {
      // Normally fetch through proxy works and produces no errors, even for failing status.
      const logMessages1 = await captureLog('warn', async () => {
        assert.equal((await fetchUntrustedWithAgent(serving.url + '/200')).status, 200);
        assert.equal((await fetchUntrustedWithAgent(serving.url + '/404')).status, 404);
      });
      assert.equal(testProxyServer.proxyCallCounter, 2, 'The proxy should have been called twice');
      assert.deepEqual(logMessages1, []);
    });

    it("should report error when proxy fails", async function() {
      // if the proxy isn't listening, fetches produces error messages.
      await testProxyServer.dispose();
      // Error message depends a little on node version.
      const logMessages2 = await captureLog('warn', async () => {
        await assert.isRejected(fetchUntrustedWithAgent(serving.url + '/200'), /(request.*failed)|(ECONNREFUSED)/);
        await assert.isRejected(fetchUntrustedWithAgent(serving.url + '/404'), /(request.*failed)|(ECONNREFUSED)/);
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
