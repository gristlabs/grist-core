import { collectDefaultMetrics, Counter, Gauge, Histogram } from "prom-client";

import type { DataSource } from "typeorm";

const BYTES_PER_MB = 1024 ** 2;

export interface ActiveDocMetricsSource {
  numOpenDocs(): number;
  getTotalMemoryUsedMB(): number;
}

export type DocOpenMode = "normal" | "recovery";

export interface HttpRequestLabels {
  role: string;
  method: string;
  route: string;
}

export interface DocWorkerLoadMeasurement {
  loadRatio: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
}

interface PoolCounts {
  total: number;
  idle: number;
  waiting: number;
}

interface PoolLike {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

let _activeDocs: ActiveDocMetricsSource | undefined;
let _homeDbConnection: DataSource | undefined;

export const gristActiveDocOpen = new Gauge({
  name: "grist_activedoc_open",
  help: "Number of documents currently loaded in memory",
  collect() {
    this.reset();
    if (_activeDocs) {
      this.set(_activeDocs.numOpenDocs());
    }
  },
});

export const gristActiveDocDataEngineBytes = new Gauge({
  name: "grist_activedoc_data_engine_bytes",
  help: "Memory used by the data engines of the documents loaded in memory",
  collect() {
    this.reset();
    if (_activeDocs) {
      this.set(_activeDocs.getTotalMemoryUsedMB() * BYTES_PER_MB);
    }
  },
});

export const gristHomeDbPoolConnections = new Gauge<"state">({
  name: "grist_home_db_pool_connections",
  help: "Connections held by the home database pool, by state",
  labelNames: ["state"],
  collect() {
    this.reset();
    const counts = _homeDbConnection ? poolCounts(_homeDbConnection) : undefined;
    if (!counts) {
      return;
    }
    this.set({ state: "total" }, counts.total);
    this.set({ state: "idle" }, counts.idle);
    this.set({ state: "waiting" }, counts.waiting);
  },
});

export const gristDocWorkerLoadRatio = unreportedGauge(
  "grist_doc_worker_load_ratio",
  "Load of this doc worker, as reported to the worker assignment algorithm",
);

export const gristDocWorkerMemoryUsedBytes = unreportedGauge(
  "grist_doc_worker_memory_used_bytes",
  "Memory used by the documents loaded on this doc worker",
);

export const gristDocWorkerMemoryTotalBytes = unreportedGauge(
  "grist_doc_worker_memory_total_bytes",
  "Memory budget of this doc worker, absent when unbounded",
);

export const gristHttpRequestDuration = new Histogram({
  name: "grist_http_request_duration_seconds",
  help: "Latency of the HTTP requests this server answered",
  labelNames: ["role", "method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const gristRpcDuration = new Histogram({
  name: "grist_rpc_duration_seconds",
  help: "Latency of the RPC methods this server answered",
  labelNames: ["method"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

export const gristActiveDocOpenDuration = new Histogram({
  name: "grist_activedoc_open_duration_seconds",
  help: "Latency of opening a document, from fetch to loaded",
  labelNames: ["mode"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
});

export const gristRedisOpDuration = new Histogram({
  name: "grist_redis_op_duration_seconds",
  help: "Latency of the Redis commands this server sent",
  labelNames: ["op"],
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

export const gristRedisOpErrors = new Counter({
  name: "grist_redis_op_errors_total",
  help: "Redis commands that failed",
  labelNames: ["op"],
});

function unreportedGauge(name: string, help: string): Gauge {
  const gauge = new Gauge({ name, help });
  gauge.remove();
  return gauge;
}

function poolCounts(connection: DataSource): PoolCounts | undefined {
  const pool = (connection.driver as { master?: PoolLike }).master;
  if (!pool) {
    return undefined;
  }
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

export function recordDocWorkerLoad(
  { loadRatio, memoryUsedMB, memoryTotalMB }: DocWorkerLoadMeasurement,
) {
  gristDocWorkerLoadRatio.set(loadRatio);
  gristDocWorkerMemoryUsedBytes.set(memoryUsedMB * BYTES_PER_MB);
  if (Number.isFinite(memoryTotalMB)) {
    gristDocWorkerMemoryTotalBytes.set(memoryTotalMB * BYTES_PER_MB);
  } else {
    gristDocWorkerMemoryTotalBytes.remove();
  }
}

export function trackActiveDocs(source: ActiveDocMetricsSource) {
  _activeDocs = source;
}

export function trackHomeDbPool(connection: DataSource | undefined) {
  _homeDbConnection = connection;
}

export function observeHttpRequest(labels: HttpRequestLabels, statusCode: number, seconds: number) {
  const status = `${Math.floor(statusCode / 100)}xx`;
  gristHttpRequestDuration.observe({ ...labels, status }, seconds);
}

export function observeRpcMethod(method: string, seconds: number) {
  gristRpcDuration.observe({ method }, seconds);
}

export function observeDocOpen(mode: DocOpenMode, seconds: number) {
  gristActiveDocOpenDuration.observe({ mode }, seconds);
}

export function secondsTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1e9;
}

export function instrumentRpcMethod<M extends (client: any, ...args: any[]) => unknown>(
  methodName: string, method: M,
): M {
  return (async function(client: any, ...args: any[]) {
    const elapsed = secondsTimer();
    try {
      return await method(client, ...args);
    } finally {
      observeRpcMethod(methodName, elapsed());
    }
  }) as M;
}

const ID_SEGMENT = /^(?:\d+|[A-Za-z0-9_-]{12,})$/;

export function normalizeRoute(path: string): string {
  const withoutWorker = path.replace(/^\/dw\/[^/]+/, "");
  return withoutWorker.split("/").map(segment => (ID_SEGMENT.test(segment) ? ":id" : segment)).join("/");
}

export function requestRoute(req: { baseUrl?: string, path: string, route?: { path?: unknown } }): string {
  const matched = req.route?.path;
  return normalizeRoute(typeof matched === "string" ? `${req.baseUrl ?? ""}${matched}` : req.path);
}

const INSTRUMENTED = Symbol("gristMetricsInstrumented");

interface SendingCommands {
  call(thisArg: unknown, command: unknown): unknown;
}

export function instrumentRedisClient(redisClient?: { prototype: unknown }) {
  const redis = redisClient ?? loadRedisClient();
  const proto = redis?.prototype as { [INSTRUMENTED]?: boolean, internal_send_command?: SendingCommands };
  if (!proto?.internal_send_command || proto[INSTRUMENTED]) {
    return;
  }
  const send = proto.internal_send_command;
  proto[INSTRUMENTED] = true;
  proto.internal_send_command = function(this: unknown, command: any) {
    const callback = command?.callback;
    if (typeof callback !== "function") {
      return send.call(this, command);
    }
    const op = String(command?.command ?? "unknown").toLowerCase();
    const elapsed = secondsTimer();
    command.callback = function(err: Error | null, res: unknown) {
      gristRedisOpDuration.observe({ op }, elapsed());
      if (err) {
        gristRedisOpErrors.inc({ op });
      }
      return callback.call(this, err, res);
    };
    return send.call(this, command);
  };
}

function loadRedisClient(): { prototype: unknown } | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("redis").RedisClient;
  } catch (e) {
    return undefined;
  }
}

export function initMetrics() {
  collectDefaultMetrics();
  instrumentRedisClient();
}
