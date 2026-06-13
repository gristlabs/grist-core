/**
 *
 * Utilities related to the "wasi" sandbox flavor for the data engine.
 *
 * This runs the unmodified Grist data engine (sandbox/grist) on a CPython
 * interpreter compiled to wasm32-wasi. Compared to the pyodide flavor it drops
 * the Node/Emscripten layer: the host is a small wasmtime embedding with a
 * handful of explicitly preopened directories and no network. The runtime
 * (python.wasm + wasmtime) is fetched into sandbox/wasi/_build by
 * `make -C sandbox/wasi setup` and is not committed.
 *
 * Two ways to launch are supported:
 *
 *  - The embedding host (sandbox/wasi/host, built with `make -C sandbox/wasi
 *    host`): opens the engine and dependency directories READ-ONLY, so
 *    sandboxed formula code cannot modify the engine source on the host. This
 *    is the secure mode and is preferred when available.
 *
 *  - The wasmtime CLI: simpler, but its `--dir` grants read-write access to
 *    every preopened directory, so the engine source is writable from inside
 *    the sandbox. Used only as a fallback; not a real sandbox.
 *
 * Data flows over stdin/stdout using the engine's usual marshal protocol; the
 * engine selects this wiring via PIPE_MODE=wasi (see Sandbox.use_wasi in
 * sandbox/grist/sandbox.py). WASI preview1 has no os.dup2, so the side-channel
 * file descriptors used by the other flavors are not available here.
 *
 */

import { ISandboxOptions } from "app/server/lib/NSandbox";
import { getUnpackedAppRoot } from "app/server/lib/places";

import fs from "fs";
import path from "path";

import * as which from "which";

export interface WasiSettings {
  command: string;        // path to the launcher (embedding host or wasmtime)
  args: string[];         // full argument list, including the guest entrypoint
  cwd: string;            // working directory for the host process
  readOnly: boolean;      // whether engine/deps are mounted read-only (secure mode)
}

// Guest paths that host directories are mapped to inside the WASI filesystem.
const GUEST_ROOT = "/";          // CPython runtime (python.wasm + lib/)
const GUEST_ENGINE = "/grist";   // sandbox/grist (the data engine)
const GUEST_SITE = "/site";      // python dependencies (pure-Python)
const GUEST_IMPORT = "/import";  // optional import directory for plugins

interface Preopen {
  host: string;
  guest: string;
  readOnly: boolean;
}

/**
 * Locate the wasi runtime directory (sandbox/wasi/_build), which should contain
 * python.wasm and the stdlib under lib/.
 */
function getRuntimeDir(): string {
  const base = getUnpackedAppRoot();
  return path.resolve(base, "sandbox", "wasi", "_build");
}

/**
 * Find the read-only embedding host binary. Prefers an explicit override, then
 * the release build under sandbox/wasi/host.
 */
function findHost(): string | undefined {
  const override = process.env.GRIST_WASI_HOST;
  if (override && fs.existsSync(override)) {
    return override;
  }
  const base = getUnpackedAppRoot();
  const built = path.resolve(base, "sandbox", "wasi", "host", "target", "release", "grist-wasi-host");
  return fs.existsSync(built) ? built : undefined;
}

/**
 * Find the wasmtime binary. Prefers an explicit override, then the copy fetched
 * into sandbox/wasi/_build, then one on PATH.
 */
function findWasmtime(runtimeDir: string): string | undefined {
  const override = process.env.GRIST_WASI_WASMTIME;
  if (override && fs.existsSync(override)) {
    return override;
  }
  const bundled = path.join(runtimeDir, "wasmtime");
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return which.sync("wasmtime", { nothrow: true }) || undefined;
}

/**
 * Find the site-packages directory holding the engine's Python dependencies.
 * These are all pure Python, so the sandbox_venv3 virtualenv built by
 * `yarn install:python` works as-is even though it targets a different CPython
 * minor version than the wasm build.
 */
