/**
 *
 * Utilities related to the pyodide sandbox for the data engine.
 * Material for the sandbox is in the sandbox/pyodide directory and
 * may require separate installation steps to make it available.
 *
 * Pyodide is run via deno. The GRIST_PYODIDE_SKIP_DENO=1 flag can be
 * used to call it directly, but this is not a good sandbox.
 *
 */

import { isAffirmative } from "app/common/gutil";
import { ISandboxOptions } from "app/server/lib/NSandbox";
import { getUnpackedAppRoot } from "app/server/lib/places";

import fs from "fs";
import path from "path";

export interface PyodideSettings {
  scriptPath: string,
  cwd: string,
  command?: string,
  args: string[],
  dataToSandboxDescriptor?: number,
  dataFromSandboxDescriptor?: number,
  stdio: ("pipe" | "ipc")[],
}

export function getPyodideSettings(options: ISandboxOptions): PyodideSettings {
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
    };
  }

  // We expect to find a deno binary alongside pyodide.
  const command = findDenoBinary(path.join(base, "sandbox", "pyodide", "_build", "worker"));

  // When running pyodide, we initially need broad read access to the pyodide
  // sandbox directory. We drop this access before running user code with pyodide.
  const readDir = fs.realpathSync(
    path.resolve(base, "sandbox", "pyodide"),
  );

  // Pyodide maintains its own cache of packages. The pipe.js process supplies
  // packages, and pyodide will want to copy them into a cache. So we give
  // access to a directory for that purpose. We drop this access before
  // running user code.
  const writeDir = fs.realpathSync(
    path.resolve(base, "sandbox", "pyodide", "_build", "cache"),
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
  // to that too. We drop read access before running user code.
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
      `--allow-read=${readDir}`,
      `--allow-read=${gristDir}`,
      `--allow-read=${reqFile}`,
      `--allow-write=${writeDir}`,
      "--allow-env",
      ...importAllow,
    ],
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
