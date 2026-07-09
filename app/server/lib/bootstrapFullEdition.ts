/**
 * Lets an installation without built-in extensions (e.g. the `grist-oss` image) convert
 * itself into the full edition at runtime, instead of requiring a manual download and
 * recompilation with extensions, or switch to the `grist` or `grist-ee` image.
 *
 * We download the full edition's extensions -- the compiled extension code (`ext/`, including
 * its `node_modules` and `assets`) and the full edition static assets (`static/`, the webpack
 * bundles that include extension client code) -- into a writable directory (e.g.
 * `/persist/ext/grist-full-edition`). We then re-run the local build with the extensions
 * layered on via environment variables (`NODE_PATH`, `GRIST_EXT_DIR`, and `GRIST_STATIC_EXT_DIR`).
 *
 *   - `resolveFullEditionWorker()` is called by the RestartShell on every fork. If a valid,
 *     current extension bundle is on disk, it returns the fork spec that layers it onto the
 *     local build (via `NODE_PATH`, `GRIST_EXT_DIR`, and `GRIST_STATIC_EXT_DIR`); otherwise
 *     the built-in build runs.
 *
 *   - `maybeManageFullEdition()` runs on startup and makes the on-disk extensions match the
 *     `useExtFullEdition` home-DB flag -- downloading them when enabled, removing them when
 *     disabled -- then requests a restart so `resolveFullEditionWorker()` returns the right
 *     worker.
 */

import { delay } from "app/common/delay";
import { isAffirmative } from "app/common/gutil";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { HashPassthroughStream } from "app/server/lib/checksumFile";
import { Edition } from "app/server/lib/configCore";
import { getGlobalConfig } from "app/server/lib/globalConfig";
import log from "app/server/lib/log";
import { codeRoot, getAppRoot, getInstanceRoot } from "app/server/lib/places";
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

export const Deps = {
  downloadTimeoutMs: 3 * 60 * 1000,
  installAttempts: 3,
  installRetryDelayMs: 10 * 1000,
  hasBuiltInExt: defaultHasBuiltInExt,
};

/** Marker file written to {@link getFullEditionDir} holding the last-installed download URL. */
const STAMP_FILE = ".grist-full-edition-stamp";

/** Sub-directories of {@link getFullEditionDir} that hold the downloaded extensions. */
const PAYLOAD_SUBDIRS = ["ext", "static"];

/**
 * True if the running build already bundles extensions (the `grist`/`grist-ee` images or a
 * full edition build from source). Such builds run their own extensions and must never download
 * or manage a set at runtime -- the runtime download is only for extension-free builds.
 */
function defaultHasBuiltInExt(): boolean {
  return fse.existsSync(path.join(codeRoot, "ext", "app"));
}

/**
 * True when the current process is a worker forked with the full edition extensions layered on
 * (see {@link resolveFullEditionWorker}). Such a worker runs the extension-free local build plus
 * the downloaded extensions, so it should still manage them (e.g. to switch back).
 */
export function isRunningExtFullEdition(): boolean {
  return isAffirmative(process.env.GRIST_EXT_FULL_EDITION_ACTIVE);
}

/**
 * URL of the full edition extensions to download, or undefined when no URL is set, in which case
 * the switch is simply not offered. Read from `GRIST_EXT_FULL_EDITION_URL` (baked into the
 * image at build time).
 */
function getFullEditionUrl(): string | undefined {
  return fullEditionSettings.flag("url").readString({
    envVar: "GRIST_EXT_FULL_EDITION_URL",
  });
}

/** Expected SHA-256 checksum of the full edition extensions, verified after download. */
function getFullEditionSha256(): string | undefined {
  return fullEditionSettings.flag("sha256").readString({
    envVar: "GRIST_EXT_FULL_EDITION_SHA256",
  });
}

/**
 * Whether switching to a downloaded full edition should be offered.
 *
 * Returns true if already running a download-based full edition, or both a
 * download URL and its checksum are present in the running process.
 */
export function isExtFullEditionSupported(): boolean {
  if (isRunningExtFullEdition()) { return true; }
  if (Deps.hasBuiltInExt()) { return false; }

  return Boolean(getFullEditionUrl() && getFullEditionSha256());
}

/**
 * Location of the downloaded full edition extensions, a subdirectory of the instance root.
 */
function getFullEditionDir(): string {
  return path.join(getInstanceRoot(), "ext", "grist-full-edition");
}

/**
 * If a valid, current full edition extension bundle is present in {@link getFullEditionDir},
 * returns the {@link ForkSpec} that layers it onto the local build.
 *
 * Used by the RestartShell to run the local build with extensions instead of the plain
 * built-in build.
 */
