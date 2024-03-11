import {ObjMetadata, ObjSnapshot, ObjSnapshotWithMetadata} from 'app/common/DocSnapshot';
import {isAffirmative} from 'app/common/gutil';
import log from 'app/server/lib/log';
import {createTmpDir} from 'app/server/lib/uploads';

import {delay} from 'bluebird';
import * as fse from 'fs-extra';
import * as path from 'path';

// A special token representing a deleted document, used in places where a
// checksum is expected otherwise.
export const DELETED_TOKEN = '*DELETED*';

/**
 * An external store for the content of files.  The store may be either consistent
 * or eventually consistent.  Specifically, the `exists`, `download`, and `versions`
 * methods may return somewhat stale data from time to time.
 *
 * The store should be versioned; that is, uploads to a `key` should be assigned
 * a `snapshotId`, and be accessible later with that `key`/`snapshotId` pair.
 * When data is accessed by `snapshotId`, results should be immediately consistent.
 */
export interface ExternalStorage {
  // Check if content exists in the store for a given key.
  exists(key: string, snapshotId?: string): Promise<boolean>;

  // Get side information for content, if content exists in the store.
  head(key: string, snapshotId?: string): Promise<ObjSnapshotWithMetadata|null>;

  // Upload content from file to the given key.  Returns a snapshotId if store supports that.
  upload(key: string, fname: string, metadata?: ObjMetadata): Promise<string|null|typeof Unchanged>;

  // Download content from key to given file.  Can download a specific version of the key
  // if store supports that (should throw a fatal exception if not).
  // Returns snapshotId of version downloaded.
  download(key: string, fname: string, snapshotId?: string): Promise<string>;

  // Remove content for this key from the store, if it exists.  Can delete specific versions
  // if specified.  If no version specified, all versions are removed.  If versions specified,
  // newest should be given first.
  remove(key: string, snapshotIds?: string[]): Promise<void>;

  // List content versions that exist for the given key.  More recent versions should
  // come earlier in the result list.
  versions(key: string): Promise<ObjSnapshot[]>;

  // Render the given key as something url-like, for log messages (e.g. "s3://bucket/path")
  url(key: string): string;

  // Check if an exception thrown by a store method should be treated as fatal.
  // Non-fatal exceptions are those that may result from eventual consistency, and
  // where a retry could help -- specifically "not found" exceptions.
  isFatalError(err: any): boolean;

  // Close the storage object.
  close(): Promise<void>;
}

/**
 * Convenience wrapper to transform keys for an external store.
 * E.g. this could convert "<docId>" to "v1/<docId>.grist"
 */
export class KeyMappedExternalStorage implements ExternalStorage {
  constructor(private _ext: ExternalStorage,
              private _map: (key: string) => string) {
  }

  public exists(key: string, snapshotId?: string): Promise<boolean> {
    return this._ext.exists(this._map(key), snapshotId);
  }

  public head(key: string, snapshotId?: string) {
    return this._ext.head(this._map(key), snapshotId);
  }

  public upload(key: string, fname: string, metadata?: ObjMetadata) {
    return this._ext.upload(this._map(key), fname, metadata);
  }

  public download(key: string, fname: string, snapshotId?: string) {
    return this._ext.download(this._map(key), fname, snapshotId);
  }

  public remove(key: string, snapshotIds?: string[]): Promise<void> {
    return this._ext.remove(this._map(key), snapshotIds);
  }

  public versions(key: string) {
    return this._ext.versions(this._map(key));
  }

  public url(key: string) {
    return this._ext.url(this._map(key));
  }

  public isFatalError(err: any) {
    return this._ext.isFatalError(err);
  }

  public async close() {
    // nothing to do
  }
}

