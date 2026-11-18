/**
 * Reads the OS mount table, so the "persist-data" boot probe can report which mount Grist's
 * data is on.
 */
import { MountInfo } from "app/common/BootProbe";

import { promises as fse } from "node:fs";
import * as path from "node:path";

// Read /proc/self/mountinfo (Linux only); undefined if unreadable.
// Line: ID PID MAJ:MIN ROOT MOUNTPOINT OPTS [TAGS...] - FSTYPE SOURCE SUPEROPTS
export async function readMounts(): Promise<MountInfo[] | undefined> {
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
export function mountFor(target: string, mounts: MountInfo[]): MountInfo | undefined {
  const p = path.resolve(target);
  let best: MountInfo | undefined;
  for (const mount of mounts) {
    const { mountPoint } = mount;
    const within = mountPoint === "/" || p === mountPoint || p.startsWith(mountPoint + "/");
    if (within && (!best || mountPoint.length > best.mountPoint.length)) { best = mount; }
  }
  return best;
}
