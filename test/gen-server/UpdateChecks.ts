import axios from "axios";
import * as chai from "chai";
import * as sinon from 'sinon';

import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";
import { Defer, serveSomething, Serving } from "test/server/customUtil";
import { Telemetry } from 'app/server/lib/Telemetry';
import { Deps } from "app/server/lib/UpdateManager";
import { TestServer } from "test/gen-server/apiUtils";
import { delay } from "app/common/delay";
import { LatestVersion } from 'app/common/InstallAPI';
import { TelemetryEvent, TelemetryMetadataByLevel } from 'app/common/Telemetry';

const assert = chai.assert;

let testServer: TestServer;

const stop = async () => {
  await testServer?.stop();
  testServer = null as any;
};

let homeUrl: string;
let dockerHub: Serving & { signal: () => Defer };
let sandbox: sinon.SinonSandbox;
const logMessages: [TelemetryEvent, TelemetryMetadataByLevel?][] = [];

const chimpy = configForUser("Chimpy");
const headers = {
  headers: {'Content-Type': 'application/json'}
};

// Tests specific complex scenarios that may have previously resulted in wrong behavior.
describe("UpdateChecks", function () {
  testUtils.setTmpLogLevel("error");

  this.timeout("20s");

  before(async function () {
    testUtils.EnvironmentSnapshot.push();
    dockerHub = await dummyDockerHub();
    assert.equal((await fetch(dockerHub.url + "/tags")).status, 200);

    // Start the server with correct configuration.
    Object.assign(process.env, {
      GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "saas",
    });
    sandbox = sinon.createSandbox();
    sandbox.stub(Deps, "REQUEST_TIMEOUT").value(300);
    sandbox.stub(Deps, "RETRY_TIMEOUT").value(400);
    sandbox.stub(Deps, "GOOD_RESULT_TTL").value(500);
    sandbox.stub(Deps, "BAD_RESULT_TTL").value(200);
    sandbox.stub(Deps, "DOCKER_ENDPOINT").value(dockerHub.url + "/tags");
    sandbox.stub(Telemetry.prototype, 'logEvent').callsFake((_, name, meta) => {
      if (name !== 'checkedUpdateAPI') {
        return Promise.resolve();
      }
      logMessages.push([name, meta]);
      return Promise.resolve();
    });

    await startInProcess(this);
  });

  after(async function () {
    sandbox.restore();
    await dockerHub.shutdown();
    await stop();
    testUtils.EnvironmentSnapshot.pop();
  });

  afterEach(async function () {
    await testServer.server.getUpdateManager().clear();
  });

  it("should read latest version as anonymous user in happy path", async function () {
    setEndpoint(dockerHub.url + "/tags");
    const resp = await axios.get(`${homeUrl}/api/version`);
    assert.equal(resp.status, 200, `${homeUrl}/api/version`);
    const result: LatestVersion = resp.data;
    assert.equal(result.latestVersion, "10");

    // Also works in post method.
    const resp2 = await axios.post(`${homeUrl}/api/version`, {}, headers);
    assert.equal(resp2.status, 200);
    assert.deepEqual(resp2.data, result);
  });

  it("should read latest version as existing user", async function () {
    setEndpoint(dockerHub.url + "/tags");
    const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(resp.status, 200);
    const result: LatestVersion = resp.data;
    assert.equal(result.latestVersion, "10");
  });

  it("passes errors to client", async function () {
    setEndpoint(dockerHub.url + "/404");
    const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(resp.status, 404);
    assert.deepEqual(resp.data, { error: "Not Found" });
  });

  it("retries on 429", async function () {
    setEndpoint(dockerHub.url + "/429");

    // First make sure that mock works.
    assert.equal((await fetch(dockerHub.url + "/429")).status, 200);
    assert.equal((await fetch(dockerHub.url + "/429")).status, 429);
    assert.equal((await fetch(dockerHub.url + "/429")).status, 200);
    assert.equal((await fetch(dockerHub.url + "/429")).status, 429);

    // Now make sure that 4 subsequent requests are successful.
    const check = async () => {
      const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
      assert.equal(resp.status, 200);
      const result: LatestVersion = resp.data;
      assert.equal(result.latestVersion, "10");
    };

    await check();
    await check();
    await check();
    await check();
  });

  it("throws when receives html", async function () {
    setEndpoint(dockerHub.url + "/html");
    const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(resp.status, 500);
  });

  it("caches data end errors", async function () {
    setEndpoint(dockerHub.url + "/error");
    const r1 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r1.status, 500);
    assert.equal(r1.data.error, "1");

    const r2 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r2.status, 500);
    assert.equal(r2.data.error, "1"); // since errors are cached for 200ms.

    await delay(300); // error is cached for 200ms

    const r3 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r3.status, 500);
    assert.equal(r3.data.error, "2"); // second error is different, but still cached for 200ms.

    const r4 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r4.status, 500);
    assert.equal(r4.data.error, "2");

    await delay(300);

    // Now we should get correct result, but it will be cached for 500ms.

    const r5 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r5.status, 200);
    assert.equal(r5.data.latestVersion, "3"); // first successful response is cached for 2 seconds.

    const r6 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r6.status, 200);
    assert.equal(r6.data.latestVersion, "3");

    await delay(700);

    const r7 = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(r7.status, 200);
    assert.equal(r7.data.latestVersion, "4");
  });

  it("can stop server when hangs", async function () {
    setEndpoint(dockerHub.url + "/hang");
    const handCalled = dockerHub.signal();
    const resp = axios
      .get(`${homeUrl}/api/version`, chimpy)
      .catch((err) => ({ status: 999, data: null }));
    await handCalled;
    await stop();
    const result = await resp;
    assert.equal(result.status, 500);
    assert.match(result.data.error, /aborted/);
    // Start server again, and make sure it works.
    await startInProcess(this);
  });

  it("dosent starts for non saas deployment", async function () {
    try {
      testUtils.EnvironmentSnapshot.push();
      Object.assign(process.env, {
        GRIST_TEST_SERVER_DEPLOYMENT_TYPE: "core",
      });
      await stop();
      await startInProcess(this);
      const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
      assert.equal(resp.status, 404);
    } finally {
      testUtils.EnvironmentSnapshot.pop();
    }

    // Start normal one again.
    await stop();
    await startInProcess(this);
  });

  it("reports error when timeout happens", async function () {
    setEndpoint(dockerHub.url + "/timeout");
    const resp = await axios.get(`${homeUrl}/api/version`, chimpy);
    assert.equal(resp.status, 500);
    assert.match(resp.data.error, /timeout/);
  });

  it("logs deploymentId and deploymentType", async function () {
    logMessages.length = 0;
    setEndpoint(dockerHub.url + "/tags");
    const installationId = "randomInstallationId";
    const deploymentType = "test";
    const resp = await axios.post(`${homeUrl}/api/version`, {
      installationId,
      deploymentType
    }, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(logMessages.length, 1);
    const [name, meta] = logMessages[0];
    assert.equal(name, "checkedUpdateAPI");
    assert.deepEqual(meta, {
      full: {
        deploymentId: installationId,
        deploymentType,
      },
    });
  });
});

