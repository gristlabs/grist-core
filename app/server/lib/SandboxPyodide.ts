/**
 *
 * Utilities related to the pyodide sandbox for the data engine.
 * Material for the sandbox is in the sandbox/pyodide directory and
 * may require separate installation steps to make it available.
 *
 * Pyodide is run via deno. The GRIST_PYODIDE_SKIP_DENO=1 flag can be
 * used to call it directly, but this is not a good sandbox.
 *
 * A sandbox can start from a memory snapshot of one that has already
 * loaded the data engine, kept as a file in a checkpoint directory (see
 * NSandbox), which takes a fraction of the time of loading it from scratch.
 *
 */

import { isAffirmative } from "app/common/gutil";
import log from "app/server/lib/log";
import { ISandboxOptions } from "app/server/lib/NSandbox";
import { getUnpackedAppRoot } from "app/server/lib/places";
import { cleanEnv } from "app/server/lib/serverUtils";

import { ChildProcess, fork, spawn } from "child_process";
import fs from "fs";
import path from "path";

// Pyodide's snapshot within a checkpoint directory.
export const PYODIDE_SNAPSHOT_NAME = "pyodide.snap";

export interface PyodideSettings {
  scriptPath: string,
  cwd: string,
  command?: string,
  args: string[],
  dataToSandboxDescriptor?: number,
  dataFromSandboxDescriptor?: number,
  stdio: ("pipe" | "ipc")[],
  env: NodeJS.ProcessEnv,
}

/**
 * Settings for a sandbox, started from the snapshot in the given checkpoint
 * directory if there is one.
 */
export function getPyodideSettings(options: ISandboxOptions, checkpoint?: string): PyodideSettings {
  const settings = getBaseSettings(options);
  if (checkpoint) {
    // Paths are canonicalized at the OS level, to match what deno checks
    // permissions against (e.g. long names rather than Windows 8.3 short names).
    const snapshot = fs.realpathSync.native(path.join(checkpoint, PYODIDE_SNAPSHOT_NAME));
    settings.env.GRIST_PYODIDE_SNAPSHOT_LOAD = snapshot;
    // Only deno needs permission; pipe.js drops it before running user code.
    if (settings.command) {
      settings.args.push(`--allow-read=${snapshot}`);
    }
  }
  return settings;
}

/**
 * Start pipe.js, with the extra environment variables given.
 */
export function launchPyodide(
  options: ISandboxOptions, settings: PyodideSettings, env: NodeJS.ProcessEnv,
): ChildProcess {
  const { cwd, scriptPath, stdio } = settings;
  const spawnOptions = {
    stdio,
    env: {
      ...env,
      ...settings.env,
      // If running in electron, forces the child process to behave as plain Node.js (no Chromium or browser)
      ELECTRON_RUN_AS_NODE: "1",
    },
  };
  const command = options.command ?? settings.command;
  if (command) {
    const args = [
      ...settings.args,
      ...options.testSandboxArgs,
      // Ignore options.pythonArgs - no python process runs for pyodide
      scriptPath,
      ...(options.comment ? [options.comment] : []),
      ...(options.appendArgs ?? []),
    ];
    log.rawInfo("Launching Pyodide sandbox via spawn", { command: options.command, args, cwd, spawnOptions });
    return spawn(command, args, { cwd, ...spawnOptions, env: cleanEnv(spawnOptions.env) });
  }
  // Under node, we fork with three regular pipes (stdin, stdout, stderr), then
  // ipc (mandatory for calling fork), and a replacement pipe for stdin
  // and for stdout. See getBaseSettings.
  log.rawInfo("Launching Pyodide sandbox via fork", { scriptPath, cwd, spawnOptions });
  return fork(scriptPath, { cwd, ...spawnOptions, env: cleanEnv(spawnOptions.env) });
}

/**
 * Start a sandbox that loads the data engine, saves a snapshot in the given
 * checkpoint directory, and exits.
 */
export function launchPyodideSnapshotMaker(options: ISandboxOptions, dir: string): ChildProcess {
  const settings = getBaseSettings(options);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(fs.realpathSync.native(dir), PYODIDE_SNAPSHOT_NAME);
  // Don't leave an old snapshot in place if making this one fails.
  fs.rmSync(file, { force: true });
  if (settings.command) {
    settings.args.push(`--allow-write=${file}`);
  }
  return launchPyodide(options, settings, { GRIST_PYODIDE_SNAPSHOT_MAKE: file });
}

