/**
 * Determines whether a filesystem path lives on storage that survives a restart,
 * by inspecting the OS mount table. Used by the "persist-data" boot probe.
 */
import { StorageClassification } from "app/common/BootProbe";

import { promises as fse } from "node:fs";
import * as path from "node:path";

// Filesystems that live in RAM and so never survive a restart.
const RAM_FILESYSTEMS = new Set(["tmpfs", "ramfs"]);

/**
 * Whether the storage backing `target` survives a restart, and why not when it
 * doesn't. RAM filesystems never do; sharing the root mount means nothing is
 * mounted there (ephemeral only if the root itself may be a throwaway container
 * layer); assume any other mount is durable. Returns "unknown" when it can't be
 * determined, e.g. not on Linux.
 */
export async function classifyStorage(
  target: string | undefined, rootMayBeEphemeral: boolean,
): Promise<StorageClassification> {
  return classifyStorageFromMounts(target, rootMayBeEphemeral, await readMountInfo());
}

/**
 * The classification itself, separated from reading /proc so tests can feed it
 * synthetic mount tables. `mountInfo` is raw /proc/self/mountinfo content, or
 * undefined if it couldn't be read.
 */
export function classifyStorageFromMounts(
  target: string | undefined, rootMayBeEphemeral: boolean, mountInfo: string | undefined,
): StorageClassification {
  if (!target || mountInfo === undefined) { return { durability: "unknown" }; }
  const mounts = parseMounts(mountInfo);
  const root = mountFor("/", mounts);
  const mount = mountFor(target, mounts);
  if (!root || !mount) { return { durability: "unknown" }; }
  const { fsType, mountPoint } = mount;
  if (RAM_FILESYSTEMS.has(fsType)) {
    return { durability: "ephemeral", reason: { kind: "ram-filesystem", fsType, mountPoint } };
  }
  if (mountPoint === root.mountPoint) {
    return rootMayBeEphemeral ?
      { durability: "ephemeral", reason: { kind: "image-root-heuristic", fsType, mountPoint } } :
      { durability: "unknown" };
  }
  return { durability: "durable" };
}

interface MountInfo {
  mountPoint: string;   // e.g. "/", "/persist"
  fsType: string;       // e.g. "ext4", "overlay", "tmpfs"
}

// Read /proc/self/mountinfo (Linux only); undefined if unreadable.
async function readMountInfo(): Promise<string | undefined> {
  try {
    return await fse.readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return undefined;
  }
}

// Parse /proc/self/mountinfo content, skipping any line we don't understand.
// Line: ID PID MAJ:MIN ROOT MOUNTPOINT OPTS [TAGS...] - FSTYPE SOURCE SUPEROPTS
function parseMounts(content: string): MountInfo[] {
  return content.split("\n").flatMap((line) => {
    const [before, after] = line.split(" - ");
    if (!after) { return []; }
    const mountPoint = before.split(" ")[4];
    const fsType = after.split(" ")[0];
    return mountPoint && fsType ? [{ mountPoint, fsType }] : [];
  });
}

// The mount whose mount point is the longest prefix of `target`. Pure string
// logic, so it works even if `target` doesn't exist yet.
function mountFor(target: string, mounts: MountInfo[]): MountInfo | undefined {
  const p = path.resolve(target);
  let best: MountInfo | undefined;
  for (const mount of mounts) {
    const { mountPoint } = mount;
    const within = mountPoint === "/" || p === mountPoint || p.startsWith(mountPoint + "/");
    if (within && (!best || mountPoint.length > best.mountPoint.length)) { best = mount; }
  }
  return best;
}
