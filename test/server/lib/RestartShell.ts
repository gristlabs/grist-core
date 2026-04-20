/**
 * End-to-end tests for RestartShell: the mocha process spawns a real
 * shell in-process that forks a Grist child via stubs/app/server/server.
 */

import { GristClientSocket } from "app/client/components/GristClientSocket";
import { delay } from "app/common/delay";
import { Deps, runRestartShell } from "app/server/lib/RestartShell";
import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import * as os from "os";
import * as path from "path";

import axios from "axios";
import { assert } from "chai";
import * as fse from "fs-extra";
import sinon from "sinon";

describe("RestartShell", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("warn");

  let oldEnv: EnvironmentSnapshot;
  let serverUrl: string;
  let handle: Awaited<ReturnType<typeof runRestartShell>>;
  let tmpDir: string;
  const sandbox = sinon.createSandbox();
  const chimpy = configForUser("Chimpy");

  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    process.env.GRIST_LOG_LEVEL = "warn";
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), "grist-supervisor-test-"));
  });

  beforeEach(async function() {
    // Use a file-based DB so the child process (separate process)
    // can access the same seeded data.
    const dbPath = path.join(tmpDir, "test.db");
    await fse.remove(dbPath);
    process.env.TYPEORM_DATABASE = dbPath;
    setUpDB(this);
    await createInitialDb();
    // We've seeded the DB once; the child must not wipe it again.
    delete process.env.TEST_CLEAN_DATABASE;
    // Close the connection in the test process so the child can
    // open it without contention.
    await removeConnection();

    process.env.GRIST_DEFAULT_EMAIL = "test@example.com";
    process.env.GRIST_SESSION_SECRET = "test-secret";
    process.env.GRIST_DATA_DIR = path.join(tmpDir, "docs");
    process.env.GRIST_SERVERS = "home,docs,static";
    await fse.mkdirp(process.env.GRIST_DATA_DIR);

    handle = await runRestartShell({
      publicPort: 0,
      childEntryPoint: require.resolve("stubs/app/server/server"),
    });
    serverUrl = `http://localhost:${handle.port}`;
  });

  afterEach(async function() {
    sandbox.restore();
    delete process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY;
    if (handle) {
      await handle.shutdown();
    }
  });

  after(async function() {
    await fse.remove(tmpDir).catch(() => {});
    oldEnv.restore();
  });

  it("should respond to /status and /status?ready=1", async function() {
    // Under the shell these are answered by the child, so the body
    // should match a normal FlexServer response.
    const resp = await axios.get(`${serverUrl}/status`);
    assert.equal(resp.status, 200);
    assert.include(resp.data, "alive");
    const readyResp = await axios.get(`${serverUrl}/status?ready=1`);
    assert.equal(readyResp.status, 200);
    assert.include(readyResp.data, "alive");
  });

  it("should reject and set exitCode when initial spawn fails", async function() {
    // Pre-shell Grist exited when it failed to boot; preserve that
    // contract so Node exits non-zero when the event loop drains.
    await handle.shutdown();
    const priorExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      const failingScript = path.join(tmpDir, "fail-immediately.js");
      await fse.writeFile(failingScript, "process.exit(7);\n");
      let caught: unknown;
      try {
        await runRestartShell({ publicPort: 0, childEntryPoint: failingScript });
      } catch (err) { caught = err; }
      assert.isDefined(caught, "runRestartShell should reject on spawn failure");
      assert.equal(process.exitCode, 1, "process.exitCode should be set to 1");
    } finally {
      process.exitCode = priorExitCode;
    }
  });

  it("should serialize shutdown after an in-flight restart", async function() {
    // Slow the restart so shutdown() definitely lands while the
    // restart is awaiting the child's ready signal.
    process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY = "500";
    const port = handle.port;
    const restartPromise = handle.restart();
    await delay(50);
    const shutdownPromise = handle.shutdown();
    await restartPromise;
    await shutdownPromise;
    let portStillOpen = true;
    try {
      await axios.get(`http://localhost:${port}/status`, { timeout: 1000 });
    } catch {
      portStillOpen = false;
    }
    assert.isFalse(portStillOpen, "port should be released after shutdown resolves");
  });

  it("should complete a restart cycle and keep /status reachable", async function() {
    // Force the child to wait 500ms before signalling ready so the
    // not-ready window is definitely wider than the poll interval,
    // without relying on real process boot time.
    process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY = "500";
    const restartPromise = handle.restart();
    const notReadyPolls = await pollUntilReady(serverUrl);
    await restartPromise;
    assert.isAbove(notReadyPolls, 0, "server should have been not-ready during restart");
  });

  it("should flip to unhealthy on slow restart, then recover", async function() {
    // Deterministic: watchdog fires at 50ms, child sends ready at
    // 500ms. /status must flip to 500 in the gap and recover after.
    sandbox.stub(Deps, "unhealthyTimeoutMs").value(50);
    process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY = "500";
    const restartPromise = handle.restart();

    const deadline = Date.now() + 10000;
    let sawUnhealthy = false;
    while (Date.now() < deadline) {
      const resp = await axios.get(`${serverUrl}/status`, { validateStatus: () => true });
      if (resp.status === 500 && /unhealthy/.test(resp.data)) { sawUnhealthy = true; break; }
      await delay(20);
    }
    assert.isTrue(sawUnhealthy, "/status should have reported unhealthy during slow restart");

    await restartPromise;
    // After restart completes, /status is forwarded to the child and
    // returns the real Grist response -- just check the status code.
    const recovered = await axios.get(`${serverUrl}/status`);
    assert.equal(recovered.status, 200);
  });

  it("should route keep-alive connections to new child after restart", async function() {
    // The fallback server sets Connection:close so the next request
    // opens a fresh TCP connection and reaches the new child, instead
    // of pinning the client to the fallback for the session.
    const http = await import("http");
    const keepAliveAgent = new http.Agent({ keepAlive: true });
    const client = axios.create({ baseURL: serverUrl, httpAgent: keepAliveAgent });

    try {
      const before = await client.get("/status?ready=1");
      assert.equal(before.status, 200);
      assert.include(before.data, "alive");

      await handle.restart();

      const after = await client.get("/status?ready=1");
      assert.equal(after.status, 200);
      assert.include(after.data, "alive");
    } finally {
      keepAliveAgent.destroy();
    }
  });

  it("should serve API requests", async function() {
    const resp = await axios.get(`${serverUrl}/api/orgs`, chimpy);
    assert.equal(resp.status, 200);
    assert.isArray(resp.data);
  });

  it("should serve documents after 3 restarts", async function() {
    this.timeout(120000);

    const docId = await createTestDoc(serverUrl, "RestartTest");

    try {
      const noKeepAlive = { ...chimpy, headers: { ...chimpy.headers, Connection: "close" } };
      for (let i = 0; i < 3; i++) {
        await handle.restart();
        const resp = await axios.get(
          `${serverUrl}/api/docs/${docId}/tables/Table1/records`, noKeepAlive);
        assert.equal(resp.status, 200);
        assert.isArray(resp.data.records);
      }
    } finally {
      await axios.delete(`${serverUrl}/api/docs/${docId}`, chimpy);
    }
  });

  it("should handle WebSocket connections after restart", async function() {
    this.timeout(60000);

    const docId = await createTestDoc(serverUrl, "WsTest");

    async function openWsAndDoc() {
      const ws = new GristClientSocket(`ws://localhost:${handle.port}/o/docs`, {
        headers: { Authorization: "Bearer api_key_for_chimpy" },
      });
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (err: any) => reject(err instanceof Error ? err : new Error(String(err)));
      });
      const firstMsg: any = await new Promise((resolve) => {
        ws.onmessage = (data: string) => resolve(JSON.parse(data));
      });
      assert.equal(firstMsg.type, "clientConnect");
      const reqId = 1;
      ws.send(JSON.stringify({ reqId, method: "openDoc", args: [docId] }));
      const openResp: any = await new Promise((resolve) => {
        ws.onmessage = (data: string) => {
          const msg = JSON.parse(data);
          if (msg.reqId === reqId) { resolve(msg); }
        };
      });
      return { ws, openResp };
    }

    try {
      let { ws, openResp } = await openWsAndDoc();
      assert.isUndefined(openResp.error);
      ws.close();

      await handle.restart();
      await pollUntilReady(serverUrl);

      ({ ws, openResp } = await openWsAndDoc());
      assert.isUndefined(openResp.error);
      ws.close();
    } finally {
      await axios.delete(`${serverUrl}/api/docs/${docId}`, chimpy);
    }
  });
});

async function createTestDoc(serverUrl: string, name: string): Promise<string> {
  const chimpy = configForUser("Chimpy");
  const orgsResp = await axios.get(`${serverUrl}/api/orgs`, chimpy);
  const wsResp = await axios.get(
    `${serverUrl}/api/orgs/${orgsResp.data[0].id}/workspaces`, chimpy);
  const docResp = await axios.post(
    `${serverUrl}/api/workspaces/${wsResp.data[0].id}/docs`, { name }, chimpy);
  assert.equal(docResp.status, 200);
  return docResp.data;
}

async function pollUntilReady(url: string, timeoutMs = 30000) {
  let notReadyCount = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResp = await axios.get(`${url}/status`);
    assert.equal(statusResp.status, 200, "/status should always be reachable");
    const readyResp = await axios.get(`${url}/status?ready=1`, { validateStatus: () => true });
    if (readyResp.status === 200) { return notReadyCount; }
    // 500 means the shell's fallback is reporting "not ready"; anything
    // else is unexpected and should fail the test.
    assert.equal(readyResp.status, 500, `unexpected /status?ready=1 status ${readyResp.status}`);
    notReadyCount++;
    await delay(200);
  }
  throw new Error("Server did not become ready in time");
}
