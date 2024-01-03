import {LocalActionBundle} from 'app/common/ActionBundle';
import {summarizeAction} from 'app/common/ActionSummarizer';
import {ActionSummary, TableDelta} from 'app/common/ActionSummary';
import {ApiError} from 'app/common/ApiError';
import {MapWithTTL} from 'app/common/AsyncCreate';
import {WebhookMessageType} from "app/common/CommTypes";
import {fromTableDataAction, RowRecord, TableColValues, TableDataAction} from 'app/common/DocActions';
import {StringUnion} from 'app/common/StringUnion';
import {MetaRowRecord} from 'app/common/TableData';
import {CellDelta} from 'app/common/TabularDiff';
import {
  WebhookBatchStatus,
  WebhookStatus,
  WebhookSummary,
  WebhookSummaryCollection,
  WebhookUsage
} from 'app/common/Triggers';
import {decodeObject} from 'app/plugin/objtypes';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import log from 'app/server/lib/log';
import {proxyAgent} from 'app/server/lib/ProxyAgent';
import {matchesBaseDomain} from 'app/server/lib/requestUtils';
import {delayAbort} from 'app/server/lib/serverUtils';
import {LogSanitizer} from "app/server/utils/LogSanitizer";
import {promisifyAll} from 'bluebird';
import * as _ from 'lodash';
import {AbortController, AbortSignal} from 'node-abort-controller';
import fetch from 'node-fetch';
import {createClient, Multi, RedisClient} from 'redis';

promisifyAll(RedisClient.prototype);

// Only owners can manage triggers, but any user's activity can trigger them
// and the corresponding actions get the full values
const docSession = makeExceptionalDocSession('system');

// Describes the change in existence to a record, which determines the event type
interface RecordDelta {
  existedBefore: boolean;
  existedAfter: boolean;
}

type RecordDeltas = Map<number, RecordDelta>;

// Union discriminated by type
type TriggerAction = WebhookAction | PythonAction;

export interface WebhookAction {
  type: "webhook";
  id: string;
}

// Just hypothetical
interface PythonAction {
  id: string;
  type: "python";
  code: string;
}

interface WebHookEvent {
  payload: RowRecord;
  id: string;
}

export const allowedEventTypes = StringUnion("add", "update");

type EventType = typeof allowedEventTypes.type;

type Trigger = MetaRowRecord<"_grist_Triggers">;

export interface WebHookSecret {
  url: string;
  unsubscribeKey: string;
}

// Work to do after fetching values from the document
interface Task {
  tableDelta: TableDelta;
  triggers: Trigger[];
  tableDataAction: Promise<TableDataAction>;
  recordDeltas: RecordDeltas;
}

const MAX_QUEUE_SIZE =
  process.env.GRIST_MAX_QUEUE_SIZE ? parseInt(process.env.GRIST_MAX_QUEUE_SIZE, 10) : 1000;

const WEBHOOK_CACHE_TTL = 10_000;

const WEBHOOK_STATS_CACHE_TTL = 1000 /*s*/ * 60 /*m*/ * 24/*h*/;

// A time to wait for between retries of a webhook. Exposed for tests.
const TRIGGER_WAIT_DELAY =
  process.env.GRIST_TRIGGER_WAIT_DELAY ? parseInt(process.env.GRIST_TRIGGER_WAIT_DELAY, 10) : 1000;

const TRIGGER_MAX_ATTEMPTS =
  process.env.GRIST_TRIGGER_MAX_ATTEMPTS ? parseInt(process.env.GRIST_TRIGGER_MAX_ATTEMPTS, 10) : 20;

// Processes triggers for records changed as described in action bundles.
// initiating webhooks and automations.
// The interesting stuff starts in the handle() method.
// Webhooks are placed on an event queue in memory which is replicated on redis as backup.
// The same class instance consumes the queue and sends webhook requests in the background - see _sendLoop().
// Triggers are configured in the document, while details of webhooks (URLs) are kept
// in the Secrets table of the Home DB.
export class DocTriggers {


  // Events that need to be sent to webhooks in FIFO order.
  // This is the primary place where events are stored and consumed,
  // while a copy of this queue is kept on redis as a backup.
  // Modifications to this queue should be replicated on the redis queue.
  private _webHookEventQueue: WebHookEvent[] = [];

  // DB cache for webhook secrets
  private _webhookCache = new MapWithTTL<string, WebHookSecret>(WEBHOOK_CACHE_TTL);

  // Set to true by shutdown().
  // Indicates that loops (especially for sending requests) should stop.
  private _shuttingDown: boolean = false;

