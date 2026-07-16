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
 * The download is derived from the version of Grist: an unmodified release build (or official
 * release image; see `channel` in `version.ts`) fetches its extensions from a per-version
 * manifest at `<baseUrl>/by-version/<version>.json`. The switch is offered only on release
 * builds.
 *
 *   - `resolveFullEditionWorker()` is called by the RestartShell on every fork. If a valid,
 *     current extension bundle is on disk, it returns the fork spec that layers it onto the
 *     local build (via `NODE_PATH`, `GRIST_EXT_DIR`, and `GRIST_STATIC_EXT_DIR`); otherwise
 *     the built-in build runs.
 *
 *   - `maybeManageFullEdition()` runs on startup and makes the on-disk extensions match the
 *     `GRIST_EDITION` setting -- downloading them when it is "full", removing them when it is
 *     "community" -- then requests a restart so `resolveFullEditionWorker()` returns the right
 *     worker.
 */

import { delay } from "app/common/delay";
import { channel, version } from "app/common/version";
import { appSettings } from "app/server/lib/AppSettings";
import { HashPassthroughStream } from "app/server/lib/checksumFile";
import { Edition } from "app/server/lib/configCore";
import { getGlobalConfig } from "app/server/lib/globalConfig";
import { getEdition } from "app/server/lib/gristSettings";
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
  isReleaseBuild: defaultIsReleaseBuild,
};

/** Default base URL to download extensions from. */
const DEFAULT_BASE_URL = "https://grist-static.com/grist-full-edition";

/**
 * Marker file written to {@link getFullEditionDir} holding the identity (see
 * {@link getFullEditionIdentity}) of the extensions installed there.
 */
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
 * True on an unmodified build of a tagged Grist release (or an official release image), the only
 * builds offered the full edition switch. Set from the build-time `channel` in `version.ts`; see
 * `build_version_file` in `buildtools/build.sh`.
 */
function defaultIsReleaseBuild(): boolean {
  return (channel as string) === "release";
}

/**
 * Base URL for the per-version manifests from which the download is derived. Read from
 * `GRIST_EXT_FULL_EDITION_BASE_URL`: unset falls back to {@link DEFAULT_BASE_URL} (point it at a
 * self-hosted mirror serving the same layout); an explicitly empty value disables the switch (an
 * air-gapped opt-out). Returns undefined when disabled.
 */
function getBaseUrl(): string | undefined {
  const base = fullEditionSettings.flag("baseUrl").readString({
    envVar: "GRIST_EXT_FULL_EDITION_BASE_URL",
  });
  if (base === undefined) { return DEFAULT_BASE_URL; }
  return base || undefined;
}

/**
 * Stable identity of the desired full edition extensions for this build, or undefined when the
 * switch isn't offered (i.e. not a release build with derivation enabled). Recorded in the stamp
 * and compared (without any network access) to decide whether the on-disk extensions are current.
 */
function getFullEditionIdentity(): string | undefined {
  if (!Deps.isReleaseBuild() || !getBaseUrl() || !version) { return undefined; }
  return `version:${version}`;
}

/**
 * Whether switching to a downloaded full edition should be offered.
 *
 * Returns true if the download can be derived for this build (a release build without built-in
 * extensions, with derivation enabled).
 */
export function isExtFullEditionSupported(): boolean {
  if (Deps.hasBuiltInExt()) { return false; }

  return getFullEditionIdentity() !== undefined;
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

    const identity = getFullEditionIdentity();
    if (!identity) { return null; }

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
    if (stamp !== identity) { return null; }

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
      key: `full:${identity}`,
      entryPoint: path.join(codeRoot, "stubs", "app", "server", "server.js"),
      env: {
        NODE_PATH: nodePath,
        GRIST_EXT_DIR: extDir,
        GRIST_STATIC_EXT_DIR: staticDir,
      },
    };
  } catch (e) {
    log.warn("bootstrapFullEdition: resolveFullEditionWorker failed, using built-in grist: %s", e);
    return null;
  }
}

