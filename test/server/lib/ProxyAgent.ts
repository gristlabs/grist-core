import { appSettings } from "app/server/lib/AppSettings";
import log from "app/server/lib/log";
import {
  agents, fetchUntrustedWithAgent, GristProxyAgent, isPrivateNetworkTargetAllowed,
  test_generateProxyAgents, UntrustedUrlBlockedError,
} from "app/server/lib/ProxyAgent";
import { getAvailablePort } from "app/server/lib/serverUtils";
import { serveSomething, Serving } from "test/server/customUtil";
import { TestProxyServer } from "test/server/lib/helpers/TestProxyServer";
import { assertMatchArray, captureLog, EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";
import sinon from "sinon";

describe("ProxyAgent", function() {
  let oldEnv: EnvironmentSnapshot;
  let warnStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;

  const proxyForTrustedUrlExample = "https://localhost:9000";
  const proxyForUntrustedUrlExample = "https://localhost:9001";
  beforeEach(function() {
    oldEnv = new EnvironmentSnapshot();
    sandbox = sinon.createSandbox();
  });

  afterEach(function() {
    sandbox?.restore();
    oldEnv.restore();
  });

  describe("configuration", function() {
    beforeEach(() => {
      warnStub = sandbox.stub(log, "warn");
    });

    it("should create a proxy agent for trusted URLs when using https_proxy env var", function() {
      process.env.https_proxy = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.untrusted);
      sinon.assert.notCalled(warnStub);
    });

    it("should create a proxy agent for trusted URLs when using HTTPS_PROXY env var", function() {
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.untrusted);
      sinon.assert.notCalled(warnStub);
    });

    it("should create a proxy agent for untrusted URLs when using GRIST_PROXY_FOR_UNTRUSTED_URLS env var", function() {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.trusted);
      sinon.assert.notCalled(warnStub);
    });

    it("should create both proxy agents for untrusted and trusted URLS using " +
      "GRIST_PROXY_FOR_UNTRUSTED_URLS and HTTPS_PROXY", function() {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyForUntrustedUrlExample;
      process.env.HTTPS_PROXY = proxyForTrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.instanceOf(proxyAgents.trusted, GristProxyAgent);
      sinon.assert.notCalled(warnStub);
    });

    it("should create a proxy agent for untrusted URLs when using GRIST_HTTPS_PROXY env var " +
      "and show a deprecation message", function() {
      process.env.GRIST_HTTPS_PROXY = proxyForUntrustedUrlExample;

      const proxyAgents = test_generateProxyAgents();

      assert.instanceOf(proxyAgents.untrusted, GristProxyAgent);
      assert.isUndefined(proxyAgents.trusted);
      sinon.assert.calledWithMatch(
        warnStub, /GRIST_HTTPS_PROXY.*GRIST_PROXY_FOR_UNTRUSTED_URLS="https:\/\/localhost:9001/,
      );
    });

    it('should create no proxy agent when GRIST_PROXY_FOR_UNTRUSTED_URLS is set to "direct"', function() {
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "direct";

      const proxyAgents = test_generateProxyAgents();

      assert.isUndefined(proxyAgents.untrusted);
    });
  });

  describe("proxy error handling", async function() {
    // Handling requests
    let serving: Serving;
    // Proxy server emulation to test possible behaviours of real life server
    let testProxyServer: TestProxyServer;

    beforeEach(async function() {
      // Set up a server and a proxy.
      const port = await getAvailablePort(22340);
      testProxyServer = await TestProxyServer.Prepare(port);
      serving = await serveSomething((app) => {
        app.all("/200", (_, res) => { res.sendStatus(200); res.end(); });
        app.all("/404", (_, res) => { res.sendStatus(404); res.end(); });
      });
      const proxyUrl = `http://localhost:${testProxyServer.port}`;
      process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = proxyUrl;
      sandbox.stub(agents, "untrusted").value(test_generateProxyAgents().untrusted);
    });

    afterEach(async function() {
      await serving.shutdown();
      await testProxyServer.dispose().catch(() => {});
    });

    it("should not report error when proxy is working", async function() {
      // Normally fetch through proxy works and produces no errors, even for failing status.
      const logMessages1 = await captureLog("warn", async () => {
        assert.equal((await fetchUntrustedWithAgent(serving.url + "/200")).status, 200);
        assert.equal((await fetchUntrustedWithAgent(serving.url + "/404")).status, 404);
      });
      assert.equal(testProxyServer.proxyCallCounter, 2, "The proxy should have been called twice");
      assert.deepEqual(logMessages1, []);
    });

    it("should report error when proxy fails", async function() {
      // if the proxy isn't listening, fetches produces error messages.
      await testProxyServer.dispose();
      // Error message depends a little on node version.
      const logMessages2 = await captureLog("warn", async () => {
        await assert.isRejected(fetchUntrustedWithAgent(serving.url + "/200"), /(request.*failed)|(ECONNREFUSED)/);
        await assert.isRejected(fetchUntrustedWithAgent(serving.url + "/404"), /(request.*failed)|(ECONNREFUSED)/);
      });

      // We rely on "ProxyAgent error" message to detect issues with the proxy server.
      // Error message depends a little on node version.
      assertMatchArray(logMessages2, [
        /warn: ProxyAgent error.*((request.*failed)|(ECONNREFUSED)|(AggregateError))/,
        /warn: ProxyAgent error.*((request.*failed)|(ECONNREFUSED)|(AggregateError))/,
      ]);
    });
  });

  describe("isPrivateNetworkTargetAllowed", function() {
    afterEach(function() {
      // Reset any DB-source settings we may have set (not covered by oldEnv).
      appSettings.setEnvVars({});
    });

    it("is false when the env var is unset", function() {
      delete process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS;
      assert.isFalse(isPrivateNetworkTargetAllowed());
    });

    it("is true when the env var is affirmative", function() {
      process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS = "true";
      assert.isTrue(isPrivateNetworkTargetAllowed());
    });

    it("is false when the env var is not affirmative", function() {
      process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS = "false";
      assert.isFalse(isPrivateNetworkTargetAllowed());
    });

    it("reads the flag from the DB settings source", function() {
      delete process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS;
      appSettings.setEnvVars({ GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS: "true" });
      assert.isTrue(isPrivateNetworkTargetAllowed());
    });
  });

  describe("fetchUntrustedWithAgent guards", function() {
    let serving: Serving;
    let requestPaths: string[];

    beforeEach(async function() {
      // Ensure the default (filtering) posture: no proxy, no opt-out.
      delete process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS;
      delete process.env.GRIST_HTTPS_PROXY;
      delete process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS;
      requestPaths = [];
      serving = await serveSomething((app) => {
        app.get("/ok", (req, res) => { requestPaths.push(req.path); res.sendStatus(200); res.end(); });
        app.get("/redirect-external", (req, res) => {
          requestPaths.push(req.path);
          res.redirect(302, "https://denied.example.com/blocked");
        });
      });
    });

    afterEach(async function() {
      await serving.shutdown();
    });

    // The test server listens on loopback, which request-filtering-agent blocks
    // by default. Opt in so we can exercise transport-level behaviour.
    function allowPrivateTargets() {
      process.env.GRIST_ALLOW_WEBHOOK_PRIVATE_NETWORK_TARGETS = "true";
    }

    async function expectBlocked(promise: Promise<unknown>, messageRe: RegExp) {
      const err = await promise.then(() => undefined, e => e);
      assert.instanceOf(err, UntrustedUrlBlockedError);
      assert.match((err as Error).message, messageRe);
    }

    it("rejects when the validator returns false, without contacting the server", async function() {
      allowPrivateTargets();  // isolate the validator from the internal-network block
      await expectBlocked(
        fetchUntrustedWithAgent(serving.url + "/ok", {}, () => false),
        /rejected by validator/,
      );
      assert.deepEqual(requestPaths, [], "the server should never be contacted");
    });

    it("performs the request when no validator is provided (private targets allowed)", async function() {
      allowPrivateTargets();
      const response = await fetchUntrustedWithAgent(serving.url + "/ok");
      assert.equal(response.status, 200);
      assert.deepEqual(requestPaths, ["/ok"]);
    });

    it("blocks internal-network targets by default and re-wraps the error", async function() {
      // Default posture (no proxy, no opt-out): loopback is blocked at connect.
      await expectBlocked(
        fetchUntrustedWithAgent(serving.url + "/ok"),
        /internal network target/,
      );
      assert.deepEqual(requestPaths, [], "the connection should be blocked before the server is reached");
    });

    it("re-validates redirect targets and blocks a disallowed redirect", async function() {
      allowPrivateTargets();  // let the initial loopback hop through
      const validate = (url: string) => !url.includes("denied.example.com");
      await expectBlocked(
        fetchUntrustedWithAgent(serving.url + "/redirect-external", {}, validate),
        /denied\.example\.com/,
      );
      // Only the initial hop is contacted; the redirect target is rejected by
      // the agent factory before any connection is attempted.
      assert.deepEqual(requestPaths, ["/redirect-external"]);
    });
  });
});
