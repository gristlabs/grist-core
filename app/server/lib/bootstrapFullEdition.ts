/**
 * Lets a grist-oss installation convert itself into the full edition at runtime,
 * instead of requiring a manual switch to the `grist` or `grist-ee` image.
 *
 * We download a complete, self-contained build of the full edition (the exact `grist`
 * image app payload) into a writable directory (e.g. `/persist/ext/grist-full-edition`)
 * and run that instead of the built-in OSS build:
 *
 *   - `resolveFullEditionWorker()` is called by the RestartShell on every fork. If a
 *     valid, current copy is on disk it returns the fork spec for the relocated worker;
 *     otherwise the built-in OSS build runs.
 *
 *   - `maybeManageFullEdition()` runs on startup and makes the on-disk copy match the
 *     `useExtFullEdition` home-DB flag -- downloading it when enabled, removing it
 *     when disabled -- then requests a restart so `resolveFullEditionWorker()` returns
 *     the right worker.
 */

import { delay } from "app/common/delay";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { HashPassthroughStream } from "app/server/lib/checksumFile";
import { Edition } from "app/server/lib/configCore";
import { getGlobalConfig } from "app/server/lib/globalConfig";
import log from "app/server/lib/log";
import { getInstanceRoot } from "app/server/lib/places";
import { agents } from "app/server/lib/ProxyAgent";
import { ForkSpec } from "app/server/lib/RestartShell";

import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import { promisify } from "util";

import * as fse from "fs-extra";
import { AbortController } from "node-abort-controller";
import fetch from "node-fetch";
import * as tar from "tar";

const pipeline = promisify(stream.pipeline);

const fullEditionSettings = appSettings.section("fullEdition");

/**
 * URL of the full edition package to download. When set, exposes an option in the UI to
 * switch to the full edition of Grist.
 */
function getFullEditionUrl(): string | undefined {
  return fullEditionSettings.flag("url").readString({
    envVar: "GRIST_EXT_FULL_EDITION_URL",
  });
}

/**
 * Whether a full edition download URL is set. When set, exposes an option in the UI to switch
 * to the full edition of Grist.
 */
export function isExtFullEditionConfigured(): boolean {
  return Boolean(getFullEditionUrl());
}

/** Expected SHA-256 checksum of the full edition package, verified after download. */
function getFullEditionSha256(): string | undefined {
  return fullEditionSettings.flag("sha256").readString({
    envVar: "GRIST_EXT_FULL_EDITION_SHA256",
  });
}

export const Deps = {
  /** Use a generous download timeout; full edition tarball is 100+ MBs. */
  downloadTimeoutMs: 15 * 60 * 1000,
  installAttempts: 3,
  installRetryDelayMs: 10 * 1000,
};

/** Marker file written to {@link getFullEditionDir} holding the last-installed download URL. */
const STAMP_FILE = ".grist-full-edition-stamp";

/** Sub-directories of {@link getFullEditionDir} that hold the downloaded payload. */
const PAYLOAD_SUBDIRS = ["grist", "node_modules"];

/**
 * Location of the downloaded full edition package.
 */
function getFullEditionDir(): string {
  return path.join(getInstanceRoot(), "ext", "grist-full-edition");
}

/**
 * If a valid, current full edition package is present in {@link getFullEditionDir}, returns
 * the {@link ForkSpec} to run it.
 *
 * Used by the RestartShell to fork the full edition build instead of the built-in OSS build.
 */
export function resolveFullEditionWorker(): ForkSpec | null {
  try {
    const url = getFullEditionUrl();
    if (!url) { return null; }

    const dir = getFullEditionDir();
    let stamp: string;
    try {
      stamp = fse.readFileSync(path.join(dir, STAMP_FILE), "utf8").trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("bootstrapFullEdition: cannot read full-edition stamp, using built-in grist: %s", e);
      }
      return null;
    }
    if (stamp !== url) { return null; }

    const root = path.join(dir, "grist");
    return {
      entryPoint: path.join(root, "_build", "stubs", "app", "server", "server.js"),
      cwd: root,
      env: {
        NODE_PATH: [
          path.join(root, "_build"),
          path.join(root, "_build", "ext"),
          path.join(root, "_build", "stubs"),
        ].join(path.delimiter),
      },
      onSpawnFailure: () => invalidateFullEditionWorker(dir),
    };
  } catch (e) {
    log.warn("bootstrapFullEdition: resolveFullEditionWorker failed, using built-in grist: %s", e);
    return null;
  }
}

