/**
 * AppServer serves up the main app.html file to the browser. It is the first point of contact of
 * a browser with Grist. It handles sessions, redirect-to-login, and serving up a suitable version
 * of the client-side code.
 */
import * as express from 'express';

import {ApiError} from 'app/common/ApiError';
import {getSlugIfNeeded, parseUrlId, SHARE_KEY_PREFIX} from 'app/common/gristUrls';
import {LocalPlugin} from "app/common/plugin";
import {TELEMETRY_TEMPLATE_SIGNUP_COOKIE_NAME} from 'app/common/Telemetry';
import {Document as APIDocument} from 'app/common/UserAPI';
import {Document} from "app/gen-server/entity/Document";
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {assertAccess, getTransitiveHeaders, getUserId, isAnonymousUser,
        RequestWithLogin} from 'app/server/lib/Authorizer';
import {DocStatus, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import {customizeDocWorkerUrl, getWorker, useWorkerPool} from 'app/server/lib/DocWorkerUtils';
import {expressWrap} from 'app/server/lib/expressWrap';
import {DocTemplate, GristServer} from 'app/server/lib/GristServer';
import {getCookieDomain} from 'app/server/lib/gristSessions';
import {getAssignmentId} from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import {addOrgToPathIfNeeded, pruneAPIResult, trustOrigin} from 'app/server/lib/requestUtils';
import {ISendAppPageOptions} from 'app/server/lib/sendAppPage';

export interface AttachOptions {
  app: express.Application;                 // Express app to which to add endpoints
  middleware: express.RequestHandler[];     // Middleware to apply for all endpoints except docs and forms
  docMiddleware: express.RequestHandler[];  // Middleware to apply for doc landing pages
  formMiddleware: express.RequestHandler[]; // Middleware to apply for form landing pages
  forceLogin: express.RequestHandler|null;  // Method to force user to login (if logins are possible)
  docWorkerMap: IDocWorkerMap|null;
  sendAppPage: (req: express.Request, resp: express.Response, options: ISendAppPageOptions) => Promise<void>;
  dbManager: HomeDBManager;
  plugins: LocalPlugin[];
  gristServer: GristServer;
}

export function attachAppEndpoint(options: AttachOptions): void {
  const {app, middleware, docMiddleware, formMiddleware, docWorkerMap,
         forceLogin, sendAppPage, dbManager, plugins, gristServer} = options;
  // Per-workspace URLs open the same old Home page, and it's up to the client to notice and
  // render the right workspace.
  app.get(['/', '/ws/:wsId', '/p/:page'], ...middleware, expressWrap(async (req, res) =>
    sendAppPage(req, res, {path: 'app.html', status: 200, config: {plugins}, googleTagManager: 'anon'})));

  app.get('/apiconsole', expressWrap(async (req, res) =>
    sendAppPage(req, res, {path: 'apiconsole.html', status: 200, config: {}})));

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
      if (!req.params.viaShare &&  // Don't bother canonicalizing for shares yet.
          (urlId !== preferredUrlId || slugMismatch)) {
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
    const isSnapshot = Boolean(parseUrlId(urlId).snapshotId);
    const isTemplate = doc.type === 'template';
    if (isPublic || isTemplate) {
      gristServer.getTelemetry().logEvent(mreq, 'documentOpened', {
        limited: {
          docIdDigest: docId,
          access: doc.access,
          isPublic,
          isSnapshot,
          isTemplate,
          lastUpdated: doc.updatedAt,
        },
        full: {
          siteId: doc.workspace.org.id,
          siteType: doc.workspace.org.billingAccount.product.name,
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
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
      res.cookie(TELEMETRY_TEMPLATE_SIGNUP_COOKIE_NAME, JSON.stringify(value), {
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
  // Handlers for form preview URLs: one with a slug and one without.
  app.get('/doc/:urlId([^/]+)/f/:vsId', ...docMiddleware, expressWrap(async (req, res) => {
    return sendAppPage(req, res, {path: 'form.html', status: 200, config: {}, googleTagManager: 'anon'});
  }));
  app.get('/:urlId([^-/]{12,})/:slug([^/]+)/f/:vsId', ...docMiddleware, expressWrap(async (req, res) => {
    return sendAppPage(req, res, {path: 'form.html', status: 200, config: {}, googleTagManager: 'anon'});
  }));
  // Handler for form URLs that include a share key.
  app.get('/forms/:shareKey([^/]+)/:vsId', ...formMiddleware, expressWrap(async (req, res) => {
    return sendAppPage(req, res, {path: 'form.html', status: 200, config: {}, googleTagManager: 'anon'});
  }));
  // The * is a wildcard in express 4, rather than a regex symbol.
  // See https://expressjs.com/en/guide/routing.html
  app.get('/doc/:urlId([^/]+):remainder(*)', ...docMiddleware, docHandler);
  app.get('/s/:urlId([^/]+):remainder(*)',
          (req, res, next) => {
            // /s/<key> is another way of writing /doc/<prefix><key> for shares.
            req.params.urlId = SHARE_KEY_PREFIX + req.params.urlId;
            req.params.viaShare = "1";
            next();
          },
          ...docMiddleware, docHandler);
  app.get('/:urlId([^-/]{12,})(/:slug([^/]+):remainder(*))?',
          ...docMiddleware, docHandler);
}
