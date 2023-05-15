import {integerParam} from 'app/server/lib/requestUtils';
import {ObjSnapshotWithMetadata} from 'app/common/DocSnapshot';
import {SnapshotWindow} from 'app/common/Features';
import {KeyedMutex} from 'app/common/KeyedMutex';
import {KeyedOps} from 'app/common/KeyedOps';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import log from 'app/server/lib/log';
import * as fse from 'fs-extra';
import * as moment from 'moment-timezone';

/**
 * A subset of the ExternalStorage interface, focusing on maintaining a list of versions.
 */
export interface IInventory {
  getSnapshotWindow?: (key: string) => Promise<SnapshotWindow|undefined>;
  versions(key: string): Promise<ObjSnapshotWithMetadata[]>;
  remove(key: string, snapshotIds: string[]): Promise<void>;
}

/**
 * A utility for pruning snapshots, so the number of snapshots doesn't get out of hand.
 */
export class DocSnapshotPruner {
  private _closing: boolean = false;                        // when set, should ignore prune requests
  private _prunes: KeyedOps;

  // Specify store to be pruned, and delay before pruning.
  constructor(private _ext: IInventory, _options: {
    delayBeforeOperationMs?: number,
    minDelayBetweenOperationsMs?: number
  } = {}) {
    this._prunes = new KeyedOps((key) => this.prune(key), {
      ..._options,
      retry: false,
      logError: (key, failureCount, err) => log.error(`Pruning document ${key} gave error ${err}`)
    });
  }

  // Shut down.  Prunes scheduled for the future are run immediately.
  // Can be called repeated safely.
  public async close() {
    this._closing = true;
    this._prunes.expediteOperations();
    await this.wait();
  }

  // Wait for all in-progress prunes to finish up in an orderly fashion.
  public async wait() {
    await this._prunes.wait(() => 'waiting for pruning to finish');
  }

  // Note that a document has changed, and should be pruned (or repruned).  Pruning operation
  // done as a background operation.  Returns true if a pruning operation has been scheduled.
  public requestPrune(key: string): boolean {
    // If closing down, do not accept any prune requests.
    if (!this._closing) {
      // Mark the key as needing work.
      this._prunes.addOperation(key);
    }
    return this._prunes.hasPendingOperation(key);
  }

  // Get all snapshots for a document, and whether they should be kept or pruned.
  public async classify(key: string): Promise<Array<{snapshot: ObjSnapshotWithMetadata, keep: boolean}>> {
    const snapshotWindow = await this._ext.getSnapshotWindow?.(key);
    const versions = await this._ext.versions(key);
    return shouldKeepSnapshots(versions, snapshotWindow).map((keep, index) => ({keep, snapshot: versions[index]}));
  }

  // Prune the specified document immediately.  If no snapshotIds are provided, they
  // will be chosen automatically.
  public async prune(key: string, snapshotIds?: string[]) {
    if (!snapshotIds) {
      const versions = await this.classify(key);
      const redundant = versions.filter(v => !v.keep);
      snapshotIds = redundant.map(r => r.snapshot.snapshotId);
      await this._ext.remove(key, snapshotIds);
      log.info(`Pruned ${snapshotIds.length} versions of ${versions.length} for document ${key}`);
    } else {
      await this._ext.remove(key, snapshotIds);
      log.info(`Pruned ${snapshotIds.length} externally selected versions for document ${key}`);
    }
  }
}

/**
 * Maintain a list of document versions, with metadata, so we can query versions and
 * make sensible pruning decisions without needing to HEAD each version (in the
 * steady state).
 *
 * The list of versions (with metadata) for a document is itself stored in S3.  This isn't
 * ideal since we cannot simply append a new version to the list without rewriting it in full.
 * But the alternatives have more serious problems, and this way folds quite well into the
 * existing pruning setup.
 *   - Storing in db would mean we'd need sharding sooner than otherwise
 *   - Storing in redis would similarly make this the dominant load driving redis
 *   - Storing in dynamodb would create more operational work
 *   - Using S3 metadata alone would be too slow
 *   - Using S3 tags could do some of what we want, but tags have serious limits
 *
 * Operations related to a particular document are serialized for clarity.
 *
 * The inventory is cached on the local file system, since we reuse the ExternalStorage
 * interface which is file based.
 */