  // true if there is a webhook request sending loop running in the background
  // to ensure only one loop is running at a time.
  private _sending: boolean = false;

  // Client lazily initiated by _redisClient getter, since most documents don't have triggers
  // and therefore don't need a redis connection.
  private _redisClientField: RedisClient | undefined;

  // Promise which resolves after we finish fetching the backup queue from redis on startup.
  private _getRedisQueuePromise: Promise<void> | undefined;

  // Abort controller for the loop that sends webhooks.
  private _loopAbort: AbortController|undefined;

  private _stats: WebhookStatistics;
  private _sanitizer = new LogSanitizer();

  constructor(private _activeDoc: ActiveDoc) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      // We create a transient client just for this purpose because it makes it easy
      // to quit it afterwards and avoid keeping a client open for documents without triggers.
      this._getRedisQueuePromise = this._getRedisQueue(createClient(redisUrl));
    }
    this._stats = new WebhookStatistics(this._docId, _activeDoc, () => this._redisClient ?? null);
  }

  public shutdown() {
    this._shuttingDown = true;
    this._loopAbort?.abort();
    if (!this._sending) {
      void(this._redisClientField?.quitAsync());
    }
  }

  // Called after applying actions to a document and updating its data.
  // Checks for triggers configured in a meta table,
  // and whether any of those triggers monitor tables which were modified by the actions
  // in the given bundle.
  // If so, generates events which are pushed to the local and redis queues.
  //
  // Returns an ActionSummary generated from the given LocalActionBundle.
  //
  // Generating the summary here makes it easy to specify which columns need to
  // have all their changes included in the summary without truncation
  // so that we can accurately identify which records are ready for sending.
  public async handle(localActionBundle: LocalActionBundle): Promise<ActionSummary> {
    const docData = this._activeDoc.docData;
    if (!docData) {
      return summarizeAction(localActionBundle);
    }  // Happens on doc creation while processing InitNewDoc action.

    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const getTableId = docData.getMetaTable("_grist_Tables").getRowPropFunc("tableId");

    const triggersByTableRef = _.groupBy(triggersTable.getRecords().filter(t => t.enabled), "tableRef");
    const triggersByTableId: Array<[string, Trigger[]]> = [];

    // First we need a list of columns which must be included in full in the action summary
    const isReadyColIds: string[] = [];
    for (const tableRef of Object.keys(triggersByTableRef).sort()) {
      const triggers = triggersByTableRef[tableRef];
      const tableId = getTableId(Number(tableRef))!;  // groupBy makes tableRef a string
      triggersByTableId.push([tableId, triggers]);
      for (const trigger of triggers) {
        if (trigger.isReadyColRef) {
          const colId = this._getColId(trigger.isReadyColRef);
          if (colId) {
            isReadyColIds.push(colId);
          }
        }
      }
    }

    const summary = summarizeAction(localActionBundle, {alwaysPreserveColIds: isReadyColIds});

    // Work to do after fetching values from the document
    const tasks: Task[] = [];

    // For each table in the document which is monitored by one or more triggers...
    for (const [tableId, triggers] of triggersByTableId) {
      const tableDelta = summary.tableDeltas[tableId];
      // ...if the monitored table was modified by the summarized actions,
      // fetch the modified/created records and note the work that needs to be done.
      if (tableDelta) {
        const recordDeltas = this._getRecordDeltas(tableDelta);
        const filters = {id: [...recordDeltas.keys()]};

        // Fetch the modified records in full so they can be sent in webhooks
        // They will also be used to check if the record is ready
        const tableDataAction = this._activeDoc.fetchQuery(docSession, {tableId, filters}, true)
          .then(tableFetchResult => tableFetchResult.tableData);
        tasks.push({tableDelta, triggers, tableDataAction, recordDeltas});
      }
    }

    // Fetch values from document DB in parallel
    await Promise.all(tasks.map(t => t.tableDataAction));

    const events: WebHookEvent[] = [];
    for (const task of tasks) {
      events.push(...this._handleTask(task, await task.tableDataAction));
    }
    if (!events.length) {
      return summary;
    }
    this._log("Total number of webhook events generated by bundle", {numEvents: events.length});

    // Only add events to the queue after we finish fetching the backup from redis
    // to ensure that events are delivered in the order they were generated.
    await this._getRedisQueuePromise;

    if (this._redisClient) {
      await this._pushToRedisQueue(events);
    }

    this._webHookEventQueue.push(...events);

    this._startSendLoop();

    // Prevent further document activity while the queue is too full.
    while (this._drainingQueue && !this._shuttingDown) {
      const sendNotificationPromise =  this._activeDoc.sendWebhookNotification(WebhookMessageType.Overflow);
      const delayPromise = delayAbort(5000, this._loopAbort?.signal).catch(() => {});
      await Promise.all([sendNotificationPromise, delayPromise]);
    }

    return summary;
  }

  /**
   * Creates summary for all webhooks in the document.
   */
  public async summary(): Promise<WebhookSummaryCollection> {
    // Prepare some data we will use.
    const docData = this._activeDoc.docData!;
    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const getTableId = docData.getMetaTable("_grist_Tables").getRowPropFunc("tableId");
    const getColId = docData.getMetaTable("_grist_Tables_column").getRowPropFunc("colId");
    const getUrl = async (id: string) => (await this._getWebHook(id))?.url ?? '';
    const getUnsubscribeKey = async (id: string) => (await this._getWebHook(id))?.unsubscribeKey ?? '';
    const resultTable: WebhookSummary[] = [];

    // Go through all triggers int the document that we have.
    for (const t of triggersTable.getRecords()) {
      // Each trigger has associated table and a bunch of trigger actions (currently only 1 that is webhook).
      const actions = JSON.parse(t.actions) as TriggerAction[];
      // Get only webhooks for this trigger.
      const webhookActions = actions.filter(act => act.type === "webhook") as WebhookAction[];
      for (const act of webhookActions) {
        // Url, probably should be hidden for non-owners (but currently this API is owners only).
        const url = await getUrl(act.id);
        // Same story, should be hidden.
        const unsubscribeKey = await getUnsubscribeKey(act.id);
        if (!url || !unsubscribeKey) {
          // Webhook might have been deleted in the mean time.
          continue;
        }
        // Report some basic info and usage stats.
        const entry: WebhookSummary = {
          // Id of the webhook
          id: act.id,
          fields: {
            // Url, probably should be hidden for non-owners (but currently this API is owners only).
            url,
            unsubscribeKey,
            // Other fields used to register this webhook.
            eventTypes: decodeObject(t.eventTypes) as string[],
            isReadyColumn: getColId(t.isReadyColRef) ?? null,
            tableId: getTableId(t.tableRef) ?? null,
            // For future use - for now every webhook is enabled.
            enabled: t.enabled,
            name: t.label,
            memo: t.memo,
          },
          // Create some statics and status info.
          usage: await this._stats.getUsage(act.id, this._webHookEventQueue),
        };
        resultTable.push(entry);
      }
    }
    return {webhooks: resultTable};
  }

  public getWebhookTriggerRecord(webhookId: string) {
    const docData = this._activeDoc.docData!;
    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const trigger = triggersTable.getRecords().find(t => {
      const actions: TriggerAction[] = JSON.parse((t.actions || '[]') as string);
      return actions.some(action => action.id === webhookId && action?.type === "webhook");
    });
    if (!trigger) {
      throw new ApiError(`Webhook not found "${webhookId || ''}"`, 404);
    }
    return trigger;
  }

  public webhookDeleted(id: string) {
    // We can't do much about that as the loop might be in progress and it is not safe to modify the queue.
    // But we can clear the webHook cache, so that the next time we check the webhook url it will be gone.
    this.clearWebhookCache(id);
  }

  public clearWebhookCache(id: string) {
    this._webhookCache.delete(id);
  }

  public async clearWebhookQueue() {
    this._log("Webhook being queue cleared");
    // Make sure we are after start and in sync with redis.
    if (this._getRedisQueuePromise) {
      await this._getRedisQueuePromise;
    }
    // Clear in-memory queue.
    const removed = this._webHookEventQueue.splice(0, this._webHookEventQueue.length).length;
    // Notify the loop that it should restart.
    this._loopAbort?.abort();
    // If we have backup in redis, clear it also.
    // NOTE: this is subject to a race condition, currently it is not possible, but any future modification probably
    // will require some kind of locking over the queue (or a rewrite)
    if (removed && this._redisClient) {
      await this._redisClient.multi().del(this._redisQueueKey).execAsync();
    }
    await this._stats.clear();
    this._log("Webhook queue cleared", {numRemoved: removed});
  }

  public async clearSingleWebhookQueue(webhookId: string) {
    this._log("Single webhook queue being cleared", {webhookId});
    // Make sure we are after start and in sync with redis.
    if (this._getRedisQueuePromise) {
      await this._getRedisQueuePromise;
    }
    // Clear in-memory queue for given webhook key.
    const lengthBefore = this._webHookEventQueue.length;
    this._webHookEventQueue = this._webHookEventQueue.filter(e => e.id !== webhookId);
    const removed = lengthBefore - this._webHookEventQueue.length;

    // Notify the loop that it should restart.
    this._loopAbort?.abort();
    // If we have backup in redis, clear it also.
    // NOTE: this is subject to a race condition, currently it is not possible, but any future modification probably
    // will require some kind of locking over the queue (or a rewrite)
    if (removed && this._redisClient) {
      const multi = this._redisClient.multi();
      multi.del(this._redisQueueKey);

      // Re-add all the remaining events to the queue.
      if (this._webHookEventQueue.length) {
        const strings = this._webHookEventQueue.map(e => JSON.stringify(e));
        multi.rpush(this._redisQueueKey, ...strings);
      }
      await multi.execAsync();
    }
    await this._stats.clear();
    this._log("Single webhook queue cleared", {numRemoved: removed, webhookId});
  }

  // Converts a table to tableId by looking it up in _grist_Tables.
  private _getTableId(rowId: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    return docData.getMetaTable("_grist_Tables").getValue(rowId, "tableId");
  }

  // Return false if colRef does not belong to tableRef
  private _validateColId(colRef: number, tableRef: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    return docData.getMetaTable("_grist_Tables_column").getValue(colRef, "parentId") === tableRef;
  }

  // Converts a column ref to colId by looking it up in _grist_Tables_column. If tableRef is
  // provided, check whether col belongs to table and throws if not.
  private _getColId(rowId: number, tableRef?: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    if (!rowId) { return ''; }
    const colId = docData.getMetaTable("_grist_Tables_column").getValue(rowId, "colId");
    if (tableRef !== undefined &&
      docData.getMetaTable("_grist_Tables_column").getValue(rowId, "parentId") !== tableRef) {
      throw new ApiError(`Column ${colId} does not belong to table ${this._getTableId(tableRef)}`, 400);
    }
    return colId;
  }

  private get _docId() {
    return this._activeDoc.docName;
  }

  private get _redisQueueKey() {
    return `webhook-queue-${this._docId}`;
  }

  private get _drainingQueue() {
    return this._webHookEventQueue.length >= MAX_QUEUE_SIZE;
  }

  private _log(msg: string, {level = 'info', ...meta}: any = {}) {
    log.origLog(level, 'DocTriggers: ' + msg, {
      ...meta,
      docId: this._docId,
      queueLength: this._webHookEventQueue.length,
      drainingQueue: this._drainingQueue,
      shuttingDown: this._shuttingDown,
      sending: this._sending,
      redisClient: Boolean(this._redisClientField),
    });
  }

  private async _pushToRedisQueue(events: WebHookEvent[]) {
    const strings = events.map(e => JSON.stringify(e));
    try {
      await this._redisClient?.rpushAsync(this._redisQueueKey, ...strings);
    }
    catch(e){
      // It's very hard to test this with integration tests, because it requires a redis failure.
      // And it's not easy to simulate redis failure.
      // So on this point we have only unit test in core/test/server/utils/LogSanitizer.ts
      throw this._sanitizer.sanitize(e);
    }
  }

  private async _getRedisQueue(redisClient: RedisClient) {
    const strings = await redisClient.lrangeAsync(this._redisQueueKey, 0, -1);
    if (strings.length) {
      this._log("Webhook events found on redis queue", {numEvents: strings.length});
      const events = strings.map(s => JSON.parse(s));
      this._webHookEventQueue.unshift(...events);
      this._startSendLoop();
    }
    await redisClient.quitAsync();
  }

  private _getRecordDeltas(tableDelta: TableDelta): RecordDeltas {
    const recordDeltas = new Map<number, RecordDelta>();
    tableDelta.updateRows.forEach(id =>
      recordDeltas.set(id, {existedBefore: true, existedAfter: true}));
    // A row ID can appear in both updateRows and addRows, although it probably shouldn't
    // Added row IDs override updated rows because they didn't exist before
    tableDelta.addRows.forEach(id =>
      recordDeltas.set(id, {existedBefore: false, existedAfter: true}));

    // If we allow subscribing to deletion in the future
    // delta.removeRows.forEach(id =>
    //   recordDeltas.set(id, {existedBefore: true, existedAfter: false}));

    return recordDeltas;
  }

  private _handleTask(
    {tableDelta, triggers, recordDeltas}: Task,
    tableDataAction: TableDataAction,
  ) {
    const bulkColValues = fromTableDataAction(tableDataAction);

    const meta = {numTriggers: triggers.length, numRecords: bulkColValues.id.length};
    this._log(`Processing triggers`, meta);

    const makePayload = _.memoize((rowIndex: number) =>
      _.mapValues(bulkColValues, col => col[rowIndex]) as RowRecord
    );

    const result: WebHookEvent[] = [];
    for (const trigger of triggers) {
      const actions = JSON.parse(trigger.actions) as TriggerAction[];
      const webhookActions = actions.filter(act => act.type === "webhook") as WebhookAction[];
      if (!webhookActions.length) {
        continue;
      }

      if (trigger.isReadyColRef) {
        if (!this._validateColId(trigger.isReadyColRef, trigger.tableRef)) {
          // ready column does not belong to table, let's ignore trigger and log stats
          for (const action of webhookActions) {
            const colId = this._getColId(trigger.isReadyColRef); // no validation
            const tableId = this._getTableId(trigger.tableRef);
            const error = `isReadyColumn is not valid: colId ${colId} does not belong to ${tableId}`;
            this._stats.logInvalid(action.id, error).catch(e => log.error("Webhook stats failed to log", e));
          }
          continue;
        }
      }

      // TODO: would be worth checking that the trigger's fields are valid (ie: eventTypes, url,
      // ...) as there's no guarantee that they are.

      const rowIndexesToSend: number[] = _.range(bulkColValues.id.length).filter(rowIndex => {
          const rowId = bulkColValues.id[rowIndex];
          return this._shouldTriggerActions(
            trigger, bulkColValues, rowIndex, rowId, recordDeltas.get(rowId)!, tableDelta,
          );
        }
      );

      for (const action of webhookActions) {
        for (const rowIndex of rowIndexesToSend) {
          const event = {id: action.id, payload: makePayload(rowIndex)};
          result.push(event);
        }
      }
    }

    this._log("Generated events from triggers", {numEvents: result.length, ...meta});

    return result;
  }

  /**
   * Determines if actions should be triggered for a single record and trigger.
   */
  private _shouldTriggerActions(
    trigger: Trigger,
    bulkColValues: TableColValues,
    rowIndex: number,
    rowId: number,
    recordDelta: RecordDelta,
    tableDelta: TableDelta,
  ): boolean {
    let readyBefore: boolean;
    if (!trigger.isReadyColRef) {
      // User hasn't configured a column, so all records are considered ready immediately
      readyBefore = recordDelta.existedBefore;
    } else {
      const isReadyColId = this._getColId(trigger.isReadyColRef)!;

      // Must be the actual boolean `true`, not just anything truthy
      const isReady = bulkColValues[isReadyColId][rowIndex] === true;
      if (!isReady) {
         return false;
      }

      const cellDelta: CellDelta | undefined = tableDelta.columnDeltas[isReadyColId]?.[rowId];
      if (!recordDelta.existedBefore) {
        readyBefore = false;
      } else if (!cellDelta ) {
        // Cell wasn't changed, and the record is ready now, so it was ready before.
        // This requires that the ActionSummary contains all changes to the isReady column.
        readyBefore = true;
      } else {
        const deltaBefore = cellDelta[0];
        if (deltaBefore === null) {
          // The record didn't exist before, so it definitely wasn't ready
          // (although we probably shouldn't reach this since we already checked recordDelta.existedBefore)
          readyBefore = false;
        } else if (deltaBefore === "?") {
          // The ActionSummary shouldn't contain this kind of delta at all
          // since it comes from a single action bundle, not a combination of summaries.
          this._log('Unexpected deltaBefore === "?"', {level: 'warn', trigger});
          readyBefore = true;
        } else {
          // Only remaining case is that deltaBefore is a single-element array containing the previous value.
          const [valueBefore] = deltaBefore;

          // Must be the actual boolean `true`, not just anything truthy
          readyBefore = valueBefore === true;
        }
      }
    }

    let eventType: EventType;
    if (readyBefore) {
      eventType = "update";
      // If we allow subscribing to deletion in the future
      // if (recordDelta.existedAfter) {
      //   eventType = "update";
      // } else {
      //   eventType = "remove";
      // }
    } else {
      eventType = "add";
    }

    return trigger.eventTypes!.includes(eventType);
  }

  private async _getWebHook(id: string): Promise<WebHookSecret | undefined> {
    let webhook = this._webhookCache.get(id);
    if (!webhook) {
      const secret = await this._activeDoc.getHomeDbManager()?.getSecret(id, this._docId);
      if (!secret) {
        this._log(`No webhook secret found`, {level: 'warn', id});
        return;
      }
      webhook = JSON.parse(secret);
      this._webhookCache.set(id, webhook!);
    }
    return webhook!;
  }

  private async _getWebHookUrl(id: string): Promise<string | undefined> {
    const url = (await this._getWebHook(id))?.url ?? '';
    if (!isUrlAllowed(url)) {
      // TODO: this is not a good place for a validation.
      this._log(`Webhook not sent to forbidden URL`, {level: 'warn', url});
      return;
    }
    return url;
  }

  private _startSendLoop() {
    if (!this._sending) {  // only run one loop at a time
      this._sending = true;
      this._sendLoop().catch((e) => {  // run _sendLoop asynchronously (in the background)
        this._log(`_sendLoop failed: ${e}`, {level: 'error'});
        this._sending = false;  // otherwise the following line will complete instantly
        this._startSendLoop();  // restart the loop on failure
      });
    }
  }

  // Consumes the webhook event queue and sends HTTP requests.
  // Should only be called if there are events to send.
  // Managed by _startSendLoop. Runs in the background. Only one loop should run at a time.
  // Runs until shutdown.
  private async _sendLoop() {
    this._log("Starting _sendLoop");

    // TODO delay/prevent shutting down while queue isn't empty?
    while (!this._shuttingDown) {
      this._loopAbort = new AbortController();
      if (!this._webHookEventQueue.length) {
        await delayAbort(TRIGGER_WAIT_DELAY, this._loopAbort.signal).catch(() => {});
        continue;
      }
      const id = this._webHookEventQueue[0].id;
      const batch = _.takeWhile(this._webHookEventQueue.slice(0, 100), {id});
      const body = JSON.stringify(batch.map(e => e.payload));
      const url = await this._getWebHookUrl(id);
      if (this._loopAbort.signal.aborted) {
        continue;
      }
      let meta: Record<string, any>|undefined;

      let success: boolean;
      if (!url) {
        success = true;
      } else {
        await this._stats.logStatus(id, 'sending');
        meta = {numEvents: batch.length, webhookId: id, host: new URL(url).host};
        this._log("Sending batch of webhook events", meta);
        this._activeDoc.logTelemetryEvent(null, 'sendingWebhooks', {
          limited: {numEvents: meta.numEvents},
        });
        success = await this._sendWebhookWithRetries(id, url, body, batch.length, this._loopAbort.signal);
        if (this._loopAbort.signal.aborted) {
          continue;
        }
      }

      if (this._loopAbort.signal.aborted) {
        continue;
      }

      this._webHookEventQueue.splice(0, batch.length);

      let multi: Multi | null = null;
      if (this._redisClient) {
        multi = this._redisClient.multi();
        multi.ltrim(this._redisQueueKey, batch.length, -1);
      }

      if (!success) {
        this._log("Failed to send batch of webhook events", {...meta, level: 'warn'});
        if (!this._drainingQueue) {
          // Put the failed events at the end of the queue to try again later
          // while giving other URLs a chance to receive events.
          this._webHookEventQueue.push(...batch);
          if (multi) {
            const strings = batch.map(e => JSON.stringify(e));
            multi.rpush(this._redisQueueKey, ...strings);
          }
          // We are postponed, so mark that.
          await this._stats.logStatus(id, 'postponed');
        } else {
          // We are draining the queue and we skipped some events, so mark that.
          await this._stats.logStatus(id, 'error');
          await this._stats.logBatch(id, 'rejected');
        }
      } else {
        await this._stats.logStatus(id, 'idle');
        if (meta) {
          this._log("Successfully sent batch of webhook events", meta);
        }
      }

      await multi?.execAsync();
    }

    this._log("Ended _sendLoop");

    this._redisClient?.quitAsync().catch(e =>
      // Catch error to prevent sendLoop being restarted
      this._log("Error quitting redis: " + e, {level: 'warn'})
    );
  }

  private get _redisClient() {
    if (this._redisClientField) {
      return this._redisClientField;
    }
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this._log("Creating redis client");
      this._redisClientField = createClient(redisUrl);
    }
    return this._redisClientField;
  }

  private get _maxWebhookAttempts() {
    if (this._shuttingDown) {
      return 0;
    }
    return this._drainingQueue ? Math.min(5, TRIGGER_MAX_ATTEMPTS) : TRIGGER_MAX_ATTEMPTS;
  }

  private async _sendWebhookWithRetries(id: string, url: string, body: string, size: number, signal: AbortSignal) {
    const maxWait = 64;
    let wait = 1;
    for (let attempt = 0; attempt < this._maxWebhookAttempts; attempt++) {
      if (this._shuttingDown) {
        return false;
      }
      try {
        if (attempt > 0) {
          await this._stats.logStatus(id, 'retrying');
        }
        const response = await fetch(url, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
          },
          signal,
          agent: proxyAgent(new URL(url)),
        });
        if (response.status === 200) {
          await this._stats.logBatch(id, 'success', { size, httpStatus: 200, error: null, attempts: attempt + 1 });
          return true;
        }
        await this._stats.logBatch(id, 'failure', {
          httpStatus: response.status,
          error: await response.text(),
          attempts: attempt + 1,
          size,
        });
        this._log(`Webhook responded with non-200 status`, {level: 'warn', status: response.status, attempt});
      } catch (e) {
        await this._stats.logBatch(id, 'failure', {
          httpStatus: null,
          error: (e.message || 'Unrecognized error during fetch'),
          attempts: attempt + 1,
          size,
        });
        this._log(`Webhook sending error: ${e}`, {level: 'warn', attempt});
      }

      if (signal.aborted) {
        return false;
      }

      // Don't wait any more if this is the last attempt.
      if (attempt >= this._maxWebhookAttempts - 1) {
        return false;
      }

      // Wait `wait` seconds, checking this._shuttingDown every second.
      for (let waitIndex = 0; waitIndex < wait; waitIndex++) {
        if (this._shuttingDown) {
          return false;
        }
        try {
          await delayAbort(TRIGGER_WAIT_DELAY, signal);
        } catch (e) {
          // If signal was aborted, don't log anything as we probably was cleared.
          return false;
        }
      }
      if (wait < maxWait) {
        wait *= 2;
      }
    }
    return false;
  }
}