/**
 * Drops the stamp so {@link resolveFullEditionWorker} stops returning a copy whose worker
 * failed to start, letting the RestartShell fall back to the built-in build. A later boot
 * with `useExtFullEdition` still enabled will re-download and try again.
 */
function invalidateFullEditionWorker(dir: string): void {
  log.warn("bootstrapFullEdition: full edition worker failed to start; reverting to built-in grist");
  try {
    fse.removeSync(path.join(dir, STAMP_FILE));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("bootstrapFullEdition: cannot remove full-edition stamp: %s", e);
    }
  }
}

/**
 * Installs, upgrades, or removes the full edition of Grist based on the current state of
 * the install and the value of `useExtFullEdition` in the home DB:
 *
 *   - Install: When `useExtFullEdition` is true and no downloaded copy of full Grist exists,
 *     downloads and installs it, and then requests a restart.
 *   - Upgrade: When `useExtFullEdition` is true and the downloaded copy of full Grist doesn't
 *     match `GRIST_EXT_FULL_EDITION_URL`, downloads and replaces it, and then requests a
 *     restart.
 *   - Remove: When `useExtFullEdition` is false, reverts to the built-in edition -- dropping
 *     the stamp and requesting a restart if currently running full Grist, and reclaiming the
 *     downloaded copy from disk on a later boot.
 *
 * Returns whether a restart was requested, in which case the caller should ask the
 * RestartShell to refork, so that the correct build of Grist may run.
 *
 * If `GRIST_EXT_FULL_EDITION_URL` isn't set, calling this function is a no-op. Never
 * throws; on failure, logs and leaves the current edition running.
 *
 * TODO: Surface errors in the Admin Panel.
 */
export async function maybeManageFullEdition(): Promise<{ restartRequested: boolean }> {
  const url = getFullEditionUrl();
  if (!url) {
    return { restartRequested: false };
  }

  try {
    return await manageFullEdition(url);
  } catch (e) {
    log.error("bootstrapFullEdition: failed, remaining on current edition: %s", e);
    return { restartRequested: false };
  }
}

async function manageFullEdition(url: string): Promise<{ restartRequested: boolean }> {
  const dir = getFullEditionDir();
  const enabled = await isFullEditionEnabled();
  const current = await isStampCurrent(dir, url);

  if (enabled && !current) {
    const sha256 = getFullEditionSha256();
    if (!sha256) {
      log.error("bootstrapFullEdition: GRIST_EXT_FULL_EDITION_SHA256 not set for %s; " +
        "remaining on built-in edition", url);
      return { restartRequested: false };
    }
    for (let attempt = 1; attempt <= Deps.installAttempts; attempt++) {
      try {
        await downloadAndInstall(dir, url, sha256);
        await updateGlobalConfigEdition(true);
        return { restartRequested: true };
      } catch (e) {
        const willRetry = attempt < Deps.installAttempts;
        log.error("bootstrapFullEdition: install attempt %d/%d failed%s: %s",
          attempt, Deps.installAttempts,
          willRetry ? ", retrying" : "; attempt limit reached, remaining on built-in edition", e);
        if (willRetry) { await delay(Deps.installRetryDelayMs); }
      }
    }
    return { restartRequested: false };
  }

  await updateGlobalConfigEdition(enabled);

  if (!enabled && current) {
    await fse.remove(path.join(dir, STAMP_FILE)).catch(() => undefined);
    log.info("bootstrapFullEdition: full edition disabled; reverting to built-in edition on restart");
    return { restartRequested: true };
  }

  if (!enabled) { await reclaimFullEditionDir(dir); }

  return { restartRequested: false };
}

/**
 * Removes the downloaded full edition copy in `dir` (if present) to reclaim disk space.
 */
