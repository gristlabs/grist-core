/**
 * Shared helpers for DocApi tests.
 *
 * This module provides common utilities, types, and setup functions used
 * across the split DocApi test files.
 */

import { UserAPIImpl } from "app/common/UserAPI";
import { configForUser } from "test/gen-server/testUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { prepareFilesystemDirectoryForTests } from "test/server/lib/helpers/PrepareFilesystemDirectoryForTests";
import { TestServer, TestServerReverseProxy } from "test/server/lib/helpers/TestServer";
import * as testUtils from "test/server/testUtils";

import { tmpdir } from "os";
import * as path from "path";

import { AxiosRequestConfig } from "axios";
import axios from "axios";
import FormData from "form-data";
import fetch from "node-fetch";
import { createClient } from "redis";

// Standard doc IDs used in tests
export const docIds: { [name: string]: string } = {
  ApiDataRecordsTest: "sampledocid_7",
  Timesheets: "sampledocid_13",
  Bananas: "sampledocid_6",
  Antartic: "sampledocid_11",
};

// Standard org name
export const ORG_NAME = "docs-1";

// A testDir of the form grist_test_{USER}_{SERVER_NAME}
const username = process.env.USER || "nobody";
export const tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi`);

/**
 * Shared state that gets set up by the setup() function and used by tests.
 */
export interface DocApiTestState {
  /** Directory containing test data files */
  dataDir: string;
  /** Name of the current test suite */
  suitename: string;
  /** URL of the server handling requests */
  serverUrl: string;
  /** URL of the home server */
  homeUrl: string;
  /** Whether a home API is available */
  hasHomeApi: boolean;
  /** The home server instance */
  home: TestServer;
  /** The doc worker server instance (may be same as home) */
  docs: TestServer;
  /** API client for the primary test user */
  userApi: UserAPIImpl;
  /** Extra headers to include in requests (for reverse proxy tests) */
  extraHeadersForConfig: Record<string, string>;
}

/**
 * Creates an axios config with auth headers for a given user.
 */
export function makeConfig(
  username: string,
  extraHeaders: Record<string, string> = {},
): AxiosRequestConfig {
  const originalConfig = configForUser(username);
  return {
    ...originalConfig,
    headers: {
      ...originalConfig.headers,
      ...extraHeaders,
    },
  };
}

/**
 * Creates a UserAPI instance for a given org and user.
 * Similar to home.makeUserApi but injects extraHeadersForConfig for reverse-proxy tests.
 */
export function makeUserApi(
  org: string,
  username: string,
  homeUrl: string,
  extraHeaders: Record<string, string> = {},
): UserAPIImpl {
  return new UserAPIImpl(`${homeUrl}/o/${org}`, {
    headers: makeConfig(username, extraHeaders).headers as Record<string, string>,
    fetch: fetch as unknown as typeof globalThis.fetch,
    newFormData: () => new FormData() as any,
  });
}

/**
 * Flush all data from the test Redis database.
 */
export async function flushAllRedis(): Promise<void> {
  if (process.env.TEST_REDIS_URL) {
    const cli = createClient(process.env.TEST_REDIS_URL);
    await cli.flushdbAsync();
    await cli.quitAsync();
  }
}

/**
 * Flush the auth cache on both home and docs servers.
 */
export async function flushAuth(home: TestServer, docs: TestServer): Promise<void> {
  await home.testingHooks.flushAuthorizerCache();
  await docs.testingHooks.flushAuthorizerCache();
}

/**
 * Get a workspace ID by name.
 */
export async function getWorkspaceId(api: UserAPIImpl, name: string): Promise<number> {
  const workspaces = await api.getOrgWorkspaces("current");
  return workspaces.find(w => w.name === name)!.id;
}

/**
 * Set up the data directory with fixture documents.
 */
export async function setupDataDir(dir: string): Promise<void> {
  // Copy Hello.grist for various document IDs
  await testUtils.copyFixtureDoc("Hello.grist", path.resolve(dir, docIds.Timesheets + ".grist"));
  await testUtils.copyFixtureDoc("Hello.grist", path.resolve(dir, docIds.Bananas + ".grist"));
  await testUtils.copyFixtureDoc("Hello.grist", path.resolve(dir, docIds.Antartic + ".grist"));
  await testUtils.copyFixtureDoc(
    "ApiDataRecordsTest.grist",
    path.resolve(dir, docIds.ApiDataRecordsTest + ".grist"),
  );
}

/**
 * Prepare the test database and filesystem.
 */
export async function prepareTestDir(): Promise<void> {
  await prepareFilesystemDirectoryForTests(tmpDir);
  await prepareDatabase(tmpDir);
}

/**
 * Context passed to each test module's function.
 * Contains everything needed to run the tests.
 */
export interface DocApiTestContext {
  /** Shared test state */
  state: () => DocApiTestState;
  /** Make an axios config for a user */
  makeConfig: (username: string) => AxiosRequestConfig;
  /** Make a UserAPI for a user */
  makeUserApi: (org: string, username: string, options?: { baseUrl?: string }) => UserAPIImpl;
  /** Flush auth caches */
  flushAuth: () => Promise<void>;
  /** Get workspace ID by name */
  getWorkspaceId: (api: UserAPIImpl, name: string) => Promise<number>;
  /** Document IDs */
  docIds: typeof docIds;
  /** Org name */
  ORG_NAME: string;
}

/**
 * Create a test context from the current state.
 * This provides a clean interface for test modules.
 */
export function createTestContext(getState: () => DocApiTestState): DocApiTestContext {
  return {
    state: getState,
    makeConfig: (username: string) => makeConfig(username, getState().extraHeadersForConfig),
    makeUserApi: (org: string, username: string, options?: { baseUrl?: string }) =>
      makeUserApi(org, username, options?.baseUrl ?? getState().homeUrl, getState().extraHeadersForConfig),
    flushAuth: () => flushAuth(getState().home, getState().docs),
    getWorkspaceId,
    docIds,
    ORG_NAME,
  };
}

/**
 * Generate a new document and its URLs for testing.
 */
export async function generateDocAndUrl(
  userApi: UserAPIImpl,
  serverUrl: string,
  docName: string = "Dummy",
): Promise<{ docUrl: string; tableUrl: string; docId: string }> {
  const wid = (await userApi.getOrgWorkspaces("current")).find(w => w.name === "Private")!.id;
  const docId = await userApi.newDoc({ name: docName }, wid);
  const docUrl = `${serverUrl}/api/docs/${docId}`;
  const tableUrl = `${serverUrl}/api/docs/${docId}/tables/Table1`;
  return { docUrl, tableUrl, docId };
}

// Re-export commonly used items
export { axios };
export type { AxiosRequestConfig, AxiosResponse } from "axios";
export { assert } from "chai";
export { TestServer, TestServerReverseProxy };
export * as fse from "fs-extra";
export { UserAPIImpl };
