/**
 *
 * Utilities related to the "wasi" sandbox flavor for the data engine.
 *
 * This runs the unmodified Grist data engine (sandbox/grist) on a CPython
 * interpreter compiled to wasm32-wasi, executed by wasmtime. Compared to the
 * pyodide flavor it drops the Node/Emscripten layer: the host is just a
 * wasmtime process with a handful of explicitly preopened directories and no
 * network. The runtime (python.wasm + wasmtime) is fetched into
 * sandbox/wasi/_build by `make -C sandbox/wasi setup` and is not committed.
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
  command: string;        // path to the wasmtime binary
  args: string[];         // full wasmtime argument list, including the guest entrypoint
  cwd: string;            // working directory for the wasmtime host process
}

// Guest paths that host directories are mapped to inside the WASI filesystem.
const GUEST_ROOT = "/";          // CPython runtime (python.wasm + lib/)
const GUEST_ENGINE = "/grist";   // sandbox/grist (the data engine)
const GUEST_SITE = "/site";      // python dependencies (pure-Python)
const GUEST_IMPORT = "/import";  // optional import directory for plugins

/**
 * Locate the wasi runtime directory (sandbox/wasi/_build), which should contain
 * python.wasm and the stdlib under lib/.
 */
function getRuntimeDir(): string {
  const base = getUnpackedAppRoot();
  return path.resolve(base, "sandbox", "wasi", "_build");
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
  return undefined;  // caller may fall back to PATH lookup
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
 * Build the wasmtime command line for launching the data engine.
 */
export function getWasiSettings(options: ISandboxOptions): WasiSettings {
  const base = getUnpackedAppRoot();
  const runtimeDir = getRuntimeDir();
  const wasmPath = path.join(runtimeDir, "python.wasm");
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      "wasi runtime not installed: run `make -C sandbox/wasi setup` to fetch python.wasm");
  }

  const command = options.command || findWasmtime(runtimeDir) || "wasmtime";

  const engineDir = realPathOrSelf(path.resolve(base, "sandbox", "grist"));
  const sitePackages = findSitePackages();
  const importDir = options.importDir ? realPathOrSelf(options.importDir) : undefined;

  // Environment variables for the guest. Unlike a normal process, a WASI guest
  // sees no host environment unless it is passed explicitly via --env.
  const pythonPath = [GUEST_ENGINE, ...(sitePackages ? [GUEST_SITE] : [])].join(":");
  const guestEnv: Record<string, string> = {
    PIPE_MODE: "wasi",
    PYTHONPATH: pythonPath,
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

  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(guestEnv)) {
    envArgs.push("--env", `${key}=${value}`);
  }

  const dirArgs: string[] = [
    "--dir", `${realPathOrSelf(runtimeDir)}::${GUEST_ROOT}`,
    "--dir", `${engineDir}::${GUEST_ENGINE}`,
  ];
  if (sitePackages) {
    dirArgs.push("--dir", `${realPathOrSelf(sitePackages)}::${GUEST_SITE}`);
  }
  if (importDir) {
    dirArgs.push("--dir", `${importDir}::${GUEST_IMPORT}`);
  }

  const guestArgs: string[] = [
    ...options.testPythonArgs,
    ...(options.useGristEntrypoint === false ? [] : [`${GUEST_ENGINE}/main.py`]),
    ...(options.comment ? [options.comment] : []),
    ...(options.appendArgs ?? []),
  ];

  const args = [
    "run",
    ...options.testSandboxArgs,
    ...dirArgs,
    ...envArgs,
    wasmPath,
    ...guestArgs,
  ];

  return {
    command,
    args,
    cwd: realPathOrSelf(path.resolve(base, "sandbox")),
  };
}

/**
 * Check whether the wasi sandbox can run: we need the python.wasm runtime and a
 * wasmtime binary (bundled, overridden, or on PATH).
 */
export function checkWasiAvailable(): { available: boolean; reason?: string } {
  try {
    const runtimeDir = getRuntimeDir();
    if (!fs.existsSync(path.join(runtimeDir, "python.wasm"))) {
      return { available: false, reason: "python.wasm not installed (run `make -C sandbox/wasi setup`)" };
    }
    if (!findWasmtime(runtimeDir) && !which.sync("wasmtime", { nothrow: true })) {
      return {
        available: false,
        reason: "wasmtime binary not found (bundle in _build, set GRIST_WASI_WASMTIME, or add to PATH)",
      };
    }
    return { available: true };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}
