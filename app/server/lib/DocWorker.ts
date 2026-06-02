/**
 * DocWorker collects the methods and endpoints that relate to a single Grist document.
 * In hosted environment, this comprises the functionality of the DocWorker instance type.
 */

import { isAffirmative } from "app/common/gutil";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { assertAccess, getOrSetDocAuth, RequestWithLogin } from "app/server/lib/Authorizer";
import { Client } from "app/server/lib/Client";
import { Comm } from "app/server/lib/Comm";
import { DocApiUsageTracker } from "app/server/lib/DocApiUsageTracker";
import { DocSession, docSessionFromRequest } from "app/server/lib/DocSession";
import { filterDocumentInPlace } from "app/server/lib/filterUtils";
import { GristServer } from "app/server/lib/GristServer";
import { IDocStorageManager } from "app/server/lib/IDocStorageManager";
import log from "app/server/lib/log";
import {
  getDocId, getExtraAttachmentOptions, integerParam,
  optStringParam, stringParam,
} from "app/server/lib/requestUtils";

import * as path from "path";

import contentDisposition from "content-disposition";
import * as express from "express";
import * as fse from "fs-extra";
import * as mimeTypes from "mime-types";

export interface AttachOptions {
  comm: Comm;                             // Comm object for methods called via websocket
  gristServer: GristServer;
  tracker?: DocApiUsageTracker;           // Shared API usage tracker for rate-limiting
}

export class DocWorker {
  private _comm: Comm;
  private _gristServer: GristServer;
  private _tracker?: DocApiUsageTracker;
  constructor(private _dbManager: HomeDBManager, options: AttachOptions) {
    this._comm = options.comm;
    this._gristServer = options.gristServer;
    this._tracker = options.tracker;
  }

  public async getAttachment(req: express.Request, res: express.Response): Promise<void> {
    try {
      const docSession = this._getDocSession(stringParam(req.query.clientId, "clientId"),
        integerParam(req.query.docFD, "docFD"));
      const activeDoc = docSession.activeDoc;
      const options = getExtraAttachmentOptions(req);
      const attId = integerParam(req.query.attId, "attId");
      // Access control is done in getAttachmentData, below.
      // It can be expensive, if only the attId is available,
      // so only do it once. Important to review that information
      // from attRecord doesn't leak. getAttachmentData should
      // throw before anything is returned to the user, if they
      // don't have access to the attachment.
      const attRecord = activeDoc.getAttachmentMetadataWithoutAccessControl(attId);
      const ext = path.extname(attRecord.fileIdent);
      const type = mimeTypes.lookup(ext);

      let inline = Boolean(req.query.inline);
      // Serving up user-uploaded HTML files inline is an open door to XSS attacks.
      if (type === "text/html") { inline = false; }

      // Construct a content-disposition header of the form 'inline|attachment; filename="NAME"'
      const contentDispType = inline ? "inline" : "attachment";
      const contentDispHeader = contentDisposition(stringParam(req.query.name, "name"), { type: contentDispType });
      const data = await activeDoc.getAttachmentData(docSession, attRecord, options);
      res.status(200)
        .type(ext)
        .set("Content-Disposition", contentDispHeader)
        .set("Cache-Control", "private, max-age=3600")
        .set("Content-Security-Policy", "sandbox; default-src: 'none'")
        .send(data);
    } catch (err) {
      res.status(404).send({ error: err.toString() });
    }
  }

  public async downloadDoc(req: express.Request, res: express.Response,
    storageManager: IDocStorageManager, filename: string): Promise<void> {
    const mreq = req as RequestWithLogin;
    const docId = getDocId(mreq);

    // Get a copy of document for downloading.
    const tmpPath = await storageManager.getCopy(docId);
    let removeData: boolean = false;
    let removeHistory: boolean = false;
    if (isAffirmative(req.query.template)) {
      removeData = removeHistory = true;
    } else if (isAffirmative(req.query.nohistory)) {
      removeHistory = true;
    }

    await filterDocumentInPlace(docSessionFromRequest(mreq), tmpPath, {
      removeData,
      removeHistory,
      removeFullCopiesSpecialRight: true,
      markAction: true,
    });
    // NOTE: We may want to reconsider the mimeType used for Grist files.
    return res.type("application/x-sqlite3")
      .download(
        tmpPath,
        filename + ".grist",
        async (err: any) => {
          if (err) {
            if (err.message && /Request aborted/.test(err.message)) {
              log.warn(`Download request aborted for doc ${docId}`, err);
            } else {
              log.error(`Download failure for doc ${docId}`, err);
            }
          }
          await fse.unlink(tmpPath);
        },
      );
  }