function findSitePackages(): string | undefined {
  const base = getUnpackedAppRoot();
  const libDir = path.join(base, "sandbox_venv3", "lib");
  if (!fs.existsSync(libDir)) {
    return undefined;
  }
  for (const entry of fs.readdirSync(libDir)) {
    const candidate = path.join(libDir, entry, "site-packages");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function realPathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Build the launcher command line for running the data engine under WASI.
 */
export function getWasiSettings(options: ISandboxOptions): WasiSettings {
  const base = getUnpackedAppRoot();
  const runtimeDir = getRuntimeDir();
  const wasmPath = path.join(runtimeDir, "python.wasm");
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      "wasi runtime not installed: run `make -C sandbox/wasi setup` to fetch python.wasm");
  }

  const sitePackages = findSitePackages();
  const importDir = options.importDir ? realPathOrSelf(options.importDir) : undefined;

  // Directories the guest can see, with their access mode. The CPython runtime,
  // the engine, and its dependencies are read-only; only the import staging
  // directory (when importing) is writable.
  const preopens: Preopen[] = [
    { host: realPathOrSelf(runtimeDir), guest: GUEST_ROOT, readOnly: true },
    { host: realPathOrSelf(path.resolve(base, "sandbox", "grist")), guest: GUEST_ENGINE, readOnly: true },
  ];
  if (sitePackages) {
    preopens.push({ host: realPathOrSelf(sitePackages), guest: GUEST_SITE, readOnly: true });
  }
  if (importDir) {
    preopens.push({ host: importDir, guest: GUEST_IMPORT, readOnly: false });
  }

  // Environment variables for the guest. Unlike a normal process, a WASI guest
  // sees no host environment unless it is passed explicitly.
  const pythonPath = [GUEST_ENGINE, ...(sitePackages ? [GUEST_SITE] : [])].join(":");
  const guestEnv: Record<string, string> = {
    PIPE_MODE: "wasi",
    PYTHONPATH: pythonPath,
    // The engine and stdlib are read-only, so don't try to write .pyc caches.
    PYTHONDONTWRITEBYTECODE: "1",
  };
  if (importDir) {
    guestEnv.IMPORTDIR = GUEST_IMPORT;
  }
  if (options.deterministicMode) {
    guestEnv.DETERMINISTIC_MODE = "1";
  }
  if (process.env.GRIST_TRUTHY_VALUES) {
    guestEnv.GRIST_TRUTHY_VALUES = process.env.GRIST_TRUTHY_VALUES;
  }
  if (process.env.GRIST_FALSY_VALUES) {
    guestEnv.GRIST_FALSY_VALUES = process.env.GRIST_FALSY_VALUES;
  }

  const guestArgs: string[] = [
    ...options.testPythonArgs,
    ...(options.useGristEntrypoint === false ? [] : [`${GUEST_ENGINE}/main.py`]),
    ...(options.comment ? [options.comment] : []),
    ...(options.appendArgs ?? []),
  ];

  const cwd = realPathOrSelf(path.resolve(base, "sandbox"));
  const host = findHost();

  if (host) {
    // Secure mode: the embedding host honours per-directory read-only access.
    const args: string[] = [wasmPath];
    for (const p of preopens) {
      args.push(p.readOnly ? "--ro" : "--rw", `${p.host}::${p.guest}`);
    }
    for (const [key, value] of Object.entries(guestEnv)) {
      args.push("--env", `${key}=${value}`);
    }
    args.push(...options.testSandboxArgs, "--", ...guestArgs);
    return { command: options.command || host, args, cwd, readOnly: true };
  }

  // Fallback: the wasmtime CLI. Its --dir is always read-write, so the engine
  // source is writable from inside the sandbox (not a real isolation boundary).
  const wasmtime = options.command || findWasmtime(runtimeDir) || "wasmtime";
  const args: string[] = ["run", ...options.testSandboxArgs];
  for (const p of preopens) {
    args.push("--dir", `${p.host}::${p.guest}`);
  }
  for (const [key, value] of Object.entries(guestEnv)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(wasmPath, ...guestArgs);
  return { command: wasmtime, args, cwd, readOnly: false };
}

/**
 * Check whether the wasi sandbox can run: we need the python.wasm runtime and
 * either the embedding host or a wasmtime binary.
 */
export function checkWasiAvailable(): { available: boolean; reason?: string } {
  try {
    const runtimeDir = getRuntimeDir();
    if (!fs.existsSync(path.join(runtimeDir, "python.wasm"))) {
      return { available: false, reason: "python.wasm not installed (run `make -C sandbox/wasi setup`)" };
    }
    if (!findHost() && !findWasmtime(runtimeDir)) {
      return {
        available: false,
        reason: "no launcher found (build `make -C sandbox/wasi host`, or provide wasmtime)",
      };
    }
    return { available: true };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}
