import { clamp } from "app/common/gutil";
import { Interval } from "app/common/Interval";
import { DocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { appSettings } from "app/server/lib/AppSettings";
import { DocManager } from "app/server/lib/DocManager";
import { DocWorkerInfo, IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import log from "app/server/lib/log";
import { LogMethods } from "app/server/lib/LogMethods";

export const Deps = {
  docWorkerMaxMemoryMB: appSettings
    .section("docWorker")
    .flag("maxMemoryMB")
    .readInt({
      envVar: "GRIST_DOC_WORKER_MAX_MEMORY_MB",
      minValue: 1,
    }),
  docWorkerUpdateLoadIntervalMs: appSettings
    .section("docWorker")
    .flag("updateLoadIntervalMs")
    .requireInt({
      envVar: "GRIST_DOC_WORKER_UPDATE_LOAD_INTERVAL_MS",
      minValue: 1,
      defaultValue: 5 * 1000,
    }),
  docWorkerUpdateLoadVarianceMs: appSettings
    .section("docWorker")
    .flag("updateLoadVarianceMs")
    .requireInt({
      envVar: "GRIST_DOC_WORKER_UPDATE_LOAD_VARIANCE_MS",
      minValue: 0,
      defaultValue: 1 * 1000,
    }),
};

/**
 * Returns a {@link DocWorkerLoadTracker} or `undefined` if `docWorkerMap` is
 * not backed by Redis.
 */
export function getDocWorkerLoadTracker(
  docWorkerInfo: DocWorkerInfo,
  docWorkerMap: IDocWorkerMap,
  docManager: DocManager
): DocWorkerLoadTracker | undefined {
  if (docWorkerMap instanceof DocWorkerMap) {
    log.info("Creating Redis-based DocWorkerLoadTracker");
    return new DocWorkerLoadTracker(docWorkerInfo, docWorkerMap, docManager);
  } else {
    return undefined;
  }
}

/**
 * Periodically updates doc worker load by pushing it to a Redis-backed
 * {@link IDocWorkerMap}.
 */
export class DocWorkerLoadTracker {
  private _log = new LogMethods("DocWorkerLoadTracker ", () => ({}));
  private _interval = new Interval(
    this._updateLoad.bind(this),
    {
      delayMs: Deps.docWorkerUpdateLoadIntervalMs,
      varianceMs: Deps.docWorkerUpdateLoadVarianceMs,
    },
    {
      onError: (e) => this._log.error(null, "failed to update worker load", e),
    }
  );

  constructor(
    private _docWorkerInfo: DocWorkerInfo,
    private _docWorkerMap: IDocWorkerMap,
    private _docManager: DocManager
  ) {}

  /**
   * Starts periodically updating load.
   */
  public start() {
    this._interval.enable();
  }

  /**
   * Stops periodically updating load.
   */
  public stop() {
    this._interval.disable();
  }

  /**
   * Returns a number between `0.0` and `1.0` inclusive representing the load
   * of a worker.
   *
   * A worker's load is the ratio of used to total memory, where used memory is
   * the combined total of data engine memory across all loaded documents, and
   * total memory is `GRIST_DOC_WORKER_MAX_MEMORY_MB`.
   *
   * If `GRIST_DOC_WORKER_MAX_MEMORY_MB` is unset, load will always be reported
   * as 0, resulting in uniform random selection being used for the worker
   * assignment algorithm.
   */
  public getLoad() {
    const memoryUsedMB = this._docManager.getTotalMemoryUsedMB();
    const memoryTotalMB = Deps.docWorkerMaxMemoryMB ?? Infinity;
    return clamp(memoryUsedMB / memoryTotalMB, 0.0, 1.0);
  }

  private async _updateLoad() {
    await this._docWorkerMap.setWorkerLoad(
      this._docWorkerInfo,
      this.getLoad()
    );
  }
}
