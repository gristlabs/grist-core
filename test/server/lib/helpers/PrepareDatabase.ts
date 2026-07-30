import * as testUtils from "test/server/testUtils";

import { execFileSync } from "child_process";
import path from "path";

/**
 * Prepares a clean seed database in the given directory, and set TYPEORM_DATABASE to point to it,
 * so that spawned servers can see it too.
 *
 * Requires an EnvironmentSnapshot to remind the caller that the environment is being changed and
 * needs to be restored to avoid affecting subsequent tests. Restoring it is still the caller's
 * responsibility.
 */
export async function prepareDatabase(
  tempDirectory: string, env: testUtils.EnvironmentSnapshot, filename: string = "landing.db",
) {
  // Let's create a sqlite db that we can share with servers that run in other processes, hence
  // not an in-memory db. Running seed.ts directly might not take in account the most recent value
  // for TYPEORM_DATABASE, because ormconfig.js may already have been loaded with a different
  // configuration (in-memory for instance). Spawning a process is one way to make sure that the
  // latest value prevail.
  process.env.TYPEORM_DATABASE = path.join(tempDirectory, filename);
  const seed = await testUtils.getBuildFile("test/gen-server/seed.js");
  execFileSync("node", [seed, "init"], {
    env: process.env,
    stdio: "inherit",
  });
}
