/**
 * The ordinary installation, one server holding everything, with no Redis.
 *
 * Routing documents between servers must leave this shape exactly as it was, which is what this
 * suite is for. Such a server publishes an address for itself that it cannot know is reachable,
 * since whatever sits in front of it decides how the outside world names it, so a client has to be
 * told to carry on with the address it already used.
 */

import { UserAPIImpl } from "app/common/UserAPI";
import { getAvailablePort } from "app/server/lib/serverUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { TestServer } from "test/server/lib/helpers/TestServer";
import { createTestDir, EnvironmentSnapshot, setTmpLogLevel } from "test/server/testUtils";

import { assert } from "chai";
import fetch from "node-fetch";

describe("SingleServerRouting", function() {
  this.timeout(30000);

  setTmpLogLevel("error");

  let oldEnv: EnvironmentSnapshot;
  let server: TestServer;
  let api: UserAPIImpl;

  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    for (const name of ["GRIST_DOC_WORKER_ID", "APP_DOC_INTERNAL_URL", "APP_DOC_URL",
      "GRIST_ROUTER_URL", "GRIST_FLEET"]) {
      delete process.env[name];
    }
    const testDir = await createTestDir("SingleServerRouting");
    await prepareDatabase(testDir, oldEnv);
    // No Redis, as a single server has no use for one. Its own registration is held in memory.
    server = await TestServer.startServer("home,docs,static", testDir, "single", { REDIS_URL: "" });
    api = server.makeUserApi("docs");
  });

  after(async function() {
    await TestServer.stopAll([server]);
    oldEnv?.restore();
  });

  // Runs body against a server of its own, with a database of its own rather than the one the
  // server in the other tests is still using.
  async function withOwnServer(
    name: string, env: NodeJS.ProcessEnv, body: (own: TestServer, ownApi: UserAPIImpl) => Promise<void>,
    options: { homeUrl?: string, port?: number } = {},
  ) {
    const testDir = await createTestDir(`SingleServer-${name}`);
    const sharedDb = process.env.TYPEORM_DATABASE;
    await prepareDatabase(testDir, oldEnv, `${name}.db`);
    const own = await TestServer.startServer("home,docs,static", testDir, name,
      { REDIS_URL: "", ...env }, options.homeUrl, { port: options.port });
    try {
      await body(own, own.makeUserApi("docs"));
    } finally {
      await TestServer.stopAll([own]);
      if (sharedDb) { process.env.TYPEORM_DATABASE = sharedDb; }
    }
  }

  it("sends a client back to itself, for a document and for an import", async function() {
    // The home page imports with one request, so the import answer is what that goes to.
    const wsId = (await api.getOrgWorkspaces("current"))[0].id;
    const docId = await api.newDoc({ name: "only-copy" }, wsId);
    for (const key of [docId, "import"]) {
      const info = await api.getWorkerFull(key);
      assert.isNotNull(info.selfPrefix, `${key} was sent to an address this server guessed`);
      assert.isNull(info.docWorkerUrl);
    }
  });

  it("hands out its own address when an operator has named one", async function() {
    // APP_DOC_URL is how a client is routed to the server holding a document, so a server given
    // one has an address worth passing on, and the reason to say "stay where you are" is gone.
    await withOwnServer("named", { APP_DOC_URL: "https://named.example.com" }, async (_named, namedApi) => {
      const wsId = (await namedApi.getOrgWorkspaces("current"))[0].id;
      const docId = await namedApi.newDoc({ name: "named-address" }, wsId);
      const info = await namedApi.getWorkerFull(docId);
      assert.equal(new URL(info.docWorkerUrl!).host, "named.example.com",
        "the address the operator gave was not passed on");
      assert.isNull(info.selfPrefix);
    });
  });

  it("hands out an address on a domain with no subdomain to spare", async function() {
    // Most self-hosted setups serve everything from one domain, which names no worker. There is
    // only one here to name, so the address is passed on as the operator wrote it.
    await withOwnServer("bare", { APP_DOC_URL: "https://grist.app" }, async (bare, bareApi) => {
      const wsId = (await bareApi.getOrgWorkspaces("current"))[0].id;
      const docId = await bareApi.newDoc({ name: "bare-address" }, wsId);
      const info = await bareApi.getWorkerFull(docId);
      assert.equal(new URL(info.docWorkerUrl!).host, "grist.app",
        "the address the operator gave was not passed on");
      // The page is built by this server, so it arrives whatever the address is called.
      const resp = await fetch(`${bare.serverUrl}/o/docs/doc/${docId}`, {
        headers: { Authorization: "Bearer api_key_for_chimpy" },
      });
      assert.equal(resp.status, 200);
    });
  });

  it("opens a document", async function() {
    // The page for a document is fetched from the server holding it. Here that is this server, so
    // nothing should go out to an address it guessed, and the page should arrive as it always did.
    const wsId = (await api.getOrgWorkspaces("current"))[0].id;
    const docId = await api.newDoc({ name: "opens" }, wsId);
    const resp = await fetch(`${server.serverUrl}/o/docs/doc/${docId}`, {
      headers: { Authorization: "Bearer api_key_for_chimpy" },
    });
    assert.equal(resp.status, 200);
    const page = await resp.text();
    assert.include(page.toLowerCase(), "<!doctype html>");
    // The page carries what the client needs to reach the document. It must be a prefix to add to
    // the address in the browser, not an address this server made up for itself.
    assert.match(page, /"selfPrefix":\s*"/, "the page did not send the client back to this server");
    assert.notMatch(page, /"docWorkerUrl":\s*"http/, "the page named an address of its own");
  });

  it("copies a document when fetching it from an address it does not recognize", async function() {
    // A copy is fetched from the worker's registered address, even when that is this server.
    // 127.0.0.1 stands in for an address derived from Redis, such as 172.22.0.4.
    const port = await getAvailablePort(parseInt(process.env.GET_AVAILABLE_PORT_START || "8080", 10));
    const env = { GRIST_ORG_IN_PATH: "true", GRIST_HOST: "127.0.0.1", APP_DOC_URL: `http://127.0.0.1:${port}` };
    await withOwnServer("self", env,
      async (_self, selfApi) => {
        const wsId = (await selfApi.getOrgWorkspaces("current"))[0].id;
        const docId = await selfApi.newDoc({ name: "source" }, wsId);
        await selfApi.copyDoc(docId, wsId, { documentName: "copy" });
      }, { homeUrl: `http://grist.example.test:${port}`, port });
  });
});
