import { ApiError } from "app/common/ApiError";
import { safeJsonParse, timeoutReached } from "app/common/gutil";
import { SchemaTypes } from "app/common/schema";
import {
  ActionSecretData,
  TriggerAction,
  TriggerAddRequest,
  TriggerDeletionRequest,
  TriggerUpdateRequest,
  WebhookAction,
  WebhookFields,
  WebHookSecret,
} from "app/common/Triggers";
import TriggersTI from "app/common/Triggers-ti";
import {
  TriggerDeliveryRecord,
  TriggerMonitorResponse,
  TriggerPendingRecord,
} from "app/common/UserAPI";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { GristObjCode } from "app/plugin/GristData";
import { ActiveDoc, colIdToRef as colIdToReference, getRealTableId, tableIdToRef } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { getMetaTables, handleSandboxError, validate, WithDocHandler } from "app/server/lib/DocApiUtils";
import { docSessionFromRequest } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { isUrlAllowed } from "app/server/lib/Triggers";

import { Application, RequestHandler, Response } from "express";
import * as _ from "lodash";
import * as t from "ts-interface-checker";
import { v4 as uuidv4 } from "uuid";

// Maximum amount of time that a webhook endpoint can hold the mutex for in withDocTriggersLock.
const MAX_DOC_TRIGGERS_LOCK_MS = 15_000;

/**
 * Field names on action objects that are considered secret and should be stored
 * in homeDB rather than inline in the document. On write (POST/PATCH), these
 * fields are extracted from the action and saved as a homeDB secret. On read
 * (GET), they are fetched from homeDB and merged back into the action.
 */
const ACTION_SECRET_FIELDS = ["url", "authorization", "unsubscribeKey"] as const;

/** Action types that store secret fields in homeDB (e.g. webhook stores url/authorization). */
const ACTION_TYPES_WITH_SECRETS = new Set(["webhook"]);

/**
 * Parse an actions value (string or array) into an array of action objects.
 */
function parseActions(actions: string | TriggerAction[] | undefined | null): TriggerAction[] {
  if (!actions) { return []; }
  if (typeof actions === "string") {
    return safeJsonParse(actions, []);
  }
  return Array.isArray(actions) ? actions : [];
}

// Schema checker for validating individual trigger actions against TriggerAction union type.
const TriggerActionChecker = t.createCheckers(TriggersTI).TriggerAction;

/**
 * Validate that each action in the array conforms to the TriggerAction schema.
 * Throws ApiError(400) if any action is malformed.
 *
 * Actions from the client may not have an `id` yet (assigned server-side),
 * so we default it to "" before checking the schema.
 */
function validateActions(actions: unknown[]): asserts actions is TriggerAction[] {
  for (const action of actions) {
    try {
      // id is assigned server-side; default to "" so the schema check passes.
      const obj = typeof action === "object" && action ? action : {};
      TriggerActionChecker.check({ id: "", ...obj });
    } catch (e) {
      throw new ApiError(`Invalid trigger action: ${e}`, 400);
    }
  }
}

/**
 * Split an action into a doc-stored part (without secrets) and a secret-data part.
 */
function extractSecrets(action: TriggerAction | ActionSecretData): {
  docAction: TriggerAction;
  secretData: ActionSecretData;
} {
  const docAction: Record<string, unknown> = {};
  const secretData: ActionSecretData = {};
  for (const [key, value] of Object.entries(action)) {
    if ((ACTION_SECRET_FIELDS as readonly string[]).includes(key)) {
      (secretData as Record<string, unknown>)[key] = value;
    } else {
      docAction[key] = value;
    }
  }
  return { docAction: docAction as unknown as TriggerAction, secretData };
}

/**
 * Validate that a webhook action's URL is allowed by the server configuration.
 * Throws 403 if the URL is present but forbidden.
 */
function validateActionUrl(action: TriggerAction & ActionSecretData): void {
  if (action.type !== "webhook") { return; }
  const url = "url" in action && action.url;
  if (typeof url === "string" && !isUrlAllowed(url)) {
    throw new ApiError("Provided url is forbidden", 403);
  }
}

/**
 * Create a new homeDB secret for an action's secret fields.
 * Returns the cleaned action with a server-generated `id` (the homeDB secret key).
 * If the action has no secret fields, returns it with a generated UUID id.
 *
 * Note: any user-supplied `id` is ignored on creation — IDs are always server-generated
 * to prevent storing secrets with non-standard or insecure keys.
 */
