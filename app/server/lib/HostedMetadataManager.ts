import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import * as log from 'app/server/lib/log';

/**
 * HostedMetadataManager handles pushing document metadata changes to the Home database when
 * a doc is updated. Currently only updates doc updatedAt time.
 */
export class HostedMetadataManager {

  // updatedAt times as UTC ISO strings mapped by docId.
  private _updatedAt: {[docId: string]: string} = {};

  // Set if the class holder is closing and no further pushes should be scheduled.
  private _closing: boolean = false;

  // Last push time in ms since epoch.
  private _lastPushTime: number = 0.0;

  // Callback for next opportunity to push changes.
  private _timeout: any = null;

  // Mantains the update Promise to wait on it if the class is closing.
  private _push: Promise<any>|null;

  /**
   * Create an instance of HostedMetadataManager.
   * The minPushDelay is the delay in seconds between metadata pushes to the database.
   */
  constructor(private _dbManager: HomeDBManager, private _minPushDelay: number = 60) {}

  /**
   * Close the manager. Send out any pending updates and prevent more from being scheduled.
   */
  public async close(): Promise<void> {
    // Finish up everything outgoing
    this._closing = true;  // Pushes will no longer be scheduled.
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
      // Since an update was scheduled, perform one final update now.
      this._update();
    }
    if (this._push) { await this._push; }
  }

  /**
   * Schedule a call to _update some time from now.  When the update is made, it will
   * store the given timestamp in the updated_at column of the docs table for the
   * specified document. Timestamp should be an ISO 8601 format time, in UTC, e.g.
   * the output of new Date().toISOString()
   */
  public scheduleUpdate(docId: string, timestamp: string): void {
    // Update updatedAt even if an update is already scheduled - if the update has not yet occurred,
    // the more recent updatedAt time will be used.
    this._updatedAt[docId] = timestamp;
    if (this._timeout || this._closing) { return; }
    const minDelay = this._minPushDelay * 1000;
    // Set the push to occur at least the minDelay after the last push time.
    const delay = Math.round(minDelay - (Date.now() - this._lastPushTime));
    this._timeout = setTimeout(() => this._update(), delay < 0 ? 0 : delay);
  }

  public setDocsUpdatedAt(docUpdateMap: {[docId: string]: string}): Promise<any> {
    return this._dbManager.setDocsUpdatedAt(docUpdateMap);
  }

  /**
   * Push all metadata updates to the databse.
   */
  private _update(): void {
    if (this._push) { return; }
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    this._push = this._performUpdate()
    .catch(err => { log.error("HostedMetadataManager error performing update: ", err); })
    .then(() => { this._push = null; });
  }

  /**
   * This is called by the update function to actually perform the update. This should not
   * be called unless to force an immediate update.
   */
  private async _performUpdate(): Promise<void> {
    // Await the database if it is not yet connected.
    const docUpdates = this._updatedAt;
    this._updatedAt = {};
    this._lastPushTime = Date.now();
    await this.setDocsUpdatedAt(docUpdates);
  }
}