async function reclaimFullEditionDir(dir: string): Promise<void> {
  const remnants = [STAMP_FILE, ...PAYLOAD_SUBDIRS].map(name => path.join(dir, name));
  if (!(await anyPathExists(remnants))) { return; }

  log.info("bootstrapFullEdition: removing unused full edition copy to reclaim disk space");
  for (const p of remnants) {
    await fse.remove(p).catch(() => undefined);
  }
}

/**
 * Updates the value of `edition` in the global config file to "enterprise" if full
 * edition is enabled, or "core" if disabled.
 */
async function updateGlobalConfigEdition(fullEditionEnabled: boolean): Promise<void> {
  const desired: Edition = fullEditionEnabled ? "enterprise" : "core";
  const edition = getGlobalConfig().edition;
  if (edition.get() === desired) { return; }

  log.info("bootstrapFullEdition: setting edition in global config to %s", desired);
  await edition.set(desired);
}

/**
 * Returns whether the install has enabled the full edition of Grist.
 */
async function isFullEditionEnabled(): Promise<boolean> {
  const db = new HomeDBManager();
  await db.connect();
  const activation = await new ActivationsManager(db).current();
  return Boolean(activation.prefs?.useExtFullEdition);
}

/**
 * Returns whether `dir` contains a stamp file matching the specified `url`.
 */
async function isStampCurrent(dir: string, url: string): Promise<boolean> {
  try {
    const stamp = await fse.readFile(path.join(dir, STAMP_FILE), "utf8");
    return stamp.trim() === url;
  } catch {
    return false;
  }
}

/**
 * Returns true if any of the specified `paths` exists.
 */
async function anyPathExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    if (await fse.pathExists(p)) { return true; }
  }
  return false;
}

/**
 * Downloads the full edition package from `url` and installs it into `dir`.
 */
async function downloadAndInstall(dir: string, url: string, sha256: string): Promise<void> {
  await fse.mkdirp(dir);

  const stagingDir = `${dir}.staging`;
  const oldDir = `${dir}.old`;
  const tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), "grist-full-edition-dl-"));
  try {
    log.info("bootstrapFullEdition: downloading full edition from %s", url);
    const tarball = path.join(tmpDir, "grist-full-edition.tar.gz");
    await download(url, tarball, sha256);

    // Extract into a staging dir first...
    await fse.remove(stagingDir);
    await fse.mkdirp(stagingDir);
    await tar.x({ file: tarball, cwd: stagingDir });
    await fse.writeFile(path.join(stagingDir, STAMP_FILE), url);

    // Then swap into place.
    await fse.remove(oldDir);
    await fse.move(dir, oldDir, { overwrite: true });
    await fse.move(stagingDir, dir, { overwrite: true });
    await fse.remove(oldDir).catch(() => undefined);

    log.info("bootstrapFullEdition: installed full edition into %s", dir);
  } finally {
    await fse.remove(tmpDir).catch(() => undefined);
    await fse.remove(stagingDir).catch(() => undefined);
  }
}

/**
 * Downloads `url` to `dest`, then verifies its contents against the expected `sha256`.
 *
 * Throws on a failed request, empty body, or checksum mismatch.
 */
async function download(url: string, dest: string, sha256: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Deps.downloadTimeoutMs);
  const hasher = new HashPassthroughStream("sha256");
  try {
    const res = await fetch(url, { signal: controller.signal, agent: agents.trusted });
    if (!res.ok) { throw new Error(`download failed (${res.status}) for ${url}`); }
    if (!res.body) { throw new Error(`download failed (empty response body) for ${url}`); }

    await pipeline(res.body, hasher, fse.createWriteStream(dest));
  } finally {
    clearTimeout(timer);
  }

  const actual = hasher.getDigest();
  if (normalizeSha(actual) !== normalizeSha(sha256)) {
    throw new Error(`checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
}

/** Lowercases, trims, and strips any `sha256:`/`sha256-` prefix from `s`. */
function normalizeSha(s: string): string {
  return s.trim().toLowerCase().replace(/^sha256[:-]/, "");
}
