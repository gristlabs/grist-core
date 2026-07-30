/**
 * Determines whether a filesystem path lives on storage that survives a restart,
 * by inspecting the OS mount table. Used by the "persist-data" boot probe.
 */
import { promises as fse } from "node:fs";
import * as path from "node:path";

export type Durability = "durable" | "ephemeral" | "unknown";

// Filesystems that live in RAM and so never survive a restart.
const RAM_FILESYSTEMS = new Set(["tmpfs", "ramfs"]);

/**
 * Whether the storage backing `target` survives a restart. RAM filesystems never
 * do; sharing the root mount means nothing is mounted there (ephemeral only if the
 * root itself may be a throwaway container layer); assume any other mount is durable.
 * Returns "unknown" when it can't be determined, e.g. not on Linux.
 */
export async function classifyStorage(
  target: string | undefined, rootMayBeEphemeral: boolean,
): Promise<Durability> {
  if (!target) { return "unknown"; }
  const mounts = await readMounts();
  if (!mounts) { return "unknown"; }
  const root = mountFor("/", mounts);
  const mount = mountFor(target, mounts);
  if (!root || !mount) { return "unknown"; }
  if (RAM_FILESYSTEMS.has(mount.fsType)) { return "ephemeral"; }
  if (mount.mountPoint === root.mountPoint) { return rootMayBeEphemeral ? "ephemeral" : "unknown"; }
  return "durable";
}

interface MountInfo {
  mountPoint: string;   // e.g. "/", "/persist"
  fsType: string;       // e.g. "ext4", "overlay", "tmpfs"
}

// Read /proc/self/mountinfo (Linux only); undefined if unreadable.
// Line: ID PID MAJ:MIN ROOT MOUNTPOINT OPTS [TAGS...] - FSTYPE SOURCE SUPEROPTS
async function readMounts(): Promise<MountInfo[] | undefined> {
  let content: string;
  try {
    content = await fse.readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return undefined;
  }
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
