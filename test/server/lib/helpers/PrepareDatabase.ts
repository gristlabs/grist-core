import path from "path";
import * as testUtils from "test/server/testUtils";
import {execFileSync} from "child_process";

export async function prepareDatabase(tempDirectory: string) {
  // Let's create a sqlite db that we can share with servers that run in other processes, hence
  // not an in-memory db. Running seed.ts directly might not take in account the most recent value
  // for TYPEORM_DATABASE, because ormconfig.js may already have been loaded with a different
  // configuration (in-memory for instance). Spawning a process is one way to make sure that the
  // latest value prevail.
  process.env.TYPEORM_DATABASE = path.join(tempDirectory, 'landing.db');
  const seed = await testUtils.getBuildFile('test/gen-server/seed.js');
  execFileSync('node', [seed, 'init'], {
    env: process.env,
    stdio: 'inherit'
  });
}
