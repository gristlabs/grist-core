import { ActionSummary, TableDelta } from 'app/common/ActionSummary';
import { delay } from 'app/common/delay';
import { fromTableDataAction, RowRecord, TableColValues, TableDataAction } from 'app/common/DocActions';
import { StringUnion } from 'app/common/StringUnion';
import { MetaRowRecord } from 'app/common/TableData';
import { CellDelta } from 'app/common/TabularDiff';
import { ActiveDoc } from 'app/server/lib/ActiveDoc';
import { makeExceptionalDocSession } from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';
import { promisifyAll } from 'bluebird';
import * as _ from 'lodash';
import * as LRUCache from 'lru-cache';
import fetch from 'node-fetch';
import { createClient, RedisClient } from 'redis';

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
  tableId: string;
  tableDelta: TableDelta;
  triggers: any;
  tableDataAction: Promise<TableDataAction>;
  recordDeltas: RecordDeltas;
}

// Processes triggers for records changed as described in ActionSummary objects,
// initiating webhooks and automations.
export class DocTriggers {
  // Converts a column ref to colId by looking it up in _grist_Tables_column
  private _getColId: (rowId: number) => string|undefined;

  // Events that need to be sent to webhooks in FIFO order.
  private _webHookEventQueue: WebHookEvent[] = [];

  // DB cache for webhook secrets
  private _webhookCache = new LRUCache<string, WebHookSecret>({max: 1000});

  private _shuttingDown: boolean = false;

  private _sending: boolean = false;

  private _redisClient: RedisClient | undefined;

  constructor(private _activeDoc: ActiveDoc) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this._redisClient = createClient(redisUrl);
      // TODO check for existing events on redis queue
    }
  }

  public shutdown() {
    this._shuttingDown = true;
    if (!this._sending) {
      this._redisClient?.quitAsync();
    }
  }

  public async handle(summary: ActionSummary) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      return;
    }  // Happens on doc creation while processing InitNewDoc action.

    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const getTableId = docData.getMetaTable("_grist_Tables").getMetaRowPropFunc("tableId");
    this._getColId = docData.getMetaTable("_grist_Tables_column").getMetaRowPropFunc("colId");

    const triggersByTableRef = _.groupBy(triggersTable.getRecords(), "tableRef");

    const tasks: Task[] = [];
    for (const tableRef of Object.keys(triggersByTableRef).sort()) {
      const triggers = triggersByTableRef[tableRef];
      const tableId = getTableId(Number(tableRef))!;  // groupBy makes tableRef a string
      const tableDelta = summary.tableDeltas[tableId];
      if (tableDelta) {
        const recordDeltas = this._getRecordDeltas(tableDelta);
        const filters = {id: [...recordDeltas.keys()]};

        // Fetch the modified records in full so they can be sent in webhooks
        // They will also be used to check if the record is ready
        const tableDataAction = this._activeDoc.fetchQuery(docSession, {tableId, filters});
        tasks.push({tableId, tableDelta, triggers, tableDataAction, recordDeltas});
      }
    }

    // Fetch values from document DB in parallel
    await Promise.all(tasks.map(t => t.tableDataAction));

    const events: WebHookEvent[] = [];
    for (const task of tasks) {
      events.push(...this._handleTask(task, await task.tableDataAction));
    }
    this._webHookEventQueue.push(...events);

    if (!this._sending && events.length) {
      this._sending = true;

      const startSendLoop = () => {
        this._sendLoop().catch((e) => {
          log.error(`_sendLoop failed: ${e}`);
          startSendLoop();
        });
      };
      startSendLoop();
    }

    // TODO also push to redis queue
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
    {tableDelta, tableId, triggers, recordDeltas}: Task,
    tableDataAction: TableDataAction,
  ) {
    const bulkColValues = fromTableDataAction(tableDataAction);

    log.info(`Processing ${triggers.length} triggers for ${bulkColValues.id.length} records of ${tableId}`);

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
        // This assumes that the ActionSummary contains all changes to the isReady column.
        // TODO ensure ActionSummary actually contains all changes, right now bulk changes are truncated.
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
          log.warn('Unexpected deltaBefore === "?"', {trigger, isReadyColId, rowId, docId: this._activeDoc.docName});
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
      const secret = await this._activeDoc.getHomeDbManager()?.getSecret(id, this._activeDoc.docName);
      if (!secret) {
        return;
      }
      webhook = JSON.parse(secret);
      this._webhookCache.set(id, webhook!);
    }
    const url = webhook!.url;
    if (!isUrlAllowed(url)) {
      log.warn(`Webhook not sent to forbidden URL: ${url}`);
      return;
    }
    return url;
  }

  private async _sendLoop() {
    log.info("Starting _sendLoop");

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
      let success: boolean;
      if (!url) {
        success = true;
      } else {
        success = await this._sendWebhookWithRetries(url, body);
      }
      if (success) {
        this._webHookEventQueue.splice(0, batch.length);
        // TODO also remove on redis
      } else if (!this._shuttingDown) {
        // TODO reorder queue on failure
      }
    }

    log.info("Ended _sendLoop");

    this._redisClient?.quitAsync().catch(e =>
      // Catch error to prevent sendLoop being restarted
      log.warn("Error quitting redis: " + e)
    );
  }

  private async _sendWebhookWithRetries(url: string, body: string) {
    const maxAttempts = 20;
    const maxWait = 64;
    let wait = 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
        log.warn(`Webhook responded with status ${response.status}`);
      } catch (e) {
        log.warn(`Webhook error: ${e}`);
      }

      // Don't wait any more if this is the last attempt.
      if (attempt >= maxAttempts - 1) {
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