export class DocSnapshotInventory implements IInventory {
  private _needFlush = new Set<string>();
  private _mutex = new KeyedMutex();

  /**
   * Expects to be given the store for documents, a store for metadata, and a method
   * for naming cache files on the local filesystem.  The stores should be consistent.
   */
  constructor(
    private _doc: ExternalStorage,
    private _meta: ExternalStorage,
    private _getFilename: (key: string) => Promise<string>,
    public getSnapshotWindow: (key: string) => Promise<SnapshotWindow|undefined>,
  ) {}

  /**
   * Start keeping inventory for a new document.
   */
  public async create(key: string) {
    await this._mutex.runExclusive(key, async() => {
      const fname = await this._getFilename(key);
      await this._saveToFile(fname, []);
      this._needFlush.add(key);
    });
  }

  /**
   * Return true if document inventory does not need to be saved and is not in flux.
   */
  public isSaved(key: string) {
    return !this._needFlush.has(key) && !this._mutex.isLocked(key);
  }

  /**
   * Add a new snapshot of a document to the existing inventory.  A prevSnapshotId may
   * be supplied as a cross-check.  It will be matched against the most recent
   * snapshotId in the inventory, and if it doesn't match the inventory will be
   * recreated.
   *
   * The inventory is not automatically flushed to S3.  Call flush() to do that,
   * or ask DocSnapshotPrune.requestPrune() to prune the document - it will flush
   * after pruning.
   *
   * The snapshot supplied will be modified in place to a normalized form.
   */
  public async add(key: string, snapshot: ObjSnapshotWithMetadata, prevSnapshotId: string|null) {
    await this.uploadAndAdd(key, async () => {
      return { snapshot, prevSnapshotId };
    });
  }

  /**
   * Like add(), but takes an "upload" callback that allows
   * preparing snapshot and prevSnapshotId atomically with the
   * rest of the add operation, and thus serialized with any
   * other operations such as versions(). This is important since an
   * upload changes the list of versions as far as the external store
   * is concerned, which could trigger a "surprise" and a full reload
   * of the version list.
   */
  public async uploadAndAdd(key: string,
                            upload: () => Promise<{snapshot?: ObjSnapshotWithMetadata,
                                                   prevSnapshotId: string|null}>) {
    await this._mutex.runExclusive(key, async() => {
      const {snapshot, prevSnapshotId} = await upload();
      if (!snapshot) {
        // the upload generated no snapshot, so there is nothing to do.
        return;
      }
      const snapshots = await this._getSnapshots(key, prevSnapshotId);
      // Could be already added if reconstruction happened.
      if (snapshots[0] && snapshots[0].snapshotId === snapshot.snapshotId) { return; }
      this._normalizeMetadata(snapshot);
      snapshots.unshift(snapshot);
      const fname = await this._getFilename(key);
      await this._saveToFile(fname, snapshots);
      // We don't write to s3 yet, but do mark the list as dirty.
      this._needFlush.add(key);
    });
  }

  /**
   * Make sure the latest state of the inventory is stored in S3.
   */
  public async flush(key: string) {
    await this._mutex.runExclusive(key, async() => {
      await this._flush(key);
    });
  }

  /**
   * Wipe local cached state of the inventory.
   */
  public async clear(key: string) {
    await this._mutex.runExclusive(key, async() => {
      await this._flush(key);
      const fname = await this._getFilename(key);
      // NOTE: fse.remove succeeds also when the file does not exist.
      await fse.remove(fname);
    });
  }

  /**
   * Remove a set of snapshots from the inventory, and then flush to S3.
   */
  public async remove(key: string, snapshotIds: string[]) {
    await this._mutex.runExclusive(key, async() => {
      const current = await this._getSnapshots(key, null);
      const oldIds = new Set(snapshotIds);
      if (oldIds.size > 0) {
        const results = current.filter(v => !oldIds.has(v.snapshotId));
        const fname = await this._getFilename(key);
        await this._doc.remove(key, snapshotIds);
        await this._saveToFile(fname, results);
        this._needFlush.add(key);
      }
      await this._flush(key);
    });
  }