export function isUrlAllowed(urlString: string) {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }

  // Support at most https and http.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }

  // Support a wildcard that allows all domains.
  // Allow either https or http if it is set.
  if (process.env.ALLOWED_WEBHOOK_DOMAINS === '*') {
    return true;
  }

  // http (no s) is only allowed for localhost for testing.
  // localhost still needs to be explicitly permitted, and it shouldn't be outside dev
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return false;
  }

  return (process.env.ALLOWED_WEBHOOK_DOMAINS || "").split(",").some(domain =>
    domain && matchesBaseDomain(url.host, domain)
  );
}


/**
 * Implementation detail, helper to provide a persisted storage to a derived class.
 */
class PersistedStore<Keys> {
  /** In memory fallback if redis is not available */
  private _statsCache = new MapWithTTL<string, string>(WEBHOOK_STATS_CACHE_TTL);
  private _redisKey: string;

  constructor(
    docId: string,
    private _activeDoc: ActiveDoc,
    private _redisClientDep: () => RedisClient | null
    ) {
    this._redisKey = `webhooks:${docId}:statistics`;
  }

  public async clear() {
    this._statsCache.clear();
    if (this._redisClient) {
      await this._redisClient.delAsync(this._redisKey).catch(() => {});
    }
  }

  protected async markChange() {
    await this._activeDoc.sendWebhookNotification();
  }

