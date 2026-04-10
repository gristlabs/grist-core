import { delay } from "app/common/delay";
import { Deps, startServer } from "app/server/lib/ServerShell";
import { parseServerTypes } from "app/server/MergedServer";
import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import { configForUser } from "test/gen-server/testUtils";
import { openClient } from "test/server/gristClient";
import { EnvironmentSnapshot } from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";
import sinon from "sinon";

describe("ServerShell", function() {
  this.timeout(30000);

  let oldEnv: EnvironmentSnapshot;
  let serverUrl: string;
  let handle: Awaited<ReturnType<typeof startServer>>;
  const sandbox = sinon.createSandbox();
  const chimpy = configForUser("Chimpy");

  before(function() {
    oldEnv = new EnvironmentSnapshot();
    process.env.GRIST_SERVER_SHELL_ENABLED = "true";
    setUpDB(this);
  });

  beforeEach(async function() {
    await createInitialDb();
    handle = await startServer({
      port: 0,
      serverTypes: parseServerTypes("home,docs,static"),
    });
    serverUrl = handle.flexServer.getOwnUrl();
  });

  afterEach(async function() {
    sandbox.restore();
    await handle.shutdown();
  });

  after(async function() {
    await removeConnection();
    oldEnv.restore();
  });

  it("should respond to /status and /status?ready=1", async function() {
    const resp = await axios.get(`${serverUrl}/status`);
    assert.equal(resp.status, 200);
    const readyResp = await axios.get(`${serverUrl}/status?ready=1`, chimpy);
    assert.equal(readyResp.status, 200);
  });

  it("should complete a restart cycle and keep /status reachable", async function() {
    sandbox.stub(Deps, "testWaitBeforeReadyMs").value(500);

    handle.flexServer.triggerRestart();
    const notReadyPolls = await pollUntilReady(serverUrl);
    assert.isAbove(notReadyPolls, 0, "server should have been not-ready during restart");
  });

  it("should mark unhealthy if restart times out, then recover", async function() {
    this.timeout(15000);
    // Make restart slow enough to trip the timeout.
    sandbox.stub(Deps, "testWaitBeforeReadyMs").value(3000);
    sandbox.stub(Deps, "restartTimeoutMs").value(500);

    handle.flexServer.triggerRestart();

    // Wait for the timeout to fire.
    await delay(1000);

    // /status should return 503 while restart is still in progress.
    const unhealthyResp = await axios.get(`${serverUrl}/status`, { validateStatus: () => true });
    assert.equal(unhealthyResp.status, 503);

    // Wait for the slow restart to finish and health to recover.
    const deadline = Date.now() + 10000;
    let recovered = false;
    while (Date.now() < deadline) {
      const resp = await axios.get(`${serverUrl}/status`, { validateStatus: () => true });
      if (resp.status === 200) { recovered = true; break; }
      await delay(200);
    }
    assert.isTrue(recovered, "/status should recover after slow restart completes");
  });

  it("should serve documents after 10 restarts", async function() {
    this.timeout(120000);

    // Create a doc as Chimpy in their personal org.
    const orgsResp = await axios.get(`${serverUrl}/api/orgs`, chimpy);
    assert.equal(orgsResp.status, 200);
    const org = orgsResp.data[0];
    const wsResp = await axios.get(`${serverUrl}/api/orgs/${org.id}/workspaces`, chimpy);
    assert.equal(wsResp.status, 200);
    const wsId = wsResp.data[0].id;
    const docResp = await axios.post(
      `${serverUrl}/api/workspaces/${wsId}/docs`, { name: "RestartTest" }, chimpy);
    assert.equal(docResp.status, 200);
    const docId = docResp.data;

    try {
      sandbox.stub(Deps, "testWaitBeforeReadyMs").value(200);
      for (let i = 0; i < 10; i++) {
        handle.flexServer.triggerRestart();
        // Wait until the doc API becomes unavailable (503), confirming
        // the restart is in progress.
        const sawUnavailable = await pollUntilUnavailable(
          `${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
        assert.isTrue(sawUnavailable, `restart ${i + 1}: doc API should become unavailable`);
        const notReadyPolls = await pollUntilReady(serverUrl);
        assert.isAbove(notReadyPolls, 0, `restart ${i + 1}: server should have been not-ready`);
        // Confirm the doc API works after restart.
        const resp = await axios.get(
          `${serverUrl}/api/docs/${docId}/tables/Table1/records`, chimpy);
        assert.equal(resp.status, 200);
        assert.isArray(resp.data.records);
      }
    } finally {
      await axios.delete(`${serverUrl}/api/docs/${docId}`, chimpy);
    }
  });

  it("should open a doc via WebSocket after restart", async function() {
    this.timeout(30000);

    // Create a doc.
    const orgsResp = await axios.get(`${serverUrl}/api/orgs`, chimpy);
    const org = orgsResp.data[0];
    const wsResp = await axios.get(`${serverUrl}/api/orgs/${org.id}/workspaces`, chimpy);
    const wsId = wsResp.data[0].id;
    const docResp = await axios.post(
      `${serverUrl}/api/workspaces/${wsId}/docs`, { name: "WsTest" }, chimpy);
    assert.equal(docResp.status, 200);
    const docId = docResp.data;

    try {
      // Open doc via WebSocket before restart.
      let cli = await openClient(handle.flexServer, "chimpy@getgrist.com", "docs");
      let openDoc = await cli.openDocOnConnect(docId);
      assert.isUndefined(openDoc.error);
      await cli.close();

      handle.flexServer.triggerRestart();
      await pollUntilReady(serverUrl);

      // Open doc via WebSocket after restart.
      cli = await openClient(handle.flexServer, "chimpy@getgrist.com", "docs");
      openDoc = await cli.openDocOnConnect(docId);
      assert.isUndefined(openDoc.error);
      await cli.close();
    } finally {
      await axios.delete(`${serverUrl}/api/docs/${docId}`, chimpy);
    }
  });
});

// Poll until /status?ready=1 succeeds. On each iteration, assert
// that bare /status is always 200 (the shell keeps it alive).
// Returns the number of not-ready polls seen before ready.
async function pollUntilReady(url: string, timeoutMs = 10000) {
  let notReadyCount = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResp = await axios.get(`${url}/status`);
    assert.equal(statusResp.status, 200, "/status should always be reachable");
    try {
      await axios.get(`${url}/status?ready=1`);
      return notReadyCount;
    } catch {
      notReadyCount++;
    }
    await delay(50);
  }
  throw new Error("Server did not become ready in time");
}

// Poll until the given URL returns a non-200 status, confirming
// that the server is no longer serving normal requests.
async function pollUntilUnavailable(url: string, config: object, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await axios.get(url, { ...config, validateStatus: () => true });
    if (resp.status !== 200) { return true; }
    await delay(20);
  }
  return false;
}