  /**
   * Read the cached version of the inventory if available, otherwise fetch
   * it from S3.  If expectSnapshotId is set, the cached version is ignored if
   * the most recent version listed is not the expected one.
   */
  public async versions(key: string, expectSnapshotId?: string|null): Promise<ObjSnapshotWithMetadata[]> {
    return this._mutex.runExclusive(key, async() => {
      return await this._getSnapshots(key, expectSnapshotId || null);
    });
  }

  // Do whatever it takes to get an inventory of versions.
  // Most recent versions returned first.
  private async _getSnapshots(key: string, expectSnapshotId: string|null): Promise<ObjSnapshotWithMetadata[]> {
    // Check if we have something useful cached on the local filesystem.
    const fname = await this._getFilename(key);
    let data = await this._loadFromFile(fname);
    if (data && expectSnapshotId && data[0]?.snapshotId !== expectSnapshotId) {
      data = null;
    }

    // If nothing yet, check if we have something useful in s3.
    if (!data && await this._meta.exists(key)) {
      await fse.remove(fname);
      await this._meta.download(key, fname);
      data = await this._loadFromFile(fname);
      if (data && expectSnapshotId && data[0]?.snapshotId !== expectSnapshotId) {
        data = null;
      }
    }

    if (!data) {
      // No joy, all we can do is reconstruct from individual s3 version HEAD metadata.
      data = await this._reconstruct(key);
      if (data) {
        if (expectSnapshotId && data[0]?.snapshotId !== expectSnapshotId) {
          // Surprising, since S3 ExternalInterface should have its own consistency
          // checks. Not much we can do about it other than accept it.
          log.error(`Surprise in getSnapshots, expected ${expectSnapshotId} for ${key} ` +
                    `but got ${data[0]?.snapshotId}`);
        }
        // Reconstructed data is precious.  Make sure it gets saved.
        await this._saveToFile(fname, data);
        this._needFlush.add(key);
      }
    }
    return data;
  }