/**
 * A wrapper for an external store that uses checksums and retries
 * to compensate for eventual consistency.  With this wrapper, the
 * store either returns consistent results or fails with an error.
 *
 * This wrapper works by tracking what is in the external store,
 * using content hashes and ids placed in consistent stores.  These
 * consistent stores are:
 *
 *   - sharedHash: a key/value store containing expected checksums
 *     of content in the external store.  In our setup, this is
 *     implemented using Redis.  Populated on upload and checked on
 *     download.
 *   - localHash: a key/value store containing checksums of uploaded
 *     content.  In our setup, this is implemented on the worker's
 *     disk.  This is used to skip unnecessary uploads.  Populated
 *     on download and checked on upload.
 *   - latestVersion: a key/value store containing snapshotIds of
 *     uploads.  In our setup, this is implemented in the worker's
 *     memory.  Only affects the consistency of the `versions` method.
 *     Populated on upload and checked on `versions` calls.
 *     TODO: move to Redis if consistency of `versions` during worker
 *     transitions becomes important.
 *
 * It is not important for all this side information to persist very
 * long, just long enough to give the store time to become
 * consistent.
 *
 * Keys presented to this class should be file-system safe.
 */
export class ChecksummedExternalStorage implements ExternalStorage {
  private _closed: boolean = false;

  constructor(public readonly label: string, private _ext: ExternalStorage, private _options: {
    maxRetries: number,         // how many time to retry inconsistent downloads
    initialDelayMs: number,     // how long to wait before retrying
    localHash: PropStorage,     // key/value store for hashes of downloaded content
    sharedHash: PropStorage,    // key/value store for hashes of external content
    latestVersion: PropStorage, // key/value store for snapshotIds of uploads
    computeFileHash: (fname: string) => Promise<string>,  // compute hash for file
  }) {
  }

  public async exists(key: string, snapshotId?: string): Promise<boolean> {
    return this._retryWithExistenceCheck('exists', key, snapshotId,
                                         this._ext.exists.bind(this._ext));
  }

  public async head(key: string, snapshotId?: string) {
    return this._retryWithExistenceCheck('head', key, snapshotId,
                                         this._ext.head.bind(this._ext));
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    try {
      const checksum = await this._options.computeFileHash(fname);
      const prevChecksum = await this._options.localHash.load(key);
      if (prevChecksum && prevChecksum === checksum && !metadata?.label) {
        // nothing to do, checksums match
        const snapshotId = await this._options.latestVersion.load(key);
        log.info("ext %s upload: %s unchanged, not sending (checksum %s, version %s)", this.label, key,
                 checksum, snapshotId);
        return Unchanged;
      }
      const snapshotId = await this._ext.upload(key, fname, metadata);
      log.info("ext %s upload: %s checksum %s version %s", this.label, this._ext.url(key), checksum, snapshotId);
      if (typeof snapshotId === "string") { await this._options.latestVersion.save(key, snapshotId); }
      await this._options.localHash.save(key, checksum);
      await this._options.sharedHash.save(key, checksum);
      return snapshotId;
    } catch (err) {
      log.error("ext %s upload: %s failure to send, error %s", this.label, key, err.message);
      throw err;
    }
  }

  public async remove(key: string, snapshotIds?: string[]) {
    try {
      // Removing most recent version by id is not something we should be doing, and
      // if we want to do it it would need to be done carefully - so just forbid it.
      if (snapshotIds && snapshotIds.includes(await this._options.latestVersion.load(key) || '')) {
        throw new Error('cannot remove most recent version of a document by id');
      }
      await this._ext.remove(key, snapshotIds);
      log.info("ext %s remove: %s version %s", this.label, this._ext.url(key), snapshotIds || 'ALL');
      if (!snapshotIds) {
        await this._options.latestVersion.save(key, DELETED_TOKEN);
        await this._options.sharedHash.save(key, DELETED_TOKEN);
      } else {
        for (const snapshotId of snapshotIds) {
          // Removing snapshots breaks their partial immutability, so we mark them
          // as deleted in redis so that we don't get stale info from S3 if we check
          // for their existence.  Nothing currently depends on this in practice.
          await this._options.sharedHash.save(this._keyWithSnapshot(key, snapshotId), DELETED_TOKEN);
        }
      }
    } catch (err) {
      log.error("ext %s delete: %s failure to remove, error %s", this.label, key, err.message);
      throw err;
    }
  }

  public download(key: string, fname: string, snapshotId?: string) {
    return this.downloadTo(key, key, fname, snapshotId);
  }