async function createActionSecret(
  action: TriggerAction & ActionSecretData,
  dbManager: HomeDBManager,
  docId: string,
): Promise<TriggerAction> {
  validateActionUrl(action);
  const { docAction, secretData } = extractSecrets(action);
  if (Object.keys(secretData).length === 0) {
    // No secret fields (e.g. email actions) — always assign a server-generated id.
    return { ...docAction, id: uuidv4() };
  }
  // Always generate an unsubscribeKey when creating a new secret
  if (!secretData.unsubscribeKey) {
    secretData.unsubscribeKey = uuidv4();
  }
  const secret = await dbManager.addSecret(JSON.stringify(secretData), docId);
  return { ...docAction, id: secret.id };
}

/**
 * Update an existing homeDB secret for an action that already has an `id`.
 * Reads the current secret, merges in any changed secret fields, writes it back.
 * Returns the sanitized action with secret fields stripped out (only type + id remain
 * for actions with secrets).
 */
async function extractAndUpdateActionSecret(
  action: TriggerAction & Record<string, unknown>,
  dbManager: HomeDBManager,
  docId: string,
): Promise<TriggerAction> {
  if (!action.id || !ACTION_TYPES_WITH_SECRETS.has(action.type)) { return action; }
  validateActionUrl(action);
  const { docAction, secretData } = extractSecrets(action);
  if (Object.keys(secretData).length > 0) {
    // Read existing secret, merge updated fields, and write back
    const existing = await dbManager.getSecret(action.id, docId);
    const existingData: ActionSecretData = existing ? JSON.parse(existing) : {};
    const merged = { ...existingData, ...secretData };
    await dbManager.updateSecret(action.id, docId, JSON.stringify(merged));
  }
  return docAction;
}

/**
 * Load secrets from homeDB and merge them back into the action for API responses.
 * If the action has no id or the secret is not found, returns unchanged.
 */
async function loadActionSecrets(
  action: TriggerAction,
  dbManager: HomeDBManager,
  docId: string,
): Promise<TriggerAction & ActionSecretData> {
  if (!action.id || !ACTION_TYPES_WITH_SECRETS.has(action.type)) { return action; }
  const secretValue = await dbManager.getSecret(action.id, docId);
  if (!secretValue) { return action; }
  try {
    const secretData: ActionSecretData = JSON.parse(secretValue);
    return { ...action, ...secretData };
  } catch (e) {
    log.warn(`Failed to parse secret data for action ${action.id}: ${e}`);
    return action;
  }
}

/**
 * Remove a secret from homeDB for an action. No-op if the action has no id
 * or if its type doesn't use homeDB secrets.
 */
async function removeSecret(
  action: TriggerAction,
  dbManager: HomeDBManager,
  docId: string,
): Promise<void> {
  if (!action.id || !ACTION_TYPES_WITH_SECRETS.has(action.type)) { return; }
  // removeWebhook is the only way to delete a secret; pass empty key and skip check
  await dbManager.removeWebhook(action.id, docId, "", false);
}

export interface WebhookSubscription {
  unsubscribeKey: string;
  webhookId: string;
}

