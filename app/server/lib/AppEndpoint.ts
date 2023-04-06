/**
 * AppServer serves up the main app.html file to the browser. It is the first point of contact of
 * a browser with Grist. It handles sessions, redirect-to-login, and serving up a suitable version
 * of the client-side code.
 */
import * as express from 'express';
import fetch, {Response as FetchResponse, RequestInit} from 'node-fetch';

import {ApiError} from 'app/common/ApiError';
import {getSlugIfNeeded, parseSubdomainStrictly, parseUrlId} from 'app/common/gristUrls';
import {removeTrailingSlash} from 'app/common/gutil';
import {LocalPlugin} from "app/common/plugin";
import {TelemetryTemplateSignupCookieName} from 'app/common/Telemetry';
import {Document as APIDocument} from 'app/common/UserAPI';
import {TEMPLATES_ORG_DOMAIN} from 'app/gen-server/ApiServer';
import {Document} from "app/gen-server/entity/Document";
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {assertAccess, getTransitiveHeaders, getUserId, isAnonymousUser,
        RequestWithLogin} from 'app/server/lib/Authorizer';
import {DocStatus, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import {expressWrap} from 'app/server/lib/expressWrap';
import {DocTemplate, GristServer} from 'app/server/lib/GristServer';
import {getCookieDomain} from 'app/server/lib/gristSessions';
import {getAssignmentId} from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import {adaptServerUrl, addOrgToPathIfNeeded, pruneAPIResult, trustOrigin} from 'app/server/lib/requestUtils';
import {ISendAppPageOptions} from 'app/server/lib/sendAppPage';

export interface AttachOptions {
  app: express.Application;                // Express app to which to add endpoints
  middleware: express.RequestHandler[];    // Middleware to apply for all endpoints except docs
  docMiddleware: express.RequestHandler[]; // Middleware to apply for doc landing pages
  forceLogin: express.RequestHandler|null; // Method to force user to login (if logins are possible)
  docWorkerMap: IDocWorkerMap|null;
  sendAppPage: (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => Promise<void>;
  dbManager: HomeDBManager;
  plugins: LocalPlugin[];
  gristServer: GristServer;
}

/**
 * This method transforms a doc worker's public url as needed based on the request.
 *
 * For historic reasons, doc workers are assigned a public url at the time
 * of creation.  In production/staging, this is of the form:
 *   https://doc-worker-NNN-NNN-NNN-NNN.getgrist.com/v/VVVV/
 * and in dev:
 *   http://localhost:NNNN/v/VVVV/
 *
 * Prior to support for different base domains, this was fine.  Now that different
 * base domains are supported, a wrinkle arises.  When a web client communicates
 * with a doc worker, it is important that it accesses the doc worker via a url
 * containing the same base domain as the web page the client is on (for cookie
 * purposes).  Hence this method.
 *
 * If both the request and docWorkerUrl contain identifiable base domains (not localhost),
 * then the base domain of docWorkerUrl is replaced with that of the request.
 *
 * But wait, there's another wrinkle: custom domains. In this case, we have a single
 * domain available to serve a particular org from. This method will use the origin of req
 * and include a /dw/doc-worker-NNN-NNN-NNN-NNN/
 * (or /dw/local-NNNN/) prefix in all doc worker paths.  Once this is in place, it
 * will allow doc worker routing to be changed so it can be overlaid on a custom
 * domain.
 *
 * TODO: doc worker registration could be redesigned to remove the assumption
 * of a fixed base domain.
 */
function customizeDocWorkerUrl(docWorkerUrlSeed: string|undefined, req: express.Request): string|null {
  if (!docWorkerUrlSeed) {
    // When no doc worker seed, we're in single server mode.
    // Return null, to signify that the URL prefix serving the
    // current endpoint is the only one available.
    return null;
  }
  const docWorkerUrl = new URL(docWorkerUrlSeed);
  const workerSubdomain = parseSubdomainStrictly(docWorkerUrl.hostname).org;
  adaptServerUrl(docWorkerUrl, req);

  // We wish to migrate to routing doc workers by path, so insert a doc worker identifier
  // in the path (if not already present).
  if (!docWorkerUrl.pathname.startsWith('/dw/')) {
    // When doc worker is localhost, the port number is necessary and sufficient for routing.
    // Let's add a /dw/... prefix just for consistency.
    const workerIdent = workerSubdomain || `local-${docWorkerUrl.port}`;
    docWorkerUrl.pathname = `/dw/${workerIdent}${docWorkerUrl.pathname}`;
  }
  return docWorkerUrl.href;
}

/**
 *
 * Gets the worker responsible for a given assignment, and fetches a url
 * from the worker.
 *
 * If the fetch fails, we throw an exception, unless we see enough evidence
 * to unassign the worker and try again.
 *
 *  - If GRIST_MANAGED_WORKERS is set, we assume that we've arranged
 *    for unhealthy workers to be removed automatically, and that if a
 *    fetch returns a 404 with specific content, it is proof that the
 *    worker is no longer in existence. So if we see a 404 with that
 *    specific content, we can safely de-list the worker from redis,
 *    and repeat.
 *  - If GRIST_MANAGED_WORKERS is not set, we accept a broader set
 *    of failures as evidence of a missing worker.
 *
 * The specific content of a 404 that will be treated as evidence of
 * a doc worker not being present is:
 *  - A json format body
 *  - With a key called "message"
 *  - With the value of "message" being "document worker not present"
 *  In production, this is provided by a special doc-worker-* load balancer
 *  rule.
 *
 */
async function getWorker(docWorkerMap: IDocWorkerMap, assignmentId: string,
                         urlPath: string, config: RequestInit = {}) {
  if (!useWorkerPool()) {
    // This should never happen. We are careful to not use getWorker
    // when everything is on a single server, since it is burdensome
    // for self-hosted users to figure out the correct settings for
    // the server to be able to contact itself, and there are cases
    // of the defaults not working.
    throw new Error("AppEndpoint.getWorker was called unnecessarily");
  }
  let docStatus: DocStatus|undefined;
  const workersAreManaged = Boolean(process.env.GRIST_MANAGED_WORKERS);
  for (;;) {
    docStatus = await docWorkerMap.assignDocWorker(assignmentId);
    const configWithTimeout = {timeout: 10000, ...config};
    const fullUrl = removeTrailingSlash(docStatus.docWorker.internalUrl) + urlPath;
    try {
      const resp: FetchResponse = await fetch(fullUrl, configWithTimeout);
      if (resp.ok) {
        return {
          resp,
          docStatus,
        };
      }
      if (resp.status === 403) {
        throw new ApiError("You do not have access to this document.", resp.status);
      }
      if (resp.status !== 404) {
        throw new ApiError(resp.statusText, resp.status);
      }
      let body: any;
      try {
        body = await resp.json();
      } catch (e) {
        throw new ApiError(resp.statusText, resp.status);
      }
      if (!(body && body.message && body.message === 'document worker not present')) {
        throw new ApiError(resp.statusText, resp.status);
      }
      // This is a 404 with the expected content for a missing worker.
    } catch (e) {
      log.rawDebug(`AppEndpoint.getWorker failure`, {
        url: fullUrl,
        docId: assignmentId,
        status: e.status,
        message: String(e),
        workerId: docStatus.docWorker.id,
      });
      // If workers are managed, no errors merit continuing except a 404.
      // Otherwise, we continue if we see a system error (e.g. ECONNREFUSED).
      // We don't accept timeouts since there is too much potential to
      // bring down a single-worker deployment that has a hiccup.
      if (workersAreManaged || !(e.type === 'system')) {
        throw e;
      }
    }
    log.warn(`fetch from ${fullUrl} failed convincingly, removing that worker`);
    await docWorkerMap.removeWorker(docStatus.docWorker.id);
    docStatus = undefined;
  }
}

export function attachAppEndpoint(options: AttachOptions): void {
  const {app, middleware, docMiddleware, docWorkerMap, forceLogin,
         sendAppPage, dbManager, plugins, gristServer} = options;
  // Per-workspace URLs open the same old Home page, and it's up to the client to notice and
  // render the right workspace.
  app.get(['/', '/ws/:wsId', '/p/:page'], ...middleware, expressWrap(async (req, res) =>
    sendAppPage(req, res, {path: 'app.html', status: 200, config: {plugins}, googleTagManager: 'anon'})));

  app.get('/api/worker/:assignmentId([^/]+)/?*', expressWrap(async (req, res) => {
    if (!useWorkerPool()) {
      // Let the client know there is not a separate pool of workers,
      // so they should continue to use the same base URL for accessing
      // documents. For consistency, return a prefix to add into that
      // URL, as there would be for a pool of workers. It would be nice
      // to go ahead and provide the full URL, but that requires making
      // more assumptions about how Grist is configured.
      // Alternatives could be: have the client to send their base URL
      // in the request; or use headers commonly added by reverse proxies.
      const selfPrefix =  "/dw/self/v/" + gristServer.getTag();
      res.json({docWorkerUrl: null, selfPrefix});
      return;
    }
    if (!trustOrigin(req, res)) { throw new Error('Unrecognized origin'); }
    res.header("Access-Control-Allow-Credentials", "true");

    if (!docWorkerMap) {
      return res.status(500).json({error: 'no worker map'});
    }
    const assignmentId = getAssignmentId(docWorkerMap, req.params.assignmentId);
    const {docStatus} = await getWorker(docWorkerMap, assignmentId, '/status');
    if (!docStatus) {
      return res.status(500).json({error: 'no worker'});
    }
    res.json({docWorkerUrl: customizeDocWorkerUrl(docStatus.docWorker.publicUrl, req)});
  }));

  // Handler for serving the document landing pages.  Expects the following parameters:
  //   urlId, slug (optional), remainder
  // This handler is used for both "doc/urlId" and "urlId/slug" style endpoints.
  const docHandler = expressWrap(async (req, res, next) => {
    if (req.params.slug && req.params.slug === 'app.html') {
      // This can happen on a single-port configuration, since "docId/app.html" matches
      // the "urlId/slug" pattern.  Luckily the "." character is not allowed in slugs.
      return next();
    }
    if (!docWorkerMap) {
      return await sendAppPage(req, res, {path: 'app.html', status: 200, config: {plugins},
                                          googleTagManager: 'anon'});
    }
    const mreq = req as RequestWithLogin;
    const urlId = req.params.urlId;
    let doc: Document|null = null;
    try {
      const userId = getUserId(mreq);

      // Query DB for the doc metadata, to include in the page (as a pre-fetch of getDoc() call),
      // and to get fresh (uncached) access info.
      doc = await dbManager.getDoc({userId, org: mreq.org, urlId});
      if (isAnonymousUser(mreq) && doc.type === 'tutorial') {
        // Tutorials require users to be signed in.
        throw new ApiError('You must be signed in to access a tutorial.', 403);
      }

      const slug = getSlugIfNeeded(doc);
      const slugMismatch = (req.params.slug || null) !== (slug || null);
      const preferredUrlId = doc.urlId || doc.id;
      if (urlId !== preferredUrlId || slugMismatch) {
        // Prepare to redirect to canonical url for document.
        // Preserve any query parameters or fragments.
        const queryOrFragmentCheck = req.originalUrl.match(/([#?].*)/);
        const queryOrFragment = (queryOrFragmentCheck && queryOrFragmentCheck[1]) || '';
        const target = slug ?
          `/${preferredUrlId}/${slug}${req.params.remainder}${queryOrFragment}` :
          `/doc/${preferredUrlId}${req.params.remainder}${queryOrFragment}`;
        res.redirect(addOrgToPathIfNeeded(req, target));
        return;
      }

      // The docAuth value will be cached from the getDoc() above (or could be derived from doc).
      const docAuth = await dbManager.getDocAuthCached({userId, org: mreq.org, urlId});
      assertAccess('viewers', docAuth);

    } catch (err) {
      if (err.status === 404) {
        log.info("/:urlId/app.html did not find doc", mreq.userId, urlId, doc && doc.access, mreq.org);
        throw new ApiError('Document not found.', 404);
      } else if (err.status === 403) {
        log.info("/:urlId/app.html denied access", mreq.userId, urlId, doc && doc.access, mreq.org);
        // If the user does not have access to the document, and is anonymous, and we
        // have a login system, we may wish to redirect them to login process.
        if (isAnonymousUser(mreq) && forceLogin) {
          // First check if anonymous user has access to this org.  If so, we don't propose
          // that they log in.  This is the same check made in redirectToLogin() middleware.
          const result = await dbManager.getOrg({userId: getUserId(mreq)}, mreq.org || null);
          if (result.status !== 200 || doc?.type === 'tutorial') {
            // Anonymous user does not have any access to this org, doc, or tutorial.
            // Redirect to log in.
            return forceLogin(req, res, next);
          }
        }
        throw new ApiError('You do not have access to this document.', 403);
      }
      throw err;
    }

    let body: DocTemplate;
    let docStatus: DocStatus|undefined;
    const docId = doc.id;
    if (!useWorkerPool()) {
      body = await gristServer.getDocTemplate();
    } else {
      // The reason to pass through app.html fetched from docWorker is in case it is a different
      // version of Grist (could be newer or older).
      // TODO: More must be done for correct version tagging of URLs: <base href> assumes all
      // links and static resources come from the same host, but we'll have Home API, DocWorker,
      // and static resources all at hostnames different from where this page is served.
      // TODO docWorkerMain needs to serve app.html, perhaps with correct base-href already set.
      const headers = {
        Accept: 'application/json',
        ...getTransitiveHeaders(req),
      };
      const workerInfo = await getWorker(docWorkerMap, docId, `/${docId}/app.html`, {headers});
      docStatus = workerInfo.docStatus;
      body = await workerInfo.resp.json();
    }

    const isPublic = ((doc as unknown) as APIDocument).public ?? false;
    const isSnapshot = parseUrlId(urlId).snapshotId;
    // TODO: Need a more precise way to identify a template. (This org now also has tutorials.)
    const isTemplate = TEMPLATES_ORG_DOMAIN === doc.workspace.org.domain && doc.type !== 'tutorial';
    if (isPublic || isTemplate) {
      gristServer.getTelemetryManager()?.logEvent('documentOpened', {
        docId,
        siteId: doc.workspace.org.id,
        siteType: doc.workspace.org.billingAccount.product.name,
        userId: mreq.userId,
        altSessionId: mreq.altSessionId,
        access: doc.access,
        isPublic,
        isSnapshot,
        isTemplate,
        lastUpdated: doc.updatedAt,
      });
    }

    if (isTemplate) {
      // Keep track of the last template a user visited in the last hour.
      // If a sign-up occurs within that time period, we'll know which
      // template, if any, was viewed most recently.
      const value = {
        isAnonymous: isAnonymousUser(mreq),
        templateId: docId,
      };
      res.cookie(TelemetryTemplateSignupCookieName, JSON.stringify(value), {
        maxAge: 1000 * 60 * 60,
        httpOnly: true,
        path: '/',
        domain: getCookieDomain(req),
        sameSite: 'lax',
      });
    }

    await sendAppPage(req, res, {path: "", content: body.page, tag: body.tag, status: 200,
                                 googleTagManager: 'anon', config: {
      assignmentId: docId,
      getWorker: {[docId]: customizeDocWorkerUrl(docStatus?.docWorker?.publicUrl, req)},
      getDoc: {[docId]: pruneAPIResult(doc as unknown as APIDocument)},
      plugins
    }});
  });
  // The * is a wildcard in express 4, rather than a regex symbol.
  // See https://expressjs.com/en/guide/routing.html
  app.get('/doc/:urlId([^/]+):remainder(*)', ...docMiddleware, docHandler);
  app.get('/:urlId([^/]{12,})/:slug([^/]+):remainder(*)',
          ...docMiddleware, docHandler);
}

// Return true if document related endpoints are served by separate workers.
function useWorkerPool() {
  return process.env.GRIST_SINGLE_PORT !== 'true';
}
