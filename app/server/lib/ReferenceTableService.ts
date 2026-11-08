import { ApiError } from "app/common/ApiError";
import { isAffirmative } from "app/common/gutil";
import { compareReferenceContracts } from "app/common/ReferenceManagement";
import { describeReferenceUpdate, referenceSyncDue, ReferenceUpdatePreview } from "app/common/ReferenceSynchronization";
import { ReferenceLinkOptions, ReferencePreview } from "app/common/ReferenceTableAPI";
import {
  applyReferenceTransfer, reconcileReferenceSnapshot, ReferenceMirrorState,
  ReferencePublicationSpec, ReferenceSnapshot, ReferenceTransfer, validateReferenceSpec,
} from "app/common/ReferenceTables";
import { ReferenceAuditEvent } from "app/gen-server/entity/ReferenceAuditEvent";
import { ReferenceConnectionLink } from "app/gen-server/entity/ReferenceConnectionLink";
import { ReferencePublication } from "app/gen-server/entity/ReferencePublication";
import { ReferenceSubscription } from "app/gen-server/entity/ReferenceSubscription";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { WithDocHandler } from "app/server/lib/DocApiUtils";
import { docSessionFromRequest, OptDocSession } from "app/server/lib/DocSession";
import { GristServer } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import { referenceAuditState, ReferenceAuditState } from "app/server/lib/ReferenceAudit";
import { flushReferenceAudit, signReferenceAudit } from "app/server/lib/ReferenceAuditOutbox";
import {
  getReferenceState, initializeReferenceRevision, referenceCommit,
} from "app/server/lib/ReferenceDocState";
import { assertReferenceSize, REFERENCE_MAX_BYTES, ReferenceWorkLimiter } from "app/server/lib/ReferenceLimits";
import { ReferencePreviewCache } from "app/server/lib/ReferencePreviewCache";
import { readReferenceProjection } from "app/server/lib/ReferenceProjection";
import { withReferenceRegistry } from "app/server/lib/ReferenceRegistry";
import { ReferenceRetryState } from "app/server/lib/ReferenceRetryState";
import { assembleReferenceSnapshot, readReferenceSnapshotPage, REFERENCE_PAGE_CHARS,
  ReferenceSnapshotManifest, stageReferenceSnapshot,
  validateReferenceManifest } from "app/server/lib/ReferenceSnapshotPages";
import { makeReferenceSession } from "app/server/lib/ReferenceTableAccess";

import { AsyncLocalStorage } from "async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";

import { Mutex } from "async-mutex";
import { Application, RequestHandler } from "express";
import isEqual from "lodash/isEqual";
import fetch from "node-fetch";
import { EntityManager, In } from "typeorm";
const services = new WeakMap<GristServer, ReferenceTableService>();
export function getReferenceTableService(server: GristServer): ReferenceTableService {
  let service = services.get(server);
  if (!service) {
    service = new ReferenceTableService(server);
    services.set(server, service);
  }
  return service;
}
interface SavedMirror {
  docId: string;
  sourceOrgId: number;
  destinationOrgId: number;
  state: ReferenceMirrorState;
  contractVersion?: number;
}
interface PendingReferenceUpdate {
  token: string;
  expiresAt: string;
  snapshot: ReferenceSnapshot;
  contractVersion: number;
  authorizationVersion: number;
  baseRevision: number;
  localActionNum: number;
  schema: boolean;
}
/** Server-side coordinator. Every document operation is routed to its assigned worker. */
export class ReferenceTableService {
  private _request = new AsyncLocalStorage<RequestWithLogin>();
  private _requests = new ReferenceWorkLimiter(8, 4);
  private _transfers = new ReferenceWorkLimiter(4);
  private _sources = new ReferenceWorkLimiter(4);
  private _retry = new ReferenceRetryState();
  private _reviews = new ReferencePreviewCache<PendingReferenceUpdate>();
  private _locks = new Map<string, Mutex>();
  private _running = false;
  private _pendingSources = new Set<string>();
  private _pollAll = false;
  private _started = false;
  private _timer?: NodeJS.Timeout;
  private _unsubscribe?: () => void;
  constructor(private _server: GristServer) {}
  private get _db() { return this._server.getHomeDBManager(); }
  private get _publications() { return this._db.connection.getRepository(ReferencePublication); }
  private get _links() { return this._db.connection.getRepository(ReferenceConnectionLink); }
  private get _subscriptions() { return this._db.connection.getRepository(ReferenceSubscription); }
  public start(): void {
    if (this._started || !isAffirmative(process.env.GRIST_REFERENCE_TABLES)) { return; }
    this._started = true;
    this._unsubscribe = this._server.getPubSubManager().subscribe("reference-tables-changed", (docId) => {
      this._schedule(docId);
    }).unsubscribeCB;
    this._timer = setInterval(() => { this._reviews.prune(); this._schedule(); }, 15_000);
    this._timer.unref();
  }

  public close(): void {
    clearInterval(this._timer);
    this._unsubscribe?.();
    this._started = false;
    this._retry.clear();
    this._reviews.clear();
  }

