import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { createTestDir, EnvironmentSnapshot } from "test/server/testUtils";

import { createClient } from "redis";

export interface RedisTestSetup {
  testDir: string;

  // Held by the suite, which restores it after the servers are stopped.
  oldEnv: EnvironmentSnapshot;
}

// The variables that name a doc worker outright. A suite that inherited one of these from the
// environment would have its servers told apart by hand, and would quietly stop testing what it
// meant to. Cleared centrally so that no suite has to remember. GRIST_HOST also feeds identity,
// but every suite states it, since it decides what the servers listen on too.
const IDENTITY_VARS = ["GRIST_DOC_WORKER_ID", "APP_DOC_INTERNAL_URL", "APP_DOC_URL"];

// What a suite needs beyond its own configuration to start several real servers that reach each
// other. Listening on every interface is the part that matters: without it a server answers only
// its own machine, whatever address it publishes.
export const MULTI_SERVER_ENV = {
  GRIST_HOST: "0.0.0.0",
};

/**
 * What a suite that cannot run without Redis does before starting any server.
 *
 * The flush matters: doc worker registrations outlive the process that wrote them, so a suite
 * inheriting an earlier one's database would find peers that are not there.
 *
 * For suites where Redis is optional, do it inline, since skipping is the whole point here.
 */
export async function prepareRedisTest(
  ctx: Mocha.Context, suiteName: string,
): Promise<RedisTestSetup> {
  if (!process.env.TEST_REDIS_URL) {
    console.warn(`${suiteName}: skipped (set TEST_REDIS_URL to run)`);
    ctx.skip();
  }

  const cli = createClient(process.env.TEST_REDIS_URL);
  await cli.flushdbAsync();
  await cli.quitAsync();

  const oldEnv = new EnvironmentSnapshot();
  for (const name of IDENTITY_VARS) { delete process.env[name]; }
  const testDir = await createTestDir(suiteName);
  await prepareDatabase(testDir, oldEnv);
  return { testDir, oldEnv };
}