/**
 * Installs, upgrades, or removes the full edition extensions based on the current state of the
 * install and the value of the `GRIST_EDITION` setting:
 *
 *   - Install: When `GRIST_EDITION` is "full" and no current extensions exist, downloads and
 *     installs them, and then requests a restart.
 *   - Upgrade: When `GRIST_EDITION` is "full" and the downloaded extensions don't match the
 *     current version, downloads and replaces them, and then requests a restart.
 *   - Remove: When `GRIST_EDITION` is "community" (or unset), reverts to the built-in build --
 *     dropping the stamp and requesting a restart if currently running the extensions, and
 *     reclaiming the downloaded extensions from disk on a later boot.
 *
 * Returns whether a restart was requested, in which case the caller should ask the
 * RestartShell to refork, so that the correct build of Grist may run.
 *
 * If the switch isn't offered for this build, calling this function is a no-op. Never throws; on
 * failure, logs and leaves the current edition running.
 *
 * TODO: Surface errors in the Admin Panel.
 */
export async function maybeManageFullEdition(): Promise<{ restartRequested: boolean }> {
  // A build that already bundles extensions manages its own edition; do not touch the downloaded
  // extensions (which may be a stale copy left in the instance dir).
  if (Deps.hasBuiltInExt()) {
    return { restartRequested: false };
  }

  const identity = getFullEditionIdentity();
  if (!identity) {
    return { restartRequested: false };
  }

  try {
    return await manageFullEdition(identity);
  } catch (e) {
    log.error("bootstrapFullEdition: failed, remaining on current edition: %s", e);
    return { restartRequested: false };
  }
}

async function manageFullEdition(identity: string): Promise<{ restartRequested: boolean }> {
  const dir = getFullEditionDir();
  const enabled = isFullEditionEnabled();
  const current = await isStampCurrent(dir, identity);

  if (enabled && !current) {
    if (!(await ensureWritable(dir))) {
      log.error("bootstrapFullEdition: full edition storage directory is not writable (%s); " +
        "remaining on built-in edition. Make sure the instance directory is writable.", dir);
      return { restartRequested: false };
    }

    for (let attempt = 1; attempt <= Deps.installAttempts; attempt++) {
      try {
        const { url, sha256 } = await resolveExtensionsDownload();
        await downloadAndInstall(dir, identity, url, sha256);
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
function isFullEditionEnabled(): boolean {
  return getEdition() === "full";
}

/**
 * Returns whether `dir` contains a stamp file matching the specified `identity`.
 */
async function isStampCurrent(dir: string, identity: string): Promise<boolean> {
  try {
    const stamp = await fse.readFile(path.join(dir, STAMP_FILE), "utf8");
    return stamp.trim() === identity;
  } catch {
    return false;
  }
}

/**
 * Resolves the concrete download URL and expected checksum of the full edition extensions by
 * fetching the per-version manifest at `<baseUrl>/by-version/<version>.json` over TLS. Throws if
 * the source can't be resolved.
 */
async function resolveExtensionsDownload(): Promise<{ url: string; sha256: string }> {
  const base = getBaseUrl();
  if (!base) { throw new Error("full edition downloads are disabled"); }
  if (!version) { throw new Error("cannot resolve full edition: unknown version"); }
  return await fetchManifest(`${base}/by-version/${version}.json`);
}

/**
 * Fetches and validates the per-version manifest at `url`, returning the download URL and its
 * expected checksum. Throws on a failed request or a malformed manifest.
 */
async function fetchManifest(url: string): Promise<{ url: string; sha256: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Deps.downloadTimeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, agent: agents.trusted });
    if (!res.ok) {
      throw new Error(`full edition manifest request failed (${res.status}) for ${url}`);
    }
    const body = await res.json() as { url?: unknown; sha256?: unknown };
    if (typeof body.url !== "string" || !body.url ||
      typeof body.sha256 !== "string" || !body.sha256) {
      throw new Error(`full edition manifest is malformed: ${url}`);
    }
    return { url: body.url, sha256: body.sha256 };
  } finally {
    clearTimeout(timer);
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
 * Downloads the full edition extensions from `url` and installs them into `dir`, stamping them with
 * `identity`.
 */
async function downloadAndInstall(dir: string, identity: string, url: string, sha256: string):
Promise<void> {
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
    await fse.writeFile(path.join(stagingDir, STAMP_FILE), identity);

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