async function dummyDockerHub() {
  let odds = 0;

  // We offer a way to signal when request is received.
  // Test can add a dummy promise using signal() method, and it is resolved
  // when any request is received.
  const signals: Defer[] = [];
  let errorCount = 0;

  const tempServer = await serveSomething((app) => {
    app.use((req, res, next) => {
      signals.forEach((p) => p.resolve());
      signals.length = 0;
      next();
    });
    app.get("/404", (_, res) => res.status(404).send("Not Found").end());
    app.get("/429", (_, res) => {
      if (odds++ % 2) {
        res.status(429).send("Too Many Requests");
      } else {
        res.json(SECOND_PAGE);
      }
    });
    app.get("/timeout", (_, res) => {
      setTimeout(() => res.status(200).json(SECOND_PAGE), 500);
    });

    app.get("/error", (_, res) => {
      errorCount++;
      // First 2 calls will return error, next will return numbers (3, 4, 5, 6, 7, 8, 9, 10)
      if (errorCount <= 2) {
        res.status(500).send(String(errorCount));
      } else {
        res.json(VERSION(errorCount));
      }
    });

    app.get("/html", (_, res) => {
      res.status(200).send("<html></html>");
    });
    app.get("/hang", () => {});
    app.get("/tags", (_, res) => {
      res.status(200).json(FIRST_PAGE(tempServer));
    });
    app.get("/next", (_, res) => {
      res.status(200).json(SECOND_PAGE);
    });
  });

  return Object.assign(tempServer, {
    signal() {
      const p = new Defer();
      signals.push(p);
      return p;
    },
  });
}

function setEndpoint(endpoint: string) {
  sinon.stub(Deps, "DOCKER_ENDPOINT").value(endpoint);
}

async function startInProcess(context: Mocha.Context) {
  testServer = new TestServer(context);
  await testServer.start(["home"]);
  homeUrl = testServer.serverUrl;
}

const VERSION = (i: number) => ({
  results: [
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "stable",
      digest: "stable",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: i.toString(),
      digest: "stable",
    },
  ],
  count: 2,
  next: null,
});

const SECOND_PAGE = {
  results: [
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "stable",
      digest: "stable",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "latest",
      digest: "latest",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "1",
      digest: "latest",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "1",
      digest: "stable",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "9",
      digest: "stable",
    },
    {
      tag_last_pushed: "2024-03-26T07:11:01.272113Z",
      name: "10",
      digest: "stable",
    },
  ],
  count: 6,
  next: null,
};

const FIRST_PAGE = (tempServer: Serving) => ({
  results: [],
  count: 0,
  next: tempServer.url + "/next",
});

