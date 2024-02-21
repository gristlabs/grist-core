import * as express from "express";
import fetch, { RequestInit } from 'node-fetch';
import {AbortController} from 'node-abort-controller';

import { ApiError } from 'app/common/ApiError';
import { SHARE_KEY_PREFIX } from 'app/common/gristUrls';
import { removeTrailingSlash } from 'app/common/gutil';
import { HomeDBManager } from "app/gen-server/lib/HomeDBManager";
import { assertAccess, getOrSetDocAuth, getTransitiveHeaders, RequestWithLogin } from 'app/server/lib/Authorizer';
import { IDocWorkerMap } from "app/server/lib/DocWorkerMap";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { getAssignmentId } from "app/server/lib/idUtils";
import { addAbortHandler } from "app/server/lib/requestUtils";

/**
 * Forwards all /api/docs/:docId/tables requests to the doc worker handling the :docId document. Makes
 * sure the user has at least view access to the document otherwise rejects the request. For
 * performance reason we stream the body directly from the request, which requires that no-one reads
 * the req before, in particular you should register DocApiForwarder before bodyParser.
 *
 * Use:
 *   const home = new ApiServer(false);
 *   const docApiForwarder = new DocApiForwarder(getDocWorkerMap(), home);
 *   app.use(docApiForwarder.getMiddleware());
 *
 * Note that it expects userId, and jsonErrorHandler middleware to be set up outside
 * to apply to these routes.
 */
export class DocApiForwarder {

  constructor(private _docWorkerMap: IDocWorkerMap, private _dbManager: HomeDBManager,
              private _gristServer: GristServer) {
  }

  public addEndpoints(app: express.Application) {
    app.use((req, res, next) => {
      if (req.url.startsWith('/api/s/')) {
        req.url = req.url.replace('/api/s/', `/api/docs/${SHARE_KEY_PREFIX}`);
      }
      next();
    });

    // Middleware to forward a request about an existing document that user has access to.
    // We do not check whether the document has been soft-deleted; that will be checked by
    // the worker if needed.
    const withDoc = expressWrap(this._forwardToDocWorker.bind(this, true, 'viewers'));
    // Middleware to forward a request without a pre-existing document (for imports/uploads).
    const withoutDoc = expressWrap(this._forwardToDocWorker.bind(this, false, null));
    const withDocWithoutAuth = expressWrap(this._forwardToDocWorker.bind(this, true, null));
    app.use('/api/docs/:docId/tables', withDoc);
    app.use('/api/docs/:docId/force-reload', withDoc);
    app.use('/api/docs/:docId/recover', withDoc);
    app.use('/api/docs/:docId/remove', withDoc);
    app.delete('/api/docs/:docId', withDoc);
    app.use('/api/docs/:docId/download', withDoc);
    app.use('/api/docs/:docId/send-to-drive', withDoc);
    app.use('/api/docs/:docId/fork', withDoc);
    app.use('/api/docs/:docId/create-fork', withDoc);
    app.use('/api/docs/:docId/apply', withDoc);
    app.use('/api/docs/:docId/attachments', withDoc);
    app.use('/api/docs/:docId/snapshots', withDoc);
    app.use('/api/docs/:docId/usersForViewAs', withDoc);
    app.use('/api/docs/:docId/replace', withDoc);
    app.use('/api/docs/:docId/flush', withDoc);
    app.use('/api/docs/:docId/states', withDoc);
    app.use('/api/docs/:docId/compare', withDoc);
    app.use('/api/docs/:docId/assign', withDocWithoutAuth);
    app.use('/api/docs/:docId/webhooks/queue', withDoc);
    app.use('/api/docs/:docId/webhooks', withDoc);
    app.use('/api/docs/:docId/assistant', withDoc);
    app.use('/api/docs/:docId/sql', withDoc);
    app.use('/api/docs/:docId/forms/:vsId', withDoc);
    app.use('^/api/docs$', withoutDoc);
  }

  private async _forwardToDocWorker(
    withDocId: boolean, role: 'viewers'|null, req: express.Request, res: express.Response,
  ): Promise<void> {
    let docId: string|null = null;
    if (withDocId) {
      const docAuth = await getOrSetDocAuth(req as RequestWithLogin, this._dbManager,
        this._gristServer, req.params.docId);
      if (role) {
        assertAccess(role, docAuth, {allowRemoved: true});
      }
      docId = docAuth.docId;
    }
    // Use the docId for worker assignment, rather than req.params.docId, which could be a urlId.
    const assignmentId = getAssignmentId(this._docWorkerMap, docId === null ? 'import' : docId);

    if (!this._docWorkerMap) {
      throw new ApiError('no worker map', 404);
    }
    const docStatus = await this._docWorkerMap.assignDocWorker(assignmentId);

    // Construct new url by keeping only origin and path prefixes of `docWorker.internalUrl`,
    // and otherwise reflecting fully the original url (remaining path, and query params).
    const docWorkerUrl = new URL(docStatus.docWorker.internalUrl);
    const url = new URL(req.originalUrl, docWorkerUrl.origin);
    url.pathname = removeTrailingSlash(docWorkerUrl.pathname) + url.pathname;

    const headers: {[key: string]: string} = {
      ...getTransitiveHeaders(req),
      'Content-Type': req.get('Content-Type') || 'application/json',
    };
    for (const key of ['X-Sort', 'X-Limit']) {
      const hdr = req.get(key);
      if (hdr) { headers[key] = hdr; }
    }

    const controller = new AbortController();

    // If the original request is aborted, abort the forwarded request too. (Currently this only
    // affects some export/download requests which can abort long-running work.)
    addAbortHandler(req, res, () => controller.abort());

    const options: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
    };
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      // uses `req` as a stream
      options.body = req;
    }

    const docWorkerRes = await fetch(url.href, options);
    res.status(docWorkerRes.status);
    for (const key of ['content-type', 'content-disposition', 'cache-control']) {
      const value = docWorkerRes.headers.get(key);
      if (value) { res.set(key, value); }
    }
    return new Promise<void>((resolve, reject) => {
      docWorkerRes.body.on('error', reject);
      res.on('error', reject);
      res.on('finish', resolve);
      docWorkerRes.body.pipe(res);
    });
  }
}
