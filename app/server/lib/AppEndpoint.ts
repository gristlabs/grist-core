/**
 * AppServer serves up the main app.html file to the browser. It is the first point of contact of
 * a browser with Grist. It handles sessions, redirect-to-login, and serving up a suitable version
 * of the client-side code.
 */
import * as express from 'express';
import pick from 'lodash/pick';

import {ApiError} from 'app/common/ApiError';
import {getSlugIfNeeded, parseUrlId, SHARE_KEY_PREFIX} from 'app/common/gristUrls';
import {LocalPlugin} from "app/common/plugin";
import {TELEMETRY_TEMPLATE_SIGNUP_COOKIE_NAME} from 'app/common/Telemetry';
import {Document as APIDocument, PublicDocWorkerUrlInfo} from 'app/common/UserAPI';
import {Document} from "app/gen-server/entity/Document";
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {assertAccess, getTransitiveHeaders, getUserId, isAnonymousUser,
        RequestWithLogin} from 'app/server/lib/Authorizer';
import {DocStatus, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import {
  customizeDocWorkerUrl, getDocWorkerInfoOrSelfPrefix, getWorker, useWorkerPool
} from 'app/server/lib/DocWorkerUtils';
import {expressWrap} from 'app/server/lib/expressWrap';
import {DocTemplate, GristServer} from 'app/server/lib/GristServer';
import {getCookieDomain} from 'app/server/lib/gristSessions';
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

  app.get('/api/worker/:docId([^/]+)/?*', expressWrap(async (req, res) => {
    if (!trustOrigin(req, res)) { throw new Error('Unrecognized origin'); }
    res.header("Access-Control-Allow-Credentials", "true");

    const {selfPrefix, docWorker} = await getDocWorkerInfoOrSelfPrefix(
      req.params.docId, docWorkerMap, gristServer.getTag()
    );
    const info: PublicDocWorkerUrlInfo = selfPrefix ?
      { docWorkerUrl: null, docWorkerId: null, selfPrefix } :
      {
        docWorkerUrl: customizeDocWorkerUrl(docWorker!.publicUrl, req),
        docWorkerId: docWorker!.id,
        selfPrefix: null
      };
    return res.json(info);
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
        if (err.code === 'AUTH_DOC_DISABLED') {
          throw new ApiError(req.t("access.docDisabled"), 403);
        }

        throw new ApiError(req.t("access.docNoAccess"), 403);
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
        ...getTransitiveHeaders(req, { includeOrigin: true }),
      };
      const workerInfo = await getWorker(docWorkerMap, docId, `/${docId}/app.html`, {headers});
      docStatus = workerInfo.docStatus;
      body = await workerInfo.resp.json();
    }
    logOpenDocumentEvents(mreq, {server: gristServer, doc, urlId});
    if (doc.type === 'template') {
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

    // Without a public URL, we're in single server mode.
    // Use a null workerPublicURL, to signify that the URL prefix serving the
    // current endpoint is the only one available.
    const publicUrl = docStatus?.docWorker?.publicUrl;
    const workerPublicUrl = publicUrl !== undefined ? customizeDocWorkerUrl(publicUrl, req) : null;

    await sendAppPage(req, res, {path: "", content: body.page, tag: body.tag, status: 200,
                                 googleTagManager: 'anon', config: {
      assignmentId: docId,
      getWorker: {[docId]: workerPublicUrl },
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

function logOpenDocumentEvents(req: RequestWithLogin, options: {
  server: GristServer;
  doc: Document;
  urlId: string;
}) {
  const {server, doc, urlId} = options;
  const {forkId, snapshotId} = parseUrlId(urlId);
  server.getAuditLogger().logEvent(req, {
    action: "document.open",
    context: {
      site: pick(doc.workspace.org, "id", "name", "domain"),
    },
    details: {
      document: {
        ...pick(doc, "id", "name"),
        url_id: urlId,
        fork_id: forkId,
        snapshot_id: snapshotId,
      },
    },
  });

  const isPublic = ((doc as unknown) as APIDocument).public ?? false;
  const isTemplate = doc.type === 'template';
  if (isPublic || isTemplate) {
    server.getTelemetry().logEvent(req, 'documentOpened', {
      limited: {
        docIdDigest: doc.id,
        access: doc.access,
        isPublic,
        isSnapshot: Boolean(snapshotId),
        isTemplate,
        lastUpdated: doc.updatedAt,
      },
      full: {
        siteId: doc.workspace.org.id,
        siteType: doc.workspace.org.billingAccount.product.name,
        userId: req.userId,
        altSessionId: req.altSessionId,
      },
    });
  }
}
