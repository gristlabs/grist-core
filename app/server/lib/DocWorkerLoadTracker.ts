import { clamp } from "app/common/gutil";
import { Interval } from "app/common/Interval";
import { DocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { appSettings } from "app/server/lib/AppSettings";
import { DocManager, IMemoryLoadEstimator } from "app/server/lib/DocManager";
import { DocWorkerInfo, IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import log from "app/server/lib/log";
import { LogMethods } from "app/server/lib/LogMethods";

import fs from "node:fs/promises";

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
  docWorkerMemoryUsagePath: appSettings
    .section("docWorker")
    .flag("memoryUsagePath")
    .readString({
      envVar: "GRIST_DOC_WORKER_USED_MEMORY_BYTES_PATH",
    }),
  docWorkerMemoryCapacityPath: appSettings
    .section("docWorker")
    .flag("memoryCapacityPath")
    .readString({
      envVar: "GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH",
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
  private _disabledFilePaths = new Set<string>();
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
    private _docManager: IMemoryLoadEstimator
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
  public async getLoad() {
    const memoryUsedMB = await this._getMemoryUsedMB();
    const memoryTotalMB = await this._getMemoryTotalMB();
    return clamp(memoryUsedMB / memoryTotalMB, 0.0, 1.0);
  }

  /**
   * Return the amount of memory reported by a file of the system.
   * This file should contain a value in bytes, the function will convert it
   * to mega bytes.
   *
   * @param filePath The path to the file to read
   * @param valueProcessor A function that may return an amount of memory if the file contains a special value.
   *
   * @return The amount of memory reported by the file converted to megabytes.
   */
  private async _readValueFromFileInMB(
    filePath: string,
    valueProcessor?: (val: string) => number|undefined
  ): Promise<number> {
    const rawVal = await fs.readFile(filePath, "utf-8");
    const valInBytes = valueProcessor?.(rawVal) ?? parseInt(rawVal, 10);

    if (isNaN(valInBytes)) {
      throw new Error(
        `Unexpected value (not a number) found in file in "${filePath}". value = ${rawVal.slice(0, 1000)}`
      );
    }

    return valInBytes / 1024**2;
  }

  private _canReadValueFromFile(filePath: string|undefined): filePath is string {
    return filePath !== undefined && !this._disabledFilePaths.has(filePath);
  }

  /**
   * We read the memory used in this order:
   * 1. If we have a path specified for a file that contain the memory used, read this file
   * 2. Otherwise read instead the load using the estimation given by the doc manager
   *    (less accurate, typically it does not include nodejs load).
   */
  private async _getMemoryUsedMB(): Promise<number> {
    if (this._canReadValueFromFile(Deps.docWorkerMemoryUsagePath)) {
      return await this._readValueFromFileInMB(Deps.docWorkerMemoryUsagePath);
    }

    return  this._docManager.getTotalMemoryUsedMB();
  }

  /**
   * We read the total memory available in this order:
   * 1. If the admin specified an amount of total memory available through GRIST_DOC_WORKER_MAX_MEMORY_MB
   *    then use it (to cover the case the administrator wants to pass a lower value than the actual
   *    total memory, and have spare free memory for the current documents)
   * 2. If the admin specified a path to read the total amoun of memory, read it.
   * 2.1. If the value is max, consider as "Infinity"
   * 2.2. If the value is a number, return it
   * 2.3. If there is an error reading the value, an error is thrown.
   * 3. Return Infinity
   */
  private async _getMemoryTotalMB() {
    if (Deps.docWorkerMaxMemoryMB !== undefined) {
      return Deps.docWorkerMaxMemoryMB;
    }
    if (this._canReadValueFromFile(Deps.docWorkerMemoryCapacityPath)) {
      return await this._readValueFromFileInMB(
        Deps.docWorkerMemoryCapacityPath,
        // When the value is "max", return Infinity, otherwise return undefined so
        // so the function read what's probably an integer value.
        (val) => val === 'max' ? Infinity : undefined
      );
    }

    return Infinity;
  }

  private async _updateLoad() {
    await this._docWorkerMap.setWorkerLoad(
      this._docWorkerInfo,
      await this.getLoad()
    );
  }
}
