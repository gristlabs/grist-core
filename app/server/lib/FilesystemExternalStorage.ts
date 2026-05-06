import { ObjMetadata, ObjSnapshot, ObjSnapshotWithMetadata } from "app/common/DocSnapshot";
import { KeyedMutex } from "app/common/KeyedMutex";
import { ExternalStorage } from "app/server/lib/ExternalStorage";
import { makeId } from "app/server/lib/idUtils";
import { isPathWithin } from "app/server/lib/serverUtils";

import * as path from "node:path";

import * as fse from "fs-extra";

interface VersionEntry {
  snapshotId: string;
  lastModified: string;
  metadata?: ObjMetadata;
}

interface VersionsFile {
  versions: VersionEntry[];  // newest first
}

/**
 * A filesystem-backed ExternalStorage, intended ONLY for tests.  Stores each key as a
 * directory under a base directory, containing one file per version plus a
 * `versions.json` index.
 *
 * Concurrency within one process:
 *  - A per-key in-process mutex serializes writes to the same key's versions.json.
 *  - versions.json is written via a staged file + rename, so a concurrent reader
 *    never sees a truncated file.
 *  - removeAllWithPrefix(prefix) locks only on the prefix string, NOT on keys
 *    nested under that prefix, so a concurrent upload to a key under the prefix
 *    can race with the wipe.  Tests should not be writing to the backend when
 *    they call this.
 *
 * Cross-process concurrency is not safe.  Activated via GRIST_FS_STORAGE_DIR.
 *
 * Metadata is stored as-is in versions.json and returned as-is -- unlike S3 /
 * MinIO / Azure, which convert metadata values to strings on write and convert
 * them back via toGristMetadata on read.  Tests that depend on that round-trip
 * (e.g. numeric fields coming back as strings) will not reproduce here.
 */
export class FilesystemExternalStorage implements ExternalStorage {
  private _mutex = new KeyedMutex();

  constructor(private _baseDir: string) {}

  public async exists(key: string, snapshotId?: string): Promise<boolean> {
    return Boolean(await this.head(key, snapshotId));
  }

  public async head(key: string, snapshotId?: string): Promise<ObjSnapshotWithMetadata | null> {
    const entry = await this._findVersion(key, snapshotId);
    if (!entry) { return null; }
    return {
      lastModified: entry.lastModified,
      snapshotId: entry.snapshotId,
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata): Promise<string> {
    return this._mutex.runExclusive(key, async () => {
      const dir = this._keyDir(key);
      const snapshotId = makeId();
      await fse.ensureDir(dir);
      await fse.copy(fname, path.join(dir, snapshotId), { overwrite: true });
      const versions = await this._readVersions(key);
      versions.unshift({
        snapshotId,
        lastModified: new Date().toISOString(),
        ...(metadata ? { metadata } : {}),
      });
      await this._writeVersions(key, versions);
      return snapshotId;
    });
  }

  public async download(key: string, fname: string, snapshotId?: string): Promise<string> {
    const entry = await this._findVersion(key, snapshotId);
    if (!entry) { throw new Error(`FilesystemExternalStorage: not found ${key}`); }
    await fse.copy(path.join(this._keyDir(key), entry.snapshotId), fname, { overwrite: true });
    return entry.snapshotId;
  }

  // Removes only the blobs tracked in versions.json (or the subset identified by
  // snapshotIds), then the versions.json + now-empty directory if nothing is left.
  // Deliberately does NOT `rm -rf` the key's directory: if called by mistake with
  // a prefix string (e.g. "docs/") that has no versions.json, the read returns []
  // and this is a no-op, rather than wiping an entire subtree.  Use
  // removeAllWithPrefix when you explicitly want subtree deletion.
  public async remove(key: string, snapshotIds?: string[]): Promise<void> {
    return this._mutex.runExclusive(key, async () => {
      const versions = await this._readVersions(key);
      if (versions.length === 0) { return; }
      const toRemove = new Set(snapshotIds ?? versions.map(v => v.snapshotId));
      const dir = this._keyDir(key);
      const kept: VersionEntry[] = [];
      for (const v of versions) {
        if (toRemove.has(v.snapshotId)) {
          await fse.remove(path.join(dir, v.snapshotId));
        } else {
          kept.push(v);
        }
      }
      if (kept.length === 0) {
        await fse.remove(dir);
      } else {
        await this._writeVersions(key, kept);
      }
    });
  }

  // Wipes the entire subtree at the given prefix.  Note: the per-key mutex
  // doesn't extend to keys *under* the prefix, so a concurrent upload to a
  // key within the prefix can race with this wipe.  Callers (tests) should
  // not be writing to the backend when they call this.
  public async removeAllWithPrefix(prefix: string): Promise<void> {
    if (!prefix || prefix === "/") {
      throw new Error(`FilesystemExternalStorage: refusing to remove empty/root prefix`);
    }
    const target = this._keyDir(prefix);
    return this._mutex.runExclusive(prefix, async () => {
      await fse.remove(target);
    });
  }

  public async versions(key: string): Promise<ObjSnapshot[]> {
    const versions = await this._readVersions(key);
    return versions.map(v => ({ lastModified: v.lastModified, snapshotId: v.snapshotId }));
  }

  public url(key: string): string {
    return `file://${this._keyDir(key)}`;
  }

  // Everything is fatal on a local FS: the file is either there or not (no
  // delay window to wait through), and there is no network that might fail
  // temporarily, so retrying never changes the answer.  Returning true here
  // means errors surface immediately with their real message, instead of being
  // hidden behind a delayed "operation failed to become consistent" from the
  // retry loop in ChecksummedExternalStorage.
  public isFatalError(_err: any): boolean { return true; }

  public async close(): Promise<void> {}

  private _keyDir(key: string): string {
    const target = path.join(this._baseDir, key);
    // isPathWithin returns true for target === base, so reject that separately.
    if (path.resolve(target) === path.resolve(this._baseDir) ||
      !isPathWithin(this._baseDir, target)) {
      throw new Error(`FilesystemExternalStorage: key "${key}" escapes base dir`);
    }
    return target;
  }

  private _versionsFile(key: string): string {
    return path.join(this._keyDir(key), "versions.json");
  }

  private async _findVersion(key: string, snapshotId?: string): Promise<VersionEntry | undefined> {
    const versions = await this._readVersions(key);
    return snapshotId ? versions.find(v => v.snapshotId === snapshotId) : versions[0];
  }

  private async _readVersions(key: string): Promise<VersionEntry[]> {
    let data: VersionsFile;
    try {
      data = await fse.readJson(this._versionsFile(key));
    } catch (err) {
      // A missing versions.json means no versions uploaded for this key yet.
      // Let any other error propagate -- permissions, corrupt JSON, etc.
      if (err?.code === "ENOENT") { return []; }
      throw err;
    }
    return data.versions || [];
  }

  private async _writeVersions(key: string, versions: VersionEntry[]): Promise<void> {
    // Atomic write: write to a temporary file in the same directory, then
    // rename it into place.  A plain writeJson would truncate and rewrite
    // versions.json in place, so a reader arriving mid-write could see an
    // empty or partial file.  The rename swaps in the complete file in one step.
    const dir = this._keyDir(key);
    await fse.ensureDir(dir);
    const target = this._versionsFile(key);
    const tmpPath = `${target}.${makeId()}.tmp`;
    await fse.writeJson(tmpPath, { versions });
    await fse.rename(tmpPath, target);
  }
}
