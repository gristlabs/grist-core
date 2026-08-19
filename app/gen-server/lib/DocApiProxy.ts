import { ApiError } from "app/common/ApiError";
import { DOC_ID_LENGTH, parseUrlId, SHARE_KEY_PREFIX } from "app/common/gristUrls";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { assertAccess, getOrSetDocAuth, getUserId, RequestWithLogin } from "app/server/lib/Authorizer";
import { DocWorkerInfo, IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { isMcpEnabled } from "app/server/lib/gristSettings";
import {
  BufferedResponse, buildProxyRequestUrl, forwardHttpRequest, hasAlreadyProxiedHeader, proxyHttpRequest,
} from "app/server/lib/requestUtils";

import * as express from "express";

export interface DocApiProxyOptions {
  // Only forward incoming API requests if this returns true.
  shouldForward?: () => boolean;
}

/**
 * Buffered forward straight to `workerUrl`, saving a hop through home; the proxied marker
 * makes that worker run the doc rather than forward on. For small doc-to-doc JSON
 * (/compare, MCP), not large downloads. Get `workerUrl` from getDocWorkerInternalUrl, or
 * from getRemoteDocWorkerInternalUrl when a local doc should be handled without forwarding.
 */
export async function forwardDocApiRequest(
  workerUrl: string,
  req: express.Request,
  options: { method: string; subpath: string; body?: string },
  extraHeaders: Lowercase<string>[] = [],
): Promise<BufferedResponse> {
  const url = buildProxyRequestUrl(new URL(workerUrl), options.subpath);
  return forwardHttpRequest(req, options.method, url, options.body, {
    defaultHeaders: { "content-type": "application/json" },
    proxyExtraHeaders: extraHeaders,
    // The outside Origin trips the target worker's cross-origin credential check.
    omitOrigin: true,
  });
}

/** The URL to reach the worker serving `docId` from another server, which may be this one. */
export async function getDocWorkerInternalUrl(
  docWorkerMap: IDocWorkerMap, docId: string,
): Promise<string> {
  assertCanonicalDocId(docId);
  return (await assignWorker(docWorkerMap, docId)).internalUrl;
}

/** As getDocWorkerInternalUrl, but null when the doc is served here and needs no forwarding. */
export async function getRemoteDocWorkerInternalUrl(
  docWorkerMap: IDocWorkerMap, docId: string, localWorkerId: string | null,
): Promise<string | null> {
  assertCanonicalDocId(docId);
  return internalUrlIfRemote(await assignWorker(docWorkerMap, docId), localWorkerId);
}

async function assignWorker(docWorkerMap: IDocWorkerMap, docId: string): Promise<DocWorkerInfo> {
  return (await docWorkerMap.assignDocWorker(docId)).docWorker;
}

// A server with no worker id of its own (home-only) matches nothing, and so always forwards.
function internalUrlIfRemote(worker: DocWorkerInfo, localWorkerId: string | null): string | null {
  return worker.id === localWorkerId ? null : worker.internalUrl;
}

// Defensive, should not happen: a urlId instead of the canonical docId would get its own
// worker assignment, opening the doc on a second worker (silent; the receiving worker
// re-resolves, so tests pass). Canonical trunk ids are DOC_ID_LENGTH; urlIds are shorter.
// The proxy's own path is exempt: it also routes "import", which has no doc.
function assertCanonicalDocId(docId: string): void {
  const { trunkId } = parseUrlId(docId);
  if (trunkId.length < DOC_ID_LENGTH) {
    throw new Error(`forwarding needs a canonical docId, got urlId-like "${docId}"`);
  }
}

/**
 * Forwards all /api/docs/:docId/tables requests to the doc worker handling the :docId document. Makes
 * sure the user has at least view access to the document otherwise rejects the request. For
 * performance reason we stream the body directly from the request, which requires that no-one reads
 * the req before, in particular you should register DocApiProxy before bodyParser.
 *
 * Use:
 *   const home = new ApiServer(false);
 *   const docApiProxy = new DocApiProxy(getDocWorkerMap(), home, server);
 *   app.use(docApiProxy.getMiddleware());
 *
 * Note that it expects userId, and jsonErrorHandler middleware to be set up outside
 * to apply to these routes.
 */
export class DocApiProxy {
  constructor(
    private _docWorkerMap: IDocWorkerMap,
    private _dbManager: HomeDBManager,
    private _gristServer: GristServer,
    private _options: DocApiProxyOptions = {},
  ) {}

  public addEndpoints(app: express.Application) {
    app.use((req, res, next) => {
      if (req.url.startsWith("/api/s/")) {
        req.url = req.url.replace("/api/s/", `/api/docs/${SHARE_KEY_PREFIX}`);
      }
      next();
    });

    // Add middleware that permits OAuth tokens on some endpoints (when OAuth support is present).
    // This is also added in `DocApi.addEndpoints` in `app/server/lib/DocApi`, but we also
    // add it here as a general pre-check, and so that the view access pre-check is done as
    // the OAuth user.
    this._gristServer.getOAuthValidator()?.addDocApiMiddleware(app);

    // Middleware to forward a request about an existing document that user has access to.
    // We do not check whether the document has been soft-deleted; that will be checked by
    // the worker if needed.
    const withDoc = expressWrap(this._forwardToDocWorker.bind(this, "viewers", []));
    // Middleware to forward a request without a pre-existing document (for imports/uploads).
    const withoutDoc = expressWrap(this._forwardToDocWorker.bind(this, "import", []));
    const withDocWithoutAuth = expressWrap(this._forwardToDocWorker.bind(this, null, []));
    // Like withDoc but without the access pre-check: MCP authenticates per-tool at the
    // worker, and its anonymous OAuth challenge must reach the worker. See "route" below.
    const withDocMcp = expressWrap(this._forwardToDocWorker.bind(this, "route",
      ["accept", "mcp-session-id"]));
    app.use("/api/docs/:docId/tables", withDoc);
    app.use("/api/docs/:docId/force-reload", withDoc);
    app.use("/api/docs/:docId/recover", withDoc);
    app.use("/api/docs/:docId/remove", withDoc);
    app.use("/api/docs/:docId/disable", withDocWithoutAuth);
    app.use("/api/docs/:docId/enable", withDocWithoutAuth);
    app.delete("/api/docs/:docId", withDoc);
    app.use("/api/docs/:docId/download", withDoc);
    app.use("/api/docs/:docId/send-to-drive", withDoc);
    app.use("/api/docs/:docId/fork", withDoc);
    app.use("/api/docs/:docId/create-fork", withDoc);
    app.use("/api/docs/:docId/apply", withDoc);
    app.use("/api/docs/:docId/attachments", withDoc);
    app.use("/api/docs/:docId/uploads", withDoc);
    app.use("/api/docs/:docId/attachments/archive", withDoc);
    app.use("/api/docs/:docId/attachments/download", withDoc);
    app.use("/api/docs/:docId/attachments/transferStatus", withDoc);
    app.use("/api/docs/:docId/attachments/transferAll", withDoc);
    app.use("/api/docs/:docId/attachments/store", withDoc);
    app.use("/api/docs/:docId/attachments/stores", withDoc);
    app.use("/api/docs/:docId/snapshots", withDoc);
    app.use("/api/docs/:docId/usersForViewAs", withDoc);
    app.use("/api/docs/:docId/replace", withDoc);
    app.use("/api/docs/:docId/flush", withDoc);
    app.use("/api/docs/:docId/states", withDoc);
    app.use("/api/docs/:docId/compare", withDoc);
    app.use("/api/docs/:docId/assign", withDocWithoutAuth);
    app.use("/api/docs/:docId/webhooks/queue", withDoc);
    app.use("/api/docs/:docId/webhooks", withDoc);
    app.use("/api/docs/:docId/triggers", withDoc);
    app.use("/api/docs/:docId/assistant", withDoc);
    app.use("/api/docs/:docId/sql", withDoc);
    app.use("/api/docs/:docId/timing", withDoc);
    app.use("/api/docs/:docId/timing/start", withDoc);
    app.use("/api/docs/:docId/timing/stop", withDoc);
    app.use("/api/docs/:docId/forms/:vsId", withDoc);
    app.use("/api/docs/:docId/propose", withDoc);
    app.use("/api/docs/:docId/proposals", withDoc);
    if (isMcpEnabled()) {
      app.use("/api/docs/:docId/mcp", withDocMcp);
    }

    app.use("/api/docs/:docId/copy", withoutDoc);
    app.use("^/api/docs$", withoutDoc);
    app.use("/api/workspaces/:wid/import", withoutDoc);
  }

  private async _forwardToDocWorker(
    // How to resolve the doc before forwarding. "viewers": resolve and authorize.
    // null: resolve only. "import": no doc. "route": resolve for routing only, no
    // access check and no docAuth caching -- the worker authenticates (used by MCP).
    mode: "viewers" | null | "import" | "route", extraHeaders: Lowercase<string>[],
    req: express.Request, res: express.Response, next: express.NextFunction,
  ): Promise<void> {
    if (this._options.shouldForward && !this._options.shouldForward()) {
      return next();
    }

    const mreq = req as RequestWithLogin;
    let docId: string | null = null;
    if (mode === "route") {
      // Already at the target worker: skip routing and let the local handler run.
      if (hasAlreadyProxiedHeader(req)) { return next(); }
      // Resolve as the identified user, not mreq.userId: OAuth requests are anonymous there
      // (the real user is on the credential), and resolving anonymous misroutes private docs
      // to the "import" worker. Routing only -- the worker does the auth and anon challenge.
      const routeUserId = mreq.authSession?.identifiedUser?.id ?? getUserId(mreq);
      const docAuth = await this._dbManager.getDocAuthCached(
        { urlId: req.params.docId, userId: routeUserId, org: mreq.org });
      docId = docAuth.docId;
    } else if (mode !== "import") {
      const docAuth = await getOrSetDocAuth(mreq, this._dbManager, req.params.docId);
      if (mode === "viewers") {
        assertAccess(mode, docAuth, { allowRemoved: true, allowDisabled: true });
      }
      docId = docAuth.docId;
    }

    // Refuse to re-forward an already forwarded request.
    // Helps with cases such as "import", where a request may be proxied without a doc worker being assigned,
    // resulting in endless proxying.
    if (hasAlreadyProxiedHeader(req)) {
      return next();
    }

    // Use the docId for worker assignment, rather than req.params.docId, which could be a urlId.
    // Convert docId "null" to "import" special id, for legacy compatibility.
    docId = docId === null ? "import" : docId;

    if (!this._docWorkerMap) {
      throw new ApiError("no worker map", 404);
    }

    const forwardingTarget = await this._getForwardingTarget(docId);

    // If there's no sensible forwarding target (e.g. document is local), let the remaining handlers run.
    if (!forwardingTarget) {
      return next();
    }

    const docWorkerUrl = new URL(forwardingTarget);
    // buildProxyRequestUrl guards against malicious req.originalUrl affecting routing.
    const url = buildProxyRequestUrl(docWorkerUrl, req.originalUrl);

    // At this point, we have already checked and trusted the origin of the request (see FlexServer#addApiMiddleware()).
    // However, the proxyHttpRequest helper responds with *all* headers from the target doc worker, overwriting
    // any that middleware have already set.
    // Origin and Host need to be included (and are by default) to get the correct headers for the given client.
    return proxyHttpRequest(req, res, url, {
      defaultHeaders: { "content-type": "application/json" },
      proxyExtraHeaders: ["host", "x-sort", "x-limit", ...extraHeaders],
    }).catch(
      // proxyHttpRequest handles errors, closing the connection and logging internally.
      // Avoid triggering express error handlers by suppressing the error.
      () => undefined,
    );
  }

  private async _getForwardingTarget(docId: string): Promise<string | null> {
    // Null if the document is ours, so we don't forward the req - allow this server to
    // handle it later.
    return internalUrlIfRemote(await assignWorker(this._docWorkerMap, docId),
      this._gristServer.getWorkerId());
  }
}
