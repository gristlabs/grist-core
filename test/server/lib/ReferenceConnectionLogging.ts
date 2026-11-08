import { jsonErrorHandler } from "app/server/lib/expressWrap";
import log from "app/server/lib/log";
import { getLoggableRequestBody } from "app/server/lib/requestLogging";

import { assert } from "chai";
import { Request, Response } from "express";
import sinon from "sinon";

describe("Reference connection logging", function() {
  it("omits capability bodies from HTTP debug logs, including requests rejected before admission", () => {
    for (const path of ["/api/docs/doc/reference-connections", "/docs/doc/reference-connections/preview",
      "/api/docs/doc/REFERENCE-CONNECTIONS", "/docs/doc/ReFeReNcE-CoNnEcTiOnS/preview"]) {
      assert.isUndefined(getLoggableRequestBody({ path, body: { url: "private-capability" } }));
    }
    assert.deepEqual(getLoggableRequestBody({ path: "/docs/doc/tables", body: { table: "Products" } }),
      { table: "Products" });
    assert.isUndefined(getLoggableRequestBody({ path: "/unknown", body: { nested: {
      url: "https://example.org/#grist-reference=private-capability",
    } } }));
  });

  it("does not leak a capability through API error logs or malformed JSON diagnostics", () => {
    const logged = sinon.stub(log, "rawWarn");
    try {
      const responses: unknown[] = [];
      for (const path of ["/docs/doc/reference-connections/preview", "/docs/doc/REFERENCE-CONNECTIONS/preview",
        "/docs/doc/ReFeReNcE-CoNnEcTiOnS/preview"]) {
        const req = { path, body: { url: "private-capability" },
          params: { docId: "doc" } } as unknown as Request;
        const res = { status() { return this; }, json(body: unknown) { responses.push(body); } } as unknown as Response;
        jsonErrorHandler(Object.assign(new Error("Access denied"), { status: 403 }), req, res, () => {});
        jsonErrorHandler(Object.assign(new Error("Invalid JSON private-capability"),
          { type: "entity.parse.failed", status: 400 }), req, res, () => {});
        assert.notInclude(JSON.stringify(logged.args), "private-capability");
      }
      assert.deepEqual(JSON.parse(JSON.stringify(responses)),
        Array(3).fill([{ error: "Access denied" }, { error: "Invalid JSON payload" }]).flat());
    } finally { logged.restore(); }
  });
});
