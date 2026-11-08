import { ReferenceAuditEvent } from "app/gen-server/entity/ReferenceAuditEvent";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { ReferenceSubscription } from "app/gen-server/entity/ReferenceSubscription";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { GristServer } from "app/server/lib/GristServer";
import { ReferenceTableService } from "app/server/lib/ReferenceTableService";

import { assert } from "chai";
import express, { RequestHandler, Response } from "express";
import sinon from "sinon";
import { DataSource } from "typeorm";

describe("Reference audit transaction", function() {
  it("rolls back a real revocation endpoint when audit persistence fails, then retries atomically", async () => {
    const db = await new DataSource({ type: "sqlite", database: ":memory:", synchronize: true,
      entities: [ReferencePublication, ReferenceSubscription, ReferenceAuditEvent] }).initialize();
    await db.query("CREATE TABLE reference_registry_lock (id INTEGER PRIMARY KEY)");
    await db.query("INSERT INTO reference_registry_lock VALUES (1)");
    await db.manager.save(ReferencePublication, { id: "pub", sourceDocId: "source", sourceOrgId: 1,
      spec: { name: "Test", tables: [] }, identities: {}, columnEpochs: {}, generation: "g" });
    await db.manager.save(ReferenceSubscription, { id: "sub", publicationId: "pub", destinationDocId: "dest",
      destinationOrgId: 2, aliases: {}, status: "UP_TO_DATE", connectedAt: new Date().toISOString() });
    const service = new ReferenceTableService({ getHomeDBManager: () => ({ connection: db }) } as GristServer);
    const doc = { docName: "source", logAuditEvent() {}, docStorage: { all: async () => [] },
      withReferenceOperation: (fn: () => unknown) => fn(), withReferenceRead: (fn: () => unknown) => fn() } as
      unknown as ActiveDoc;
    const previousFlag = process.env.GRIST_REFERENCE_TABLES;
    process.env.GRIST_REFERENCE_TABLES = "true";
    const start = sinon.stub(service, "start");
    try {
      const app = express();
      service.addEndpoints(app, {
        withDoc: handler => (req, res) => handler(doc, req as RequestWithLogin, res),
        ownerRead: (_req, _res, next) => next(), ownerWrite: (_req, _res, next) => next(),
        canView: (_req, _res, next) => next(),
      });
      const routePath = "/api/docs/:docId/reference-publications/:id/grants/:grantId";
      const stack = (app as unknown as { _router: { stack: {
        route?: { path: string; methods: { delete?: boolean }; stack: { handle: RequestHandler }[] };
      }[] } })._router.stack;
      const route = stack.find(layer => layer.route?.path === routePath && layer.route.methods.delete)!.route!;
      const handler = route.stack[route.stack.length - 1].handle;
      const req = { params: { id: "pub", grantId: "sub" }, route: { path: routePath }, userId: 1 } as
        unknown as RequestWithLogin;
      const res = { json: sinon.spy() } as unknown as Response;
      await db.query("CREATE TRIGGER fail_audit BEFORE INSERT ON reference_audit_events " +
        "BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END");
      await assert.isRejected(Promise.resolve(handler(req, res, () => {})), /audit unavailable/);
      assert.isFalse((await db.manager.findOneByOrFail(ReferenceSubscription, { id: "sub" })).revoked);
      assert.equal(await db.manager.count(ReferenceAuditEvent), 0);
      await db.query("DROP TRIGGER fail_audit");
      await Promise.resolve(handler(req, res, () => {}));
      assert.isTrue((await db.manager.findOneByOrFail(ReferenceSubscription, { id: "sub" })).revoked);
      const events = await db.manager.find(ReferenceAuditEvent);
      assert.sameMembers(events.map(e => e.documentId), ["source", "dest"]);
      assert.isTrue(events.every(e => e.operation === "subscription.revoke"));
    } finally {
      if (previousFlag === undefined) { delete process.env.GRIST_REFERENCE_TABLES; } else {
        process.env.GRIST_REFERENCE_TABLES = previousFlag;
      }
      start.restore();
      await db.destroy();
    }
  });
});