  protected async set(id: string, keyValues: [Keys, string][]) {
    if (this._redisClient) {
      const multi = this._redisClient.multi();
      for (const [key, value] of keyValues) {
        multi.hset(this._redisKey, `${id}:${key}`, value);
        multi.expire(this._redisKey, WEBHOOK_STATS_CACHE_TTL);
      }
      await multi.execAsync();
    } else {
      for (const [key, value] of keyValues) {
        this._statsCache.set(`${id}:${key}`, value);
      }
    }
  }

  protected async get(id: string, keys: Keys[]): Promise<[Keys, string][]> {
    if (this._redisClient) {
      const values = (await this._redisClient.hgetallAsync(this._redisKey)) || {};
      return keys.map(key => [key, values[`${id}:${key}`] || '']);
    } else {
      return keys.map(key => [key, this._statsCache.get(`${id}:${key}`) || '']);
    }
  }

  private get _redisClient() {
    return this._redisClientDep();
  }
}

/**
 * Helper class that monitors and saves (either in memory or in Redis) usage statics and current
 * status of webhooks.
 */
class WebhookStatistics extends PersistedStore<StatsKey> {
  /**
   * Retrieves and calculates all the statistics for a given webhook.
   * @param id Webhook ID
   * @param queue Current webhook task queue
   */
  public async getUsage(id: string, queue: WebHookEvent[]): Promise<WebhookUsage|null> {
    // Get all the keys from the store for this webhook, and create a dictionary.
    const values: Record<StatsKey, string> = _.fromPairs(await this.get(id, [
      `batchStatus`,
      `httpStatus`,
      `errorMessage`,
      `size`,
      `status`,
      `updatedTime`,
      `lastFailureTime`,
      `lastSuccessTime`,
      `lastErrorMessage`,
      `lastHttpStatus`,
      `attempts`,
    ])) as Record<StatsKey, string>;

    // If everything is empty, we don't have any stats yet.
    if (Array.from(Object.values(values)).every(v => !v)) {
      return {
        status: 'idle',
        numWaiting: queue.filter(e => e.id === id).length,
        lastEventBatch: null,
      };
    }

    const usage: WebhookUsage = {
      // Overall status of the webhook.
      status: values.status as WebhookStatus || 'idle',
      numWaiting: queue.filter(x => x.id === id).length,
      updatedTime: parseInt(values.updatedTime || "0", 10),
      // Last values from batches.
      lastEventBatch: null,
      lastSuccessTime: parseInt(values.lastSuccessTime, 10),
      lastFailureTime: parseInt(values.lastFailureTime, 10),
      lastErrorMessage: values.lastErrorMessage || null,
      lastHttpStatus: values.lastHttpStatus ? parseInt(values.lastHttpStatus, 10) : null,
    };

    // If we have a batchStatus (so we actually run it at least once - or it wasn't cleared).
    if (values.batchStatus) {
      usage.lastEventBatch = {
        status: values.batchStatus as WebhookBatchStatus,
        httpStatus: values.httpStatus ? parseInt(values.httpStatus || "0", 10) : null,
        errorMessage: values.errorMessage || null,
        size: parseInt(values.size || "0", 10),
        attempts: parseInt(values.attempts|| "0", 10),
      };
    }

    return usage;
  }