function getBaseSettings(options: ISandboxOptions): PyodideSettings {
  const base = getUnpackedAppRoot();
  const scriptPath = fs.realpathSync(
    path.resolve(base, "sandbox", "pyodide", "pipe.js"),
  );
  const cwd = fs.realpathSync(path.resolve(process.cwd(), "sandbox"));

  // If user doesn't want Deno, we call pyodide using node. This involves
  // some fancy footwork about pipes, and is less secure. The option exists
  // since running via deno has not yet been widely tested in all the
  // environments pyodide is running in, including desktop environments.
  // In such environments, users may trust the documents they created
  // personally and disruption in the name of security could seem unreasonable.
  if (isAffirmative(process.env.GRIST_PYODIDE_SKIP_DENO)) {
    return {
      scriptPath,
      cwd,
      args: [],

      // Cannot use normal descriptor with nodejs, since node
      // makes it non-blocking. Can be worked around in linux and osx, but
      // for windows just using a different file descriptor seems simplest.
      // In the sandbox, calling async methods from emscripten code is
      // possible but would require more changes to the data engine code
      // than seems reasonable at this time. The top level sandbox.run
      // can be tweaked to step operations, which actually works for a
      // lot of things, but not for cases where the sandbox calls back
      // into node (e.g. for column type guessing). TLDR: just switching
      // to FD 4 and reading synchronously is more practical solution.
      dataToSandboxDescriptor: 4,

      // There's an equally long but different
      // story about why stdout is a bit messed up under pyodide with
      // node right now.
      dataFromSandboxDescriptor: 5,

      // Provide the promised descriptors.
      stdio: ["ignore", "ignore", "pipe", "ipc", "pipe", "pipe"] as ("pipe" | "ipc")[],
      env: {},
    };
  }

  // We expect to find a deno binary alongside pyodide.
  const command = findDenoBinary(path.join(base, "sandbox", "pyodide", "worker"));

  // When running pyodide, we initially need broad read access to the pyodide
  // sandbox directory. We drop this access before running user code with pyodide.
  const readDir = fs.realpathSync(
    path.resolve(base, "sandbox", "pyodide"),
  );

  // The code for the data engine lives outside the sandbox/pyodide directory,
  // in sandbox/grist. We give access to this, then drop it before running
  // user code.
  const gristDir = fs.realpathSync(
    path.resolve(base, "sandbox", "grist"),
  );

  // The list of packages the data engine needs is read straight from
  // sandbox/requirements.txt. We drop access to this before running user
  // code.
  const reqFile = fs.realpathSync(
    path.resolve(base, "sandbox", "requirements.txt"),
  );

  // If the sandbox is being used to do an import, we'll need read access
  // to that too. We will not drop read access to this.
  const importDir = options.importDir ? fs.realpathSync(path.resolve(options.importDir)) : undefined;
  const importAllow = importDir ? [`--allow-read=${importDir}`] : [];

  // Compared to node, we run with a simpler pipe setup, and with
  // explicit permissions that we then drop as soon as we can.
  return {
    scriptPath,
    cwd,
    command,
    stdio: ["pipe", "pipe", "pipe"],
    args: [
      "run",
      `--allow-read=${readDir}`,
      `--allow-read=${gristDir}`,
      `--allow-read=${reqFile}`,
      "--allow-env",
      ...importAllow,
    ],
    env: {},
  };
}

/**
 * Find the Deno binary installed via npm in node_modules.
 * This is a bit tricky. There is a .bin/deno[.exe] file
 * you can run, but it can be a wrapper that relies on node
 * being available and in a certain location (/usr/bin/node).
 * So we have to go rummaging. We take the list of optional
 * dependencies in node_modules/deno, and look through them
 * for a binary - there should be one, the right one for the
 * OS.
 */
function findDenoBinary(dir: string): string {
  if (!denoBinaryCache[dir]) {
    denoBinaryCache[dir] = findDenoBinaryUncached(dir);
  }
  return denoBinaryCache[dir];
}

/**
 * Find the Deno binary within a directory, caching the
 * result.
 */
function findDenoBinaryUncached(dir: string): string {
  const denoPkgDir = path.join(dir, "node_modules", "deno");
  const pkgJsonPath = path.join(denoPkgDir, "package.json");

  if (!fs.existsSync(pkgJsonPath)) {
    throw new Error("npm deno package not found");
  }

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const optionalDeps: Record<string, string> =
    pkg.optionalDependencies ?? {};

  for (const depName of Object.keys(optionalDeps)) {
    const depDir = path.join(dir, "node_modules", depName);
    if (!fs.existsSync(depDir)) {
      continue;
    }

    // The native executable is named `deno` (or `deno.exe` on Windows)
    const exeName = process.platform === "win32" ? "deno.exe" : "deno";
    const exePath = path.join(depDir, exeName);

    if (fs.existsSync(exePath)) {
      return exePath;
    }
  }

  throw new Error("Native Deno executable not found");
}

const denoBinaryCache: Record<string, string> = {};

/**
 * Checks whether the deno binary required by pyodide is available.
 * Returns true if GRIST_PYODIDE_SKIP_DENO is set (node mode) or if the
 * deno npm package is installed with a native binary.
 */
export function checkPyodideDeno(): boolean {
  if (isAffirmative(process.env.GRIST_PYODIDE_SKIP_DENO)) {
    // Don't need to do anything, we will use pyodide in node mode (so it is available).
    return true;
  }
  try {
    // This method will throw if the binary is not found. Notice we are not using the cached version here, since,
    // user might have installed the deno package after the server started.
    findDenoBinaryUncached(path.join(getUnpackedAppRoot(), "sandbox", "pyodide", "worker"));
    return true;
  } catch {
    return false;
  }
}