// Schema validators for api endpoints that creates or updates records.
const Checkers = t.createCheckers(TriggersTI);
const WebhookPatchChecker = Checkers.WebhookPatch;
const WebhookSubscribeChecker = Checkers.WebhookSubscribe;
const WebhookSubscribeCollectionChecker = Checkers.WebhookSubscribeCollection;
const TriggerAddRequestChecker = Checkers.TriggerAddRequest;
const TriggerUpdateRequestChecker = Checkers.TriggerUpdateRequest;
const TriggerDeletionRequestChecker = Checkers.TriggerDeletionRequest;

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
      } catch (err) {
        // remove webhook
        await this._dbManager.removeWebhook(webhookId, activeDoc.docName, "", false);
        throw err;
      } finally {
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
      activeDoc.triggers.clearCache();

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
          } else {
            if (!tableId) {
              throw new ApiError(`Cannot find columns "${watchedColIds}" because table is not known`, 404);
            }
            fields.watchedColRefList = [GristObjCode.List, ...watchedColIds
              .filter((colId: string) => colId.trim() !== "")
              .map(
                (colId: string) => { return colIdToReference(metaTables, tableId, colId.trim().replace(/^\$/, "")); },
              )];
          }
        } else {
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
        } else {
          fields.isReadyColRef = 0;
        }
      } else if (tableId) {
        // When isReadyColumn is undefined but tableId was changed, let's unset the ready column
        fields.isReadyColRef = 0;
      }

      // assign other field properties
      Object.assign(fields, _.pick(webhook, ["enabled", "memo", "condition"]));
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
    this._app.post("/api/docs/:docId/webhooks", isOwner, validate(WebhookSubscribeCollectionChecker),
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
     * @deprecated Use POST /webhooks instead. Kept for backward compatibility.
     */
    this._app.post("/api/docs/:docId/tables/:tableId/_subscribe", isOwner, validate(WebhookSubscribeChecker),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const registeredWebhook = await registerWebhook(activeDoc, req, req.body);
        res.json(registeredWebhook);
      }),
    );

    /**
     * @deprecated Use DELETE /webhooks/:webhookId instead. Kept for backward compatibility.
     */
    this._app.post("/api/docs/:docId/tables/:tableId/_unsubscribe", canEdit,
      withDocTriggersLock(removeWebhook),
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

    // Update a webhook
    this._app.patch(
      "/api/docs/:docId/webhooks/:webhookId", isOwner, validate(WebhookPatchChecker),
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
          activeDoc.triggers.clearCache();
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

    // --- Trigger CRUD endpoints ---

    // List all triggers
    this._app.get("/api/docs/:docId/triggers", isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        const docData = activeDoc.docData!;
        const triggersTable = docData.getMetaTable("_grist_Triggers");
        const records = await Promise.all(triggersTable.getRecords().map(async (rec) => {
          // Load secrets from homeDB and merge them back into each action
          const actions = parseActions(rec.actions as string);
          const enrichedActions = await Promise.all(
            actions.map(a => loadActionSecrets(a, this._dbManager, activeDoc.docName)),
          );
          return {
            id: rec.id,
            fields: {
              tableRef: rec.tableRef,
              label: rec.label,
              memo: rec.memo,
              enabled: rec.enabled,
              actions: JSON.stringify(enrichedActions),
              condition: rec.condition,
              eventTypes: rec.eventTypes,
              watchedColRefList: rec.watchedColRefList,
              isReadyColRef: rec.isReadyColRef,
            },
          };
        }));
        res.json({ records });
      }),
    );

    // Add triggers
    this._app.post("/api/docs/:docId/triggers", isOwner, validate(TriggerAddRequestChecker),
      withDocTriggersLock(async (activeDoc, req, res) => {
        if (activeDoc.isFork) {
          throw new ApiError("Unsaved document copies cannot have triggers", 400);
        }
        const { records } = req.body as TriggerAddRequest;

        const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
        const results: { id: number }[] = [];
        for (const record of records) {
          const fields = { ...record.fields };

          if (!tablesTable.getRecord(fields.tableRef)) {
            throw new ApiError(`Table not found: ${fields.tableRef}`, 404);
          }

          // Extract secret fields from actions and store in homeDB
          if (fields.actions) {
            const actions = parseActions(fields.actions);
            validateActions(actions);
            const processedActions = await Promise.all(
              actions.map(a => createActionSecret(a, this._dbManager, activeDoc.docName)),
            );
            fields.actions = JSON.stringify(processedActions);
          }

          const sandboxRes = await handleSandboxError("_grist_Triggers", [],
            activeDoc.applyUserActions(
              docSessionFromRequest(req),
              [["AddRecord", "_grist_Triggers", null, {
                enabled: true,
                ...fields,
              }]],
            ),
          );
          results.push({ id: sandboxRes.retValues[0] });
        }

        await activeDoc.sendWebhookNotification();
        res.json({ records: results });
      }),
    );

    // Update triggers
    this._app.patch("/api/docs/:docId/triggers", isOwner, validate(TriggerUpdateRequestChecker),
      withDocTriggersLock(async (activeDoc, req, res) => {
        if (activeDoc.isFork) {
          throw new ApiError("Unsaved document copies cannot have triggers", 400);
        }
        const { records } = req.body as TriggerUpdateRequest;

        const docData = activeDoc.docData!;
        const triggersTable = docData.getMetaTable("_grist_Triggers");

        for (const record of records) {
          const { id: triggerRowId, fields } = record;

          if (fields.actions) {
            const newActions = parseActions(fields.actions);
            validateActions(newActions);

            // Load old actions to detect removals
            const existingTrigger = triggersTable.getRecord(triggerRowId);
            const oldActions = existingTrigger ?
              parseActions(existingTrigger.actions as string) :
              [];

            // Process new actions: create secrets for new ones, update existing ones
            const processedActions = await Promise.all(
              newActions.map(a => a.id ?
                extractAndUpdateActionSecret(a as TriggerAction & Record<string, unknown>,
                  this._dbManager, activeDoc.docName) :
                createActionSecret(a as TriggerAction & Record<string, unknown>,
                  this._dbManager, activeDoc.docName),
              ),
            );

            // Remove secrets for old actions no longer present in the new array
            const newActionIds = new Set(processedActions.map(a => a.id).filter(Boolean));
            for (const oldAction of oldActions) {
              if (oldAction.id && !newActionIds.has(oldAction.id)) {
                try {
                  await removeSecret(oldAction, this._dbManager, activeDoc.docName);
                  activeDoc.webhookQueue.clearWebhookCache(oldAction.id);
                } catch (e) {
                  log.warn(`Failed to remove action secret ${oldAction.id}: ${e}`);
                }
              }
            }

            // Clear webhook caches for updated actions
            for (const action of processedActions) {
              if (action.id) {
                activeDoc.webhookQueue.clearWebhookCache(action.id);
              }
            }

            fields.actions = JSON.stringify(processedActions);
          }

          activeDoc.triggers.clearCache();
          await handleSandboxError("_grist_Triggers", [],
            activeDoc.applyUserActions(
              docSessionFromRequest(req),
              [["UpdateRecord", "_grist_Triggers", triggerRowId, fields]],
            ),
          );
        }

        await activeDoc.sendWebhookNotification();
        res.json({ success: true });
      }),
    );

    // Remove triggers
    this._app.post("/api/docs/:docId/triggers/delete", isOwner, validate(TriggerDeletionRequestChecker),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const { ids } = req.body as TriggerDeletionRequest;

        const docData = activeDoc.docData!;
        const triggersTable = docData.getMetaTable("_grist_Triggers");

        for (const triggerRowId of ids) {
          // Clean up secrets from homeDB for all actions that have secret fields
          const trigger = triggersTable.getRecord(triggerRowId);
          if (trigger) {
            const actions = parseActions(trigger.actions as string);
            for (const action of actions) {
              try {
                await removeSecret(action, this._dbManager, activeDoc.docName);
                if (action.id) {
                  activeDoc.webhookQueue.clearWebhookCache(action.id);
                }
              } catch (e) {
                log.warn(`Failed to remove action secret ${action.id}: ${e}`);
              }
            }
          }

          activeDoc.triggers.clearCache();
          await handleSandboxError("_grist_Triggers", [],
            activeDoc.applyUserActions(
              docSessionFromRequest(req),
              [["RemoveRecord", "_grist_Triggers", triggerRowId]],
            ),
          );
        }

        await activeDoc.sendWebhookNotification();
        res.json({ success: true });
      }),
    );

    // Monitoring endpoints — read-only, no lock needed.

    this._app.get("/api/docs/:docId/triggers/monitor", isOwner,
      withDoc(async (activeDoc, req, res) => {
        const entries = await activeDoc.notifMgr?.getDeliveryLog(activeDoc.docName) ?? [];
        const delivered: TriggerDeliveryRecord[] = entries.map((e) => {
          const meta = activeDoc.webhookQueue.resolveTriggerMeta(e.actionId);
          return {
            id: e.id,
            fields: {
              timestamp: e.timestamp,
              actionId: e.actionId,
              actionType: e.actionType,
              triggerName: meta.triggerName,
              tableName: meta.tableName,
              destination: e.destination,
              rowIds: e.rowIds,
              status: e.status,
              httpStatus: e.httpStatus,
              errorMessage: e.errorMessage,
            },
          };
        });

        const webhookPending = await activeDoc.webhookQueue.getPendingItems(activeDoc.docName);
        const emailPending = await activeDoc.notifMgr?.getPendingItems(activeDoc.docName) ?? [];
        const items = [...webhookPending, ...emailPending];
        const pending: TriggerPendingRecord[] = items.map((item, i) => {
          const meta = activeDoc.webhookQueue.resolveTriggerMeta(item.actionId);
          return {
            id: i + 1,
            fields: {
              actionId: item.actionId,
              actionType: item.actionType,
              triggerName: meta.triggerName,
              tableName: meta.tableName,
              rowId: item.rowId,
              destination: item.destination,
              status: item.status,
              lastResult: item.lastResult,
            },
          };
        });

        const response: TriggerMonitorResponse = { delivered, pending };
        res.json(response);
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
