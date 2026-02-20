/**
 * Shared test scenarios for DocApi tests.
 *
 * Provides setup functions for running tests against different server configurations:
 * - Merged server: single server for home + docs
 * - Separated servers: home server + doc worker (requires Redis)
 * - Direct to docworker: requests sent directly to doc worker (requires Redis)
 */

import { UserAPI, UserAPIImpl } from "app/common/UserAPI";
import { configForUser } from "test/gen-server/testUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { prepareFilesystemDirectoryForTests } from "test/server/lib/helpers/PrepareFilesystemDirectoryForTests";
import { TestServer } from "test/server/lib/helpers/TestServer";
import * as testUtils from "test/server/testUtils";

import { tmpdir } from "os";
import * as path from "path";

import { AxiosRequestConfig } from "axios";
import FormData from "form-data";
import * as fse from "fs-extra";
import fetch from "node-fetch";
import { createClient } from "redis";

/**
 * Context provided to tests - contains everything needed to run API tests.
 */
export interface TestContext {
  /** URL for API requests (may be home or docs server depending on scenario) */
  serverUrl: string;
  /** URL for home server */
  homeUrl: string;
  /** User API client */
  userApi: UserAPI;
  /** Document IDs for fixture documents */
  docIds: { [name: string]: string };
  /** Axios config for Chimpy user */
  chimpy: AxiosRequestConfig;
  /** Axios config for Kiwi user */
  kiwi: AxiosRequestConfig;
  /** Axios config for Charon user */
  charon: AxiosRequestConfig;
  /** Axios config for anonymous user */
  nobody: AxiosRequestConfig;
  /** Axios config for support user */
  support: AxiosRequestConfig;
  /** Whether home API is available (false when direct to docworker) */
  hasHomeApi: boolean;
  /** Home server instance */
  home: TestServer;
  /** Docs server instance (same as home for merged) */
  docs: TestServer;
  /** Flush auth cache after permission changes */
  flushAuth: () => Promise<void>;
  /** Cleanup function - call in after() */
  cleanup: () => Promise<void>;
}

/** Server configuration mode */
export type ServerMode = "merged" | "separated" | "direct";

// Module-level state for each test run
const username = process.env.USER || "nobody";
let tmpDir: string;
let dataDir: string;
// Track which test suites have been set up (keyed by testSuiteName)
const globalSetupDone = new Set<string>();

// Pre-seeded document IDs from the test database
const docIds: { [name: string]: string } = {
  ApiDataRecordsTest: "sampledocid_7",
  Timesheets: "sampledocid_13",
  Bananas: "sampledocid_6",
};

// Org name from the seeded database
export const ORG_NAME = "docs-1";

/**
 * Flush Redis database if Redis is in use.
 */
async function flushAllRedis() {
  if (process.env.TEST_REDIS_URL) {
    const cli = createClient(process.env.TEST_REDIS_URL);
    await cli.flushdbAsync();
    await cli.quitAsync();
  }
}

/**
 * Create a UserAPI instance for the given org and request config, as fetched by configForUser
 */
export function makeUserApi(homeUrl: string, org: string, config: AxiosRequestConfig): UserAPI {
  return new UserAPIImpl(`${homeUrl}/o/${org}`, {
    headers: config.headers as Record<string, string>,
    fetch: fetch as unknown as typeof globalThis.fetch,
    newFormData: () => new FormData() as any,
  });
}

/**
 * Set up fixture documents in the data directory.
 */
async function setupDataDir(dir: string) {
  await testUtils.copyFixtureDoc("Hello.grist", path.resolve(dir, docIds.Timesheets + ".grist"));
  await testUtils.copyFixtureDoc("Hello.grist", path.resolve(dir, docIds.Bananas + ".grist"));
  await testUtils.copyFixtureDoc(
    "ApiDataRecordsTest.grist",
    path.resolve(dir, docIds.ApiDataRecordsTest + ".grist"),
  );
}

/**
 * Get workspace ID by name.
 */
async function getWorkspaceId(api: UserAPI, name: string): Promise<number> {
  const workspaces = await api.getOrgWorkspaces("current");
  return workspaces.find(w => w.name === name)!.id;
}

/**
 * Global setup that runs once before any scenario.
 * Sets up the temp directory and seeded database.
 */
async function globalSetup(testSuiteName: string) {
  if (globalSetupDone.has(testSuiteName)) {
    return;
  }
  globalSetupDone.add(testSuiteName);

  // Create a stable temp directory (like DocApi.ts)
  tmpDir = path.join(tmpdir(), `grist_test_${username}_${testSuiteName}`);
  await prepareFilesystemDirectoryForTests(tmpDir);

  // Create the seeded database
  await prepareDatabase(tmpDir);
}

/**
 * Per-scenario setup. Sets up data directory and fixtures.
 */
async function scenarioSetup(suitename: string): Promise<{ docIds: { [name: string]: string } }> {
  await flushAllRedis();

  // Create data directory with fixtures
  dataDir = path.join(tmpDir, `${suitename}-data`);
  await fse.mkdirs(dataDir);
  await setupDataDir(dataDir);

  return { docIds: { ...docIds } };
}

