/**
 * Tests for anonymous playground disabled mode.
 *
 * These tests require GRIST_ANON_PLAYGROUND: "false" environment setting,
 * which conflicts with other creation tests that need the playground enabled.
 */

import { configForUser } from "test/gen-server/testUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { prepareFilesystemDirectoryForTests } from "test/server/lib/helpers/PrepareFilesystemDirectoryForTests";
import { TestServer } from "test/server/lib/helpers/TestServer";
import * as testUtils from "test/server/testUtils";

import { tmpdir } from "os";
import * as path from "path";

import axios from "axios";
import { assert } from "chai";
import * as fse from "fs-extra";

describe("DocApiAnonPlayground", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  const username = process.env.USER || "nobody";
  let tmpDir: string;
  let home: TestServer;
  let serverUrl: string;

  before(async function() {
    // Set up environment
    process.env.GRIST_SANDBOX_FLAVOR = "unsandboxed";

    // Create temp directory
    tmpDir = path.join(tmpdir(), `grist_test_${username}_docapi-anon-playground`);
    await prepareFilesystemDirectoryForTests(tmpDir);
    await prepareDatabase(tmpDir);

    // Create data directory
    const dataDir = path.join(tmpDir, "anon-playground-data");
    await fse.mkdirs(dataDir);

    // Start server with GRIST_ANON_PLAYGROUND disabled
    const additionalEnvConfiguration = {
      GRIST_DATA_DIR: dataDir,
      GRIST_ANON_PLAYGROUND: "false",
    };

    home = await TestServer.startServer("home,docs", tmpDir, "anon-playground", additionalEnvConfiguration);
    serverUrl = home.serverUrl;
  });

  after(async function() {
    await home.stop();
  });

  it("should not allow anonymous users to create new docs", async () => {
    const nobody = configForUser("Anonymous");
    const resp = await axios.post(`${serverUrl}/api/docs`, null, nobody);
    assert.equal(resp.status, 403);
  });
});
