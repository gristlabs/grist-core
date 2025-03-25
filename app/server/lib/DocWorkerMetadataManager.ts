import { Interval } from "app/common/Interval";
import { DocManager } from "app/server/lib/DocManager";
import { DocWorkerInfo, IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import { getMemoryUsage } from "app/server/lib/DocWorkerUtils";
import { LogMethods } from "app/server/lib/LogMethods";

const UPDATE_WORKER_LOAD_DELAY_MS = 5 * 1000;

/**
 * Periodically measures and updates doc worker metadata (e.g. memory usage).
 */
export class DocWorkerMetadataManager {
  private _loadingDocsCountDelta = 0;
  private _ackedDocIds: Set<string> = new Set();
  private _log = new LogMethods("DocWorkerMetadataManager ");
  private _interval = new Interval(
    this._performUpdate.bind(this),
    UPDATE_WORKER_LOAD_DELAY_MS,
    {
      onError: (e) => this._log.error(null, "failed to update worker load", e),
    }
  );

  constructor(
    private _docWorker: DocWorkerInfo,
    private _docWorkerMap: IDocWorkerMap,
    private _docManager: DocManager
  ) {
    this._increaseLoadingDocsCount = this._increaseLoadingDocsCount.bind(this);
    this._decreaseLoadingDocsCount = this._decreaseLoadingDocsCount.bind(this);
  }

  public start() {
    this._addEventListeners();
    this._interval.enable();
  }

  public async stopAndFinish() {
    this._removeEventListeners();
    await this._interval.disableAndFinish();
  }

  private async _performUpdate() {
    const { freeMemoryMB } = getMemoryUsage();
    const loadingDocsCountDelta = this._loadingDocsCountDelta || undefined;
    const ackedDocIds = [...this._ackedDocIds];
    this._loadingDocsCountDelta = 0;
    this._ackedDocIds.clear();
    await this._docWorkerMap.updateWorkerLoad(this._docWorker.id, {
      freeMemoryMB,
      loadingDocsCountDelta,
      ackedDocIds,
    });
  }

  private _increaseLoadingDocsCount(docId: string) {
    this._ackedDocIds.add(docId);
    this._loadingDocsCountDelta++;
    this._interval.scheduleImmediateCall();
  }

  private _decreaseLoadingDocsCount() {
    this._loadingDocsCountDelta--;
    this._interval.scheduleImmediateCall();
  }

  private _addEventListeners() {
    this._docManager.on("beforeadd", this._increaseLoadingDocsCount);
    this._docManager.on("add", this._decreaseLoadingDocsCount);
    this._docManager.on("error", this._decreaseLoadingDocsCount);
  }

  private _removeEventListeners() {
    this._docManager.off("beforeadd", this._increaseLoadingDocsCount);
    this._docManager.off("add", this._decreaseLoadingDocsCount);
    this._docManager.off("error", this._decreaseLoadingDocsCount);
  }
}
