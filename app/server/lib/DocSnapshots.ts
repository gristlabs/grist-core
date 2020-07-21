import { KeyedOps } from 'app/common/KeyedOps';
import { ExternalStorage } from 'app/server/lib/ExternalStorage';
import * as log from 'app/server/lib/log';
import * as moment from 'moment';

/**
 * Metadata about a single document version.
 */
export interface ObjSnapshot {
  lastModified: Date;
  snapshotId: string;
}

/**
 * Information about a single document snapshot in S3, including a Grist docId.
 * Similar to a type in app/common/UserAPI, but with lastModified as a Date
 * rather than a string.
 */
export interface DocSnapshot extends ObjSnapshot {
  docId: string;
}

/**
 * A collection of document snapshots.  Most recent snapshots first.
 */
export interface DocSnapshots {
  snapshots: DocSnapshot[];
}

/**
 * A utility for pruning snapshots, so the number of snapshots doesn't get out of hand.
 */
export class DocSnapshotPruner {
  private _closing: boolean = false;                        // when set, should ignore prune requests
  private _prunes: KeyedOps;

  // Specify store to be pruned, and delay before pruning.
  constructor(private _ext: ExternalStorage, _options: {
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
  // done as a background operation.
  public requestPrune(key: string) {
    // If closing down, do not accept any prune requests.
    if (this._closing) { return; }
    // Mark the key as needing work.
    this._prunes.addOperation(key);
  }

  // Get all snapshots for a document, and whether they should be kept or pruned.
  public async classify(key: string): Promise<Array<{snapshot: ObjSnapshot, keep: boolean}>> {
    const versions = await this._ext.versions(key);
    return shouldKeepSnapshots(versions).map((keep, index) => ({keep, snapshot: versions[index]}));
  }

  // Prune the specified document immediately.
  public async prune(key: string) {
    const versions = await this.classify(key);
    const redundant = versions.filter(v => !v.keep);
    await this._ext.remove(key, redundant.map(r => r.snapshot.snapshotId));
    log.info(`Pruned ${redundant.length} versions of ${versions.length} for document ${key}`);
  }
}

/**
 * Calculate which snapshots to keep.  Expects most recent snapshots to be first.
 * We keep:
 *   - The five most recent versions (including the current version)
 *   - The most recent version in every hour, for up to 25 hours before the current version
 *   - The most recent version in every day, for up to 32 days before the current version
 *   - The most recent version in every week, for up to 12 weeks before the current version
 *   - The most recent version in every month, for up to 36 months before the current version
 *   - The most recent version in every year, for up to 1000 years before the current version
 * Calculations done in UTC, Gregorian calendar, ISO weeks (week starts with Monday).
 */
export function shouldKeepSnapshots(snapshots: ObjSnapshot[]): boolean[] {
  // Get current version
  const current = snapshots[0];
  if (!current) { return []; }

  // Get time of current version
  const start = moment.utc(current.lastModified);

  // Track saved version per hour, day, week, month, year, and number of times a version
  // has been saved based on a corresponding rule.
  const buckets: TimeBucket[] = [
    {range: 'hour', prev: start, usage: 0, cap: 25},
    {range: 'day', prev: start, usage: 0, cap: 32},
    {range: 'isoWeek', prev: start, usage: 0, cap: 12},
    {range: 'month', prev: start, usage: 0, cap: 36},
    {range: 'year', prev: start, usage: 0, cap: 1000}
  ];
  // For each snapshot starting with newest, check if it is worth saving by comparing
  // it with the last saved snapshot based on hour, day, week, month, year
  return snapshots.map((snapshot, index) => {
    let keep = index < 5;   // Keep 5 most recent versions
    const date = moment.utc(snapshot.lastModified);
    for (const bucket of buckets) {
      if (updateAndCheckRange(date, bucket)) { keep = true; }
    }
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
