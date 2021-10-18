/**
 *
 * This opens a sandbox in order to capture a checkpoint of the sandbox after Grist
 * python code has been loaded within it. This helps run Grist's 1000s of tests under
 * gvisor on a ptrace platform, for which all the file accesses on sandbox startup
 * are relatively slow, adding about a second relative to pynbox.
 *
 */

import { create } from 'app/server/lib/create';

export async function main() {
  if (!process.env.GRIST_CHECKPOINT) {
    throw new Error('GRIST_CHECKPOINT must be defined');
  }
  if (!process.env.GRIST_CHECKPOINT_MAKE) {
    throw new Error('GRIST_CHECKPOINT_MAKE must be defined');
  }
  create.NSandbox({
    preferredPythonVersion: '3'
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
  });
}