  /**
   * Logs a status of a webhook. Now is passed as a parameter so that updates that happen in almost the same
   * millisecond were seen as the same update.
   */
  public async logStatus(id: string, status: WebhookStatus, now?: number|null) {
    const stats: [StatsKey, string][] = [
      ['status', status],
      ['updatedTime', (now ?? Date.now()).toString()],
    ];
    if (status === 'sending') {
      // clear any error message that could have been left from an earlier bad state (ie: invalid
      // fields)
      stats.push(['errorMessage', '']);
    }
    await this.set(id, stats);
    await this.markChange();
  }

  public async logInvalid(id: string, errorMessage: string) {
    await this.logStatus(id, 'invalid');
    await this.set(id, [
      ['errorMessage', errorMessage]
    ]);
    await this.markChange();
  }

  /**
   * Logs a status of the active batch.
   */
  public async logBatch(
    id: string,
    status: WebhookBatchStatus,
    stats?: {
      httpStatus?: number|null,
      error?: string|null,
      size?: number|null,
      attempts?: number|null,
    }
  ) {
    const now = Date.now();

    // Update batchStats.
    const batchStats: [StatsKey, string][] = [
      [`batchStatus`, status],
      [`updatedTime`, now.toString()],
    ];
    if (stats?.httpStatus !== undefined) {
      batchStats.push([`httpStatus`, (stats.httpStatus || '').toString()]);
    }
    if (stats?.attempts !== undefined) {
      batchStats.push([`attempts`, (stats.attempts || '0').toString()]);
    }
    if (stats?.error !== undefined) {
      batchStats.push([`errorMessage`, stats?.error || '']);
    }
    if (stats?.size !== undefined) {
      batchStats.push([`size`, (stats.size || '').toString()]);
    }

    const batchSummary: [StatsKey, string][] = [];
    // Update webhook stats.
    if (status === 'success') {
      batchSummary.push([`lastSuccessTime`, now.toString()]);
    } else if (status === 'failure') {
      batchSummary.push([`lastFailureTime`, now.toString()]);
    }
    if (stats?.error) {
      batchSummary.push([`lastErrorMessage`, stats.error]);
    }
    if (stats?.httpStatus) {
      batchSummary.push([`lastHttpStatus`, (stats.httpStatus || '').toString()]);
    }
    await this.set(id, batchStats.concat(batchSummary));
    await this.markChange();
  }
}

type StatsKey =
  'batchStatus' |
  'httpStatus' |
  'errorMessage' |
  'attempts' |
  'size'|
  'updatedTime' |
  'lastFailureTime' |
  'lastSuccessTime' |
  'lastErrorMessage' |
  'lastHttpStatus' |
  'status';
