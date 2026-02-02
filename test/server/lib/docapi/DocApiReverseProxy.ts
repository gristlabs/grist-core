/**
 * Tests for DocApi functionality behind a reverse proxy.
 * These tests verify that document comparison works correctly when:
 * - APP_HOME_INTERNAL_URL is set (should succeed)
 * - APP_HOME_INTERNAL_URL is not set (should fail with expected error)
 *
 * These tests require Redis and use TestServerReverseProxy to simulate
 * a reverse proxy in front of home and doc servers.
 */

import { UserAPIImpl } from "app/common/UserAPI";
import { getAvailablePort } from "app/server/lib/serverUtils";
import { configForUser } from "test/gen-server/testUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { prepareFilesystemDirectoryForTests } from "test/server/lib/helpers/PrepareFilesystemDirectoryForTests";
import { TestServer, TestServerReverseProxy } from "test/server/lib/helpers/TestServer";
import * as testUtils from "test/server/testUtils";

import { tmpdir } from "os";
import * as path from "path";

import { AxiosRequestConfig } from "axios";
import { assert } from "chai";
import FormData from "form-data";
import fetch from "node-fetch";
import { createClient } from "redis";

const ORG_NAME = "docs";

// A testDir of the form grist_test_{USER}_{SERVER_NAME}
const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi_reverse_proxy`);
let dataDir: string;

let homeUrl: string;
let extraHeadersForConfig: { [key: string]: any };

describe("DocApiReverseProxy", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("error");

  // Skip all tests if Redis is not available
  before(function() {
    if (!process.env.TEST_REDIS_URL) {
      this.skip();
    }
  });

  before(async function() {
    await prepareFilesystemDirectoryForTests(tmpDir);
    await prepareDatabase(tmpDir);
    dataDir = path.join(tmpDir, "data");
  });

  async function flushAllRedis() {
    if (process.env.TEST_REDIS_URL) {
      const cli = createClient(process.env.TEST_REDIS_URL);
      await cli.flushdbAsync();
      await cli.quitAsync();
    }
  }

  function makeConfig(user: string): AxiosRequestConfig {
    const originalConfig = configForUser(user);
    return {
      ...originalConfig,
      headers: {
        ...originalConfig.headers,
        ...extraHeadersForConfig,
      },
    };
  }

  function makeUserApi(org: string, user: string): UserAPIImpl {
    return new UserAPIImpl(`${homeUrl}/o/${org}`, {
      headers: makeConfig(user).headers as Record<string, string>,
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
  }

  async function setupServersWithProxy(
    testSuiteName: string,
    { withAppHomeInternalUrl }: { withAppHomeInternalUrl: boolean },
  ) {
    const proxy = await TestServerReverseProxy.build();

    const homePort = await getAvailablePort(parseInt(process.env.GET_AVAILABLE_PORT_START || "8080", 10));
    const home = new TestServer("home", homePort, tmpDir, testSuiteName);

    const additionalEnvConfiguration = {
      GRIST_DATA_DIR: dataDir,
      APP_HOME_URL: proxy.serverUrl,
      GRIST_ORG_IN_PATH: "true",
      GRIST_SINGLE_PORT: "0",
      APP_HOME_INTERNAL_URL: withAppHomeInternalUrl ? home.serverUrl : "",
      GRIST_EXTERNAL_ATTACHMENTS_MODE: "test",
    };

    await home.start(home.serverUrl, additionalEnvConfiguration);

    const docPort = await getAvailablePort(parseInt(process.env.GET_AVAILABLE_PORT_START || "8080", 10));
    const docs = new TestServer("docs", docPort, tmpDir, testSuiteName);
    await docs.start(home.serverUrl, {
      ...additionalEnvConfiguration,
      APP_DOC_URL: `${proxy.serverUrl}/dw/dw1`,
      APP_DOC_INTERNAL_URL: docs.serverUrl,
    });

    proxy.requireFromOutsideHeader();

    proxy.start(home, docs);

    homeUrl = proxy.serverUrl;
    extraHeadersForConfig = {
      Origin: proxy.serverUrl,
      ...TestServerReverseProxy.FROM_OUTSIDE_HEADER,
    };

    return { proxy, home, docs };
  }

  async function tearDown(proxy: TestServerReverseProxy, servers: TestServer[]) {
    proxy.stop();
    for (const server of servers) {
      await server.stop();
    }
    await flushAllRedis();
  }

  async function testCompareDocs() {
    const chimpyApi = makeUserApi(ORG_NAME, "chimpy");
    const ws1 = (await chimpyApi.getOrgWorkspaces("current"))[0].id;
    const docId1 = await chimpyApi.newDoc({ name: "testdoc1" }, ws1);
    const docId2 = await chimpyApi.newDoc({ name: "testdoc2" }, ws1);
    const doc1 = chimpyApi.getDocAPI(docId1);

    return doc1.compareDoc(docId2);
  }

  describe("specific tests with APP_HOME_INTERNAL_URL", function() {
    let proxy: TestServerReverseProxy;
    let home: TestServer;
    let docs: TestServer;

    before(async function() {
      ({ proxy, home, docs } = await setupServersWithProxy(
        "behind-proxy-with-apphomeinternalurl",
        { withAppHomeInternalUrl: true },
      ));
    });

    after(async function() {
      await tearDown(proxy, [home, docs]);
    });

    it("should succeed to compare docs", async function() {
      const res = await testCompareDocs();
      assert.exists(res);
    });
  });

  describe("specific tests without APP_HOME_INTERNAL_URL", function() {
    let proxy: TestServerReverseProxy;
    let home: TestServer;
    let docs: TestServer;

    before(async function() {
      ({ proxy, home, docs } = await setupServersWithProxy(
        "behind-proxy-without-apphomeinternalurl",
        { withAppHomeInternalUrl: false },
      ));
    });

    after(async function() {
      await tearDown(proxy, [home, docs]);
    });

    it("should fail to compare docs", async function() {
      const promise = testCompareDocs();
      await assert.isRejected(promise, /TestServerReverseProxy: called public URL/);
    });
  });
});
