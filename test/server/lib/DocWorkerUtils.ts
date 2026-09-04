/**
 * What a server does when the document it is asked about turns out to be its own.
 */

import { DocStatus, DocWorkerInfo, IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import { getDocWorkerInfoOrSelfPrefix, getWorker } from "app/server/lib/DocWorkerUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import * as http from "http";
import { AddressInfo } from "net";

import { assert } from "chai";

describe("DocWorkerUtils", function() {
  let oldEnv: EnvironmentSnapshot;

  // Stands in for a server holding documents. Answers everything, and says what it was asked, so
  // that a request going out is told apart from one that did not.
  let server: http.Server;
  let asked: string[];
  let here: DocWorkerInfo;

  before(async function() {
    server = http.createServer((req, res) => {
      asked.push(req.url!);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    here = {
      id: "server-here",
      publicUrl: "http://server-here:8080",
      internalUrl: `http://127.0.0.1:${port}/`,
    };
  });

  after(async function() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(function() {
    asked = [];
    oldEnv = new EnvironmentSnapshot();
    for (const name of ["GRIST_SINGLE_PORT", "GRIST_SINGLE_USER", "GRIST_MANAGED_WORKERS"]) {
      delete process.env[name];
    }
  });

  afterEach(function() {
    oldEnv.restore();
  });

  // The list of servers holding documents, with one server on it.
  class OneServer {
    constructor(private _server: DocWorkerInfo) {}

    public async assignDocWorker(): Promise<DocStatus> {
      return { docMD5: "unknown", isActive: true, docWorker: this._server };
    }

    // Reached only where a request failed, which strikes the server that failed it off the list.
    // A server that did that to itself over its own document would leave the list empty.
    public async removeWorker(id: string) {
      throw new Error(`${id} was struck off the list of servers holding documents`);
    }
  }

  function servers(): IDocWorkerMap {
    return new OneServer(here) as unknown as IDocWorkerMap;
  }

  it("asks nobody about a document it has", async function() {
    const { resp, docStatus } = await getWorker(
      servers(), "someDoc", "/status", {}, { selfWorkerId: here.id });
    assert.isUndefined(resp);
    assert.equal(docStatus.docWorker.id, here.id);
    assert.isEmpty(asked, "a request went out for a document this server has");
  });

  it("still asks about a document another server has", async function() {
    // GRIST_SINGLE_PORT is set to what the docker image used to set, since it no longer decides
    // anything here.
    process.env.GRIST_SINGLE_PORT = "true";
    const { resp } = await getWorker(
      servers(), "someDoc", "/status", {}, { selfWorkerId: "another-server" });
    assert.isTrue(resp?.ok);
    assert.deepEqual(asked, ["/status"]);
  });

  it("names the server for a document it has, without asking it anything", async function() {
    const info = await getDocWorkerInfoOrSelfPrefix(
      "someDoc", servers(), "tag", { selfWorkerId: here.id });
    assert.equal(info.docWorker?.id, here.id);
    assert.isEmpty(asked, "a request went out for a document this server has");
  });

  it("asks nothing at all in single user mode", async function() {
    process.env.GRIST_SINGLE_USER = "1";
    const noServers = { assignDocWorker: () => { throw new Error("asked anyway"); } };
    const info = await getDocWorkerInfoOrSelfPrefix(
      "someDoc", noServers as unknown as IDocWorkerMap, "tag", { selfWorkerId: here.id });
    assert.isDefined(info.selfPrefix);
  });
});
