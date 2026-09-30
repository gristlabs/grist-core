/**
 * Upgrading a server with Redis from a docker image up to 1.7.17, which registered its worker at
 * http://0.0.0.0:<port>. See https://github.com/gristlabs/grist-core/issues/2587.
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
  let server: TestServer | undefined;
  let workers: DocWorkerMap | undefined;

  after(async function() {
    await workers?.close();
    await TestServer.stopAll([server]);
    oldEnv?.restore();
  });

  it("removes workers registered at 0.0.0.0 when it starts", async function() {
    const setup = await prepareRedisTest(this, "StartupWorkerCleanup");
    oldEnv = setup.oldEnv;
    workers = new DocWorkerMap([createClient(process.env.TEST_REDIS_URL)]);
    for (const [id, url] of [["old", "http://0.0.0.0:8484/v/old/"], ["peer", "http://10.0.0.9:8484/v/x/"]]) {
      await workers.addWorker({ id, publicUrl: url, internalUrl: url });
    }
    server = await TestServer.startServer("home,docs,static", setup.testDir, "cleanup", {});
    const ids = (await workers.getRegisteredWorkers()).map(r => r.info.id);
    assert.notInclude(ids, "old");
    assert.include(ids, "peer");
  });
});
