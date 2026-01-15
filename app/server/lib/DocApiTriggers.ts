import { ApiError } from "app/common/ApiError";
import { timeoutReached } from "app/common/gutil";
import { SchemaTypes } from "app/common/schema";
import { WebhookFields, WebHookSecret } from "app/common/Triggers";
import TriggersTI from "app/common/Triggers-ti";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { GristObjCode } from "app/plugin/GristData";
import { ActiveDoc, colIdToRef as colIdToReference, getRealTableId, tableIdToRef } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { getMetaTables, handleSandboxError, validate, WithDocHandler } from "app/server/lib/DocApiUtils";
import { docSessionFromRequest } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { isUrlAllowed, WebhookAction } from "app/server/lib/Triggers";

import { Application, RequestHandler, Response } from "express";
import * as _ from "lodash";
import * as t from "ts-interface-checker";
import { v4 as uuidv4 } from "uuid";

// Maximum amount of time that a webhook endpoint can hold the mutex for in withDocTriggersLock.
const MAX_DOC_TRIGGERS_LOCK_MS = 15_000;

export interface WebhookSubscription {
  unsubscribeKey: string;
  webhookId: string;
}

// Schema validators for api endpoints that creates or updates records.
const {
  WebhookPatch,
  WebhookSubscribe,
  WebhookSubscribeCollection,
} = t.createCheckers(TriggersTI);

export class DocApiTriggers {
  constructor(
    private _app: Application,
    private _dbManager: HomeDBManager,
  ) {}

