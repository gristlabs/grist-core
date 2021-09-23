import {ActionSummary, TableDelta} from "app/common/ActionSummary";
import {delay} from "app/common/delay";
import {fromTableDataAction, TableColValues} from "app/common/DocActions";
import {StringUnion} from "app/common/StringUnion";
import {MetaRowRecord} from "app/common/TableData";
import {CellValue} from "app/plugin/GristData";
import {ActiveDoc} from "app/server/lib/ActiveDoc";
import {makeExceptionalDocSession} from "app/server/lib/DocSession";
import * as log from "app/server/lib/log";
import * as _ from "lodash";
import * as LRUCache from "lru-cache";
import fetch from "node-fetch";

// TODO replace with redis
// Keeps track of whether records existed before changes to them started
// to determine the correct event type when the record is ready
const existedBeforeMemory: { [key: string]: boolean } = {};

// Only owners can manage triggers, but any user's activity can trigger them
// and the corresponding actions get the full values
const docSession = makeExceptionalDocSession('system');

// DB cache for webhook secrets
const webhookCache = new LRUCache<{ id: string, docId: string }, WebHookSecret>({max: 10 * 1000});

// Describes the change in existence to a record, which determines the event type
interface RecordDelta {
  existedBefore: boolean;
  existedAfter: boolean;
}

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

// Payload sent to webhook
// Simply the values in a record
interface Event {
  [colId: string]: CellValue;
}

export const allowedEventTypes = StringUnion("add", "update");

type EventType = typeof allowedEventTypes.type;

type Trigger = MetaRowRecord<"_grist_Triggers">;

export interface WebHookSecret {
  url: string;
  unsubscribeKey: string;
}

// Processes triggers for records changed as described in an ActionSummary,
// initiating webhooks and automations.
// An instance of this class should have .handle() called on it exactly once.
export class TriggersHandler {
  // Converts a column ref to colId by looking it up in _grist_Tables_column
  private _getColId: (rowId: number) => string|undefined;

  constructor(private _activeDoc: ActiveDoc) {
  }

