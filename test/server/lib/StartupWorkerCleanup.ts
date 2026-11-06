/**
 * What a server with Redis cleans up in the worker map as it starts and stops.
 */

import { DocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { prepareRedisTest } from "test/server/lib/helpers/PrepareRedisTest";
import { TestServer } from "test/server/lib/helpers/TestServer";
import { EnvironmentSnapshot, setTmpLogLevel } from "test/server/testUtils";

import { assert } from "chai";
import { createClient } from "redis";

describe("StartupWorkerCleanup", function() {
  this.timeout(60000);

  setTmpLogLevel("error");

  let oldEnv: EnvironmentSnapshot;
  let server: TestServer;
  let workers: DocWorkerMap;

  before(async function() {
    const setup = await prepareRedisTest(this, "StartupCleanup");
    oldEnv = setup.oldEnv;
    workers = new DocWorkerMap([createClient(process.env.TEST_REDIS_URL)]);
    // "old" was left by a docker image up to 1.7.17. See https://github.com/gristlabs/grist-core/issues/2587.
    for (const [id, url] of [["old", "http://0.0.0.0:8484/v/old/"], ["peer", "http://10.0.0.9:8484/v/x/"]]) {
      await workers.addWorker({ id, publicUrl: url, internalUrl: url });
    }
    server = await TestServer.startServer("home,docs,static", setup.testDir, "boot", {});
  });

  after(async function() {
    await workers?.close();
    await TestServer.stopAll([server]);
    oldEnv?.restore();
  });

  it("removes workers registered at 0.0.0.0 when it starts", async function() {
    const ids = (await workers.getRegisteredWorkers()).map(r => r.info.id);
    assert.notInclude(ids, "old");
    assert.include(ids, "peer");
  });

  it("leaves its id registered when another process has taken it by the time it stops", async function() {
    const [own] = (await workers.getRegisteredWorkers()).filter(r => r.info.id !== "peer");
    await workers.addWorker({ ...own.info, incarnation: "the-replacement" });
    await server.stop();
    const kept = (await workers.getRegisteredWorkers()).find(r => r.info.id === own.info.id);
    assert.equal(kept?.info.incarnation, "the-replacement");
  });
});