  /**
   * Adds endpoints for the doc api.
   *
   * Note that it expects bodyParser, userId, and jsonErrorHandler middleware to be set up outside
   * to apply to these routes.
   */
  public addEndpoints(options: {
    withDoc: (callback: WithDocHandler) => RequestHandler,
    checkOwner: (req: RequestWithLogin) => Promise<boolean>,
    middlewares: {
      isOwner: RequestHandler;
      canEdit: RequestHandler;
    },
  }) {
    const { isOwner, canEdit } = options.middlewares;
    const { withDoc, checkOwner } = options;

    // Like withDoc, but only one such callback can run at a time per active doc.
    // This is used for webhook endpoints to prevent simultaneous changes to configuration
    // or clearing queues which could lead to weird problems.
    const withDocTriggersLock = (callback: WithDocHandler) => withDoc(
      async (activeDoc: ActiveDoc, req: RequestWithLogin, resp: Response) =>
        await activeDoc.triggersLock.runExclusive(async () => {
          // We don't want to hold the mutex indefinitely so that if one call gets stuck
          // (especially while trying to apply user actions which are stalled by a full queue)
          // another call which would clear a queue, disable a webhook, or fix something related
          // can eventually succeed.
          if (await timeoutReached(MAX_DOC_TRIGGERS_LOCK_MS, callback(activeDoc, req, resp), { rethrow: true })) {
            log.rawError(`Webhook endpoint timed out, releasing mutex`,
              { method: req.method, path: req.path, docId: activeDoc.docName });
          }
        }),
    );

    const registerWebhook = async (activeDoc: ActiveDoc, req: RequestWithLogin, webhook: WebhookFields) => {
      if (activeDoc.isFork) {
        throw new ApiError("Unsaved document copies cannot have webhooks", 400);
      }

      const { fields, url, authorization } = await getWebhookSettings(activeDoc, req, null, webhook);
      if (!fields.eventTypes?.length) {
        throw new ApiError(`eventTypes must be a non-empty array`, 400);
      }
      if (!isUrlAllowed(url)) {
        throw new ApiError("Provided url is forbidden", 403);
      }
      if (!fields.tableRef) {
        throw new ApiError(`tableId is required`, 400);
      }

      const unsubscribeKey = uuidv4();
      const webhookSecret: WebHookSecret = { unsubscribeKey, url, authorization };
      const secretValue = JSON.stringify(webhookSecret);
      const webhookId = (await this._dbManager.addSecret(secretValue, activeDoc.docName)).id;

      try {
        const webhookAction: WebhookAction = { type: "webhook", id: webhookId };
        const sandboxRes = await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
          docSessionFromRequest(req),
          [["AddRecord", "_grist_Triggers", null, {
            enabled: true,
            ...fields,
            actions: JSON.stringify([webhookAction]),
          }]]));
        return {
          unsubscribeKey,
          triggerId: sandboxRes.retValues[0],
          webhookId,
        };
      }
      catch (err) {
        // remove webhook
        await this._dbManager.removeWebhook(webhookId, activeDoc.docName, "", false);
        throw err;
      }
      finally {
        await activeDoc.sendWebhookNotification();
      }
    };

    function getWebhookTriggerRecord(activeDoc: ActiveDoc, webhookId: string) {
      const docData = activeDoc.docData!;
      const triggersTable = docData.getMetaTable("_grist_Triggers");
      const trigger = triggersTable.getRecords().find((t) => {
        const actions: any[] = JSON.parse((t.actions || "[]") as string);
        return actions.some(action => action.id === webhookId && action?.type === "webhook");
      });
      if (!trigger) {
        throw new ApiError(`Webhook not found "${webhookId || ""}"`, 404);
      }
      return trigger;
    }

    const removeWebhook = async (activeDoc: ActiveDoc, req: RequestWithLogin, res: Response) => {
      const { unsubscribeKey } = req.body as WebhookSubscription;
      const webhookId = req.params.webhookId ?? req.body.webhookId;

      // owner does not need to provide unsubscribeKey
      const checkKey = !(await checkOwner(req));
      const triggerRowId = getWebhookTriggerRecord(activeDoc, webhookId).id;
      // Validate unsubscribeKey before deleting trigger from document
      await this._dbManager.removeWebhook(webhookId, activeDoc.docName, unsubscribeKey, checkKey);
      activeDoc.webhookQueue.clearWebhookCache(webhookId);

      await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
        docSessionFromRequest(req),
        [["RemoveRecord", "_grist_Triggers", triggerRowId]]));

      await activeDoc.sendWebhookNotification();

      res.json({ success: true });
    };

    async function getWebhookSettings(activeDoc: ActiveDoc, req: RequestWithLogin,
      webhookId: string | null, webhook: WebhookFields) {
      const metaTables = await getMetaTables(activeDoc, req);
      const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
      const trigger = webhookId ? getWebhookTriggerRecord(activeDoc, webhookId) : undefined;
      let currentTableId = trigger ? tablesTable.getValue(trigger.tableRef, "tableId")! : undefined;
      const { url, authorization, eventTypes, watchedColIds, isReadyColumn, name } = webhook;
      const tableId = await getRealTableId(req.params.tableId || webhook.tableId, { metaTables });

      const fields: Partial<SchemaTypes["_grist_Triggers"]> = {};

      if (url && !isUrlAllowed(url)) {
        throw new ApiError("Provided url is forbidden", 403);
      }

      if (eventTypes) {
        if (!eventTypes.length) {
          throw new ApiError(`eventTypes must be a non-empty array`, 400);
        }
        fields.eventTypes = [GristObjCode.List, ...eventTypes];
      }

      if (tableId !== undefined) {
        if (watchedColIds) {
          if (tableId !== currentTableId && currentTableId) {
            // if the tableId changed, we need to reset the watchedColIds
            fields.watchedColRefList = [GristObjCode.List];
          }
          else {
            if (!tableId) {
              throw new ApiError(`Cannot find columns "${watchedColIds}" because table is not known`, 404);
            }
            fields.watchedColRefList = [GristObjCode.List, ...watchedColIds
              .filter(colId => colId.trim() !== "")
              .map(
                (colId) => { return colIdToReference(metaTables, tableId, colId.trim().replace(/^\$/, "")); },
              )];
          }
        }
        else {
          fields.watchedColRefList = [GristObjCode.List];
        }
        fields.tableRef = tableIdToRef(metaTables, tableId);
        currentTableId = tableId;
      }

      if (isReadyColumn !== undefined) {
        // When isReadyColumn is defined let's explicitly change the ready column to the new col
        // id, null or empty string being a special case that unsets it.
        if (isReadyColumn !== null && isReadyColumn !== "") {
          if (!currentTableId) {
            throw new ApiError(`Cannot find column "${isReadyColumn}" because table is not known`, 404);
          }
          fields.isReadyColRef = colIdToReference(metaTables, currentTableId, isReadyColumn);
        }
        else {
          fields.isReadyColRef = 0;
        }
      }
      else if (tableId) {
        // When isReadyColumn is undefined but tableId was changed, let's unset the ready column
        fields.isReadyColRef = 0;
      }

      // assign other field properties
      Object.assign(fields, _.pick(webhook, ["enabled", "memo"]));
      if (name) {
        fields.label = name;
      }
      return {
        fields,
        url,
        authorization,
      };
    }

    // Add a new webhook and trigger
    this._app.post("/api/docs/:docId/webhooks", isOwner, validate(WebhookSubscribeCollection),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const registeredWebhooks: WebhookSubscription[] = [];
        for (const webhook of req.body.webhooks) {
          const registeredWebhook = await registerWebhook(activeDoc, req, webhook.fields);
          registeredWebhooks.push(registeredWebhook);
        }
        res.json({ webhooks: registeredWebhooks.map((rw) => {
          return { id: rw.webhookId };
        }) });
      }),
    );

    /**
     @deprecated please call to POST /webhooks instead, this endpoint is only for sake of backward
        compatibility
     */
    this._app.post("/api/docs/:docId/tables/:tableId/_subscribe", isOwner, validate(WebhookSubscribe),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const registeredWebhook = await registerWebhook(activeDoc, req, req.body);
        res.json(registeredWebhook);
      }),
    );

    // Clears all outgoing webhooks in the queue for this document.
    this._app.delete("/api/docs/:docId/webhooks/queue", isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        await activeDoc.clearWebhookQueue();
        await activeDoc.sendWebhookNotification();
        this._logClearAllWebhookQueueEvents(activeDoc, req);
        res.json({ success: true });
      }),
    );

    // Remove webhook and trigger created above
    this._app.delete("/api/docs/:docId/webhooks/:webhookId", isOwner,
      withDocTriggersLock(removeWebhook),
    );

    /**
     @deprecated please call to DEL /webhooks instead, this endpoint is only for sake of backward
        compatibility
     */
    this._app.post("/api/docs/:docId/tables/:tableId/_unsubscribe", canEdit,
      withDocTriggersLock(removeWebhook),
    );

    // Update a webhook
    this._app.patch(
      "/api/docs/:docId/webhooks/:webhookId", isOwner, validate(WebhookPatch),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const docId = activeDoc.docName;
        const webhookId = req.params.webhookId;
        const { fields, url, authorization } = await getWebhookSettings(activeDoc, req, webhookId, req.body);
        if (fields.enabled === false) {
          await activeDoc.clearSingleWebhookQueue(webhookId);
        }

        const triggerRowId = getWebhookTriggerRecord(activeDoc, webhookId).id;

        // update url and authorization header in homedb
        if (url || authorization) {
          await this._dbManager.updateWebhookUrlAndAuth({ id: webhookId, docId, url, auth: authorization });
          activeDoc.webhookQueue.clearWebhookCache(webhookId); // clear cache
        }

        // then update document
        if (Object.keys(fields).length) {
          await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
            docSessionFromRequest(req),
            [["UpdateRecord", "_grist_Triggers", triggerRowId, fields]]));
        }

        await activeDoc.sendWebhookNotification();

        res.json({ success: true });
      }),
    );

    // Clears a single webhook in the queue for this document.
    this._app.delete("/api/docs/:docId/webhooks/queue/:webhookId", isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        const webhookId = req.params.webhookId;
        await activeDoc.clearSingleWebhookQueue(webhookId);
        await activeDoc.sendWebhookNotification();
        this._logClearWebhookQueueEvents(activeDoc, req, webhookId);
        res.json({ success: true });
      }),
    );

    // Lists all webhooks and their current status in the document.
    this._app.get("/api/docs/:docId/webhooks", isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        res.json(await activeDoc.webhooksSummary());
      }),
    );
  }

  private _logClearWebhookQueueEvents(
    activeDoc: ActiveDoc,
    req: RequestWithLogin,
    webhookId: string,
  ) {
    const document = activeDoc.doc || { id: activeDoc.docName };
    activeDoc.logAuditEvent(req, {
      action: "document.clear_webhook_queue",
      details: {
        document: _.pick(document, "id"),
        webhook: {
          id: webhookId,
        },
      },
    });
  }

  private _logClearAllWebhookQueueEvents(
    activeDoc: ActiveDoc,
    req: RequestWithLogin,
  ) {
    const document = activeDoc.doc || { id: activeDoc.docName };
    activeDoc.logAuditEvent(req, {
      action: "document.clear_all_webhook_queues",
      details: {
        document: _.pick(document, "id"),
      },
    });
  }
}
