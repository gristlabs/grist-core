import {
  gristActiveDocDataEngineBytes, gristActiveDocOpen, gristDocWorkerLoadRatio,
  gristDocWorkerMemoryTotalBytes, gristDocWorkerMemoryUsedBytes, gristHomeDbPoolConnections,
  recordDocWorkerLoad, trackActiveDocs, trackHomeDbPool,
} from "app/server/lib/metrics";

import { assert } from "chai";

import type { DataSource } from "typeorm";

const MB = 1024 ** 2;

function docManagerStub(numOpenDocs: () => number, getTotalMemoryUsedMB: () => number) {
  return { numOpenDocs, getTotalMemoryUsedMB };
}

function connectionStub(driver: object): DataSource {
  return { driver } as unknown as DataSource;
}

describe("metrics", function() {
  describe("grist_activedoc_open", function() {
    it("reads the doc manager it was pointed at, at scrape time", async function() {
      let open = 2;
      trackActiveDocs(docManagerStub(() => open, () => 0));
      assert.deepEqual((await gristActiveDocOpen.get()).values.map(v => v.value), [2]);
      open = 5;
      assert.deepEqual((await gristActiveDocOpen.get()).values.map(v => v.value), [5]);
    });

    it("follows the newest doc manager, since tests build several", async function() {
      trackActiveDocs(docManagerStub(() => 1, () => 0));
      trackActiveDocs(docManagerStub(() => 7, () => 0));
      assert.deepEqual((await gristActiveDocOpen.get()).values.map(v => v.value), [7]);
    });
  });

  describe("grist_activedoc_data_engine_bytes", function() {
    it("reports the memory the doc manager accounts for, in bytes", async function() {
      trackActiveDocs(docManagerStub(() => 1, () => 3));
      assert.deepEqual((await gristActiveDocDataEngineBytes.get()).values.map(v => v.value), [3 * MB]);
    });
  });

  describe("grist_home_db_pool_connections", function() {
    it("splits the pool into total, idle and waiting connections", async function() {
      trackHomeDbPool(connectionStub({ master: { totalCount: 10, idleCount: 7, waitingCount: 2 } }));
      const { values } = await gristHomeDbPoolConnections.get();
      const byState = new Map(values.map(v => [v.labels.state, v.value]));
      assert.deepEqual(byState, new Map<string | number | undefined, number>([
        ["total", 10], ["idle", 7], ["waiting", 2],
      ]));
    });

    it("reports nothing for a connection that has no pool", async function() {
      trackHomeDbPool(connectionStub({}));
      assert.deepEqual((await gristHomeDbPoolConnections.get()).values, []);
    });
  });

  describe("doc worker load", function() {
    it("reports load and memory, in bytes", async function() {
      recordDocWorkerLoad({ loadRatio: 0.25, memoryUsedMB: 100, memoryTotalMB: 400 });
      assert.deepEqual((await gristDocWorkerLoadRatio.get()).values.map(v => v.value), [0.25]);
      assert.deepEqual((await gristDocWorkerMemoryUsedBytes.get()).values.map(v => v.value), [100 * MB]);
      assert.deepEqual((await gristDocWorkerMemoryTotalBytes.get()).values.map(v => v.value), [400 * MB]);
    });

    it("reports no budget for an unbounded worker, rather than Infinity or zero", async function() {
      recordDocWorkerLoad({ loadRatio: 0, memoryUsedMB: 10, memoryTotalMB: Infinity });
      assert.deepEqual((await gristDocWorkerMemoryTotalBytes.get()).values, []);
      assert.deepEqual((await gristDocWorkerMemoryUsedBytes.get()).values.map(v => v.value), [10 * MB]);
    });
  });
});
