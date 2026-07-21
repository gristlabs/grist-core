import { ApiError } from "app/common/ApiError";
import { SHARE_KEY_PREFIX } from "app/common/gristUrls";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { assertAccess, getOrSetDocAuth, RequestWithLogin } from "app/server/lib/Authorizer";
import { IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { buildProxyRequestUrl, hasAlreadyProxiedHeader, proxyHttpRequest } from "app/server/lib/requestUtils";

import * as express from "express";

export interface DocApiProxyOptions {
  // Only forward incoming API requests if this returns true.
  shouldForward?: () => boolean;
}

/**
 * Forwards all /api/docs/:docId/tables requests to the doc worker handling the :docId document. Makes
 * sure the user has at least view access to the document otherwise rejects the request. For
 * performance reason we stream the body directly from the request, which requires that no-one reads
 * the req before, in particular you should register DocApiProxy before bodyParser.
 *
 * Use:
 *   const home = new ApiServer(false);
 *   const docApiProxy = new DocApiProxy(getDocWorkerMap(), home, server, () => server.worker.id);
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
    private _getOwnWorkerId: () => string | null,
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
    const withDoc = expressWrap(this._forwardToDocWorker.bind(this, true, "viewers"));
    // Middleware to forward a request without a pre-existing document (for imports/uploads).
    const withoutDoc = expressWrap(this._forwardToDocWorker.bind(this, false, null));
    const withDocWithoutAuth = expressWrap(this._forwardToDocWorker.bind(this, true, null));
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

    app.use("/api/docs/:docId/copy", withoutDoc);
    app.use("^/api/docs$", withoutDoc);
    app.use("/api/workspaces/:wid/import", withoutDoc);
  }

  private async _forwardToDocWorker(
    withDocId: boolean, role: "viewers" | null, req: express.Request, res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    if (this._options.shouldForward && !this._options.shouldForward()) {
      return next();
    }

    let docId: string | null = null;
    if (withDocId) {
      const docAuth = await getOrSetDocAuth(req as RequestWithLogin, this._dbManager, req.params.docId);
      if (role) {
        assertAccess(role, docAuth, { allowRemoved: true, allowDisabled: true });
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
      proxyExtraHeaders: ["host", "x-sort", "x-limit"],
    }).catch(
      // proxyHttpRequest handles errors, closing the connection and logging internally.
      // Avoid triggering express error handlers by suppressing the error.
      () => undefined,
    );
  }

  private async _getForwardingTarget(docId: string): Promise<string | null> {
    const docStatus = await this._docWorkerMap.assignDocWorker(docId);
    // If the document is ours, don't forward the req - allow this server to handle it later.
    if (docStatus.docWorker.id === this._getOwnWorkerId()) { return null; }

    return docStatus.docWorker.internalUrl;
  }
}
