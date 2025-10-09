import { clamp } from "app/common/gutil";
import { Interval } from "app/common/Interval";
import { DocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { appSettings } from "app/server/lib/AppSettings";
import { DocManager } from "app/server/lib/DocManager";
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
      envVar: "GRIST_DOC_WORKER_MEMORY_USED_BYTES_PATH",
    }),
  docWorkerMemoryCapacityPath: appSettings
    .section("docWorker")
    .flag("memoryCapacityPath")
    .readString({
      envVar: "GRIST_DOC_WORKER_MEMORY_MAX_BYTES_PATH",
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
  private _useSystemLoad = Boolean(Deps.docWorkerMemoryUsagePath && Deps.docWorkerMemoryCapacityPath);
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
        `Unexpected value found in file (not a number), aborting. value = ${rawVal.slice(0, 1000)}`
      );
    }

    return valInBytes / 1024**2;
  }

  private async _getMemoryUsedMB(): Promise<number> {
    if (this._useSystemLoad) {
      try {
        return this._readValueFromFileInMB(Deps.docWorkerMemoryUsagePath!);
      } catch (e) {
        const methodName = `${DocWorkerLoadTracker.name}.${this._getMemoryUsedMB.name}`;
        log.error(`${methodName}: can't read value from file ${Deps.docWorkerMemoryUsagePath}.` +
          `Falling back permanently to reading values from Doc Manager estimation. Error = ${e.stack}`);
        this._useSystemLoad = false;
      }
    }

    return  this._docManager.getTotalMemoryUsedMB();
  }

  private async _getMemoryTotalMB() {
    if (Deps.docWorkerMaxMemoryMB) {
      return Deps.docWorkerMaxMemoryMB;
    }
    if (this._useSystemLoad) {
      try {
        return this._readValueFromFileInMB(
          Deps.docWorkerMemoryCapacityPath!,
          // When the value is "max", return Infinity, otherwise return undefined so
          // so the function read what's probably an integer value.
          (val) => val === 'max' ? Infinity : undefined
        );
      } catch (e) {
        const methodName = `${DocWorkerLoadTracker.name}.${this._getMemoryTotalMB.name}`;
        log.error(`${methodName}: can't read value from file ${Deps.docWorkerMemoryCapacityPath}.` +
          `Assuming the memory available is unlimited. Error = ${e.stack}`);
        this._useSystemLoad = false;
      }
    }

    return +Infinity;
  }

  private async _updateLoad() {
    await this._docWorkerMap.setWorkerLoad(
      this._docWorkerInfo,
      await this.getLoad()
    );
  }
}