  /**
   * We may want to download material from one key and henceforth treat it as another
   * key (specifically for forking a document).  Since this class cross-references the
   * key in the external store with other consistent stores, it needs to know we are
   * doing that.  So we add a downloadTo variant that takes before and after keys.
   */
  public async downloadTo(fromKey: string, toKey: string, fname: string, snapshotId?: string) {
    return this._retry('download', async () => {
      const {tmpDir, cleanupCallback} = await createTmpDir({});
      const tmpPath = path.join(tmpDir, `${toKey}-tmp`);  // NOTE: assumes key is file-system safe.
      try {
        const downloadedSnapshotId = await this._ext.download(fromKey, tmpPath, snapshotId);

        const checksum = await this._options.computeFileHash(tmpPath);

        // Check for consistency if mutable data fetched.
        if (!snapshotId) {
          const expectedChecksum = await this._options.sharedHash.load(fromKey);
          // Let null docMD5s pass.  Otherwise we get stuck if redis is cleared.
          // Otherwise, make sure what we've got matches what we expect to get.
          // AWS S3 was eventually consistent, but now has stronger guarantees:
          // https://aws.amazon.com/blogs/aws/amazon-s3-update-strong-read-after-write-consistency/
          //
          // Previous to this change, if you overwrote an object in it,
          // and then read from it, you may have got an old version for some time.
          // We are confident this should not be the case anymore, though this has to be studied carefully.
          // If a snapshotId was specified, we can skip this check.
          if (expectedChecksum && expectedChecksum !== checksum) {
            const message = `ext ${this.label} download: data for ${fromKey} has wrong checksum:` +
              ` ${checksum} (expected ${expectedChecksum})`;

            // If GRIST_SKIP_REDIS_CHECKSUM_MISMATCH is set, issue a warning only and continue,
            // rather than issuing an error and failing.
            // This flag is experimental and should be removed once we are
            // confident that the checksums verification is useless.
            if (isAffirmative(process.env.GRIST_SKIP_REDIS_CHECKSUM_MISMATCH)) {
              log.warn(message);
            } else {
              log.error(message);
              return undefined;
            }
          }
        }

        // If successful, rename the temporary file to its proper name. The destination should NOT
        // exist in this case, and this should fail if it does.
        await fse.move(tmpPath, fname, {overwrite: false});
        if (fromKey === toKey) {
          // Save last S3 snapshot id observed for this key.
          await this._options.latestVersion.save(toKey, downloadedSnapshotId);
          // Save last S3 hash observed for this key (so if we have a version with that hash
          // locally we can skip pushing it back needlessly later).
          await this._options.localHash.save(toKey, checksum);
        }

        log.info("ext %s download: %s%s%s with checksum %s and version %s", this.label, fromKey,
                 snapshotId ? ` [VersionId ${snapshotId}]` : '',
                 fromKey !== toKey ? ` as ${toKey}` : '',
                 checksum, downloadedSnapshotId);

        return downloadedSnapshotId;
      } catch (err) {
        log.error("ext %s download: failed to fetch data (%s): %s", this.label, fromKey, err.message);
        throw err;
      } finally {
        await cleanupCallback();
      }
    });
  }

  public async versions(key: string) {
    return this._retry('versions', async () => {
      const snapshotId = await this._options.latestVersion.load(key);
      if (snapshotId === DELETED_TOKEN) { return []; }
      const result = await this._ext.versions(key);
      if (snapshotId && (result.length === 0 || result[0].snapshotId !== snapshotId)) {
        // Result is not consistent yet.
        return undefined;
      }
      return result;
    });
  }

  public url(key: string): string {
    return this._ext.url(key);
  }

  public isFatalError(err: any): boolean {
    return this._ext.isFatalError(err);
  }

  public async close() {
    this._closed = true;
  }