  // Register main methods related to documents.
  public registerCommCore(): void {
    const comm = this._comm;
    const tracker = this._tracker;
    const method = activeDocMethod.bind(null, tracker);
    comm.registerMethods({
      closeDoc: method(null, "closeDoc"),
      fetchTable: method("viewers", "fetchTable"),
      fetchPythonCode: method("viewers", "fetchPythonCode"),
      useQuerySet: method("viewers", "useQuerySet"),
      disposeQuerySet: method("viewers", "disposeQuerySet"),
      applyUserActions: method("editors", "applyUserActions"),
      applyUserActionsById: method("editors", "applyUserActionsById"),
      findColFromValues: method("viewers", "findColFromValues"),
      getFormulaError: method("viewers", "getFormulaError"),
      importFiles: method("editors", "importFiles"),
      finishImportFiles: method("editors", "finishImportFiles"),
      cancelImportFiles: method("editors", "cancelImportFiles"),
      generateImportDiff: method("editors", "generateImportDiff"),
      addAttachments: method("editors", "addAttachments"),
      startBundleUserActions: method("editors", "startBundleUserActions"),
      stopBundleUserActions: method("editors", "stopBundleUserActions"),
      autocomplete: method("viewers", "autocomplete"),
      fetchURL: method("viewers", "fetchURL"),
      getActionSummaries: method("viewers", "getActionSummaries"),
      reloadDoc: method("editors", "reloadDoc"),
      fork: method("viewers", "fork"),
      checkAclFormula: method("viewers", "checkAclFormula"),
      getAclResources: method("viewers", "getAclResources"),
      waitForInitialization: method("viewers", "waitForInitialization"),
      getUsersForViewAs: method("viewers", "getUsersForViewAs"),
      getAccessToken: method("viewers", "getAccessToken"),
      getShare: method("owners", "getShare"),
      startTiming: method("owners", "startTiming"),
      stopTiming: method("owners", "stopTiming"),
      getAssistantState: method("owners", "getAssistantState"),
      listActiveUserProfiles: method(null, "listActiveUserProfiles"),
      applyProposal: method("owners", "applyProposal"),
      getAssistance: method("viewers", "getAssistance"),
    });
  }

  // Register methods related to plugins.
  public registerCommPlugin(): void {
    const method = activeDocMethod.bind(null, this._tracker);
    this._comm.registerMethods({
      forwardPluginRpc: method("editors", "forwardPluginRpc"),
      // TODO: consider not providing reloadPlugins on hosted grist, since it affects the
      // plugin manager shared across docs on a given doc worker, and seems useful only in
      // standalone case.
      reloadPlugins: method("editors", "reloadPlugins"),
    });
  }

  // Checks that document is accessible, and adds docAuth information to request.
  // Otherwise issues a 403 access denied.
  // (This is used for endpoints like /download, /gen-csv, /attachment.)
  public async assertDocAccess(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const mreq = req as RequestWithLogin;
    let urlId: string | undefined;
    try {
      if (optStringParam(req.query.clientId, "clientId")) {
        const activeDoc = this._getDocSession(stringParam(req.query.clientId, "clientId"),
          integerParam(req.query.docFD, "docFD")).activeDoc;
        // TODO: The docId should be stored in the ActiveDoc class. Currently docName is
        // used instead, which will coincide with the docId for hosted grist but not for
        // standalone grist.
        urlId = activeDoc.docName;
      } else {
        // Otherwise, if being used without a client, expect the doc query parameter to
        // be the docId.
        urlId = stringParam(req.query.doc, "doc");
      }
      if (!urlId) { return res.status(403).send({ error: "missing document id" }); }

      const docAuth = await getOrSetDocAuth(mreq, this._dbManager, this._gristServer, urlId);
      assertAccess("viewers", docAuth);
      next();
    } catch (err) {
      log.info(`DocWorker can't access document ${urlId} with userId ${mreq.userId}: ${err}`);
      res.status(err.status || 404).send({ error: err.toString() });
    }
  }

  private _getDocSession(clientId: string, docFD: number): DocSession {
    const client = this._comm.getClient(clientId);
    return client.getDocSession(docFD);
  }
}

/**
 * Translates calls from the browser client into calls of the form
 * `activeDoc.method(docSession, ...args)`.
 *
 * When a tracker is provided and the client authenticated via API key,
 * enforces the same parallel and daily usage limits as the REST API.
 */
function activeDocMethod(tracker: DocApiUsageTracker | undefined,
  role: "viewers" | "editors" | "owners" | null, methodName: string) {
  return async (client: Client, docFD: number, ...args: any[]): Promise<any> => {
    const docSession = client.getDocSession(docFD);
    const activeDoc = docSession.activeDoc;
    if (role) { await docSession.authorizer.assertAccess(role); }
    // Include a basic log record for each ActiveDoc method call.
    log.rawDebug("activeDocMethod", activeDoc.getLogMeta(docSession, methodName));

    if (tracker && client.authSession.isApiKeyAuth) {
      let dailyMax: number | undefined;
      if (role) {
        // assertAccess was already called above, so getCachedAuth() is available.
        const cachedDoc = docSession.authorizer.getCachedAuth().cachedDoc;
        dailyMax = cachedDoc?.workspace?.org?.billingAccount
          ?.getEffectiveFeatures()?.baseMaxApiUnitsPerDocumentPerDay;
      }
      // acquire + method call are in the same try so release runs even if acquire throws
      // (acquire increments the parallel counter before checking limits).
      try {
        tracker.acquire(activeDoc.docName, dailyMax);
        return await (activeDoc as any)[methodName](docSession, ...args);
      } finally {
        tracker.release(activeDoc.docName);
      }
    }

    return (activeDoc as any)[methodName](docSession, ...args);
  };
}
