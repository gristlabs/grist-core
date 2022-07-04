import {DocumentMetadata, HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import log from 'app/server/lib/log';

/**
 * HostedMetadataManager handles pushing document metadata changes to the Home database when
 * a doc is updated. Currently updates doc updatedAt time and usage.
 */
export class HostedMetadataManager {

  // Document metadata mapped by docId.
  private _metadata: {[docId: string]: DocumentMetadata} = {};

  // Set if the class holder is closing and no further pushes should be scheduled.
  private _closing: boolean = false;

  // Last push time in ms since epoch.
  private _lastPushTime: number = 0.0;

  // Callback for next opportunity to push changes.
  private _timeout: NodeJS.Timeout|null = null;

  // Maintains the update Promise to wait on it if the class is closing.
  private _push: Promise<void>|null;

  // The default delay in milliseconds between metadata pushes to the database.
  private readonly _minPushDelayMs: number;

  /**
   * Create an instance of HostedMetadataManager.
   * The minPushDelay is the default delay in seconds between metadata pushes to the database.
   */
  constructor(private _dbManager: HomeDBManager, minPushDelay: number = 60) {
    this._minPushDelayMs = minPushDelay * 1000;
  }

  /**
   * Close the manager. Send out any pending updates and prevent more from being scheduled.
   */
  public async close(): Promise<void> {
    // Pushes will no longer be scheduled.
    this._closing = true;
    // Wait for outgoing pushes to finish before proceeding.
    if (this._push) { await this._push; }
    if (this._timeout) {
      // Since an update was scheduled, perform one final update now.
      this._update();
      if (this._push) { await this._push; }
    }
  }

  /**
   * Schedule a call to _update some time from now.  When the update is made, it will
   * store the given metadata in the updated_at and usage columns of the docs table for
   * the specified document.
   *
   * If `minimizeDelay` is true, the push will be scheduled with minimum delay (0ms) and
   * will cancel/overwrite an already scheduled push (if present).
   */
  public scheduleUpdate(docId: string, metadata: DocumentMetadata, minimizeDelay = false): void {
    if (this._closing) { return; }

    // Update metadata even if an update is already scheduled - if the update has not yet occurred,
    // the more recent metadata will be used.
    this._setOrUpdateMetadata(docId, metadata);
    if (this._timeout && !minimizeDelay) { return; }

    this._schedulePush(minimizeDelay ? 0 : undefined);
  }

  public setDocsMetadata(docUpdateMap: {[docId: string]: DocumentMetadata}): Promise<any> {
    return this._dbManager.setDocsMetadata(docUpdateMap);
  }

  /**
   * Push all metadata updates to the database.
   */
  private _update(): void {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    if (this._push) { return; }
    this._push = this._performUpdate()
    .catch(err => {
      log.error("HostedMetadataManager error performing update: ", err);
    })
    .then(() => {
      this._push = null;
      if (!this._closing && !this._timeout && Object.keys(this._metadata).length !== 0) {
        // If we have metadata that hasn't been pushed up yet, but no push scheduled,
        // go ahead and schedule an immediate push. This can happen if `scheduleUpdate`
        // is called frequently with minimizeDelay set to true, particularly when
        // _performUpdate is taking a bit longer than normal to complete.
        this._schedulePush(0);
      }
    });
  }

  /**
   * This is called by the update function to actually perform the update. This should not
   * be called unless to force an immediate update.
   */
  private async _performUpdate(): Promise<void> {
    // Await the database if it is not yet connected.
    const docUpdates = this._metadata;
    this._metadata = {};
    this._lastPushTime = Date.now();
    await this.setDocsMetadata(docUpdates);
  }

  /**
   * Schedule a metadata push.
   *
   * If `delayMs` is specified, the push will be scheduled to occur at least that
   * number of milliseconds in the future. If `delayMs` is unspecified, the push
   * will be scheduled to occur at least `_minPushDelayMs` after the last push time.
   *
   * If called while a push is already scheduled, that push will be cancelled and
   * replaced with this one.
   */
  private _schedulePush(delayMs?: number): void {
    if (delayMs === undefined) {
      delayMs = Math.round(this._minPushDelayMs - (Date.now() - this._lastPushTime));
    }
    if (this._timeout) { clearTimeout(this._timeout); }
    this._timeout = setTimeout(() => this._update(), delayMs < 0 ? 0 : delayMs);
  }

  /**
   * Adds `docId` and its `metadata` to the list of queued updates, merging any existing values.
   */
  private _setOrUpdateMetadata(docId: string, metadata: DocumentMetadata): void {
    if (!this._metadata[docId]) {
      this._metadata[docId] = metadata;
    } else {
      const {updatedAt, usage} = metadata;
      if (updatedAt) { this._metadata[docId].updatedAt = updatedAt; }
      if (usage !== undefined) { this._metadata[docId].usage = usage; }
    }
  }
}