  public addEndpoints(app: Application, middleware: {
    withDoc: (handler: WithDocHandler) => RequestHandler;
    ownerRead: RequestHandler; ownerWrite: RequestHandler; canView: RequestHandler;
  }): void {
    const { withDoc, ownerRead, ownerWrite, canView } = middleware;
    const route = (handler: WithDocHandler) => withDoc(async (doc, req, res) => {
      if (!isAffirmative(process.env.GRIST_REFERENCE_TABLES)) {
        throw new ApiError("Reference tables are disabled", 404);
      }
      const run = () => this._request.run(req, () => doc.withReferenceOperation(async () => {
        await this._flushAudit(doc);
        return handler(doc, req, res);
      }));
      if (!req.route.path.includes("reference-internal")) {
        await this._requests.run(randomUUID(), run, String(req.userId));
      } else if (!req.route.path.includes("/synchronize/")) {
        await this._sources.run(randomUUID(), run);
      } else { await run(); }
    });
    const base = "/api/docs/:docId";
    app.get(`${base}/reference-status`, canView, route(async (doc, req, res) => {
      const metadata = await doc.fetchMetaTables(docSessionFromRequest(req));
      const visible = new Set(metadata._grist_Tables[3].referenceSource || []);
      const subscriptions = await this._subscriptions.findBy({ destinationDocId: doc.docName });
      res.json(subscriptions.filter(s => visible.has(s.id)).map(s => ({
        id: s.id, status: s.status, appliedAt: s.appliedAt,
      })));
    }));
    app.get(`${base}/reference-publications`, ownerRead, route(async (doc, req, res) => {
      res.json(await this._publications.find({ where: { sourceDocId: doc.docName } }));
    }));
    app.post(`${base}/reference-publications`, ownerWrite, route(async (doc, req, res) => {
      const pub = await this._lock(doc.docName, () => this.createPublication(doc, req.body));
      res.json(pub);
    }));
    app.patch(`${base}/reference-publications/:id`, ownerWrite, route(async (doc, req, res) => {
      await this._lock(doc.docName, async () => {
        const pub = await this._ownPublication(doc, req.params.id);
        if (req.body.spec !== undefined) {
          try { validateReferenceSpec(req.body.spec); } catch { throw new ApiError("Invalid specification", 400); }
          this._checkContractVersion(req.body.contractVersion, pub);
          const next: ReferencePublicationSpec = req.body.spec;
          if (next.tables.length !== pub.spec.tables.length ||
            pub.spec.tables.some(t => !next.tables.some(n => n.tableRef === t.tableRef))) {
            throw new ApiError("Use a new publication to change the set of published tables", 409);
          }
          const epochs = await getReferenceState<Record<string, string>>(doc.docStorage, "columnEpochs") || {};
          for (const id of next.tables.flatMap(t => [...t.colRefs, ...t.filters.map(f => f.colRef)])) {
            if (!(String(id) in pub.columnEpochs)) { pub.columnEpochs[String(id)] = epochs[String(id)] || ""; }
          }
          if (!isEqual(pub.spec.tables, next.tables)) { pub.contractVersion++; }
          pub.spec = next;
        }
        if (req.body.paused !== undefined) {
          if (typeof req.body.paused !== "boolean") { throw new ApiError("Expected paused boolean", 400); }
          pub.paused = req.body.paused;
        }
        // A schema error must not publish an invalid contract. Reads take the document queue lock.
        await doc.withReferenceRead(() => readReferenceProjection(doc, pub));
        let before: ReferenceAuditState;
        await this._registryTransaction(async (manager) => {
          // Another edit must not replace the contract after the caller reviewed it.
          const current = await manager.findOneByOrFail(ReferencePublication, { id: pub.id });
          if (req.body.spec !== undefined) { this._checkContractVersion(req.body.contractVersion, current); }
          before = referenceAuditState(current);
          // A concurrent pause must not overwrite a newer specification (or vice versa).
          if (req.body.spec !== undefined) {
            current.spec = pub.spec;
            current.columnEpochs = pub.columnEpochs;
            current.contractVersion = pub.contractVersion;
          }
          if (req.body.paused !== undefined) { current.paused = pub.paused; }
          Object.assign(pub, await manager.save(current));
          await this._audit(doc, req, "publication.update", before!, referenceAuditState(pub), manager);
        });
        doc.notifyReferenceChanges();
        res.json(pub);
      });
    }));
    app.get(`${base}/reference-publications/:id/grants`, ownerRead, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      res.json(await this._subscriptions.findBy({ publicationId: pub.id }));
    }));
    app.post(`${base}/reference-publications/:id/grants`, ownerWrite, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const destId = req.body.destinationDocId;
      if (typeof destId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(destId)) {
        throw new ApiError("Invalid destination", 400);
      }
      const dest = await this._rawDoc(destId);
      const sub = await this._registryTransaction(async (manager) => {
        if (await manager.findOneBy(ReferenceSubscription, { publicationId: pub.id, destinationDocId: dest.id })) {
          throw new ApiError("An authorization already exists; use reauthorization after revocation", 409);
        }
        await this._checkSubscriptionLimit(manager, pub.id, dest.id);
        const created = await manager.save(manager.create(ReferenceSubscription, {
          id: randomUUID(), publicationId: pub.id, destinationDocId: dest.id,
          destinationOrgId: dest.workspace.org.id, aliases: {}, status: "AUTHORIZED", revoked: false,
          appliedAt: "", error: "",
        }));
        await this._audit(doc, req, "subscription.authorize", undefined, referenceAuditState(created), manager);
        return created;
      });
      res.json({ id: sub.id, destinationDocId: sub.destinationDocId });
    }));
    app.delete(`${base}/reference-publications/:id/grants/:grantId`, ownerWrite, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const sub = await this._subscriptions.findOneBy({ id: req.params.grantId, publicationId: pub.id });
      if (!sub) { throw new ApiError("Authorization not found", 404); }
      let before: ReferenceAuditState;
      await this._registryTransaction(async (manager) => {
        const current = await manager.findOneByOrFail(ReferenceSubscription, { id: sub.id });
        before = referenceAuditState(current);
        current.revoked = true;
        if (current.status !== "DETACHED") { current.status = "ACCESS_REVOKED"; }
        current.error = "";
        current.authorizationVersion++;
        await manager.save(current);
        await this._audit(doc, req, "subscription.revoke", before!, referenceAuditState(current), manager);
        return current;
      });

      res.json({ id: sub.id, status: "ACCESS_REVOKED" });
    }));
    app.get(`${base}/reference-publications/:id/connection-links`, ownerRead, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      res.json(await this._links.find({ where: { publicationId: pub.id }, order: { createdAt: "ASC", id: "ASC" } }));
    }));
    app.post(`${base}/reference-publications/:id/connection-links`, ownerWrite, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const { name, expiresAt, allowedOrgIds, maxAdmissions } = this._linkOptions(req.body);
      const secret = randomBytes(32).toString("hex");
      const link = this._links.create({ id: randomUUID(), publicationId: pub.id, name: name.trim(),
        secretHash: createHash("sha256").update(secret).digest("hex"), createdAt: new Date().toISOString(),
        createdBy: req.userId!, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
        allowedOrgIds: [...new Set<number>(allowedOrgIds)], maxAdmissions, admissions: 0, disabled: false });
      await this._registryTransaction(async (manager) => {
        if (await manager.countBy(ReferenceConnectionLink, { publicationId: pub.id }) >= 100) {
          throw new ApiError("REFERENCE_LINK_LIMIT", 413);
        }
        await manager.save(link);
        await this._audit(doc, req, "link.create", undefined, referenceAuditState(link), manager);
      });
      const url = this._connectionHomeUrl();
      url.hash = `grist-reference=${link.id}.${secret}`;
      // Never serialize the hash, including in the response that returns the secret once.
      const publicLink = await this._links.findOneByOrFail({ id: link.id });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...publicLink, url: url.href });
    }));
    app.patch(`${base}/reference-publications/:id/connection-links/:linkId`, ownerWrite,
      route(async (doc, req, res) => {
        const pub = await this._ownPublication(doc, req.params.id);

        let before: ReferenceAuditState;
        const disabled = await this._registryTransaction(async (manager) => {
          const link = await manager.findOneBy(ReferenceConnectionLink,
            { id: req.params.linkId, publicationId: pub.id });
          if (!link) { throw new ApiError("Connection link not found", 404); }
          before = referenceAuditState(link);
          if (req.body.disabled === true) {
            link.disabled = true;
          } else {
            if (req.body.disabled !== undefined || link.disabled) {
              throw new ApiError("Disabled links cannot be reactivated; create a new link", 409);
            }
            if (req.body.settingsVersion !== link.settingsVersion) {
              throw new ApiError("Link settings changed; reopen the editor", 409);
            }
            Object.assign(link, this._linkOptions(req.body, link.expiresAt));
          }
          link.settingsVersion++;
          await manager.save(link);
          await this._audit(doc, req, req.body.disabled ? "link.disable" : "link.update", before!,
            referenceAuditState(link), manager);
          return link;
        });

        res.json(disabled);
      }));
    app.get(`${base}/reference-publications/:id/revoke-preview`, ownerRead, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const { preview } = await this._registryTransaction(manager =>
        this._revocationTargets(manager, pub.id, req.query.linkId));
      res.json(preview);
    }));
    app.post(`${base}/reference-publications/:id/revoke-consumers`, ownerWrite, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const events = await this._registryTransaction(async (manager) => {
        const { preview, subscriptions, links } = await this._revocationTargets(manager, pub.id, req.body.linkId);
        if (typeof req.body.token !== "string" || req.body.token !== preview.token) {
          throw new ApiError("Consumers changed; review the revocation again", 409);
        }
        const changes: { before: ReferenceAuditState; after: ReferenceAuditState }[] = [];
        for (const sub of subscriptions) {
          const before = referenceAuditState(sub);
          sub.revoked = true;
          sub.status = "ACCESS_REVOKED";
          sub.error = "";
          sub.authorizationVersion++;
          await manager.save(sub);
          changes.push({ before, after: referenceAuditState(sub) });
        }
        for (const link of links.filter(l => !l.disabled)) {
          const before = referenceAuditState(link);
          link.disabled = true;
          link.settingsVersion++;
          await manager.save(link);
          changes.push({ before, after: referenceAuditState(link) });
        }
        for (const change of changes) {
          await this._audit(doc, req, "publication.bulk_revoke", change.before, change.after, manager);
        }
        return { count: subscriptions.length };
      });
      res.json({ revoked: events.count });
    }));
    app.get(`${base}/reference-publications/:id/consumers`, ownerRead, route(async (doc, req, res) => {
      const pub = await this._ownPublication(doc, req.params.id);
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      if (!Number.isSafeInteger(offset) || offset < 0) { throw new ApiError("Invalid offset", 400); }
      const [subscriptions, total] = await this._subscriptions.findAndCount({ where: { publicationId: pub.id },
        order: { connectedAt: "ASC", id: "ASC" }, skip: offset, take: 50 });
      const consumers = await Promise.all(subscriptions.map(async (sub) => {
        // Registry metadata does not grant access to destination contents or its user directory.
        const dest = sub.connectedAt && !sub.revoked && sub.status !== "DETACHED" ?
          await this._db.getRawDocById(sub.destinationDocId).catch((e) => {
            if (e.status === 404) { return undefined; }
            throw e;
          }) : undefined;
        return { ...sub, contractVersion: pub.contractVersion,
          destinationName: dest?.name || sub.destinationDocId,
          destinationOrgName: dest?.workspace.org.name || "" };
      }));
      res.json({ consumers, total });
    }));
    app.patch(`${base}/reference-publications/:id/consumers/:subscriptionId`, ownerWrite,
      route(async (doc, req, res) => {
        const pub = await this._ownPublication(doc, req.params.id);
        const { sub } = await this._setSubscriptionPause(
          { id: req.params.subscriptionId, publicationId: pub.id },
          "sourcePaused", req.body.paused, doc, req);
        this._retry.reset(sub.id);
        doc.notifyReferenceChanges();
        res.json(sub);
      }));
    app.post(`${base}/reference-publications/:id/consumers/:subscriptionId/reauthorize`, ownerWrite,
      route(async (doc, req, res) => {
        const pub = await this._ownPublication(doc, req.params.id);
        let before: ReferenceAuditState;
        const sub = await this._registryTransaction(async (manager) => {
          const current = await manager.findOneBy(ReferenceSubscription,
            { id: req.params.subscriptionId, publicationId: pub.id });
          if (!current || !current.revoked || current.status === "DETACHED") {
            throw new ApiError("Only a revoked, attached consumer can be reauthorized", 409);
          }
          before = referenceAuditState(current);
          current.revoked = false;
          current.status = "AUTHORIZED";
          current.error = "";
          current.authorizationVersion++;
          await manager.save(current);
          await this._audit(doc, req, "subscription.reauthorize", before!, referenceAuditState(current), manager);
          return current;
        });

        // No scheduling: the destination owner must explicitly accept before any new data is copied.
        res.json(sub);
      }));
    app.post(`${base}/reference-connections/preview`, ownerWrite, route(async (doc, req, res) => {
      const { pub } = await this._validateConnectionLink(doc, req.body.url, this._db.connection.manager);
      const preview = await this._invoke(pub.sourceDocId, "describe-publication", pub.id);
      // The source or link may have been revoked while its worker was opening.
      const { pub: current } = await this._validateConnectionLink(doc, req.body.url, this._db.connection.manager);
      this._checkContractVersion((preview as { contractVersion: number }).contractVersion, current);
      res.setHeader("Cache-Control", "no-store");
      res.json(preview);
    }));
    app.post(`${base}/reference-connections`, ownerWrite, route(async (doc, req, res) => {
      this._validateAliases(req.body.aliases);
      const id = await this._registryTransaction(async (manager) => {
        const { pub, link, existing, destinationOrgId } =
          await this._validateConnectionLink(doc, req.body.url, manager);
        this._checkContractVersion(req.body.contractVersion, pub);
        // Repeated requests never rename a mirror or silently accept a changed contract.
        if (existing && existing.status !== "AUTHORIZED") {
          this._checkContractVersion(existing.acceptedContractVersion, pub);
          return existing.id;
        }
        if (Object.keys(req.body.aliases).some(key => !pub.spec.tables.some(t => String(t.tableRef) === key))) {
          throw new ApiError("Unknown source table alias", 400);
        }
        const before = existing ? referenceAuditState(existing) : undefined;
        if (!existing?.connectedAt) {
          await this._checkSubscriptionLimit(manager, pub.id, doc.docName, !existing);
        }
        const sub = existing || manager.create(ReferenceSubscription, { id: randomUUID(), publicationId: pub.id,
          destinationDocId: doc.docName, destinationOrgId, revoked: false, appliedAt: "", checkedAt: "", error: "" });
        if (!sub.connectedAt) { sub.aliases = req.body.aliases; }
        sub.status = "INITIALIZING";
        sub.acceptedContractVersion = pub.contractVersion;
        sub.acceptedContract = pub.spec;
        const firstConnection = !sub.connectedAt;
        if (firstConnection) {
          sub.connectionLinkId = link.id;
          sub.connectedAt = new Date().toISOString();
        }
        sub.authorizationVersion = (sub.authorizationVersion || 0) + 1;
        await this._assertNoCycle(sub, manager);
        await manager.save(sub);
        if (firstConnection) { await manager.increment(ReferenceConnectionLink, { id: link.id }, "admissions", 1); }
        await this._audit(doc, req, "subscription.connect", before, referenceAuditState(sub), manager);
        return sub.id;
      });
      await this.synchronize(doc, id);
      res.json(await this._subscriptions.findOneByOrFail({ id }));
    }));
    app.get(`${base}/available-references`, ownerRead, route(async (doc, req, res) => {
      const subscriptions = await this._subscriptions.findBy({ destinationDocId: doc.docName, revoked: false });
      const result = [];
      for (const sub of subscriptions) {
        const pub = await this._publications.findOneBy({ id: sub.publicationId });
        if (pub) { result.push({ id: pub.id, name: pub.spec.name, authorizationId: sub.id, paused: pub.paused }); }
      }
      res.json(result);
    }));
    app.get(`${base}/reference-subscriptions`, ownerRead, route(async (doc, req, res) => {
      const subscriptions = await this._subscriptions.findBy({ destinationDocId: doc.docName });
      const markers = new Set(doc.docData!.getMetaTable("_grist_Tables").getRecords()
        .map(t => t.referenceSource).filter(Boolean));
      const publications = new Map((await this._publications.findBy({
        id: In([...new Set(subscriptions.map(sub => sub.publicationId))]),
      })).map(pub => [pub.id, pub]));
      res.json([...subscriptions.map(sub => ({ ...sub,
        contractVersion: publications.get(sub.publicationId)?.contractVersion,
      })), ...[...markers].filter(id => !subscriptions.some(s => s.id === id)).map(id => ({
        id, publicationId: "", destinationDocId: doc.docName, status: "REAUTH_REQUIRED",
        revoked: true, appliedAt: "", error: "", aliases: {},
      }))]);
    }));
    app.get(`${base}/reference-subscriptions/:id/preview`, ownerRead, route(async (doc, req, res) => {
      const sub = await this._subscriptions.findOneBy({ id: req.params.id, destinationDocId: doc.docName });
      if (!sub) { throw new ApiError("Authorization not found", 404); }
      const pub = await this._authorized(sub, true);
      const preview = await this._invoke(pub.sourceDocId, "describe", sub.id) as ReferencePreview;
      this._checkContractVersion(preview.contractVersion, await this._authorized(sub, true));
      const saved = await getReferenceState<SavedMirror>(doc.docStorage, `mirror:${sub.id}`);
      const columnLabels = Object.fromEntries(saved?.state.snapshot?.tables.flatMap(t =>
        t.columns.map(c => [c.key, c.label])) || []);
      res.json({ ...preview, columnLabels: { ...columnLabels, ...preview.columnLabels },
        previousContractKnown: Boolean(sub.acceptedContract),
        changes: sub.acceptedContract ? compareReferenceContracts(sub.acceptedContract, pub.spec) : [] });
    }));
    app.post(`${base}/reference-subscriptions`, ownerWrite, route(async (doc, req, res) => {
      const sub = await this._subscriptions.findOneBy({ id: String(req.body.authorizationId),
        destinationDocId: doc.docName });
      if (!sub || sub.revoked) { throw new ApiError("Authorization not found", 404); }
      const aliases = req.body.aliases;
      if (!aliases || typeof aliases !== "object" || Array.isArray(aliases) ||
        Object.values(aliases).some(v => typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v))) {
        throw new ApiError("Provide table aliases keyed by source table reference", 400);
      }
      if (sub.status === "AUTHORIZED") {
        let before: ReferenceAuditState;
        await this._registryTransaction(async (manager) => {
          const current = await manager.findOneByOrFail(ReferenceSubscription, { id: sub.id });
          if (current.revoked || current.status !== "AUTHORIZED") {
            throw new ApiError("Authorization is no longer available", 409);
          }
          const pub = await this._authorized(current, true, manager);
          this._checkContractVersion(req.body.contractVersion, pub);
          if (!current.connectedAt) { await this._checkSubscriptionLimit(manager, pub.id, doc.docName, false); }
          before = referenceAuditState(current);
          current.acceptedContractVersion = pub.contractVersion;
          current.acceptedContract = pub.spec;
          await this._assertNoCycle(sub, manager);
          if (!current.connectedAt) { current.aliases = aliases; }
          current.authorizationVersion++;
          current.status = "INITIALIZING";
          current.connectedAt ||= new Date().toISOString();
          await manager.save(current);
          await this._audit(doc, req, "subscription.connect", before!, referenceAuditState(current), manager);
          return current;
        });
      }
      await this.synchronize(doc, sub.id);
      res.json(await this._subscriptions.findOneByOrFail({ id: sub.id }));
    }));
    app.patch(`${base}/reference-subscriptions/:id/aliases`, ownerWrite, route(async (doc, req, res) => {
      this._validateAliases(req.body.aliases);
      await this._lock(doc.docName, async () => {
        if (await getReferenceState(doc.docStorage, `mirror:${req.params.id}`) ||
          doc.docData!.getMetaTable("_grist_Tables").getRecords().some(t => t.referenceSource === req.params.id)) {
          throw new ApiError("An initialized mirror cannot be renamed with this operation", 409);
        }
        await this._registryTransaction(async (manager) => {
          const current = await manager.findOneBy(ReferenceSubscription,
            { id: req.params.id, destinationDocId: doc.docName });
          if (!current || current.revoked || ["AUTHORIZED", "DETACHED"].includes(current.status)) {
            throw new ApiError("Subscription unavailable", 409);
          }
          const pub = await this._authorized(current, false, manager);
          if (Object.keys(req.body.aliases).some(k => !pub.spec.tables.some(t => String(t.tableRef) === k))) {
            throw new ApiError("Unknown source table alias", 400);
          }
          current.aliases = req.body.aliases;
          current.authorizationVersion++;
          current.status = "INITIALIZING";
          current.error = "";
          await manager.save(current);
          await this._audit(doc, req, "subscription.repair_aliases", undefined, referenceAuditState(current), manager);
          return current;
        });
      });
      this._retry.reset(req.params.id);
      await this.synchronize(doc, req.params.id, true);
      res.json({ repaired: true });
    }));
    app.patch(`${base}/reference-subscriptions/:id`, ownerWrite, route(async (doc, req, res) => {
      const { sub } = await this._setSubscriptionPause({ id: req.params.id, destinationDocId: doc.docName },
        "destinationPaused", req.body.paused, doc, req);
      this._retry.reset(sub.id);
      this._schedule();
      res.json(sub);
    }));
    app.post(`${base}/reference-subscriptions/:id/activate`, ownerWrite, route(async (doc, req, res) => {
      let before: ReferenceAuditState;
      await this._registryTransaction(async (manager) => {
        const sub = await manager.findOneBy(ReferenceSubscription,
          { id: req.params.id, destinationDocId: doc.docName });
        if (!sub || sub.revoked || sub.status !== "AUTHORIZED" || !sub.connectedAt) {
          throw new ApiError("No reauthorization awaiting acceptance", 409);
        }
        const pub = await manager.findOneByOrFail(ReferencePublication, { id: sub.publicationId });
        this._checkContractVersion(req.body.contractVersion, pub);
        before = referenceAuditState(sub);
        sub.acceptedContractVersion = pub.contractVersion;
        sub.acceptedContract = pub.spec;
        await this._assertNoCycle(sub, manager);
        sub.status = sub.sourcePaused || sub.destinationPaused ? "PAUSED" : "INITIALIZING";
        sub.authorizationVersion++;
        await manager.save(sub);
        await this._audit(doc, req, "subscription.activate", before!, referenceAuditState(sub), manager);
        return sub;
      });

      this._retry.reset(req.params.id);
      this._schedule();
      res.json(await this._subscriptions.findOneByOrFail({ id: req.params.id }));
    }));
    app.post(`${base}/reference-subscriptions/:id/accept-contract`, ownerWrite, route(async (doc, req, res) => {
      let before: ReferenceAuditState;
      const sub = await this._registryTransaction(async (manager) => {
        const current = await manager.findOneBy(ReferenceSubscription,
          { id: req.params.id, destinationDocId: doc.docName });
        if (!current || current.revoked || ["AUTHORIZED", "DETACHED"].includes(current.status)) {
          throw new ApiError("Subscription unavailable for contract acceptance", 409);
        }
        const pub = await this._authorized(current, true, manager);
        this._checkContractVersion(req.body.contractVersion, pub);
        before = referenceAuditState(current);
        current.acceptedContractVersion = pub.contractVersion;
        current.acceptedContract = pub.spec;
        current.authorizationVersion++;
        current.status = "INITIALIZING";
        current.error = "";
        await manager.save(current);
        await this._audit(doc, req, "subscription.accept_contract", before!, referenceAuditState(current), manager);
        return current;
      });

      this._retry.reset(sub.id);
      this._schedule();
      res.json(sub);
    }));
    app.get(`${base}/reference-audit`, ownerRead, route(async (doc, req, res) => {
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
      const query = this._db.connection.getRepository(ReferenceAuditEvent).createQueryBuilder("event")
        .where("event.documentId = :docId", { docId: doc.docName });
      if (cursor) {
        const split = cursor.indexOf("|");
        if (split < 0 || cursor.length > 100) { throw new ApiError("Invalid audit cursor", 400); }
        query.andWhere("(event.createdAt < :date OR (event.createdAt = :date AND event.id < :id))",
          { date: cursor.slice(0, split), id: cursor.slice(split + 1) });
      }
      const events = await query.orderBy("event.createdAt", "DESC").addOrderBy("event.id", "DESC").take(51).getMany();
      const more = events.length > 50;
      const items = events.slice(0, 50);
      const last = items[items.length - 1];
      res.json({ events: items, nextCursor: more ? `${last.createdAt}|${last.id}` : null });
    }));
    app.patch(`${base}/reference-subscriptions/:id/sync-settings`, ownerWrite, route(async (doc, req, res) => {
      const { syncMode, syncIntervalMinutes } = req.body;
      if (!["live", "manual", "scheduled"].includes(syncMode) || !Number.isSafeInteger(syncIntervalMinutes) ||
        syncIntervalMinutes < 1 || syncIntervalMinutes > 43200) {
        throw new ApiError("Invalid synchronization settings", 400);
      }
      let before: ReferenceAuditState;
      const sub = await this._registryTransaction(async (manager) => {
        const current = await manager.findOneBy(ReferenceSubscription, { id: req.params.id,
          destinationDocId: doc.docName });
        if (!current || current.revoked || ["AUTHORIZED", "DETACHED"].includes(current.status)) {
          throw new ApiError("Subscription unavailable", 409);
        }
        before = referenceAuditState(current);
        current.syncMode = syncMode;
        if (["UP_TO_DATE", "WAITING"].includes(current.status)) {
          current.status = syncMode === "live" ? "INITIALIZING" : "WAITING";
        }
        current.syncIntervalMinutes = syncIntervalMinutes;
        current.nextSyncAt = syncMode === "scheduled" ?
          new Date(Date.now() + syncIntervalMinutes * 60_000).toISOString() : "";
        current.authorizationVersion++;
        await manager.save(current);
        await this._audit(doc, req, "subscription.sync_settings", before!, referenceAuditState(current), manager);
        return current;
      });

      this._retry.reset(sub.id);
      this._schedule();
      res.json(sub);
    }));
    app.post(`${base}/reference-subscriptions/:id/update-preview`, ownerRead, route(async (doc, req, res) => {
      res.json(await this._previewUpdate(doc, req.params.id));
    }));
    app.post(`${base}/reference-subscriptions/:id/apply-preview`, ownerWrite, route(async (doc, req, res) => {
      if (typeof req.body.token !== "string") { throw new ApiError("Preview token required", 400); }
      await this.synchronize(doc, req.params.id, false, false,
        { token: req.body.token, acceptSchema: req.body.acceptSchema === true });
      const sub = await this._subscriptions.findOneByOrFail({ id: req.params.id, destinationDocId: doc.docName });
      res.json(sub);
    }));
    app.post(`${base}/reference-subscriptions/:id/reconcile`, ownerWrite, route(async (doc, req, res) => {
      this._retry.reset(req.params.id);
      await this.synchronize(doc, req.params.id, true);
      res.json(await this._subscriptions.findOneByOrFail({ id: req.params.id, destinationDocId: doc.docName }));
    }));
    app.post(`${base}/reference-subscriptions/:id/detach`, ownerWrite, route(async (doc, req, res) => {
      await this._lock(doc.docName, async () => {
        const sub = await this._subscriptions.findOneBy({ id: req.params.id, destinationDocId: doc.docName });
        const rows = doc.docData!.getMetaTable("_grist_Tables").getRecords()
          .filter(t => t.referenceSource === req.params.id);
        if (!sub && !rows.length) { throw new ApiError("Subscription not found", 404); }
        // Disable future work first. Orphan markers in copied files may be detached by their owner.
        if (sub) {
          await this._registryTransaction(async (manager) => {
            const current = await manager.findOneByOrFail(ReferenceSubscription, { id: sub.id });
            const before = referenceAuditState(current);
            current.status = "DETACHED";
            current.authorizationVersion++;
            await manager.save(current);
            await this._audit(doc, req, "subscription.detach", before, referenceAuditState(current), manager);
          });
        }
        if (rows.length) {
          const session = makeReferenceSession();
          referenceCommit(session, `detached:${req.params.id}`, { detached: true }, undefined, undefined, await signReferenceAudit(this._db.connection, {
            id: randomUUID(), documentId: doc.docName, createdAt: new Date().toISOString(),
            actorId: req.userId || null, operation: "subscription.detach_mirror",
            details: { subscription_id: req.params.id },
          }));
          await doc.applyUserActions(session, [["BulkUpdateRecord", "_grist_Tables",
            rows.map(r => r.id), { referenceSource: rows.map(() => "") }]]);
        }
      });
      await this._flushAudit(doc).catch(() => log.warn("Reference audit delivery deferred", { docId: doc.docName }));
      res.json({ status: "DETACHED" });
    }));
    // Internal requests carry a short-lived, server-created, operation/subscription-bound permit.
    for (const operation of ["snapshot", "snapshot-page", "describe", "describe-publication", "synchronize"] as const) {
      app.post(`${base}/reference-internal/${operation}/:id`, ownerWrite, route(async (doc, req, res) => {
        this._assertPermit(req, doc.docName, operation);
        if (operation === "synchronize") {
          await this.synchronize(doc, req.params.id, false, true);
          res.json({ ok: true });
        } else if (operation === "describe-publication") {
          const pub = await this._ownPublication(doc, req.params.id);
          const source = await this._rawDoc(doc.docName);
          if (pub.paused || source.workspace.org.id !== pub.sourceOrgId) { throw new ApiError("PAUSED", 409); }
          const projection = await doc.withReferenceRead(() => readReferenceProjection(doc, pub));
          res.json({ ...this._describeContract(doc, pub, projection), name: pub.spec.name,
            description: pub.spec.description || "" });
        } else {
          const sub = await this._subscriptions.findOneBy({ id: req.params.id });
          if (!sub) { throw new ApiError("Authorization not found", 404); }
          const pub = await this._authorized(sub, operation === "describe");
          if (pub.sourceDocId !== doc.docName) { throw new ApiError("Access denied", 403); }
          const binding = `${sub.authorizationVersion}:${pub.contractVersion}`;
          if (operation === "snapshot-page") {
            res.json({ chunk: await readReferenceSnapshotPage(doc.docStorage, sub.id, binding, req.body.token,
              req.body.page) });
          } else {
            const since = Number.isSafeInteger(req.body.revision) &&
              req.body.revision >= 0 ? req.body.revision : undefined;
            const result = await doc.withReferenceRead(async () => {
              const projection = await readReferenceProjection(doc, pub, since);
              return operation === "describe" ? this._describeContract(doc, pub, projection) :
                stageReferenceSnapshot(doc.docStorage, sub.id, binding, { ...projection,
                  contractVersion: pub.contractVersion });
            });
            res.json(result);
          }
        }
      }));
    }
    this.start();
  }

  public async createPublication(doc: ActiveDoc, spec: ReferencePublicationSpec): Promise<ReferencePublication> {
    try { validateReferenceSpec(spec); } catch { throw new ApiError("Invalid publication specification", 400); }
    await doc.waitForInitialization();
    if (await this._publications.countBy({ sourceDocId: doc.docName }) >= 50) {
      throw new ApiError("REFERENCE_PUBLICATION_LIMIT", 413);
    }
    const source = await this._rawDoc(doc.docName);
    const tableNames = spec.tables.map((t) => {
      const table = doc.docData!.getMetaTable("_grist_Tables").getRecord(t.tableRef);
      if (!table || table.referenceSource || table.onDemand || table.summarySourceTable) {
        throw new ApiError("Table cannot be published", 400);
      }
      return table.tableId;
    });
    await doc.applyUserActions(makeReferenceSession(), [["PrepareReferenceSource", tableNames]]);
    const revision = await doc.withReferenceRead(() => initializeReferenceRevision(doc.docStorage, doc.docName));
    const epochs = await getReferenceState<Record<string, string>>(doc.docStorage, "columnEpochs") || {};
    const pub = this._publications.create({ id: randomUUID(), sourceDocId: doc.docName,
      columnEpochs: Object.fromEntries(spec.tables.flatMap(t => [...t.colRefs, ...t.filters.map(f => f.colRef)])
        .map(id => [String(id), epochs[String(id)] || ""])),
      sourceOrgId: source.workspace.org.id, spec, contractVersion: 1, generation: revision.generation, paused: false,
      identities: Object.fromEntries(spec.tables.map(t => [String(t.tableRef),
        doc.docData!.getMetaTable("_grist_Tables").getRecord(t.tableRef)!.referenceIdentity])) });
    try {
      await doc.withReferenceRead(() => readReferenceProjection(doc, pub));
      await this._registryTransaction(async (manager) => {
        if (await manager.countBy(ReferencePublication, { sourceDocId: doc.docName }) >= 50) {
          throw new ApiError("REFERENCE_PUBLICATION_LIMIT", 413);
        }
        await manager.save(pub);
        const req = this._request.getStore();
        if (req) { await this._audit(doc, req, "publication.create", undefined, referenceAuditState(pub), manager); }
      });
    } catch (error) {
      await doc.docStorage.run("DELETE FROM _gristsys_ReferenceState WHERE key = ?", `projection:${pub.id}`);
      throw error;
    }
    return pub;
  }

  public async synchronize(doc: ActiveDoc, id: string, full = false, automatic = false,
    review?: { token: string; acceptSchema: boolean }): Promise<void> {
    return this._transfers.run(randomUUID(), () => this._synchronize(doc, id, full, automatic, review));
  }

  private async _synchronize(doc: ActiveDoc, id: string, full: boolean, automatic: boolean,
    review?: { token: string; acceptSchema: boolean }): Promise<void> {
    await this._lock(doc.docName, async () => {
      const sub = await this._subscriptions.findOneBy({ id, destinationDocId: doc.docName });
      if (!sub || sub.status === "AUTHORIZED" ||
        sub.status === "DETACHED") { throw new ApiError("Subscription not found", 404); }
      if (automatic && !referenceSyncDue(sub)) { return; }
      try {
        const pub = await this._authorized(sub);
        await doc.waitForInitialization();
        let saved = await getReferenceState<SavedMirror>(doc.docStorage, `mirror:${id}`);
        if (saved && (saved.docId !== doc.docName || saved.sourceOrgId !== pub.sourceOrgId ||
          saved.destinationOrgId !== sub.destinationOrgId)) { throw new ApiError("REAUTH_REQUIRED", 409); }
        const previousRevision = saved?.state.revision;
        const pending = review ? this._reviews.get(`${doc.docName}:${id}`) : undefined;
        if (review && (!pending || pending.token !== review.token || Date.parse(pending.expiresAt) <= Date.now() ||
          pending.authorizationVersion !== sub.authorizationVersion ||
          pending.contractVersion !== pub.contractVersion ||
          pending.baseRevision !== saved?.state.revision || pending.localActionNum !== doc.getReferenceActionNum())) {
          throw new ApiError("PREVIEW_STALE", 409);
        }
        if (pending?.schema && !review?.acceptSchema) { throw new ApiError("SCHEMA_ACCEPTANCE_REQUIRED", 409); }
        let snapshot: ReferenceSnapshot;
        if (pending) { snapshot = pending.snapshot; } else {
          const transfer = await this._fetchTransfer(pub, sub, saved?.state.snapshot &&
            !full ? saved.state.revision : undefined);
          this._checkContractVersion(transfer.contractVersion, pub);
          snapshot = applyReferenceTransfer(saved?.state.snapshot, transfer);
          assertReferenceSize(snapshot);
        }
        await this._authorized(sub); // Never apply a fetch that outlived a revocation.
        if (!saved) {
          const definitions = snapshot.tables.map((t) => {
            const alias = sub.aliases[t.key] || `Ref_${t.tableId}`;
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(alias) ||
              doc.docData!.getMetaTable("_grist_Tables").getRecords().some(r => r.tableId === alias)) {
              throw new ApiError("ALIAS_CONFLICT", 409);
            }
            return { key: t.key, tableId: alias, columns: t.columns.map(c => ({ ...c, id: c.colId })) };
          });
          if (new Set(definitions.map(t => t.tableId)).size !== definitions.length) {
            throw new ApiError("Reference table aliases must be unique", 400);
          }
          const initial: ReferenceMirrorState = {
            generation: snapshot.generation, revision: -1,
            tables: Object.fromEntries(definitions.map(t => [t.key, {
              tableId: t.tableId, columns: Object.fromEntries(t.columns.map(c => [c.key, c.id])),
              rowIds: {}, nextRowId: 1,
            }])),
          };
          const { actions, state } = reconcileReferenceSnapshot(initial, snapshot);
          saved = { docId: doc.docName, sourceOrgId: pub.sourceOrgId,
            destinationOrgId: sub.destinationOrgId, state, contractVersion: pub.contractVersion };
          const session = makeReferenceSession();
          await this._prepareCommit(doc, session, id, saved, sub);
          // Schema, initial records, formulas and cursor commit together, including cyclic references.
          await doc.applyUserActions(session, [["CreateReferenceTables", id, definitions], ...actions]);
        }
        const { actions, state } = reconcileReferenceSnapshot(saved.state, snapshot, Boolean(pending?.schema &&
          review?.acceptSchema));
        if (state !== saved.state || saved.contractVersion !== pub.contractVersion) {
          const session = makeReferenceSession();
          await this._prepareCommit(doc, session, id, { ...saved, state, contractVersion: pub.contractVersion }, sub,
            pending?.localActionNum);
          await this._authorized(sub);
          await doc.applyUserActions(session, actions.length ? actions : [["Calculate"]]);
        }
        await this._subscriptions.update({ id, revoked: false, authorizationVersion: sub.authorizationVersion }, {
          status: sub.syncMode === "live" ? "UP_TO_DATE" : "WAITING", error: "",
          appliedContractVersion: pub.contractVersion,
          checkedAt: new Date().toISOString(),
          nextSyncAt: sub.syncMode === "scheduled" ?
            new Date(Date.now() + sub.syncIntervalMinutes * 60_000).toISOString() : "",
          ...(previousRevision !== snapshot.revision ? { appliedAt: new Date().toISOString() } : {}),
        });
        await this._flushAudit(doc).catch(() => log.warn("Reference audit delivery deferred", { docId: doc.docName }));
        if (pending) { this._reviews.delete(`${doc.docName}:${id}`); }
      } catch (e) {
        const message = String(e.message);
        if (["PREVIEW_STALE", "SCHEMA_ACCEPTANCE_REQUIRED"].includes(message)) { throw e; }
        const status =
          ["ACCESS_REVOKED", "PAUSED", "REAUTH_REQUIRED", "SCHEMA_BLOCKED", "CONTRACT_CHANGED"].includes(message) ?
            message as ReferenceSubscription["status"] : "RETRYING";
        // Do not expose source data, URLs, credentials or stack traces through error messages.
        await this._subscriptions.update({ id, revoked: false, authorizationVersion: sub.authorizationVersion }, {
          status,
          error: message === "ALIAS_CONFLICT" ? "ALIAS_CONFLICT" :
            status === "RETRYING" ? "Reference synchronization failed" : status });
        throw e;
      }
    });
  }

  private async _fetchTransfer(pub: ReferencePublication, sub: ReferenceSubscription, revision?: number) {
    const manifest = await this._invoke(pub.sourceDocId, "snapshot", sub.id, { revision }) as ReferenceSnapshotManifest;
    validateReferenceManifest(manifest);
    const chunks: string[] = [];
    let bytes = 0;
    for (let page = 0; page < manifest.pages; page++) {
      const result = await this._invoke(pub.sourceDocId, "snapshot-page", sub.id, { token: manifest.token, page }) as
        { chunk: string };
      if (typeof result.chunk !== "string" || result.chunk.length > REFERENCE_PAGE_CHARS) {
        throw new ApiError("Invalid snapshot page", 413);
      }
      bytes += Buffer.byteLength(result.chunk);
      // A UTF-16 page boundary may split a surrogate pair, temporarily adding two UTF-8 bytes.
      if (bytes > manifest.bytes + 2 * manifest.pages || bytes > REFERENCE_MAX_BYTES + 2 * manifest.pages) {
        throw new ApiError("REFERENCE_SIZE_LIMIT", 413);
      }
      chunks.push(result.chunk);
    }
    return assembleReferenceSnapshot(manifest, chunks);
  }

  private async _previewUpdate(doc: ActiveDoc, id: string): Promise<ReferenceUpdatePreview> {
    return this._transfers.run(randomUUID(), () => this._previewUpdateUnlocked(doc, id));
  }

  private async _previewUpdateUnlocked(doc: ActiveDoc, id: string): Promise<ReferenceUpdatePreview> {
    return this._lock(doc.docName, async () => {
      const sub = await this._subscriptions.findOneBy({ id, destinationDocId: doc.docName });
      if (!sub || ["AUTHORIZED", "DETACHED"].includes(sub.status)) {
        throw new ApiError("Subscription unavailable",
          409);
      }
      const pub = await this._authorized(sub);
      const saved = await getReferenceState<SavedMirror>(doc.docStorage, `mirror:${id}`);
      if (!saved?.state.snapshot || saved.docId !== doc.docName || saved.sourceOrgId !== pub.sourceOrgId ||
        saved.destinationOrgId !== sub.destinationOrgId) { throw new ApiError("Initialize the reference first", 409); }
      const transfer = await this._fetchTransfer(pub, sub, saved.state.revision);
      this._checkContractVersion(transfer.contractVersion, pub);
      const snapshot = applyReferenceTransfer(saved.state.snapshot, transfer);
      assertReferenceSize(snapshot);
      const { actions } = reconcileReferenceSnapshot(saved.state, snapshot, true);
      return doc.withReferenceRead(async () => {
        await this._authorized(sub);
        const formulas = await doc.previewReferenceActions(actions);
        const preview: ReferenceUpdatePreview = { token: randomUUID(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          revision: snapshot.revision, contractVersion: pub.contractVersion,
          ...describeReferenceUpdate(saved.state.snapshot!, snapshot), formulas };
        const pending: PendingReferenceUpdate = { token: preview.token, expiresAt: preview.expiresAt,
          snapshot, contractVersion: pub.contractVersion, authorizationVersion: sub.authorizationVersion,
          baseRevision: saved.state.revision, localActionNum: doc.getReferenceActionNum(),
          schema: preview.schema.length > 0 };
        this._reviews.set(`${doc.docName}:${id}`, pending);
        return preview;
      });
    });
  }

  private _describeContract(doc: ActiveDoc, pub: ReferencePublication, projection: ReferenceTransfer):
  ReferencePreview {
    return { contractVersion: pub.contractVersion, contract: pub.spec,
      columnLabels: Object.fromEntries(doc.docData!.getMetaTable("_grist_Tables_column").getRecords()
        .filter(c => pub.spec.tables.some(t => t.colRefs.includes(c.id) || t.filters.some(f => f.colRef === c.id)))
        .map(c => [String(c.id), c.label])),
      tables: projection.tables.map(t => ({ key: t.key, tableId: t.tableId,
        columns: t.columns.map(c => c.label), rowCount: Object.keys(t.rows).length })) };
  }

  private _linkOptions(body: ReferenceLinkOptions, existingExpiry = "") {
    const { name, expiresAt = "", allowedOrgIds = [], maxAdmissions = 0 } = body;
    if (typeof name !== "string" || !name.trim() || name.length > 200 ||
      typeof expiresAt !== "string" || (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) ||
        (Date.parse(expiresAt) <= Date.now() && expiresAt !== existingExpiry))) ||
        !Array.isArray(allowedOrgIds) || allowedOrgIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        !Number.isSafeInteger(maxAdmissions) || maxAdmissions < 0) {
      throw new ApiError("Invalid connection link settings", 400);
    }
    return { name: name.trim(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
      allowedOrgIds: [...new Set<number>(allowedOrgIds)], maxAdmissions };
  }

  private async _revocationTargets(manager: EntityManager, publicationId: string, linkId: unknown) {
    if (linkId !== undefined && typeof linkId !== "string") { throw new ApiError("Invalid link scope", 400); }
    const links = await manager.find(ReferenceConnectionLink, { where: { publicationId,
      ...(linkId === undefined ? {} : { id: linkId }) }, order: { id: "ASC" } });
    if (linkId !== undefined && !links.length) { throw new ApiError("Connection link not found", 404); }
    const subscriptions = (await manager.find(ReferenceSubscription, { where: { publicationId, revoked: false,
      ...(linkId === undefined ? {} : { connectionLinkId: linkId }) }, order: { id: "ASC" } }))
      .filter(s => s.status !== "DETACHED");
    const token = createHash("sha256").update(JSON.stringify({ publicationId, linkId,
      subscriptions: subscriptions.map(s => [s.id, s.authorizationVersion]),
      links: links.map(l => [l.id, l.settingsVersion, l.disabled]),
    })).digest("hex");
    return { links, subscriptions, preview: { count: subscriptions.length,
      linksToDisable: links.filter(l => !l.disabled).length, token } };
  }

  private async _audit(doc: ActiveDoc, req: RequestWithLogin, operation: string,
    before: ReferenceAuditState | undefined, after: ReferenceAuditState, manager: EntityManager): Promise<void> {
    doc.logAuditEvent(req, { action: "document.reference", details: {
      document: { id: doc.docName }, operation, before, after,
    } });
    const documents = new Set([doc.docName]);
    const pub = after.publication_id ?
      await manager.findOneBy(ReferencePublication, { id: after.publication_id }) : null;
    if (pub) { documents.add(pub.sourceDocId); }
    const sub = after.subscription_id ?
      await manager.findOneBy(ReferenceSubscription, { id: after.subscription_id }) : null;
    if (sub?.connectedAt) { documents.add(sub.destinationDocId); }
    for (const documentId of documents) {
      await manager.save(ReferenceAuditEvent, { id: randomUUID(), documentId,
        createdAt: new Date().toISOString(), actorId: req.userId || null, operation, details: { before, after } });
    }
  }

  private async _flushAudit(doc: ActiveDoc): Promise<void> {
    await doc.withReferenceRead(() => flushReferenceAudit(doc.docStorage, doc.docName, this._db.connection));
  }

  private async _authorized(sub: ReferenceSubscription, allowPending = false,
    manager = this._db.connection.manager): Promise<ReferencePublication> {
    const current = await manager.findOneBy(ReferenceSubscription, { id: sub.id });
    if (!current || current.revoked || current.status === "DETACHED") { throw new ApiError("ACCESS_REVOKED", 403); }
    if (current.authorizationVersion !== sub.authorizationVersion ||
      (!allowPending && current.status === "AUTHORIZED")) {
      throw new ApiError("REAUTH_REQUIRED", 409);
    }
    if (current.sourcePaused || current.destinationPaused) { throw new ApiError("PAUSED", 409); }
    const pub = await manager.findOneBy(ReferencePublication, { id: current.publicationId });
    if (!pub) { throw new ApiError("REAUTH_REQUIRED", 409); }
    if (pub.paused) { throw new ApiError("PAUSED", 409); }
    if (!allowPending) { this._checkContractVersion(current.acceptedContractVersion, pub); }
    const [source, destination] = await Promise.all([this._rawDoc(pub.sourceDocId),
      this._rawDoc(sub.destinationDocId)]);
    if (source.workspace.org.id !== pub.sourceOrgId || destination.workspace.org.id !== sub.destinationOrgId) {
      throw new ApiError("REAUTH_REQUIRED", 409);
    }
    return pub;
  }

  private async _setSubscriptionPause(where: { id: string; publicationId?: string; destinationDocId?: string },
    field: "sourcePaused" | "destinationPaused", paused: unknown, doc: ActiveDoc, req: RequestWithLogin):
  Promise<{ before: ReferenceAuditState; sub: ReferenceSubscription }> {
    if (typeof paused !== "boolean") { throw new ApiError("Expected paused boolean", 400); }
    return this._registryTransaction(async (manager) => {
      const sub = await manager.findOneBy(ReferenceSubscription, where);
      if (!sub || sub.revoked || sub.status === "DETACHED") { throw new ApiError("Consumer unavailable", 409); }
      const before = referenceAuditState(sub);
      sub[field] = paused;
      sub.authorizationVersion++;
      if (sub.status !== "AUTHORIZED") {
        sub.status = sub.sourcePaused || sub.destinationPaused ? "PAUSED" : "INITIALIZING";
      }
      sub.error = "";
      await manager.save(sub);
      await this._audit(doc, req, field === "sourcePaused" ? "subscription.source_pause" :
        "subscription.destination_pause", before, referenceAuditState(sub), manager);
      return { before, sub };
    });
  }

  private _checkContractVersion(version: unknown, pub: ReferencePublication): void {
    if (!Number.isSafeInteger(version) || version !== pub.contractVersion) {
      throw new ApiError("CONTRACT_CHANGED", 409);
    }
  }

  private _connectionHomeUrl(): URL {
    const homeUrl = this._server.getGristConfig().homeUrl;
    if (!homeUrl) { throw new ApiError("Connection links require a home server", 503); }
    return new URL("reference-connect", homeUrl.endsWith("/") ? homeUrl : `${homeUrl}/`);
  }

  private _validateAliases(aliases: unknown): asserts aliases is Record<string, string> {
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases) ||
      Object.values(aliases).some(v => typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) ||
      new Set(Object.values(aliases)).size !== Object.values(aliases).length) {
      throw new ApiError("Provide unique local table aliases", 400);
    }
  }

  private async _registryTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return withReferenceRegistry(this._db.connection, fn);
  }

  private async _prepareCommit(doc: ActiveDoc, session: OptDocSession, id: string, saved: SavedMirror,
    sub: ReferenceSubscription,
    expectedActionNum?: number) {
    let checked = false;
    referenceCommit(session, `mirror:${id}`, saved, async () => {
      if (!checked && expectedActionNum !== undefined && doc.getReferenceActionNum() !== expectedActionNum) {
        throw new ApiError("PREVIEW_STALE", 409);
      }
      checked = true;
      return this._authorized(sub);
    }, write =>
      this._registryTransaction(async (manager) => {
        await this._authorized(sub, false, manager);
        await write();
      }), await signReferenceAudit(this._db.connection, {
      id: randomUUID(), documentId: doc.docName, createdAt: new Date().toISOString(),
      actorId: this._request.getStore()?.specialPermit ? null : this._request.getStore()?.userId || null,
      operation: this._request.getStore()?.route?.path.endsWith("apply-preview") ?
        "subscription.apply_preview" : "subscription.synchronized",
      details: { after: { ...referenceAuditState(sub), applied_revision: saved.state.revision,
        applied_contract_version: saved.contractVersion } },
    }));
  }

  private async _validateConnectionLink(doc: ActiveDoc, input: unknown, manager: EntityManager) {
    const invalid = () => new ApiError("Connection link unavailable", 403);
    if (typeof input !== "string" || input.length > 4096) { throw invalid(); }
    let url: URL;
    try { url = new URL(input); } catch { throw invalid(); }
    const match = /^#grist-reference=([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(url.hash);
    if (!match || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search) {
      throw invalid();
    }
    const link = await manager.getRepository(ReferenceConnectionLink).createQueryBuilder("link")
      .addSelect("link.secretHash").where("link.id = :id", { id: match[1] }).getOne();
    const actual = createHash("sha256").update(match[2]).digest();
    if (!link || link.disabled || (link.expiresAt && Date.parse(link.expiresAt) <= Date.now()) ||
      !timingSafeEqual(actual, Buffer.from(link.secretHash, "hex"))) { throw invalid(); }
    const pub = await manager.findOneBy(ReferencePublication, { id: link.publicationId });
    if (!pub) { throw invalid(); }
    // Only the exact home URL of this local publication is accepted. Never fetch a supplied URL.
    const expected = this._connectionHomeUrl();
    if (url.origin !== expected.origin || (url.pathname !== expected.pathname &&
      url.pathname !== new URL(this._server.getGristConfig().homeUrl!).pathname)) {
      throw new ApiError("Connections between independent Grist instances are not supported", 400);
    }
    const source = await this._rawDoc(pub.sourceDocId);
    const destination = await this._rawDoc(doc.docName);
    const destinationOrgId = destination.workspace.org.id;
    if (source.workspace.org.id !== pub.sourceOrgId ||
      (link.allowedOrgIds.length && !link.allowedOrgIds.includes(destinationOrgId))) { throw invalid(); }
    if (pub.paused) { throw new ApiError("PAUSED", 409); }
    const existing = await manager.findOneBy(ReferenceSubscription, {
      publicationId: pub.id, destinationDocId: doc.docName,
    });
    if (existing?.revoked) { throw new ApiError("ACCESS_REVOKED", 403); }
    if (existing?.status === "DETACHED") { throw new ApiError("This reference was detached", 409); }
    if (existing && existing.destinationOrgId !== destinationOrgId) { throw new ApiError("REAUTH_REQUIRED", 409); }
    if (!existing?.connectedAt &&
      link.maxAdmissions && link.admissions >= link.maxAdmissions) {
      throw new ApiError("Connection link admission limit reached", 409);
    }
    return { link, pub, existing, destinationOrgId };
  }

  private async _rawDoc(id: string) {
    const doc = await this._db.getRawDocById(id);
    if (doc?.id !== id || doc.removedAt || doc.disabledAt || doc.workspace.removedAt || doc.trunkId) {
      throw new ApiError("Document unavailable", 404);
    }
    return doc;
  }

  private async _ownPublication(doc: ActiveDoc, id: string) {
    const pub = await this._publications.findOneBy({ id, sourceDocId: doc.docName });
    if (!pub) { throw new ApiError("Publication not found", 404); }
    return pub;
  }

  private _assertPermit(req: RequestWithLogin, docId: string, operation: string): void {
    if (req.specialPermit?.docId !== docId || req.specialPermit?.otherDocId !== req.params.id ||
      req.specialPermit?.action !== `reference-${operation}`) { throw new ApiError("Access denied", 403); }
  }

  private async _checkSubscriptionLimit(manager: EntityManager, publicationId: string, destinationDocId: string,
    newAuthorization = true) {
    // Unsolicited pending invitations must not exhaust a destination's own admission quota.
    const connected = await manager.createQueryBuilder(ReferenceSubscription, "sub")
      .where("sub.destinationDocId = :destinationDocId", { destinationDocId })
      .andWhere("sub.connectedAt <> ''").getCount();
    if (connected >= 100 ||
      (newAuthorization && await manager.countBy(ReferenceSubscription, { publicationId }) >= 1000)) {
      throw new ApiError("REFERENCE_SUBSCRIPTION_LIMIT", 413);
    }
  }

  private async _assertNoCycle(candidate: ReferenceSubscription, manager: EntityManager): Promise<void> {
    const publications = await manager.find(ReferencePublication);
    const subscriptions = await manager.find(ReferenceSubscription);
    const source = publications.find(p => p.id === candidate.publicationId)?.sourceDocId;
    const edges = new Map<string, Set<string>>();
    for (const sub of subscriptions) {
      if (sub.revoked || sub.status === "DETACHED" || sub.status === "AUTHORIZED") { continue; }
      const from = publications.find(p => p.id === sub.publicationId)?.sourceDocId;
      if (from) { const set = edges.get(from) || new Set(); set.add(sub.destinationDocId); edges.set(from, set); }
    }
    const pending = [candidate.destinationDocId];
    const seen = new Set<string>();
    while (pending.length) {
      const docId = pending.pop()!;
      if (docId === source) { throw new ApiError("Reference cycle detected", 409); }
      if (!seen.has(docId)) { seen.add(docId); pending.push(...edges.get(docId) || []); }
    }
  }

  private async _invoke(docId: string, operation: string, id: string, body: object = {}): Promise<unknown> {
    const store = this._server.getPermitStore();
    const permit = await store.setPermit({ docId, otherDocId: id, action: `reference-${operation}` }, 60_000);
    try {
      const url = await this._server.getHomeUrlByDocId(docId,
        `/api/docs/${encodeURIComponent(docId)}/reference-internal/${operation}/${encodeURIComponent(id)}`);
      const response = await fetch(url, { method: "POST", headers: { "Permit": permit,
        "Content-Type": "application/json" },
      body: JSON.stringify(body), timeout: 60_000 });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const code = ["ACCESS_REVOKED", "PAUSED", "REAUTH_REQUIRED",
          "SCHEMA_BLOCKED", "CONTRACT_CHANGED", "SNAPSHOT_EXPIRED"].includes(error.error) ? error.error :
          "Reference synchronization failed";
        throw new ApiError(code, response.status);
      }
      return await response.json();
    } finally { await store.removePermit(permit); }
  }

  private async _lock<T>(id: string, callback: () => Promise<T>): Promise<T> {
    let mutex = this._locks.get(id);
    if (!mutex) { mutex = new Mutex(); this._locks.set(id, mutex); }
    try { return await mutex.runExclusive(callback); } finally {
      if (!mutex.isLocked() && this._locks.get(id) === mutex) { this._locks.delete(id); }
    }
  }

  private _schedule(sourceId?: string): void {
    if (sourceId) { this._pendingSources.add(sourceId); } else { this._pollAll = true; }
    void this._drainSchedule();
  }

  private async _drainSchedule(): Promise<void> {
    if (!this._started || this._running) { return; }
    this._running = true;
    const sourceIds = [...this._pendingSources];
    const all = this._pollAll;
    this._pendingSources.clear();
    this._pollAll = false;
    try {
      const publications = all ? undefined : await this._publications.findBy({ sourceDocId: In(sourceIds) });
      const subscriptions = (await this._subscriptions.findBy({ revoked: false,
        ...(publications ? { publicationId: In(publications.map(p => p.id)) } : {}),
      })).filter(s => !s.sourcePaused && !s.destinationPaused && s.error !== "ALIAS_CONFLICT" &&
        this._retry.ready(s.id) && referenceSyncDue(s) &&
        !["AUTHORIZED", "DETACHED", "REAUTH_REQUIRED", "SCHEMA_BLOCKED", "CONTRACT_CHANGED"].includes(s.status));
      // Bound fan-out; a lease suppresses concurrent dispatch by multiple schedulers.
      // Correctness still comes from document routing, serialization and durable cursor checks.
      const workers = this._server.getDocWorkerMap();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, subscriptions.length) }, async () => {
        while (next < subscriptions.length && this._started) {
          const sub = subscriptions[next++];
          const name = `reference-${sub.id}`;
          let lease: string | null | undefined;
          try {
            lease = await workers?.getElection(name, 65_000);
            if (workers && !lease) { continue; }
            await this._invoke(sub.destinationDocId, "synchronize", sub.id);
            this._retry.reset(sub.id);
          } catch {
            this._retry.failed(sub.id);
            log.warn("Reference synchronization deferred", { subscriptionId: sub.id });
          } finally {
            if (lease) { await workers?.removeElection(name, lease); }
          }
        }
      }));
    } catch (e) { log.warn("Reference scheduler failed: %s", e.message); } finally {
      this._running = false;
      if (this._pollAll || this._pendingSources.size) { void this._drainSchedule(); }
    }
  }
}
