import { collectDefaultMetrics, Gauge } from "prom-client";

import type { DataSource } from "typeorm";

const BYTES_PER_MB = 1024 ** 2;

export interface ActiveDocMetricsSource {
  numOpenDocs(): number;
  getTotalMemoryUsedMB(): number;
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

export function initMetrics() {
  collectDefaultMetrics();
}
