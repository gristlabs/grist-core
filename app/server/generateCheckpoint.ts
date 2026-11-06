/**
 *
 * This opens a sandbox in order to capture a checkpoint of the sandbox after Grist
 * python code has been loaded within it. This helps run Grist's 1000s of tests under
 * gvisor on a ptrace platform, for which all the file accesses on sandbox startup
 * are relatively slow, and under pyodide, which is slow to load.
 *
 */

import "app/server/lib/lockdown";
import { getConfiguredFlavor, makeCheckpoint } from "app/server/lib/NSandbox";

export async function main() {
  const dir = process.env.GRIST_CHECKPOINT;
  if (!dir || dir === "none") {
    throw new Error("GRIST_CHECKPOINT must name a directory");
  }
  const flavor = getConfiguredFlavor();
  if (!flavor) {
    throw new Error("GRIST_SANDBOX_FLAVOR must be defined");
  }
  await makeCheckpoint(flavor, dir);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
