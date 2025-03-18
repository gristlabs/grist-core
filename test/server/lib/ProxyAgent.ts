import {assertMatchArray, captureLog, EnvironmentSnapshot} from "test/server/testUtils";
import {getAvailablePort} from "app/server/lib/serverUtils";
import log from "app/server/lib/log";
import {
  Deps, proxyAgentForTrustedRequests, proxyAgentForUntrustedRequests, test_generateProxyConfigFromEnv
} from "app/server/lib/ProxyAgent";
import {serveSomething, Serving} from 'test/server/customUtil';
import {TestProxyServer} from 'test/server/lib/helpers/TestProxyServer';

import fetch from 'node-fetch';
import sinon from "sinon";
import {assert} from "chai";
import {HttpsProxyAgent} from "https-proxy-agent";
import {HttpProxyAgent} from "http-proxy-agent";

import {RequestOptions} from "node:http";

describe("ProxyAgent", function () {
  let oldEnv: EnvironmentSnapshot;
  let warnStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;

  const proxyForTrustedUrlExample = 'https://localhost:9000';
  const proxyForUntrustedUrlExample = 'https://localhost:9001';
  const proxiedUrlExampleHttps = new URL('https://getgrist.com');
  const proxiedUrlExampleHttp = new URL('http://getgrist.com');

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox?.restore();
  });

  describe('configuration', function () {
    beforeEach(() => {
      oldEnv = new EnvironmentSnapshot();
      warnStub = sandbox.stub(log, 'warn');
    });

    afterEach(() => {
      oldEnv.restore();
    });

    function warnLogNotCalled() {
      assert.isFalse(warnStub.called, 'log.warn should not have been called');
    }


    it('should configure a proxy for trusted URLs when using https_proxy env var', function () {
      process.env.https_proxy = proxyForTrustedUrlExample;
      assert.deepEqual(test_generateProxyConfigFromEnv(), {
        proxyForTrustedRequestsUrl: proxyForTrustedUrlExample,
        proxyForUntrustedRequestsUrl: undefined
      });
      warnLogNotCalled();
    });

    it('should configure a proxy for trusted URLs when using HTTPS_PROXY env var', function () {
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;
      assert.deepEqual(test_generateProxyConfigFromEnv(), {
        proxyForTrustedRequestsUrl: proxyForTrustedUrlExample,
        proxyForUntrustedRequestsUrl: undefined
      });
      warnLogNotCalled();
    });

    it('should configure a proxy for untrusted URLs when using HTTPS_PROXY_FOR_UNTRUSTED_URLS env var', function () {
      process.env.HTTPS_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;
      assert.deepEqual(test_generateProxyConfigFromEnv(), {
        proxyForTrustedRequestsUrl: undefined,
        proxyForUntrustedRequestsUrl: proxyForUntrustedUrlExample
      });
      warnLogNotCalled();
    });

    it('should configure both proxy for untrusted and trusted URLS using ' +
      'HTTPS_PROXY_FOR_UNTRUSTED_URLS and HTTPS_PROXY', function () {
      process.env.HTTPS_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;

      assert.deepEqual(test_generateProxyConfigFromEnv(), {
        proxyForTrustedRequestsUrl: proxyForTrustedUrlExample,
        proxyForUntrustedRequestsUrl: proxyForUntrustedUrlExample
      });
    });

    it('should configure a proxy for untrusted URLs when using GRIST_HTTPS_PROXY env var ' +
      'and show a deprecation message', function () {
      process.env.GRIST_HTTPS_PROXY = proxyForUntrustedUrlExample;
      assert.deepEqual(test_generateProxyConfigFromEnv(), {
        proxyForTrustedRequestsUrl: undefined,
        proxyForUntrustedRequestsUrl: proxyForUntrustedUrlExample
      });
      assert.isTrue(
        warnStub.calledWithMatch(/GRIST_HTTPS_PROXY.*HTTPS_PROXY_FOR_UNTRUSTED_URLS/),
        'A message should have been printed to warn about GRIST_HTTPS_PROXY deprecation'
      );
    });
  });

  describe('proxy agent creation', function () {
    describe('using proxyAgentForUntrustedRequests', function () {
      it('should not create a proxy agent when no url is provided', function () {
        let res = proxyAgentForUntrustedRequests(proxiedUrlExampleHttps);
        assert.isUndefined(res, 'no agent should be returned if nothing is configured');

        sandbox.stub(Deps, 'proxyForTrustedRequestsUrl').value(proxyForTrustedUrlExample);
        res = proxyAgentForUntrustedRequests(proxiedUrlExampleHttps);
        assert.isUndefined(res, 'no agent should be returned if only the proxy for untrusted URL is configured');
      });

      it('should not create an agent when configuring proxy with "direct" as value', function () {
        sandbox.stub(Deps, 'proxyForUntrustedRequestsUrl').value('direct');
        const res = proxyAgentForUntrustedRequests(proxiedUrlExampleHttps);
        assert.isUndefined(res, 'no agent should have been returned');
      });

      it('should create an agent when the proxy for trusted URL is configured', function () {
        sandbox.stub(Deps, 'proxyForUntrustedRequestsUrl').value(proxyForUntrustedUrlExample);
        let result = proxyAgentForUntrustedRequests(proxiedUrlExampleHttps);
        assert.instanceOf(result, HttpsProxyAgent, 'should create an HttpsProxyAgent when providing an https URL');
        result = proxyAgentForUntrustedRequests(proxiedUrlExampleHttp);
        assert.instanceOf(result, HttpProxyAgent, 'should create an HttpProxyAgent when providing an https URL');
      });

      it('should create an agent when the proxies for trusted and untrusted URLs are configured', function () {
        sandbox.stub(Deps, 'proxyForUntrustedRequestsUrl').value(proxyForUntrustedUrlExample);
        sandbox.stub(Deps, 'proxyForTrustedRequestsUrl').value(proxyForTrustedUrlExample);
        const result = proxyAgentForUntrustedRequests(proxiedUrlExampleHttps);
        assert.instanceOf(result, HttpsProxyAgent, 'should create an HttpsProxyAgent when providing an https URL');
      });
    });

    describe('using proxyAgentForTrustedRequests', function () {
      it('should not create a proxy agent when no url is provided', function () {
        let res = proxyAgentForTrustedRequests(proxiedUrlExampleHttps);
        assert.isUndefined(res, 'no agent should have been returned if nothing is configured');

        sandbox.stub(Deps, 'proxyForUntrustedRequestsUrl').value(proxyForUntrustedUrlExample);
        res = proxyAgentForTrustedRequests(proxiedUrlExampleHttps);
        assert.isUndefined(res, 'no agent should have been returned if only the proxy for untrusted URL is configured');
      });

      it('should create an agent when the proxy for trusted URL is configured', function () {
        sandbox.stub(Deps, 'proxyForTrustedRequestsUrl').value(proxyForTrustedUrlExample);
        const result = proxyAgentForTrustedRequests(proxiedUrlExampleHttps);
        assert.instanceOf(result, HttpsProxyAgent,
          'should have created an HttpsProxyAgent when providing an https URL');
      });

      it('should create an agent when the proxies for trusted and untrusted URLs are configured', function () {
        sandbox.stub(Deps, 'proxyForUntrustedRequestsUrl').value(proxyForUntrustedUrlExample);
        sandbox.stub(Deps, 'proxyForTrustedRequestsUrl').value(proxyForTrustedUrlExample);
        const result = proxyAgentForTrustedRequests(proxiedUrlExampleHttps);
        assert.instanceOf(result, HttpsProxyAgent,
          'should have created an HttpsProxyAgent when providing an https URL');
      });
    });
  });

  describe('proxy error handling', async function() {
    // Handling requests
    let serving: Serving;
    // Proxy server emulation to test possible behaviours of real life server
    let testProxyServer: TestProxyServer;

    // Simple fetch using a proxy.
    function testFetch(relativePath: string, agentBuilder: (url: URL) => RequestOptions['agent']) {
      const url = serving.url + relativePath;
      return fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        agent: agentBuilder(new URL(url)),
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
    });

    afterEach(async function() {
      await serving.shutdown();
      await testProxyServer.dispose().catch(() => {});
    });

    [
      {
        description: "for trusted urls",
        mockedDep: "proxyForTrustedRequestsUrl",
        proxyAgentBuilder: proxyAgentForTrustedRequests
      },
      {
        description: "for untrusted url",
        mockedDep: "proxyForUntrustedRequestsUrl",
        proxyAgentBuilder: proxyAgentForUntrustedRequests
      },
    ].forEach(function (ctx) {
      describe(ctx.description, function() {
        beforeEach(function () {
          const proxyUrl = `http://localhost:${testProxyServer.portNumber}`;
          sandbox.stub(Deps, ctx.mockedDep as any).value(proxyUrl);
        });

        it("should not report error when proxy is working", async function() {
          // Normally fetch through proxy works and produces no errors, even for failing status.
          const logMessages1 = await captureLog('warn', async () => {
            assert.equal((await testFetch('/200', ctx.proxyAgentBuilder)).status, 200);
            assert.equal((await testFetch('/404', ctx.proxyAgentBuilder)).status, 404);
          });
          assert.equal(testProxyServer.proxyCallCounter, 2, 'The proxy should have been called twice');
          assert.deepEqual(logMessages1, []);
        });

        it("should report error when proxy fails", async function() {
          // if the proxy isn't listening, fetches produces error messages.
          await testProxyServer.dispose();
          // Error message depends a little on node version.
          const logMessages2 = await captureLog('warn', async () => {
            await assert.isRejected(testFetch('/200', ctx.proxyAgentBuilder), /(request.*failed)|(ECONNREFUSED)/);
            await assert.isRejected(testFetch('/404', ctx.proxyAgentBuilder), /(request.*failed)|(ECONNREFUSED)/);
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
  });
});