  public handle(summary: ActionSummary) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      return;
    }  // Happens on doc creation while processing InitNewDoc action.

    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const getTableId = docData.getMetaTable("_grist_Tables").getMetaRowPropFunc("tableId");
    this._getColId = docData.getMetaTable("_grist_Tables_column").getMetaRowPropFunc("colId");

    const triggersByTableRef = _.groupBy(triggersTable.getRecords(), "tableRef");
    for (const [tableRef, triggers] of _.toPairs(triggersByTableRef)) {
      const tableId = getTableId(Number(tableRef))!;  // groupBy makes tableRef a string
      const tableDelta = summary.tableDeltas[tableId];
      if (!tableDelta) {
        continue;  // this table was not modified by these actions
      }
      // Handle tables in parallel (fetching table values from document DB)
      this._handleTableTriggers(
        tableId, tableDelta, triggers
      ).catch(() => log.error("Error handling triggers"));
    }
  }

  private async _handleTableTriggers(
    tableId: string, delta: TableDelta, triggers: Trigger[],
  ) {
    const recordDeltas = new Map<number, RecordDelta>();
    delta.updateRows.forEach(id =>
      recordDeltas.set(id, {existedBefore: true, existedAfter: true}));
    // A row ID can appear in both updateRows and addRows, although it probably shouldn't
    // Added row IDs override updated rows because they didn't exist before
    delta.addRows.forEach(id =>
      recordDeltas.set(id, {existedBefore: false, existedAfter: true}));

    // If we allow subscribing to deletion in the future
    // delta.removeRows.forEach(id =>
    //   recordDeltas.set(id, {existedBefore: true, existedAfter: false}));

    // Fetch the modified records in full so they can be sent in webhooks
    // They will also be used to check if the record is ready
    const filters = {id: [...recordDeltas.keys()]};
    const bulkColValues = fromTableDataAction(await this._activeDoc.fetchQuery(docSession, {tableId, filters}));

    triggers.forEach(trigger => {
      const actions = JSON.parse(trigger.actions) as TriggerAction[];
      bulkColValues.id.forEach((rowId, rowIndex) => {
        // Handle triggers in parallel (talking to redis)
        this._handleTrigger(
          trigger, actions, bulkColValues, rowIndex, rowId, recordDeltas.get(rowId)!
        ).catch(() => log.error("Error handling trigger action"));
      });
    });
  }

  // Handles a single trigger for a single record, initiating all the corresponding actions
  private async _handleTrigger(
    trigger: Trigger, actions: TriggerAction[],
    bulkColValues: TableColValues, rowIndex: number, rowId: number, recordDelta: RecordDelta,
  ) {
    let isReady: boolean;
    if (!trigger.isReadyColRef) {
      // User hasn't configured a column, so all records are considered ready immediately
      isReady = true;
    } else {
      const colId = this._getColId(trigger.isReadyColRef)!;
      const isReadyCellValue = bulkColValues[colId]?.[rowIndex];
      if (typeof isReadyCellValue !== "boolean") {
        // Likely causes: column not found or error in formula
        isReady = false;
      } else {
        isReady = isReadyCellValue;
      }
    }

    // Globally unique identifier of this record and trigger combination
    // trigger.tableRef is probably redundant given trigger.id, just being cautious
    const existedBeforeKey = `${this._activeDoc.docName}:${trigger.id}:${trigger.tableRef}:${rowId}`;

    // Only store existedBefore if it isn't stored already
    const existedBefore = existedBeforeKey in existedBeforeMemory ?
      existedBeforeMemory[existedBeforeKey] : recordDelta.existedBefore;

    if (!isReady) {
      existedBeforeMemory[existedBeforeKey] = existedBefore;
      return;
    }

    // Now that the record is ready, clear the stored existedBefore value
    // so that future events for this record are accurate
    delete existedBeforeMemory[existedBeforeKey];

    let eventType: EventType;
    if (existedBefore) {
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
    if (!trigger.eventTypes!.includes(eventType)) {
      // The user hasn't subscribed to the type of change that happened
      return;
    }

    // All the values in this record
    const event = _.mapValues(bulkColValues, col => col[rowIndex]);

    actions.forEach(action => {
      // Handle actions in parallel
      this._handleTriggerAction(
        action, event
      ).catch(() => log.error("Error handling trigger action"));
    });
  }

  private async _handleTriggerAction(action: TriggerAction, event: Event) {
    // TODO use event queue for reliability
    if (action.type === "webhook") {
      const key = {id: action.id, docId: this._activeDoc.docName};
      let webhook = webhookCache.get(key);
      if (!webhook) {
        const secret = await this._activeDoc.getHomeDbManager()?.getSecret(key.id, key.docId);
        if (!secret) {
          return;
        }
        webhook = JSON.parse(secret);
        webhookCache.set(key, webhook!);
      }
      const url = webhook!.url;
      if (!isUrlAllowed(url)) {
        log.warn(`Webhook not sent to forbidden URL: ${url}`);
        return;
      }
      pendingEvents.push({url: webhook!.url, event});
      if (!startedSending) {
        startedSending = true;
        setInterval(sendPendingEvents, 2000);
      }
    } else {
      throw new Error("Unknown action type " + action.type);
    }
  }
}

let pendingEvents: Array<{ url: string, event: Event }> = [];
let startedSending = false;

function sendPendingEvents() {
  const pending = pendingEvents;
  pendingEvents = [];
  for (const [url, group] of _.toPairs(_.groupBy(pending, "url"))) {
    const body = JSON.stringify(_.map(group, "event").reverse());
    sendWebhookWithRetries(url, body).catch(() => log.error("Webhook failed!"));
  }
}

async function sendWebhookWithRetries(url: string, body: string) {
  const maxAttempts = 20;
  const maxWait = 64;
  let wait = 1;
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 200) {
      return;
    } else {
      await delay((wait + Math.random()) * 1000);
      if (wait < maxWait) {
        wait *= 2;
      }
    }
  }
  throw new Error("Webhook failed!");
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