  // Load inventory from local file system, if available.
  private async _loadFromFile(fname: string): Promise<ObjSnapshotWithMetadata[]|null> {
    try {
      if (await fse.pathExists(fname)) {
        return JSON.parse(await fse.readFile(fname, 'utf8'));
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Save inventory to local file system.
  private async _saveToFile(fname: string, data: ObjSnapshotWithMetadata[]) {
    await fse.outputFile(fname, JSON.stringify(data, null, 2), 'utf8');
  }

  // This is a relatively expensive operation, calling the S3 api for every stored
  // version of a document. In the steady state, we should rarely need to do this.
  private async _reconstruct(key: string): Promise<ObjSnapshotWithMetadata[]> {
    const snapshots = await this._doc.versions(key);
    if (snapshots.length > 1) {
      log.info(`Reconstructing history of ${key} (${snapshots.length} versions)`);
    }
    const results: ObjSnapshotWithMetadata[] = [];
    for (const snapshot of snapshots) {
      const head = await this._doc.head(key, snapshot.snapshotId);
      if (head) {
        this._normalizeMetadata(head);
        results.push(head);
      } else {
        log.debug(`When reconstructing history of ${key}, did not find ${snapshot.snapshotId}`);
      }
    }
    return results;
  }

  // Flush inventory to S3.
  private async _flush(key: string) {
    if (this._needFlush.has(key)) {
      const fname = await this._getFilename(key);
      await this._meta.upload(key, fname);
      this._needFlush.delete(key);
    }
  }

  // Normalize metadata.  We store a timestamp that is distinct from the S3 timestamp,
  // recording when the file was changed by Grist.
  // TODO: deal with possibility of this creating trouble with pruning if the local time is
  // sufficiently wrong.
  private _normalizeMetadata(snapshot: ObjSnapshotWithMetadata) {
    if (snapshot?.metadata?.t) {
      snapshot.lastModified = snapshot.metadata.t;
      delete snapshot.metadata.t;
    }
  }
}

/**
 * Calculate which snapshots to keep.  Expects most recent snapshots to be first.
 * We keep:
 *   - The five most recent versions (including the current version)
 *   - The most recent version in every hour, for up to 25 distinct hours
 *   - The most recent version in every day, for up to 32 distinct days
 *   - The most recent version in every week, for up to 12 distinct weeks
 *   - The most recent version in every month, for up to 96 distinct months
 *   - The most recent version in every year, for up to 1000 distinct years
 *   - Anything with a label, for up to 32 days before the current version.
 * Calculations done in UTC, Gregorian calendar, ISO weeks (week starts with Monday).
 */
export function shouldKeepSnapshots(snapshots: ObjSnapshotWithMetadata[], snapshotWindow?: SnapshotWindow): boolean[] {
  // Get current version
  const current = snapshots[0];
  if (!current) { return []; }

  const tz = current.metadata?.tz || 'UTC';

  // Get time of current version
  const start = moment.tz(current.lastModified, tz);
  const capObjectString = process.env.GRIST_SNAPSHOT_TIME_CAP
        || '{"hour": 25, "day": 32, "isoWeek": 12, "month": 96, "year": 1000}';

  // Parse the stringified JSON object into an actual object
  const caps = JSON.parse(capObjectString);

  // Extract the cap values for each bucket range and convert them to integers
  const capHour = integerParam(caps.hour, "GRIST_SNAPSHOT_TIMEBUCKET_CAP.hour");
  const capDay = integerParam(caps.day, "GRIST_SNAPSHOT_TIMEBUCKET_CAP.day");
  const capIsoWeek = integerParam(caps.isoWeek, "GRIST_SNAPSHOT_TIMEBUCKET_CAP.isoWeek");
  const capMonth = integerParam(caps.month, "GRIST_SNAPSHOT_TIMEBUCKET_CAP.month");
  const capYear = integerParam(caps.year, "GRIST_SNAPSHOT_TIMEBUCKET_CAP.year");
  // Track saved version per hour, day, week, month, year, and number of times a version
  // has been saved based on a corresponding rule.
  const buckets: TimeBucket[] = [
      {range: 'hour', prev: start, usage: 0, cap: capHour},
      {range: 'day', prev: start, usage: 0, cap: capDay},
      {range: 'isoWeek', prev: start, usage: 0, cap: capIsoWeek},
      {range: 'month', prev: start, usage: 0, cap: capMonth},
      {range: 'year', prev: start, usage: 0, cap: capYear}
  ];

  // For each snapshot starting with newest, check if it is worth saving by comparing
  // it with the last saved snapshot based on hour, day, week, month, year
  return snapshots.map((snapshot, index) => {
    // Just to make extra sure we don't delete everything
    if (index === 0) {
      return true;
    }

    const date = moment.tz(snapshot.lastModified, tz);

    // Limit snapshots to the given window corresponding to what the user has paid for
    if (snapshotWindow && start.diff(date, snapshotWindow.unit, true) > snapshotWindow.count) {
      return false;
    }

    // Keep 5 most recent versions if NUM_SNAPSHOT_KEEP not exist
    let keep = index < integerParam(process.env.GRIST_SNAPSHOT_KEEP || 5, "GRIST_SNAPSHOT_KEEP");

    for (const bucket of buckets) {
      if (updateAndCheckRange(date, bucket)) { keep = true; }
    }
    // Preserve recent labelled snapshots in a naive and limited way.  No doubt this will
    // be elaborated on if we make this a user-facing feature.
    if (snapshot.metadata?.label &&
        start.diff(date, 'days') < 32) { keep = true; }
    return keep;
  });
}

/**
 * Check whether time `t` is in the same time-bucket as the time
 * stored in `prev` for that time-bucket, and the time-bucket has not
 * been used to its limit to justify saving versions.
 *
 * If all is good, we return true, store `t` in the appropriate
 * time-bucket in `prev`, and increment the usage count.  Note keeping
 * a single version can increment usage on several buckets.  This is
 * easy to change, but other variations have results that feel
 * counter-intuitive.
 */
function updateAndCheckRange(t: moment.Moment, bucket: TimeBucket) {
  if (bucket.usage < bucket.cap && !t.isSame(bucket.prev, bucket.range)) {
    bucket.prev = t;
    bucket.usage++;
    return true;
  }
  return false;
}

interface TimeBucket {
  range: 'hour' | 'day' | 'isoWeek' | 'month' | 'year',
  prev: moment.Moment;   // last time stored in this bucket
  usage: number;         // number of times this bucket justified saving a snapshot
  cap: number;           // maximum number of usages permitted
}
