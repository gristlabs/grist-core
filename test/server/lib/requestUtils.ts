import {
  buildProxyRequestUrl,
  proxyHttpRequest,
  ProxyHttpRequestOptions,
  trustOrigin,
} from "app/server/lib/requestUtils";
import { serveSomething, Serving } from "test/server/customUtil";

import * as http from "http";
import { AddressInfo } from "net";

import axios from "axios";
import { assert } from "chai";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as express from "express";
import * as sinon from "sinon";

// The shared chai-as-promised registration isn't picked up here; repeat it locally so
// assert.isRejected works. (Matches the workaround in OpenAIAssistantV1.ts.)
chai.use(chaiAsPromised);

describe("requestUtils", function() {
  describe("trustOrigin", function() {
    const combinations = [
      ["http://localhost:8080", "localhost:9999", true],
      ["http://localhost:8080", "api.getgrist.com", false],
      ["https://docs.getgrist.com", "docs.getgrist.com", true],
      ["https://www.getgrist.com", "docs.getgrist.com", true],
      ["https://nytimes.com", "docs.getgrist.com", false],
      ["https://getgrist.com.co.uk", "docs.getgrist.com", false],
      ["https://efc-r.com", "docs.getgrist.com", false],
      ["https://efc-r.com", "nasa.getgrist.com", false],
      ["https://nasa.efc-r.com", "docs.getgrist.com", false],
      ["https://nasa.efc-r.com", "docs.efc-r.com", true],
      ["https://nasa.efc-r.com", "api.efc-r.com", true],
      ["null", "docs.getgrist.com", false],
      ["", "docs.getgrist.com", true],
    ];
    for (const [origin, host, permitted] of combinations) {
      it(`'${origin}' can${permitted ? "" : "not"} access '${host}' in browser`, function() {
        assert.equal(
          trustOrigin({ headers: { origin, host } } as any, { header: (a: string, b: string) => true } as any),
          permitted,
        );
      });
    }

    const apiErrorTestCases = [
      "invalid url",
    ];
    for (const origin of apiErrorTestCases) {
      it(`throws an ApiError on invalid origin '${origin}'`, function() {
        assert.throws(() => trustOrigin({ headers: { origin } } as any));
      });
    }
  });

  describe("buildProxyRequestUrl", function() {
    // Regression test for hostile/malicious URLs attempting to change the target of the proxy request
    // by exploiting new URL() semantics.
    const target = new URL("http://worker.example.com/basepath");

    const hostileInputs = [
      "/dw/x//evil.com/socket.io/?a=1",
      "//evil.com/foo",
      "/\\evil.com/foo",
      "http://evil.com/foo",
      "/dw/x/%2e%2e/evil.com/foo",
      "/dw/x/..//evil.com/foo",
    ];
    for (const input of hostileInputs) {
      it(`keeps hostile input '${input}' on the target origin`, function() {
        const parsed = new URL(buildProxyRequestUrl(target, input));
        assert.strictEqual(parsed.origin, target.origin);
      });
    }

    it("strips /dw and /v prefixes and preserves the query on a benign path", function() {
      const parsed = new URL(buildProxyRequestUrl(target, "/dw/id1/v/tag/foo?q=1"));
      assert.strictEqual(parsed.origin, target.origin);
      assert.strictEqual(parsed.pathname, "/basepath/foo");
      assert.strictEqual(parsed.search, "?q=1");
    });
  });

  describe("proxyHttpRequest", function() {
    // Spin up a front server whose only job is to invoke proxyHttpRequest against `target`.
    // The request path/query/method/body flow through unchanged.
    async function makeProxyServer(target: { url: string }, options: ProxyHttpRequestOptions = {}) {
      return serveSomething((app) => {
        app.use((req, res, next) => {
          proxyHttpRequest(req, res, new URL(req.url, target.url), options).catch(next);
        });
      });
    }

    describe("forwards request/response and applies header options", function() {
      let lastBackendRequest: any = null;
      let backend: Serving;
      let front: Serving;

      before(async function() {
        backend = await serveSomething((app) => {
          app.use(express.json());
          app.all("*", (req, res) => {
            lastBackendRequest = { method: req.method, headers: req.headers, body: req.body, url: req.url };
            res.status(201).set("X-Custom", "value").json({ ok: true });
          });
        });
        front = await makeProxyServer(backend, {
          forbidHeaders: ["origin"],
          proxyExtraHeaders: ["x-sort"],
          defaultHeaders: { "content-type": "application/json" },
        });
      });

      after(async function() {
        await front.shutdown();
        await backend.shutdown();
      });

      beforeEach(() => { lastBackendRequest = null; });

      it("forwards POST method, URL, body, status, and response headers/body", async function() {
        const r = await axios.post(`${front.url}/path?q=1`, { hello: "world" }, {
          validateStatus: () => true,
        });
        assert.equal(r.status, 201);
        assert.deepEqual(r.data, { ok: true });
        assert.equal(r.headers["x-custom"], "value");

        assert.equal(lastBackendRequest.method, "POST");
        assert.equal(lastBackendRequest.url, "/path?q=1");
        assert.deepEqual(lastBackendRequest.body, { hello: "world" });
      });

      it("strips headers in forbidHeaders, forwards proxyExtraHeaders, drops the rest", async function() {
        await axios.get(`${front.url}/path`, {
          headers: {
            "Origin": "https://evil.example",
            "X-Sort": "foo",
            "X-Random": "drop-me",
          },
          validateStatus: () => true,
        });
        assert.isUndefined(lastBackendRequest.headers.origin);
        assert.equal(lastBackendRequest.headers["x-sort"], "foo");
        assert.isUndefined(lastBackendRequest.headers["x-random"]);
      });

      it("applies defaultHeaders when the client did not set them", async function() {
        await axios.get(`${front.url}/path`, { validateStatus: () => true });
        assert.equal(lastBackendRequest.headers["content-type"], "application/json");
      });

      it("does not override client-set headers with defaultHeaders", async function() {
        await axios.get(`${front.url}/path`, {
          headers: { "Content-Type": "text/plain" },
          validateStatus: () => true,
        });
        assert.equal(lastBackendRequest.headers["content-type"], "text/plain");
      });
    });

    it("strips hop-by-hop headers in both directions", async function() {
      let observed: http.IncomingHttpHeaders | null = null;
      const backend = await serveSomething((app) => {
        app.all("*", (req, res) => {
          observed = req.headers;
          // Response-side stripping removes Connection and a dynamic hop-by-hop header, but keeps the others.
          res.set({
            "X-Kept": "yes",
            "X-Bad": "should-be-stripped",
            "Connection": "x-bad",
          });
          res.send("body");
        });
      });
      try {
        const front = await makeProxyServer(backend);
        try {
          const res = await axios.get(front.url, {
            headers: {
              // Node's http client rejects "Trailer" on a non-chunked request, so we can't include
              // it here.
              "Connection": "x-custom, keep-alive",
              "X-Custom": "should-be-stripped",
              // A static hop-by-hop header from RFC 7230 §6.1 — must not be forwarded.
              "Proxy-Authorization": "Bearer should-be-stripped",
            },
            validateStatus: () => true,
          });
          // Request side: the client's Connection header is dropped, and headers it named as
          // dynamic hop-by-hop are dropped too. (Node re-injects its own Connection/Keep-Alive
          // values on the outgoing request — those aren't the proxy's responsibility.)
          assert.isUndefined(observed!["x-custom"]);
          assert.isUndefined(observed!["proxy-authorization"]);

          // Response side: a header the backend named as dynamic hop-by-hop is dropped, while a
          // normal header passes through. (Node manages the response-side Connection header itself
          // for transport reasons, so we don't assert on it directly.)
          assert.isUndefined(res.headers["x-bad"]);
          assert.equal(res.headers["x-kept"], "yes");
        } finally {
          await front.shutdown();
        }
      } finally {
        await backend.shutdown();
      }
    });

    it("returns 502 Bad Gateway when the backend is unreachable", async function() {
      // Port 1 (tcpmux) effectively never has a listener on dev/CI hosts, so connect attempts
      // fail-fast with ECONNREFUSED.
      const front = await makeProxyServer({ url: "http://127.0.0.1:1" });
      try {
        const r = await axios.get(front.url, { validateStatus: () => true });
        assert.equal(r.status, 502);
        assert.equal(r.data, "Bad Gateway");
        assert.equal(r.headers["content-type"], "text/plain; charset=utf-8");
      } finally {
        await front.shutdown();
      }
    });

    it("returns 502 when the backend responds with 101 Switching Protocols", async function() {
      // Express won't help us emit a raw 101 to a non-upgrade request, so wire a tiny raw server
      // and write the status line directly to the socket.
      const backendHandler = sinon.spy((_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.socket!.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        res.socket!.end();
      });
      const server = http.createServer(backendHandler);
      await new Promise<void>(resolve => server.listen(0, "localhost", resolve));
      const port = (server.address() as AddressInfo).port;
      const stub = { url: `http://localhost:${port}` };

      try {
        const front = await makeProxyServer(stub);
        try {
          const r = await axios.get(front.url, { validateStatus: () => true });
          assert.equal(r.status, 502);
          assert.equal(r.data, "Bad Gateway");
          // Confirm the backend actually received the request — otherwise this 502 is
          // indistinguishable from the connection-refused case above.
          sinon.assert.calledOnce(backendHandler);
        } finally {
          await front.shutdown();
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close(err => err ? reject(err) : resolve()));
      }
    });

    it("rejects when the target protocol is invalid", async function() {
      // Stubs are enough — proxyHttpRequest rejects before touching the socket. We supply an
      // empty socket so buildXForwardedForHeader (called from getProxyHeaders) doesn't crash.
      const fakeReq = { headers: {}, socket: {} } as any;
      const fakeRes = {} as any;
      await assert.isRejected(
        proxyHttpRequest(fakeReq, fakeRes, "ftp://example.com"),
        /Unsupported proxy protocol/,
      );
    });

    it("propagates client aborts to the backend", async function() {
      let backendRequestReceived!: () => void;
      const promiseBackendReceived = new Promise<void>((r) => { backendRequestReceived = r; });
      const backendCloseSpy = sinon.spy();

      const backend = await serveSomething((app) => {
        app.all("*", (req, _res) => {
          req.on("close", backendCloseSpy);
          backendRequestReceived();
          // Hold the response open forever — the only way out is the client aborting.
        });
      });
      try {
        const front = await makeProxyServer(backend);
        try {
          const source = axios.CancelToken.source();
          const response = axios.get(front.url, { cancelToken: source.token });
          await promiseBackendReceived;
          source.cancel("canceled for testing");
          await assert.isRejected(response, /canceled for testing/);
          // The close event on the backend is observed asynchronously after the socket teardown.
          await new Promise(r => setTimeout(r, 50));
          sinon.assert.called(backendCloseSpy);
        } finally {
          await front.shutdown();
        }
      } finally {
        await backend.shutdown();
      }
    });
  });
});
