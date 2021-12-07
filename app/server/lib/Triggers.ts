import {LocalActionBundle} from 'app/common/ActionBundle';
import {ActionSummary, TableDelta} from 'app/common/ActionSummary';
import {delay} from 'app/common/delay';
import {fromTableDataAction, RowRecord, TableColValues, TableDataAction} from 'app/common/DocActions';
import {StringUnion} from 'app/common/StringUnion';
import {MetaRowRecord} from 'app/common/TableData';
import {CellDelta} from 'app/common/TabularDiff';
import {summarizeAction} from 'app/server/lib/ActionSummary';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import {promisifyAll} from 'bluebird';
import * as _ from 'lodash';
import * as LRUCache from 'lru-cache';
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

const MAX_QUEUE_SIZE = 1000;

// Processes triggers for records changed as described in action bundles.
// initiating webhooks and automations.
// The interesting stuff starts in the handle() method.
// Webhooks are placed on an event queue in memory which is replicated on redis as backup.
// The same class instance consumes the queue and sends webhook requests in the background - see _sendLoop().
// Triggers are configured in the document, while details of webhooks (URLs) are kept
// in the Secrets table of the Home DB.
export class DocTriggers {
  // Converts a column ref to colId by looking it up in _grist_Tables_column
  private _getColId: (rowId: number) => string|undefined;

  // Events that need to be sent to webhooks in FIFO order.
  // This is the primary place where events are stored and consumed,
  // while a copy of this queue is kept on redis as a backup.
  // Modifications to this queue should be replicated on the redis queue.
  private _webHookEventQueue: WebHookEvent[] = [];

  // DB cache for webhook secrets
  private _webhookCache = new LRUCache<string, WebHookSecret>({max: 1000});

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

  constructor(private _activeDoc: ActiveDoc) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      // We create a transient client just for this purpose because it makes it easy
      // to quit it afterwards and avoid keeping a client open for documents without triggers.
      this._getRedisQueuePromise = this._getRedisQueue(createClient(redisUrl));
    }
  }

  public shutdown() {
    this._shuttingDown = true;
    if (!this._sending) {
      this._redisClient?.quitAsync();
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
    this._getColId = docData.getMetaTable("_grist_Tables_column").getRowPropFunc("colId");

    const triggersByTableRef = _.groupBy(triggersTable.getRecords(), "tableRef");
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
        const tableDataAction = this._activeDoc.fetchQuery(docSession, {tableId, filters});
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
      await delay(1000);
    }

    return summary;
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
    await this._redisClient!.rpushAsync(this._redisQueueKey, ...strings);
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

  private async _getWebHookUrl(id: string): Promise<string | undefined> {
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
    const url = webhook!.url;
    if (!isUrlAllowed(url)) {
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
      if (!this._webHookEventQueue.length) {
        await delay(1000);
        continue;
      }
      const id = this._webHookEventQueue[0].id;
      const batch = _.takeWhile(this._webHookEventQueue.slice(0, 100), {id});
      const body = JSON.stringify(batch.map(e => e.payload));
      const url = await this._getWebHookUrl(id);
      let meta: Record<string, any>|undefined;

      let success: boolean;
      if (!url) {
        success = true;
      } else {
        meta = {numEvents: batch.length, webhookId: id, host: new URL(url).host};
        this._log("Sending batch of webhook events", meta);
        success = await this._sendWebhookWithRetries(url, body);
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
        }
      } else if (meta) {
        this._log("Successfully sent batch of webhook events", meta);
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
    return this._drainingQueue ? 5 : 20;
  }

  private async _sendWebhookWithRetries(url: string, body: string) {
    const maxWait = 64;
    let wait = 1;
    for (let attempt = 0; attempt < this._maxWebhookAttempts; attempt++) {
      if (this._shuttingDown) {
        return false;
      }
      try {
        const response = await fetch(url, {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (response.status === 200) {
          return true;
        }
        this._log(`Webhook responded with non-200 status`, {level: 'warn', status: response.status, attempt});
      } catch (e) {
        this._log(`Webhook sending error: ${e}`, {level: 'warn', attempt});
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
        await delay(1000);
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

  // http (no s) is only allowed for localhost for testing.
  // localhost still needs to be explicitly permitted, and it shouldn't be outside dev
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return false;
  }

  return (process.env.ALLOWED_WEBHOOK_DOMAINS || "").split(",").some(domain =>
    domain && url.host.endsWith(domain)
  );
}
