import {ObjSnapshot} from 'app/server/lib/DocSnapshots';
import * as log from 'app/server/lib/log';
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
  exists(key: string): Promise<boolean>;

  // Upload content from file to the given key.  Returns a snapshotId if store supports that.
  upload(key: string, fname: string): Promise<string|null>;

  // Download content from key to given file.  Can download a specific version of the key
  // if store supports that (should throw a fatal exception if not).
  download(key: string, fname: string, snapshotId?: string): Promise<void>;

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

  public exists(key: string): Promise<boolean> {
    return this._ext.exists(this._map(key));
  }

  public upload(key: string, fname: string) {
    return this._ext.upload(this._map(key), fname);
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

  constructor(private _ext: ExternalStorage, private _options: {
    maxRetries: number,         // how many time to retry inconsistent downloads
    initialDelayMs: number,     // how long to wait before retrying
    localHash: PropStorage,     // key/value store for hashes of downloaded content
    sharedHash: PropStorage,    // key/value store for hashes of external content
    latestVersion: PropStorage, // key/value store for snapshotIds of uploads
    computeFileHash: (fname: string) => Promise<string>,  // compute hash for file
  }) {
  }

  public async exists(key: string): Promise<boolean> {
    return this._retry('exists', async () => {
      const hash = await this._options.sharedHash.load(key);
      const expected = hash !== null && hash !== DELETED_TOKEN;
      const reported = await this._ext.exists(key);
      // If we expect an object but store doesn't seem to have it, retry.
      if (expected && !reported)         { return undefined; }
      // If store says there is an object but that is not what we expected (if we
      // expected anything), retry.
      if (hash && !expected && reported) { return undefined; }
      // If expectations are matched, or we don't have expectations, return.
      return reported;
    });
  }

  public async upload(key: string, fname: string) {
    try {
      const checksum = await this._options.computeFileHash(fname);
      const prevChecksum = await this._options.localHash.load(key);
      if (prevChecksum && prevChecksum === checksum) {
        // nothing to do, checksums match
        log.info("ext upload: %s unchanged, not sending", key);
        return this._options.latestVersion.load(key);
      }
      const snapshotId = await this._ext.upload(key, fname);
      log.info("ext upload: %s checksum %s", this._ext.url(key), checksum);
      if (snapshotId) { await this._options.latestVersion.save(key, snapshotId); }
      await this._options.localHash.save(key, checksum);
      await this._options.sharedHash.save(key, checksum);
      return snapshotId;
    } catch (err) {
      log.error("ext upload: %s failure to send, error %s", key, err.message);
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
      log.info("ext remove: %s version %s", this._ext.url(key), snapshotIds || 'ALL');
      if (!snapshotIds) {
        await this._options.latestVersion.save(key, DELETED_TOKEN);
        await this._options.sharedHash.save(key, DELETED_TOKEN);
      }
    } catch (err) {
      log.error("ext delete: %s failure to remove, error %s", key, err.message);
      throw err;
    }
  }

  public download(key: string, fname: string, snapshotId?: string) {
    return this.downloadTo(key, key, fname, snapshotId);
  }

  /**
   * We may want to download material from one key and henceforth treat it as another
   * key (specifically for forking a document).  Since this class crossreferences the
   * key in the external store with other consistent stores, it needs to know we are
   * doing that.  So we add a downloadTo variant that takes before and after keys.
   */
  public async downloadTo(fromKey: string, toKey: string, fname: string, snapshotId?: string) {
    await this._retry('download', async () => {
      const {tmpDir, cleanupCallback} = await createTmpDir({});
      const tmpPath = path.join(tmpDir, `${toKey}.grist-tmp`);  // NOTE: assumes key is file-system safe.
      try {
        await this._ext.download(fromKey, tmpPath, snapshotId);

        const checksum = await this._options.computeFileHash(tmpPath);

        // Check for consistency if mutable data fetched.
        if (!snapshotId) {
          const expectedChecksum = await this._options.sharedHash.load(fromKey);
          // Let null docMD5s pass.  Otherwise we get stuck if redis is cleared.
          // Otherwise, make sure what we've got matches what we expect to get.
          // S3 is eventually consistent - if you overwrite an object in it, and then read from it,
          // you may get an old version for some time.
          // If a snapshotId was specified, we can skip this check.
          if (expectedChecksum && expectedChecksum !== checksum) {
            log.error("ext download: data for %s has wrong checksum: %s (expected %s)", fromKey,
                      checksum,
                      expectedChecksum);
            return undefined;
          }
        }

        // If successful, rename the temporary file to its proper name. The destination should NOT
        // exist in this case, and this should fail if it does.
        await fse.move(tmpPath, fname, {overwrite: false});
        await this._options.localHash.save(toKey, checksum);

        log.info("ext download: %s%s%s with checksum %s", fromKey,
                 snapshotId ? ` [VersionId ${snapshotId}]` : '',
                 fromKey !== toKey ? ` as ${toKey}` : '',
                 checksum);

        return true;
      } catch (err) {
        log.error("ext download: failed to fetch data (%s): %s", fromKey, err.message);
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
}

/**
 * Small interface for storing hashes and ids.
 */
export interface PropStorage {
  save(key: string, val: string): Promise<void>;
  load(key: string): Promise<string|null>;
}