/**
 * Create the TestContext with user configs and helpers.
 */
function createContext(
  home: TestServer,
  docs: TestServer,
  serverUrl: string,
  homeUrl: string,
  scenarioDocIds: { [name: string]: string },
  hasHomeApi: boolean,
): TestContext {
  const userApi = makeUserApi(homeUrl, ORG_NAME, configForUser("chimpy"));

  const flushAuth = async () => {
    await home.testingHooks.flushAuthorizerCache();
    if (docs !== home) {
      await docs.testingHooks.flushAuthorizerCache();
    }
  };

  const cleanup = async () => {
    // Delete TestDoc if it was created
    if (scenarioDocIds.TestDoc) {
      await userApi.deleteDoc(scenarioDocIds.TestDoc);
      delete scenarioDocIds.TestDoc;
    }
    await home.stop();
    if (docs !== home) {
      await docs.stop();
    }
  };

  return {
    serverUrl,
    homeUrl,
    userApi,
    docIds: scenarioDocIds,
    chimpy: configForUser("Chimpy"),
    kiwi: configForUser("Kiwi"),
    charon: configForUser("Charon"),
    nobody: configForUser("Anonymous"),
    support: configForUser("Support"),
    hasHomeApi,
    home,
    docs,
    flushAuth,
    cleanup,
  };
}

/**
 * Set up servers for a given mode.
 *
 * @param mode - "merged" (single server), "separated" (home + docworker), or "direct" (to docworker)
 * @param extraEnv - Additional environment variables
 */
export async function setupServers(
  mode: ServerMode,
  extraEnv?: Record<string, string>,
): Promise<TestContext> {
  const { docIds: scenarioDocIds } = await scenarioSetup(mode);

  const env = {
    GRIST_DATA_DIR: dataDir,
    GRIST_EXTERNAL_ATTACHMENTS_MODE: "test",
    // The XLS test fails on Jenkins without this. Mysterious? Maybe a real problem or
    // a problem in test setup related to plugins? TODO: investigate and fix.
    GRIST_SANDBOX_FLAVOR: "unsandboxed",
    ...extraEnv,
  };

  let home: TestServer;
  let docs: TestServer;
  let serverUrl: string;

  if (mode === "merged") {
    home = docs = await TestServer.startServer("home,docs", tmpDir, mode, env);
    serverUrl = home.serverUrl;
  } else {
    home = await TestServer.startServer("home", tmpDir, mode, env);
    docs = await TestServer.startServer("docs", tmpDir, mode, env, home.serverUrl);
    serverUrl = mode === "direct" ? docs.serverUrl : home.serverUrl;
  }

  // Create TestDoc as an empty doc in Private workspace
  const userApi = makeUserApi(home.serverUrl, ORG_NAME, configForUser("chimpy"));
  const wid = await getWorkspaceId(userApi, "Private");
  scenarioDocIds.TestDoc = await userApi.newDoc({ name: "TestDoc" }, wid);

  return createContext(home, docs, serverUrl, home.serverUrl, scenarioDocIds, mode !== "direct");
}

/**
 * Options for scenario configuration.
 */
export interface ScenarioOptions {
  /** Additional environment variables to pass to the server */
  extraEnv?: Record<string, string>;
}

/**
 * Add a single test scenario as a describe block.
 */
function addScenario(
  name: string,
  mode: ServerMode,
  addTests: (getCtx: () => TestContext) => void,
  extraEnv?: Record<string, string>,
) {
  describe(name, function() {
    let ctx: TestContext;

    before(async function() {
      ctx = await setupServers(mode, extraEnv);
    });

    after(async function() {
      await ctx.cleanup();
    });

    addTests(() => ctx);
  });
}

/**
 * Add all test scenarios to the current describe block.
 *
 * This creates nested describe blocks for each server configuration:
 * - "merged server" - always runs
 * - "home + docworker" - runs if Redis available
 * - "direct to docworker" - runs if Redis available
 *
 * @param addTests Function that adds it() blocks, receives context getter
 * @param testSuiteName Optional name for the test suite (used for temp directory)
 * @param options Optional configuration (extraEnv, etc.)
 */
export function addAllScenarios(
  addTests: (getCtx: () => TestContext) => void,
  testSuiteName: string = "docapi",
  options: ScenarioOptions = {},
) {
  // Global setup runs once before any scenario
  before(async function() {
    await globalSetup(testSuiteName);
  });

  // Note: We intentionally don't restore oldEnv in after() because
  // when multiple test files share the same globalSetupDone flag,
  // the first file's after() would clear the database path before
  // subsequent files run. The test process exits anyway.

  addScenario("merged server", "merged", addTests, options.extraEnv);

  if (process.env.TEST_REDIS_URL) {
    addScenario("home + docworker", "separated", addTests, options.extraEnv);
    addScenario("direct to docworker", "direct", addTests, options.extraEnv);
  }
}