  /**
   * Call an operation until it returns a value other than undefined.
   *
   * While the operation returns undefined, it will be retried for some period.
   * This period is chosen to be long enough for S3 to become consistent.
   *
   * If the operation throws an error, and that error is not fatal (as determined
   * by `isFatalError`, then it will also be retried.  Fatal errors are thrown
   * immediately.
   *
   * Once the operation returns a result, we pass that along.  If it fails to
   * return a result after all the allowed retries, a special exception is thrown.
   */
  private async _retry<T>(name: string, operation: () => Promise<T|undefined>): Promise<T> {
    let backoffCount = 1;
    let backoffFactor = this._options.initialDelayMs;
    const problems = new Array<[number, string|Error]>();
    const start = Date.now();
    while (backoffCount <= this._options.maxRetries) {
      try {
        const result = await operation();
        if (result !== undefined) { return result; }
        problems.push([Date.now() - start, 'not ready']);
      } catch (err) {
        if (this._ext.isFatalError(err)) {
          throw err;
        }
        problems.push([Date.now() - start, err]);
      }
      // Wait some time before attempting to reload from s3.  The longer we wait, the greater
      // the odds of success.  In practice, a second should be more than enough almost always.
      await delay(Math.round(backoffFactor));
      if (this._closed) { throw new Error('storage closed'); }
      backoffCount++;
      backoffFactor *= 1.7;
    }
    log.error(`operation failed to become consistent: ${name} - ${problems}`);
    throw new Error(`operation failed to become consistent: ${name} - ${problems}`);
  }

  /**
   * Retry an operation which will fail if content does not exist, until it is consistent
   * with our expectation of the content's existence.
   */
  private async _retryWithExistenceCheck<T>(label: string, key: string, snapshotId: string|undefined,
                                            op: (key: string, snapshotId?: string) => Promise<T>): Promise<T> {
    return this._retry(label, async () => {
      const hash = await this._options.sharedHash.load(this._keyWithSnapshot(key, snapshotId));
      const expected = hash !== null && hash !== DELETED_TOKEN;
      const reported = await op(key, snapshotId);
      // If we expect an object but store doesn't seem to have it, retry.
      if (expected && !reported)         { return undefined; }
      // If store says there is an object but that is not what we expected (if we
      // expected anything), retry.
      if (hash && !expected && reported) { return undefined; }
      // If expectations are matched, or we don't have expectations, return.
      return reported;
    });
  }

  /**
   * Generate a key to use with Redis for a document.  Add in snapshot information
   * if that is present (snapshots are immutable, except that they can be deleted,
   * so we only set checksums for them in Redis when they are deleted).
   */
  private _keyWithSnapshot(key: string, snapshotId?: string|null) {
    return snapshotId ? `${key}--${snapshotId}` : key;
  }
}

/**
 * Small interface for storing hashes and ids.
 */
export interface PropStorage {
  save(key: string, val: string): Promise<void>;
  load(key: string): Promise<string|null>;
}

export const Unchanged = Symbol('Unchanged');

export interface ExternalStorageSettings {
  purpose: 'doc' | 'meta';
  basePrefix?: string;
  extraPrefix?: string;
}

/**
 * The storage mapping we use for our SaaS. A reasonable default, but relies
 * on appropriate lifecycle rules being set up in the bucket.
 */
export function getExternalStorageKeyMap(settings: ExternalStorageSettings): (docId: string) => string {
  const {basePrefix, extraPrefix, purpose} = settings;
  let fullPrefix = basePrefix + (basePrefix?.endsWith('/') ? '' : '/');
  if (extraPrefix) {
    fullPrefix += extraPrefix + (extraPrefix.endsWith('/') ? '' : '/');
  }

  // Set up how we name files/objects externally.
  let fileNaming: (docId: string) => string;
  if (purpose === 'doc') {
    fileNaming = docId => `${docId}.grist`;
  } else if (purpose === 'meta') {
    // Put this in separate prefix so a lifecycle rule can prune old versions of the file.
    // Alternatively, could go in separate bucket.
    fileNaming = docId => `assets/unversioned/${docId}/meta.json`;
  } else {
    throw new Error('create.ExternalStorage: unrecognized purpose');
  }
  return docId => (fullPrefix + fileNaming(docId));
}

export function wrapWithKeyMappedStorage(rawStorage: ExternalStorage, settings: ExternalStorageSettings) {
  return new KeyMappedExternalStorage(rawStorage, getExternalStorageKeyMap(settings));
}
