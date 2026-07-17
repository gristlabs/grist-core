import { delay } from "app/common/delay";
import { DocApiProxy } from "app/gen-server/lib/DocApiProxy";
import { DocWorkerMap, getDocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { addRequestUser } from "app/server/lib/Authorizer";
import { jsonErrorHandler } from "app/server/lib/expressWrap";
import { createDummyGristServer } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

import { Server } from "http";
import { AddressInfo } from "net";

import axios, { AxiosResponse } from "axios";
import { fromCallback } from "bluebird";
import { assert } from "chai";
import express from "express";
import morganLogger from "morgan";
import sinon from "sinon";

const chimpy = configForUser("Chimpy");
const kiwi = configForUser("kiwi");

const logToConsole = false;

async function createServer(app: express.Application, name: string) {
  let server: Server;
  if (logToConsole) {
    app.use(morganLogger((...args: any[]) => {
      return `${log.timestamp()} ${name} ${morganLogger.dev(...args)}`;
    }));
  }
  app.set("port", 0);
  await fromCallback((cb: any) => server = app.listen(app.get("port"), "localhost", cb));
  log.info(`${name} listening ${getUrl(server!)}`);
  return server!;
}

function getUrl(server: Server) {
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

// TODO - Update DocApiProxy tests to cover new proxy functionality, and ensure no forwarding to local doc worker.
describe("DocApiProxy", function() {
  testUtils.setTmpLogLevel("error");

  let homeServer: Server;
  let docWorker: Server;
  let resp: AxiosResponse;
  let homeUrl: string;
  let dbManager: HomeDBManager;
  const docWorkerStub = sinon.stub();
  // The proxy compares its own worker id (returned by this callback) against the worker id from
  // the doc worker map; tests can flip this to make DocApiProxy think the document is local, and trigger
  // the fallthrough branch.
  let ownWorkerId: string | null = null;
  // Sentinel handler registered after the proxy: only runs when the proxy hands off via next(),
  // which is the non-proxied path due to a doc being local.
  const notProxiedSpy = sinon.spy(
    (_req: express.Request, res: express.Response) => { res.status(200).json("local"); });

  before(async function() {
    setUpDB(this);
    dbManager = new HomeDBManager();
    await dbManager.connect();
    await createInitialDb(dbManager.connection);
    await dbManager.initializeSpecialIds();

    // create cheap doc worker
    let app = express();
    docWorker = await createServer(app, "docw");
    app.use(express.json());
    app.use(docWorkerStub);

    // create cheap home server
    app = express();
    homeServer = await createServer(app, "home");
    homeUrl = getUrl(homeServer);

    // Production has morgan here; its writeHead wrapper returns undefined, which the abort test needs.
    app.use(morganLogger("tiny", { stream: { write: () => true } }));

    // stubs doc worker map
    const docWorkerMapStub = sinon.createStubInstance(DocWorkerMap);
    docWorkerMapStub.assignDocWorker.returns(Promise.resolve({
      docWorker: {
        internalUrl: getUrl(docWorker) + "/dw/foo",
        publicUrl: "",
        id: "docWorker1",
      },
      docMD5: null,
      isActive: true,
    }));

    // create and register proxy
    const docApiProxy = new DocApiProxy(
      docWorkerMapStub, dbManager, { getOAuthValidator() {} } as any, () => ownWorkerId,
    );
    app.use("/api", addRequestUser.bind(null, dbManager, getDocWorkerMap().getPermitStore("internal"),
      { gristServer: createDummyGristServer() } as any));
    docApiProxy.addEndpoints(app);
    app.use("/api/docs", notProxiedSpy);
    app.use("/api", jsonErrorHandler);
  });

  after(async function() {
    await removeConnection();
    homeServer.close();
    docWorker.close();
    dbManager.flushDocAuthCache();    // To avoid hanging up exit from tests.
  });

  beforeEach(() => {
    docWorkerStub.resetHistory();
    docWorkerStub.callsFake((req: any, res: any) => res.status(200).json("mango tree"));
    notProxiedSpy.resetHistory();
  });

  afterEach(() => {
    // Reset between tests so a forgotten override can't leak into the next case.
    ownWorkerId = null;
  });

  it("should forward GET /api/docs/:did/tables/:tid/data", async function() {
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, "mango tree");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/tables/table1/data");
    assert.equal(req.method, "GET");
  });

  it("should forward GET /api/docs/:did/tables/:tid/data?filter=<...>", async function() {
    const filter = encodeURIComponent(JSON.stringify({ FOO: ["bar"] })); // => %7B%22FOO%22%3A%5B%22bar%22%5D%7D
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data?filter=${filter}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, "mango tree");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl,
      "/dw/foo/api/docs/sampledocid_16/tables/table1/data?filter=%7B%22FOO%22%3A%5B%22bar%22%5D%7D");
    assert.equal(req.method, "GET");
  });

  it("should deny user without view permissions", async function() {
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_13/tables/table1/data`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, { error: "No view access" });
    assert.equal(docWorkerStub.callCount, 0);
  });

  it("should forward POST /api/docs/:did/tables/:tid/data", async function() {
    resp = await axios.post(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, { message: "golden pears" }, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, "mango tree");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/tables/table1/data");
    assert.equal(req.method, "POST");
    assert.deepEqual(req.body, { message: "golden pears" });
  });

  it("should forward PATCH /api/docs/:did/tables/:tid/data", async function() {
    resp = await axios.patch(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`,
      { message: "golden pears" }, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, "mango tree");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/tables/table1/data");
    assert.equal(req.method, "PATCH");
    assert.deepEqual(req.body, { message: "golden pears" });
  });

  it("should forward POST /api/docs/:did/attachments", async function() {
    const formData = new FormData();
    formData.append("upload", new File(["abcdef"], "hello.png"));
    resp = await axios.post(`${homeUrl}/api/docs/sampledocid_16/attachments`, formData, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.headers["content-type"], "application/json; charset=utf-8");
    assert.deepEqual(resp.data, "mango tree");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.match(req.get("Content-Type"), /^multipart\/form-data; boundary=/);
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/attachments");
    assert.equal(req.method, "POST");
  });

  it("should forward GET /api/docs/:did/attachments/:attId/download", async function() {
    docWorkerStub.callsFake((_req: any, res: any) =>
      res.status(200)
        .type(".png")
        .set("Content-Disposition", 'attachment; filename="hello.png"')
        .set("Cache-Control", "private, max-age=3600")
        .send(Buffer.from("abcdef")));
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/attachments/123/download`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.headers["content-type"], "image/png");
    assert.deepEqual(resp.headers["content-disposition"], 'attachment; filename="hello.png"');
    assert.deepEqual(resp.headers["cache-control"], "private, max-age=3600");
    assert.deepEqual(resp.data, "abcdef");
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/attachments/123/download");
    assert.equal(req.method, "GET");
  });

  it("should forward error message on failure", async function() {
    docWorkerStub.callsFake((_req: any, res: any) => res.status(500).send({ error: "internal error" }));
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
    assert.equal(resp.status, 500);
    assert.deepEqual(resp.data, { error: "internal error" });
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get("Authorization"), "Bearer api_key_for_chimpy");
    assert.equal(req.get("Content-Type"), "application/json");
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/tables/table1/data");
    assert.equal(req.method, "GET");
  });

  it("should strip forbidden headers and forward allowlisted ones", async function() {
    const homeServerUrl = new URL(homeUrl);
    resp = await axios.get(`${homeServerUrl.href}api/docs/sampledocid_16/tables/table1/data`, {
      ...chimpy,
      headers: {
        ...chimpy.headers,
        "Origin": "https://front.example.com",
        "X-Sort": "foo",
        "X-Limit": "10",
        "X-Should-Be-Dropped": "ShouldNotExist",
      },
    });
    assert.equal(resp.status, 200);
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    // Ensure Origin reaches the DocWorker so that the correct response can be created
    assert.equal(req.get("origin"), "https://front.example.com");
    // Ensure Host reaches the DocWorker so it can be compared with Origin,
    // and return the correct response to untrusted clients.
    assert.equal(req.get("host"), homeServerUrl.host);
    // Allowlisted extras come through.
    assert.equal(req.get("x-sort"), "foo");
    assert.equal(req.get("x-limit"), "10");
    // Headers not in the allowlist or default copy are dropped.
    assert.isUndefined(req.get("x-should-be-dropped"));
    // Default content-type is applied when the client didn't set one.
    assert.equal(req.get("content-type"), "application/json");
  });

  it("should notice aborted requests and cancel forwarded ones", async function() {
    let requestReceived: Function;
    let closeReceived: Function;
    let requestDone: Function;
    const checkIsClosed = sinon.spy();
    const promiseForRequestReceived = new Promise((r) => { requestReceived = r; });
    const promiseForCloseReceived = new Promise((r) => { closeReceived = r; });
    const promiseForRequestDone = new Promise((r) => { requestDone = r; });
    docWorkerStub.callsFake(async (req: any, res: any) => {
      req.on("close", closeReceived);
      requestReceived();
      await Promise.race([promiseForCloseReceived, delay(100)]);
      checkIsClosed(req.closed || req.aborted);
      res.status(200).json("fig tree?");
      requestDone();
    });
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    const response = axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`,
      { ...chimpy, cancelToken: source.token });
    await promiseForRequestReceived;
    source.cancel("canceled for testing");
    await assert.isRejected(response, /canceled for testing/);
    await promiseForRequestDone;
    sinon.assert.calledOnce(checkIsClosed);
    assert.deepEqual(checkIsClosed.args, [[true]]);
  });

  it("survives a client aborting before the doc worker responds", async function() {
    // Regression for a crash-loop: aborting before the worker responded made proxyHttpRequest's
    // teardown do writeHead(...).end(...) on a morgan-wrapped response whose writeHead returns
    // undefined -> TypeError in a 'close' handler -> uncaughtException killed the home process.
    let forwarded = () => {};
    const promiseForwarded = new Promise<void>((r) => { forwarded = r; });
    docWorkerStub.callsFake(() => forwarded());   // hold the request open

    const source = axios.CancelToken.source();
    const aborted = axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`,
      { ...chimpy, cancelToken: source.token });
    await promiseForwarded;
    source.cancel("canceled for testing");
    await assert.isRejected(aborted, /canceled for testing/);
    // If settle() crashes on the 'close' event, the uncaughtException fails this test.
    await delay(50);
  });

  it("should forward POST /api/docs/:did/uploads", async function() {
    const formData = new FormData();
    formData.append("upload", new File(["foobar"], "hello.csv"));
    resp = await axios.post(`${homeUrl}/api/docs/sampledocid_16/uploads`, formData, chimpy);
    assert.equal(resp.status, 200);
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.match(req.get("Content-Type"), /^multipart\/form-data; boundary=/);
    assert.equal(req.originalUrl, "/dw/foo/api/docs/sampledocid_16/uploads");
    assert.equal(req.method, "POST");
  });

  describe("when the doc is assigned to this worker", function() {
    beforeEach(() => { ownWorkerId = "docWorker1"; });

    it("does not forward and lets the next handler run", async function() {
      resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
      assert.equal(resp.status, 200);
      assert.equal(resp.data, "local");
      assert.equal(docWorkerStub.callCount, 0);
      sinon.assert.calledOnce(notProxiedSpy);
    });
  });

  describe("response header passthrough", function() {
    // The proxy switched from a 3-header allowlist to forwarding every response header from
    // the doc worker. These tests pin the behaviors that switch enabled — CORS, set-cookie,
    // and cross-origin form submission — so future header handling changes stay honest.

    it("forwards CORS response headers from the doc worker intact", async function() {
      // Verifies that access-control-* headers survive the proxy on both a preflight-shaped
      // request and a follow-up credentialed request. We authenticate both (chimpy) because
      // the test harness's middleware requires auth for /api/docs; the shape of the request
      // is what matters for this test, not the browser's actual unauthenticated preflight.
      docWorkerStub.callsFake((req: any, res: any) => {
        if (req.method === "OPTIONS") {
          res.status(204)
            .set("Access-Control-Allow-Origin", "https://front.example.com")
            .set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
            .set("Access-Control-Allow-Headers", "authorization, content-type, x-sort")
            .set("Access-Control-Allow-Credentials", "true")
            .set("Access-Control-Max-Age", "600")
            .end();
        } else {
          res.status(200)
            .set("Access-Control-Allow-Origin", "https://front.example.com")
            .set("Access-Control-Allow-Credentials", "true")
            .json("mango tree");
        }
      });

      const url = `${homeUrl}/api/docs/sampledocid_16/tables/table1/data`;
      const preflight = await axios.request({
        url, method: "OPTIONS",
        headers: {
          ...chimpy.headers,
          "Origin": "https://front.example.com",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers["access-control-allow-origin"], "https://front.example.com");
      assert.equal(preflight.headers["access-control-allow-methods"], "GET, POST, PATCH, OPTIONS");
      assert.equal(preflight.headers["access-control-allow-headers"], "authorization, content-type, x-sort");
      assert.equal(preflight.headers["access-control-allow-credentials"], "true");
      assert.equal(preflight.headers["access-control-max-age"], "600");

      const credentialed = await axios.get(url, {
        ...chimpy,
        headers: { ...chimpy.headers, Origin: "https://front.example.com" },
      });
      assert.equal(credentialed.status, 200);
      assert.equal(credentialed.headers["access-control-allow-origin"], "https://front.example.com");
      assert.equal(credentialed.headers["access-control-allow-credentials"], "true");
      assert.deepEqual(credentialed.data, "mango tree");
    });

    it("forwards multi-value set-cookie headers to the client", async function() {
      // set-cookie is a multi-value HTTP header — bad header copies that collapse it into a single header are easy
      // to do. This prevents that regression.
      docWorkerStub.callsFake((_req: any, res: any) => {
        res.status(200)
          .set("Set-Cookie", ["session=abc123; Path=/; HttpOnly", "csrf=xyz789; Path=/"])
          .json("cookies-set");
      });
      const resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
      assert.equal(resp.status, 200);
      const setCookie = resp.headers["set-cookie"];
      assert.isArray(setCookie, "set-cookie should be preserved as separate values");
      assert.lengthOf(setCookie!, 2);
      assert.include(setCookie!, "session=abc123; Path=/; HttpOnly");
      assert.include(setCookie!, "csrf=xyz789; Path=/");
    });
  });
});