export function resolveFullEditionWorker(): ForkSpec | null {
  try {
    // A build that already bundles extensions runs its own; never layer downloaded extensions
    // (which could be a stale copy left in the instance dir from a previous build or image).
    if (Deps.hasBuiltInExt()) { return null; }

    const url = getFullEditionUrl();
    if (!url) { return null; }

    const dir = getFullEditionDir();
    let stamp: string;
    try {
      stamp = fse.readFileSync(path.join(dir, STAMP_FILE), "utf8").trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn("bootstrapFullEdition: cannot read full edition stamp, using built-in grist: %s", e);
      }
      return null;
    }
    if (stamp !== url) { return null; }

    const extDir = path.join(dir, "ext");
    const staticDir = path.join(dir, "static");
    // `dir` resolves "ext/app/..." specifiers; `extDir` resolves the "app/..."
    // ones used between extension modules (mirroring _build and _build/ext).
    const nodePath = [
      codeRoot,
      dir,
      extDir,
      path.join(codeRoot, "stubs"),
      path.join(extDir, "node_modules"),
      path.join(getAppRoot(), "node_modules"),
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter);

    return {
      // The extensions run the same local entry point as the built-in build; distinguish them
      // by key so the RestartShell can tell "extensions failed - fall back to built-in" apart
      // from "built-in failed - give up".
      key: `full:${url}`,
      entryPoint: path.join(codeRoot, "stubs", "app", "server", "server.js"),
      env: {
        NODE_PATH: nodePath,
        GRIST_EXT_DIR: extDir,
        GRIST_STATIC_EXT_DIR: staticDir,
        GRIST_EXT_FULL_EDITION_ACTIVE: "1",
      },
    };
  } catch (e) {
    log.warn("bootstrapFullEdition: resolveFullEditionWorker failed, using built-in grist: %s", e);
    return null;
  }
}

/**
 * Installs, upgrades, or removes the full edition extensions based on the current state of the
 * install and the value of `useExtFullEdition` in the home DB:
 *
 *   - Install: When `useExtFullEdition` is true and no current extensions exist, downloads and
 *     installs them, and then requests a restart.
 *   - Upgrade: When `useExtFullEdition` is true and the downloaded extensions don't match the
 *     current URL, downloads and replaces them, and then requests a restart.
 *   - Remove: When `useExtFullEdition` is false, reverts to the built-in build -- dropping
 *     the stamp and requesting a restart if currently running the extensions, and reclaiming
 *     the downloaded extensions from disk on a later boot.
 *
 * Returns whether a restart was requested, in which case the caller should ask the
 * RestartShell to refork, so that the correct build of Grist may run.
 *
 * If no download URL is set, calling this function is a no-op. Never throws; on failure, logs
 * and leaves the current edition running.
 *
 * TODO: Surface errors in the Admin Panel.
 */
export async function maybeManageFullEdition(): Promise<{ restartRequested: boolean }> {
  // A build that already bundles extensions manages its own edition; do not touch the downloaded
  // extensions (which may be a stale copy left in the instance dir).
  if (Deps.hasBuiltInExt() && !isRunningExtFullEdition()) {
    return { restartRequested: false };
  }

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

    if (!(await ensureWritable(dir))) {
      log.error("bootstrapFullEdition: full edition storage directory is not writable (%s); " +
        "remaining on built-in edition. Make sure the instance directory is writable.", dir);
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
 * Returns whether `dir` is writable by trying to write a (temporary) file to it.
 *
 * This is more robust than using `fs.access()`, which is prone to false positives.
 */
async function ensureWritable(dir: string): Promise<boolean> {
  const probe = path.join(dir, ".grist-write-probe");
  try {
    await fse.mkdirp(dir);
    await fse.writeFile(probe, "");
    return true;
  } catch {
    return false;
  } finally {
    await fse.remove(probe).catch(() => undefined);
  }
}

/**
 * Removes the downloaded full edition extensions in `dir` (if present) to reclaim disk space.
 */
async function reclaimFullEditionDir(dir: string): Promise<void> {
  const remnants = [STAMP_FILE, ...PAYLOAD_SUBDIRS].map(name => path.join(dir, name));
  if (!(await anyPathExists(remnants))) { return; }

  log.info("bootstrapFullEdition: removing unused full edition extensions to reclaim disk space");
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
 * Downloads the full edition extensions from `url` and installs them into `dir`.
 */
async function downloadAndInstall(dir: string, url: string, sha256: string): Promise<void> {
  await fse.mkdirp(dir);

  const stagingDir = `${dir}.staging`;
  const oldDir = `${dir}.old`;
  const tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), "grist-full-edition-dl-"));
  try {
    log.info("bootstrapFullEdition: downloading full edition extensions from %s", url);
    const tarball = path.join(tmpDir, "ext.tar.gz");
    await download(url, tarball, sha256);

    // Extract into a staging dir first...
    await fse.remove(stagingDir);
    await fse.mkdirp(stagingDir);
    await tar.x({ file: tarball, cwd: stagingDir });
    await fse.writeFile(path.join(stagingDir, STAMP_FILE), url);

    // Then swap into place, discarding any previous extensions.
    await fse.remove(oldDir);
    await fse.move(dir, oldDir, { overwrite: true });
    await fse.move(stagingDir, dir, { overwrite: true });
    await fse.remove(oldDir).catch(() => undefined);

    log.info("bootstrapFullEdition: installed full edition extensions into %s", dir);
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
