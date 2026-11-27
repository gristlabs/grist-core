import {
  gristActiveDocDataEngineBytes, gristActiveDocOpen, gristActiveDocOpenDuration, gristDocWorkerLoadRatio,
  gristDocWorkerMemoryTotalBytes, gristDocWorkerMemoryUsedBytes, gristHomeDbPoolConnections,
  gristHttpRequestDuration, gristRedisOpDuration, gristRedisOpErrors, gristRpcDuration,
  instrumentRedisClient, instrumentRpcMethod, normalizeRoute, observeDocOpen, observeHttpRequest,
  recordDocWorkerLoad, requestRoute, trackActiveDocs, trackHomeDbPool,
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
  describe("normalizeRoute()", function() {
    it("drops the doc worker prefix, since any worker serves the same endpoint", function() {
      assert.equal(normalizeRoute("/dw/10.0.0.2/api/docs/abc/tables"), "/api/docs/abc/tables");
    });

    it("collapses ids, and keeps endpoint names", function() {
      assert.equal(normalizeRoute("/api/docs/p3cn2fnzbxFMgmU2PFZUMa/tables"), "/api/docs/:id/tables");
      assert.equal(normalizeRoute("/api/docs/p3cn2fnzbxFMgmU2PFZUMa"), "/api/docs/:id");
      assert.equal(normalizeRoute("/api/orgs/2/workspaces"), "/api/orgs/:id/workspaces");
      assert.equal(normalizeRoute("/attachments/ZXhhbXBsZS1hdHRhY2htZW50"), "/attachments/:id");
      assert.equal(normalizeRoute("/o/docs-5/api/docs"), "/o/docs-5/api/docs");
      assert.equal(normalizeRoute("/attachments"), "/attachments");
      assert.equal(normalizeRoute("/status"), "/status");
    });

    it("takes the matched route when express found one", function() {
      assert.equal(
        requestRoute({ path: "/api/docs/2/tables", baseUrl: "/dw/w1", route: { path: "/docs/:docId" } }),
        "/docs/:docId");
      assert.equal(requestRoute({ path: "/nowhere" }), "/nowhere");
    });
  });

  describe("grist_http_request_duration_seconds", function() {
    beforeEach(function() {
      gristHttpRequestDuration.reset();
    });

    it("records the route, the method and the status class", async function() {
      observeHttpRequest({ role: "server(home,docs)", method: "GET", route: "/api/docs/:id" }, 404, 0.5);
      const { values } = await gristHttpRequestDuration.get();
      const count = values.find(v => v.metricName?.endsWith("_count"))!;
      assert.equal(count.value, 1);
      assert.deepEqual(count.labels,
        { role: "server(home,docs)", method: "GET", route: "/api/docs/:id", status: "4xx" });
      const sum = values.find(v => v.metricName?.endsWith("_sum"))!;
      assert.equal(sum.value, 0.5);
    });
  });

  describe("grist_rpc_duration_seconds", function() {
    it("records the method the client called, whatever its outcome", async function() {
      gristRpcDuration.reset();
      const ok = instrumentRpcMethod("getDoc", async (_client: unknown, _docName: string) => "result");
      const failing = instrumentRpcMethod("applyUserActions",
        async (_client: unknown, _actions: unknown[]) => { throw new Error("nope"); });
      assert.equal(await ok({}, "doc"), "result");
      await assert.isRejected(failing({}, []), /nope/);
      const methods = (await gristRpcDuration.get()).values
        .filter(v => v.metricName?.endsWith("_count") && v.labels.method !== undefined)
        .map(v => v.labels.method);
      assert.includeMembers(methods, ["getDoc", "applyUserActions"]);
    });
  });

  describe("grist_activedoc_open_duration_seconds", function() {
    it("records the open mode", async function() {
      gristActiveDocOpenDuration.reset();
      observeDocOpen("recovery", 12);
      const { values } = await gristActiveDocOpenDuration.get();
      assert.isTrue(values.every(v => v.labels.mode === "recovery"));
      assert.isTrue(values.some(v => v.metricName?.endsWith("_sum") && v.value === 12));
    });
  });

  describe("instrumentRedisClient()", function() {
    it("times the commands the v3 client sends, and reports the ones that fail", async function() {
      gristRedisOpDuration.reset();
      gristRedisOpErrors.reset();
      class FakeRedisClient {
        public internal_send_command(command: any) {
          command.callback?.(command.command === "get" ? null : new Error("fail"), "OK");
          return "sent";
        }
      }
      instrumentRedisClient(FakeRedisClient);
      const client = new FakeRedisClient();
      const replies: unknown[] = [];
      assert.equal(client.internal_send_command({ command: "get", callback: (err: unknown, res: unknown) => {
        replies.push([err, res]);
      } }), "sent");
      client.internal_send_command({ command: "hgetall", callback: (err: unknown) => replies.push(err) });
      assert.deepEqual(replies, [[null, "OK"], new Error("fail")]);
      const ops = (await gristRedisOpDuration.get()).values
        .filter(v => v.metricName?.endsWith("_count") && v.labels.op !== undefined)
        .map(v => v.labels.op);
      assert.includeMembers(ops, ["get", "hgetall"]);
      const errors = (await gristRedisOpErrors.get()).values
        .filter(v => v.labels.op === "hgetall");
      assert.deepEqual(errors.map(v => v.value), [1]);
    });

    it("does nothing when the client does not have the v3 shape", function() {
      class NotRedis {}
      assert.doesNotThrow(() => instrumentRedisClient(NotRedis));
    });
  });
});
